import {
  MAX_MAP_TOKENS,
  MAX_PLAYERS,
  ROLL_LOG_SIZE,
  SKILLS,
  CONDITIONS,
  DEFAULT_VISION,
  VISION_RADII,
  abilityModifier,
  attackSaveOf,
  formatModifier,
  heroHitDie,
  monsterSaveBonus,
  parseDiceExpression,
  saveBonus,
  skillBonus,
  type Ability,
  type CheckSource,
  type ConditionId,
  type CheckView,
  type DiceExpression,
  type GameClientMessage,
  type GameServerMessage,
  type AdventureSummary,
  type CombatView,
  type HeroSheet,
  type MonsterSheet,
  type MapView,
  type MusicView,
  type SceneMap,
  type TokenView,
  type RollDie,
  type RollMode,
  type RollSource,
  type RollView,
  type SaveResultView,
  type SeatView,
  type TableRole,
  type TableView,
  type VaultHero,
} from "../shared/tabletop.js";
import { BUILT_IN_ADVENTURES } from "../shared/tabletop-adventures.js";
import { adventureForPlayers, adventureListItem } from "../shared/adventure-package.js";
import {
  HeroChoiceError, MAX_INVENTORY, STARTING_COINS, XP_FOR_LEVEL, buildHero, heroPortraitUrl, parseCoins, parseInventoryItem, startingInventory, validateHeroChoices,
  type Coins, type HeroChoices, type InventoryItem,
} from "../shared/hero-builder.js";

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
  /** The player's own hero, built from their choices by the gateway. */
  custom?: HeroSheet;
  conditions?: ConditionId[];
  exhaustion?: number;
  /** Spent uses per resource id. */
  used?: Record<string, number>;
  /** Hit dice left; undefined means all of them. */
  hitDice?: number;
  /** Own heroes: the choices the sheet was built from (level-ups are checked against them). */
  choices?: HeroChoices;
  xp?: number;
  inventory?: InventoryItem[];
  coins?: Coins;
}

interface RollRecord extends Omit<RollView, "saves"> {
  byKey: string;
  saves?: Array<SaveResultView & { hiddenFromPlayers?: boolean }>;
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
  conditions?: ConditionId[];
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
  /** What plays now and since when; `auto` follows the scene and combat. */
  music: { trackId: string | null; startedAt: number; auto: boolean };
  narration: { id: string; title: string; text: string; art?: string } | null;
  /** Cells revealed around every hero after each change (0: by hand only). */
  vision: number;
  updatedAt: number;
}

interface Subscription {
  tableKey: string;
  seatKey: string;
  nickname: string;
  /** "<adventure id>|<game master?>" of the adventure data this subscriber has. */
  adventureSent?: string;
}
interface Bucket { tokens: number; updatedAt: number }

/** Where tables outlive the gateway process: plain JSON snapshots by table key. */
export interface TabletopStore {
  /** The saved snapshot, or null. Must not block (load everything at startup). */
  load(key: string): unknown;
  /** null removes the table. */
  save(key: string, snapshot: unknown): void;
}

export interface TabletopCoordinatorOptions {
  send: (entryId: string, message: GameServerMessage) => void;
  /** Uniform integer in [1, sides]. */
  rollDie?: (sides: number) => number;
  now?: () => number;
  randomId?: () => string;
  /** Every adventure a table may play (built-in ones by default). */
  adventures?: () => readonly AdventureSummary[];
  /** Which of them the administrator uploaded. */
  isCustomAdventure?: (id: string) => boolean;
  /** Keeps tables across restarts; memory only without it. */
  store?: TabletopStore;
  /** Players' own heroes by TeamSpeak unique id; without it the browser keeps them alone. */
  vault?: TabletopStore;
}

const MAX_VAULT_HEROES = 30;

const SNAPSHOT_VERSION = 1;

/** Opens the fog in a disc of `radius` cells around a cell. */
function revealAround(fog: Uint8Array, map: SceneMap, cx: number, cy: number, radius: number): void {
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const x = cx + dx;
      const y = cy + dy;
      if (x >= 0 && y >= 0 && x < map.cols && y < map.rows && dx * dx + dy * dy <= radius * radius + 1) fog[y * map.cols + x] = 1;
    }
  }
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

const CONDITION_LABEL: Record<ConditionId, string> = {
  blinded: "ослеплён", charmed: "очарован", deafened: "оглох", frightened: "испуган", grappled: "схвачен", incapacitated: "недееспособен",
  invisible: "невидим", paralyzed: "парализован", petrified: "окаменел", poisoned: "отравлен", prone: "сбит с ног", restrained: "опутан",
  stunned: "ошеломлён", unconscious: "без сознания", concentration: "концентрация",
};

/**
 * Advantage and disadvantage the rules give from conditions and exhaustion (SRD 5.1,
 * appendix A). Both at once cancel out, whatever the count.
 */
export function conditionMode(
  requested: RollMode,
  kind: "check" | "attack" | "save",
  self: { conditions?: readonly ConditionId[]; exhaustion?: number },
  ability: Ability | null,
  target?: { conditions?: readonly ConditionId[] },
): { mode: RollMode; reasons: string[] } {
  const reasons: string[] = [];
  let advantage = requested === "advantage";
  let disadvantage = requested === "disadvantage";
  const has = (list: readonly ConditionId[] | undefined, id: ConditionId) => Boolean(list?.includes(id));
  const dis = (why: string) => { disadvantage = true; reasons.push(`${why}: помеха`); };
  const adv = (why: string) => { advantage = true; reasons.push(`${why}: преимущество`); };
  const exhaustion = self.exhaustion ?? 0;
  if (kind === "check") {
    if (exhaustion >= 1) dis(`истощение ${exhaustion}`);
    for (const id of ["poisoned", "frightened"] as const) if (has(self.conditions, id)) dis(CONDITION_LABEL[id]);
  } else if (kind === "attack") {
    if (exhaustion >= 3) dis(`истощение ${exhaustion}`);
    for (const id of ["poisoned", "frightened", "blinded", "prone", "restrained"] as const) if (has(self.conditions, id)) dis(CONDITION_LABEL[id]);
    if (has(self.conditions, "invisible")) adv(CONDITION_LABEL.invisible);
    for (const id of ["blinded", "paralyzed", "restrained", "stunned", "unconscious", "petrified"] as const) {
      if (has(target?.conditions, id)) adv(`цель ${CONDITION_LABEL[id]}`);
    }
    if (has(target?.conditions, "invisible")) dis("цель невидима");
  } else {
    if (exhaustion >= 3) dis(`истощение ${exhaustion}`);
    if (ability === "dex" && has(self.conditions, "restrained")) dis(CONDITION_LABEL.restrained);
    if ((ability === "str" || ability === "dex") && ["paralyzed", "stunned", "unconscious", "petrified"].some(id => has(self.conditions, id as ConditionId))) {
      reasons.push("провал спасброска Силы и Ловкости автоматически");
    }
  }
  return { mode: advantage === disadvantage ? "normal" : advantage ? "advantage" : "disadvantage", reasons };
}

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
    this.adventures = options.adventures ?? (() => BUILT_IN_ADVENTURES);
    this.isCustom = options.isCustomAdventure ?? (() => false);
    this.store = options.store;
    this.vault = options.vault;
  }

  private readonly store: TabletopStore | undefined;
  private readonly vault: TabletopStore | undefined;

  private readonly adventures: () => readonly AdventureSummary[];
  private readonly isCustom: (id: string) => boolean;

  private findAdventure(id: string | null | undefined): AdventureSummary | undefined {
    return id ? this.adventures().find(adventure => adventure.id === id) : undefined;
  }

  /** A hero of the table: one of the adventure's or a player's own (built with the hero builder). */
  private heroOf(table: TableState, heroId: string | null | undefined): HeroSheet | undefined {
    if (!heroId) return undefined;
    return table.players.find(seat => seat.custom?.id === heroId)?.custom ?? this.findHero(table.adventureId, heroId);
  }

  private findHero(adventureId: string | null | undefined, heroId: string | null | undefined): HeroSheet | undefined {
    return heroId ? this.findAdventure(adventureId)?.heroes.find(hero => hero.id === heroId) : undefined;
  }

  private findMonster(adventureId: string | null | undefined, monsterId: string | null | undefined): MonsterSheet | undefined {
    return monsterId ? this.findAdventure(adventureId)?.monsters.find(monster => monster.id === monsterId) : undefined;
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
    if (message.type === "gameVaultSave" || message.type === "gameVaultRemove") {
      const code = this.changeVault(participant.seatKey, message);
      if (code) this.error(participant.entryId, code);
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
      table.narration = null;
    }
    this.syncMusic(table);
    table.updatedAt = this.now();
    this.persist(subscription.tableKey, table);
    this.broadcast(subscription.tableKey);
  }

  private persist(key: string, table: TableState): void {
    if (!this.store) return;
    const empty = !table.gm && !table.players.length;
    this.store.save(key, empty ? null : snapshotTable(table));
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

  // ---- Hero vault -------------------------------------------------------------

  private vaultOf(seatKey: string): VaultHero[] | null {
    if (!this.vault || !seatKey.startsWith("uid:")) return null;
    const saved = this.vault.load(seatKey);
    return Array.isArray(saved) ? saved as VaultHero[] : [];
  }

  private changeVault(seatKey: string, message: Extract<GameClientMessage, { type: "gameVaultSave" | "gameVaultRemove" }>): string | null {
    const heroes = this.vaultOf(seatKey);
    if (!heroes) return "NO_VAULT";
    let next: VaultHero[];
    if (message.type === "gameVaultRemove") {
      next = heroes.filter(hero => hero.id !== message.id);
    } else {
      let choices: HeroChoices;
      try { choices = validateHeroChoices(message.hero.choices); }
      catch (error: unknown) { return error instanceof HeroChoiceError ? error.code : "HERO_INVALID"; }
      const existing = heroes.find(hero => hero.id === message.hero.id);
      if (existing && existing.updatedAt > message.hero.updatedAt) return null;
      if (!existing && heroes.length >= MAX_VAULT_HEROES) return "VAULT_FULL";
      const hero = { id: message.hero.id, choices, updatedAt: Math.min(message.hero.updatedAt, this.now() + 60_000) };
      next = [hero, ...heroes.filter(item => item.id !== hero.id)];
    }
    this.vault!.save(seatKey, next.length ? next : null);
    for (const [entryId, subscription] of this.subscriptions) {
      if (subscription.seatKey === seatKey) this.sendRaw(entryId, { type: "gameVault", heroes: next });
    }
    return null;
  }

  private subscribe(participant: TableParticipant): void {
    const tableKey = participant.tableKey!;
    this.subscriptions.set(participant.entryId, { tableKey, seatKey: participant.seatKey, nickname: participant.nickname });
    const vault = this.vaultOf(participant.seatKey);
    if (vault) this.sendRaw(participant.entryId, { type: "gameVault", heroes: vault });
    const table = this.table(tableKey);
    // A returning seat holder gets its current nickname.
    for (const seat of [table.gm, ...table.players]) if (seat?.key === participant.seatKey) seat.nickname = participant.nickname;
    this.broadcast(tableKey);
  }

  private table(key: string): TableState {
    let table = this.tables.get(key);
    if (!table && this.store) {
      const restored = restoreTable(this.store.load(key));
      if (restored) {
        table = restored;
        if (table.adventureId && !this.findAdventure(table.adventureId)) {
          // The adventure was removed meanwhile: back to the lobby, keep the seats.
          Object.assign(table, { phase: "lobby", adventureId: null, scene: 0, scenes: new Map(), combat: null, narration: null, checks: [] });
        }
        this.tables.set(key, table);
      }
    }
    if (!table) {
      table = { phase: "lobby", adventureId: null, gm: null, players: [], rolls: [], checks: [], scene: 0, scenes: new Map(), combat: null,
        music: { trackId: null, startedAt: 0, auto: true }, narration: null, vision: DEFAULT_VISION, updatedAt: this.now() };
      this.tables.set(key, table);
    }
    return table;
  }

  private dropIdleTables(): void {
    const watched = new Set([...this.subscriptions.values()].map(subscription => subscription.tableKey));
    for (const [key, table] of this.tables) {
      const empty = !table.gm && !table.players.length;
      if (!watched.has(key) && (empty || this.now() - table.updatedAt > IDLE_TABLE_MS)) {
        this.tables.delete(key);
        if (empty) this.store?.save(key, null);
      }
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

  private apply(table: TableState, who: Subscription, message: Exclude<GameClientMessage, { type: "gameOpen" | "gameClose" | "gamePing" | "gameVaultSave" | "gameVaultRemove" }>): string | null {
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
        const adventure = this.findAdventure(message.adventureId);
        if (!adventure) return "UNKNOWN_ADVENTURE";
        table.adventureId = adventure.id;
        for (const seat of table.players) {
          if (seat.custom && seat.heroId === seat.custom.id) continue;
          if (!adventure.heroes.some(hero => hero.id === seat.heroId)) Object.assign(seat, { heroId: null, hp: null, ready: false });
        }
        return null;
      }
      case "gameHero": {
        if (role !== "player" || !ownSeat) return "PLAYERS_ONLY";
        if (table.phase !== "lobby") return "GAME_RUNNING";
        if (message.heroId === null) {
          Object.assign(ownSeat, { heroId: null, hp: null, ready: false });
          delete ownSeat.custom;
          return null;
        }
        delete ownSeat.custom;
        const hero = this.heroOf(table, message.heroId);
        if (!hero) return "UNKNOWN_HERO";
        if (table.players.some(seat => seat.key !== who.seatKey && seat.heroId === hero.id)) return "HERO_TAKEN";
        if (ownSeat.heroId !== hero.id) {
          for (const key of ["choices", "xp", "inventory", "coins", "used", "hitDice", "conditions", "exhaustion"] as const) delete ownSeat[key];
          Object.assign(ownSeat, { inventory: startingInventory(hero.equipment), coins: { gp: 10, sp: 0, cp: 0 } });
        }
        Object.assign(ownSeat, { heroId: hero.id, hp: hero.maxHp });
        return null;
      }
      case "gameCustomHero": {
        if (role !== "player" || !ownSeat) return "PLAYERS_ONLY";
        if (table.phase !== "lobby") return "GAME_RUNNING";
        let choices;
        try { choices = validateHeroChoices(message.choices); }
        catch (error: unknown) { return error instanceof HeroChoiceError ? error.code : "HERO_INVALID"; }
        const hero = buildHero(choices, `pc-${this.randomId()}`, heroPortraitUrl);
        for (const key of ["used", "hitDice", "conditions", "exhaustion"] as const) delete ownSeat[key];
        const { inventory, coins, ...sheetChoices } = choices;
        Object.assign(ownSeat, {
          custom: hero, heroId: hero.id, hp: hero.maxHp, choices: sheetChoices, xp: choices.xp ?? 0,
          inventory: inventory ?? startingInventory(hero.equipment), coins: coins ?? { ...STARTING_COINS },
        });
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
          seat.hp = this.heroOf(table, seat.heroId)!.maxHp;
          for (const key of ["dying", "conditions", "exhaustion", "used", "hitDice"] as const) delete seat[key];
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
        this.setHeroHp(seat, message.hp, this.heroOf(table, seat.heroId)!.maxHp);
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
      case "gameMusic":
      case "gameMusicAuto":
      case "gameNarrate":
      case "gameNarrationClose":
        return this.applyStory(table, role, message);
      case "gameCondition":
      case "gameExhaustion":
      case "gameResource":
      case "gameRest":
      case "gameHitDie":
        return this.applyCare(table, who, role, message);
      case "gameSaveAttack":
        return this.saveAttack(table, who, role, ownSeat, message);
      case "gameVision":
        if (role !== "gm") return "GM_ONLY";
        table.vision = message.radius;
        return null;
      case "gameXp":
      case "gameLevelUp":
      case "gameInventory":
        return this.applyProgress(table, who, role, ownSeat, message);
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
      if (!this.findAdventure(table.adventureId)?.scenes[message.index]) return "UNKNOWN_SCENE";
      if (table.scene !== message.index) {
        table.combat = null;
        table.narration = null;
      }
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
        const monster = this.findMonster(table.adventureId, message.monsterId);
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

  // ---- Story: narration and music ----------------------------------------------

  private applyStory(table: TableState, role: TableRole,
    message: Extract<GameClientMessage, { type: "gameMusic" | "gameMusicAuto" | "gameNarrate" | "gameNarrationClose" }>): string | null {
    if (role !== "gm") return "GM_ONLY";
    if (table.phase !== "playing") return "GAME_NOT_RUNNING";
    const adventure = this.findAdventure(table.adventureId);
    switch (message.type) {
      case "gameMusic":
        if (message.trackId !== null && !adventure?.music?.some(track => track.id === message.trackId)) return "UNKNOWN_TRACK";
        table.music = { trackId: message.trackId, startedAt: this.now(), auto: false };
        return null;
      case "gameMusicAuto":
        table.music = { ...table.music, auto: true };
        return null;
      case "gameNarrate": {
        const scene = adventure?.scenes[table.scene];
        const text = message.text ?? scene?.intro;
        if (!text) return "NO_NARRATION";
        table.narration = { id: this.randomId(), title: scene?.title ?? "", text, ...(scene?.art ? { art: scene.art } : {}) };
        return null;
      }
      case "gameNarrationClose":
        table.narration = null;
        return null;
    }
  }

  /** While music follows the story: the fight's track during combat, otherwise the scene's own; silence in the lobby. */
  private syncMusic(table: TableState): void {
    if (!table.music.auto) return;
    const adventure = this.findAdventure(table.adventureId);
    const wanted = table.phase !== "playing" ? null
      : (table.combat && adventure?.combatMusic) || adventure?.scenes[table.scene]?.music || null;
    if (wanted !== table.music.trackId) table.music = { trackId: wanted, startedAt: this.now(), auto: true };
  }

  // ---- Combat -----------------------------------------------------------------

  private applyCombat(table: TableState, who: Subscription, role: TableRole,
    message: Extract<GameClientMessage, { type: "gameCombatStart" | "gameCombatEnd" | "gameCombatNext" | "gameCombatPrev" | "gameCombatRollAll" | "gameApply" }>): string | null {
    if (table.phase !== "playing") return "GAME_NOT_RUNNING";
    if (message.type === "gameApply") return this.applyDamage(table, who.tableKey, role, message.rollId, message.half);
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
          const hero = this.heroOf(table, item.heroId);
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
        const hero = this.heroOf(table, token.heroId);
        if (!hero) continue;
        const initiative = combat.phase === "running" ? this.rollDie(20) + abilityModifier(hero.abilities.dex) : null;
        kept.push({ id: this.randomId(), tokenId: token.id, kind: "hero", name: hero.name, seatKey: token.seatKey, heroId: hero.id, initiative, dex: hero.abilities.dex });
      } else {
        const monster = this.findMonster(table.adventureId, token.monsterId);
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

  private musicFor(table: TableState): MusicView | null {
    const track = this.findAdventure(table.adventureId)?.music?.find(item => item.id === table.music.trackId);
    if (!track) return null;
    return { trackId: track.id, title: track.title, url: track.file, elapsedMs: Math.max(0, this.now() - table.music.startedAt), auto: table.music.auto };
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

  private applyDamage(table: TableState, tableKey: string, role: TableRole, rollId: string, half: boolean): string | null {
    if (role !== "gm") return "GM_ONLY";
    const record = table.rolls.find(item => item.id === rollId);
    if (!record?.damage || !record.targetId) return "UNKNOWN_ROLL";
    if (record.applied) return "ALREADY_APPLIED";
    const map = this.currentMap(table);
    const token = map ? this.sceneState(table, map).tokens.find(candidate => candidate.id === record.targetId) : undefined;
    if (!token) return "UNKNOWN_TOKEN";
    const amount = Math.max(0, half ? Math.floor((record.total ?? 0) / 2) : record.total ?? 0);
    if (!this.damageToken(table, tableKey, token, amount)) return "UNKNOWN_TOKEN";
    record.applied = true;
    return null;
  }

  /** Damage to a token: monsters lose hit points, heroes too (or fail a death save at 0) and roll to keep concentration. */
  private damageToken(table: TableState, tableKey: string, token: TokenRecord, amount: number): boolean {
    if (token.kind === "monster") {
      token.hp = Math.max(0, (token.hp ?? 0) - amount);
      if (amount > 0 && token.conditions?.includes("concentration")) this.concentration(table, tableKey, token.name, monsterSaveBonus(this.findMonster(table.adventureId, token.monsterId)!, "con"), amount, () => {
        token.conditions = token.conditions!.filter(item => item !== "concentration");
      }, null);
      return true;
    }
    const seat = table.players.find(candidate => candidate.key === token.seatKey);
    const hero = this.heroOf(table, seat?.heroId);
    if (!seat || !hero) return false;
    if ((seat.hp ?? 0) > 0) {
      this.setHeroHp(seat, (seat.hp ?? 0) - amount, hero.maxHp);
    } else if (seat.dying && seat.dying.state !== "dead" && amount > 0) {
      // Damage at 0 hit points is a failed death save.
      seat.dying.state = "dying";
      seat.dying.failures = Math.min(3, seat.dying.failures + 1);
      if (seat.dying.failures >= 3) seat.dying.state = "dead";
    }
    if (amount > 0 && seat.conditions?.includes("concentration")) {
      const drop = () => { seat.conditions = seat.conditions!.filter(item => item !== "concentration"); };
      if ((seat.hp ?? 0) <= 0) drop();
      else this.concentration(table, tableKey, hero.name, saveBonus(hero, "con"), amount, drop, seat);
    }
    return true;
  }

  /** A Constitution save to keep concentrating after damage: DC 10 or half the damage. */
  private concentration(table: TableState, tableKey: string, name: string, bonus: number, damage: number, lose: () => void, seat: SeatState | null): void {
    const dc = Math.max(10, Math.floor(damage / 2));
    const mode = seat && (seat.exhaustion ?? 0) >= 3 ? "disadvantage" : "normal";
    const result = this.throwDice({ terms: [{ count: 1, sides: 20, sign: 1 }], modifier: bonus }, mode);
    const success = result.total >= dc;
    if (!success) lose();
    this.publish(table, tableKey, {
      id: this.randomId(), at: this.now(), by: seat?.nickname ?? table.gm?.nickname ?? "", byKey: seat?.key ?? table.gm?.key ?? "",
      heroName: name, label: "Концентрация: спасбросок Телосложения", hidden: !seat, expr: `1d20${bonus ? formatModifier(bonus) : ""}`,
      dice: result.dice, modifier: bonus, total: result.total, mode, dc, success, ...(result.natural ? { natural: result.natural } : {}),
    });
  }

  // ---- Conditions, resources and rests ------------------------------------------

  private applyCare(table: TableState, who: Subscription, role: TableRole,
    message: Extract<GameClientMessage, { type: "gameCondition" | "gameExhaustion" | "gameResource" | "gameRest" | "gameHitDie" }>): string | null {
    if (table.phase !== "playing") return "GAME_NOT_RUNNING";
    const heroSeat = (key: string): { seat: SeatState; hero: HeroSheet } | string => {
      const seat = table.players.find(candidate => candidate.key === key);
      const hero = this.heroOf(table, seat?.heroId);
      if (!seat || !hero) return "UNKNOWN_SEAT";
      if (role !== "gm" && seat.key !== who.seatKey) return "NOT_YOUR_HERO";
      return { seat, hero };
    };
    switch (message.type) {
      case "gameCondition": {
        const toggle = (list: ConditionId[] | undefined): ConditionId[] => {
          const next = new Set(list ?? []);
          if (message.active) next.add(message.condition);
          else next.delete(message.condition);
          return CONDITIONS.filter(item => next.has(item));
        };
        if (table.players.some(seat => seat.key === message.target)) {
          const found = heroSeat(message.target);
          if (typeof found === "string") return found;
          found.seat.conditions = toggle(found.seat.conditions);
          return null;
        }
        if (role !== "gm") return "GM_ONLY";
        const map = this.currentMap(table);
        const token = map ? this.sceneState(table, map).tokens.find(candidate => candidate.id === message.target && candidate.kind === "monster") : undefined;
        if (!token) return "UNKNOWN_TOKEN";
        token.conditions = toggle(token.conditions);
        return null;
      }
      case "gameExhaustion": {
        const found = heroSeat(message.key);
        if (typeof found === "string") return found;
        found.seat.exhaustion = message.level;
        return null;
      }
      case "gameResource": {
        const found = heroSeat(message.key);
        if (typeof found === "string") return found;
        const resource = found.hero.resources?.find(item => item.id === message.resourceId);
        if (!resource) return "UNKNOWN_RESOURCE";
        found.seat.used = { ...found.seat.used, [resource.id]: Math.min(resource.max, message.used) };
        return null;
      }
      case "gameHitDie": {
        const found = heroSeat(message.key);
        if (typeof found === "string") return found;
        const { seat, hero } = found;
        if (table.combat) return "COMBAT_RUNNING";
        if ((seat.hp ?? 0) <= 0) return "NOT_CONSCIOUS";
        const left = seat.hitDice ?? hero.level;
        if (left <= 0) return "NO_HIT_DICE";
        const con = abilityModifier(hero.abilities.con);
        const result = this.throwDice({ terms: [{ count: 1, sides: heroHitDie(hero), sign: 1 }], modifier: con }, "normal");
        const healed = Math.max(0, result.total);
        seat.hitDice = left - 1;
        this.setHeroHp(seat, (seat.hp ?? 0) + healed, hero.maxHp);
        this.publish(table, who.tableKey, {
          id: this.randomId(), at: this.now(), by: seat.nickname, byKey: seat.key, heroName: hero.name, label: "Кость хитов", hidden: false,
          expr: `1d${heroHitDie(hero)}${con ? formatModifier(con) : ""}`, dice: result.dice, modifier: con, total: result.total, mode: "normal", healed,
        });
        return null;
      }
      case "gameRest": {
        if (role !== "gm") return "GM_ONLY";
        if (table.combat) return "COMBAT_RUNNING";
        for (const seat of table.players) {
          const hero = this.heroOf(table, seat.heroId);
          if (!hero) continue;
          const used = { ...seat.used };
          for (const resource of hero.resources ?? []) if (message.kind === "long" || resource.recharge === "short") delete used[resource.id];
          seat.used = used;
          if (message.kind === "long" && seat.dying?.state !== "dead") {
            seat.hp = hero.maxHp;
            delete seat.dying;
            seat.hitDice = Math.min(hero.level, (seat.hitDice ?? hero.level) + Math.max(1, Math.floor(hero.level / 2)));
            if (seat.exhaustion) seat.exhaustion -= 1;
          }
        }
        const gm = table.gm!;
        this.publish(table, who.tableKey, {
          id: this.randomId(), at: this.now(), by: gm.nickname, byKey: gm.key, hidden: false,
          label: message.kind === "long" ? "Долгий отдых: хиты, ячейки и умения восстановлены" : "Короткий отдых: можно тратить кости хитов",
        });
        return null;
      }
    }
  }

  // ---- Experience, levels and belongings ------------------------------------------

  private applyProgress(table: TableState, who: Subscription, role: TableRole, ownSeat: SeatState | null,
    message: Extract<GameClientMessage, { type: "gameXp" | "gameLevelUp" | "gameInventory" }>): string | null {
    switch (message.type) {
      case "gameXp": {
        if (role !== "gm") return "GM_ONLY";
        const seats = table.players.filter(seat => seat.heroId && message.keys.includes(seat.key));
        if (!seats.length) return "NO_TARGETS";
        for (const seat of seats) seat.xp = Math.max(0, (seat.xp ?? 0) + message.amount);
        const gm = table.gm!;
        this.publish(table, who.tableKey, {
          id: this.randomId(), at: this.now(), by: gm.nickname, byKey: gm.key, hidden: false,
          label: `Опыт ${message.amount > 0 ? "+" : "−"}${Math.abs(message.amount)}: ${seats.map(seat => this.heroOf(table, seat.heroId)?.name ?? seat.nickname).join(", ")}`,
        });
        return null;
      }
      case "gameLevelUp": {
        if (role !== "player" || !ownSeat?.custom || !ownSeat.choices) return "OWN_HERO_ONLY";
        if (table.combat) return "COMBAT_RUNNING";
        let next: HeroChoices;
        try { next = validateHeroChoices({ ...(message.choices as object), xp: ownSeat.xp ?? 0 }); }
        catch (error: unknown) { return error instanceof HeroChoiceError ? error.code : "HERO_INVALID"; }
        const previous = ownSeat.choices;
        const level = previous.level ?? 1;
        if ((next.level ?? 1) !== level + 1) return "HERO_LEVEL";
        if ((ownSeat.xp ?? 0) < XP_FOR_LEVEL[level + 1]!) return "HERO_XP";
        const fixed = ["race", "cls", "method", "abilities", "classSkills", "backgroundSkills", "bonusAbilities", "bonusSkills", "fightingStyle", "ancestry"] as const;
        if (fixed.some(key => JSON.stringify(previous[key] ?? null) !== JSON.stringify(next[key] ?? null))) return "HERO_CHANGED";
        if (level >= 4 && JSON.stringify(previous.asi ?? null) !== JSON.stringify(next.asi ?? null)) return "HERO_CHANGED";
        if (previous.cls === "rogue" && JSON.stringify(previous.expertise) !== JSON.stringify(next.expertise)) return "HERO_CHANGED";
        const { inventory: _inventory, coins: _coins, ...sheetChoices } = next;
        const hero = buildHero(sheetChoices, ownSeat.custom.id, heroPortraitUrl);
        const gained = hero.maxHp - ownSeat.custom.maxHp;
        ownSeat.custom = hero;
        ownSeat.choices = sheetChoices;
        if (ownSeat.hp !== null && ownSeat.hp > 0) ownSeat.hp = Math.min(hero.maxHp, ownSeat.hp + gained);
        if (ownSeat.hitDice !== undefined) ownSeat.hitDice += 1;
        if (table.phase === "playing") {
          this.publish(table, who.tableKey, {
            id: this.randomId(), at: this.now(), by: ownSeat.nickname, byKey: ownSeat.key, heroName: hero.name, hidden: false,
            label: `Новый уровень: ${hero.level} (+${gained} к максимуму хитов)`,
          });
        }
        return null;
      }
      case "gameInventory": {
        const seat = table.players.find(candidate => candidate.key === message.key);
        if (!seat?.heroId) return "UNKNOWN_SEAT";
        if (role !== "gm" && seat.key !== who.seatKey) return "NOT_YOUR_HERO";
        let items: InventoryItem[];
        let coins: Coins;
        try {
          if (message.inventory.length > MAX_INVENTORY) return "HERO_INVENTORY";
          items = message.inventory.map(item => parseInventoryItem(item));
          coins = parseCoins(message.coins);
        } catch (error: unknown) {
          return error instanceof HeroChoiceError ? error.code : "HERO_INVENTORY";
        }
        seat.inventory = items;
        seat.coins = coins;
        return null;
      }
    }
  }

  // ---- Saving-throw attacks ----------------------------------------------------

  private saveAttack(table: TableState, who: Subscription, role: TableRole, seat: SeatState | null,
    message: Extract<GameClientMessage, { type: "gameSaveAttack" }>): string | null {
    if (table.phase !== "playing") return "GAME_NOT_RUNNING";
    if (role === "spectator" || !seat) return "NOT_SEATED";
    const map = this.currentMap(table);
    if (!map) return "NO_MAP";
    const scene = this.sceneState(table, map);
    let attack: HeroSheet["attacks"][number] | undefined;
    let actor: string;
    if (message.source.type === "attack") {
      if (role !== "player") return "PLAYERS_ONLY";
      const hero = this.heroOf(table, seat.heroId);
      if (!hero) return "NEEDS_HERO";
      attack = hero.attacks[message.source.index];
      actor = hero.name;
    } else {
      if (role !== "gm") return "GM_ONLY";
      const sourceId = message.source.tokenId;
      const token = scene.tokens.find(candidate => candidate.id === sourceId && candidate.kind === "monster");
      attack = token ? this.findMonster(table.adventureId, token.monsterId)?.attacks[message.source.index] : undefined;
      if (!token) return "UNKNOWN_TOKEN";
      actor = token.name;
    }
    const save = attack && attack.bonus === null ? attackSaveOf(attack) : undefined;
    const expression = attack ? parseDiceExpression(attack.damage) : null;
    if (!attack || !save || !expression) return "NOT_A_SAVE_ATTACK";
    const visible = (token: TokenRecord) => token.kind === "hero" || (!token.hidden && scene.fog[token.y * map.cols + token.x] === 1);
    const targets = message.targets.map(id => scene.tokens.find(token => token.id === id));
    if (targets.some(token => !token || (role !== "gm" && !visible(token)))) return "UNKNOWN_TOKEN";
    const damage = this.throwDice(expression, "normal");
    const results: NonNullable<RollRecord["saves"]> = [];
    const hits: Array<[TokenRecord, number]> = [];
    for (const token of targets as TokenRecord[]) {
      let bonus = 0;
      let conditions: ConditionId[] = [];
      let exhaustion = 0;
      if (token.kind === "hero") {
        const target = table.players.find(candidate => candidate.key === token.seatKey);
        const hero = this.heroOf(table, target?.heroId);
        if (!hero || !target) continue;
        bonus = saveBonus(hero, save.ability);
        conditions = target.conditions ?? [];
        exhaustion = target.exhaustion ?? 0;
      } else {
        const monster = this.findMonster(table.adventureId, token.monsterId);
        if (!monster) continue;
        bonus = monsterSaveBonus(monster, save.ability);
        conditions = token.conditions ?? [];
      }
      const autoFail = (save.ability === "str" || save.ability === "dex")
        && conditions.some(item => item === "paralyzed" || item === "stunned" || item === "unconscious" || item === "petrified");
      const disadvantage = exhaustion >= 3 || (save.ability === "dex" && conditions.includes("restrained"));
      const roll = this.throwDice({ terms: [{ count: 1, sides: 20, sign: 1 }], modifier: bonus }, disadvantage ? "disadvantage" : "normal");
      const success = !autoFail && roll.total >= save.dc;
      const taken = Math.max(0, success ? (save.half ? Math.floor(damage.total / 2) : 0) : damage.total);
      hits.push([token, taken]);
      results.push({
        tokenId: token.id, name: token.name, total: roll.total, ...(roll.natural ? { natural: roll.natural } : {}), success, damage: taken,
        ...(token.kind === "monster" && !visible(token) ? { hiddenFromPlayers: true } : {}),
      });
    }
    const text = expression.terms.map(term => `${term.count}d${term.sides}`).join("+") + (expression.modifier ? formatModifier(expression.modifier) : "");
    this.publish(table, who.tableKey, {
      id: this.randomId(), at: this.now(), by: seat.nickname, byKey: seat.key, heroName: actor,
      label: `${attack.name}: спасбросок ${ABILITY_LABEL[save.ability]}`, hidden: false,
      expr: text, dice: damage.dice, modifier: expression.modifier, total: damage.total, mode: "normal",
      dc: save.dc, saves: results, saveAbility: save.ability, damage: true, applied: true,
    });
    // Applied after the roll is in the log, so concentration saves follow it.
    for (const [token, taken] of hits) this.damageToken(table, who.tableKey, token, taken);
    return null;
  }

  private ping(table: TableState, who: Subscription, x: number, y: number): string | null {
    const role = this.roleOf(table, who.seatKey);
    if (role === "spectator") return "NOT_SEATED";
    if (table.phase !== "playing") return "GAME_NOT_RUNNING";
    const map = this.currentMap(table);
    if (!map) return "NO_MAP";
    if (x > map.cols || y > map.rows) return "OUT_OF_BOUNDS";
    const by = role === "player" ? this.heroOf(table, table.players.find(seat => seat.key === who.seatKey)?.heroId)?.name ?? who.nickname : who.nickname;
    for (const [entryId, subscription] of this.subscriptions) {
      if (subscription.tableKey === who.tableKey) this.sendRaw(entryId, { type: "gamePinged", by, x, y, gm: role === "gm" });
    }
    return null;
  }

  private currentMap(table: TableState): SceneMap | undefined {
    return table.phase === "playing" ? this.findAdventure(table.adventureId)?.scenes[table.scene]?.map : undefined;
  }

  private sceneState(table: TableState, map: SceneMap): SceneState {
    let scene = table.scenes.get(table.scene);
    if (!scene) {
      scene = { fog: new Uint8Array(map.cols * map.rows), tokens: [], counters: new Map() };
      table.scenes.set(table.scene, scene);
      this.prepareScene(table, map, scene);
    }
    return scene;
  }

  /** The adventure's own setup for a map: lit areas and waiting monsters. */
  private prepareScene(table: TableState, map: SceneMap, scene: SceneState): void {
    const content = this.findAdventure(table.adventureId)?.scenes[table.scene];
    for (const [left, top, width, height] of content?.reveal ?? []) {
      for (let y = Math.max(0, top); y < Math.min(map.rows, top + height); y++) {
        for (let x = Math.max(0, left); x < Math.min(map.cols, left + width); x++) scene.fog[y * map.cols + x] = 1;
      }
    }
    for (const placed of content?.encounter ?? []) {
      const monster = this.findMonster(table.adventureId, placed.monsterId);
      if (!monster || placed.x >= map.cols || placed.y >= map.rows || scene.tokens.length >= MAX_MAP_TOKENS) continue;
      if (scene.tokens.some(token => token.x === placed.x && token.y === placed.y)) continue;
      const number = (scene.counters.get(monster.id) ?? 0) + 1;
      scene.counters.set(monster.id, number);
      scene.tokens.push({
        id: this.randomId(), kind: "monster", x: placed.x, y: placed.y, name: `${monster.name} ${number}`,
        monsterId: monster.id, hp: monster.maxHp, maxHp: monster.maxHp, hidden: placed.hidden === true,
      });
    }
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
      const hero = this.heroOf(table, seat.heroId)!;
      const spot = this.freeSpot(map, scene);
      if (!spot) continue;
      scene.tokens.push({ id: this.randomId(), kind: "hero", x: spot[0], y: spot[1], name: hero.name, seatKey: seat.key, heroId: hero.id, hidden: false });
      revealAround(scene.fog, map, spot[0], spot[1], SPAWN_REVEAL_RADIUS);
    }
    // Heroes light what they can see wherever they stand (no walls on a picture: a circle).
    if (table.vision > 0) for (const token of scene.tokens) if (token.kind === "hero") revealAround(scene.fog, map, token.x, token.y, table.vision);
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
    return { cols: map.cols, rows: map.rows, fog, tokens, vision: table.vision };
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
    const hero = role === "player" ? this.heroOf(table, seat.heroId) : undefined;
    const map = this.currentMap(table);
    const scene = map ? this.sceneState(table, map) : undefined;
    let monster: { sheet: MonsterSheet; name: string } | undefined;
    if (source.type === "monsterAttack" || source.type === "monsterDamage") {
      if (role !== "gm") return "GM_ONLY";
      const token = scene?.tokens.find(candidate => candidate.id === source.tokenId && candidate.kind === "monster");
      const sheet = token ? this.findMonster(table.adventureId, token.monsterId) : undefined;
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
    let reasons: string[] = [];
    if (planned.d20) {
      const kind = source.type === "attack" || source.type === "monsterAttack" ? "attack"
        : source.type === "save" ? "save" : source.type === "ability" || source.type === "skill" ? "check" : null;
      if (kind) {
        const actorToken = source.type === "monsterAttack" ? scene?.tokens.find(candidate => candidate.id === source.tokenId) : undefined;
        const self = hero ? { conditions: seat.conditions, exhaustion: seat.exhaustion } : { conditions: actorToken?.conditions };
        const targetConditions = target?.kind === "hero" ? table.players.find(candidate => candidate.key === target!.seatKey)?.conditions : target?.conditions;
        const ability = source.type === "save" || source.type === "ability" ? source.ability : source.type === "skill" ? SKILLS[source.skill] : null;
        const decided = conditionMode(mode, kind, self, ability, target ? { conditions: targetConditions } : undefined);
        mode = decided.mode;
        reasons = decided.reasons;
      }
    }
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
      ...(reasons.length ? { reasons } : {}),
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
        const ac = target.kind === "hero" ? this.heroOf(table, target.heroId)?.ac : this.findMonster(table.adventureId, target.monsterId)?.ac;
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
    const { byKey: _byKey, saves, ...rest } = record;
    const view: RollView = {
      ...rest,
      ...(saves ? { saves: saves.filter(item => role === "gm" || !item.hiddenFromPlayers).map(({ hiddenFromPlayers: _hidden, ...item }) => item) } : {}),
    };
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
      ...(state.conditions?.length ? { conditions: [...state.conditions] } : {}),
      ...(state.exhaustion ? { exhaustion: state.exhaustion } : {}),
      ...(state.used && Object.keys(state.used).length ? { used: { ...state.used } } : {}),
      ...(state.heroId ? { hitDice: state.hitDice ?? this.heroOf(table, state.heroId)?.level ?? 1 } : {}),
      ...(state.heroId ? { xp: state.xp ?? 0 } : {}),
      ...((role === "gm" || state.key === seatKey) && state.inventory ? { inventory: state.inventory.map(item => ({ ...item })), coins: { ...(state.coins ?? { gp: 0, sp: 0, cp: 0 }) } } : {}),
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
      music: this.musicFor(table),
      musicAuto: table.music.auto,
      narration: table.narration ? { ...table.narration } : null,
      adventures: this.adventures().map(item => adventureListItem(item, this.isCustom(item.id))),
      customHeroes: table.players.flatMap(state => state.custom ? [state.custom] : []),
    };
  }

  private broadcast(tableKey: string): void {
    const table = this.tables.get(tableKey);
    if (!table) return;
    for (const [entryId, subscription] of this.subscriptions) {
      if (subscription.tableKey !== tableKey) continue;
      const adventure = this.findAdventure(table.adventureId);
      const gm = this.roleOf(table, subscription.seatKey) === "gm";
      const marker = adventure ? `${adventure.id}|${gm}` : undefined;
      if (adventure && subscription.adventureSent !== marker) {
        subscription.adventureSent = marker;
        this.sendRaw(entryId, { type: "gameAdventureData", adventure: gm ? adventure : adventureForPlayers(adventure) });
      }
      this.sendRaw(entryId, { type: "gameState", table: this.viewFor(tableKey, table, subscription.seatKey) });
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

// ---- Snapshots -------------------------------------------------------------

/** A table as plain JSON (fog as a "0101…" string, maps as entry lists). */
function snapshotTable(table: TableState): unknown {
  return {
    v: SNAPSHOT_VERSION,
    phase: table.phase,
    adventureId: table.adventureId,
    gm: table.gm,
    players: table.players,
    rolls: table.rolls,
    checks: table.checks,
    scene: table.scene,
    scenes: [...table.scenes].map(([index, scene]) => [index, { fog: Array.from(scene.fog, cell => (cell ? "1" : "0")).join(""), tokens: scene.tokens, counters: [...scene.counters] }]),
    combat: table.combat,
    music: table.music,
    narration: table.narration,
    vision: table.vision,
    updatedAt: table.updatedAt,
  };
}

/** Reads a snapshot back; anything unexpected gives null (the table starts fresh). */
function restoreTable(raw: unknown): TableState | null {
  try {
    if (typeof raw !== "object" || raw === null) return null;
    const data = raw as Record<string, unknown>;
    if (data.v !== SNAPSHOT_VERSION || (data.phase !== "lobby" && data.phase !== "playing")) return null;
    if (!Array.isArray(data.players) || !Array.isArray(data.rolls) || !Array.isArray(data.checks) || !Array.isArray(data.scenes)) return null;
    const scenes = new Map<number, SceneState>();
    for (const entry of data.scenes as Array<[number, { fog: string; tokens: TokenRecord[]; counters: Array<[string, number]> }]>) {
      const [index, scene] = entry;
      if (!Number.isInteger(index) || typeof scene?.fog !== "string" || !/^[01]*$/.test(scene.fog) || !Array.isArray(scene.tokens)) return null;
      scenes.set(index, { fog: Uint8Array.from(scene.fog, cell => (cell === "1" ? 1 : 0)), tokens: scene.tokens, counters: new Map(scene.counters ?? []) });
    }
    const music = data.music as TableState["music"] | undefined;
    return {
      phase: data.phase,
      adventureId: typeof data.adventureId === "string" ? data.adventureId : null,
      gm: (data.gm as SeatState | null) ?? null,
      players: data.players as SeatState[],
      rolls: (data.rolls as RollRecord[]).slice(-ROLL_LOG_SIZE),
      checks: data.checks as CheckRecord[],
      scene: Number.isInteger(data.scene) ? data.scene as number : 0,
      scenes,
      combat: (data.combat as CombatState | null) ?? null,
      music: music && typeof music.auto === "boolean" ? music : { trackId: null, startedAt: 0, auto: true },
      narration: (data.narration as TableState["narration"]) ?? null,
      vision: (VISION_RADII as readonly unknown[]).includes(data.vision) ? data.vision as number : DEFAULT_VISION,
      updatedAt: typeof data.updatedAt === "number" ? data.updatedAt : 0,
    };
  } catch {
    return null;
  }
}
