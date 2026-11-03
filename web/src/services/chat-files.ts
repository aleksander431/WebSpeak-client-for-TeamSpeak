import {
  CHAT_TOKEN_HEADER, parseChatFileInfo, parseChatHistory,
  type ChatFileInfo, type ChatHistoryMessage, type ChatSessionAccess,
} from "../../../src/shared/chat-storage.js";
import { parseChatPins, type ChatPin } from "../../../src/shared/chat-pins.js";

export class ChatFileError extends Error {
  constructor(readonly code: string, readonly maxFileBytes?: number) {
    super(code);
    this.name = "ChatFileError";
  }
}

/** Upload one file for the current session, reporting progress from 0 to 1. */
export function uploadChatFile(
  file: Blob,
  name: string,
  access: ChatSessionAccess,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<ChatFileInfo> {
  if (access.maxFileBytes <= 0) return Promise.reject(new ChatFileError("CHAT_UPLOADS_DISABLED"));
  if (file.size > access.maxFileBytes) return Promise.reject(new ChatFileError("FILE_TOO_LARGE", access.maxFileBytes));
  if (file.size === 0) return Promise.reject(new ChatFileError("FILE_EMPTY"));
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    const abort = () => request.abort();
    signal?.addEventListener("abort", abort, { once: true });
    const done = () => signal?.removeEventListener("abort", abort);
    request.open("POST", "/api/chat/files");
    request.setRequestHeader("content-type", "application/octet-stream");
    request.setRequestHeader(CHAT_TOKEN_HEADER, access.token);
    request.setRequestHeader("x-webspeak-file-name", encodeURIComponent(name));
    request.responseType = "text";
    request.upload.onprogress = event => { if (event.lengthComputable && event.total > 0) onProgress(Math.min(1, event.loaded / event.total)); };
    request.onload = () => {
      done();
      let body: { file?: unknown; code?: unknown; maxFileBytes?: unknown } = {};
      try { body = JSON.parse(request.responseText) as typeof body; } catch { /* keep empty */ }
      if (request.status === 201) {
        const info = parseChatFileInfo(body.file);
        if (info) { onProgress(1); resolve(info); return; }
        reject(new ChatFileError("UPLOAD_FAILED"));
        return;
      }
      // A reverse proxy rejects an oversized body itself, without our JSON.
      const code = typeof body.code === "string" ? body.code : request.status === 413 ? "FILE_TOO_LARGE" : "UPLOAD_FAILED";
      reject(new ChatFileError(code, typeof body.maxFileBytes === "number" ? body.maxFileBytes : undefined));
    };
    request.onerror = () => { done(); reject(new ChatFileError("UPLOAD_FAILED")); };
    request.onabort = () => { done(); reject(new ChatFileError("UPLOAD_CANCELLED")); };
    request.send(file);
  });
}

export async function fetchChatHistory(access: ChatSessionAccess, scope: "channel" | "server", signal?: AbortSignal, query = ""): Promise<ChatHistoryMessage[]> {
  const response = await fetch(`/api/chat/history?scope=${scope}${query ? `&q=${encodeURIComponent(query.slice(0, 100))}` : ""}`, { headers: { [CHAT_TOKEN_HEADER]: access.token }, cache: "no-store", ...(signal ? { signal } : {}) });
  if (!response.ok) return [];
  return parseChatHistory(await response.json().catch(() => null)) ?? [];
}

/** Pins of the session's server chat or current channel, with the channel they belong to. */
export async function fetchChatPins(access: ChatSessionAccess, scope: "channel" | "server", signal?: AbortSignal): Promise<{ key: string; pins: ChatPin[] } | null> {
  const response = await fetch(`/api/chat/pins?scope=${scope}`, { headers: { [CHAT_TOKEN_HEADER]: access.token }, cache: "no-store", ...(signal ? { signal } : {}) });
  if (!response.ok) return null;
  const body = await response.json().catch(() => null) as { channelId?: unknown; pins?: unknown } | null;
  const pins = parseChatPins(body?.pins);
  if (!pins) return null;
  const channelId = typeof body?.channelId === "string" && /^\d{0,20}$/.test(body.channelId) ? body.channelId : "";
  return { key: scope === "server" ? "server:" : `channel:${channelId}`, pins };
}

/** A name for a pasted image, which arrives without one. */
export function pastedFileName(file: File, now = new Date()): string {
  if (file.name && file.name !== "image.png") return file.name;
  const pad = (value: number) => String(value).padStart(2, "0");
  const extension = file.type === "image/jpeg" ? "jpg" : file.type === "image/gif" ? "gif" : file.type === "image/webp" ? "webp" : "png";
  return `screenshot-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.${extension}`;
}
