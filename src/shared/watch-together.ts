/*
 * Watching a video together in a channel: one shared player state per
 * channel, kept by the gateway; every browser plays the video itself (YouTube
 * embed or a direct video file) and follows that state. Browser-safe.
 */

export type WatchMedia =
  | { kind: "youtube"; id: string; url: string }
  | { kind: "file"; url: string };

export interface WatchRoomView {
  media: WatchMedia;
  /** Set by the first browser that loaded the video. */
  title: string;
  /** Seconds; 0 while unknown. */
  duration: number;
  startedBy: string;
  playing: boolean;
  /** Seconds into the video at the moment this view was sent. */
  position: number;
  /** Who did the last thing and when (gateway ms), for "Саша paused" lines. */
  last: { by: string; action: WatchAction; at: number };
  /** Nicknames of those who have the player open. */
  viewers: string[];
  /** Changes with every new video, so a late answer for an old one is ignored. */
  id: string;
  /** What plays next, in order. */
  queue: WatchQueueItem[];
  /** The video came from the queue, so those watching keep watching. */
  continued: boolean;
}

export interface WatchQueueItem {
  key: string;
  media: WatchMedia;
  addedBy: string;
  /** Seconds to start at (a YouTube `t=`). */
  start: number;
}

export const WATCH_QUEUE_MAX = 30;

export type WatchAction = "start" | "play" | "pause" | "seek";

export type WatchClientMessage =
  | { type: "watchOpen" }
  | { type: "watchClose" }
  | { type: "watchStart"; url: string; position?: number }
  | { type: "watchControl"; id: string; action: "play" | "pause" | "seek"; position: number }
  | { type: "watchMeta"; id: string; title: string; duration: number }
  | { type: "watchView"; watching: boolean }
  | { type: "watchStop" }
  | { type: "watchQueue"; url: string }
  | { type: "watchQueueRemove"; key: string }
  | { type: "watchNext"; id: string }
  | { type: "watchEnded"; id: string };

export type WatchServerMessage =
  | { type: "watchState"; room: WatchRoomView | null }
  | { type: "watchError"; code: string };

export const WATCH_URL_MAX_LENGTH = 2000;
export const WATCH_TITLE_MAX_LENGTH = 200;
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const VIDEO_FILE = /\.(mp4|m4v|webm|ogv|ogg|mov)$/i;

/** Seconds from a YouTube `t`/`start` value: `90`, `90s`, `1m30s`, `1h2m3s`. */
function youtubeStart(value: string | null): number {
  if (!value) return 0;
  if (/^\d+$/.test(value)) return Number(value);
  const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(value);
  if (!match || !value) return 0;
  return Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
}

/**
 * What a pasted link plays: a YouTube video (any of its usual link forms,
 * with its start time), a direct video file over http(s), or a video sent as a
 * WebSpeak chat attachment (`/api/chat/files/…`).
 */
export function parseWatchUrl(raw: string): { media: WatchMedia; start: number } | null {
  const text = raw.trim();
  if (!text || text.length > WATCH_URL_MAX_LENGTH) return null;
  let url: URL;
  try { url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`); } catch { return null; }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password) return null;
  const host = url.hostname.toLowerCase().replace(/^(www\.|m\.|music\.)/, "");
  let id: string | null = null;
  if (host === "youtu.be") id = url.pathname.slice(1).split("/")[0] ?? null;
  else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    if (url.pathname === "/watch") id = url.searchParams.get("v");
    else {
      const match = /^\/(?:embed|shorts|live|v)\/([^/?#]+)/.exec(url.pathname);
      id = match?.[1] ?? null;
    }
  }
  if (id !== null) {
    if (!YOUTUBE_ID.test(id)) return null;
    const start = youtubeStart(url.searchParams.get("t") ?? url.searchParams.get("start"));
    return { media: { kind: "youtube", id, url: `https://www.youtube.com/watch?v=${id}` }, start };
  }
  // A video sent as a WebSpeak chat attachment has no extension in its link.
  if (/^\/api\/chat\/files\/[0-9a-f]{32}$/.test(url.pathname)) return { media: { kind: "file", url: url.href }, start: 0 };
  if (VIDEO_FILE.test(url.pathname)) return { media: { kind: "file", url: url.href }, start: 0 };
  return null;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const position = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) && value >= 0 && value < 86_400 * 7 ? value : null;
const shortId = (value: unknown): string | null => typeof value === "string" && /^[A-Za-z0-9_-]{1,32}$/.test(value) ? value : null;

/** A decoded frame as a watch message, an error for a malformed watch frame, or null for any other frame. */
export function parseWatchClientMessage(value: unknown): WatchClientMessage | { error: { code: string } } | null {
  if (!isRecord(value) || typeof value.type !== "string" || !value.type.startsWith("watch")) return null;
  const invalid = { error: { code: "INVALID_WATCH_MESSAGE" } };
  switch (value.type) {
    case "watchOpen": return { type: "watchOpen" };
    case "watchClose": return { type: "watchClose" };
    case "watchStop": return { type: "watchStop" };
    case "watchQueue":
      return typeof value.url === "string" && value.url.length <= WATCH_URL_MAX_LENGTH ? { type: "watchQueue", url: value.url } : invalid;
    case "watchQueueRemove": {
      const key = shortId(value.key);
      return key ? { type: "watchQueueRemove", key } : invalid;
    }
    case "watchNext":
    case "watchEnded": {
      const id = shortId(value.id);
      return id ? { type: value.type, id } : invalid;
    }
    case "watchStart": {
      if (typeof value.url !== "string" || value.url.length > WATCH_URL_MAX_LENGTH) return invalid;
      const start = value.position === undefined ? undefined : position(value.position);
      if (start === null) return invalid;
      return { type: "watchStart", url: value.url, ...(start === undefined ? {} : { position: start }) };
    }
    case "watchControl": {
      const id = shortId(value.id);
      const at = position(value.position);
      if (!id || at === null || (value.action !== "play" && value.action !== "pause" && value.action !== "seek")) return invalid;
      return { type: "watchControl", id, action: value.action, position: at };
    }
    case "watchMeta": {
      const id = shortId(value.id);
      const duration = position(value.duration);
      if (!id || typeof value.title !== "string" || duration === null) return invalid;
      return { type: "watchMeta", id, title: value.title.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, WATCH_TITLE_MAX_LENGTH), duration };
    }
    case "watchView":
      return typeof value.watching === "boolean" ? { type: "watchView", watching: value.watching } : invalid;
    default:
      return invalid;
  }
}

/** Where the shared clock says the video is, `elapsedMs` after a view was received. */
export function watchPositionAfter(room: Pick<WatchRoomView, "playing" | "position" | "duration">, elapsedMs: number): number {
  const at = room.playing ? room.position + Math.max(0, elapsedMs) / 1000 : room.position;
  return room.duration > 0 ? Math.min(at, room.duration) : at;
}

function parseMedia(value: unknown): WatchMedia | null {
  if (!isRecord(value) || typeof value.url !== "string") return null;
  if (value.kind === "youtube" && typeof value.id === "string" && YOUTUBE_ID.test(value.id)) return { kind: "youtube", id: value.id, url: value.url };
  if (value.kind === "file" && /^https?:\/\//i.test(value.url)) return { kind: "file", url: value.url };
  return null;
}

/** The browser's check of what the gateway sends. */
export function parseWatchServerMessage(value: unknown): WatchServerMessage | null {
  if (!isRecord(value)) return null;
  if (value.type === "watchError") return typeof value.code === "string" ? { type: "watchError", code: value.code } : null;
  if (value.type !== "watchState") return null;
  if (value.room === null) return { type: "watchState", room: null };
  const room = value.room;
  if (!isRecord(room)) return null;
  const media = parseMedia(room.media);
  const last = isRecord(room.last) ? room.last : null;
  if (!media || typeof room.id !== "string" || typeof room.title !== "string" || typeof room.startedBy !== "string" || typeof room.playing !== "boolean"
    || typeof room.position !== "number" || typeof room.duration !== "number" || !last || typeof last.by !== "string"
    || !["start", "play", "pause", "seek"].includes(String(last.action)) || typeof last.at !== "number" || !Array.isArray(room.viewers)) return null;
  const queue: WatchQueueItem[] = [];
  for (const item of Array.isArray(room.queue) ? room.queue.slice(0, WATCH_QUEUE_MAX) : []) {
    if (!isRecord(item) || typeof item.key !== "string" || typeof item.addedBy !== "string") continue;
    const queued = parseMedia(item.media);
    if (queued) queue.push({ key: item.key, media: queued, addedBy: item.addedBy, start: typeof item.start === "number" ? item.start : 0 });
  }
  return {
    type: "watchState",
    room: {
      id: room.id, media, title: room.title, duration: room.duration, startedBy: room.startedBy, playing: room.playing, position: room.position,
      last: { by: last.by, action: last.action as WatchAction, at: last.at }, viewers: room.viewers.filter((name): name is string => typeof name === "string"),
      queue, continued: room.continued === true,
    },
  };
}

/** The first link in a chat message that can be watched together, or null. */
export function watchableLink(message: string): string | null {
  for (const match of message.matchAll(/\[URL=([^\]]+)\]([^[]*)\[\/URL\]|https?:\/\/[^\s<>"\[\]]+/gi)) {
    const url = (match[1] ?? match[0]).replace(/[),.!?;:]+$/, "");
    const parsed = parseWatchUrl(url);
    if (!parsed) continue;
    // A chat attachment counts only when its name says it is a video, not a picture or a document.
    if (/\/api\/chat\/files\//.test(url) && !VIDEO_FILE.test((match[2] ?? "").trim())) continue;
    return url;
  }
  return null;
}
