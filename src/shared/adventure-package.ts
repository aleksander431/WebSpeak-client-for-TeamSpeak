import {
  ABILITIES,
  MAX_NARRATION_LENGTH,
  SKILLS,
  parseDiceExpression,
  type Ability,
  type AdventureScene,
  type AdventureSummary,
  type AttackSave,
  type EncounterToken,
  type HeroAttack,
  type HeroResource,
  type HeroSheet,
  type MonsterSheet,
  type MusicTrack,
  type SceneLoot,
  type SceneMap,
  type Skill,
} from "./tabletop.js";

/**
 * Adventure packages: a ZIP with `adventure.json` and its pictures and music.
 * This module validates the JSON (browser-safe, no Node imports); the gateway
 * reads the archive and serves the files. See docs/DND_ADVENTURES.md.
 */

export const ADVENTURE_PACKAGE_SCHEMA = 1;
export const ADVENTURE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$/;
export const ADVENTURE_IMAGE_EXTENSIONS = ["webp", "png", "jpg", "jpeg"] as const;
export const ADVENTURE_AUDIO_EXTENSIONS = ["ogg", "opus", "mp3", "m4a", "webm"] as const;
const MAX_SCENES = 40;
const MAX_HEROES = 12;
const MAX_MONSTERS = 60;
const MAX_TRACKS = 30;
const MAX_ATTACKS = 8;
const MAX_LIST = 30;
const MAX_ENCOUNTER = 40;

/** What the lobby shows before an adventure is chosen. */
export interface AdventureListItem {
  id: string;
  title: string;
  summary: string;
  level: number;
  length: string;
  /** Uploaded by the administrator (not shipped with WebSpeak). */
  custom: boolean;
}

export class AdventurePackageError extends Error {
  constructor(message: string, readonly path = "") {
    super(path ? `${path}: ${message}` : message);
    this.name = "AdventurePackageError";
  }
}

export function adventureListItem(adventure: AdventureSummary, custom: boolean): AdventureListItem {
  return { id: adventure.id, title: adventure.title, summary: adventure.summary, level: adventure.level, length: adventure.length, custom };
}

/**
 * What players may know: no game master notes, prepared encounters or texts
 * that have not been read yet, and monsters only by name and picture.
 */
export function adventureForPlayers(adventure: AdventureSummary): AdventureSummary {
  return {
    ...adventure,
    scenes: adventure.scenes.map(({ notes: _notes, encounter: _encounter, intro: _intro, reveal: _reveal, loot: _loot, ...scene }) => scene),
    monsters: adventure.monsters.map(monster => ({
      id: monster.id, name: monster.name, cr: "", maxHp: 0, ac: 0, speed: 0, dex: 10, attacks: [], traits: [],
      ...(monster.portrait ? { portrait: monster.portrait } : {}),
    })),
  };
}

/**
 * Validates an `adventure.json` document. `asset` checks that a file named by
 * the document exists in the package and returns the URL it will be served at
 * (or null when it is missing). `library` supplies built-in heroes and monsters
 * a package may reuse by id.
 */
export function parseAdventurePackage(
  raw: unknown,
  asset: (path: string, kind: "image" | "audio") => string | null,
  library: { heroes: readonly HeroSheet[]; monsters: readonly MonsterSheet[] } = { heroes: [], monsters: [] },
): AdventureSummary {
  const doc = object(raw, "adventure.json");
  if (doc.schema !== ADVENTURE_PACKAGE_SCHEMA) throw new AdventurePackageError(`"schema" must be ${ADVENTURE_PACKAGE_SCHEMA}`, "adventure.json");
  const id = text(doc.id, "id", 48);
  if (!ADVENTURE_ID_PATTERN.test(id)) throw new AdventurePackageError("use 3–48 lower-case letters, digits and dashes", "id");
  const file = (value: unknown, path: string, kind: "image" | "audio"): string => {
    const name = text(value, path, 200);
    const extensions: readonly string[] = kind === "image" ? ADVENTURE_IMAGE_EXTENSIONS : ADVENTURE_AUDIO_EXTENSIONS;
    const extension = name.split(".").pop()?.toLowerCase() ?? "";
    if (!extensions.includes(extension)) throw new AdventurePackageError(`expected ${extensions.join(", ")}`, path);
    const url = asset(name, kind);
    if (!url) throw new AdventurePackageError(`file "${name}" is not in the package`, path);
    return url;
  };
  const optionalFile = (value: unknown, path: string, kind: "image" | "audio") => value === undefined ? undefined : file(value, path, kind);

  const monsters: MonsterSheet[] = [];
  for (const [index, ref] of list(doc.includeMonsters ?? [], "includeMonsters", MAX_MONSTERS).entries()) {
    const found = library.monsters.find(monster => monster.id === ref);
    if (!found) throw new AdventurePackageError(`unknown built-in monster "${String(ref)}"`, `includeMonsters[${index}]`);
    monsters.push(found);
  }
  for (const [index, value] of list(doc.monsters ?? [], "monsters", MAX_MONSTERS).entries()) {
    monsters.push(parseMonster(value, `monsters[${index}]`, path => optionalFile(path, `monsters[${index}].portrait`, "image")));
  }
  unique(monsters.map(monster => monster.id), "monsters");

  const heroes: HeroSheet[] = [];
  for (const [index, ref] of list(doc.includeHeroes ?? [], "includeHeroes", MAX_HEROES).entries()) {
    const found = library.heroes.find(hero => hero.id === ref);
    if (!found) throw new AdventurePackageError(`unknown built-in hero "${String(ref)}"`, `includeHeroes[${index}]`);
    heroes.push(found);
  }
  for (const [index, value] of list(doc.heroes ?? [], "heroes", MAX_HEROES).entries()) {
    heroes.push(parseHero(value, `heroes[${index}]`, path => optionalFile(path, `heroes[${index}].portrait`, "image")));
  }
  if (!heroes.length) throw new AdventurePackageError("an adventure needs at least one hero", "heroes");
  unique(heroes.map(hero => hero.id), "heroes");

  const music: MusicTrack[] = list(doc.music ?? [], "music", MAX_TRACKS).map((value, index) => {
    const track = object(value, `music[${index}]`);
    return { id: slug(track.id, `music[${index}].id`), title: text(track.title, `music[${index}].title`, 80), file: file(track.file, `music[${index}].file`, "audio") };
  });
  unique(music.map(track => track.id), "music");
  const trackId = (value: unknown, path: string) => {
    if (value === undefined) return undefined;
    const idValue = slug(value, path);
    if (!music.some(track => track.id === idValue)) throw new AdventurePackageError(`no track "${idValue}" in "music"`, path);
    return idValue;
  };

  const scenes = list(doc.scenes, "scenes", MAX_SCENES).map((value, index) => parseScene(value, `scenes[${index}]`, {
    file, trackId, monsters,
  }));
  if (!scenes.length) throw new AdventurePackageError("an adventure needs at least one scene", "scenes");
  unique(scenes.map(scene => scene.id), "scenes");

  return {
    id,
    title: text(doc.title, "title", 80),
    summary: text(doc.summary, "summary", 400),
    level: integer(doc.level ?? 1, "level", 1, 20),
    length: text(doc.length ?? "", "length", 60, true),
    scenes,
    heroes,
    monsters,
    ...(music.length ? { music } : {}),
    ...(doc.combatMusic !== undefined ? { combatMusic: trackId(doc.combatMusic, "combatMusic") } : {}),
  };
}

function parseScene(value: unknown, path: string, context: {
  file: (value: unknown, path: string, kind: "image" | "audio") => string;
  trackId: (value: unknown, path: string) => string | undefined;
  monsters: MonsterSheet[];
}): AdventureScene {
  const raw = object(value, path);
  const scene: AdventureScene = { id: slug(raw.id, `${path}.id`), title: text(raw.title, `${path}.title`, 80) };
  if (raw.art !== undefined) scene.art = context.file(raw.art, `${path}.art`, "image");
  if (raw.intro !== undefined) scene.intro = text(raw.intro, `${path}.intro`, MAX_NARRATION_LENGTH);
  if (raw.notes !== undefined) scene.notes = text(raw.notes, `${path}.notes`, 6000);
  if (raw.music !== undefined) scene.music = context.trackId(raw.music, `${path}.music`);
  if (raw.map !== undefined) {
    const map = object(raw.map, `${path}.map`);
    const cols = integer(map.cols, `${path}.map.cols`, 4, 64);
    const rows = integer(map.rows, `${path}.map.rows`, 4, 64);
    const cell = (item: unknown, at: string): [number, number] => {
      const pair = list(item, at, 2);
      if (pair.length !== 2) throw new AdventurePackageError("expected [x, y]", at);
      return [integer(pair[0], `${at}[0]`, 0, cols - 1), integer(pair[1], `${at}[1]`, 0, rows - 1)];
    };
    const spawn = list(map.spawn, `${path}.map.spawn`, 12).map((item, index) => cell(item, `${path}.map.spawn[${index}]`));
    if (!spawn.length) throw new AdventurePackageError("at least one spawn cell", `${path}.map.spawn`);
    const sceneMap: SceneMap = { image: context.file(map.image, `${path}.map.image`, "image"), cols, rows, spawn };
    scene.map = sceneMap;
    if (raw.encounter !== undefined) {
      scene.encounter = list(raw.encounter, `${path}.encounter`, MAX_ENCOUNTER).map((item, index): EncounterToken => {
        const at = `${path}.encounter[${index}]`;
        const entry = object(item, at);
        const monsterId = slug(entry.monsterId, `${at}.monsterId`);
        if (!context.monsters.some(monster => monster.id === monsterId)) throw new AdventurePackageError(`no monster "${monsterId}"`, `${at}.monsterId`);
        const [x, y] = cell([entry.x, entry.y], at);
        return { monsterId, x, y, ...(entry.hidden === true ? { hidden: true } : {}) };
      });
    }
    if (raw.reveal !== undefined) {
      scene.reveal = list(raw.reveal, `${path}.reveal`, MAX_ENCOUNTER).map((item, index) => {
        const at = `${path}.reveal[${index}]`;
        const rect = list(item, at, 4);
        if (rect.length !== 4) throw new AdventurePackageError("expected [x, y, width, height]", at);
        return [
          integer(rect[0], `${at}[0]`, 0, cols - 1), integer(rect[1], `${at}[1]`, 0, rows - 1),
          integer(rect[2], `${at}[2]`, 1, cols), integer(rect[3], `${at}[3]`, 1, rows),
        ] as [number, number, number, number];
      });
    }
  } else if (raw.encounter !== undefined || raw.reveal !== undefined) {
    throw new AdventurePackageError("encounters and lit areas need a map", path);
  }
  if (raw.loot !== undefined) {
    scene.loot = list(raw.loot, `${path}.loot`, 20).map((item, index) => {
      const at = `${path}.loot[${index}]`;
      const entry = object(item, at);
      const loot: SceneLoot = { name: text(entry.name, `${at}.name`, 80), qty: integer(entry.qty ?? 1, `${at}.qty`, 1, 999) };
      if (entry.text !== undefined) {
        const note = text(entry.text, `${at}.text`, 300, true);
        if (note) loot.text = note;
      }
      if (entry.icon !== undefined) loot.icon = context.file(entry.icon, `${at}.icon`, "image");
      return loot;
    });
  }
  return scene;
}

function parseAttacks(value: unknown, path: string): HeroAttack[] {
  return list(value ?? [], path, MAX_ATTACKS).map((item, index) => {
    const at = `${path}[${index}]`;
    const raw = object(item, at);
    const damage = text(raw.damage, `${at}.damage`, 40);
    if (!parseDiceExpression(damage)) throw new AdventurePackageError("not a dice expression like 1d8+3", `${at}.damage`);
    return {
      name: text(raw.name, `${at}.name`, 60),
      bonus: raw.bonus === null || raw.bonus === undefined ? null : integer(raw.bonus, `${at}.bonus`, -10, 30),
      damage,
      note: text(raw.note ?? "", `${at}.note`, 300, true),
      ...(raw.save !== undefined ? { save: parseSave(raw.save, `${at}.save`) } : {}),
    };
  });
}

function abilityId(item: unknown, at: string): Ability {
  if (typeof item !== "string" || !(ABILITIES as readonly string[]).includes(item)) throw new AdventurePackageError(`unknown ability (${ABILITIES.join(", ")})`, at);
  return item as Ability;
}

function parseSave(value: unknown, path: string): AttackSave {
  const raw = object(value, path);
  return { ability: abilityId(raw.ability, `${path}.ability`), dc: integer(raw.dc, `${path}.dc`, 1, 30), half: raw.half === true };
}

function parseResources(value: unknown, path: string): HeroResource[] {
  const resources = list(value, path, 12).map((item, index) => {
    const at = `${path}[${index}]`;
    const raw = object(item, at);
    if (raw.recharge !== "short" && raw.recharge !== "long") throw new AdventurePackageError("short or long", `${at}.recharge`);
    return { id: slug(raw.id, `${at}.id`), name: text(raw.name, `${at}.name`, 60), max: integer(raw.max, `${at}.max`, 1, 99), recharge: raw.recharge as "short" | "long" };
  });
  unique(resources.map(item => item.id), path);
  return resources;
}

function parseMonster(value: unknown, path: string, portrait: (value: unknown) => string | undefined): MonsterSheet {
  const raw = object(value, path);
  const monster: MonsterSheet = {
    id: slug(raw.id, `${path}.id`),
    name: text(raw.name, `${path}.name`, 60),
    cr: text(raw.cr ?? "0", `${path}.cr`, 8),
    maxHp: integer(raw.maxHp, `${path}.maxHp`, 1, 999),
    ac: integer(raw.ac, `${path}.ac`, 1, 30),
    speed: integer(raw.speed ?? 30, `${path}.speed`, 0, 200),
    dex: integer(raw.dex ?? 10, `${path}.dex`, 1, 30),
    attacks: parseAttacks(raw.attacks, `${path}.attacks`),
    traits: list(raw.traits ?? [], `${path}.traits`, MAX_LIST).map((item, index) => text(item, `${path}.traits[${index}]`, 300)),
  };
  if (raw.saves !== undefined) {
    const saves = object(raw.saves, `${path}.saves`);
    monster.saves = {};
    for (const [key, bonus] of Object.entries(saves)) monster.saves[abilityId(key, `${path}.saves`)] = integer(bonus, `${path}.saves.${key}`, -10, 20);
  }
  const picture = portrait(raw.portrait);
  if (picture) monster.portrait = picture;
  return monster;
}

function parseHero(value: unknown, path: string, portrait: (value: unknown) => string | undefined): HeroSheet {
  const raw = object(value, path);
  const scores = object(raw.abilities, `${path}.abilities`);
  const abilities = {} as Record<Ability, number>;
  for (const ability of ABILITIES) abilities[ability] = integer(scores[ability], `${path}.abilities.${ability}`, 1, 30);
  const skill = (item: unknown, at: string): Skill => {
    if (typeof item !== "string" || !(item in SKILLS)) throw new AdventurePackageError(`unknown skill (${Object.keys(SKILLS).join(", ")})`, at);
    return item as Skill;
  };
  const ability = (item: unknown, at: string): Ability => {
    if (typeof item !== "string" || !(ABILITIES as readonly string[]).includes(item)) throw new AdventurePackageError(`unknown ability (${ABILITIES.join(", ")})`, at);
    return item as Ability;
  };
  const strings = (item: unknown, at: string) => list(item ?? [], at, MAX_LIST).map((entry, index) => text(entry, `${at}[${index}]`, 300));
  const hero: HeroSheet = {
    id: slug(raw.id, `${path}.id`),
    name: text(raw.name, `${path}.name`, 60),
    race: text(raw.race, `${path}.race`, 60),
    cls: text(raw.cls, `${path}.cls`, 60),
    level: integer(raw.level ?? 1, `${path}.level`, 1, 20),
    maxHp: integer(raw.maxHp, `${path}.maxHp`, 1, 999),
    ac: integer(raw.ac, `${path}.ac`, 1, 30),
    speed: integer(raw.speed ?? 30, `${path}.speed`, 0, 200),
    abilities,
    saves: list(raw.saves ?? [], `${path}.saves`, 6).map((item, index) => ability(item, `${path}.saves[${index}]`)),
    skills: list(raw.skills ?? [], `${path}.skills`, 18).map((item, index) => skill(item, `${path}.skills[${index}]`)),
    expertise: list(raw.expertise ?? [], `${path}.expertise`, 18).map((item, index) => skill(item, `${path}.expertise[${index}]`)),
    attacks: parseAttacks(raw.attacks, `${path}.attacks`),
    features: strings(raw.features, `${path}.features`),
    equipment: strings(raw.equipment, `${path}.equipment`),
    story: text(raw.story ?? "", `${path}.story`, 1000, true),
  };
  if (raw.spells !== undefined) hero.spells = strings(raw.spells, `${path}.spells`);
  if (raw.hitDie !== undefined) {
    const die = integer(raw.hitDie, `${path}.hitDie`, 6, 12);
    if (![6, 8, 10, 12].includes(die)) throw new AdventurePackageError("6, 8, 10 or 12", `${path}.hitDie`);
    hero.hitDie = die;
  }
  if (raw.resources !== undefined) hero.resources = parseResources(raw.resources, `${path}.resources`);
  const picture = portrait(raw.portrait);
  if (picture) hero.portrait = picture;
  return hero;
}

// ---- Primitive checks ----------------------------------------------------------

function object(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new AdventurePackageError("expected an object", path);
  return value as Record<string, unknown>;
}

function list(value: unknown, path: string, max: number): unknown[] {
  if (!Array.isArray(value)) throw new AdventurePackageError("expected a list", path);
  if (value.length > max) throw new AdventurePackageError(`at most ${max} entries`, path);
  return value;
}

function text(value: unknown, path: string, max: number, allowEmpty = false): string {
  if (typeof value !== "string") throw new AdventurePackageError("expected text", path);
  const trimmed = value.trim();
  if (!allowEmpty && !trimmed) throw new AdventurePackageError("must not be empty", path);
  if (trimmed.length > max) throw new AdventurePackageError(`at most ${max} characters`, path);
  return trimmed;
}

function slug(value: unknown, path: string): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(value)) throw new AdventurePackageError("use letters, digits, dashes and underscores", path);
  return value;
}

function integer(value: unknown, path: string, min: number, max: number): number {
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) throw new AdventurePackageError(`expected a whole number from ${min} to ${max}`, path);
  return value as number;
}

function unique(ids: string[], path: string): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) throw new AdventurePackageError(`duplicate id "${id}"`, path);
    seen.add(id);
  }
}
