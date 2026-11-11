import {
  MAX_MAP_TOKENS,
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
  type CombatView,
  type HeroSheet,
  type MonsterSheet,
  type MapView,
  type SceneMap,
  type TokenView,
  type RollDie,
  type RollMode,
  type RollSource,
  type RollView,
  type SeatView,
  type TableRole,
  type TableView,
} from "../shared/tabletop.js";
import { findAdventure, findHero, findMonster } from "../shared/tabletop-adventures.js";

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
  dying?: { successes: number; failures: number; state: "dying" | "stable" | "dead" };
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

interface TokenRecord {
  id: string;
  kind: "hero" | "monster";
  x: number;
  y: number;
  name: string;
  seatKey?: string;
  heroId?: string;
  monsterId?: string;
  hp?: number;
  maxHp?: number;
  hidden: boolean;
}

/** One scene's board: what was revealed and where everyone stands. Kept per scene so going back finds it as it was. */
interface SceneState {
  fog: Uint8Array;
  tokens: TokenRecord[];
  /** Next number per monster kind ("Скелет 3"). */
  counters: Map<string, number>;
}

interface CombatantRecord {
  id: string;
  tokenId: string;
  kind: "hero" | "monster";
  name: string;
  seatKey?: string;
  heroId?: string;
  monsterId?: string;
  initiative: number | null;
  /** Dexterity score: breaks initiative ties. */
  dex: number;
}

/** A fight on the current map: who acts in which order and whose turn it is. */
interface CombatState {
  phase: "initiative" | "running";
  round: number;
  activeId: string | null;
  order: CombatantRecord[];
}

interface TableState {
  phase: "lobby" | "playing";
  adventureId: string | null;
  gm: SeatState | null;
  players: SeatState[];
  rolls: RollRecord[];
  checks: CheckRecord[];
  scene: number;
  scenes: Map<number, SceneState>;
  combat: CombatState | null;
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
/** Cells revealed around a hero when it first appears on a map. */
const SPAWN_REVEAL_RADIUS = 2;
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
    if (message.type === "gamePing") {
      const code = this.ping(table, subscription, message.x, message.y);
      if (code) this.error(participant.entryId, code);
      return;
    }
    const code = this.apply(table, subscription, message);
    if (code) {
      this.error(participant.entryId, code);
      return;
    }
    if (table.phase === "playing") {
      this.syncHeroTokens(table);
      this.syncCombat(table);
    } else {
      table.combat = null;
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
      table = { phase: "lobby", adventureId: null, gm: null, players: [], rolls: [], checks: [], scene: 0, scenes: new Map(), combat: null, updatedAt: this.now() };
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

  private apply(table: TableState, who: Subscription, message: Exclude<GameClientMessage, { type: "gameOpen" | "gameClose" | "gamePing" }>): string | null {
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
        for (const seat of heroes) {
          seat.hp = findHero(table.adventureId, seat.heroId)!.maxHp;
          delete seat.dying;
        }
        table.scene = 0;
        table.scenes = new Map();
        table.combat = null;
        table.combat = null;
        return null;
      }
      case "gameEnd":
        if (role !== "gm") return "GM_ONLY";
        table.phase = "lobby";
        table.checks = [];
        table.scene = 0;
        table.scenes = new Map();
        for (const seat of [table.gm, ...table.players]) if (seat) seat.ready = false;
        return null;
      case "gameHp": {
        const seat = table.players.find(candidate => candidate.key === message.key);
        if (!seat?.heroId) return "UNKNOWN_SEAT";
        if (role !== "gm" && seat.key !== who.seatKey) return "NOT_YOUR_HERO";
        this.setHeroHp(seat, message.hp, findHero(table.adventureId, seat.heroId)!.maxHp);
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
      case "gameCombatStart":
      case "gameCombatEnd":
      case "gameCombatNext":
      case "gameCombatPrev":
      case "gameCombatRollAll":
      case "gameApply":
        return this.applyCombat(table, who, role, message);
      default:
        return this.applyMap(table, who, role, message);
    }
  }

  // ---- Scenes, tokens and fog ------------------------------------------------

  private applyMap(table: TableState, who: Subscription, role: TableRole,
    message: Extract<GameClientMessage, { type: "gameScene" | "gameTokenAdd" | "gameTokenMove" | "gameTokenRemove" | "gameTokenHp" | "gameTokenHide" | "gameFog" | "gameFogAll" }>): string | null {
    if (table.phase !== "playing") return "GAME_NOT_RUNNING";
    if (message.type === "gameScene") {
      if (role !== "gm") return "GM_ONLY";
      if (!findAdventure(table.adventureId)?.scenes[message.index]) return "UNKNOWN_SCENE";
      if (table.scene !== message.index) table.combat = null;
      table.scene = message.index;
      return null;
    }
    const map = this.currentMap(table);
    if (!map) return "NO_MAP";
    const scene = this.sceneState(table, map);
    const inside = (x: number, y: number) => x < map.cols && y < map.rows;
    const occupied = (x: number, y: number, except?: string) => scene.tokens.some(token => token.x === x && token.y === y && token.id !== except);
    if (message.type === "gameTokenMove") {
      const token = scene.tokens.find(candidate => candidate.id === message.id);
      if (!token) return "UNKNOWN_TOKEN";
      if (role !== "gm" && !(role === "player" && token.kind === "hero" && token.seatKey === who.seatKey)) return "NOT_YOUR_TOKEN";
      if (!inside(message.x, message.y)) return "OUT_OF_BOUNDS";
      if (role !== "gm" && !scene.fog[message.y * map.cols + message.x]) return "IN_FOG";
      if (occupied(message.x, message.y, token.id)) return "CELL_TAKEN";
      token.x = message.x;
      token.y = message.y;
      return null;
    }
    if (role !== "gm") return "GM_ONLY";
    switch (message.type) {
      case "gameTokenAdd": {
        const monster = findMonster(table.adventureId, message.monsterId);
        if (!monster) return "UNKNOWN_MONSTER";
        if (!inside(message.x, message.y)) return "OUT_OF_BOUNDS";
        if (occupied(message.x, message.y)) return "CELL_TAKEN";
        if (scene.tokens.length >= MAX_MAP_TOKENS) return "TOO_MANY_TOKENS";
        const number = (scene.counters.get(monster.id) ?? 0) + 1;
        scene.counters.set(monster.id, number);
        scene.tokens.push({
          id: this.randomId(), kind: "monster", x: message.x, y: message.y, name: `${monster.name} ${number}`,
          monsterId: monster.id, hp: monster.maxHp, maxHp: monster.maxHp, hidden: false,
        });
        return null;
      }
      case "gameTokenRemove":
      case "gameTokenHp":
      case "gameTokenHide": {
        const token = scene.tokens.find(candidate => candidate.id === message.id);
        if (!token || token.kind !== "monster") return "UNKNOWN_TOKEN";
        if (message.type === "gameTokenRemove") scene.tokens = scene.tokens.filter(candidate => candidate !== token);
        else if (message.type === "gameTokenHp") token.hp = Math.max(0, Math.min(token.maxHp ?? 0, message.hp));
        else token.hidden = message.hidden;
        return null;
      }
      case "gameFog":
        for (const cell of message.cells) if (cell < scene.fog.length) scene.fog[cell] = message.reveal ? 1 : 0;
        return null;
      case "gameFogAll":
        scene.fog.fill(message.reveal ? 1 : 0);
        return null;
    }
  }

  // ---- Combat -----------------------------------------------------------------

  private applyCombat(table: TableState, who: Subscription, role: TableRole,
    message: Extract<GameClientMessage, { type: "gameCombatStart" | "gameCombatEnd" | "gameCombatNext" | "gameCombatPrev" | "gameCombatRollAll" | "gameApply" }>): string | null {
    if (table.phase !== "playing") return "GAME_NOT_RUNNING";
    if (message.type === "gameApply") return this.applyDamage(table, role, message.rollId, message.half);
    if (message.type === "gameCombatNext") {
      const combat = table.combat;
      if (!combat) return "NO_COMBAT";
      const active = combat.order.find(item => item.id === combat.activeId);
      const own = role === "player" && active?.kind === "hero" && active.seatKey === who.seatKey;
      if (role !== "gm" && !own) return "NOT_YOUR_TURN";
      if (combat.phase !== "running") return "INITIATIVE_PENDING";
      this.advance(table, combat, 1);
      return null;
    }
    if (role !== "gm") return "GM_ONLY";
    switch (message.type) {
      case "gameCombatStart":
        if (!this.currentMap(table)) return "NO_MAP";
        if (table.combat) return "COMBAT_RUNNING";
        table.combat = { phase: "initiative", round: 0, activeId: null, order: [] };
        return null;
      case "gameCombatEnd":
        table.combat = null;
        return null;
      case "gameCombatPrev":
        if (!table.combat) return "NO_COMBAT";
        if (table.combat.phase !== "running") return "INITIATIVE_PENDING";
        this.advance(table, table.combat, -1);
        return null;
      case "gameCombatRollAll": {
        const combat = table.combat;
        if (!combat) return "NO_COMBAT";
        for (const item of combat.order) {
          if (item.initiative !== null || item.kind !== "hero") continue;
          const seat = table.players.find(candidate => candidate.key === item.seatKey);
          const hero = findHero(table.adventureId, item.heroId);
          if (!seat || !hero) continue;
          const planned = this.plan({ type: "initiative" }, hero)!;
          const result = this.throwDice(planned.expression, "normal");
          item.initiative = result.total;
          this.publish(table, who.tableKey, {
            id: this.randomId(), at: this.now(), by: seat.nickname, byKey: seat.key, heroName: hero.name, label: planned.label, hidden: false,
            expr: planned.text, dice: result.dice, modifier: planned.expression.modifier, total: result.total, mode: "normal",
            ...(result.natural ? { natural: result.natural } : {}),
          });
        }
        return null;
      }
    }
  }

  /** Keeps the fight in step with the map: tokens join and leave, monsters roll on arrival, turns start once every hero rolled. */
  private syncCombat(table: TableState): void {
    const combat = table.combat;
    if (!combat) return;
    const map = this.currentMap(table);
    if (!map) {
      table.combat = null;
      return;
    }
    const scene = this.sceneState(table, map);
    const activeIndex = combat.order.findIndex(item => item.id === combat.activeId);
    const kept = combat.order.filter(item => scene.tokens.some(token => token.id === item.tokenId));
    const activeGone = combat.activeId !== null && !kept.some(item => item.id === combat.activeId);
    for (const token of scene.tokens) {
      if (kept.some(item => item.tokenId === token.id)) continue;
      if (token.kind === "hero") {
        const hero = findHero(table.adventureId, token.heroId);
        if (!hero) continue;
        const initiative = combat.phase === "running" ? this.rollDie(20) + abilityModifier(hero.abilities.dex) : null;
        kept.push({ id: this.randomId(), tokenId: token.id, kind: "hero", name: hero.name, seatKey: token.seatKey, heroId: hero.id, initiative, dex: hero.abilities.dex });
      } else {
        const monster = findMonster(table.adventureId, token.monsterId);
        if (!monster) continue;
        kept.push({
          id: this.randomId(), tokenId: token.id, kind: "monster", name: token.name, monsterId: monster.id,
          initiative: this.rollDie(20) + abilityModifier(monster.dex), dex: monster.dex,
        });
      }
    }
    combat.order = kept;
    if (combat.phase === "initiative") {
      if (combat.order.every(item => item.initiative !== null)) {
        combat.phase = "running";
        combat.round = 1;
        this.sortOrder(combat);
        combat.activeId = null;
        this.advance(table, combat, 1, true);
      }
      return;
    }
    this.sortOrder(combat);
    if (activeGone || !combat.activeId) {
      const next = combat.order[Math.max(0, Math.min(activeIndex, combat.order.length - 1))];
      combat.activeId = next?.id ?? null;
      if (next && !this.canAct(table, next)) this.advance(table, combat, 1);
    }
  }

  private sortOrder(combat: CombatState): void {
    combat.order.sort((a, b) => (b.initiative ?? -99) - (a.initiative ?? -99) || b.dex - a.dex
      || (a.kind === b.kind ? 0 : a.kind === "hero" ? -1 : 1) || a.name.localeCompare(b.name));
  }

  /** Monsters at 0 hit points and dead heroes are skipped; dying heroes still take turns (death saves). */
  private canAct(table: TableState, item: CombatantRecord): boolean {
    if (item.kind === "hero") return table.players.find(seat => seat.key === item.seatKey)?.dying?.state !== "dead";
    const map = this.currentMap(table);
    const token = map ? this.sceneState(table, map).tokens.find(candidate => candidate.id === item.tokenId) : undefined;
    return Boolean(token && (token.hp ?? 0) > 0);
  }

  private advance(table: TableState, combat: CombatState, step: 1 | -1, fromStart = false): void {
    const count = combat.order.length;
    if (!count) {
      combat.activeId = null;
      return;
    }
    let index = fromStart ? -1 : combat.order.findIndex(item => item.id === combat.activeId);
    if (index < 0 && !fromStart) index = step === 1 ? -1 : 0;
    for (let tries = 0; tries < count; tries++) {
      index += step;
      if (index >= count) {
        index = 0;
        combat.round += 1;
      } else if (index < 0) {
        index = count - 1;
        combat.round = Math.max(1, combat.round - 1);
      }
      if (this.canAct(table, combat.order[index]!)) {
        combat.activeId = combat.order[index]!.id;
        return;
      }
    }
  }

  private combatFor(table: TableState, role: TableRole): CombatView | null {
    const combat = table.combat;
    if (!combat) return null;
    const map = this.currentMap(table);
    const scene = map ? this.sceneState(table, map) : undefined;
    const visible = (item: CombatantRecord) => {
      if (role === "gm" || item.kind === "hero") return true;
      const token = scene?.tokens.find(candidate => candidate.id === item.tokenId);
      return Boolean(token && map && !token.hidden && scene!.fog[token.y * map.cols + token.x] === 1);
    };
    const order = combat.order.filter(visible).map(item => ({
      id: item.id, tokenId: item.tokenId, kind: item.kind, name: item.name, initiative: item.initiative,
      ...(item.seatKey ? { seatKey: item.seatKey } : {}), ...(item.heroId ? { heroId: item.heroId } : {}), ...(item.monsterId ? { monsterId: item.monsterId } : {}),
    }));
    const activeVisible = order.some(item => item.id === combat.activeId);
    return {
      phase: combat.phase, round: combat.round, order,
      activeId: activeVisible ? combat.activeId : null,
      ...(combat.activeId && !activeVisible ? { activeHidden: true } : {}),
    };
  }

  /** Hit points of a hero; 0 starts dying, healing ends it. */
  private setHeroHp(seat: SeatState, hp: number, maxHp: number): void {
    seat.hp = Math.max(0, Math.min(maxHp, hp));
    if (seat.hp > 0) delete seat.dying;
    else if (!seat.dying) seat.dying = { successes: 0, failures: 0, state: "dying" };
  }

  private applyDamage(table: TableState, role: TableRole, rollId: string, half: boolean): string | null {
    if (role !== "gm") return "GM_ONLY";
    const record = table.rolls.find(item => item.id === rollId);
    if (!record?.damage || !record.targetId) return "UNKNOWN_ROLL";
    if (record.applied) return "ALREADY_APPLIED";
    const map = this.currentMap(table);
    const token = map ? this.sceneState(table, map).tokens.find(candidate => candidate.id === record.targetId) : undefined;
    if (!token) return "UNKNOWN_TOKEN";
    const amount = Math.max(0, half ? Math.floor((record.total ?? 0) / 2) : record.total ?? 0);
    if (token.kind === "monster") {
      token.hp = Math.max(0, (token.hp ?? 0) - amount);
    } else {
      const seat = table.players.find(candidate => candidate.key === token.seatKey);
      const hero = findHero(table.adventureId, seat?.heroId);
      if (!seat || !hero) return "UNKNOWN_TOKEN";
      if ((seat.hp ?? 0) > 0) {
        this.setHeroHp(seat, (seat.hp ?? 0) - amount, hero.maxHp);
      } else if (seat.dying && seat.dying.state !== "dead" && amount > 0) {
        // Damage at 0 hit points is a failed death save.
        seat.dying.state = "dying";
        seat.dying.failures = Math.min(3, seat.dying.failures + 1);
        if (seat.dying.failures >= 3) seat.dying.state = "dead";
      }
    }
    record.applied = true;
    return null;
  }

  private ping(table: TableState, who: Subscription, x: number, y: number): string | null {
    const role = this.roleOf(table, who.seatKey);
    if (role === "spectator") return "NOT_SEATED";
    if (table.phase !== "playing") return "GAME_NOT_RUNNING";
    const map = this.currentMap(table);
    if (!map) return "NO_MAP";
    if (x > map.cols || y > map.rows) return "OUT_OF_BOUNDS";
    const by = role === "player" ? findHero(table.adventureId, table.players.find(seat => seat.key === who.seatKey)?.heroId)?.name ?? who.nickname : who.nickname;
    for (const [entryId, subscription] of this.subscriptions) {
      if (subscription.tableKey === who.tableKey) this.sendRaw(entryId, { type: "gamePinged", by, x, y, gm: role === "gm" });
    }
    return null;
  }

  private currentMap(table: TableState): SceneMap | undefined {
    return table.phase === "playing" ? findAdventure(table.adventureId)?.scenes[table.scene]?.map : undefined;
  }

  private sceneState(table: TableState, map: SceneMap): SceneState {
    let scene = table.scenes.get(table.scene);
    if (!scene) {
      scene = { fog: new Uint8Array(map.cols * map.rows), tokens: [], counters: new Map() };
      table.scenes.set(table.scene, scene);
    }
    return scene;
  }

  /** Every hero has exactly one token on the current map; newcomers appear at the entrance with some light around them. */
  private syncHeroTokens(table: TableState): void {
    const map = this.currentMap(table);
    if (!map) return;
    const scene = this.sceneState(table, map);
    const heroes = table.players.filter(seat => seat.heroId);
    scene.tokens = scene.tokens.filter(token => token.kind !== "hero" || heroes.some(seat => seat.key === token.seatKey && seat.heroId === token.heroId));
    for (const seat of heroes) {
      if (scene.tokens.some(token => token.kind === "hero" && token.seatKey === seat.key)) continue;
      const hero = findHero(table.adventureId, seat.heroId)!;
      const spot = this.freeSpot(map, scene);
      if (!spot) continue;
      scene.tokens.push({ id: this.randomId(), kind: "hero", x: spot[0], y: spot[1], name: hero.name, seatKey: seat.key, heroId: hero.id, hidden: false });
      for (let dy = -SPAWN_REVEAL_RADIUS; dy <= SPAWN_REVEAL_RADIUS; dy++) {
        for (let dx = -SPAWN_REVEAL_RADIUS; dx <= SPAWN_REVEAL_RADIUS; dx++) {
          const x = spot[0] + dx;
          const y = spot[1] + dy;
          if (x >= 0 && y >= 0 && x < map.cols && y < map.rows && dx * dx + dy * dy <= SPAWN_REVEAL_RADIUS * SPAWN_REVEAL_RADIUS + 1) scene.fog[y * map.cols + x] = 1;
        }
      }
    }
  }

  private freeSpot(map: SceneMap, scene: SceneState): [number, number] | null {
    const free = (x: number, y: number) => !scene.tokens.some(token => token.x === x && token.y === y);
    for (const [x, y] of map.spawn) if (x < map.cols && y < map.rows && free(x, y)) return [x, y];
    const [ox, oy] = map.spawn[0] ?? [0, 0];
    for (let radius = 1; radius < Math.max(map.cols, map.rows); radius++) {
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const x = ox + dx;
          const y = oy + dy;
          if (x >= 0 && y >= 0 && x < map.cols && y < map.rows && free(x, y)) return [x, y];
        }
      }
    }
    return null;
  }

  private mapFor(table: TableState, role: TableRole): MapView | null {
    const map = this.currentMap(table);
    if (!map) return null;
    const scene = this.sceneState(table, map);
    const revealed = (token: TokenRecord) => scene.fog[token.y * map.cols + token.x] === 1;
    const tokens: TokenView[] = [];
    for (const token of scene.tokens) {
      const { hidden, hp, maxHp, ...base } = token;
      if (role === "gm") {
        tokens.push({ ...base, ...(hp !== undefined ? { hp, maxHp } : {}), ...(hidden ? { hidden: true } : {}) });
        continue;
      }
      if (token.kind === "monster" && (hidden || !revealed(token))) continue;
      const condition = token.kind === "monster" && maxHp ? (hp! <= 0 ? "down" : hp! * 2 <= maxHp ? "bloodied" : undefined) : undefined;
      tokens.push({ ...base, ...(condition ? { condition } : {}) });
    }
    let fog = "";
    for (const cell of scene.fog) fog += cell ? "1" : "0";
    return { cols: map.cols, rows: map.rows, fog, tokens };
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
    const map = this.currentMap(table);
    const scene = map ? this.sceneState(table, map) : undefined;
    let monster: { sheet: MonsterSheet; name: string } | undefined;
    if (source.type === "monsterAttack" || source.type === "monsterDamage") {
      if (role !== "gm") return "GM_ONLY";
      const token = scene?.tokens.find(candidate => candidate.id === source.tokenId && candidate.kind === "monster");
      const sheet = token ? findMonster(table.adventureId, token.monsterId) : undefined;
      if (!token || !sheet) return "UNKNOWN_TOKEN";
      monster = { sheet, name: token.name };
    }
    if (source.type === "deathSave" && (!hero || seat.dying?.state !== "dying")) return "NOT_DYING";
    let target: TokenRecord | undefined;
    if (message.targetId) {
      target = scene?.tokens.find(candidate => candidate.id === message.targetId);
      if (!target) return "UNKNOWN_TOKEN";
    }
    const planned = this.plan(source, hero, monster?.sheet);
    if (!planned) return source.type === "free" ? "INVALID_DICE" : "NEEDS_HERO";
    const result = this.throwDice(planned.expression, planned.d20 ? mode : "normal");
    const record: RollRecord = {
      id: this.randomId(),
      at: this.now(),
      by: seat.nickname,
      byKey: seat.key,
      ...(hero ? { heroName: hero.name } : monster ? { heroName: monster.name } : {}),
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
    if (target && (source.type === "attack" || source.type === "monsterAttack" || source.type === "damage" || source.type === "monsterDamage")) {
      record.targetId = target.id;
      record.targetName = target.name;
      if (source.type === "attack" || source.type === "monsterAttack") {
        const ac = target.kind === "hero" ? findHero(table.adventureId, target.heroId)?.ac : findMonster(table.adventureId, target.monsterId)?.ac;
        if (ac !== undefined) {
          record.targetAc = ac;
          record.hit = result.natural === 20 ? true : result.natural === 1 ? false : result.total >= ac;
        }
      } else {
        record.damage = true;
        record.applied = false;
      }
    }
    if (source.type === "initiative" && hero && table.combat) {
      const item = table.combat.order.find(candidate => candidate.kind === "hero" && candidate.seatKey === seat.key);
      if (item && item.initiative === null) item.initiative = result.total;
    }
    if (source.type === "deathSave" && seat.dying) {
      const dying = seat.dying;
      if (result.natural === 20) {
        record.deathSave = "revived";
        seat.hp = 1;
        delete seat.dying;
      } else if (result.total >= 10) {
        record.deathSave = "success";
        dying.successes += 1;
        if (dying.successes >= 3) dying.state = "stable";
      } else {
        record.deathSave = "failure";
        dying.failures = Math.min(3, dying.failures + (result.natural === 1 ? 2 : 1));
        if (dying.failures >= 3) dying.state = "dead";
      }
    }
    this.publish(table, who.tableKey, record);
    return null;
  }

  private publish(table: TableState, tableKey: string, record: RollRecord): void {
    table.rolls = [...table.rolls, record].slice(-ROLL_LOG_SIZE);
    for (const [entryId, subscription] of this.subscriptions) {
      if (subscription.tableKey !== tableKey) continue;
      this.sendRaw(entryId, { type: "gameRolled", roll: this.rollFor(record, this.roleOf(table, subscription.seatKey)) });
    }
  }

  /** What a roll means: the dice, its label and whether it is a d20 roll (advantage applies). */
  private plan(source: RollSource, hero: HeroSheet | undefined, monster?: MonsterSheet): { expression: DiceExpression; text: string; label: string; d20: boolean } | null {
    const d20 = (modifier: number, label: string) => ({
      expression: { terms: [{ count: 1, sides: 20, sign: 1 as const }], modifier }, text: `1d20${modifier ? formatModifier(modifier) : ""}`, label, d20: true,
    });
    if (source.type === "free") {
      const expression = parseDiceExpression(source.expr);
      return expression ? { expression, text: source.expr.replace(/\s+/g, ""), label: "Бросок", d20: false } : null;
    }
    const damage = (attack: { name: string; damage: string } | undefined, crit: boolean | undefined) => {
      const expression = attack ? parseDiceExpression(attack.damage) : null;
      if (!attack || !expression) return null;
      if (crit) expression.terms = expression.terms.map(term => ({ ...term, count: term.count * 2 }));
      const text = expression.terms.map(term => `${term.count}d${term.sides}`).join("+") + (expression.modifier ? formatModifier(expression.modifier) : "");
      return { expression, text, label: `Урон: ${attack.name}${crit ? " (крит)" : ""}`, d20: false };
    };
    if (source.type === "monsterAttack") {
      const attack = monster?.attacks[source.index];
      return attack && attack.bonus !== null ? d20(attack.bonus, `Атака: ${attack.name}`) : null;
    }
    if (source.type === "monsterDamage") return damage(monster?.attacks[source.index], source.crit);
    if (!hero) return null;
    switch (source.type) {
      case "deathSave": return d20(0, "Спасбросок от смерти");
      case "ability": return d20(abilityModifier(hero.abilities[source.ability]), `Проверка: ${ABILITY_LABEL[source.ability]}`);
      case "skill": return d20(skillBonus(hero, source.skill), SKILL_LABEL[source.skill]);
      case "save": return d20(saveBonus(hero, source.ability), `Спасбросок: ${ABILITY_LABEL[source.ability]}`);
      case "initiative": return d20(abilityModifier(hero.abilities.dex), "Инициатива");
      case "attack": {
        const attack = hero.attacks[source.index];
        if (!attack || attack.bonus === null) return null;
        return d20(attack.bonus, `Атака: ${attack.name}`);
      }
      case "damage": return damage(hero.attacks[source.index], source.crit);
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
    if (role !== "gm" && (view.dc !== undefined || view.targetAc !== undefined)) {
      const { dc: _dc, targetAc: _ac, ...withoutSecrets } = view;
      return withoutSecrets;
    }
    return view;
  }

  private viewFor(tableKey: string, table: TableState, seatKey: string): TableView {
    const role = this.roleOf(table, seatKey);
    const seat = (state: SeatState): SeatView => ({
      key: state.key, nickname: state.nickname, online: this.online(tableKey, state.key), ready: state.ready, heroId: state.heroId, hp: state.hp,
      ...(state.dying ? { dying: { ...state.dying } } : {}),
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
      scene: table.scene,
      map: this.mapFor(table, role),
      combat: this.combatFor(table, role),
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
