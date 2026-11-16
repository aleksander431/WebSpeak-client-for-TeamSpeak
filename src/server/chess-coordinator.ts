import { applyMove, canMate, findMove, gameEnd, parseFen, repetitionKey, squareIndex, squareName, START_FEN, toFen, toSan, type ChessColor, type ChessPosition } from "../shared/chess.js";
import { CHESS_ABANDON_MS, type ChessClientMessage, type ChessMoveView, type ChessResultReason, type ChessRoomView, type ChessSeatView, type ChessServerMessage } from "../shared/chess-room.js";

/*
 * One chess board per channel (`<target key>#<channel id>`), in memory. Seats
 * belong to a seat key (unique id or nickname), so a reconnecting player keeps
 * theirs; every page connected to the channel gets the board after each
 * change. The gateway checks moves and runs the clocks. No Node-only imports.
 */

export interface ChessParticipant {
  entryId: string;
  nickname: string;
  seatKey: string;
  /** null while the session has no channel. */
  roomKey: string | null;
}

export interface ChessCoordinatorOptions {
  send: (entryId: string, message: ChessServerMessage) => void;
  now?: () => number;
  randomId?: () => string;
  setTimer?: (callback: () => void, ms: number) => unknown;
  clearTimer?: (timer: unknown) => void;
}

/** A seat: a person, or the computer, whose moves the owner's page plays. */
interface Seat { key: string; name: string; bot?: { level: number; owner: string } }

interface Room {
  id: string;
  phase: "waiting" | "playing" | "over";
  seats: { w: Seat | null; b: Seat | null };
  clock: { minutes: number; increment: number } | null;
  /** Milliseconds left for each side when `turnStartedAt` was set. */
  times: { w: number; b: number };
  turnStartedAt: number;
  position: ChessPosition;
  keys: string[];
  moves: ChessMoveView[];
  result: { winner: ChessColor | null; reason: ChessResultReason } | null;
  drawOffer: ChessColor | null;
  rematch: Set<ChessColor>;
  flag: unknown;
}

interface Member { roomKey: string; nickname: string; seatKey: string }
interface Bucket { tokens: number; updatedAt: number }

const RATE = { rate: 6, burst: 20 };
/** A board nobody in the channel looks at is forgotten after this long. */
export const CHESS_IDLE_MS = 2 * 60 * 60_000;
const other = (color: ChessColor): ChessColor => (color === "w" ? "b" : "w");

export class ChessCoordinator {
  private readonly rooms = new Map<string, Room>();
  private readonly members = new Map<string, Member>();
  private readonly buckets = new Map<string, Bucket>();
  private readonly emptySince = new Map<string, number>();
  /** When a person (`<room key>|<seat key>`) last left a channel's board. */
  private readonly leftAt = new Map<string, number>();
  private readonly now: () => number;
  private readonly randomId: () => string;
  private readonly setTimer: (callback: () => void, ms: number) => unknown;
  private readonly clearTimer: (timer: unknown) => void;

  constructor(private readonly options: ChessCoordinatorOptions) {
    this.now = options.now ?? Date.now;
    this.randomId = options.randomId ?? (() => Math.random().toString(36).slice(2, 12));
    this.setTimer = options.setTimer ?? ((callback, ms) => {
      const timer = setTimeout(callback, ms);
      (timer as { unref?: () => void }).unref?.();
      return timer;
    });
    this.clearTimer = options.clearTimer ?? (timer => clearTimeout(timer as ReturnType<typeof setTimeout>));
  }

  handleMessage(participant: ChessParticipant, message: ChessClientMessage): void {
    if (message.type === "chessClose") { this.removePeer(participant.entryId); return; }
    if (!participant.roomKey) { this.error(participant.entryId, "NO_CHANNEL"); return; }
    if (message.type === "chessOpen") { this.join(participant); return; }
    const member = this.members.get(participant.entryId);
    if (!member || member.roomKey !== participant.roomKey) { this.error(participant.entryId, "CHESS_NOT_OPEN"); return; }
    if (!this.take(participant.entryId)) { this.error(participant.entryId, "RATE_LIMITED"); return; }
    const code = this.apply(member, message);
    if (code) this.error(participant.entryId, code);
  }

  onRoomChanged(participant: ChessParticipant): void {
    const member = this.members.get(participant.entryId);
    if (!member || member.roomKey === participant.roomKey) return;
    this.removePeer(participant.entryId);
    if (participant.roomKey) this.join(participant);
  }

  removePeer(entryId: string): void {
    const member = this.members.get(entryId);
    this.members.delete(entryId);
    this.buckets.delete(entryId);
    if (!member) return;
    if (!this.online(member.roomKey, member.seatKey)) this.leftAt.set(`${member.roomKey}|${member.seatKey}`, this.now());
    this.broadcast(member.roomKey);
    this.forgetIdle();
  }

  roomCount(): number {
    return this.rooms.size;
  }

  private join(participant: ChessParticipant): void {
    const previous = this.members.get(participant.entryId);
    if (previous && previous.roomKey !== participant.roomKey) this.removePeer(participant.entryId);
    const roomKey = participant.roomKey!;
    this.members.set(participant.entryId, { roomKey, nickname: participant.nickname, seatKey: participant.seatKey });
    this.leftAt.delete(`${roomKey}|${participant.seatKey}`);
    this.emptySince.delete(roomKey);
    this.forgetIdle();
    this.room(roomKey);
    // Everyone sees the newcomer among the onlookers (or a seat coming back online).
    this.broadcast(roomKey);
  }

  private room(key: string): Room {
    let room = this.rooms.get(key);
    if (!room) {
      room = {
        id: this.randomId(), phase: "waiting", seats: { w: null, b: null }, clock: { minutes: 10, increment: 0 },
        times: { w: 600_000, b: 600_000 }, turnStartedAt: 0, position: parseFen(START_FEN)!, keys: [], moves: [],
        result: null, drawOffer: null, rematch: new Set(), flag: null,
      };
      room.keys.push(repetitionKey(room.position));
      this.rooms.set(key, room);
    }
    return room;
  }

  private online(roomKey: string, seatKey: string): boolean {
    for (const member of this.members.values()) if (member.roomKey === roomKey && member.seatKey === seatKey) return true;
    return false;
  }

  /** Whether whoever plays this seat is in the channel (the computer follows its owner). */
  private seatOnline(roomKey: string, seat: Seat | null): boolean {
    return !!seat && this.online(roomKey, seat.bot ? seat.bot.owner : seat.key);
  }

  /** How long the person behind a seat has been away, or null while present. */
  private seatAway(roomKey: string, seat: Seat): number | null {
    if (this.seatOnline(roomKey, seat)) return null;
    const key = `${roomKey}|${seat.bot ? seat.bot.owner : seat.key}`;
    if (!this.leftAt.has(key)) this.leftAt.set(key, this.now());
    return this.now() - this.leftAt.get(key)!;
  }

  private colorOf(room: Room, seatKey: string): ChessColor | null {
    if (room.seats.w?.key === seatKey) return "w";
    if (room.seats.b?.key === seatKey) return "b";
    return null;
  }

  private apply(member: Member, message: ChessClientMessage): string | null {
    const key = member.roomKey;
    const room = this.room(key);
    const mine = this.colorOf(room, member.seatKey);
    switch (message.type) {
      case "chessSit": {
        if (room.phase === "playing") {
          // A game both players walked away from no longer holds the board.
          if (this.seatOnline(key, room.seats.w) || this.seatOnline(key, room.seats.b)) return "CHESS_IN_PROGRESS";
          this.reset(room);
          room.seats = { w: null, b: null };
        }
        const seat = room.seats[message.color];
        // A seat is free, or held by someone who left the channel.
        if (seat && seat.key !== member.seatKey && this.seatOnline(key, seat)) return "CHESS_SEAT_TAKEN";
        if (mine) room.seats[mine] = null;
        room.seats[message.color] = { key: member.seatKey, name: member.nickname };
        if (room.phase === "over") this.reset(room);
        break;
      }
      case "chessBot": {
        if (room.phase === "playing") return "CHESS_IN_PROGRESS";
        if (!mine) return "CHESS_NOT_SEATED";
        const color = other(mine);
        const seat = room.seats[color];
        if (seat && !seat.bot && this.seatOnline(key, seat)) return "CHESS_SEAT_TAKEN";
        room.seats[color] = { key: `bot:${member.seatKey}`, name: "Stockfish", bot: { level: message.level, owner: member.seatKey } };
        if (room.phase === "over") this.reset(room);
        break;
      }
      case "chessStand":
        if (!mine) return null;
        if (room.phase === "playing") return "CHESS_IN_PROGRESS";
        room.seats[mine] = null;
        // One's computer opponent leaves with its owner.
        for (const color of ["w", "b"] as const) if (room.seats[color]?.bot?.owner === member.seatKey) room.seats[color] = null;
        if (room.phase === "over") this.reset(room);
        break;
      case "chessClaim": {
        if (room.id !== message.id || room.phase !== "playing") return "CHESS_STALE";
        if (!mine) return "CHESS_NOT_SEATED";
        const away = this.seatAway(key, room.seats[other(mine)]!);
        if (away === null || away < CHESS_ABANDON_MS) return "CHESS_OPPONENT_HERE";
        this.finish(room, mine, "abandon");
        break;
      }
      case "chessClock":
        if (room.phase === "playing") return "CHESS_IN_PROGRESS";
        if (!mine) return "CHESS_NOT_SEATED";
        room.clock = message.minutes ? { minutes: message.minutes, increment: message.increment } : null;
        if (room.phase === "over") this.reset(room);
        break;
      case "chessStart":
        if (room.phase === "playing") return null;
        if (!mine) return "CHESS_NOT_SEATED";
        if (!room.seats.w || !room.seats.b) return "CHESS_NEED_TWO";
        this.start(room);
        break;
      case "chessMove": {
        if (room.id !== message.id || room.phase !== "playing") return "CHESS_STALE";
        // The owner's page plays the computer's moves.
        const turnSeat = room.seats[room.position.turn];
        const playsTurn = mine === room.position.turn || turnSeat?.bot?.owner === member.seatKey;
        if (!playsTurn) return "CHESS_NOT_YOUR_TURN";
        if (this.flagFell(key, room)) return null;
        const move = findMove(room.position, squareIndex(message.from), squareIndex(message.to), message.promotion);
        if (!move) return "CHESS_ILLEGAL";
        const now = this.now();
        const mover = room.position.turn;
        if (room.clock) {
          room.times[mover] = Math.max(0, room.times[mover] - (now - room.turnStartedAt)) + room.clock.increment * 1000;
        }
        room.moves.push({ san: toSan(room.position, move), from: squareName(move.from), to: squareName(move.to) });
        room.position = applyMove(room.position, move);
        room.keys.push(repetitionKey(room.position));
        room.turnStartedAt = now;
        // A move answers an offer from the other side by declining it; one's own offer stands.
        if (room.drawOffer && room.drawOffer !== mover) room.drawOffer = null;
        const end = gameEnd(room.position, room.keys);
        if (end) this.finish(room, end.winner, end.reason);
        else this.armFlag(key, room);
        break;
      }
      case "chessResign":
        if (room.id !== message.id || room.phase !== "playing") return "CHESS_STALE";
        if (!mine) return "CHESS_NOT_SEATED";
        this.finish(room, other(mine), "resign");
        break;
      case "chessDraw":
        if (room.id !== message.id || room.phase !== "playing") return "CHESS_STALE";
        if (!mine) return "CHESS_NOT_SEATED";
        if (room.seats[other(mine)]?.bot) return "CHESS_BOT_PLAYS_ON";
        if (message.action === "offer") {
          if (room.drawOffer === mine) return null;
          if (room.drawOffer === other(mine)) this.finish(room, null, "agreement");
          else room.drawOffer = mine;
        } else if (message.action === "accept") {
          if (room.drawOffer !== other(mine)) return "CHESS_NO_OFFER";
          this.finish(room, null, "agreement");
        } else {
          if (room.drawOffer !== other(mine)) return null;
          room.drawOffer = null;
        }
        break;
      case "chessRematch":
        if (room.id !== message.id || room.phase !== "over") return "CHESS_STALE";
        if (!mine) return "CHESS_NOT_SEATED";
        room.rematch.add(mine);
        // The computer is always up for another game.
        if (room.seats[other(mine)]?.bot) room.rematch.add(other(mine));
        if (room.rematch.size === 2 && room.seats.w && room.seats.b) {
          // Colours swap for the return game.
          room.seats = { w: room.seats.b, b: room.seats.w };
          this.start(room);
        }
        break;
      default:
        return null;
    }
    this.broadcast(key);
    return null;
  }

  private reset(room: Room): void {
    this.disarm(room);
    Object.assign(room, {
      id: this.randomId(), phase: "waiting", position: parseFen(START_FEN)!, moves: [], result: null, drawOffer: null, rematch: new Set(),
    });
    room.keys = [repetitionKey(room.position)];
  }

  private start(room: Room): void {
    this.reset(room);
    room.phase = "playing";
    const ms = (room.clock?.minutes ?? 0) * 60_000;
    room.times = { w: ms, b: ms };
    room.turnStartedAt = this.now();
    const key = [...this.rooms.entries()].find(([, value]) => value === room)?.[0];
    if (key) this.armFlag(key, room);
  }

  private finish(room: Room, winner: ChessColor | null, reason: ChessResultReason): void {
    this.disarm(room);
    if (room.clock && room.phase === "playing") {
      const turn = room.position.turn;
      room.times[turn] = Math.max(0, room.times[turn] - (this.now() - room.turnStartedAt));
    }
    room.phase = "over";
    room.result = { winner, reason };
    room.drawOffer = null;
    room.rematch = new Set();
  }

  /** The side to move ran out of time: a loss, or a draw when the other side has nothing to mate with. */
  private flagFell(key: string, room: Room): boolean {
    if (!room.clock || room.phase !== "playing") return false;
    const turn = room.position.turn;
    if (room.times[turn] - (this.now() - room.turnStartedAt) > 0) return false;
    const winner = other(turn);
    this.finish(room, canMate(room.position, winner) ? winner : null, canMate(room.position, winner) ? "timeout" : "timeoutDraw");
    room.times[turn] = 0;
    this.broadcast(key);
    return true;
  }

  private armFlag(key: string, room: Room): void {
    this.disarm(room);
    if (!room.clock || room.phase !== "playing") return;
    const left = room.times[room.position.turn] - (this.now() - room.turnStartedAt);
    const id = room.id;
    room.flag = this.setTimer(() => {
      room.flag = null;
      if (this.rooms.get(key) === room && room.id === id) this.flagFell(key, room);
    }, Math.max(0, left) + 20);
  }

  private disarm(room: Room): void {
    if (room.flag !== null) this.clearTimer(room.flag);
    room.flag = null;
  }

  private view(key: string, seatKey: string): ChessRoomView {
    const room = this.room(key);
    const seat = (value: Seat | null): ChessSeatView | null => value ? {
      name: value.name, online: this.seatOnline(key, value), away: this.seatAway(key, value),
      ...(value.bot ? { bot: { level: value.bot.level, mine: value.bot.owner === seatKey } } : {}),
    } : null;
    const seated = new Set([room.seats.w?.key, room.seats.b?.key]);
    const spectators = new Set<string>();
    for (const member of this.members.values()) if (member.roomKey === key && !seated.has(member.seatKey)) spectators.add(member.nickname);
    const playing = room.phase === "playing";
    const elapsed = playing ? this.now() - room.turnStartedAt : 0;
    const times = room.clock ? {
      w: Math.max(0, room.times.w - (playing && room.position.turn === "w" ? elapsed : 0)),
      b: Math.max(0, room.times.b - (playing && room.position.turn === "b" ? elapsed : 0)),
    } : null;
    return {
      id: room.id, phase: room.phase, white: seat(room.seats.w), black: seat(room.seats.b), you: this.colorOf(room, seatKey),
      clock: room.clock ? { ...room.clock } : null, times: room.phase === "waiting" && room.clock ? { w: room.clock.minutes * 60_000, b: room.clock.minutes * 60_000 } : times,
      running: playing && room.clock ? room.position.turn : null,
      fen: toFen(room.position), moves: room.moves.map(move => ({ ...move })), result: room.result ? { ...room.result } : null,
      drawOffer: room.drawOffer, rematch: [...room.rematch], spectators: [...spectators].sort((a, b) => a.localeCompare(b)),
    };
  }

  private broadcast(key: string): void {
    if (!this.rooms.has(key)) return;
    for (const [entryId, member] of this.members) {
      if (member.roomKey === key) this.options.send(entryId, { type: "chessState", room: this.view(key, member.seatKey) });
    }
  }

  private forgetIdle(): void {
    const now = this.now();
    const occupied = new Set([...this.members.values()].map(member => member.roomKey));
    for (const [key, room] of this.rooms) {
      if (occupied.has(key)) { this.emptySince.delete(key); continue; }
      const since = this.emptySince.get(key);
      if (since === undefined) this.emptySince.set(key, now);
      else if (now - since > CHESS_IDLE_MS) { this.disarm(room); this.rooms.delete(key); this.emptySince.delete(key); }
    }
  }

  private take(entryId: string): boolean {
    const now = this.now();
    const bucket = this.buckets.get(entryId) ?? { tokens: RATE.burst, updatedAt: now };
    bucket.tokens = Math.min(RATE.burst, bucket.tokens + (now - bucket.updatedAt) / 1000 * RATE.rate);
    bucket.updatedAt = now;
    this.buckets.set(entryId, bucket);
    if (bucket.tokens < 1) return false;
    bucket.tokens -= 1;
    return true;
  }

  private error(entryId: string, code: string): void {
    this.options.send(entryId, { type: "chessError", code });
  }
}
