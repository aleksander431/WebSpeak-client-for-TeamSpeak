import {
  WHITEBOARD_LIMITS,
  whiteboardElementBytes,
  whiteboardPeerColor,
  type WhiteboardClientMessage,
  type WhiteboardElement,
  type WhiteboardPeer,
  type WhiteboardServerMessage,
  type WhiteboardSheet,
} from "../shared/whiteboard.js";
import type { WhiteboardStore } from "./whiteboard-store.js";

/*
 * Channel whiteboards. This file deliberately has no Node-only imports so the
 * same coordinator can run inside a browser test harness.
 *
 * A browser that opens the board subscribes to one sheet of the board that
 * belongs to its current channel. Mutations are applied in arrival order,
 * written through to the store and echoed to every subscriber of the sheet,
 * the sender included, so all browsers end up with the gateway's order.
 */

export interface WhiteboardParticipant {
  entryId: string;
  nickname: string;
  /** null while the session has no channel (connecting, kicked, ...). */
  boardKey: string | null;
}

interface Subscription {
  boardKey: string;
  sheetId: string;
  peer: WhiteboardPeer;
}

interface SheetState {
  elements: Map<string, WhiteboardElement>;
  bytes: number;
}

interface BoardState {
  sheets: WhiteboardSheet[];
  contents: Map<string, SheetState>;
}

interface Bucket { tokens: number; updatedAt: number }

export interface WhiteboardCoordinatorOptions {
  store: WhiteboardStore;
  send: (entryId: string, message: WhiteboardServerMessage) => void;
  logger?: { warn(message: string, details?: Record<string, unknown>): void };
  now?: () => number;
  randomId?: () => string;
}

/** Board key for a TeamSpeak channel: target key plus channel id. */
export function whiteboardBoardKey(targetKey: string, channelId: bigint | number | string): string {
  return `${targetKey}#${channelId}`;
}

const RATES = {
  // Mutations: sustained rate per second and burst size.
  edit: { rate: 30, burst: 120 },
  // Live previews and cursors are frequent but cheap; excess is dropped silently.
  live: { rate: 60, burst: 120 },
} as const;

function defaultRandomId(): string {
  const crypto = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (crypto?.randomUUID) return crypto.randomUUID().replace(/-/g, "").slice(0, 20);
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

export class WhiteboardCoordinator {
  private readonly subscriptions = new Map<string, Subscription>();
  private readonly boards = new Map<string, BoardState>();
  private readonly buckets = new Map<string, { edit: Bucket; live: Bucket }>();
  private readonly store: WhiteboardStore;
  private readonly sendRaw: WhiteboardCoordinatorOptions["send"];
  private readonly logger: WhiteboardCoordinatorOptions["logger"];
  private readonly now: () => number;
  private readonly randomId: () => string;

  constructor(options: WhiteboardCoordinatorOptions) {
    this.store = options.store;
    this.sendRaw = options.send;
    this.logger = options.logger;
    this.now = options.now ?? (() => Date.now());
    this.randomId = options.randomId ?? defaultRandomId;
  }

  /** Number of browsers with the board open (diagnostics and tests). */
  get subscriberCount(): number {
    return this.subscriptions.size;
  }

  isSubscribed(entryId: string): boolean {
    return this.subscriptions.has(entryId);
  }

  handleMessage(participant: WhiteboardParticipant, message: WhiteboardClientMessage): void {
    if (message.type === "whiteboardClose") {
      this.removePeer(participant.entryId);
      return;
    }
    if (message.type === "whiteboardOpen") {
      if (!participant.boardKey) return this.error(participant.entryId, "WHITEBOARD_NO_CHANNEL");
      this.subscribe(participant.entryId, participant.nickname, participant.boardKey, message.sheetId);
      return;
    }

    const subscription = this.subscriptions.get(participant.entryId);
    if (!subscription) return this.error(participant.entryId, "WHITEBOARD_NOT_OPEN");
    // The channel may have changed without a move event reaching us yet.
    if (participant.boardKey !== subscription.boardKey) return this.error(participant.entryId, "WHITEBOARD_NOT_OPEN");

    const live = message.type === "whiteboardPreview" || message.type === "whiteboardCursor";
    if (!this.take(participant.entryId, live ? "live" : "edit")) {
      if (!live) this.error(participant.entryId, "WHITEBOARD_RATE_LIMITED");
      return;
    }

    switch (message.type) {
      case "whiteboardSelectSheet":
        this.subscribe(participant.entryId, participant.nickname, subscription.boardKey, message.sheetId);
        return;
      case "whiteboardCreateSheet":
        this.createSheet(participant, subscription, message.name);
        return;
      case "whiteboardRenameSheet":
        this.renameSheet(participant.entryId, subscription.boardKey, message.sheetId, message.name);
        return;
      case "whiteboardDeleteSheet":
        this.deleteSheet(participant.entryId, subscription.boardKey, message.sheetId);
        return;
      default:
        break;
    }

    // Everything below acts on the subscribed sheet only.
    if (message.sheetId !== subscription.sheetId) return this.error(participant.entryId, "WHITEBOARD_WRONG_SHEET");
    const board = this.board(subscription.boardKey);
    const sheet = this.sheet(subscription.boardKey, board, subscription.sheetId);
    const by = subscription.peer.peerId;

    switch (message.type) {
      case "whiteboardUpsert": {
        let count = sheet.elements.size;
        let bytes = sheet.bytes;
        const elements = message.elements.map((element) => ({ ...element, author: participant.nickname }));
        for (const element of elements) {
          const previous = sheet.elements.get(element.id);
          if (!previous) count++;
          bytes += whiteboardElementBytes(element) - (previous ? whiteboardElementBytes(previous) : 0);
        }
        if (count > WHITEBOARD_LIMITS.maxElementsPerSheet || bytes > WHITEBOARD_LIMITS.maxSheetBytes) {
          return this.error(participant.entryId, "WHITEBOARD_SHEET_FULL");
        }
        for (const element of elements) sheet.elements.set(element.id, element);
        sheet.bytes = bytes;
        this.persist("save", () => this.store.saveElements(subscription.boardKey, subscription.sheetId, elements));
        this.broadcast(subscription.boardKey, subscription.sheetId, { type: "whiteboardUpserted", sheetId: subscription.sheetId, elements, by });
        return;
      }
      case "whiteboardDelete": {
        const ids = message.ids.filter((id) => sheet.elements.has(id));
        if (ids.length === 0) {
          // Nothing left to delete (someone was faster); still answer the
          // sender so its queue of unconfirmed changes stays in step.
          this.sendRaw(participant.entryId, { type: "whiteboardDeleted", sheetId: subscription.sheetId, ids: [], by });
          return;
        }
        for (const id of ids) {
          sheet.bytes -= whiteboardElementBytes(sheet.elements.get(id)!);
          sheet.elements.delete(id);
        }
        this.persist("delete", () => this.store.deleteElements(subscription.boardKey, subscription.sheetId, ids));
        this.broadcast(subscription.boardKey, subscription.sheetId, { type: "whiteboardDeleted", sheetId: subscription.sheetId, ids, by });
        return;
      }
      case "whiteboardClear":
        sheet.elements.clear();
        sheet.bytes = 0;
        this.persist("clear", () => this.store.clearSheet(subscription.boardKey, subscription.sheetId));
        this.broadcast(subscription.boardKey, subscription.sheetId, { type: "whiteboardCleared", sheetId: subscription.sheetId, by });
        return;
      case "whiteboardPreview":
        this.broadcast(subscription.boardKey, subscription.sheetId, { type: "whiteboardPreview", sheetId: subscription.sheetId, elements: message.elements, by }, participant.entryId);
        return;
      case "whiteboardCursor":
        this.broadcast(subscription.boardKey, subscription.sheetId, { type: "whiteboardCursor", sheetId: subscription.sheetId, peer: subscription.peer, x: message.x, y: message.y }, participant.entryId);
        return;
      default:
        return;
    }
  }

  /**
   * The session changed channel (or lost it). An open board follows the user
   * to the new channel's board; with no channel it is closed.
   */
  onBoardChanged(participant: WhiteboardParticipant): void {
    const subscription = this.subscriptions.get(participant.entryId);
    if (!subscription || subscription.boardKey === participant.boardKey) return;
    if (!participant.boardKey) {
      this.removePeer(participant.entryId);
      this.error(participant.entryId, "WHITEBOARD_NO_CHANNEL");
      return;
    }
    this.subscribe(participant.entryId, participant.nickname, participant.boardKey, undefined);
  }

  /** The browser closed the board, disconnected or the session ended. */
  removePeer(entryId: string): void {
    const subscription = this.subscriptions.get(entryId);
    this.buckets.delete(entryId);
    if (!subscription) return;
    this.subscriptions.delete(entryId);
    this.announcePeers(subscription.boardKey, subscription.sheetId);
    this.releaseBoard(subscription.boardKey);
  }

  // -------------------------------------------------------------------------

  private subscribe(entryId: string, nickname: string, boardKey: string, requestedSheetId: string | undefined): void {
    const board = this.board(boardKey);
    const sheetId = board.sheets.some((sheet) => sheet.id === requestedSheetId) ? requestedSheetId! : board.sheets[0]!.id;
    const previous = this.subscriptions.get(entryId);
    const peer: WhiteboardPeer = previous?.peer ?? { peerId: this.randomId(), nickname: nickname.slice(0, 64), color: whiteboardPeerColor(nickname) };
    this.subscriptions.set(entryId, { boardKey, sheetId, peer });
    if (previous && (previous.boardKey !== boardKey || previous.sheetId !== sheetId)) {
      this.announcePeers(previous.boardKey, previous.sheetId);
      if (previous.boardKey !== boardKey) this.releaseBoard(previous.boardKey);
    }
    const sheet = this.sheet(boardKey, board, sheetId);
    this.sendRaw(entryId, {
      type: "whiteboardState",
      sheets: board.sheets.map((item) => ({ ...item })),
      sheetId,
      elements: [...sheet.elements.values()],
      peers: this.peersOn(boardKey, sheetId),
      self: peer,
    });
    this.announcePeers(boardKey, sheetId, entryId);
  }

  private createSheet(participant: WhiteboardParticipant, subscription: Subscription, name: string): void {
    const board = this.board(subscription.boardKey);
    if (board.sheets.length >= WHITEBOARD_LIMITS.maxSheetsPerBoard) return this.error(participant.entryId, "WHITEBOARD_SHEET_LIMIT");
    const sheet: WhiteboardSheet = { id: this.randomId(), name, createdAt: this.now() };
    board.sheets.push(sheet);
    board.contents.set(sheet.id, { elements: new Map(), bytes: 0 });
    this.persist("createSheet", () => this.store.createSheet(subscription.boardKey, sheet));
    this.broadcastBoard(subscription.boardKey, { type: "whiteboardSheets", sheets: board.sheets.map((item) => ({ ...item })) });
    // The creator switches to the new sheet; everybody else stays where they are.
    this.subscribe(participant.entryId, participant.nickname, subscription.boardKey, sheet.id);
  }

  private renameSheet(entryId: string, boardKey: string, sheetId: string, name: string): void {
    const board = this.board(boardKey);
    const sheet = board.sheets.find((item) => item.id === sheetId);
    if (!sheet) return this.error(entryId, "WHITEBOARD_UNKNOWN_SHEET");
    if (sheet.name === name) return;
    sheet.name = name;
    this.persist("renameSheet", () => this.store.renameSheet(boardKey, sheetId, name));
    this.broadcastBoard(boardKey, { type: "whiteboardSheets", sheets: board.sheets.map((item) => ({ ...item })) });
  }

  private deleteSheet(entryId: string, boardKey: string, sheetId: string): void {
    const board = this.board(boardKey);
    const index = board.sheets.findIndex((item) => item.id === sheetId);
    if (index < 0) return this.error(entryId, "WHITEBOARD_UNKNOWN_SHEET");
    if (board.sheets.length <= 1) return this.error(entryId, "WHITEBOARD_LAST_SHEET");
    board.sheets.splice(index, 1);
    board.contents.delete(sheetId);
    this.persist("deleteSheet", () => this.store.deleteSheet(boardKey, sheetId));
    this.broadcastBoard(boardKey, { type: "whiteboardSheets", sheets: board.sheets.map((item) => ({ ...item })) });
    // Viewers of the deleted sheet move to the neighbouring one.
    const fallback = board.sheets[Math.min(index, board.sheets.length - 1)]!.id;
    for (const [viewerId, subscription] of [...this.subscriptions]) {
      if (subscription.boardKey === boardKey && subscription.sheetId === sheetId) {
        this.subscribe(viewerId, subscription.peer.nickname, boardKey, fallback);
      }
    }
  }

  private board(boardKey: string): BoardState {
    let board = this.boards.get(boardKey);
    if (board) return board;
    let sheets: WhiteboardSheet[] = [];
    try {
      sheets = this.store.listSheets(boardKey);
    } catch (error) {
      this.logger?.warn("Whiteboard sheets could not be loaded", { boardKey, error: String(error) });
    }
    if (sheets.length === 0) {
      const first: WhiteboardSheet = { id: this.randomId(), name: "", createdAt: this.now() };
      sheets = [first];
      this.persist("createSheet", () => this.store.createSheet(boardKey, first));
    }
    board = { sheets: sheets.sort((a, b) => a.createdAt - b.createdAt), contents: new Map() };
    this.boards.set(boardKey, board);
    return board;
  }

  private sheet(boardKey: string, board: BoardState, sheetId: string): SheetState {
    let sheet = board.contents.get(sheetId);
    if (sheet) return sheet;
    let elements: WhiteboardElement[] = [];
    try {
      elements = this.store.loadElements(boardKey, sheetId);
    } catch (error) {
      this.logger?.warn("Whiteboard sheet could not be loaded", { boardKey, sheetId, error: String(error) });
    }
    sheet = { elements: new Map(elements.map((element) => [element.id, element])), bytes: elements.reduce((sum, element) => sum + whiteboardElementBytes(element), 0) };
    board.contents.set(sheetId, sheet);
    return sheet;
  }

  /** Boards with nobody looking are dropped from memory; the store keeps them. */
  private releaseBoard(boardKey: string): void {
    for (const subscription of this.subscriptions.values()) if (subscription.boardKey === boardKey) return;
    this.boards.delete(boardKey);
  }

  private peersOn(boardKey: string, sheetId: string): WhiteboardPeer[] {
    return [...this.subscriptions.values()]
      .filter((subscription) => subscription.boardKey === boardKey && subscription.sheetId === sheetId)
      .map((subscription) => subscription.peer);
  }

  private announcePeers(boardKey: string, sheetId: string, except?: string): void {
    this.broadcast(boardKey, sheetId, { type: "whiteboardPeers", sheetId, peers: this.peersOn(boardKey, sheetId) }, except);
  }

  private broadcast(boardKey: string, sheetId: string, message: WhiteboardServerMessage, except?: string): void {
    for (const [entryId, subscription] of this.subscriptions) {
      if (entryId !== except && subscription.boardKey === boardKey && subscription.sheetId === sheetId) this.sendRaw(entryId, message);
    }
  }

  private broadcastBoard(boardKey: string, message: WhiteboardServerMessage): void {
    for (const [entryId, subscription] of this.subscriptions) if (subscription.boardKey === boardKey) this.sendRaw(entryId, message);
  }

  private persist(operation: string, write: () => unknown): void {
    try {
      write();
    } catch (error) {
      // The live board keeps working; the change is lost on restart only.
      this.logger?.warn("Whiteboard change could not be saved", { operation, error: String(error) });
    }
  }

  private take(entryId: string, kind: "edit" | "live"): boolean {
    const now = this.now();
    let buckets = this.buckets.get(entryId);
    if (!buckets) {
      buckets = { edit: { tokens: RATES.edit.burst, updatedAt: now }, live: { tokens: RATES.live.burst, updatedAt: now } };
      this.buckets.set(entryId, buckets);
    }
    const bucket = buckets[kind];
    const rate = RATES[kind];
    bucket.tokens = Math.min(rate.burst, bucket.tokens + ((now - bucket.updatedAt) / 1000) * rate.rate);
    bucket.updatedAt = now;
    if (bucket.tokens < 1) return false;
    bucket.tokens -= 1;
    return true;
  }

  private error(entryId: string, code: string): void {
    this.sendRaw(entryId, { type: "whiteboardError", code });
  }
}
