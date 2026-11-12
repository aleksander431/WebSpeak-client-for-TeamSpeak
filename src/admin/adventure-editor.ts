import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  DraftError,
  MAX_DRAFT_BYTES,
  UPLOAD_NAME,
  draftAdventureId,
  draftToPackage,
  emptyDraft,
  parseDraft,
  type AdventureDraft,
} from "../shared/adventure-draft.js";
import type { AdventureSummary } from "../shared/tabletop.js";
import { AdventureLibrary, AdventureLibraryError } from "./adventure-library.js";

/*
 * Adventure editor access and drafts. The administrator creates a link
 * (`/create/<token>`); a browser that opens it asks to join with a name and a
 * random key it keeps; once the administrator approves that browser, it can
 * keep drafts under the link, upload pictures and music, and publish a draft
 * into the adventure library. Everything lives under `<data>/editor/`:
 * `state.json` (links, browsers, the draft index), `drafts/<id>.json` and
 * `files/<32 hex>.<ext>` (served as capability URLs at `/api/editor-files/`).
 */

export const EDITOR_MAX_LINKS = 30;
export const EDITOR_MAX_DEVICES = 20;
export const EDITOR_MAX_DRAFTS = 30;
export const EDITOR_MAX_IMAGE_BYTES = 16 * 1024 * 1024;
export const EDITOR_MAX_AUDIO_BYTES = 40 * 1024 * 1024;
const LINK_QUOTA_BYTES = 600 * 1024 * 1024;

export type DeviceStatus = "pending" | "approved" | "denied";

interface DeviceRecord {
  id: string;
  name: string;
  keyHash: string;
  status: DeviceStatus;
  requestedAt: string;
  decidedAt?: string;
  lastSeenAt?: string;
}

interface DraftRecord {
  id: string;
  title: string;
  updatedAt: string;
  publishedId?: string;
  publishedAt?: string;
  files: string[];
}

interface LinkRecord {
  id: string;
  token: string;
  label: string;
  createdAt: string;
  devices: DeviceRecord[];
  drafts: DraftRecord[];
}

interface EditorState {
  links: LinkRecord[];
}

export class AdventureEditorError extends Error {
  constructor(readonly code: string, message = code, readonly status = 400, readonly field = "") {
    super(message);
    this.name = "AdventureEditorError";
  }
}

export interface EditorLinkSummary {
  id: string;
  token: string;
  label: string;
  createdAt: string;
  devices: Array<Omit<DeviceRecord, "keyHash">>;
  drafts: Array<Omit<DraftRecord, "files">>;
  bytes: number;
}

export interface EditorDraftSummary {
  id: string;
  title: string;
  updatedAt: string;
  publishedId?: string;
  publishedAt?: string;
}

export class AdventureEditorStore {
  private state: EditorState = { links: [] };
  private queue: Promise<unknown> = Promise.resolve();
  private readonly fileSizes = new Map<string, number>();

  constructor(
    private readonly directory: string,
    private readonly library: AdventureLibrary | undefined,
    /** Reads a file the site serves (library pictures, built-in music) by its URL path. */
    private readonly readStatic: (url: string) => Promise<Buffer>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async load(): Promise<void> {
    await mkdir(path.join(this.directory, "drafts"), { recursive: true });
    await mkdir(path.join(this.directory, "files"), { recursive: true });
    try {
      const raw = JSON.parse(await readFile(path.join(this.directory, "state.json"), "utf8")) as EditorState;
      if (Array.isArray(raw.links)) this.state = { links: raw.links };
    } catch { /* first start */ }
    for (const name of await readdir(path.join(this.directory, "files")).catch(() => [] as string[])) {
      if (!UPLOAD_NAME.test(name)) continue;
      const info = await stat(path.join(this.directory, "files", name)).catch(() => null);
      if (info) this.fileSizes.set(name, info.size);
    }
  }

  // ---- Administrator -----------------------------------------------------------

  links(): EditorLinkSummary[] {
    return this.state.links.map(link => ({
      id: link.id, token: link.token, label: link.label, createdAt: link.createdAt,
      devices: link.devices.map(({ keyHash: _hash, ...device }) => device),
      drafts: link.drafts.map(({ files: _files, ...draft }) => draft),
      bytes: this.linkBytes(link),
    }));
  }

  createLink(label: string): Promise<EditorLinkSummary> {
    return this.mutate(async () => {
      const clean = label.trim().slice(0, 60);
      if (!clean) throw new AdventureEditorError("EDITOR_LABEL", "A name for the link is required.");
      if (this.state.links.length >= EDITOR_MAX_LINKS) throw new AdventureEditorError("EDITOR_LINK_LIMIT", "Too many links.");
      const link: LinkRecord = { id: hex(8), token: randomBytes(24).toString("base64url"), label: clean, createdAt: this.stamp(), devices: [], drafts: [] };
      this.state.links.push(link);
      await this.save();
      return this.links().find(item => item.id === link.id)!;
    });
  }

  /** Removes a link, its browsers and its drafts (published adventures stay in the library). */
  removeLink(id: string): Promise<boolean> {
    return this.mutate(async () => {
      const link = this.state.links.find(item => item.id === id);
      if (!link) return false;
      this.state.links = this.state.links.filter(item => item !== link);
      await this.save();
      for (const draft of link.drafts) await this.dropDraftFiles(draft);
      return true;
    });
  }

  decide(linkId: string, deviceId: string, status: DeviceStatus | "remove"): Promise<boolean> {
    return this.mutate(async () => {
      const link = this.state.links.find(item => item.id === linkId);
      const device = link?.devices.find(item => item.id === deviceId);
      if (!link || !device) return false;
      if (status === "remove") link.devices = link.devices.filter(item => item !== device);
      else Object.assign(device, { status, decidedAt: this.stamp() });
      await this.save();
      return true;
    });
  }

  pendingCount(): number {
    return this.state.links.reduce((sum, link) => sum + link.devices.filter(device => device.status === "pending").length, 0);
  }

  // ---- Editor browsers ------------------------------------------------------------

  /** What a browser opening the link may do. Unknown tokens are reported as such. */
  status(token: string, key: string): { label: string; status: DeviceStatus | "none"; name?: string } {
    const link = this.linkByToken(token);
    const device = this.deviceFor(link, key);
    return { label: link.label, status: device?.status ?? "none", ...(device ? { name: device.name } : {}) };
  }

  request(token: string, key: string, name: string): Promise<{ status: DeviceStatus }> {
    return this.mutate(async () => {
      const link = this.linkByToken(token);
      if (!/^[0-9a-f]{64}$/.test(key)) throw new AdventureEditorError("EDITOR_KEY", "Bad browser key.");
      const clean = name.trim().slice(0, 40);
      if (!clean) throw new AdventureEditorError("EDITOR_NAME", "Your name is required.");
      const existing = this.deviceFor(link, key);
      if (existing) return { status: existing.status };
      if (link.devices.length >= EDITOR_MAX_DEVICES) throw new AdventureEditorError("EDITOR_DEVICE_LIMIT", "Too many browsers asked for this link.", 429);
      link.devices.push({ id: hex(8), name: clean, keyHash: sha256(key), status: "pending", requestedAt: this.stamp() });
      await this.save();
      return { status: "pending" as const };
    });
  }

  drafts(token: string, key: string): EditorDraftSummary[] {
    const link = this.approved(token, key);
    return link.drafts.map(({ files: _files, ...draft }) => draft).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  createDraft(token: string, key: string, title: string): Promise<{ id: string; draft: AdventureDraft }> {
    return this.mutate(async () => {
      const link = this.approved(token, key);
      if (link.drafts.length >= EDITOR_MAX_DRAFTS) throw new AdventureEditorError("EDITOR_DRAFT_LIMIT", "Too many drafts.");
      const clean = title.trim().slice(0, 80) || "Новое приключение";
      const draft = emptyDraft(clean);
      const record: DraftRecord = { id: hex(8), title: clean, updatedAt: this.stamp(), files: [] };
      await this.writeDraft(record.id, draft);
      link.drafts.push(record);
      await this.save();
      return { id: record.id, draft };
    });
  }

  async draft(token: string, key: string, id: string): Promise<{ draft: AdventureDraft; summary: EditorDraftSummary; files: string[] }> {
    const link = this.approved(token, key);
    const record = this.draftRecord(link, id);
    const draft = parseDraft(JSON.parse(await readFile(this.draftPath(record.id), "utf8")));
    const { files, ...summary } = record;
    return { draft, summary, files: [...files] };
  }

  saveDraft(token: string, key: string, id: string, raw: unknown): Promise<EditorDraftSummary> {
    return this.mutate(async () => {
      const link = this.approved(token, key);
      const record = this.draftRecord(link, id);
      let draft: AdventureDraft;
      try { draft = parseDraft(raw); }
      catch (error: unknown) {
        if (error instanceof DraftError) throw new AdventureEditorError("EDITOR_DRAFT_INVALID", error.message, 400, error.path);
        throw error;
      }
      if (Buffer.byteLength(JSON.stringify(draft)) > MAX_DRAFT_BYTES) throw new AdventureEditorError("EDITOR_DRAFT_TOO_LARGE", "The draft is too large.");
      for (const name of uploadsOf(draft)) {
        if (!record.files.includes(name)) throw new AdventureEditorError("EDITOR_FILE_UNKNOWN", `${name} was not uploaded to this draft.`);
      }
      await this.writeDraft(record.id, draft);
      record.title = draft.title.trim() || record.title;
      record.updatedAt = this.stamp();
      await this.save();
      const { files: _files, ...summary } = record;
      return summary;
    });
  }

  removeDraft(token: string, key: string, id: string): Promise<void> {
    return this.mutate(async () => {
      const link = this.approved(token, key);
      const record = this.draftRecord(link, id);
      link.drafts = link.drafts.filter(item => item !== record);
      await this.save();
      await this.dropDraftFiles(record);
    });
  }

  /** Stores an uploaded picture or track for a draft; the type is taken from the bytes. */
  upload(token: string, key: string, draftId: string, bytes: Buffer): Promise<{ file: string; kind: "image" | "audio" }> {
    return this.mutate(async () => {
      const link = this.approved(token, key);
      const record = this.draftRecord(link, draftId);
      const sniffed = sniffUpload(bytes);
      if (!sniffed) throw new AdventureEditorError("EDITOR_FILE_TYPE", "Only WebP, PNG, JPEG pictures and Ogg, MP3, M4A, WebM music.");
      const limit = sniffed.kind === "image" ? EDITOR_MAX_IMAGE_BYTES : EDITOR_MAX_AUDIO_BYTES;
      if (bytes.byteLength > limit) throw new AdventureEditorError("EDITOR_FILE_SIZE", "The file is too large.", 413);
      if (this.linkBytes(link) + bytes.byteLength > LINK_QUOTA_BYTES) throw new AdventureEditorError("EDITOR_QUOTA", "This link has no space left.", 413);
      if (record.files.length >= 400) throw new AdventureEditorError("EDITOR_FILE_LIMIT", "Too many files in this draft.");
      const name = `${hex(16)}.${sniffed.extension}`;
      const target = path.join(this.directory, "files", name);
      await writeFile(`${target}.part`, bytes);
      await rename(`${target}.part`, target);
      this.fileSizes.set(name, bytes.byteLength);
      record.files.push(name);
      await this.save();
      return { file: name, kind: sniffed.kind };
    });
  }

  /** Disk path of an uploaded file (capability URL: the name is random). */
  filePath(name: string): { path: string; mimeType: string } | null {
    if (!UPLOAD_NAME.test(name) || !this.fileSizes.has(name)) return null;
    return { path: path.join(this.directory, "files", name), mimeType: MIME[name.split(".").pop()!]! };
  }

  /** Builds the draft's package and installs it into the adventure library. */
  publish(token: string, key: string, id: string): Promise<AdventureSummary> {
    return this.mutate(async () => {
      if (!this.library) throw new AdventureEditorError("EDITOR_LIBRARY_UNAVAILABLE", "Adventure storage is unavailable.", 503);
      const link = this.approved(token, key);
      const record = this.draftRecord(link, id);
      const draft = parseDraft(JSON.parse(await readFile(this.draftPath(record.id), "utf8")));
      let built;
      try { built = draftToPackage(draft, draftAdventureId(record.id)); }
      catch (error: unknown) {
        if (error instanceof DraftError) throw new AdventureEditorError("EDITOR_DRAFT_INCOMPLETE", error.message, 400, error.path);
        throw error;
      }
      const files = new Map<string, Buffer>();
      for (const [file, source] of built.files) {
        if ("upload" in source) {
          if (!record.files.includes(source.upload)) throw new AdventureEditorError("EDITOR_FILE_UNKNOWN", `${source.upload} is missing.`);
          files.set(file, await readFile(path.join(this.directory, "files", source.upload)));
        } else {
          try {
            files.set(file, await this.readStatic(source.static));
          } catch {
            throw new AdventureEditorError("EDITOR_FILE_UNKNOWN", `${source.static} is missing on the server.`, 409);
          }
        }
      }
      let adventure: AdventureSummary;
      try { adventure = await this.library.installFiles(built.manifest, files); }
      catch (error: unknown) {
        if (error instanceof AdventureLibraryError) throw new AdventureEditorError("EDITOR_PUBLISH_FAILED", error.message, 400);
        throw error;
      }
      record.publishedId = adventure.id;
      record.publishedAt = this.stamp();
      await this.save();
      return adventure;
    });
  }

  // ---- Internals -------------------------------------------------------------------

  private linkByToken(token: string): LinkRecord {
    const link = this.state.links.find(item => safeEqual(item.token, token));
    if (!link) throw new AdventureEditorError("EDITOR_LINK_UNKNOWN", "This link does not exist or was removed.", 404);
    return link;
  }

  private deviceFor(link: LinkRecord, key: string): DeviceRecord | undefined {
    if (!/^[0-9a-f]{64}$/.test(key)) return undefined;
    const hash = sha256(key);
    return link.devices.find(device => safeEqual(device.keyHash, hash));
  }

  private approved(token: string, key: string): LinkRecord {
    const link = this.linkByToken(token);
    const device = this.deviceFor(link, key);
    if (device?.status !== "approved") throw new AdventureEditorError("EDITOR_NOT_APPROVED", "The administrator has not approved this browser yet.", 403);
    device.lastSeenAt = this.stamp();
    return link;
  }

  private draftRecord(link: LinkRecord, id: string): DraftRecord {
    const record = link.drafts.find(item => item.id === id);
    if (!record) throw new AdventureEditorError("EDITOR_DRAFT_UNKNOWN", "No such draft.", 404);
    return record;
  }

  private linkBytes(link: LinkRecord): number {
    return link.drafts.reduce((sum, draft) => sum + draft.files.reduce((inner, file) => inner + (this.fileSizes.get(file) ?? 0), 0), 0);
  }

  private draftPath(id: string): string {
    return path.join(this.directory, "drafts", `${id}.json`);
  }

  private async writeDraft(id: string, draft: AdventureDraft): Promise<void> {
    const target = this.draftPath(id);
    await writeFile(`${target}.part`, JSON.stringify(draft));
    await rename(`${target}.part`, target);
  }

  private async dropDraftFiles(record: DraftRecord): Promise<void> {
    await rm(this.draftPath(record.id), { force: true });
    for (const file of record.files) {
      this.fileSizes.delete(file);
      await rm(path.join(this.directory, "files", file), { force: true });
    }
  }

  private async save(): Promise<void> {
    const target = path.join(this.directory, "state.json");
    await writeFile(`${target}.part`, JSON.stringify(this.state));
    await rename(`${target}.part`, target);
  }

  private mutate<T>(run: () => Promise<T>): Promise<T> {
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private stamp(): string {
    return this.now().toISOString();
  }
}

const MIME: Record<string, string> = {
  webp: "image/webp", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
  ogg: "audio/ogg", opus: "audio/ogg", mp3: "audio/mpeg", m4a: "audio/mp4", webm: "audio/webm",
};

export function sniffUpload(bytes: Buffer): { extension: string; kind: "image" | "audio" } | null {
  const head = (length: number) => bytes.subarray(0, length);
  if (head(8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { extension: "png", kind: "image" };
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { extension: "jpg", kind: "image" };
  if (head(4).toString("latin1") === "RIFF" && bytes.subarray(8, 12).toString("latin1") === "WEBP") return { extension: "webp", kind: "image" };
  if (head(4).toString("latin1") === "OggS") return { extension: "ogg", kind: "audio" };
  if (head(3).toString("latin1") === "ID3" || (bytes[0] === 0xff && ((bytes[1] ?? 0) & 0xe0) === 0xe0)) return { extension: "mp3", kind: "audio" };
  if (bytes.subarray(4, 8).toString("latin1") === "ftyp") return { extension: "m4a", kind: "audio" };
  if (head(4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) return { extension: "webm", kind: "audio" };
  return null;
}

function uploadsOf(draft: AdventureDraft): string[] {
  const names = new Set<string>();
  const visit = (value: unknown) => {
    if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === "object") {
      for (const [key, inner] of Object.entries(value)) {
        if (key === "upload" && typeof inner === "string") names.add(inner);
        else visit(inner);
      }
    }
  };
  visit(draft);
  return [...names];
}

function hex(bytes: number): string {
  return randomBytes(bytes).toString("hex");
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
