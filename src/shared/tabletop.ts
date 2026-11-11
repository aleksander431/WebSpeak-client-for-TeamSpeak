/*
 * Channel tabletop games (first: D&D 5e by the SRD 5.1, CC BY 4.0). Browser-safe
 * wire types, parsers and the rules helpers both ends use. The gateway is the
 * authority: it owns seats, rolls every die and decides what each viewer sees.
 */

export const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"] as const;
export type Ability = typeof ABILITIES[number];

export const SKILLS = {
  acrobatics: "dex", animalHandling: "wis", arcana: "int", athletics: "str", deception: "cha", history: "int",
  insight: "wis", intimidation: "cha", investigation: "int", medicine: "wis", nature: "int", perception: "wis",
  performance: "cha", persuasion: "cha", religion: "int", sleightOfHand: "dex", stealth: "dex", survival: "wis",
} as const satisfies Record<string, Ability>;
export type Skill = keyof typeof SKILLS;
export const SKILL_IDS = Object.keys(SKILLS) as Skill[];

export interface HeroAttack {
  name: string;
  /** Attack bonus; null for something that forces a saving throw instead. */
  bonus: number | null;
  /** Damage dice expression, e.g. "1d8+3". */
  damage: string;
  note: string;
}

export interface HeroSheet {
  id: string;
  name: string;
  race: string;
  cls: string;
  level: number;
  maxHp: number;
  ac: number;
  speed: number;
  abilities: Record<Ability, number>;
  saves: Ability[];
  skills: Skill[];
  expertise?: Skill[];
  attacks: HeroAttack[];
  features: string[];
  equipment: string[];
  spells?: string[];
  story: string;
}

export interface AdventureSummary {
  id: string;
  title: string;
  summary: string;
  level: number;
  length: string;
  scenes: string[];
  heroes: HeroSheet[];
}

export const MAX_PLAYERS = 6;
export const ROLL_LOG_SIZE = 40;

export function abilityModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

export function proficiencyBonus(level: number): number {
  return 2 + Math.floor((Math.max(1, level) - 1) / 4);
}

export function skillBonus(hero: HeroSheet, skill: Skill): number {
  const base = abilityModifier(hero.abilities[SKILLS[skill]]);
  const proficient = hero.skills.includes(skill);
  const expert = proficient && Boolean(hero.expertise?.includes(skill));
  return base + (proficient ? proficiencyBonus(hero.level) * (expert ? 2 : 1) : 0);
}

export function saveBonus(hero: HeroSheet, ability: Ability): number {
  return abilityModifier(hero.abilities[ability]) + (hero.saves.includes(ability) ? proficiencyBonus(hero.level) : 0);
}

// ---- Dice expressions ------------------------------------------------------

export const DIE_SIDES = [2, 4, 6, 8, 10, 12, 20, 100] as const;
export const MAX_DICE = 20;

export interface DiceTerm { count: number; sides: number; sign: 1 | -1 }
export interface DiceExpression { terms: DiceTerm[]; modifier: number }

/** "2d6+1d4-1" → dice terms and a flat modifier; null when invalid or too big. */
export function parseDiceExpression(input: string): DiceExpression | null {
  const text = input.replace(/\s+/g, "").toLowerCase().replace(/к/g, "d");
  if (!text || text.length > 40 || !/^[+-]?[0-9d]+([+-][0-9d]+)*$/.test(text)) return null;
  const parts = text.match(/[+-]?[^+-]+/g) ?? [];
  const terms: DiceTerm[] = [];
  let modifier = 0;
  let dice = 0;
  for (const part of parts) {
    const sign: 1 | -1 = part.startsWith("-") ? -1 : 1;
    const body = part.replace(/^[+-]/, "");
    const die = /^(\d{0,2})d(\d{1,3})$/.exec(body);
    if (die) {
      const count = die[1] ? Number(die[1]) : 1;
      const sides = Number(die[2]);
      if (count < 1 || !(DIE_SIDES as readonly number[]).includes(sides)) return null;
      dice += count;
      terms.push({ count, sides, sign });
    } else if (/^\d{1,3}$/.test(body)) {
      modifier += sign * Number(body);
    } else {
      return null;
    }
  }
  if (!terms.length || dice > MAX_DICE) return null;
  return { terms, modifier };
}

export function formatModifier(value: number): string {
  return value >= 0 ? `+${value}` : `−${Math.abs(value)}`;
}

// ---- Wire types ------------------------------------------------------------

export type RollMode = "normal" | "advantage" | "disadvantage";

export type RollSource =
  | { type: "free"; expr: string }
  | { type: "ability"; ability: Ability }
  | { type: "skill"; skill: Skill }
  | { type: "save"; ability: Ability }
  | { type: "attack"; index: number }
  | { type: "damage"; index: number; crit?: boolean }
  | { type: "initiative" };

export type CheckSource = Extract<RollSource, { type: "ability" | "skill" | "save" }>;

export interface RollDie { sides: number; value: number; dropped?: boolean }

export interface RollView {
  id: string;
  at: number;
  by: string;
  heroName?: string;
  label: string;
  /** Hidden from this viewer: only who rolled and when. */
  secret?: boolean;
  hidden?: boolean;
  expr?: string;
  dice?: RollDie[];
  modifier?: number;
  total?: number;
  mode?: RollMode;
  /** The kept d20 of a d20 roll (for crit/fumble effects). */
  natural?: number;
  checkId?: string;
  /** For a requested check: whether it met the (hidden) difficulty. */
  success?: boolean;
  dc?: number;
}

export interface CheckView {
  id: string;
  label: string;
  source: CheckSource;
  /** Only the game master sees the difficulty. */
  dc?: number;
  mode: RollMode;
  /** Seat keys asked to roll; those who already did are in `done`. */
  targets: string[];
  done: string[];
}

export interface SeatView {
  key: string;
  nickname: string;
  online: boolean;
  ready: boolean;
  heroId: string | null;
  hp: number | null;
}

export type TableRole = "gm" | "player" | "spectator";

export interface TableView {
  phase: "lobby" | "playing";
  adventureId: string | null;
  gm: { key: string; nickname: string; online: boolean; ready: boolean } | null;
  players: SeatView[];
  you: { key: string; role: TableRole };
  rolls: RollView[];
  checks: CheckView[];
}

export type GameClientMessage =
  | { type: "gameOpen" }
  | { type: "gameClose" }
  | { type: "gameSeat"; role: TableRole }
  | { type: "gameReady"; ready: boolean }
  | { type: "gameAdventure"; adventureId: string }
  | { type: "gameHero"; heroId: string | null }
  | { type: "gameStart" }
  | { type: "gameEnd" }
  | { type: "gameRoll"; source: RollSource; mode: RollMode; hidden: boolean; checkId?: string }
  | { type: "gameHp"; key: string; hp: number }
  | { type: "gameCheck"; source: CheckSource; dc: number; mode: RollMode; targets: string[] }
  | { type: "gameCheckCancel"; checkId: string };

export type GameServerMessage =
  | { type: "gameState"; table: TableView | null }
  | { type: "gameRolled"; roll: RollView }
  | { type: "gameError"; code: string };

// ---- Parsers ---------------------------------------------------------------

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isAbility = (value: unknown): value is Ability => typeof value === "string" && (ABILITIES as readonly string[]).includes(value);
const isSkill = (value: unknown): value is Skill => typeof value === "string" && Object.prototype.hasOwnProperty.call(SKILLS, value);
const isMode = (value: unknown): value is RollMode => value === "normal" || value === "advantage" || value === "disadvantage";
const isRole = (value: unknown): value is TableRole => value === "gm" || value === "player" || value === "spectator";
const shortId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value);
const seatKey = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 160;

export function parseRollSource(value: unknown): RollSource | null {
  if (!isObject(value)) return null;
  switch (value.type) {
    case "free": return typeof value.expr === "string" && parseDiceExpression(value.expr) ? { type: "free", expr: value.expr.slice(0, 40) } : null;
    case "ability": return isAbility(value.ability) ? { type: "ability", ability: value.ability } : null;
    case "skill": return isSkill(value.skill) ? { type: "skill", skill: value.skill } : null;
    case "save": return isAbility(value.ability) ? { type: "save", ability: value.ability } : null;
    case "attack": return Number.isInteger(value.index) && (value.index as number) >= 0 && (value.index as number) < 16 ? { type: "attack", index: value.index as number } : null;
    case "damage": return Number.isInteger(value.index) && (value.index as number) >= 0 && (value.index as number) < 16
      ? { type: "damage", index: value.index as number, ...(value.crit === true ? { crit: true } : {}) } : null;
    case "initiative": return { type: "initiative" };
    default: return null;
  }
}

function checkSource(value: unknown): CheckSource | null {
  const source = parseRollSource(value);
  return source && (source.type === "ability" || source.type === "skill" || source.type === "save") ? source : null;
}

/** null: not a game frame; `{ error }`: a malformed game frame. */
export function parseGameClientMessage(raw: unknown): GameClientMessage | { error: { code: string } } | null {
  if (!isObject(raw) || typeof raw.type !== "string" || !raw.type.startsWith("game")) return null;
  const invalid = { error: { code: "INVALID_GAME_MESSAGE" } };
  switch (raw.type) {
    case "gameOpen": return { type: "gameOpen" };
    case "gameClose": return { type: "gameClose" };
    case "gameStart": return { type: "gameStart" };
    case "gameEnd": return { type: "gameEnd" };
    case "gameSeat": return isRole(raw.role) ? { type: "gameSeat", role: raw.role } : invalid;
    case "gameReady": return typeof raw.ready === "boolean" ? { type: "gameReady", ready: raw.ready } : invalid;
    case "gameAdventure": return shortId(raw.adventureId) ? { type: "gameAdventure", adventureId: raw.adventureId } : invalid;
    case "gameHero": return raw.heroId === null || shortId(raw.heroId) ? { type: "gameHero", heroId: raw.heroId as string | null } : invalid;
    case "gameRoll": {
      const source = parseRollSource(raw.source);
      if (!source || !isMode(raw.mode) || typeof raw.hidden !== "boolean") return invalid;
      if (raw.checkId !== undefined && !shortId(raw.checkId)) return invalid;
      return { type: "gameRoll", source, mode: raw.mode, hidden: raw.hidden, ...(typeof raw.checkId === "string" ? { checkId: raw.checkId } : {}) };
    }
    case "gameHp":
      return seatKey(raw.key) && Number.isInteger(raw.hp) && (raw.hp as number) >= -100 && (raw.hp as number) <= 999 ? { type: "gameHp", key: raw.key, hp: raw.hp as number } : invalid;
    case "gameCheck": {
      const source = checkSource(raw.source);
      if (!source || !Number.isInteger(raw.dc) || (raw.dc as number) < 1 || (raw.dc as number) > 40 || !isMode(raw.mode)) return invalid;
      if (!Array.isArray(raw.targets) || raw.targets.length > MAX_PLAYERS || !raw.targets.every(seatKey)) return invalid;
      return { type: "gameCheck", source, dc: raw.dc as number, mode: raw.mode, targets: [...new Set(raw.targets as string[])] };
    }
    case "gameCheckCancel": return shortId(raw.checkId) ? { type: "gameCheckCancel", checkId: raw.checkId } : invalid;
    default: return invalid;
  }
}

/** The browser trusts its own gateway; this only checks the frame's shape. */
export function parseGameServerMessage(raw: unknown): GameServerMessage | null {
  if (!isObject(raw)) return null;
  if (raw.type === "gameState" && (raw.table === null || isObject(raw.table))) return raw as unknown as GameServerMessage;
  if (raw.type === "gameRolled" && isObject(raw.roll)) return raw as unknown as GameServerMessage;
  if (raw.type === "gameError" && typeof raw.code === "string") return { type: "gameError", code: raw.code };
  return null;
}
