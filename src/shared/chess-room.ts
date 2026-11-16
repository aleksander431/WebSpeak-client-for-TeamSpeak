import type { ChessColor, Promotion } from "./chess.js";

/*
 * The channel's chess board on the voice WebSocket (`chess*` frames). One
 * board per channel: two seats, everyone else in the channel watches. The
 * gateway checks every move with `src/shared/chess.ts` and runs the clocks.
 */

export const CHESS_CLOCK_MINUTES = [0, 1, 3, 5, 10, 15, 30] as const;
export const CHESS_CLOCK_INCREMENTS = [0, 1, 2, 3, 5, 10] as const;
/** Computer strength levels the board offers (1 weakest … 8 strongest). */
export const CHESS_BOT_LEVELS = [1, 2, 3, 4, 5, 6, 7, 8] as const;
/** A player away from the channel this long during a game loses on request. */
export const CHESS_ABANDON_MS = 60_000;

export type ChessResultReason =
  | "checkmate" | "stalemate" | "material" | "repetition" | "fifty"
  | "resign" | "timeout" | "timeoutDraw" | "agreement" | "abandon";

export interface ChessSeatView {
  name: string;
  /** In the channel right now (for the computer: whoever runs it). */
  online: boolean;
  /** Milliseconds since this player left the channel, at the moment of sending. */
  away: number | null;
  /** The computer: its level, and whether this viewer's page plays its moves. */
  bot?: { level: number; mine: boolean };
}

export interface ChessMoveView {
  san: string;
  from: string;
  to: string;
}

export interface ChessRoomView {
  /** Changes with every new game, so late moves of a finished one are refused. */
  id: string;
  phase: "waiting" | "playing" | "over";
  white: ChessSeatView | null;
  black: ChessSeatView | null;
  /** Which seat this viewer holds. */
  you: ChessColor | null;
  /** Minutes per side and seconds added per move; null without a clock. */
  clock: { minutes: number; increment: number } | null;
  /** Milliseconds left at the moment of sending, and whose clock is running. */
  times: { w: number; b: number } | null;
  running: ChessColor | null;
  fen: string;
  moves: ChessMoveView[];
  result: { winner: ChessColor | null; reason: ChessResultReason } | null;
  drawOffer: ChessColor | null;
  rematch: ChessColor[];
  spectators: string[];
}

export type ChessClientMessage =
  | { type: "chessOpen" }
  | { type: "chessClose" }
  | { type: "chessSit"; color: ChessColor }
  | { type: "chessBot"; level: number }
  | { type: "chessClaim"; id: string }
  | { type: "chessStand" }
  | { type: "chessClock"; minutes: number; increment: number }
  | { type: "chessStart" }
  | { type: "chessMove"; id: string; from: string; to: string; promotion?: Promotion }
  | { type: "chessResign"; id: string }
  | { type: "chessDraw"; id: string; action: "offer" | "accept" | "decline" }
  | { type: "chessRematch"; id: string };

export type ChessServerMessage =
  | { type: "chessState"; room: ChessRoomView }
  | { type: "chessError"; code: string };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const gameId = (value: unknown): string | null => typeof value === "string" && /^[A-Za-z0-9_-]{1,32}$/.test(value) ? value : null;
const square = (value: unknown): string | null => typeof value === "string" && /^[a-h][1-8]$/.test(value) ? value : null;
const color = (value: unknown): ChessColor | null => value === "w" || value === "b" ? value : null;

/** A decoded frame as a chess message, an error for a malformed chess frame, or null for any other frame. */
export function parseChessClientMessage(value: unknown): ChessClientMessage | { error: { code: string } } | null {
  if (!isRecord(value) || typeof value.type !== "string" || !value.type.startsWith("chess")) return null;
  const invalid = { error: { code: "INVALID_CHESS_MESSAGE" } };
  switch (value.type) {
    case "chessOpen":
    case "chessClose":
    case "chessStand":
    case "chessStart":
      return { type: value.type };
    case "chessSit": {
      const seat = color(value.color);
      return seat ? { type: "chessSit", color: seat } : invalid;
    }
    case "chessClock": {
      const minutes = value.minutes;
      const increment = value.increment;
      if (!(CHESS_CLOCK_MINUTES as readonly unknown[]).includes(minutes) || !(CHESS_CLOCK_INCREMENTS as readonly unknown[]).includes(increment)) return invalid;
      return { type: "chessClock", minutes: minutes as number, increment: increment as number };
    }
    case "chessMove": {
      const id = gameId(value.id);
      const from = square(value.from);
      const to = square(value.to);
      const promotion = value.promotion;
      if (!id || !from || !to || (promotion !== undefined && !["q", "r", "b", "n"].includes(String(promotion)))) return invalid;
      return { type: "chessMove", id, from, to, ...(promotion ? { promotion: promotion as Promotion } : {}) };
    }
    case "chessBot":
      return (CHESS_BOT_LEVELS as readonly unknown[]).includes(value.level) ? { type: "chessBot", level: value.level as number } : invalid;
    case "chessResign":
    case "chessClaim":
    case "chessRematch": {
      const id = gameId(value.id);
      return id ? { type: value.type, id } : invalid;
    }
    case "chessDraw": {
      const id = gameId(value.id);
      return id && (value.action === "offer" || value.action === "accept" || value.action === "decline") ? { type: "chessDraw", id, action: value.action } : invalid;
    }
    default:
      return invalid;
  }
}

const seatView = (value: unknown): ChessSeatView | null | undefined => {
  if (value === null) return null;
  if (!isRecord(value) || typeof value.name !== "string" || typeof value.online !== "boolean") return undefined;
  const bot = isRecord(value.bot) && typeof value.bot.level === "number" ? { level: value.bot.level, mine: value.bot.mine === true } : undefined;
  return { name: value.name, online: value.online, away: typeof value.away === "number" ? value.away : null, ...(bot ? { bot } : {}) };
};

/** The browser's check of what the gateway sends. */
export function parseChessServerMessage(value: unknown): ChessServerMessage | null {
  if (!isRecord(value)) return null;
  if (value.type === "chessError") return typeof value.code === "string" ? { type: "chessError", code: value.code } : null;
  if (value.type !== "chessState" || !isRecord(value.room)) return null;
  const room = value.room;
  const white = seatView(room.white);
  const black = seatView(room.black);
  if (typeof room.id !== "string" || !["waiting", "playing", "over"].includes(String(room.phase)) || white === undefined || black === undefined
    || typeof room.fen !== "string" || !Array.isArray(room.moves) || !Array.isArray(room.spectators) || !Array.isArray(room.rematch)) return null;
  const clock = isRecord(room.clock) && typeof room.clock.minutes === "number" && typeof room.clock.increment === "number" ? { minutes: room.clock.minutes, increment: room.clock.increment } : null;
  const times = isRecord(room.times) && typeof room.times.w === "number" && typeof room.times.b === "number" ? { w: room.times.w, b: room.times.b } : null;
  const result = isRecord(room.result) && typeof room.result.reason === "string" ? { winner: color(room.result.winner), reason: room.result.reason as ChessResultReason } : null;
  return {
    type: "chessState",
    room: {
      id: room.id, phase: room.phase as ChessRoomView["phase"], white, black, you: color(room.you), clock, times, running: color(room.running),
      fen: room.fen,
      moves: room.moves.filter((move): move is ChessMoveView => isRecord(move) && typeof move.san === "string" && typeof move.from === "string" && typeof move.to === "string")
        .map(move => ({ san: move.san, from: move.from, to: move.to })),
      result, drawOffer: color(room.drawOffer), rematch: room.rematch.map(color).filter((item): item is ChessColor => item !== null),
      spectators: room.spectators.filter((name): name is string => typeof name === "string"),
    },
  };
}
