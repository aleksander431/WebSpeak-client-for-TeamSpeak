import { createWriteStream } from "node:fs";
import { mkdir, readdir, rename, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import type { WebSpeakDatabase } from "../persistence/database.js";
import type { ServerEvent } from "../shared/voice-models.js";
import {
  CHAT_FILE_ID_PATTERN, CHAT_MAX_FILE_BYTES_CEILING, CHAT_QUOTA_BYTES_CEILING, DEFAULT_CHAT_STORAGE_SETTINGS,
  type ChatFileInfo, type ChatHistoryMessage, type ChatStorageSettings, type ChatStorageUsage,
} from "../shared/chat-storage.js";

const META_MAX_FILE = "chat_max_file_bytes";
const META_QUOTA = "chat_quota_bytes";
const META_HISTORY = "chat_history_enabled";
/** One user's identical message seen by several gateway sessions is stored once. */
const DUPLICATE_WINDOW_MS = 10_000;
const HISTORY_PAGE_LIMIT = 100;
const SEARCH_RESULT_LIMIT = 50;
const SEARCH_SCAN_LIMIT = 50_000;
/** Fixed bookkeeping cost per stored message, so empty messages still count. */
const MESSAGE_OVERHEAD_BYTES = 64;
/** Server events kept per TeamSpeak server, and how many a session gets on joining. */
export const EVENT_HISTORY_KEEP = 1000;
export const EVENT_HISTORY_PAGE = 200;
/** Events that describe the server itself (not a session's own connection or pokes). */
export const SHARED_EVENT_KINDS: ReadonlySet<string> = new Set(["joined", "left", "moved"]);

export class ChatStorageError extends Error {
  constructor(readonly code: "CHAT_UPLOADS_DISABLED" | "FILE_TOO_LARGE" | "FILE_EMPTY" | "UPLOAD_FAILED" | "INVALID_CHAT_STORAGE_SETTINGS", message: string = code) {
    super(message);
    this.name = "ChatStorageError";
  }
}

export interface ChatMessageRecord {
  targetKey: string;
  scope: "channel" | "server";
  channelId: string;
  senderUid: string;
  senderName: string;
  message: string;
  timestamp?: number;
  /** The gateway's reaction reference, stored so reactions outlive a restart. */
  ref?: string;
}

/**
 * Chat attachments and server-side chat history under one administrator quota.
 * When a new item does not fit, the oldest items (files or messages) are
 * removed until it does. File bytes live in `directory`, metadata in SQLite.
 */
export class ChatStorage {
  private usage: { fileBytes: number; fileCount: number; messageBytes: number; messageCount: number } | null = null;
  private readonly recent = new Map<string, number>();
  private eventInserts = 0;
  /** Finalising uploads and rotation run one at a time. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    readonly database: WebSpeakDatabase,
    readonly directory: string,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** Create the directory and drop files that lost their database row (or rows that lost their file). */
  async initialize(): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    const known = new Set(this.database.listChatFileIds());
    for (const name of await readdir(this.directory)) {
      if (name.startsWith(".upload-") || (CHAT_FILE_ID_PATTERN.test(name) && !known.has(name))) {
        await unlink(path.join(this.directory, name)).catch(() => undefined);
      }
    }
    for (const id of known) {
      const exists = await stat(this.filePath(id)).then(() => true, () => false);
      if (!exists) this.database.deleteChatFile(id);
    }
    this.usage = null;
    this.database.deleteOrphanChatReactions();
    await this.serialize(() => this.enforceQuota(0));
  }

  /** The stored message a reaction reference belongs to (only while history keeps it). */
  messageByRef(ref: string): (ChatHistoryMessage & { targetKey: string }) | null {
    const row = this.database.findChatHistoryByRef(ref);
    if (!row || (row.scope !== "channel" && row.scope !== "server")) return null;
    return { id: row.id, targetKey: row.targetKey, scope: row.scope, channelId: row.channelId, senderUid: row.senderUid,
      senderName: row.senderName, message: row.message, timestamp: row.createdAt, ref: row.ref };
  }

  /** Saved reactions of a stored message. */
  reactions(ref: string): { emoji: string; userKey: string; userName: string }[] {
    return this.database.listChatReactions(ref);
  }

  /** Keep a reaction while its message is in history; reactions to unsaved messages stay in memory only. */
  saveReaction(ref: string, emoji: string, userKey: string, userName: string, active: boolean): void {
    if (!this.settings().historyEnabled) return;
    void this.serialize(async () => {
      if (!this.database.findChatHistoryByRef(ref)) return;
      this.database.setChatReaction(ref, emoji, userKey.slice(0, 160), userName.slice(0, 64), active, this.now());
    }).catch(() => undefined);
  }

  settings(): ChatStorageSettings {
    const read = (key: string, fallback: number) => {
      const value = Number(this.database.getMeta(key));
      return Number.isFinite(value) && value >= 0 && this.database.getMeta(key) !== null ? value : fallback;
    };
    const history = this.database.getMeta(META_HISTORY);
    return {
      maxFileBytes: read(META_MAX_FILE, DEFAULT_CHAT_STORAGE_SETTINGS.maxFileBytes),
      quotaBytes: read(META_QUOTA, DEFAULT_CHAT_STORAGE_SETTINGS.quotaBytes),
      historyEnabled: history === null ? DEFAULT_CHAT_STORAGE_SETTINGS.historyEnabled : history === "1",
    };
  }

  async updateSettings(input: ChatStorageSettings): Promise<ChatStorageSettings> {
    const valid = (value: unknown, ceiling: number) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= ceiling;
    if (!valid(input.maxFileBytes, CHAT_MAX_FILE_BYTES_CEILING) || !valid(input.quotaBytes, CHAT_QUOTA_BYTES_CEILING) || typeof input.historyEnabled !== "boolean") {
      throw new ChatStorageError("INVALID_CHAT_STORAGE_SETTINGS");
    }
    this.database.setMeta(META_MAX_FILE, String(input.maxFileBytes));
    this.database.setMeta(META_QUOTA, String(input.quotaBytes));
    this.database.setMeta(META_HISTORY, input.historyEnabled ? "1" : "0");
    this.database.addAudit("CHAT_STORAGE_SETTINGS_CHANGED");
    // A smaller quota takes effect immediately.
    await this.serialize(() => this.enforceQuota(0));
    return this.settings();
  }

  currentUsage(): ChatStorageUsage {
    const usage = this.counters();
    return { ...usage, usedBytes: usage.fileBytes + usage.messageBytes };
  }

  /** Effective per-file limit: the admin limit, never more than the whole quota. */
  uploadLimit(): number {
    const settings = this.settings();
    return Math.min(settings.maxFileBytes, settings.quotaBytes);
  }

  /**
   * Stream an upload to disk. Rejects as soon as it passes the size limit, so
   * a large body never has to be buffered or fully received.
   */
  async storeUpload(body: AsyncIterable<Buffer | Uint8Array>, declaredName: string, targetKey: string): Promise<ChatFileInfo> {
    const limit = this.uploadLimit();
    if (limit <= 0) throw new ChatStorageError("CHAT_UPLOADS_DISABLED");
    await mkdir(this.directory, { recursive: true });
    const temporary = path.join(this.directory, `.upload-${randomBytes(12).toString("hex")}`);
    const output = createWriteStream(temporary, { flags: "wx" });
    let size = 0;
    let head = Buffer.alloc(0);
    try {
      for await (const chunk of body) {
        const bytes = Buffer.from(chunk);
        size += bytes.length;
        if (size > limit) throw new ChatStorageError("FILE_TOO_LARGE");
        if (head.length < 16) head = Buffer.concat([head, bytes.subarray(0, 16 - head.length)]);
        if (!output.write(bytes)) await new Promise<void>((resolve, reject) => {
          output.once("drain", resolve);
          output.once("error", reject);
        });
      }
      await new Promise<void>((resolve, reject) => output.end((error?: Error | null) => error ? reject(error) : resolve()));
    } catch (error) {
      // The file may still be opening; wait so the unlink cannot run first.
      if (!output.closed) await new Promise<void>(resolve => { output.once("close", () => resolve()); output.destroy(); });
      await unlink(temporary).catch(() => undefined);
      if (error instanceof ChatStorageError) throw error;
      throw new ChatStorageError("UPLOAD_FAILED", error instanceof Error ? error.message : String(error));
    }
    if (size === 0) {
      await unlink(temporary).catch(() => undefined);
      throw new ChatStorageError("FILE_EMPTY");
    }
    const id = randomBytes(16).toString("hex");
    const record: ChatFileInfo = { id, name: sanitizeFileName(declaredName), mime: sniffImageType(head) ?? "application/octet-stream", size, createdAt: this.now() };
    try {
      await this.serialize(async () => {
        await this.enforceQuota(size);
        await rename(temporary, this.filePath(id));
        this.database.insertChatFile({ ...record, targetKey });
        const usage = this.counters();
        usage.fileBytes += size;
        usage.fileCount += 1;
      });
    } catch (error) {
      await unlink(temporary).catch(() => undefined);
      throw error;
    }
    return record;
  }

  file(id: string): { info: ChatFileInfo; path: string } | null {
    if (!CHAT_FILE_ID_PATTERN.test(id)) return null;
    const row = this.database.getChatFile(id);
    if (!row) return null;
    return { info: { id: row.id, name: row.name, mime: row.mime, size: row.size, createdAt: row.createdAt }, path: this.filePath(id) };
  }

  /** Keep a channel/server message, once even when several gateway sessions saw it. */
  recordMessage(record: ChatMessageRecord): void {
    if (!this.settings().historyEnabled) return;
    const message = record.message.slice(0, 2048);
    if (!message.trim()) return;
    const now = record.timestamp ?? this.now();
    const key = JSON.stringify([record.targetKey, record.scope, record.channelId, record.senderName, message]);
    const seen = this.recent.get(key);
    if (seen !== undefined && now - seen < DUPLICATE_WINDOW_MS) return;
    this.recent.set(key, now);
    if (this.recent.size > 2000) {
      for (const [candidate, at] of this.recent) if (now - at >= DUPLICATE_WINDOW_MS) this.recent.delete(candidate);
    }
    const senderName = record.senderName.slice(0, 64);
    const size = Buffer.byteLength(message) + Buffer.byteLength(senderName) + MESSAGE_OVERHEAD_BYTES;
    void this.serialize(async () => {
      if (size > this.settings().quotaBytes) return;
      await this.enforceQuota(size);
      this.database.insertChatHistory({ targetKey: record.targetKey, scope: record.scope, channelId: record.channelId,
        senderUid: record.senderUid.slice(0, 64), senderName, message, size, createdAt: now, ref: record.ref ?? "" });
      const usage = this.counters();
      usage.messageBytes += size;
      usage.messageCount += 1;
    }).catch(() => undefined);
  }

  /**
   * Keep a server-wide event (someone joined, left, moved; a channel changed),
   * once even when several gateway sessions saw it. Follows the history switch.
   */
  recordEvent(targetKey: string, event: ServerEvent): void {
    if (!this.settings().historyEnabled || !SHARED_EVENT_KINDS.has(event.kind)) return;
    const now = event.timestamp || this.now();
    const params = JSON.stringify(event.params ?? {});
    const key = JSON.stringify(["event", targetKey, event.kind, event.code ?? "", params, event.code ? "" : event.message]);
    const seen = this.recent.get(key);
    if (seen !== undefined && now - seen < DUPLICATE_WINDOW_MS) return;
    this.recent.set(key, now);
    void this.serialize(async () => {
      this.database.insertEventHistory({ targetKey, kind: event.kind.slice(0, 32), code: (event.code ?? "").slice(0, 64), paramsJson: params.slice(0, 1024), message: event.message.slice(0, 512), createdAt: now });
      this.eventInserts = (this.eventInserts + 1) % 50;
      if (this.eventInserts === 0) this.database.pruneEventHistory(targetKey, EVENT_HISTORY_KEEP);
    }).catch(() => undefined);
  }

  /** The newest stored server events, oldest first, for a session's event log. */
  eventHistory(targetKey: string, limit = EVENT_HISTORY_PAGE): ServerEvent[] {
    if (!this.settings().historyEnabled) return [];
    return this.database.listEventHistory(targetKey, Math.min(limit, EVENT_HISTORY_KEEP)).reverse().map(row => {
      let params: Record<string, string> = {};
      try {
        const parsed = JSON.parse(row.paramsJson) as unknown;
        if (parsed && typeof parsed === "object") params = Object.fromEntries(Object.entries(parsed).filter(([, value]) => typeof value === "string")) as Record<string, string>;
      } catch { /* an unreadable row keeps its stored text */ }
      return { id: `stored-${row.id}`, kind: row.kind, message: row.message, timestamp: row.createdAt, ...(row.code ? { code: row.code, params } : {}) };
    });
  }

  /** Wait for queued history writes (tests and shutdown). */
  async flush(): Promise<void> {
    await this.queue.catch(() => undefined);
  }

  history(targetKey: string, scope: "channel" | "server", channelId: string, before?: number): ChatHistoryMessage[] {
    if (!this.settings().historyEnabled) return [];
    return this.database.listChatHistory(targetKey, scope, channelId, HISTORY_PAGE_LIMIT, before).reverse().map(row => ({
      id: row.id, scope, channelId: row.channelId, senderUid: row.senderUid, senderName: row.senderName, message: row.message, timestamp: row.createdAt,
      ...(row.ref ? { ref: row.ref } : {}),
    }));
  }

  /** Messages of one conversation containing `query` (case-insensitive), newest first. */
  search(targetKey: string, scope: "channel" | "server", channelId: string, query: string): ChatHistoryMessage[] {
    if (!this.settings().historyEnabled) return [];
    const needle = query.trim().toLocaleLowerCase().slice(0, 100);
    if (!needle) return [];
    return this.database.searchChatHistory(targetKey, scope, channelId,
      row => row.message.toLocaleLowerCase().includes(needle) || row.senderName.toLocaleLowerCase().includes(needle),
      SEARCH_RESULT_LIMIT, SEARCH_SCAN_LIMIT).map(row => ({
      id: row.id, scope, channelId: row.channelId, senderUid: row.senderUid, senderName: row.senderName, message: row.message, timestamp: row.createdAt,
      ...(row.ref ? { ref: row.ref } : {}),
    }));
  }

  async clear(): Promise<void> {
    await this.serialize(async () => {
      const ids = this.database.listChatFileIds();
      this.database.clearChatStorage();
      for (const id of ids) await unlink(this.filePath(id)).catch(() => undefined);
      this.usage = null;
      this.recent.clear();
      this.database.addAudit("CHAT_STORAGE_CLEARED");
    });
  }

  private filePath(id: string): string {
    return path.join(this.directory, id);
  }

  private counters() {
    this.usage ??= this.database.chatStorageUsage();
    return this.usage;
  }

  private serialize<T>(run: () => Promise<T>): Promise<T> {
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }

  /** Remove the oldest files and messages until `incoming` more bytes fit. */
  private async enforceQuota(incoming: number): Promise<void> {
    const quota = this.settings().quotaBytes;
    const usage = this.counters();
    while (usage.fileBytes + usage.messageBytes + incoming > quota) {
      const file = this.database.oldestChatFile();
      const message = this.database.oldestChatHistory();
      if (!file && !message) break;
      if (file && (!message || file.createdAt <= message.createdAt)) {
        this.database.deleteChatFile(file.id);
        await unlink(this.filePath(file.id)).catch(() => undefined);
        usage.fileBytes -= file.size;
        usage.fileCount -= 1;
      } else if (message) {
        this.database.deleteChatHistory(message.id);
        usage.messageBytes -= message.size;
        usage.messageCount -= 1;
      }
    }
  }
}

/** Raster formats browsers display safely; everything else is served as a download. */
export function sniffImageType(head: Buffer): string | null {
  if (head.length >= 8 && head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "image/jpeg";
  if (head.length >= 6 && (head.subarray(0, 6).toString("latin1") === "GIF87a" || head.subarray(0, 6).toString("latin1") === "GIF89a")) return "image/gif";
  if (head.length >= 12 && head.subarray(0, 4).toString("latin1") === "RIFF" && head.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  return null;
}

export function sanitizeFileName(value: string): string {
  // eslint-disable-next-line no-control-regex
  const base = value.replace(/[\u0000-\u001f\u007f]/g, "").split(/[\\/]/).pop()!.trim().replace(/^\.+/, "");
  const limited = Array.from(base).slice(0, 120).join("");
  return limited || "file";
}
