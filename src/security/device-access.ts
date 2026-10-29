import { createHash, randomBytes } from "node:crypto";
import type { AccessAccountRecord, DeviceAccessRecord, DeviceAccessStatus, WebSpeakDatabase } from "../persistence/database.js";
import { AdminInputError } from "../admin/admin-errors.js";
import { hashAdminPassword, verifyAdminPassword, type AdminCredential } from "./admin-password.js";

/** httpOnly cookie that identifies one browser profile across visits. */
export const DEVICE_COOKIE_NAME = "webspeak_device";
/** Long enough that an approved browser practically never has to ask again. */
export const DEVICE_COOKIE_MAX_AGE_MS = 5 * 365 * 24 * 60 * 60 * 1000;
const REQUIRED_META_KEY = "device_approval_required";
/** Unanswered requests are capped so anonymous visitors cannot grow the table without bound. */
export const MAX_PENDING_DEVICE_REQUESTS = 200;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;
const ID_PATTERN = /^device-[a-z0-9-]{1,100}$/i;
const ACCOUNT_ID_PATTERN = /^account-[a-z0-9-]{1,100}$/i;
export const ACCOUNT_PASSWORD_MIN_LENGTH = 6;
export const ACCOUNT_PASSWORD_MAX_LENGTH = 128;
/** Wrong passwords in a row before a nickname is locked for a while. */
export const ACCOUNT_MAX_FAILED_ATTEMPTS = 5;
export const ACCOUNT_LOCK_MS = 15 * 60 * 1000;

/** Nicknames are compared case-insensitively with collapsed whitespace. */
export function nicknameKey(nickname: string): string {
  return nickname.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

/** How a nickname relates to this browser. */
export type NicknameAccountState = "none" | "linked" | "other";

export type AccountResult = { ok: true } | { ok: false; code: string };

export interface AccessAccountView {
  id: string;
  nickname: string;
  createdAt: string;
  lastLoginAt: string | null;
  deviceCount: number;
  locked: boolean;
}

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
  accountNickname: string | null;
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

  list(): { required: boolean; pendingCount: number; devices: DeviceAccessView[]; accounts: AccessAccountView[] } {
    const accountRecords = this.database.listAccessAccounts();
    const names = new Map(accountRecords.map((account) => [account.id, account.nickname]));
    const devices = this.database.listDeviceAccess().map((record) => toView(record, names));
    const now = Date.now();
    const accounts = accountRecords.map((account) => ({
      id: account.id,
      nickname: account.nickname,
      createdAt: account.createdAt,
      lastLoginAt: account.lastLoginAt,
      deviceCount: account.deviceCount,
      locked: isLocked(account, now),
    }));
    return { required: this.isRequired(), pendingCount: devices.filter((device) => device.status === "pending").length, devices, accounts };
  }

  /** Whether this nickname is protected, and whether this browser owns it. */
  nicknameState(token: string | null, nickname: string): { account: NicknameAccountState; canCreate: boolean } {
    const key = nicknameKey(nickname);
    if (!this.isRequired() || !key) return { account: "none", canCreate: false };
    const device = isDeviceToken(token) ? this.database.getDeviceAccess(hashDeviceToken(token)) : null;
    const account = this.database.getAccessAccountByKey(key);
    if (account) return { account: device?.accountId === account.id ? "linked" : "other", canCreate: false };
    return { account: "none", canCreate: device?.status === "approved" && !device.accountId };
  }

  /**
   * A password-protected nickname may only be used from browsers linked to
   * its account. Returns the refusal code, or null when the join may go on.
   */
  checkNickname(token: string, nickname: string): "ACCOUNT_PASSWORD_REQUIRED" | "APPROVAL_DENIED" | null {
    if (!this.isRequired()) return null;
    const account = this.database.getAccessAccountByKey(nicknameKey(nickname));
    if (!account) return null;
    const device = isDeviceToken(token) ? this.database.getDeviceAccess(hashDeviceToken(token)) : null;
    if (device?.status === "denied") return "APPROVAL_DENIED";
    return device?.accountId === account.id ? null : "ACCOUNT_PASSWORD_REQUIRED";
  }

  /** Protect the nickname of an approved browser with a password. */
  async createAccount(token: string, nickname: string, password: string): Promise<AccountResult> {
    if (!this.isRequired()) return { ok: false, code: "APPROVAL_NOT_REQUIRED" };
    const passwordError = validateAccountPassword(password);
    if (passwordError) return { ok: false, code: passwordError };
    const displayName = nickname.trim().replace(/\s+/g, " ").slice(0, 30);
    const key = nicknameKey(displayName);
    if (!key) return { ok: false, code: "INVALID_NICKNAME" };
    const device = isDeviceToken(token) ? this.database.getDeviceAccess(hashDeviceToken(token)) : null;
    if (device?.status !== "approved") return { ok: false, code: "APPROVAL_REQUIRED" };
    if (device.accountId) return { ok: false, code: "DEVICE_HAS_ACCOUNT" };
    if (this.database.getAccessAccountByKey(key)) return { ok: false, code: "ACCOUNT_EXISTS" };
    const credential = await hashAdminPassword(password, { username: key, allowWeakPassword: true });
    const id = `account-${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`;
    if (!this.database.createAccessAccount({ id, nicknameKey: key, nickname: displayName, credentialJson: JSON.stringify(credential) }, device.id)) {
      return { ok: false, code: "ACCOUNT_EXISTS" };
    }
    this.database.addAudit("ACCESS_ACCOUNT_CREATED", { id, nickname: displayName });
    return { ok: true };
  }

  /** Approve this browser by the nickname's password, without asking the administrator. */
  async signIn(token: string, nickname: string, password: string, visit: Omit<DeviceVisit, "nickname">, now = Date.now()): Promise<AccountResult> {
    if (!this.isRequired()) return { ok: false, code: "APPROVAL_NOT_REQUIRED" };
    if (!isDeviceToken(token) || typeof password !== "string" || password.length > ACCOUNT_PASSWORD_MAX_LENGTH) {
      return { ok: false, code: "ACCOUNT_PASSWORD_INVALID" };
    }
    const account = this.database.getAccessAccountByKey(nicknameKey(nickname));
    if (!account) return { ok: false, code: "ACCOUNT_NOT_FOUND" };
    const device = this.database.getDeviceAccess(hashDeviceToken(token));
    // An explicit refusal by the administrator is not overridden by a password.
    if (device?.status === "denied") return { ok: false, code: "APPROVAL_DENIED" };
    if (isLocked(account, now)) return { ok: false, code: "ACCOUNT_LOCKED" };
    if (account.lockedUntil && account.failedAttempts >= ACCOUNT_MAX_FAILED_ATTEMPTS) this.database.resetAccountFailures(account.id);
    const failures = account.lockedUntil && Date.parse(account.lockedUntil) <= now ? 0 : account.failedAttempts;
    let credential: AdminCredential;
    try { credential = JSON.parse(account.credentialJson) as AdminCredential; } catch { return { ok: false, code: "ACCOUNT_PASSWORD_INVALID" }; }
    if (!await verifyAdminPassword(password, credential)) {
      const lock = failures + 1 >= ACCOUNT_MAX_FAILED_ATTEMPTS ? new Date(now + ACCOUNT_LOCK_MS).toISOString() : null;
      this.database.recordAccountLogin(account.id, false, lock);
      if (lock) this.database.addAudit("ACCESS_ACCOUNT_LOCKED", { id: account.id });
      return { ok: false, code: lock ? "ACCOUNT_LOCKED" : "ACCOUNT_PASSWORD_INVALID" };
    }
    const seen = normalizeVisit({ ...visit, nickname: account.nickname });
    if (device) {
      this.database.approveDeviceForAccount(device.id, account.id);
      this.database.touchDeviceAccess(device.id, seen);
    } else {
      this.database.createApprovedDevice({
        id: `device-${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`,
        tokenHash: hashDeviceToken(token),
        accountId: account.id,
        ...seen,
      });
    }
    this.database.recordAccountLogin(account.id, true, null);
    this.database.addAudit("ACCESS_ACCOUNT_SIGNED_IN", { id: account.id });
    return { ok: true };
  }

  /** Remove a nickname's password; its browsers stay approved but are no longer linked. */
  deleteAccount(id: string): boolean {
    if (!ACCOUNT_ID_PATTERN.test(id)) throw new AdminInputError("INVALID_ACCOUNT_ID", "Account id is invalid");
    const removed = this.database.deleteAccessAccount(id);
    if (removed) this.database.addAudit("ACCESS_ACCOUNT_RESET", { id });
    return removed;
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

function toView(record: DeviceAccessRecord, accountNames: Map<string, string>): DeviceAccessView {
  const { tokenHash: _tokenHash, accountId, ...view } = record;
  return { ...view, accountNickname: accountId ? accountNames.get(accountId) ?? null : null };
}

function isLocked(account: Pick<AccessAccountRecord, "lockedUntil">, now: number): boolean {
  return Boolean(account.lockedUntil && Date.parse(account.lockedUntil) > now);
}

export function validateAccountPassword(password: unknown): string | null {
  if (typeof password !== "string" || password.length < ACCOUNT_PASSWORD_MIN_LENGTH) return "ACCOUNT_PASSWORD_TOO_SHORT";
  if (password.length > ACCOUNT_PASSWORD_MAX_LENGTH) return "ACCOUNT_PASSWORD_TOO_LONG";
  return null;
}
