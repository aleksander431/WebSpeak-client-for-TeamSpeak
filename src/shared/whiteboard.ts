/**
 * Shared whiteboard: model, limits and wire protocol used by both the
 * gateway and the browser.
 *
 * Every TeamSpeak channel has one board made of sheets. Elements are whole
 * objects (a stroke, a shape, a text, an image) and the gateway applies
 * changes in arrival order and echoes each one to everyone on the sheet,
 * including the sender, so all clients converge on the gateway's order.
 * Previews (a stroke being drawn, shapes being dragged) and cursors are
 * relayed live but never stored.
 */

export const WHITEBOARD_ELEMENT_TYPES = ["pen", "line", "arrow", "rect", "ellipse", "text", "image"] as const;
export type WhiteboardElementType = typeof WHITEBOARD_ELEMENT_TYPES[number];

export interface WhiteboardElement {
  id: string;
  type: WhiteboardElementType;
  /** Origin. For line/arrow the start point; (x + w, y + h) is the end. */
  x: number;
  y: number;
  /** Size. Rect, ellipse, image and text keep it positive; line/arrow may be negative. */
  w: number;
  h: number;
  /** Stacking order; higher draws on top. */
  z: number;
  stroke: string;
  /** Fill for rect/ellipse; null means none. */
  fill?: string | null;
  strokeWidth: number;
  /** Pen only: flat [x0, y0, x1, y1, ...] relative to (x, y). */
  points?: number[];
  /** Text only. */
  text?: string;
  fontSize?: number;
  /** Image only: a data: URL. */
  src?: string;
  /** Set by the gateway: nickname of the last editor. */
  author?: string;
}

export interface WhiteboardSheet {
  id: string;
  /** Empty means "Sheet N" in the viewer's language. */
  name: string;
  createdAt: number;
}

export interface WhiteboardPeer {
  peerId: string;
  nickname: string;
  color: string;
}

export const WHITEBOARD_LIMITS = Object.freeze({
  maxElementsPerSheet: 5_000,
  /** Serialized size of a sheet, images included. */
  maxSheetBytes: 30 * 1024 * 1024,
  maxSheetsPerBoard: 50,
  maxElementsPerMessage: 200,
  maxPreviewElements: 50,
  maxPenPoints: 6_000,
  maxTextLength: 4_000,
  /** A pasted image is downscaled and re-encoded in the browser to stay under this. */
  maxImageSrcLength: 2_200_000,
  maxSheetNameLength: 40,
  coordinateLimit: 1_000_000,
});

const ID_PATTERN = /^[A-Za-z0-9_-]{1,40}$/;
const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
const IMAGE_PATTERN = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/;

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const coordinate = (value: unknown): value is number => finite(value) && Math.abs(value) <= WHITEBOARD_LIMITS.coordinateLimit;

export function isWhiteboardId(value: unknown): value is string {
  return typeof value === "string" && ID_PATTERN.test(value);
}

/** Validate and copy an element; unknown fields are dropped. */
export function parseWhiteboardElement(value: unknown): WhiteboardElement | null {
  if (!isRecord(value)) return null;
  const { id, type, x, y, w, h, z, stroke, fill, strokeWidth } = value;
  if (!isWhiteboardId(id) || !WHITEBOARD_ELEMENT_TYPES.includes(type as WhiteboardElementType)) return null;
  if (!coordinate(x) || !coordinate(y) || !coordinate(w) || !coordinate(h) || !finite(z) || Math.abs(z) > 1e12) return null;
  if (typeof stroke !== "string" || !COLOR_PATTERN.test(stroke)) return null;
  if (!finite(strokeWidth) || strokeWidth < 0.5 || strokeWidth > 64) return null;
  const element: WhiteboardElement = { id, type: type as WhiteboardElementType, x, y, w, h, z, stroke: stroke.toLowerCase(), strokeWidth };
  if (fill !== undefined && fill !== null) {
    if (typeof fill !== "string" || !COLOR_PATTERN.test(fill)) return null;
    element.fill = fill.toLowerCase();
  } else if (fill === null) element.fill = null;
  if (element.type === "pen") {
    const points = value.points;
    if (!Array.isArray(points) || points.length < 2 || points.length % 2 !== 0 || points.length > WHITEBOARD_LIMITS.maxPenPoints || !points.every(coordinate)) return null;
    element.points = points.map((point) => Math.round(point * 10) / 10);
  }
  if (element.type === "text") {
    const { text, fontSize } = value;
    if (typeof text !== "string" || !text.trim() || text.length > WHITEBOARD_LIMITS.maxTextLength) return null;
    if (!finite(fontSize) || fontSize < 6 || fontSize > 400) return null;
    element.text = text;
    element.fontSize = fontSize;
  }
  if (element.type === "image") {
    const { src } = value;
    if (typeof src !== "string" || src.length > WHITEBOARD_LIMITS.maxImageSrcLength || !IMAGE_PATTERN.test(src)) return null;
    element.src = src;
  }
  if ((element.type === "rect" || element.type === "ellipse" || element.type === "image" || element.type === "text") && (element.w < 0 || element.h < 0)) return null;
  if (typeof value.author === "string" && value.author.length <= 64) element.author = value.author;
  return element;
}

export function parseWhiteboardSheet(value: unknown): WhiteboardSheet | null {
  if (!isRecord(value) || !isWhiteboardId(value.id) || typeof value.name !== "string" || value.name.length > WHITEBOARD_LIMITS.maxSheetNameLength || !finite(value.createdAt)) return null;
  return { id: value.id, name: value.name, createdAt: value.createdAt };
}

export function cleanSheetName(value: unknown): string {
  return typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, WHITEBOARD_LIMITS.maxSheetNameLength) : "";
}

/** Approximate stored size, used for the per-sheet budget. */
export function whiteboardElementBytes(element: WhiteboardElement): number {
  return JSON.stringify(element).length;
}

// ---------------------------------------------------------------------------
// Client -> gateway

export type WhiteboardClientMessage =
  | { type: "whiteboardOpen"; sheetId?: string }
  | { type: "whiteboardClose" }
  | { type: "whiteboardSelectSheet"; sheetId: string }
  | { type: "whiteboardCreateSheet"; name: string }
  | { type: "whiteboardRenameSheet"; sheetId: string; name: string }
  | { type: "whiteboardDeleteSheet"; sheetId: string }
  | { type: "whiteboardUpsert"; sheetId: string; elements: WhiteboardElement[] }
  | { type: "whiteboardDelete"; sheetId: string; ids: string[] }
  | { type: "whiteboardClear"; sheetId: string }
  | { type: "whiteboardPreview"; sheetId: string; elements: WhiteboardElement[] }
  | { type: "whiteboardCursor"; sheetId: string; x: number | null; y: number | null };

export type WhiteboardParseResult = WhiteboardClientMessage | { error: { code: string; message: string } } | null;

/** Parse a raw WebSocket text frame; null when it is not a whiteboard message. */
export function parseWhiteboardClientMessage(raw: string): WhiteboardParseResult {
  // Cheap pre-check so voice and screen-share frames are not parsed twice.
  if (!raw.includes("\"whiteboard")) return null;
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return null; }
  if (!isRecord(value) || typeof value.type !== "string" || !value.type.startsWith("whiteboard")) return null;
  const invalid = { error: { code: "INVALID_WHITEBOARD_MESSAGE", message: "Invalid whiteboard message" } };
  const sheetId = value.sheetId;
  switch (value.type) {
    case "whiteboardOpen":
      if (sheetId !== undefined && !isWhiteboardId(sheetId)) return invalid;
      return sheetId === undefined ? { type: "whiteboardOpen" } : { type: "whiteboardOpen", sheetId };
    case "whiteboardClose":
      return { type: "whiteboardClose" };
    case "whiteboardSelectSheet":
    case "whiteboardDeleteSheet":
    case "whiteboardClear":
      return isWhiteboardId(sheetId) ? { type: value.type, sheetId } : invalid;
    case "whiteboardCreateSheet":
      return { type: "whiteboardCreateSheet", name: cleanSheetName(value.name) };
    case "whiteboardRenameSheet":
      return isWhiteboardId(sheetId) ? { type: "whiteboardRenameSheet", sheetId, name: cleanSheetName(value.name) } : invalid;
    case "whiteboardUpsert":
    case "whiteboardPreview": {
      const limit = value.type === "whiteboardUpsert" ? WHITEBOARD_LIMITS.maxElementsPerMessage : WHITEBOARD_LIMITS.maxPreviewElements;
      if (!isWhiteboardId(sheetId) || !Array.isArray(value.elements) || value.elements.length > limit) return invalid;
      if (value.type === "whiteboardUpsert" && value.elements.length === 0) return invalid;
      const elements = value.elements.map(parseWhiteboardElement);
      if (elements.some((element) => element === null)) return invalid;
      return { type: value.type, sheetId, elements: elements as WhiteboardElement[] };
    }
    case "whiteboardDelete":
      if (!isWhiteboardId(sheetId) || !Array.isArray(value.ids) || value.ids.length === 0 || value.ids.length > WHITEBOARD_LIMITS.maxElementsPerSheet || !value.ids.every(isWhiteboardId)) return invalid;
      return { type: "whiteboardDelete", sheetId, ids: value.ids as string[] };
    case "whiteboardCursor": {
      if (!isWhiteboardId(sheetId)) return invalid;
      if (value.x === null || value.y === null) return { type: "whiteboardCursor", sheetId, x: null, y: null };
      return coordinate(value.x) && coordinate(value.y) ? { type: "whiteboardCursor", sheetId, x: value.x, y: value.y } : invalid;
    }
    default:
      return invalid;
  }
}

// ---------------------------------------------------------------------------
// Gateway -> client

export type WhiteboardServerMessage =
  | { type: "whiteboardState"; sheets: WhiteboardSheet[]; sheetId: string; elements: WhiteboardElement[]; peers: WhiteboardPeer[]; self: WhiteboardPeer }
  | { type: "whiteboardSheets"; sheets: WhiteboardSheet[] }
  | { type: "whiteboardUpserted"; sheetId: string; elements: WhiteboardElement[]; by: string }
  | { type: "whiteboardDeleted"; sheetId: string; ids: string[]; by: string }
  | { type: "whiteboardCleared"; sheetId: string; by: string }
  | { type: "whiteboardPreview"; sheetId: string; elements: WhiteboardElement[]; by: string }
  | { type: "whiteboardCursor"; sheetId: string; peer: WhiteboardPeer; x: number | null; y: number | null }
  | { type: "whiteboardPeers"; sheetId: string; peers: WhiteboardPeer[] }
  | { type: "whiteboardError"; code: string };

const SERVER_TYPES = new Set(["whiteboardState", "whiteboardSheets", "whiteboardUpserted", "whiteboardDeleted", "whiteboardCleared", "whiteboardPreview", "whiteboardCursor", "whiteboardPeers", "whiteboardError"]);

function parsePeer(value: unknown): WhiteboardPeer | null {
  if (!isRecord(value) || !isWhiteboardId(value.peerId) || typeof value.nickname !== "string" || value.nickname.length > 64
    || typeof value.color !== "string" || !COLOR_PATTERN.test(value.color)) return null;
  return { peerId: value.peerId, nickname: value.nickname, color: value.color };
}

const list = <T>(value: unknown, parse: (item: unknown) => T | null): T[] | null => {
  if (!Array.isArray(value)) return null;
  const parsed = value.map(parse);
  return parsed.every((item) => item !== null) ? parsed as T[] : null;
};

/** Browser-side validation of gateway messages; null for anything else. */
export function parseWhiteboardServerMessage(value: unknown): WhiteboardServerMessage | null {
  if (!isRecord(value) || typeof value.type !== "string" || !SERVER_TYPES.has(value.type)) return null;
  const sheetId = isWhiteboardId(value.sheetId) ? value.sheetId : null;
  const by = isWhiteboardId(value.by) ? value.by : null;
  switch (value.type) {
    case "whiteboardState": {
      const sheets = list(value.sheets, parseWhiteboardSheet), elements = list(value.elements, parseWhiteboardElement);
      const peers = list(value.peers, parsePeer), self = parsePeer(value.self);
      return sheets && elements && peers && self && sheetId ? { type: "whiteboardState", sheets, sheetId, elements, peers, self } : null;
    }
    case "whiteboardSheets": {
      const sheets = list(value.sheets, parseWhiteboardSheet);
      return sheets ? { type: "whiteboardSheets", sheets } : null;
    }
    case "whiteboardUpserted":
    case "whiteboardPreview": {
      const elements = list(value.elements, parseWhiteboardElement);
      return elements && sheetId && by ? { type: value.type, sheetId, elements, by } : null;
    }
    case "whiteboardDeleted": {
      const ids = Array.isArray(value.ids) && value.ids.every(isWhiteboardId) ? value.ids as string[] : null;
      return ids && sheetId && by ? { type: "whiteboardDeleted", sheetId, ids, by } : null;
    }
    case "whiteboardCleared":
      return sheetId && by ? { type: "whiteboardCleared", sheetId, by } : null;
    case "whiteboardCursor": {
      const peer = parsePeer(value.peer);
      if (!peer || !sheetId) return null;
      if (value.x === null || value.y === null) return { type: "whiteboardCursor", sheetId, peer, x: null, y: null };
      return coordinate(value.x) && coordinate(value.y) ? { type: "whiteboardCursor", sheetId, peer, x: value.x, y: value.y } : null;
    }
    case "whiteboardPeers": {
      const peers = list(value.peers, parsePeer);
      return peers && sheetId ? { type: "whiteboardPeers", sheetId, peers } : null;
    }
    case "whiteboardError":
      return typeof value.code === "string" && value.code.length <= 64 ? { type: "whiteboardError", code: value.code } : null;
    default:
      return null;
  }
}

/** A stable, readable colour per nickname for cursors and peer badges. */
export function whiteboardPeerColor(seed: string): string {
  const palette = ["#e5484d", "#f76b15", "#ffb224", "#30a46c", "#12a594", "#0090ff", "#3e63dd", "#8e4ec6", "#d6409f", "#978365"];
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.codePointAt(0)!) >>> 0;
  return palette[hash % palette.length]!;
}
