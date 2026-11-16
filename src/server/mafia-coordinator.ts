import { DEFAULT_MAFIA_SETTINGS, dealtMafia, isMafiaSide, MAFIA_CHAT_KEEP, MAFIA_MAX_PLAYERS, MAFIA_MIN_PLAYERS, type MafiaClientMessage, type MafiaLogEntry, type MafiaPhase, type MafiaRole, type MafiaRoomView, type MafiaServerMessage, type MafiaSettings, type MafiaSide } from "../shared/mafia.js";

/*
 * One mafia table per channel (`<target key>#<channel id>`), in memory. The
 * gateway is the host: it deals the roles, keeps the night secret and counts
 * the votes. Players belong to a seat key (unique id or nickname), so a
 * reconnecting player keeps their role. Every page connected to the channel
 * gets its own filtered view after each change. No Node-only imports.
 */

export interface MafiaParticipant {
  entryId: string;
  nickname: string;
  seatKey: string;
  roomKey: string | null;
}

export interface MafiaCoordinatorOptions {
  send: (entryId: string, message: MafiaServerMessage) => void;
  now?: () => number;
  randomId?: () => string;
  /** An integer in [0, max). */
  random?: (max: number) => number;
  setTimer?: (callback: () => void, ms: number) => unknown;
  clearTimer?: (timer: unknown) => void;
}

interface Player {
  id: string;
  key: string;
  name: string;
  alive: boolean;
  role: MafiaRole | null;
}

interface Room {
  id: string;
  phase: MafiaPhase;
  round: number;
  host: string | null;
  settings: MafiaSettings;
  players: Player[];
  nextPlayer: number;
  deadline: number | null;
  timer: unknown;
  /** Night choices by player id (the don's search for the detective under `<id>:check`). */
  acts: Map<string, string>;
  lastHeal: string | null;
  lastVisit: string | null;
  checks: Array<{ round: number; target: string; mafia: boolean | null }>;
  donChecks: Array<{ round: number; target: string; detective: boolean | null }>;
  votes: Map<string, string>;
  chat: Array<{ from: string; text: string; at: number }>;
  log: MafiaLogEntry[];
  winner: MafiaSide | null;
}

interface Member { roomKey: string; nickname: string; seatKey: string }
interface Bucket { tokens: number; updatedAt: number }

const RATE = { rate: 4, burst: 16 };
export const MAFIA_IDLE_MS = 2 * 60 * 60_000;
const LOG_KEEP = 80;

const defaultRandom = (max: number): number => {
  const values = new Uint32Array(1);
  globalThis.crypto.getRandomValues(values);
  return values[0]! % max;
};

export class MafiaCoordinator {
  private readonly rooms = new Map<string, Room>();
  private readonly members = new Map<string, Member>();
  private readonly buckets = new Map<string, Bucket>();
  private readonly emptySince = new Map<string, number>();
  private readonly now: () => number;
  private readonly randomId: () => string;
  private readonly random: (max: number) => number;
  private readonly setTimer: (callback: () => void, ms: number) => unknown;
  private readonly clearTimer: (timer: unknown) => void;

  constructor(private readonly options: MafiaCoordinatorOptions) {
    this.now = options.now ?? Date.now;
    this.randomId = options.randomId ?? (() => Math.random().toString(36).slice(2, 12));
    this.random = options.random ?? defaultRandom;
    this.setTimer = options.setTimer ?? ((callback, ms) => {
      const timer = setTimeout(callback, ms);
      (timer as { unref?: () => void }).unref?.();
      return timer;
    });
    this.clearTimer = options.clearTimer ?? (timer => clearTimeout(timer as ReturnType<typeof setTimeout>));
  }

  handleMessage(participant: MafiaParticipant, message: MafiaClientMessage): void {
    if (message.type === "mafiaClose") { this.removePeer(participant.entryId); return; }
    if (!participant.roomKey) { this.error(participant.entryId, "NO_CHANNEL"); return; }
    if (message.type === "mafiaOpen") { this.join(participant); return; }
    const member = this.members.get(participant.entryId);
    if (!member || member.roomKey !== participant.roomKey) { this.error(participant.entryId, "MAFIA_NOT_OPEN"); return; }
    if (!this.take(participant.entryId)) { this.error(participant.entryId, "RATE_LIMITED"); return; }
    const code = this.apply(member, message);
    if (code) this.error(participant.entryId, code);
  }

  onRoomChanged(participant: MafiaParticipant): void {
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
    const room = this.rooms.get(member.roomKey);
    // Someone who leaves the channel before the game starts leaves the table too.
    if (room?.phase === "lobby" && !this.online(member.roomKey, member.seatKey)) {
      room.players = room.players.filter(player => player.key !== member.seatKey);
      if (room.host === member.seatKey) room.host = room.players[0]?.key ?? null;
    }
    this.broadcast(member.roomKey);
    this.forgetIdle();
  }

  roomCount(): number {
    return this.rooms.size;
  }

  private join(participant: MafiaParticipant): void {
    const previous = this.members.get(participant.entryId);
    if (previous && previous.roomKey !== participant.roomKey) this.removePeer(participant.entryId);
    const roomKey = participant.roomKey!;
    this.members.set(participant.entryId, { roomKey, nickname: participant.nickname, seatKey: participant.seatKey });
    this.emptySince.delete(roomKey);
    this.forgetIdle();
    this.room(roomKey);
    this.broadcast(roomKey);
  }

  private room(key: string): Room {
    let room = this.rooms.get(key);
    if (!room) {
      room = {
        id: this.randomId(), phase: "lobby", round: 0, host: null, settings: { ...DEFAULT_MAFIA_SETTINGS }, players: [], nextPlayer: 1,
        deadline: null, timer: null, acts: new Map(), lastHeal: null, lastVisit: null, checks: [], donChecks: [], votes: new Map(), chat: [], log: [], winner: null,
      };
      this.rooms.set(key, room);
    }
    return room;
  }

  private online(roomKey: string, seatKey: string): boolean {
    for (const member of this.members.values()) if (member.roomKey === roomKey && member.seatKey === seatKey) return true;
    return false;
  }

  private apply(member: Member, message: MafiaClientMessage): string | null {
    const key = member.roomKey;
    const room = this.room(key);
    const me = room.players.find(player => player.key === member.seatKey) ?? null;
    const isHost = room.host === member.seatKey;
    const inGame = room.phase !== "lobby" && room.phase !== "over";
    switch (message.type) {
      case "mafiaJoin":
        if (me) return null;
        if (room.phase !== "lobby" && room.phase !== "over") return "MAFIA_IN_PROGRESS";
        if (room.players.length >= MAFIA_MAX_PLAYERS) return "MAFIA_FULL";
        if (room.phase === "over") this.toLobby(room);
        room.players.push({ id: `p${room.nextPlayer++}`, key: member.seatKey, name: member.nickname, alive: true, role: null });
        room.host ??= member.seatKey;
        break;
      case "mafiaLeave":
        if (!me) return null;
        if (inGame) {
          if (me.alive) this.kill(room, me, { kind: "left", name: me.name, role: this.revealed(room, me) });
          if (!this.checkWin(room)) this.maybeResolve(key, room);
        } else {
          room.players = room.players.filter(player => player !== me);
          if (room.host === me.key) room.host = room.players[0]?.key ?? null;
        }
        break;
      case "mafiaSettings":
        if (!isHost) return "MAFIA_NOT_HOST";
        if (room.phase !== "lobby" && room.phase !== "over") return "MAFIA_IN_PROGRESS";
        room.settings = { ...message.settings };
        break;
      case "mafiaKick": {
        if (!isHost) return "MAFIA_NOT_HOST";
        const target = room.players.find(player => player.id === message.player);
        if (!target || target === me) return null;
        if (inGame) {
          // During a game only someone who went away can be removed; they count as having left.
          if (this.online(key, target.key)) return "MAFIA_PLAYER_ONLINE";
          if (target.alive) this.kill(room, target, { kind: "left", name: target.name, role: this.revealed(room, target) });
          if (!this.checkWin(room)) this.maybeResolve(key, room);
        } else room.players = room.players.filter(player => player !== target);
        break;
      }
      case "mafiaStart": {
        if (!isHost) return "MAFIA_NOT_HOST";
        if (room.phase !== "lobby" && room.phase !== "over") return "MAFIA_IN_PROGRESS";
        if (room.phase === "over") this.toLobby(room);
        if (room.players.length < MAFIA_MIN_PLAYERS) return "MAFIA_TOO_FEW";
        const mafia = dealtMafia(room.players.length, room.settings);
        if (mafia === null) return "MAFIA_BAD_SETTINGS";
        this.deal(room, mafia);
        room.log = [{ kind: "start", players: room.players.length, mafia }];
        this.startNight(key, room);
        break;
      }
      case "mafiaAct": {
        if (message.id !== room.id || room.phase !== "night") return "MAFIA_STALE";
        if (!me?.alive || me.role === "citizen" || !me.role) return "MAFIA_NO_ACTION";
        const donCheck = message.ability === "check";
        if (donCheck && me.role !== "don") return "MAFIA_NO_ACTION";
        const slot = donCheck ? `${me.id}:check` : me.id;
        // The mafia may change their mind until they agree; everyone else chooses once.
        if (room.acts.has(slot) && (donCheck || !isMafiaSide(me.role))) return "MAFIA_ALREADY_ACTED";
        const target = room.players.find(player => player.id === message.target && player.alive);
        if (!target) return "MAFIA_BAD_TARGET";
        if (donCheck) {
          if (isMafiaSide(target.role)) return "MAFIA_BAD_TARGET";
        } else {
          if (isMafiaSide(me.role) && isMafiaSide(target.role)) return "MAFIA_BAD_TARGET";
          if ((me.role === "detective" || me.role === "maniac" || me.role === "mistress") && target === me) return "MAFIA_BAD_TARGET";
          if (me.role === "doctor" && target.id === room.lastHeal) return "MAFIA_HEALED_LAST_NIGHT";
          if (me.role === "mistress" && target.id === room.lastVisit) return "MAFIA_VISITED_LAST_NIGHT";
        }
        room.acts.set(slot, target.id);
        this.maybeResolve(key, room);
        break;
      }
      case "mafiaVote": {
        if (message.id !== room.id || room.phase !== "vote") return "MAFIA_STALE";
        if (!me?.alive) return "MAFIA_NOT_ALIVE";
        if (message.target !== "skip" && (message.target === me.id || !room.players.some(player => player.id === message.target && player.alive))) return "MAFIA_BAD_TARGET";
        room.votes.set(me.id, message.target);
        this.maybeResolve(key, room);
        break;
      }
      case "mafiaAdvance":
        if (message.id !== room.id || !inGame) return "MAFIA_STALE";
        if (!isHost) return "MAFIA_NOT_HOST";
        this.advance(key, room);
        break;
      case "mafiaChat":
        if (message.id !== room.id || !inGame) return "MAFIA_STALE";
        if (!me || !isMafiaSide(me.role)) return "MAFIA_NOT_MAFIA";
        room.chat.push({ from: me.id, text: message.text, at: this.now() });
        if (room.chat.length > MAFIA_CHAT_KEEP) room.chat.splice(0, room.chat.length - MAFIA_CHAT_KEEP);
        break;
      case "mafiaHost":
        if (!me) return "MAFIA_NOT_PLAYING";
        if (room.host && room.host !== me.key && this.online(key, room.host)) return "MAFIA_HOST_ONLINE";
        room.host = me.key;
        break;
      case "mafiaReset":
        if (!isHost) return "MAFIA_NOT_HOST";
        this.toLobby(room);
        break;
      default:
        return null;
    }
    this.broadcast(key);
    return null;
  }

  private deal(room: Room, mafia: number): void {
    const roles: MafiaRole[] = [];
    for (let i = 0; i < mafia; i++) roles.push(i === 0 && room.settings.don ? "don" : "mafia");
    if (room.settings.doctor) roles.push("doctor");
    if (room.settings.detective) roles.push("detective");
    if (room.settings.maniac) roles.push("maniac");
    if (room.settings.mistress) roles.push("mistress");
    while (roles.length < room.players.length) roles.push("citizen");
    // Fisher–Yates with the gateway's fair random numbers.
    for (let i = roles.length - 1; i > 0; i--) {
      const j = this.random(i + 1);
      [roles[i], roles[j]] = [roles[j]!, roles[i]!];
    }
    room.players.forEach((player, index) => { player.role = roles[index]!; player.alive = true; });
    room.id = this.randomId();
    room.round = 0;
    room.lastHeal = null;
    room.lastVisit = null;
    room.checks = [];
    room.donChecks = [];
    room.chat = [];
    room.winner = null;
  }

  private toLobby(room: Room): void {
    this.disarm(room);
    room.phase = "lobby";
    room.round = 0;
    room.deadline = null;
    room.acts.clear();
    room.votes.clear();
    room.chat = [];
    room.winner = null;
    room.id = this.randomId();
    for (const player of room.players) { player.alive = true; player.role = null; }
  }

  private startNight(key: string, room: Room): void {
    room.phase = "night";
    room.round += 1;
    room.acts.clear();
    room.votes.clear();
    this.pushLog(room, { kind: "night", round: room.round });
    this.arm(key, room, room.settings.nightSeconds);
  }

  /**
   * Whether the night can end early: every living player who acts at night has
   * done so and the mafia agree on one victim. A split mafia keeps talking
   * until they agree or the time runs out (then the lot decides between the leaders).
   */
  private nightDone(room: Room): boolean {
    const done = room.players.every(player => !player.alive || player.role === "citizen"
      || (room.acts.has(player.id) && (player.role !== "don" || room.acts.has(`${player.id}:check`))));
    if (!done) return false;
    const picks = new Set(room.players.filter(player => player.alive && isMafiaSide(player.role)).map(player => room.acts.get(player.id)));
    return picks.size <= 1;
  }

  private maybeResolve(key: string, room: Room): void {
    if (room.phase === "night" && this.nightDone(room)) this.resolveNight(key, room);
    else if (room.phase === "vote" && room.players.every(player => !player.alive || room.votes.has(player.id))) this.resolveVote(key, room);
  }

  private advance(key: string, room: Room): void {
    if (room.phase === "night") this.resolveNight(key, room);
    else if (room.phase === "day") this.startVote(key, room);
    else if (room.phase === "vote") this.resolveVote(key, room);
  }

  /**
   * The morning. The mistress's visit comes first: the player she visited does
   * nothing that night (a visited mafioso's vote does not count). Then the
   * mafia's victim (most votes of those not visited, a tie by lot) and the
   * maniac's, unless the doctor healed them; the detective's and the don's
   * checks are answered now, so a visited checker learns nothing.
   */
  private resolveNight(key: string, room: Room): void {
    const actor = (role: MafiaRole) => room.players.find(player => player.alive && player.role === role) ?? null;
    const mistress = actor("mistress");
    const visited = mistress ? room.acts.get(mistress.id) ?? null : null;
    room.lastVisit = visited;
    const acts = (player: Player | null, slot = player?.id ?? "") => (player && player.id !== visited ? room.acts.get(slot) ?? null : null);
    const tally = new Map<string, number>();
    for (const player of room.players) {
      if (!player.alive || !isMafiaSide(player.role)) continue;
      const target = acts(player);
      if (target) tally.set(target, (tally.get(target) ?? 0) + 1);
    }
    const doctor = actor("doctor");
    const heal = acts(doctor);
    room.lastHeal = doctor ? room.acts.get(doctor.id) ?? null : null;
    const top = Math.max(0, ...tally.values());
    const leaders = [...tally.entries()].filter(([, count]) => count === top && top > 0).map(([id]) => id);
    const mafiaVictim = leaders.length ? leaders[this.random(leaders.length)]! : null;
    const maniacVictim = acts(actor("maniac"));
    const roleOf = (id: string) => room.players.find(player => player.id === id)?.role ?? null;
    const detective = actor("detective");
    const checked = detective ? room.acts.get(detective.id) : undefined;
    if (detective && checked) room.checks.push({ round: room.round, target: checked, mafia: detective.id === visited ? null : isMafiaSide(roleOf(checked)) });
    const don = actor("don");
    const searched = don ? room.acts.get(`${don.id}:check`) : undefined;
    if (don && searched) room.donChecks.push({ round: room.round, target: searched, detective: don.id === visited ? null : roleOf(searched) === "detective" });
    const victims = [...new Set([mafiaVictim, maniacVictim])]
      .filter((id): id is string => !!id && id !== heal)
      .map(id => room.players.find(player => player.id === id && player.alive))
      .filter((player): player is Player => !!player);
    for (const victim of victims) this.kill(room, victim, { kind: "killed", round: room.round, name: victim.name, role: this.revealed(room, victim) });
    if (!victims.length) this.pushLog(room, { kind: "quiet", round: room.round });
    if (this.checkWin(room)) return;
    room.phase = "day";
    room.acts.clear();
    this.arm(key, room, room.settings.daySeconds);
  }

  private startVote(key: string, room: Room): void {
    room.phase = "vote";
    room.votes.clear();
    this.arm(key, room, room.settings.voteSeconds);
  }

  private resolveVote(key: string, room: Room): void {
    const tally = new Map<string, number>();
    for (const player of room.players) {
      const target = player.alive ? room.votes.get(player.id) : undefined;
      if (target) tally.set(target, (tally.get(target) ?? 0) + 1);
    }
    const skip = tally.get("skip") ?? 0;
    tally.delete("skip");
    const top = Math.max(0, ...tally.values());
    const leaders = [...tally.entries()].filter(([, count]) => count === top).map(([id]) => id);
    // Only a single clear leader with more votes than "nobody" leaves the town.
    const chosen = leaders.length === 1 && top > skip ? room.players.find(player => player.id === leaders[0] && player.alive) ?? null : null;
    if (chosen) this.kill(room, chosen, { kind: "executed", round: room.round, name: chosen.name, role: this.revealed(room, chosen), votes: top });
    else this.pushLog(room, { kind: "spared", round: room.round });
    if (this.checkWin(room)) return;
    this.startNight(key, room);
  }

  private kill(room: Room, player: Player, entry: MafiaLogEntry): void {
    player.alive = false;
    room.acts.delete(player.id);
    room.votes.delete(player.id);
    this.pushLog(room, entry);
  }

  private revealed(room: Room, player: Player): MafiaRole | null {
    return room.settings.reveal ? player.role : null;
  }

  private checkWin(room: Room): boolean {
    const alive = room.players.filter(player => player.alive);
    const mafia = alive.filter(player => isMafiaSide(player.role)).length;
    const maniac = alive.some(player => player.role === "maniac");
    // The maniac wins once at most one other is left; the mafia only once the maniac is gone.
    const winner: MafiaSide | null = maniac
      ? (alive.length <= 2 ? "maniac" : null)
      : mafia === 0 ? "town" : mafia * 2 >= alive.length ? "mafia" : null;
    if (!winner) return false;
    this.disarm(room);
    room.phase = "over";
    room.winner = winner;
    room.deadline = null;
    this.pushLog(room, { kind: "win", side: winner });
    return true;
  }

  private pushLog(room: Room, entry: MafiaLogEntry): void {
    room.log.push(entry);
    if (room.log.length > LOG_KEEP) room.log.splice(0, room.log.length - LOG_KEEP);
  }

  private arm(key: string, room: Room, seconds: number): void {
    this.disarm(room);
    room.deadline = seconds ? this.now() + seconds * 1000 : null;
    if (!seconds) return;
    const phase = room.phase;
    const round = room.round;
    const id = room.id;
    room.timer = this.setTimer(() => {
      room.timer = null;
      if (this.rooms.get(key) !== room || room.id !== id || room.phase !== phase || room.round !== round) return;
      this.advance(key, room);
      this.broadcast(key);
    }, seconds * 1000);
  }

  private disarm(room: Room): void {
    if (room.timer !== null) this.clearTimer(room.timer);
    room.timer = null;
  }

  private view(key: string, seatKey: string): MafiaRoomView {
    const room = this.room(key);
    const me = room.players.find(player => player.key === seatKey) ?? null;
    const over = room.phase === "over";
    const iAmMafia = isMafiaSide(me?.role);
    const visibleRole = (player: Player): MafiaRole | null => {
      if (!player.role) return null;
      if (over || player === me) return player.role;
      if (iAmMafia && isMafiaSide(player.role)) return player.role;
      if (!player.alive && room.settings.reveal) return player.role;
      return null;
    };
    const voting = room.phase === "vote";
    const inPlay = new Set(room.players.map(player => player.key));
    const spectators = new Set<string>();
    for (const member of this.members.values()) if (member.roomKey === key && !inPlay.has(member.seatKey)) spectators.add(member.nickname);
    const secret: MafiaRoomView["secret"] = {};
    if (me && !over && room.phase !== "lobby") {
      if (isMafiaSide(me.role)) {
        secret.picks = room.phase === "night"
          ? room.players.filter(player => isMafiaSide(player.role) && player.alive && room.acts.has(player.id)).map(player => ({ from: player.id, to: room.acts.get(player.id)! }))
          : [];
      }
      if (me.role === "don") {
        secret.donChecks = room.donChecks.map(check => ({ ...check }));
        secret.donCheck = room.phase === "night" ? room.acts.get(`${me.id}:check`) ?? null : null;
      }
      if (me.role === "doctor") secret.lastHeal = room.lastHeal;
      if (me.role === "mistress") secret.lastVisit = room.lastVisit;
      if (me.role === "detective") secret.checks = room.checks.map(check => ({ ...check }));
    }
    return {
      id: room.id, phase: room.phase, round: room.round,
      endsIn: room.deadline === null ? null : Math.max(0, room.deadline - this.now()),
      settings: { ...room.settings },
      players: room.players.map(player => ({
        id: player.id, name: player.name, online: this.online(key, player.key), alive: player.alive, role: visibleRole(player),
        you: player === me, host: player.key === room.host, vote: voting ? room.votes.get(player.id) ?? null : null,
      })),
      you: me?.id ?? null, youHost: !!me && room.host === me.key,
      acted: me && room.phase === "night" ? room.acts.get(me.id) ?? null : null,
      secret,
      chat: iAmMafia || (over && me) ? room.chat.map(message => ({ ...message })) : [],
      log: room.log.map(entry => ({ ...entry })),
      winner: room.winner,
      spectators: [...spectators].sort((a, b) => a.localeCompare(b)),
    };
  }

  private broadcast(key: string): void {
    if (!this.rooms.has(key)) return;
    for (const [entryId, member] of this.members) {
      if (member.roomKey === key) this.options.send(entryId, { type: "mafiaState", room: this.view(key, member.seatKey) });
    }
  }

  private forgetIdle(): void {
    const now = this.now();
    const occupied = new Set([...this.members.values()].map(member => member.roomKey));
    for (const [key, room] of this.rooms) {
      if (occupied.has(key)) { this.emptySince.delete(key); continue; }
      const since = this.emptySince.get(key);
      if (since === undefined) this.emptySince.set(key, now);
      else if (now - since > MAFIA_IDLE_MS) { this.disarm(room); this.rooms.delete(key); this.emptySince.delete(key); }
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
    this.options.send(entryId, { type: "mafiaError", code });
  }
}

