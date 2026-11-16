import { applyMove, findMove, parseFen, squareIndex, START_FEN, toFen, type ChessPosition, type Promotion } from "../../../src/shared/chess.js";
import type { ChessMoveView, ChessRoomView } from "../../../src/shared/chess-room.js";

/** Every position of a game, from the start: index 0 before the first move, n after move n. */
export function replay(moves: readonly ChessMoveView[]): ChessPosition[] {
  let position = parseFen(START_FEN)!;
  const positions = [position];
  for (const move of moves) {
    const promotion = /=([QRBN])/.exec(move.san)?.[1]?.toLowerCase() as Promotion | undefined;
    const legal = findMove(position, squareIndex(move.from), squareIndex(move.to), promotion);
    if (!legal) break;
    position = applyMove(position, legal);
    positions.push(position);
  }
  return positions;
}

const tag = (name: string, value: string) => `[${name} "${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"]`;

/** The game as PGN, ready to open on lichess or in any chess program. */
export function toPgn(room: ChessRoomView, date: Date = new Date()): string {
  const result = room.result ? (room.result.winner === "w" ? "1-0" : room.result.winner === "b" ? "0-1" : "1/2-1/2") : "*";
  const name = (seat: ChessRoomView["white"]) => seat ? (seat.bot ? `Stockfish (level ${seat.bot.level})` : seat.name) : "?";
  const day = `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, "0")}.${String(date.getDate()).padStart(2, "0")}`;
  const headers = [
    tag("Event", "WebSpeak channel game"), tag("Site", "WebSpeak"), tag("Date", day), tag("Round", "-"),
    tag("White", name(room.white)), tag("Black", name(room.black)), tag("Result", result),
    tag("TimeControl", room.clock ? `${room.clock.minutes * 60}+${room.clock.increment}` : "-"),
    ...(room.result ? [tag("Termination", room.result.reason)] : []),
  ];
  const words: string[] = [];
  room.moves.forEach((move, index) => {
    if (index % 2 === 0) words.push(`${index / 2 + 1}.`);
    words.push(move.san);
  });
  words.push(result);
  // PGN keeps lines under 80 characters.
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (line && line.length + word.length + 1 > 79) { lines.push(line); line = word; }
    else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return `${headers.join("\n")}\n\n${lines.join("\n")}\n`;
}

export { toFen };
