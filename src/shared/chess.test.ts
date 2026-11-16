import assert from "node:assert/strict";
import test from "node:test";
import { applyMove, canMate, findMove, gameEnd, legalMoves, parseFen, perft, repetitionKey, squareIndex, START_FEN, toFen, toSan, type ChessPosition } from "./chess.js";

const fen = (text: string): ChessPosition => {
  const position = parseFen(text);
  assert.ok(position, text);
  return position;
};
const play = (position: ChessPosition, ...sans: string[]): ChessPosition => {
  for (const san of sans) {
    const move = legalMoves(position).find(candidate => toSan(position, candidate).replace(/[+#]$/, "") === san.replace(/[+#]$/, ""));
    assert.ok(move, `${san} in ${toFen(position)}`);
    position = applyMove(position, move);
  }
  return position;
};

test("move generation matches the standard perft counts", () => {
  const start = fen(START_FEN);
  assert.equal(perft(start, 1), 20);
  assert.equal(perft(start, 2), 400);
  assert.equal(perft(start, 3), 8902);
  // "Kiwipete": castling, en passant, promotions and pins together.
  const kiwipete = fen("r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1");
  assert.equal(perft(kiwipete, 1), 48);
  assert.equal(perft(kiwipete, 2), 2039);
  assert.equal(perft(kiwipete, 3), 97862);
  // Position 3: en passant discovered checks along the rank.
  assert.equal(perft(fen("8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1"), 4), 43238);
  // Position 4: promotions and castling under attack.
  assert.equal(perft(fen("r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1"), 3), 9467);
  // Position 5.
  assert.equal(perft(fen("rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8"), 3), 62379);
});

test("FEN round trip and rejecting nonsense", () => {
  assert.equal(toFen(fen(START_FEN)), START_FEN);
  assert.equal(parseFen("8/8/8/8/8/8/8/8 w - - 0 1"), null, "no kings");
  assert.equal(parseFen("rnbqkbnr/pppppppp/9/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"), null);
  assert.equal(parseFen("hello"), null);
});

test("notation: disambiguation, castling, en passant, promotion, check and mate", () => {
  const start = fen(START_FEN);
  const scholar = play(start, "e4", "e5", "Qh5", "Nc6", "Bc4", "Nf6");
  const mate = legalMoves(scholar).find(move => move.to === squareIndex("f7") && move.piece === "Q")!;
  assert.equal(toSan(scholar, mate), "Qxf7#");
  assert.deepEqual(gameEnd(applyMove(scholar, mate), []), { reason: "checkmate", winner: "w" });

  const knights = fen("4k3/8/8/8/8/8/8/N1N1K3 w - - 0 1");
  assert.ok(legalMoves(knights).some(move => toSan(knights, move) === "Nab3"));
  const rooks = fen("4k3/8/8/R7/8/8/8/R3K3 w - - 0 1");
  assert.ok(legalMoves(rooks).some(move => toSan(rooks, move) === "R1a3"));

  const castle = fen("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1");
  const sans = legalMoves(castle).map(move => toSan(castle, move));
  assert.ok(sans.includes("O-O") && sans.includes("O-O-O"));
  const castled = applyMove(castle, findMove(castle, squareIndex("e1"), squareIndex("g1"))!);
  assert.equal(castled.board[squareIndex("f1")], "R");
  assert.equal(castled.castling, "kq");

  const ep = play(start, "e4", "a6", "e5", "d5");
  const capture = findMove(ep, squareIndex("e5"), squareIndex("d6"))!;
  assert.equal(capture.special, "e");
  assert.equal(toSan(ep, capture), "exd6");
  assert.equal(applyMove(ep, capture).board[squareIndex("d5")], "");

  const promote = fen("8/P6k/8/8/8/8/8/K7 w - - 0 1");
  assert.equal(findMove(promote, squareIndex("a7"), squareIndex("a8"))?.promotion, "q", "queen by default");
  const knight = findMove(promote, squareIndex("a7"), squareIndex("a8"), "n")!;
  assert.equal(toSan(promote, knight), "a8=N");
  assert.equal(applyMove(promote, knight).board[squareIndex("a8")], "N");
});

test("draws by themselves: stalemate, material, repetition, fifty moves; and who can still mate", () => {
  assert.deepEqual(gameEnd(fen("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1"), []), { reason: "stalemate", winner: null });
  assert.deepEqual(gameEnd(fen("8/8/4k3/8/8/2B5/8/4K3 b - - 0 1"), []), { reason: "material", winner: null });
  assert.deepEqual(gameEnd(fen("8/8/4k3/8/8/2B5/1b6/4K3 w - - 0 1"), []), { reason: "material", winner: null }, "bishops on one colour");
  assert.equal(gameEnd(fen("8/8/4k3/8/8/2B5/8/1b2K3 w - - 0 1"), []), null, "bishops on both colours");
  assert.deepEqual(gameEnd(fen("8/8/4k3/8/8/8/8/R3K3 b - - 100 80"), []), { reason: "fifty", winner: null });

  let position = fen(START_FEN);
  const keys = [repetitionKey(position)];
  for (let i = 0; i < 2; i++) {
    for (const san of ["Nf3", "Nf6", "Ng1", "Ng8"]) { position = play(position, san); keys.push(repetitionKey(position)); }
  }
  assert.deepEqual(gameEnd(position, keys), { reason: "repetition", winner: null });

  assert.equal(canMate(fen("8/8/4k3/8/8/2N5/8/4K3 w - - 0 1"), "w"), false);
  assert.equal(canMate(fen("8/8/4k3/8/8/2N5/8/4K3 w - - 0 1"), "b"), false);
  assert.equal(canMate(fen("8/8/4k3/8/8/8/P7/4K3 w - - 0 1"), "w"), true);
  assert.equal(canMate(fen("8/8/4k3/4p3/8/2N5/8/4K3 w - - 0 1"), "w"), true, "a knight against a pawn can mate");
});
