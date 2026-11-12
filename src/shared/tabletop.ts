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
  /** A saving throw instead of (or after) an attack roll: targets roll it against `dc`; `half` halves the damage on a success. */
  save?: AttackSave;
}

export interface AttackSave {
  ability: Ability;
  dc: number;
  half: boolean;
}

/** Something a hero spends and gets back on a rest: spell slots, rage, second wind… */
export interface HeroResource {
  id: string;
  name: string;
  max: number;
  recharge: "short" | "long";
}

/** SRD 5.1 conditions, plus concentration (not a condition, but tracked the same way). */
export const CONDITIONS = [
  "blinded", "charmed", "deafened", "frightened", "grappled", "incapacitated", "invisible", "paralyzed",
  "petrified", "poisoned", "prone", "restrained", "stunned", "unconscious", "concentration",
] as const;
export type ConditionId = typeof CONDITIONS[number];
export const MAX_EXHAUSTION = 6;

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
  /** Portrait under the site root. */
  portrait?: string;
  /** Hit die size (d6–d12): short rests spend them to heal. Defaults to 8. */
  hitDie?: number;
  resources?: HeroResource[];
}

/** A tactical map: a picture with a square grid laid over it (5 ft per cell). */
export interface SceneMap {
  /** Path under the site root, e.g. "/dnd/solgard-bell/map-crypt.webp". */
  image: string;
  cols: number;
  rows: number;
  /** Where the heroes appear on their first visit, in order. */
  spawn: Array<[number, number]>;
}

/** A monster the adventure places on a map the first time the scene opens. */
export interface EncounterToken {
  monsterId: string;
  x: number;
  y: number;
  /** Kept from players until the game master shows it. */
  hidden?: boolean;
}

export interface AdventureScene {
  id: string;
  title: string;
  /** A picture for story scenes (shown when there is no map). */
  art?: string;
  map?: SceneMap;
  /** Text the game master reads aloud (and may show to everyone). */
  intro?: string;
  /** Game master only: secrets, checks and what happens next. */
  notes?: string;
  /** Track id from the adventure's music list. */
  music?: string;
  encounter?: EncounterToken[];
  /** Map areas already lit on the first visit: [x, y, width, height] in cells. */
  reveal?: Array<[number, number, number, number]>;
  /** Game master only: items found here, given to heroes from the scene card. */
  loot?: SceneLoot[];
}

export interface SceneLoot {
  name: string;
  qty: number;
  text?: string;
  /** Picture URL. */
  icon?: string;
}

export interface MusicTrack {
  id: string;
  title: string;
  /** Path under the site root, e.g. "/dnd/solgard-bell/music-tavern.ogg". */
  file: string;
}

export interface MonsterSheet {
  id: string;
  name: string;
  /** Challenge rating as printed, e.g. "1/4". */
  cr: string;
  maxHp: number;
  ac: number;
  speed: number;
  /** Dexterity score, for initiative. */
  dex: number;
  /** Saving throw bonuses; unlisted ones are 0 (Dexterity: its modifier). */
  saves?: Partial<Record<Ability, number>>;
  attacks: HeroAttack[];
  traits: string[];
  portrait?: string;
}

export interface AdventureSummary {
  id: string;
  title: string;
  summary: string;
  level: number;
  length: string;
  scenes: AdventureScene[];
  heroes: HeroSheet[];
  monsters: MonsterSheet[];
  music?: MusicTrack[];
  /** Played during combat when music follows the scenes. */
  combatMusic?: string;
}

export const MAX_PLAYERS = 6;
export const MAX_MAP_TOKENS = 60;
export const MAX_NARRATION_LENGTH = 2000;
export const MAX_MAP_CELLS = 64 * 64;
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

export function monsterSaveBonus(monster: MonsterSheet, ability: Ability): number {
  return monster.saves?.[ability] ?? (ability === "dex" ? abilityModifier(monster.dex) : 0);
}

export function heroHitDie(hero: HeroSheet): number {
  return hero.hitDie ?? 8;
}

/** Reads "спасбросок Ловкости СЛ 13" style notes of older sheets into a structured save. */
export function attackSaveOf(attack: HeroAttack): AttackSave | undefined {
  if (attack.save) return attack.save;
  const match = /спасбросок\s+(Силы|Ловкости|Телосложения|Интеллекта|Мудрости|Харизмы|Сил|Лов|Тел|Инт|Мдр|Хар)\S*\s+СЛ\s+(\d{1,2})/i.exec(attack.note);
  if (!match) return undefined;
  const key = match[1]!.slice(0, 3).toLowerCase();
  const ability = ({ сил: "str", лов: "dex", тел: "con", инт: "int", муд: "wis", мдр: "wis", хар: "cha" } as Record<string, Ability>)[key];
  return ability ? { ability, dc: Number(match[2]), half: /половин/i.test(attack.note) } : undefined;
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
  | { type: "initiative" }
  | { type: "deathSave" }
  /** Game master only: a monster token's attack or damage. */
  | { type: "monsterAttack"; tokenId: string; index: number }
  | { type: "monsterDamage"; tokenId: string; index: number; crit?: boolean };

export type CheckSource = Extract<RollSource, { type: "ability" | "skill" | "save" }>;

export interface RollDie { sides: number; value: number; dropped?: boolean }

/** One term of a roll's flat modifier, so the page can say what was added: "+3 Dexterity +2 proficiency". */
export interface RollPart {
  kind: "ability" | "proficiency" | "expertise" | "attack" | "flat";
  ability?: Ability;
  value: number;
}

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
  /** The token the roll was aimed at (attacks and damage). */
  targetId?: string;
  targetName?: string;
  /** Attack rolls against a target: hit or miss (the target's armour class only for the game master). */
  hit?: boolean;
  targetAc?: number;
  /** Damage rolls against a target: whether the game master has applied it. */
  damage?: boolean;
  applied?: boolean;
  /** Death saving throws: the outcome. */
  deathSave?: "success" | "failure" | "revived";
  /** A saving-throw attack: each target's save and the damage it took (already applied). */
  saves?: SaveResultView[];
  saveAbility?: Ability;
  /** Hit dice spent on a short rest: hit points regained. */
  healed?: number;
  /** Why the gateway gave advantage or disadvantage (conditions, exhaustion). */
  reasons?: string[];
  /** The master applied this result by hand: to whom and how. */
  appliedTo?: { names: string[]; mode: ApplyMode };
  /** What the modifier is made of (named rolls only). */
  parts?: RollPart[];
}

export type ApplyMode = "damage" | "half" | "heal";

/** The master's own hazard: a trap, a falling chandelier, a cloud of spores. */
export interface HazardSource {
  type: "hazard";
  name: string;
  /** Empty: no damage, only the save (and its condition). */
  damage: string;
  ability: Ability;
  dc: number;
  half: boolean;
  /** Put on everyone who fails. */
  condition?: ConditionId;
}

/** A creature made up on the spot. */
export interface QuickMonster {
  name: string;
  maxHp: number;
  ac: number;
  dex: number;
  speed: number;
  attack?: { name: string; bonus: number; damage: string };
}

export const MAX_EXTRA_MONSTERS = 30;

export interface SaveResultView {
  tokenId: string;
  name: string;
  /** Hidden from players for monsters they cannot see. */
  total?: number;
  natural?: number;
  success: boolean;
  damage: number;
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
  /** At 0 hit points: dying (rolling death saves), stable or dead. */
  dying?: { successes: number; failures: number; state: "dying" | "stable" | "dead" };
  conditions?: ConditionId[];
  /** 1–6 levels of exhaustion. */
  exhaustion?: number;
  /** Spent uses per resource id. */
  used?: Record<string, number>;
  /** Hit dice left to spend. */
  hitDice?: number;
  xp?: number;
  /** Only for the game master and the seat's own player. */
  inventory?: Array<{ name: string; qty: number; note?: string; icon?: string }>;
  coins?: { gp: number; sp: number; cp: number };
}

/** A player's own hero kept by the gateway for their TeamSpeak identity. */
export interface VaultHero {
  id: string;
  choices: unknown;
  updatedAt: number;
}

export type TableRole = "gm" | "player" | "spectator";

export interface TokenView {
  id: string;
  kind: "hero" | "monster";
  x: number;
  y: number;
  name: string;
  /** Hero tokens: the seat that plays it (it may move it) and the hero. */
  seatKey?: string;
  heroId?: string;
  monsterId?: string;
  /** Monster hit points: game master only. */
  hp?: number;
  maxHp?: number;
  /** Monsters as players see them: hurt to half or below, or down. */
  condition?: "bloodied" | "down";
  /** Kept from players (game master only sees it, marked). */
  hidden?: boolean;
  /** Monster tokens; heroes carry theirs on the seat. */
  conditions?: ConditionId[];
}

export interface MusicView {
  trackId: string;
  title: string;
  url: string;
  /** How long the track has been playing on the gateway's clock when this view was made. */
  elapsedMs: number;
  /** True while the music follows scenes and combat by itself. */
  auto: boolean;
}

export interface NarrationView {
  id: string;
  title: string;
  text: string;
  art?: string;
}

export interface CombatantView {
  id: string;
  tokenId: string;
  kind: "hero" | "monster";
  name: string;
  seatKey?: string;
  heroId?: string;
  monsterId?: string;
  /** null until rolled. */
  initiative: number | null;
}

export interface CombatView {
  /** "initiative" while heroes still roll; then turns run. */
  phase: "initiative" | "running";
  round: number;
  /** The combatant whose turn it is, or null when this viewer may not see it (a hidden monster). */
  activeId: string | null;
  /** True when the turn belongs to someone this viewer cannot see. */
  activeHidden?: boolean;
  order: CombatantView[];
}

export interface MapView {
  cols: number;
  rows: number;
  /** One character per cell, row by row: "1" revealed, "0" under fog. */
  fog: string;
  tokens: TokenView[];
  /** Cells the fog opens around every hero as it moves; 0 when the master opens it by hand only. */
  vision: number;
}

export const VISION_RADII = [0, 3, 6, 12] as const;

/** The party's shared journal: quests, people, places, clues and notes, kept across games at the table. */
export const JOURNAL_KINDS = ["quest", "person", "place", "clue", "note"] as const;
export type JournalKind = typeof JOURNAL_KINDS[number];
export const MAX_JOURNAL_ENTRIES = 150;
export const MAX_JOURNAL_TEXT = 600;

export interface JournalEntryView {
  id: string;
  at: number;
  by: string;
  kind: JournalKind;
  text: string;
  /** This viewer wrote it (or is the master): may edit and remove it. */
  editable: boolean;
}
export const DEFAULT_VISION = 6;

export interface TableView {
  phase: "lobby" | "playing";
  adventureId: string | null;
  gm: { key: string; nickname: string; online: boolean; ready: boolean } | null;
  players: SeatView[];
  you: { key: string; role: TableRole };
  rolls: RollView[];
  checks: CheckView[];
  /** Index into the adventure's scenes while playing. */
  scene: number;
  /** The current scene's map, if it has one. */
  map: MapView | null;
  combat: CombatView | null;
  /** null when silent; `auto` still tells whether it follows the scenes. */
  music: MusicView | null;
  musicAuto: boolean;
  narration: NarrationView | null;
  /** Players' own heroes at this table (built by the gateway). */
  customHeroes: HeroSheet[];
  /** Game master only: creatures made up during play (quick sheets). */
  extraMonsters?: MonsterSheet[];
  /** The party's journal, newest first. */
  journal: JournalEntryView[];
  /** Game master only: found items already handed out, as "sceneId:index". */
  lootGiven?: string[];
  /** Adventures the game master may choose from. */
  adventures: Array<{ id: string; title: string; summary: string; level: number; length: string; custom: boolean }>;
}

export type GameClientMessage =
  | { type: "gameOpen" }
  | { type: "gameClose" }
  | { type: "gameSeat"; role: TableRole }
  | { type: "gameReady"; ready: boolean }
  | { type: "gameAdventure"; adventureId: string }
  | { type: "gameHero"; heroId: string | null }
  /** A player's own hero: the choices only, the gateway builds the sheet. */
  | { type: "gameCustomHero"; choices: unknown }
  | { type: "gameStart" }
  | { type: "gameEnd" }
  | { type: "gameRoll"; source: RollSource; mode: RollMode; hidden: boolean; checkId?: string; targetId?: string }
  | { type: "gameHp"; key: string; hp: number }
  | { type: "gameCheck"; source: CheckSource; dc: number; mode: RollMode; targets: string[] }
  | { type: "gameCheckCancel"; checkId: string }
  | { type: "gameScene"; index: number }
  | { type: "gameTokenAdd"; monsterId: string; x: number; y: number }
  | { type: "gameTokenMove"; id: string; x: number; y: number }
  | { type: "gameTokenRemove"; id: string }
  | { type: "gameTokenHp"; id: string; hp: number }
  | { type: "gameTokenHide"; id: string; hidden: boolean }
  | { type: "gameFog"; cells: number[]; reveal: boolean }
  | { type: "gameFogAll"; reveal: boolean }
  | { type: "gamePing"; x: number; y: number }
  | { type: "gameCombatStart" }
  | { type: "gameCombatEnd" }
  | { type: "gameCombatNext" }
  | { type: "gameCombatPrev" }
  | { type: "gameCombatRollAll" }
  | { type: "gameApply"; rollId: string; half: boolean }
  /** Game master: a track (null for silence) instead of the scene's own, or back to following the scenes. */
  | { type: "gameMusic"; trackId: string | null }
  | { type: "gameMusicAuto" }
  /** Game master: show text to everyone (the scene's intro when omitted). */
  | { type: "gameNarrate"; text?: string }
  | { type: "gameNarrationClose" }
  /** A condition on a hero (seat key) or a monster token; players only on their own hero. */
  | { type: "gameCondition"; target: string; condition: ConditionId; active: boolean }
  | { type: "gameExhaustion"; key: string; level: number }
  /** How many uses of a resource are spent. */
  | { type: "gameResource"; key: string; resourceId: string; used: number }
  /** Game master: every hero rests. */
  | { type: "gameRest"; kind: "short" | "long" }
  /** Spend a hit die: roll it plus Constitution and heal. */
  | { type: "gameHitDie"; key: string }
  /** A saving-throw attack against several tokens: every save is rolled and the damage applied at once. */
  | { type: "gameSaveAttack"; source: { type: "attack"; index: number } | { type: "monsterAttack"; tokenId: string; index: number } | HazardSource; targets: string[] }
  /** Game master: any roll's total as damage, half damage or healing to chosen tokens. */
  | { type: "gameApplyTo"; rollId: string; targets: string[]; mode: ApplyMode }
  /** Game master: a creature made up on the spot; it joins the monsters to place. */
  | { type: "gameMonsterCreate"; monster: QuickMonster }
  /** Game master: experience for heroes (negative takes it back). */
  | { type: "gameXp"; keys: string[]; amount: number }
  /** A player's own hero one level up: the new choices, checked against the old ones. */
  | { type: "gameLevelUp"; choices: unknown }
  | { type: "gameInventory"; key: string; inventory: unknown[]; coins: unknown }
  /** The player's hero library kept for their TeamSpeak identity. */
  | { type: "gameVaultSave"; hero: VaultHero }
  | { type: "gameVaultRemove"; id: string }
  /** Game master: how far heroes see (cells; 0 turns it off). */
  | { type: "gameVision"; radius: number }
  /** The party journal: seated people write, the author or the master edit and remove. */
  | { type: "gameJournalAdd"; kind: JournalKind; text: string }
  | { type: "gameJournalEdit"; id: string; kind: JournalKind; text: string }
  | { type: "gameJournalRemove"; id: string }
  /** Game master: hand a found item of the current scene to chosen heroes. */
  | { type: "gameGiveLoot"; index: number; keys: string[] };

export type GameServerMessage =
  | { type: "gameState"; table: TableView | null }
  | { type: "gameRolled"; roll: RollView }
  | { type: "gameError"; code: string }
  | { type: "gamePinged"; by: string; x: number; y: number; gm: boolean }
  /** The chosen adventure as this viewer may see it; sent before the state that needs it. */
  | { type: "gameAdventureData"; adventure: AdventureSummary }
  /** Heroes kept for this identity (sent on open and after changes; absent without a unique id). */
  | { type: "gameVault"; heroes: VaultHero[] };

// ---- Parsers ---------------------------------------------------------------

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isAbility = (value: unknown): value is Ability => typeof value === "string" && (ABILITIES as readonly string[]).includes(value);
const isSkill = (value: unknown): value is Skill => typeof value === "string" && Object.prototype.hasOwnProperty.call(SKILLS, value);
const isMode = (value: unknown): value is RollMode => value === "normal" || value === "advantage" || value === "disadvantage";
const isRole = (value: unknown): value is TableRole => value === "gm" || value === "player" || value === "spectator";
const shortId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value);
const cell = (value: unknown): boolean => Number.isInteger(value) && (value as number) >= 0 && (value as number) < 64;
const point = (value: unknown): boolean => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 64;
const seatKey = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 160;
const isCondition = (value: unknown): value is ConditionId => typeof value === "string" && (CONDITIONS as readonly string[]).includes(value);
const index16 = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0 && (value as number) < 16;

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
    case "deathSave": return { type: "deathSave" };
    case "monsterAttack":
      return shortId(value.tokenId) && Number.isInteger(value.index) && (value.index as number) >= 0 && (value.index as number) < 16
        ? { type: "monsterAttack", tokenId: value.tokenId, index: value.index as number } : null;
    case "monsterDamage":
      return shortId(value.tokenId) && Number.isInteger(value.index) && (value.index as number) >= 0 && (value.index as number) < 16
        ? { type: "monsterDamage", tokenId: value.tokenId, index: value.index as number, ...(value.crit === true ? { crit: true } : {}) } : null;
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
    case "gameCustomHero": return raw.choices && typeof raw.choices === "object" && !Array.isArray(raw.choices) ? { type: "gameCustomHero", choices: raw.choices } : invalid;
    case "gameRoll": {
      const source = parseRollSource(raw.source);
      if (!source || !isMode(raw.mode) || typeof raw.hidden !== "boolean") return invalid;
      if (raw.checkId !== undefined && !shortId(raw.checkId)) return invalid;
      if (raw.targetId !== undefined && !shortId(raw.targetId)) return invalid;
      return {
        type: "gameRoll", source, mode: raw.mode, hidden: raw.hidden,
        ...(typeof raw.checkId === "string" ? { checkId: raw.checkId } : {}),
        ...(typeof raw.targetId === "string" ? { targetId: raw.targetId } : {}),
      };
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
    case "gameScene": return Number.isInteger(raw.index) && (raw.index as number) >= 0 && (raw.index as number) < 64 ? { type: "gameScene", index: raw.index as number } : invalid;
    case "gameTokenAdd": return shortId(raw.monsterId) && cell(raw.x) && cell(raw.y) ? { type: "gameTokenAdd", monsterId: raw.monsterId, x: raw.x as number, y: raw.y as number } : invalid;
    case "gameTokenMove": return shortId(raw.id) && cell(raw.x) && cell(raw.y) ? { type: "gameTokenMove", id: raw.id, x: raw.x as number, y: raw.y as number } : invalid;
    case "gameTokenRemove": return shortId(raw.id) ? { type: "gameTokenRemove", id: raw.id } : invalid;
    case "gameTokenHp":
      return shortId(raw.id) && Number.isInteger(raw.hp) && (raw.hp as number) >= 0 && (raw.hp as number) <= 999 ? { type: "gameTokenHp", id: raw.id, hp: raw.hp as number } : invalid;
    case "gameTokenHide": return shortId(raw.id) && typeof raw.hidden === "boolean" ? { type: "gameTokenHide", id: raw.id, hidden: raw.hidden } : invalid;
    case "gameFog":
      if (typeof raw.reveal !== "boolean" || !Array.isArray(raw.cells) || raw.cells.length > MAX_MAP_CELLS) return invalid;
      if (!raw.cells.every(value => Number.isInteger(value) && (value as number) >= 0 && (value as number) < MAX_MAP_CELLS)) return invalid;
      return { type: "gameFog", cells: [...new Set(raw.cells as number[])], reveal: raw.reveal };
    case "gameFogAll": return typeof raw.reveal === "boolean" ? { type: "gameFogAll", reveal: raw.reveal } : invalid;
    case "gamePing": return point(raw.x) && point(raw.y) ? { type: "gamePing", x: raw.x as number, y: raw.y as number } : invalid;
    case "gameCombatStart": return { type: "gameCombatStart" };
    case "gameCombatEnd": return { type: "gameCombatEnd" };
    case "gameCombatNext": return { type: "gameCombatNext" };
    case "gameCombatPrev": return { type: "gameCombatPrev" };
    case "gameCombatRollAll": return { type: "gameCombatRollAll" };
    case "gameMusic":
      return raw.trackId === null || shortId(raw.trackId) ? { type: "gameMusic", trackId: raw.trackId as string | null } : invalid;
    case "gameMusicAuto": return { type: "gameMusicAuto" };
    case "gameNarrate":
      if (raw.text === undefined) return { type: "gameNarrate" };
      return typeof raw.text === "string" && raw.text.trim().length > 0 && raw.text.length <= MAX_NARRATION_LENGTH ? { type: "gameNarrate", text: raw.text.trim() } : invalid;
    case "gameNarrationClose": return { type: "gameNarrationClose" };
    case "gameApply": return shortId(raw.rollId) && typeof raw.half === "boolean" ? { type: "gameApply", rollId: raw.rollId, half: raw.half } : invalid;
    case "gameCondition":
      return seatKey(raw.target) && isCondition(raw.condition) && typeof raw.active === "boolean"
        ? { type: "gameCondition", target: raw.target, condition: raw.condition, active: raw.active } : invalid;
    case "gameExhaustion":
      return seatKey(raw.key) && Number.isInteger(raw.level) && (raw.level as number) >= 0 && (raw.level as number) <= MAX_EXHAUSTION
        ? { type: "gameExhaustion", key: raw.key, level: raw.level as number } : invalid;
    case "gameResource":
      return seatKey(raw.key) && shortId(raw.resourceId) && Number.isInteger(raw.used) && (raw.used as number) >= 0 && (raw.used as number) <= 99
        ? { type: "gameResource", key: raw.key, resourceId: raw.resourceId, used: raw.used as number } : invalid;
    case "gameRest": return raw.kind === "short" || raw.kind === "long" ? { type: "gameRest", kind: raw.kind } : invalid;
    case "gameHitDie": return seatKey(raw.key) ? { type: "gameHitDie", key: raw.key } : invalid;
    case "gameXp":
      if (!Array.isArray(raw.keys) || !raw.keys.length || raw.keys.length > MAX_PLAYERS || !raw.keys.every(seatKey)) return invalid;
      return Number.isInteger(raw.amount) && Math.abs(raw.amount as number) <= 100_000 && raw.amount !== 0
        ? { type: "gameXp", keys: [...new Set(raw.keys as string[])], amount: raw.amount as number } : invalid;
    case "gameLevelUp": return isObject(raw.choices) ? { type: "gameLevelUp", choices: raw.choices } : invalid;
    case "gameInventory":
      return seatKey(raw.key) && Array.isArray(raw.inventory) && raw.inventory.length <= 60 && isObject(raw.coins)
        ? { type: "gameInventory", key: raw.key, inventory: raw.inventory, coins: raw.coins } : invalid;
    case "gameVaultSave": {
      const hero = raw.hero;
      if (!isObject(hero) || !shortId(hero.id) || !isObject(hero.choices) || typeof hero.updatedAt !== "number" || !Number.isFinite(hero.updatedAt)) return invalid;
      return { type: "gameVaultSave", hero: { id: hero.id, choices: hero.choices, updatedAt: hero.updatedAt } };
    }
    case "gameVaultRemove": return shortId(raw.id) ? { type: "gameVaultRemove", id: raw.id } : invalid;
    case "gameVision": return (VISION_RADII as readonly unknown[]).includes(raw.radius) ? { type: "gameVision", radius: raw.radius as number } : invalid;
    case "gameJournalAdd":
    case "gameJournalEdit": {
      const text = typeof raw.text === "string" ? raw.text.trim() : "";
      if (!text || text.length > MAX_JOURNAL_TEXT || !(JOURNAL_KINDS as readonly unknown[]).includes(raw.kind)) return invalid;
      const kind = raw.kind as JournalKind;
      if (raw.type === "gameJournalAdd") return { type: "gameJournalAdd", kind, text };
      return shortId(raw.id) ? { type: "gameJournalEdit", id: raw.id, kind, text } : invalid;
    }
    case "gameJournalRemove": return shortId(raw.id) ? { type: "gameJournalRemove", id: raw.id } : invalid;
    case "gameGiveLoot":
      return Number.isInteger(raw.index) && (raw.index as number) >= 0 && (raw.index as number) < 20 && Array.isArray(raw.keys) && raw.keys.length > 0 && raw.keys.length <= MAX_PLAYERS
        && raw.keys.every(key => typeof key === "string" && key.length <= 200)
        ? { type: "gameGiveLoot", index: raw.index as number, keys: [...new Set(raw.keys as string[])] } : invalid;
    case "gameSaveAttack": {
      const source = raw.source;
      if (!isObject(source) || !Array.isArray(raw.targets) || !raw.targets.length || raw.targets.length > 20 || !raw.targets.every(shortId)) return invalid;
      const targets = [...new Set(raw.targets as string[])];
      if (source.type === "attack" && index16(source.index)) return { type: "gameSaveAttack", source: { type: "attack", index: source.index }, targets };
      if (source.type === "monsterAttack" && shortId(source.tokenId) && index16(source.index)) {
        return { type: "gameSaveAttack", source: { type: "monsterAttack", tokenId: source.tokenId, index: source.index }, targets };
      }
      if (source.type === "hazard") {
        const name = typeof source.name === "string" ? source.name.trim() : "";
        const damage = typeof source.damage === "string" ? source.damage.trim() : "";
        if (!name || name.length > 60 || damage.length > 40 || (damage && !parseDiceExpression(damage))) return invalid;
        if (!(ABILITIES as readonly unknown[]).includes(source.ability) || !Number.isInteger(source.dc) || (source.dc as number) < 1 || (source.dc as number) > 30) return invalid;
        if (source.condition !== undefined && !isCondition(source.condition)) return invalid;
        return {
          type: "gameSaveAttack", targets,
          source: { type: "hazard", name, damage, ability: source.ability as Ability, dc: source.dc as number, half: source.half === true, ...(source.condition ? { condition: source.condition as ConditionId } : {}) },
        };
      }
      return invalid;
    }
    case "gameApplyTo":
      if (!shortId(raw.rollId) || !Array.isArray(raw.targets) || !raw.targets.length || raw.targets.length > 20 || !raw.targets.every(shortId)) return invalid;
      return raw.mode === "damage" || raw.mode === "half" || raw.mode === "heal"
        ? { type: "gameApplyTo", rollId: raw.rollId, targets: [...new Set(raw.targets as string[])], mode: raw.mode } : invalid;
    case "gameMonsterCreate": {
      const monster = raw.monster;
      if (!isObject(monster)) return invalid;
      const name = typeof monster.name === "string" ? monster.name.trim() : "";
      const int = (value: unknown, min: number, max: number) => Number.isInteger(value) && (value as number) >= min && (value as number) <= max;
      if (!name || name.length > 40 || !int(monster.maxHp, 1, 999) || !int(monster.ac, 1, 30) || !int(monster.dex, 1, 30) || !int(monster.speed, 0, 120)) return invalid;
      const result: QuickMonster = { name, maxHp: monster.maxHp as number, ac: monster.ac as number, dex: monster.dex as number, speed: monster.speed as number };
      if (monster.attack !== undefined) {
        const attack = monster.attack;
        if (!isObject(attack)) return invalid;
        const attackName = typeof attack.name === "string" ? attack.name.trim() : "";
        const damage = typeof attack.damage === "string" ? attack.damage.trim() : "";
        if (!attackName || attackName.length > 40 || !int(attack.bonus, -5, 20) || !parseDiceExpression(damage)) return invalid;
        result.attack = { name: attackName, bonus: attack.bonus as number, damage };
      }
      return { type: "gameMonsterCreate", monster: result };
    }
    default: return invalid;
  }
}

/** The browser trusts its own gateway; this only checks the frame's shape. */
export function parseGameServerMessage(raw: unknown): GameServerMessage | null {
  if (!isObject(raw)) return null;
  if (raw.type === "gameState" && (raw.table === null || isObject(raw.table))) return raw as unknown as GameServerMessage;
  if (raw.type === "gameRolled" && isObject(raw.roll)) return raw as unknown as GameServerMessage;
  if (raw.type === "gameError" && typeof raw.code === "string") return { type: "gameError", code: raw.code };
  if (raw.type === "gameAdventureData" && isObject(raw.adventure) && typeof raw.adventure.id === "string"
    && Array.isArray(raw.adventure.scenes) && Array.isArray(raw.adventure.heroes) && Array.isArray(raw.adventure.monsters)) {
    return raw as unknown as GameServerMessage;
  }
  if (raw.type === "gameVault" && Array.isArray(raw.heroes)) return raw as unknown as GameServerMessage;
  if (raw.type === "gamePinged" && typeof raw.by === "string" && typeof raw.x === "number" && typeof raw.y === "number") {
    return { type: "gamePinged", by: raw.by, x: raw.x, y: raw.y, gm: raw.gm === true };
  }
  return null;
}
