import { createHash, randomBytes } from "node:crypto";
import type { DeviceAccessRecord, DeviceAccessStatus, WebSpeakDatabase } from "../persistence/database.js";
import { AdminInputError } from "../admin/admin-errors.js";

/** httpOnly cookie that identifies one browser profile across visits. */
export const DEVICE_COOKIE_NAME = "webspeak_device";
/** Long enough that an approved browser practically never has to ask again. */
export const DEVICE_COOKIE_MAX_AGE_MS = 5 * 365 * 24 * 60 * 60 * 1000;
const REQUIRED_META_KEY = "device_approval_required";
/** Unanswered requests are capped so anonymous visitors cannot grow the table without bound. */
export const MAX_PENDING_DEVICE_REQUESTS = 200;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;
const ID_PATTERN = /^device-[a-z0-9-]{1,100}$/i;

export type DeviceAdmission =
  | { allowed: true; status: "approved" | "not-required" }
  | { allowed: false; status: "pending" | "denied"; created: boolean }
  | { allowed: false; status: "queue-full" };

export interface DeviceAccessView {
  id: string;
  status: DeviceAccessStatus;
  nickname: string;
  clientIp: string;
  userAgent: string;
  createdAt: string;
  lastSeenAt: string;
  decidedAt: string | null;
}

export interface DeviceVisit {
  nickname: string;
  clientIp: string;
  userAgent: string;
}

export function createDeviceToken(): string {
  return randomBytes(32).toString("base64url");
}

export function isDeviceToken(value: string | null | undefined): value is string {
  return typeof value === "string" && TOKEN_PATTERN.test(value);
}

function hashDeviceToken(token: string): string {
  return createHash("sha256").update(`webspeak-device:${token}`).digest("hex");
}

export class DeviceAccessService {
  constructor(private readonly database: WebSpeakDatabase) {}

  isRequired(): boolean {
    return this.database.getMeta(REQUIRED_META_KEY) === "1";
  }

  setRequired(required: boolean): void {
    if (typeof required !== "boolean") throw new AdminInputError("INVALID_DEVICE_APPROVAL", "Approval setting must be boolean");
    if (required === this.isRequired()) return;
    this.database.setMeta(REQUIRED_META_KEY, required ? "1" : "0");
    this.database.addAudit(required ? "DEVICE_APPROVAL_ENABLED" : "DEVICE_APPROVAL_DISABLED");
  }

  /** Current status for a browser without recording anything. */
  status(token: string | null): "not-required" | "approved" | "pending" | "denied" | "unknown" {
    if (!this.isRequired()) return "not-required";
    if (!isDeviceToken(token)) return "unknown";
    return this.database.getDeviceAccess(hashDeviceToken(token))?.status ?? "unknown";
  }

  /**
   * Decide whether a join may proceed. An unknown browser becomes a pending
   * request that the administrator answers in the console.
   */
  admit(token: string, visit: DeviceVisit): DeviceAdmission {
    if (!this.isRequired()) return { allowed: true, status: "not-required" };
    if (!isDeviceToken(token)) return { allowed: false, status: "denied", created: false };
    const seen = normalizeVisit(visit);
    const existing = this.database.getDeviceAccess(hashDeviceToken(token));
    if (existing) {
      this.database.touchDeviceAccess(existing.id, seen);
      if (existing.status === "approved") return { allowed: true, status: "approved" };
      return { allowed: false, status: existing.status, created: false };
    }
    if (this.database.countPendingDeviceAccess() >= MAX_PENDING_DEVICE_REQUESTS) return { allowed: false, status: "queue-full" };
    const record = this.database.createDeviceAccessRequest({
      id: `device-${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`,
      tokenHash: hashDeviceToken(token),
      ...seen,
    });
    this.database.addAudit("DEVICE_ACCESS_REQUESTED", { id: record.id, nickname: record.nickname });
    return { allowed: false, status: "pending", created: true };
  }

  list(): { required: boolean; pendingCount: number; devices: DeviceAccessView[] } {
    const devices = this.database.listDeviceAccess().map(toView);
    return { required: this.isRequired(), pendingCount: devices.filter((device) => device.status === "pending").length, devices };
  }

  pendingCount(): number {
    return this.database.countPendingDeviceAccess();
  }

  decide(id: string, decision: "approve" | "deny"): boolean {
    assertDeviceId(id);
    const status: DeviceAccessStatus = decision === "approve" ? "approved" : "denied";
    const changed = this.database.setDeviceAccessStatus(id, status);
    if (changed) this.database.addAudit(decision === "approve" ? "DEVICE_ACCESS_APPROVED" : "DEVICE_ACCESS_DENIED", { id });
    return changed;
  }

  forget(id: string): boolean {
    assertDeviceId(id);
    const removed = this.database.deleteDeviceAccess(id);
    if (removed) this.database.addAudit("DEVICE_ACCESS_FORGOTTEN", { id });
    return removed;
  }
}

function assertDeviceId(id: string): void {
  if (!ID_PATTERN.test(id)) throw new AdminInputError("INVALID_DEVICE_ID", "Device id is invalid");
}

function normalizeVisit(visit: DeviceVisit): DeviceVisit {
  return {
    nickname: visit.nickname.trim().slice(0, 30),
    clientIp: visit.clientIp.slice(0, 64),
    userAgent: visit.userAgent.slice(0, 300),
  };
}

function toView(record: DeviceAccessRecord): DeviceAccessView {
  const { tokenHash: _tokenHash, ...view } = record;
  return view;
}
