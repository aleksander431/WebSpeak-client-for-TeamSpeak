/*
 * Chat attachments and server-side chat history (browser-safe).
 *
 * A file is uploaded over HTTP, then shared as an ordinary TeamSpeak chat
 * message containing its link, so native TeamSpeak clients see a clickable
 * link and WebSpeak renders a preview.
 */

export const MIB = 1024 * 1024;
export const GIB = 1024 * MIB;

export interface ChatStorageSettings {
  /** Largest single upload; 0 disables uploads. */
  maxFileBytes: number;
  /** Total for files and history; oldest items are removed when it is exceeded. */
  quotaBytes: number;
  /** Keep channel and server chat on the gateway for people who join later. */
  historyEnabled: boolean;
}

export interface ChatStorageUsage {
  usedBytes: number;
  fileBytes: number;
  fileCount: number;
  messageBytes: number;
  messageCount: number;
}

export interface ChatFileInfo {
  id: string;
  name: string;
  mime: string;
  size: number;
  createdAt: number;
}

export interface ChatHistoryMessage {
  id: number;
  scope: "channel" | "server";
  channelId: string;
  senderUid: string;
  senderName: string;
  message: string;
  timestamp: number;
}

/** What a connected browser needs to upload and read history. */
export interface ChatSessionAccess {
  token: string;
  maxFileBytes: number;
  historyEnabled: boolean;
}

export const DEFAULT_CHAT_STORAGE_SETTINGS: ChatStorageSettings = { maxFileBytes: 25 * MIB, quotaBytes: 5 * GIB, historyEnabled: true };
export const CHAT_MAX_FILE_BYTES_CEILING = 4 * GIB;
export const CHAT_QUOTA_BYTES_CEILING = 16 * 1024 * GIB;
export const CHAT_FILE_ID_PATTERN = /^[0-9a-f]{32}$/;
export const CHAT_FILE_PATH_PREFIX = "/api/chat/files/";
export const CHAT_TOKEN_HEADER = "x-webspeak-chat-token";
const LINK_NAME_LIMIT = 48;

/**
 * The message text that shares an uploaded file: a BBCode link TeamSpeak
 * understands. The name travels as the link text, keeping the message well
 * under TeamSpeak's length limit; the server supplies the download name.
 */
export function chatAttachmentMessage(origin: string, file: Pick<ChatFileInfo, "id" | "name">): string {
  // Brackets would end the BBCode tag early.
  const label = shortenFileName(file.name, LINK_NAME_LIMIT).replace(/[[\]]/g, "_");
  return `[URL=${origin}${CHAT_FILE_PATH_PREFIX}${file.id}]${label}[/URL]`;
}

/** Recognise one of this gateway's attachment links; returns the file ID. */
export function parseChatAttachmentUrl(href: string, origin: string): string | null {
  let url: URL;
  try { url = new URL(href); } catch { return null; }
  if (url.origin !== origin || !url.pathname.startsWith(CHAT_FILE_PATH_PREFIX)) return null;
  const [id] = url.pathname.slice(CHAT_FILE_PATH_PREFIX.length).split("/");
  return id && CHAT_FILE_ID_PATTERN.test(id) ? id : null;
}

export type ChatMessagePart =
  | { kind: "text"; text: string }
  | { kind: "link"; href: string; text: string };

/**
 * Split a TeamSpeak chat message into text and http(s) links. Handles
 * `[URL]x[/URL]`, `[URL=x]label[/URL]` and bare links; other BBCode stays text.
 */
export function parseChatMessage(message: string): ChatMessagePart[] {
  const parts: ChatMessagePart[] = [];
  const pattern = /\[url=([^\]]+)\]([\s\S]*?)\[\/url\]|\[url\]([\s\S]*?)\[\/url\]|(https?:\/\/[^\s<>[\]"]+)/gi;
  let last = 0;
  for (const match of message.matchAll(pattern)) {
    const index = match.index ?? 0;
    const href = (match[1] ?? match[3] ?? match[4] ?? "").trim();
    const safe = safeHttpUrl(href);
    if (!safe) continue;
    if (index > last) parts.push({ kind: "text", text: message.slice(last, index) });
    parts.push({ kind: "link", href: safe, text: (match[2] ?? "").trim() || href });
    last = index + match[0].length;
  }
  if (last < message.length) parts.push({ kind: "text", text: message.slice(last) });
  return parts;
}

function safeHttpUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

function shortenFileName(name: string, limit: number): string {
  const characters = Array.from(name);
  if (characters.length <= limit) return name;
  const dot = name.lastIndexOf(".");
  const extension = dot > 0 && name.length - dot <= 10 ? name.slice(dot) : "";
  return Array.from(name.slice(0, name.length - extension.length)).slice(0, limit - Array.from(extension).length - 1).join("") + "…" + extension;
}

export function isChatImageMime(mime: string): boolean {
  return mime === "image/png" || mime === "image/jpeg" || mime === "image/gif" || mime === "image/webp";
}

/** Guess from the file name whether a link is an image, before the server is asked. */
export function looksLikeImageName(name: string): boolean {
  return /\.(png|jpe?g|gif|webp)$/i.test(name);
}

export function parseChatSessionAccess(value: unknown): ChatSessionAccess | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.token !== "string" || record.token.length < 16 || record.token.length > 128) return null;
  if (typeof record.maxFileBytes !== "number" || !Number.isFinite(record.maxFileBytes) || record.maxFileBytes < 0) return null;
  return { token: record.token, maxFileBytes: record.maxFileBytes, historyEnabled: record.historyEnabled === true };
}

export function parseChatFileInfo(value: unknown): ChatFileInfo | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== "string" || !CHAT_FILE_ID_PATTERN.test(record.id)) return null;
  if (typeof record.name !== "string" || typeof record.mime !== "string") return null;
  if (typeof record.size !== "number" || typeof record.createdAt !== "number") return null;
  return { id: record.id, name: record.name, mime: record.mime, size: record.size, createdAt: record.createdAt };
}

export function parseChatHistory(value: unknown): ChatHistoryMessage[] | null {
  if (!value || typeof value !== "object" || !Array.isArray((value as { messages?: unknown }).messages)) return null;
  const messages: ChatHistoryMessage[] = [];
  for (const item of (value as { messages: unknown[] }).messages) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    if (typeof record.id !== "number" || (record.scope !== "channel" && record.scope !== "server")) continue;
    if (typeof record.message !== "string" || typeof record.timestamp !== "number") continue;
    messages.push({
      id: record.id, scope: record.scope, channelId: typeof record.channelId === "string" ? record.channelId : "",
      senderUid: typeof record.senderUid === "string" ? record.senderUid : "",
      senderName: typeof record.senderName === "string" ? record.senderName : "", message: record.message, timestamp: record.timestamp,
    });
  }
  return messages;
}

export function formatBytes(bytes: number, units: readonly string[] = ["B", "KB", "MB", "GB", "TB"]): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  return `${unit === 0 ? value : value.toFixed(value >= 100 ? 0 : 1)} ${units[unit]}`;
}
