import assert from "node:assert/strict";
import test from "node:test";
import { toFen } from "../../../src/shared/chess.js";
import type { ChessRoomView } from "../../../src/shared/chess-room.js";
import { parseBestMove } from "./chess-engine.js";
import { replay, toPgn } from "./chess-pgn.js";
import { soundForSan } from "./chess-sounds.js";

const room = (moves: Array<[string, string, string]>, extra: Partial<ChessRoomView> = {}): ChessRoomView => ({
  id: "g1", phase: "over", you: "w", clock: { minutes: 5, increment: 3 }, times: null, running: null, fen: "", drawOffer: null, rematch: [], spectators: [],
  white: { name: "Ann", online: true, away: null }, black: { name: "Stockfish", online: true, away: null, bot: { level: 4, mine: true } },
  result: { winner: "w", reason: "checkmate" },
  moves: moves.map(([san, from, to]) => ({ san, from, to })),
  ...extra,
});

test("a game is replayed position by position, promotions included", () => {
  const positions = replay(room([["e4", "e2", "e4"], ["e5", "e7", "e5"], ["Qh5", "d1", "h5"]]).moves);
  assert.equal(positions.length, 4);
  assert.equal(toFen(positions[0]!), "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
  assert.equal(toFen(positions[3]!).split(" ")[0], "rnbqkbnr/pppp1ppp/8/4p2Q/4P3/8/PPPP1PPP/RNB1KBNR");
});

test("PGN with headers, numbered moves and the result", () => {
  const pgn = toPgn(room([["e4", "e2", "e4"], ["e5", "e7", "e5"], ["Bc4", "f1", "c4"], ["Nc6", "b8", "c6"], ["Qh5", "d1", "h5"], ["Nf6", "g8", "f6"], ["Qxf7#", "h5", "f7"]]), new Date(2026, 10, 16));
  assert.match(pgn, /^\[Event "WebSpeak channel game"\]$/m);
  assert.match(pgn, /^\[Date "2026\.11\.16"\]$/m);
  assert.match(pgn, /^\[Black "Stockfish \(level 4\)"\]$/m);
  assert.match(pgn, /^\[TimeControl "300\+3"\]$/m);
  assert.match(pgn, /\n\n1\. e4 e5 2\. Bc4 Nc6 3\. Qh5 Nf6 4\. Qxf7# 1-0\n$/);
});

test("engine answers and move sounds", () => {
  assert.deepEqual(parseBestMove("bestmove e7e8q ponder a2a3"), { from: "e7", to: "e8", promotion: "q" });
  assert.deepEqual(parseBestMove("bestmove g1f3"), { from: "g1", to: "f3" });
  assert.equal(parseBestMove("bestmove (none)"), null);
  assert.deepEqual(["e4", "exd5", "Qh5+", "Qxf7#"].map(soundForSan), ["move", "capture", "check", "end"]);
});
