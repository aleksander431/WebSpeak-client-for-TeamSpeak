/*
 * Chess rules for the channel board: positions, legal moves (castling, en
 * passant, promotion), standard algebraic notation and the ways a game ends
 * by itself (mate, stalemate, insufficient material, threefold repetition,
 * the 50-move rule). Browser-safe and free of dependencies: the gateway
 * checks every move with it and the page uses it to show the legal ones.
 *
 * Squares are 0–63, a1 = 0, b1 = 1 … h8 = 63. Pieces are FEN letters:
 * upper case white, lower case black.
 */

export type ChessColor = "w" | "b";
export type PieceType = "p" | "n" | "b" | "r" | "q" | "k";
export type Promotion = "q" | "r" | "b" | "n";

export interface ChessPosition {
  /** 64 squares, a1 first; "" for an empty square. */
  board: string[];
  turn: ChessColor;
  /** Any of "KQkq", or "" when nobody may castle. */
  castling: string;
  /** The square a pawn skipped on the last move, or -1. */
  ep: number;
  halfmove: number;
  fullmove: number;
}

export interface ChessMove {
  from: number;
  to: number;
  piece: string;
  captured?: string;
  promotion?: Promotion;
  /** "k"/"q" for castling, "e" for en passant. */
  special?: "k" | "q" | "e";
}

export type ChessEnd =
  | { reason: "checkmate"; winner: ChessColor }
  | { reason: "stalemate" | "material" | "repetition" | "fifty"; winner: null };

export const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

const FILES = "abcdefgh";
export const squareName = (square: number): string => `${FILES[square & 7]}${(square >> 3) + 1}`;
export function squareIndex(name: string): number {
  if (!/^[a-h][1-8]$/.test(name)) return -1;
  return (name.charCodeAt(1) - 49) * 8 + (name.charCodeAt(0) - 97);
}
export const colorOf = (piece: string): ChessColor | null => (piece ? (piece === piece.toUpperCase() ? "w" : "b") : null);
const typeOf = (piece: string) => piece.toLowerCase() as PieceType;
const other = (color: ChessColor): ChessColor => (color === "w" ? "b" : "w");
const fileOf = (square: number) => square & 7;
const rankOf = (square: number) => square >> 3;

export function parseFen(fen: string): ChessPosition | null {
  const parts = fen.trim().split(/\s+/);
  if (parts.length < 4) return null;
  const rows = parts[0]!.split("/");
  if (rows.length !== 8) return null;
  const board: string[] = new Array(64).fill("");
  for (let r = 0; r < 8; r++) {
    let file = 0;
    for (const char of rows[r]!) {
      if (/[1-8]/.test(char)) file += Number(char);
      else if (/[pnbrqkPNBRQK]/.test(char)) { if (file > 7) return null; board[(7 - r) * 8 + file] = char; file++; }
      else return null;
    }
    if (file !== 8) return null;
  }
  const turn = parts[1];
  if (turn !== "w" && turn !== "b") return null;
  const castling = parts[2] === "-" ? "" : parts[2]!;
  if (!/^K?Q?k?q?$/.test(castling)) return null;
  const ep = parts[3] === "-" ? -1 : squareIndex(parts[3]!);
  if (parts[3] !== "-" && ep < 0) return null;
  const halfmove = parts[4] === undefined ? 0 : Number(parts[4]);
  const fullmove = parts[5] === undefined ? 1 : Number(parts[5]);
  if (!Number.isInteger(halfmove) || halfmove < 0 || !Number.isInteger(fullmove) || fullmove < 1) return null;
  if (board.filter(piece => piece === "K").length !== 1 || board.filter(piece => piece === "k").length !== 1) return null;
  return { board, turn, castling, ep, halfmove, fullmove };
}

export function toFen(position: ChessPosition): string {
  return `${placement(position)} ${position.turn} ${position.castling || "-"} ${position.ep < 0 ? "-" : squareName(position.ep)} ${position.halfmove} ${position.fullmove}`;
}

function placement(position: ChessPosition): string {
  const rows: string[] = [];
  for (let r = 7; r >= 0; r--) {
    let row = "";
    let empty = 0;
    for (let f = 0; f < 8; f++) {
      const piece = position.board[r * 8 + f]!;
      if (!piece) { empty++; continue; }
      if (empty) { row += empty; empty = 0; }
      row += piece;
    }
    rows.push(row + (empty ? empty : ""));
  }
  return rows.join("/");
}

const KNIGHT = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]] as const;
const KING = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]] as const;
const BISHOP = [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const;
const ROOK = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

function step(square: number, df: number, dr: number): number {
  const f = fileOf(square) + df;
  const r = rankOf(square) + dr;
  return f < 0 || f > 7 || r < 0 || r > 7 ? -1 : r * 8 + f;
}

/** Whether `by` attacks `square`. */
export function isAttacked(position: ChessPosition, square: number, by: ChessColor): boolean {
  const board = position.board;
  const own = (piece: string) => colorOf(piece) === by;
  // Pawns attack diagonally forward, so look one rank back from the target.
  const dir = by === "w" ? -1 : 1;
  for (const df of [-1, 1]) {
    const from = step(square, df, dir);
    if (from >= 0 && own(board[from]!) && typeOf(board[from]!) === "p") return true;
  }
  for (const [df, dr] of KNIGHT) {
    const from = step(square, df, dr);
    if (from >= 0 && own(board[from]!) && typeOf(board[from]!) === "n") return true;
  }
  for (const [df, dr] of KING) {
    const from = step(square, df, dr);
    if (from >= 0 && own(board[from]!) && typeOf(board[from]!) === "k") return true;
  }
  for (const [lines, kinds] of [[BISHOP, "bq"], [ROOK, "rq"]] as const) {
    for (const [df, dr] of lines) {
      let from = step(square, df, dr);
      while (from >= 0) {
        const piece = board[from]!;
        if (piece) {
          if (own(piece) && kinds.includes(typeOf(piece))) return true;
          break;
        }
        from = step(from, df, dr);
      }
    }
  }
  return false;
}

const kingSquare = (position: ChessPosition, color: ChessColor) => position.board.indexOf(color === "w" ? "K" : "k");
export const inCheck = (position: ChessPosition, color: ChessColor = position.turn): boolean => isAttacked(position, kingSquare(position, color), other(color));

function pseudoMoves(position: ChessPosition): ChessMove[] {
  const moves: ChessMove[] = [];
  const { board, turn } = position;
  const add = (from: number, to: number, extra: Partial<ChessMove> = {}) => {
    const captured = board[to] || undefined;
    moves.push({ from, to, piece: board[from]!, ...(captured ? { captured } : {}), ...extra });
  };
  for (let from = 0; from < 64; from++) {
    const piece = board[from]!;
    if (colorOf(piece) !== turn) continue;
    const type = typeOf(piece);
    if (type === "p") {
      const dir = turn === "w" ? 1 : -1;
      const startRank = turn === "w" ? 1 : 6;
      const lastRank = turn === "w" ? 7 : 0;
      const pawnTo = (to: number, extra: Partial<ChessMove> = {}) => {
        if (rankOf(to) === lastRank) for (const promotion of ["q", "r", "b", "n"] as const) add(from, to, { ...extra, promotion });
        else add(from, to, extra);
      };
      const one = step(from, 0, dir);
      if (one >= 0 && !board[one]) {
        pawnTo(one);
        const two = step(from, 0, 2 * dir);
        if (rankOf(from) === startRank && !board[two]) add(from, two);
      }
      for (const df of [-1, 1]) {
        const to = step(from, df, dir);
        if (to < 0) continue;
        if (board[to] && colorOf(board[to]!) !== turn) pawnTo(to);
        else if (to === position.ep) moves.push({ from, to, piece, captured: turn === "w" ? "p" : "P", special: "e" });
      }
      continue;
    }
    if (type === "n" || type === "k") {
      for (const [df, dr] of type === "n" ? KNIGHT : KING) {
        const to = step(from, df, dr);
        if (to >= 0 && colorOf(board[to]!) !== turn) add(from, to);
      }
      if (type === "k") {
        const home = turn === "w" ? 4 : 60;
        const enemy = other(turn);
        if (from === home && !isAttacked(position, home, enemy)) {
          const [kingSide, queenSide, rook] = turn === "w" ? ["K", "Q", "R"] : ["k", "q", "r"];
          if (position.castling.includes(kingSide) && board[home + 3] === rook && !board[home + 1] && !board[home + 2]
            && !isAttacked(position, home + 1, enemy) && !isAttacked(position, home + 2, enemy)) add(from, home + 2, { special: "k" });
          if (position.castling.includes(queenSide) && board[home - 4] === rook && !board[home - 1] && !board[home - 2] && !board[home - 3]
            && !isAttacked(position, home - 1, enemy) && !isAttacked(position, home - 2, enemy)) add(from, home - 2, { special: "q" });
        }
      }
      continue;
    }
    const lines = type === "b" ? BISHOP : type === "r" ? ROOK : [...BISHOP, ...ROOK];
    for (const [df, dr] of lines) {
      let to = step(from, df, dr);
      while (to >= 0) {
        if (!board[to]) add(from, to);
        else {
          if (colorOf(board[to]!) !== turn) add(from, to);
          break;
        }
        to = step(to, df, dr);
      }
    }
  }
  return moves;
}

/** The position after `move` (which must come from `legalMoves`). */
export function applyMove(position: ChessPosition, move: ChessMove): ChessPosition {
  const board = position.board.slice();
  const turn = position.turn;
  board[move.to] = move.promotion ? (turn === "w" ? move.promotion.toUpperCase() : move.promotion) : move.piece;
  board[move.from] = "";
  if (move.special === "e") board[move.to + (turn === "w" ? -8 : 8)] = "";
  if (move.special === "k") { board[move.to - 1] = board[move.to + 1]!; board[move.to + 1] = ""; }
  if (move.special === "q") { board[move.to + 1] = board[move.to - 2]!; board[move.to - 2] = ""; }
  let castling = position.castling;
  const drop = (rights: string) => { for (const right of rights) castling = castling.replace(right, ""); };
  if (move.piece === "K") drop("KQ");
  if (move.piece === "k") drop("kq");
  for (const square of [move.from, move.to]) {
    if (square === 0) drop("Q");
    if (square === 7) drop("K");
    if (square === 56) drop("q");
    if (square === 63) drop("k");
  }
  const pawn = typeOf(move.piece) === "p";
  return {
    board, turn: other(turn), castling,
    ep: pawn && Math.abs(move.to - move.from) === 16 ? (move.from + move.to) / 2 : -1,
    halfmove: pawn || move.captured ? 0 : position.halfmove + 1,
    fullmove: position.fullmove + (turn === "b" ? 1 : 0),
  };
}

export function legalMoves(position: ChessPosition): ChessMove[] {
  return pseudoMoves(position).filter(move => !inCheck(applyMove(position, move), position.turn));
}

/** Insufficient material for either side to mate: bare kings, a lone minor piece, or bishops all on one colour. */
export function insufficientMaterial(position: ChessPosition): boolean {
  const pieces: Array<{ type: PieceType; square: number }> = [];
  position.board.forEach((piece, square) => { if (piece && typeOf(piece) !== "k") pieces.push({ type: typeOf(piece), square }); });
  if (pieces.length === 0) return true;
  if (pieces.length === 1) return pieces[0]!.type === "b" || pieces[0]!.type === "n";
  if (pieces.every(piece => piece.type === "b")) {
    const shade = (square: number) => (fileOf(square) + rankOf(square)) % 2;
    return pieces.every(piece => shade(piece.square) === shade(pieces[0]!.square));
  }
  return false;
}

/** Whether `color` has anything that could ever mate (used when the other side's clock runs out). */
export function canMate(position: ChessPosition, color: ChessColor): boolean {
  const own = position.board.filter(piece => piece && colorOf(piece) === color && typeOf(piece) !== "k").map(typeOf);
  if (own.some(type => type === "p" || type === "r" || type === "q")) return true;
  // Two minor pieces (or one against enemy material that can block) can mate; a lone minor cannot against a bare king.
  if (own.length >= 2) return true;
  if (own.length === 1) return position.board.some(piece => piece && colorOf(piece) !== color && typeOf(piece) !== "k");
  return false;
}

/** The repetition key: placement, side to move, castling and an en-passant square only when a capture there is possible. */
export function repetitionKey(position: ChessPosition): string {
  const epUsable = position.ep >= 0 && legalMoves(position).some(move => move.special === "e");
  return `${placement(position)} ${position.turn} ${position.castling || "-"} ${epUsable ? squareName(position.ep) : "-"}`;
}

/** How the game ended by itself after reaching `position`, given every earlier repetition key (including this one). */
export function gameEnd(position: ChessPosition, keys: readonly string[]): ChessEnd | null {
  const moves = legalMoves(position);
  if (moves.length === 0) return inCheck(position) ? { reason: "checkmate", winner: other(position.turn) } : { reason: "stalemate", winner: null };
  if (insufficientMaterial(position)) return { reason: "material", winner: null };
  const key = keys[keys.length - 1];
  if (key && keys.filter(item => item === key).length >= 3) return { reason: "repetition", winner: null };
  if (position.halfmove >= 100) return { reason: "fifty", winner: null };
  return null;
}

/** Standard algebraic notation for a legal move in `position`. */
export function toSan(position: ChessPosition, move: ChessMove): string {
  let san: string;
  if (move.special === "k") san = "O-O";
  else if (move.special === "q") san = "O-O-O";
  else {
    const type = typeOf(move.piece);
    const capture = Boolean(move.captured);
    if (type === "p") {
      san = `${capture ? `${FILES[fileOf(move.from)]}x` : ""}${squareName(move.to)}${move.promotion ? `=${move.promotion.toUpperCase()}` : ""}`;
    } else {
      const rivals = legalMoves(position).filter(other => other.piece === move.piece && other.to === move.to && other.from !== move.from);
      let hint = "";
      if (rivals.length) {
        const sameFile = rivals.some(rival => fileOf(rival.from) === fileOf(move.from));
        const sameRank = rivals.some(rival => rankOf(rival.from) === rankOf(move.from));
        if (!sameFile) hint = FILES[fileOf(move.from)]!;
        else if (!sameRank) hint = String(rankOf(move.from) + 1);
        else hint = squareName(move.from);
      }
      san = `${type.toUpperCase()}${hint}${capture ? "x" : ""}${squareName(move.to)}`;
    }
  }
  const after = applyMove(position, move);
  if (inCheck(after)) san += legalMoves(after).length ? "+" : "#";
  return san;
}

/** Finds the legal move from → to (with the promotion piece when a pawn reaches the last rank). */
export function findMove(position: ChessPosition, from: number, to: number, promotion?: Promotion): ChessMove | null {
  const candidates = legalMoves(position).filter(move => move.from === from && move.to === to);
  if (!candidates.length) return null;
  if (candidates[0]!.promotion) return candidates.find(move => move.promotion === (promotion ?? "q")) ?? null;
  return candidates[0]!;
}

/** Counts leaf positions to `depth` (move generator self-test). */
export function perft(position: ChessPosition, depth: number): number {
  if (depth === 0) return 1;
  const moves = legalMoves(position);
  if (depth === 1) return moves.length;
  let total = 0;
  for (const move of moves) total += perft(applyMove(position, move), depth - 1);
  return total;
}

/** Captured pieces of each colour, from the material missing compared with a full set. */
export function capturedPieces(position: ChessPosition): { w: string[]; b: string[] } {
  const full: Record<string, number> = { p: 8, n: 2, b: 2, r: 2, q: 1 };
  const result = { w: [] as string[], b: [] as string[] };
  for (const color of ["w", "b"] as const) {
    for (const type of ["q", "r", "b", "n", "p"]) {
      const letter = color === "w" ? type.toUpperCase() : type;
      const missing = full[type]! - position.board.filter(piece => piece === letter).length;
      for (let i = 0; i < missing; i++) result[color].push(letter);
    }
  }
  return result;
}
