import {
  parseWhiteboardElement,
  WHITEBOARD_LIMITS,
  whiteboardElementBytes,
  type WhiteboardClientMessage,
  type WhiteboardElement,
  type WhiteboardPeer,
  type WhiteboardServerMessage,
  type WhiteboardSheet,
} from "../../../src/shared/whiteboard.js";

/*
 * Browser side of the shared whiteboard, independent of Vue so it can be
 * tested in Node.
 *
 * `confirmed` is the gateway's state, built only from echoed changes in the
 * gateway's order. Local changes are applied on top as a queue of pending
 * operations until their echo arrives, so drawing feels instant and every
 * browser still converges on the same result.
 */

export interface WhiteboardTransport {
  isOpen(): boolean;
  send(message: WhiteboardClientMessage): void;
}

type PendingOperation =
  | { kind: "upsert"; elements: WhiteboardElement[] }
  | { kind: "delete"; ids: string[] }
  | { kind: "clear" };

interface Change { id: string; before: WhiteboardElement | null; after: WhiteboardElement | null }

export interface WhiteboardCursor { peer: WhiteboardPeer; x: number; y: number; at: number }

export interface WhiteboardClientOptions {
  transport: WhiteboardTransport;
  now?: () => number;
  setTimer?: (callback: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

const PREVIEW_INTERVAL_MS = 40;
const CURSOR_INTERVAL_MS = 50;
const PREVIEW_TTL_MS = 4_000;
const CURSOR_TTL_MS = 15_000;
const MAX_UNDO = 100;
/** Keep each frame below the gateway's 3 MB WebSocket limit. */
const MAX_FRAME_BYTES = 2_500_000;

const ID_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

export function newWhiteboardId(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => ID_ALPHABET[byte % ID_ALPHABET.length]).join("");
}

export function sortByZ(elements: Iterable<WhiteboardElement>): WhiteboardElement[] {
  return [...elements].sort((a, b) => a.z - b.z || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export class WhiteboardClient {
  /** The user wants the board open (survives reconnects). */
  wanted = false;
  /** A state message for the current sheet has arrived. */
  ready = false;
  sheets: WhiteboardSheet[] = [];
  sheetId = "";
  peers: WhiteboardPeer[] = [];
  self: WhiteboardPeer | null = null;
  lastError = "";
  /** Bumped on every visible change; Vue watches it. */
  version = 0;

  private confirmed = new Map<string, WhiteboardElement>();
  private pending: PendingOperation[] = [];
  private displayCache: Map<string, WhiteboardElement> | null = null;
  private readonly previews = new Map<string, { elements: WhiteboardElement[]; at: number }>();
  private readonly cursorMap = new Map<string, WhiteboardCursor>();
  private undoStack: Change[][] = [];
  private redoStack: Change[][] = [];
  private requestedSheetId: string | undefined;
  private readonly listeners = new Set<() => void>();
  private readonly transport: WhiteboardTransport;
  private readonly now: () => number;
  private readonly setTimer: (callback: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;
  private previewState = { sentAt: -Infinity, queued: null as WhiteboardElement[] | null, timer: null as unknown };
  private cursorState = { sentAt: -Infinity, queued: null as { x: number | null; y: number | null } | null, timer: null as unknown };

  constructor(options: WhiteboardClientOptions) {
    this.transport = options.transport;
    this.now = options.now ?? (() => Date.now());
    this.setTimer = options.setTimer ?? ((callback, ms) => setTimeout(callback, ms));
    this.clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // ---------------------------------------------------------------- reading

  /** Elements as this browser sees them: confirmed plus unconfirmed local changes. */
  get elements(): Map<string, WhiteboardElement> {
    if (this.displayCache) return this.displayCache;
    const view = new Map(this.confirmed);
    for (const operation of this.pending) applyOperation(view, operation);
    this.displayCache = view;
    return view;
  }

  /** Elements to draw, peers' live previews replacing the elements they edit. */
  drawList(): WhiteboardElement[] {
    const merged = new Map(this.elements);
    const now = this.now();
    for (const [peerId, preview] of this.previews) {
      if (now - preview.at > PREVIEW_TTL_MS) { this.previews.delete(peerId); continue; }
      for (const element of preview.elements) merged.set(`${element.id}`, element);
    }
    return sortByZ(merged.values());
  }

  cursors(): WhiteboardCursor[] {
    const now = this.now();
    for (const [peerId, cursor] of this.cursorMap) if (now - cursor.at > CURSOR_TTL_MS) this.cursorMap.delete(peerId);
    return [...this.cursorMap.values()];
  }

  get canUndo(): boolean { return this.undoStack.length > 0; }
  get canRedo(): boolean { return this.redoStack.length > 0; }
  get pendingCount(): number { return this.pending.length; }

  nextZ(): number {
    let z = 0;
    for (const element of this.elements.values()) z = Math.max(z, element.z);
    return z + 1;
  }

  // ------------------------------------------------------------- lifecycle

  open(sheetId?: string): void {
    this.wanted = true;
    this.requestedSheetId = sheetId ?? (this.sheetId || undefined);
    if (this.transport.isOpen()) this.transport.send(this.requestedSheetId ? { type: "whiteboardOpen", sheetId: this.requestedSheetId } : { type: "whiteboardOpen" });
  }

  close(): void {
    if (this.wanted && this.transport.isOpen()) this.transport.send({ type: "whiteboardClose" });
    this.wanted = false;
    this.reset();
    this.emit();
  }

  /** Call when the voice session connects or drops. */
  setConnected(connected: boolean): void {
    if (!connected) {
      this.reset();
      this.emit();
      return;
    }
    if (this.wanted) this.open(this.sheetId || this.requestedSheetId);
  }

  // ---------------------------------------------------------------- sheets

  selectSheet(sheetId: string): void {
    if (!this.ready || sheetId === this.sheetId) return;
    this.requestedSheetId = sheetId;
    this.transport.send({ type: "whiteboardSelectSheet", sheetId });
  }

  createSheet(name = ""): void {
    if (this.ready) this.transport.send({ type: "whiteboardCreateSheet", name });
  }

  renameSheet(sheetId: string, name: string): void {
    if (this.ready) this.transport.send({ type: "whiteboardRenameSheet", sheetId, name });
  }

  deleteSheet(sheetId: string): void {
    if (this.ready && this.sheets.length > 1) this.transport.send({ type: "whiteboardDeleteSheet", sheetId });
  }

  // --------------------------------------------------------------- editing

  /** Add or replace elements as one undoable step. */
  upsert(elements: WhiteboardElement[]): void {
    // Validate here: the gateway rejects a whole frame with one bad element.
    const valid = elements.map(parseWhiteboardElement).filter((element): element is WhiteboardElement => element !== null);
    this.commit(valid.map((element) => ({ id: element.id, after: element })));
  }

  remove(ids: string[]): void {
    this.commit(ids.filter((id) => this.elements.has(id)).map((id) => ({ id, after: null })));
  }

  clear(): void {
    if (!this.ready) return;
    const before = [...this.elements.values()];
    if (before.length === 0) return;
    this.pushPending({ kind: "clear" });
    this.transport.send({ type: "whiteboardClear", sheetId: this.sheetId });
    this.record(before.map((element) => ({ id: element.id, before: element, after: null })));
    this.sendPreview([]);
    this.emit();
  }

  undo(): void {
    const action = this.undoStack.pop();
    if (!action || !this.ready) return;
    const inverse = this.apply(action.map((change) => ({ id: change.id, after: change.before })));
    if (inverse.length) this.redoStack.push(inverse);
    this.emit();
  }

  redo(): void {
    const action = this.redoStack.pop();
    if (!action || !this.ready) return;
    // Both stacks hold changes to revert: `before` is the state to go back to.
    const inverse = this.apply(action.map((change) => ({ id: change.id, after: change.before })));
    if (inverse.length) this.undoStack.push(inverse);
    this.emit();
  }

  /** Live preview of an element being drawn or dragged; [] ends it. */
  sendPreview(elements: WhiteboardElement[]): void {
    const valid = elements.slice(0, WHITEBOARD_LIMITS.maxPreviewElements).map(parseWhiteboardElement).filter((element): element is WhiteboardElement => element !== null);
    this.throttled(this.previewState, PREVIEW_INTERVAL_MS, valid, (queued) => {
      if (this.ready && this.transport.isOpen()) this.transport.send({ type: "whiteboardPreview", sheetId: this.sheetId, elements: queued });
    });
  }

  sendCursor(x: number | null, y: number | null): void {
    this.throttled(this.cursorState, CURSOR_INTERVAL_MS, { x, y }, (queued) => {
      if (!this.ready || !this.transport.isOpen()) return;
      if (queued.x === null || queued.y === null) this.transport.send({ type: "whiteboardCursor", sheetId: this.sheetId, x: null, y: null });
      else this.transport.send({ type: "whiteboardCursor", sheetId: this.sheetId, x: Math.round(queued.x), y: Math.round(queued.y) });
    });
  }

  // -------------------------------------------------------------- incoming

  receive(message: WhiteboardServerMessage): void {
    switch (message.type) {
      case "whiteboardState":
        if (!this.wanted) return;
        this.sheets = message.sheets;
        if (message.sheetId !== this.sheetId) { this.undoStack = []; this.redoStack = []; }
        this.sheetId = message.sheetId;
        this.requestedSheetId = message.sheetId;
        this.confirmed = new Map(message.elements.map((element) => [element.id, element]));
        this.pending = [];
        this.displayCache = null;
        this.peers = message.peers;
        this.self = message.self;
        this.previews.clear();
        this.cursorMap.clear();
        this.ready = true;
        this.lastError = "";
        break;
      case "whiteboardSheets":
        this.sheets = message.sheets;
        break;
      case "whiteboardPeers":
        if (message.sheetId !== this.sheetId) return;
        this.peers = message.peers;
        for (const peerId of [...this.cursorMap.keys()]) if (!message.peers.some((peer) => peer.peerId === peerId)) this.cursorMap.delete(peerId);
        for (const peerId of [...this.previews.keys()]) if (!message.peers.some((peer) => peer.peerId === peerId)) this.previews.delete(peerId);
        break;
      case "whiteboardUpserted":
      case "whiteboardDeleted":
      case "whiteboardCleared": {
        if (message.sheetId !== this.sheetId || !this.ready) return;
        const operation: PendingOperation = message.type === "whiteboardUpserted"
          ? { kind: "upsert", elements: message.elements }
          : message.type === "whiteboardDeleted" ? { kind: "delete", ids: message.ids } : { kind: "clear" };
        applyOperation(this.confirmed, operation);
        if (message.by === this.self?.peerId) this.pending.shift();
        else this.previews.delete(message.by);
        this.displayCache = null;
        break;
      }
      case "whiteboardPreview":
        if (message.sheetId !== this.sheetId) return;
        if (message.elements.length) this.previews.set(message.by, { elements: message.elements, at: this.now() });
        else this.previews.delete(message.by);
        break;
      case "whiteboardCursor":
        if (message.sheetId !== this.sheetId) return;
        if (message.x === null || message.y === null) this.cursorMap.delete(message.peer.peerId);
        else this.cursorMap.set(message.peer.peerId, { peer: message.peer, x: message.x, y: message.y, at: this.now() });
        break;
      case "whiteboardError":
        this.lastError = message.code;
        if (message.code === "WHITEBOARD_SHEET_FULL") {
          // Only an upsert is rejected this way and replies arrive in order,
          // so the rejected change is the oldest one still waiting.
          this.pending.shift();
          this.displayCache = null;
        } else if (["WHITEBOARD_RATE_LIMITED", "WHITEBOARD_WRONG_SHEET", "WHITEBOARD_NOT_OPEN", "INVALID_WHITEBOARD_MESSAGE"].includes(message.code)) {
          // Resynchronise from the gateway's copy.
          this.ready = false;
          this.pending = [];
          this.displayCache = null;
          if (this.wanted) this.open(this.sheetId || this.requestedSheetId);
        } else if (message.code === "WHITEBOARD_NO_CHANNEL" || message.code === "SESSION_NOT_READY") {
          this.ready = false;
        }
        break;
    }
    this.emit();
  }

  clearError(): void {
    this.lastError = "";
    this.emit();
  }

  // -------------------------------------------------------------- internal

  private commit(changes: { id: string; after: WhiteboardElement | null }[]): void {
    if (!this.ready || changes.length === 0) return;
    const recorded = this.apply(changes);
    if (recorded.length) {
      this.record(recorded);
      this.emit();
    }
  }

  /** Send changes and return them with their "before" state, for undo. */
  private apply(changes: { id: string; after: WhiteboardElement | null }[]): Change[] {
    const current = this.elements;
    const recorded: Change[] = [];
    const upserts: WhiteboardElement[] = [];
    const deletes: string[] = [];
    for (const change of changes) {
      const before = current.get(change.id) ?? null;
      if (!before && !change.after) continue;
      recorded.push({ id: change.id, before, after: change.after });
      if (change.after) upserts.push(change.after);
      else deletes.push(change.id);
    }
    for (const chunk of chunkElements(upserts)) {
      this.pushPending({ kind: "upsert", elements: chunk });
      this.transport.send({ type: "whiteboardUpsert", sheetId: this.sheetId, elements: chunk });
    }
    for (let index = 0; index < deletes.length; index += WHITEBOARD_LIMITS.maxElementsPerMessage) {
      const ids = deletes.slice(index, index + WHITEBOARD_LIMITS.maxElementsPerMessage);
      this.pushPending({ kind: "delete", ids });
      this.transport.send({ type: "whiteboardDelete", sheetId: this.sheetId, ids });
    }
    return recorded;
  }

  private record(action: Change[]): void {
    this.undoStack.push(action);
    if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
    this.redoStack = [];
  }

  private pushPending(operation: PendingOperation): void {
    this.pending.push(operation);
    this.displayCache = null;
  }

  private reset(): void {
    this.ready = false;
    this.sheets = [];
    this.confirmed = new Map();
    this.pending = [];
    this.displayCache = null;
    this.peers = [];
    this.self = null;
    this.previews.clear();
    this.cursorMap.clear();
    this.undoStack = [];
    this.redoStack = [];
  }

  private throttled<T>(state: { sentAt: number; queued: T | null; timer: unknown }, interval: number, value: T, flush: (value: T) => void): void {
    state.queued = value;
    const wait = state.sentAt + interval - this.now();
    if (wait <= 0) {
      if (state.timer !== null) { this.clearTimer(state.timer); state.timer = null; }
      state.sentAt = this.now();
      state.queued = null;
      flush(value);
      return;
    }
    if (state.timer !== null) return;
    state.timer = this.setTimer(() => {
      state.timer = null;
      if (state.queued === null) return;
      const queued = state.queued;
      state.queued = null;
      state.sentAt = this.now();
      flush(queued);
    }, wait);
  }

  private emit(): void {
    this.version++;
    for (const listener of this.listeners) listener();
  }
}

function applyOperation(target: Map<string, WhiteboardElement>, operation: PendingOperation): void {
  if (operation.kind === "upsert") for (const element of operation.elements) target.set(element.id, element);
  else if (operation.kind === "delete") for (const id of operation.ids) target.delete(id);
  else target.clear();
}

function chunkElements(elements: WhiteboardElement[]): WhiteboardElement[][] {
  const chunks: WhiteboardElement[][] = [];
  let chunk: WhiteboardElement[] = [];
  let bytes = 0;
  for (const element of elements) {
    const size = whiteboardElementBytes(element);
    if (chunk.length && (chunk.length >= WHITEBOARD_LIMITS.maxElementsPerMessage || bytes + size > MAX_FRAME_BYTES)) {
      chunks.push(chunk);
      chunk = [];
      bytes = 0;
    }
    chunk.push(element);
    bytes += size;
  }
  if (chunk.length) chunks.push(chunk);
  return chunks;
}
