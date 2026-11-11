import {
  MAX_PLAYERS,
  ROLL_LOG_SIZE,
  SKILLS,
  abilityModifier,
  formatModifier,
  parseDiceExpression,
  saveBonus,
  skillBonus,
  type CheckSource,
  type CheckView,
  type DiceExpression,
  type GameClientMessage,
  type GameServerMessage,
  type HeroSheet,
  type RollDie,
  type RollMode,
  type RollSource,
  type RollView,
  type SeatView,
  type TableRole,
  type TableView,
} from "../shared/tabletop.js";
import { findAdventure, findHero } from "../shared/tabletop-adventures.js";

/*
 * Channel game tables. No Node-only imports, like the whiteboard coordinator.
 *
 * Each channel (`<target key>#<channel id>`) has one table. A browser that
 * opens the game panel subscribes to its channel's table; every change sends
 * each subscriber its own view (the game master sees hidden rolls and check
 * difficulties, players do not). Seats belong to a seat key (the TeamSpeak
 * unique id, or the nickname without one), so a reconnecting player keeps
 * the seat. Every die is rolled here.
 */

export interface TableParticipant {
  entryId: string;
  nickname: string;
  /** Stable per person: unique id, or nickname without one. */
  seatKey: string;
  /** null while the session has no channel. */
  tableKey: string | null;
}

interface SeatState {
  key: string;
  nickname: string;
  ready: boolean;
  heroId: string | null;
  hp: number | null;
}

interface RollRecord extends RollView {
  byKey: string;
}

interface CheckRecord {
  id: string;
  label: string;
  source: CheckSource;
  dc: number;
  mode: RollMode;
  targets: string[];
  done: string[];
}

interface TableState {
  phase: "lobby" | "playing";
  adventureId: string | null;
  gm: SeatState | null;
  players: SeatState[];
  rolls: RollRecord[];
  checks: CheckRecord[];
  updatedAt: number;
}

interface Subscription { tableKey: string; seatKey: string; nickname: string }
interface Bucket { tokens: number; updatedAt: number }

export interface TabletopCoordinatorOptions {
  send: (entryId: string, message: GameServerMessage) => void;
  /** Uniform integer in [1, sides]. */
  rollDie?: (sides: number) => number;
  now?: () => number;
  randomId?: () => string;
}

/** Table key for a TeamSpeak channel: target key plus channel id. */
export function tabletopTableKey(targetKey: string, channelId: bigint | number | string): string {
  return `${targetKey}#${channelId}`;
}

const RATE = { rate: 8, burst: 20 };
/** Tables nobody touched for this long are dropped once nobody watches them. */
const IDLE_TABLE_MS = 12 * 60 * 60 * 1000;

function defaultRollDie(sides: number): number {
  const crypto = (globalThis as { crypto?: { getRandomValues?: (array: Uint32Array) => Uint32Array } }).crypto;
  if (!crypto?.getRandomValues) return 1 + Math.floor(Math.random() * sides);
  const limit = Math.floor(0x1_0000_0000 / sides) * sides;
  const buffer = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buffer);
    if (buffer[0]! < limit) return 1 + (buffer[0]! % sides);
  }
}

function defaultRandomId(): string {
  const crypto = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (crypto?.randomUUID) return crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

const ABILITY_LABEL = { str: "Сила", dex: "Ловкость", con: "Телосложение", int: "Интеллект", wis: "Мудрость", cha: "Харизма" } as const;
const SKILL_LABEL: Record<keyof typeof SKILLS, string> = {
  acrobatics: "Акробатика", animalHandling: "Уход за животными", arcana: "Магия", athletics: "Атлетика", deception: "Обман",
  history: "История", insight: "Проницательность", intimidation: "Запугивание", investigation: "Анализ", medicine: "Медицина",
  nature: "Природа", perception: "Внимательность", performance: "Выступление", persuasion: "Убеждение", religion: "Религия",
  sleightOfHand: "Ловкость рук", stealth: "Скрытность", survival: "Выживание",
};

export function checkLabel(source: CheckSource): string {
  if (source.type === "skill") return `${ABILITY_LABEL[SKILLS[source.skill]]} (${SKILL_LABEL[source.skill]})`;
  if (source.type === "save") return `Спасбросок: ${ABILITY_LABEL[source.ability]}`;
  return `Проверка: ${ABILITY_LABEL[source.ability]}`;
}

export class TabletopCoordinator {
  private readonly tables = new Map<string, TableState>();
  private readonly subscriptions = new Map<string, Subscription>();
  private readonly buckets = new Map<string, Bucket>();
  private readonly sendRaw: TabletopCoordinatorOptions["send"];
  private readonly rollDie: (sides: number) => number;
  private readonly now: () => number;
  private readonly randomId: () => string;

  constructor(options: TabletopCoordinatorOptions) {
    this.sendRaw = options.send;
    this.rollDie = options.rollDie ?? defaultRollDie;
    this.now = options.now ?? Date.now;
    this.randomId = options.randomId ?? defaultRandomId;
  }

  handleMessage(participant: TableParticipant, message: GameClientMessage): void {
    if (message.type === "gameClose") {
      this.removePeer(participant.entryId);
      return;
    }
    if (!participant.tableKey) {
      this.error(participant.entryId, "NO_CHANNEL");
      return;
    }
    if (message.type === "gameOpen") {
      this.subscribe(participant);
      return;
    }
    if (!this.take(participant.entryId)) {
      this.error(participant.entryId, "RATE_LIMITED");
      return;
    }
    const subscription = this.subscriptions.get(participant.entryId);
    if (!subscription || subscription.tableKey !== participant.tableKey) {
      this.error(participant.entryId, "TABLE_NOT_OPEN");
      return;
    }
    const table = this.table(subscription.tableKey);
    const code = this.apply(table, subscription, message);
    if (code) {
      this.error(participant.entryId, code);
      return;
    }
    table.updatedAt = this.now();
    this.broadcast(subscription.tableKey);
  }

  /** The session moved to another channel (or lost it): follow with the open panel. */
  onTableChanged(participant: TableParticipant): void {
    const subscription = this.subscriptions.get(participant.entryId);
    if (!subscription || subscription.tableKey === participant.tableKey) return;
    this.subscriptions.delete(participant.entryId);
    this.broadcast(subscription.tableKey);
    if (participant.tableKey) this.subscribe(participant);
    else this.sendRaw(participant.entryId, { type: "gameState", table: null });
  }

  removePeer(entryId: string): void {
    const subscription = this.subscriptions.get(entryId);
    this.subscriptions.delete(entryId);
    this.buckets.delete(entryId);
    if (subscription) this.broadcast(subscription.tableKey);
    this.dropIdleTables();
  }

  /** For tests and diagnostics. */
  tableCount(): number {
    return this.tables.size;
  }

  private subscribe(participant: TableParticipant): void {
    const tableKey = participant.tableKey!;
    this.subscriptions.set(participant.entryId, { tableKey, seatKey: participant.seatKey, nickname: participant.nickname });
    const table = this.table(tableKey);
    // A returning seat holder gets its current nickname.
    for (const seat of [table.gm, ...table.players]) if (seat?.key === participant.seatKey) seat.nickname = participant.nickname;
    this.broadcast(tableKey);
  }

  private table(key: string): TableState {
    let table = this.tables.get(key);
    if (!table) {
      table = { phase: "lobby", adventureId: null, gm: null, players: [], rolls: [], checks: [], updatedAt: this.now() };
      this.tables.set(key, table);
    }
    return table;
  }

  private dropIdleTables(): void {
    const watched = new Set([...this.subscriptions.values()].map(subscription => subscription.tableKey));
    for (const [key, table] of this.tables) {
      const empty = !table.gm && !table.players.length;
      if (!watched.has(key) && (empty || this.now() - table.updatedAt > IDLE_TABLE_MS)) this.tables.delete(key);
    }
  }

  private online(tableKey: string, seatKey: string): boolean {
    for (const subscription of this.subscriptions.values()) if (subscription.tableKey === tableKey && subscription.seatKey === seatKey) return true;
    return false;
  }

  private roleOf(table: TableState, seatKey: string): TableRole {
    if (table.gm?.key === seatKey) return "gm";
    return table.players.some(seat => seat.key === seatKey) ? "player" : "spectator";
  }

  private apply(table: TableState, who: Subscription, message: Exclude<GameClientMessage, { type: "gameOpen" | "gameClose" }>): string | null {
    const role = this.roleOf(table, who.seatKey);
    const ownSeat = role === "gm" ? table.gm : table.players.find(seat => seat.key === who.seatKey) ?? null;
    switch (message.type) {
      case "gameSeat": {
        if (message.role === role) return null;
        if (message.role === "gm" && table.gm && this.online(who.tableKey, table.gm.key)) return "GM_SEAT_TAKEN";
        if (message.role === "player" && table.players.length >= MAX_PLAYERS) return "TABLE_FULL";
        if (role === "gm") table.gm = null;
        if (role === "player") table.players = table.players.filter(seat => seat.key !== who.seatKey);
        const seat: SeatState = { key: who.seatKey, nickname: who.nickname, ready: false, heroId: null, hp: null };
        if (message.role === "gm") table.gm = seat;
        if (message.role === "player") table.players.push(seat);
        return null;
      }
      case "gameReady":
        if (!ownSeat) return "NOT_SEATED";
        ownSeat.ready = message.ready;
        return null;
      case "gameAdventure": {
        if (role !== "gm") return "GM_ONLY";
        if (table.phase !== "lobby") return "GAME_RUNNING";
        const adventure = findAdventure(message.adventureId);
        if (!adventure) return "UNKNOWN_ADVENTURE";
        table.adventureId = adventure.id;
        for (const seat of table.players) {
          if (!adventure.heroes.some(hero => hero.id === seat.heroId)) Object.assign(seat, { heroId: null, hp: null, ready: false });
        }
        return null;
      }
      case "gameHero": {
        if (role !== "player" || !ownSeat) return "PLAYERS_ONLY";
        if (table.phase !== "lobby") return "GAME_RUNNING";
        if (message.heroId === null) {
          Object.assign(ownSeat, { heroId: null, hp: null, ready: false });
          return null;
        }
        const hero = findHero(table.adventureId, message.heroId);
        if (!hero) return "UNKNOWN_HERO";
        if (table.players.some(seat => seat.key !== who.seatKey && seat.heroId === hero.id)) return "HERO_TAKEN";
        Object.assign(ownSeat, { heroId: hero.id, hp: hero.maxHp });
        return null;
      }
      case "gameStart": {
        if (role !== "gm") return "GM_ONLY";
        if (table.phase !== "lobby") return null;
        if (!table.adventureId) return "NO_ADVENTURE";
        const heroes = table.players.filter(seat => seat.heroId);
        if (!heroes.length) return "NO_PLAYERS";
        if (heroes.some(seat => !seat.ready)) return "PLAYERS_NOT_READY";
        table.phase = "playing";
        table.checks = [];
        return null;
      }
      case "gameEnd":
        if (role !== "gm") return "GM_ONLY";
        table.phase = "lobby";
        table.checks = [];
        for (const seat of [table.gm, ...table.players]) if (seat) seat.ready = false;
        return null;
      case "gameHp": {
        const seat = table.players.find(candidate => candidate.key === message.key);
        if (!seat?.heroId) return "UNKNOWN_SEAT";
        if (role !== "gm" && seat.key !== who.seatKey) return "NOT_YOUR_HERO";
        const hero = findHero(table.adventureId, seat.heroId);
        seat.hp = Math.max(-hero!.maxHp, Math.min(hero!.maxHp, message.hp));
        return null;
      }
      case "gameCheck": {
        if (role !== "gm") return "GM_ONLY";
        if (table.phase !== "playing") return "GAME_NOT_RUNNING";
        const withHeroes = table.players.filter(seat => seat.heroId).map(seat => seat.key);
        const targets = message.targets.length ? message.targets.filter(key => withHeroes.includes(key)) : withHeroes;
        if (!targets.length) return "NO_TARGETS";
        table.checks = [...table.checks.slice(-4), {
          id: this.randomId(), label: checkLabel(message.source), source: message.source, dc: message.dc, mode: message.mode, targets, done: [],
        }];
        return null;
      }
      case "gameCheckCancel":
        if (role !== "gm") return "GM_ONLY";
        table.checks = table.checks.filter(check => check.id !== message.checkId);
        return null;
      case "gameRoll":
        return this.roll(table, who, role, ownSeat, message);
    }
  }

  private roll(table: TableState, who: Subscription, role: TableRole, seat: SeatState | null,
    message: Extract<GameClientMessage, { type: "gameRoll" }>): string | null {
    if (role === "spectator" || !seat) return "NOT_SEATED";
    let source: RollSource = message.source;
    let mode = message.mode;
    let check: CheckRecord | undefined;
    if (message.checkId) {
      check = table.checks.find(candidate => candidate.id === message.checkId);
      if (!check || !check.targets.includes(who.seatKey) || check.done.includes(who.seatKey)) return "CHECK_NOT_PENDING";
      source = check.source;
      if (check.mode !== "normal") mode = check.mode;
    }
    const hero = role === "player" ? findHero(table.adventureId, seat.heroId) : undefined;
    const planned = this.plan(source, hero);
    if (!planned) return source.type === "free" ? "INVALID_DICE" : "NEEDS_HERO";
    const result = this.throwDice(planned.expression, planned.d20 ? mode : "normal");
    const record: RollRecord = {
      id: this.randomId(),
      at: this.now(),
      by: seat.nickname,
      byKey: seat.key,
      ...(hero ? { heroName: hero.name } : {}),
      label: check?.label ?? planned.label,
      hidden: role === "gm" && message.hidden,
      expr: planned.text,
      dice: result.dice,
      modifier: planned.expression.modifier,
      total: result.total,
      mode: planned.d20 ? mode : "normal",
      ...(result.natural ? { natural: result.natural } : {}),
    };
    if (check) {
      record.checkId = check.id;
      record.dc = check.dc;
      record.success = result.natural === 20 ? true : result.natural === 1 ? false : result.total >= check.dc;
      check.done.push(who.seatKey);
      if (check.targets.every(key => check!.done.includes(key))) table.checks = table.checks.filter(candidate => candidate !== check);
    }
    table.rolls = [...table.rolls, record].slice(-ROLL_LOG_SIZE);
    const tableKey = who.tableKey;
    for (const [entryId, subscription] of this.subscriptions) {
      if (subscription.tableKey !== tableKey) continue;
      this.sendRaw(entryId, { type: "gameRolled", roll: this.rollFor(record, this.roleOf(table, subscription.seatKey)) });
    }
    return null;
  }

  /** What a roll means: the dice, its label and whether it is a d20 roll (advantage applies). */
  private plan(source: RollSource, hero: HeroSheet | undefined): { expression: DiceExpression; text: string; label: string; d20: boolean } | null {
    const d20 = (modifier: number, label: string) => ({
      expression: { terms: [{ count: 1, sides: 20, sign: 1 as const }], modifier }, text: `1d20${modifier ? formatModifier(modifier) : ""}`, label, d20: true,
    });
    if (source.type === "free") {
      const expression = parseDiceExpression(source.expr);
      return expression ? { expression, text: source.expr.replace(/\s+/g, ""), label: "Бросок", d20: false } : null;
    }
    if (!hero) return null;
    switch (source.type) {
      case "ability": return d20(abilityModifier(hero.abilities[source.ability]), `Проверка: ${ABILITY_LABEL[source.ability]}`);
      case "skill": return d20(skillBonus(hero, source.skill), SKILL_LABEL[source.skill]);
      case "save": return d20(saveBonus(hero, source.ability), `Спасбросок: ${ABILITY_LABEL[source.ability]}`);
      case "initiative": return d20(abilityModifier(hero.abilities.dex), "Инициатива");
      case "attack": {
        const attack = hero.attacks[source.index];
        if (!attack || attack.bonus === null) return null;
        return d20(attack.bonus, `Атака: ${attack.name}`);
      }
      case "damage": {
        const attack = hero.attacks[source.index];
        const expression = attack ? parseDiceExpression(attack.damage) : null;
        if (!attack || !expression) return null;
        if (source.crit) expression.terms = expression.terms.map(term => ({ ...term, count: term.count * 2 }));
        const text = expression.terms.map(term => `${term.count}d${term.sides}`).join("+") + (expression.modifier ? formatModifier(expression.modifier) : "");
        return { expression, text, label: `Урон: ${attack.name}${source.crit ? " (крит)" : ""}`, d20: false };
      }
    }
  }

  private throwDice(expression: DiceExpression, mode: RollMode): { dice: RollDie[]; total: number; natural?: number } {
    const dice: RollDie[] = [];
    let total = expression.modifier;
    let natural: number | undefined;
    for (const term of expression.terms) {
      for (let index = 0; index < term.count; index++) {
        if (term.sides === 20 && expression.terms.length === 1 && term.count === 1 && mode !== "normal") {
          const first = this.rollDie(20);
          const second = this.rollDie(20);
          const keepFirst = mode === "advantage" ? first >= second : first <= second;
          dice.push({ sides: 20, value: first, ...(keepFirst ? {} : { dropped: true }) }, { sides: 20, value: second, ...(keepFirst ? { dropped: true } : {}) });
          natural = keepFirst ? first : second;
          total += natural;
          continue;
        }
        const value = this.rollDie(term.sides);
        dice.push({ sides: term.sides, value });
        total += term.sign * value;
        if (term.sides === 20 && expression.terms.length === 1 && term.count === 1) natural = value;
      }
    }
    return { dice, total, ...(natural ? { natural } : {}) };
  }

  private rollFor(record: RollRecord, role: TableRole): RollView {
    const { byKey: _byKey, ...view } = record;
    if (record.hidden && role !== "gm") return { id: record.id, at: record.at, by: record.by, label: "Скрытый бросок ведущего", secret: true, hidden: true };
    if (role !== "gm" && view.dc !== undefined) {
      const { dc: _dc, ...withoutDc } = view;
      return withoutDc;
    }
    return view;
  }

  private viewFor(tableKey: string, table: TableState, seatKey: string): TableView {
    const role = this.roleOf(table, seatKey);
    const seat = (state: SeatState): SeatView => ({
      key: state.key, nickname: state.nickname, online: this.online(tableKey, state.key), ready: state.ready, heroId: state.heroId, hp: state.hp,
    });
    const checks: CheckView[] = table.checks
      .filter(check => role === "gm" || check.targets.includes(seatKey))
      .map(check => ({ id: check.id, label: check.label, source: check.source, mode: check.mode, targets: check.targets, done: check.done, ...(role === "gm" ? { dc: check.dc } : {}) }));
    return {
      phase: table.phase,
      adventureId: table.adventureId,
      gm: table.gm ? { key: table.gm.key, nickname: table.gm.nickname, online: this.online(tableKey, table.gm.key), ready: table.gm.ready } : null,
      players: table.players.map(seat),
      you: { key: seatKey, role },
      rolls: table.rolls.map(record => this.rollFor(record, role)),
      checks,
    };
  }

  private broadcast(tableKey: string): void {
    const table = this.tables.get(tableKey);
    if (!table) return;
    for (const [entryId, subscription] of this.subscriptions) {
      if (subscription.tableKey === tableKey) this.sendRaw(entryId, { type: "gameState", table: this.viewFor(tableKey, table, subscription.seatKey) });
    }
  }

  private error(entryId: string, code: string): void {
    this.sendRaw(entryId, { type: "gameError", code });
  }

  private take(entryId: string): boolean {
    const now = this.now();
    const bucket = this.buckets.get(entryId) ?? { tokens: RATE.burst, updatedAt: now };
    bucket.tokens = Math.min(RATE.burst, bucket.tokens + ((now - bucket.updatedAt) / 1000) * RATE.rate);
    bucket.updatedAt = now;
    this.buckets.set(entryId, bucket);
    if (bucket.tokens < 1) return false;
    bucket.tokens -= 1;
    return true;
  }
}
