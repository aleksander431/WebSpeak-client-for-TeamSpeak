import {
  CATALOG_ITEMS,
  CATALOG_MAPS,
  CATALOG_MONSTERS,
  libraryUrl,
  type LibraryKind,
} from "./adventure-catalog.js";
import { ADVENTURE_ID_PATTERN } from "./adventure-package.js";
import { buildHero, heroPortraitUrl, validateHeroChoices, type HeroChoices } from "./hero-builder.js";
import type { Ability, HeroAttack, HeroSheet, MonsterSheet } from "./tabletop.js";
import { BUILT_IN_ADVENTURES } from "./tabletop-adventures.js";

/*
 * Adventure editor drafts (browser-safe). The editor page edits an
 * `AdventureDraft`; the gateway stores it as JSON and, on publishing, turns it
 * into an ordinary adventure package with `draftToPackage`: `adventure.json`
 * plus the pictures and music it names, which then goes through the same
 * validation as an uploaded ZIP.
 */

export const DRAFT_SCHEMA = 1;
export const MAX_DRAFT_BYTES = 1_000_000;
export const MAX_DRAFT_SCENES = 40;
export const MAX_DRAFT_HEROES = 12;
export const MAX_DRAFT_MONSTERS = 40;
export const MAX_DRAFT_TRACKS = 20;
export const MAX_SCENE_LOOT = 20;
/** Uploaded files are named `<32 hex>.<ext>` by the gateway. */
export const UPLOAD_NAME = /^[0-9a-f]{32}\.(webp|png|jpg|jpeg|ogg|opus|mp3|m4a|webm)$/;

/** A picture from the library or one the author uploaded. */
export type DraftPicture = { library: LibraryKind; id: string } | { upload: string };

export type DraftHero =
  | { kind: "builtin"; id: string }
  | { kind: "built"; id: string; choices: HeroChoices };

export type DraftMonster =
  | { kind: "catalog"; id: string }
  | { kind: "custom"; id: string; sheet: Omit<MonsterSheet, "id" | "portrait">; picture?: DraftPicture };

export interface DraftLoot {
  /** A catalog item, or a custom one (then name/text/picture are used). */
  catalogId?: string;
  name?: string;
  text?: string;
  picture?: DraftPicture;
  qty: number;
}

export interface DraftScene {
  id: string;
  title: string;
  /** Story picture (scenes without a map). */
  art?: DraftPicture;
  map?: { picture: DraftPicture; cols: number; rows: number; spawn: Array<[number, number]> };
  intro?: string;
  notes?: string;
  music?: string;
  encounter?: Array<{ monsterId: string; x: number; y: number; hidden?: boolean }>;
  reveal?: Array<[number, number, number, number]>;
  loot?: DraftLoot[];
}

export type DraftTrack = { id: string; title: string } & ({ builtin: string } | { upload: string });

export interface AdventureDraft {
  schema: typeof DRAFT_SCHEMA;
  title: string;
  summary: string;
  level: number;
  length: string;
  heroes: DraftHero[];
  monsters: DraftMonster[];
  scenes: DraftScene[];
  music: DraftTrack[];
  combatMusic?: string;
}

/** Built-in music an author may reuse: the shipped adventure's tracks. */
export const BUILTIN_TRACKS: Array<{ id: string; title: [string, string]; file: string }> = [
  { id: "tavern", title: ["Таверна", "Tavern"], file: "/dnd/solgard-bell/music-tavern.ogg" },
  { id: "road", title: ["Дорога", "Road"], file: "/dnd/solgard-bell/music-road.ogg" },
  { id: "catacombs", title: ["Подземелье", "Dungeon"], file: "/dnd/solgard-bell/music-catacombs.ogg" },
  { id: "ritual", title: ["Ритуал", "Ritual"], file: "/dnd/solgard-bell/music-ritual.ogg" },
  { id: "battle", title: ["Бой", "Battle"], file: "/dnd/solgard-bell/music-battle.ogg" },
  { id: "finale", title: ["Финал", "Finale"], file: "/dnd/solgard-bell/music-finale.ogg" },
];

/** Built-in pictures beside the library: the shipped adventures' art and maps. */
export const BUILTIN_PICTURES: Array<{ id: string; kind: "scene" | "map"; name: [string, string]; file: string; cols?: number; rows?: number }> = [
  { id: "solgard-tavern", kind: "scene", name: ["Таверна «Ржавый якорь»", "The Rusty Anchor"], file: "/dnd/solgard-bell/art-tavern.webp" },
  { id: "solgard-road", kind: "scene", name: ["Дорога к холму", "Road to the hill"], file: "/dnd/solgard-bell/art-road.webp" },
  { id: "solgard-finale", kind: "scene", name: ["Колокольня", "The bell tower"], file: "/dnd/solgard-bell/art-finale.webp" },
  { id: "cellar", kind: "map", name: ["Подвал таверны", "Tavern cellar"], file: "/dnd/first-steps/map-cellar.webp", cols: 16, rows: 12 },
];

export function builtinHeroes(): HeroSheet[] {
  const seen = new Set<string>();
  return BUILT_IN_ADVENTURES.flatMap(adventure => adventure.heroes).filter(hero => !seen.has(hero.id) && seen.add(hero.id));
}

export function builtinMonsters(): MonsterSheet[] {
  const seen = new Set<string>();
  return BUILT_IN_ADVENTURES.flatMap(adventure => adventure.monsters).filter(monster => !seen.has(monster.id) && seen.add(monster.id));
}

/** Every monster an author can pick: the shipped adventures' and the catalog's. */
export function catalogMonster(id: string): MonsterSheet | undefined {
  const builtIn = builtinMonsters().find(monster => monster.id === id);
  if (builtIn) return builtIn;
  const found = CATALOG_MONSTERS.find(monster => monster.id === id);
  return found ? { ...found, portrait: libraryUrl("monster", found.id) } : undefined;
}

/** The URL a draft picture shows at in the editor (uploads are served at `/api/editor-files/`). */
export function pictureUrl(picture: DraftPicture | undefined): string | undefined {
  if (!picture) return undefined;
  if ("upload" in picture) return `/api/editor-files/${picture.upload}`;
  if (picture.library === "map" || picture.library === "scene") {
    const builtin = BUILTIN_PICTURES.find(item => item.id === picture.id);
    if (builtin) return builtin.file;
  }
  return libraryUrl(picture.library, picture.id);
}

export function emptyDraft(title: string): AdventureDraft {
  return { schema: DRAFT_SCHEMA, title, summary: "", level: 1, length: "", heroes: [], monsters: [], scenes: [], music: [] };
}

export class DraftError extends Error {
  constructor(message: string, readonly path = "") {
    super(path ? `${path}: ${message}` : message);
    this.name = "DraftError";
  }
}

// ---- Parsing (what the gateway stores) ----------------------------------------

/** Checks a stored draft's shape; contents are checked fully only when publishing. */
export function parseDraft(raw: unknown): AdventureDraft {
  const doc = obj(raw, "draft");
  if (doc.schema !== DRAFT_SCHEMA) throw new DraftError(`schema must be ${DRAFT_SCHEMA}`, "schema");
  const draft: AdventureDraft = {
    schema: DRAFT_SCHEMA,
    title: str(doc.title, "title", 80, true),
    summary: str(doc.summary ?? "", "summary", 400, true),
    level: int(doc.level ?? 1, "level", 1, 20),
    length: str(doc.length ?? "", "length", 60, true),
    heroes: arr(doc.heroes ?? [], "heroes", MAX_DRAFT_HEROES).map((item, index) => parseHero(item, `heroes[${index}]`)),
    monsters: arr(doc.monsters ?? [], "monsters", MAX_DRAFT_MONSTERS).map((item, index) => parseMonster(item, `monsters[${index}]`)),
    scenes: arr(doc.scenes ?? [], "scenes", MAX_DRAFT_SCENES).map((item, index) => parseScene(item, `scenes[${index}]`)),
    music: arr(doc.music ?? [], "music", MAX_DRAFT_TRACKS).map((item, index) => parseTrack(item, `music[${index}]`)),
  };
  if (doc.combatMusic !== undefined && doc.combatMusic !== "") draft.combatMusic = slug(doc.combatMusic, "combatMusic");
  return draft;
}

function parsePicture(raw: unknown, path: string): DraftPicture {
  const value = obj(raw, path);
  if (typeof value.upload === "string") {
    if (!UPLOAD_NAME.test(value.upload)) throw new DraftError("unknown upload", path);
    return { upload: value.upload };
  }
  const kinds: LibraryKind[] = ["monster", "item", "map", "scene", "portrait"];
  if (!kinds.includes(value.library as LibraryKind)) throw new DraftError("unknown picture", path);
  return { library: value.library as LibraryKind, id: slug(value.id, `${path}.id`) };
}

function parseHero(raw: unknown, path: string): DraftHero {
  const value = obj(raw, path);
  if (value.kind === "builtin") return { kind: "builtin", id: slug(value.id, `${path}.id`) };
  if (value.kind === "built") {
    const choices = validateHeroChoices(value.choices);
    return { kind: "built", id: slug(value.id, `${path}.id`), choices };
  }
  throw new DraftError("builtin or built", `${path}.kind`);
}

function parseAttack(raw: unknown, path: string): HeroAttack {
  const value = obj(raw, path);
  const attack: HeroAttack = {
    name: str(value.name, `${path}.name`, 60),
    bonus: value.bonus === null || value.bonus === undefined ? null : int(value.bonus, `${path}.bonus`, -10, 30),
    damage: str(value.damage, `${path}.damage`, 40),
    note: str(value.note ?? "", `${path}.note`, 300, true),
  };
  if (value.save !== undefined) {
    const save = obj(value.save, `${path}.save`);
    const abilities: Ability[] = ["str", "dex", "con", "int", "wis", "cha"];
    if (!abilities.includes(save.ability as Ability)) throw new DraftError("unknown ability", `${path}.save.ability`);
    attack.save = { ability: save.ability as Ability, dc: int(save.dc, `${path}.save.dc`, 1, 30), half: save.half === true };
  }
  return attack;
}

function parseMonster(raw: unknown, path: string): DraftMonster {
  const value = obj(raw, path);
  if (value.kind === "catalog") return { kind: "catalog", id: slug(value.id, `${path}.id`) };
  if (value.kind !== "custom") throw new DraftError("catalog or custom", `${path}.kind`);
  const sheet = obj(value.sheet, `${path}.sheet`);
  const monster: DraftMonster = {
    kind: "custom",
    id: slug(value.id, `${path}.id`),
    sheet: {
      name: str(sheet.name, `${path}.sheet.name`, 60),
      cr: str(sheet.cr ?? "0", `${path}.sheet.cr`, 8, true) || "0",
      maxHp: int(sheet.maxHp, `${path}.sheet.maxHp`, 1, 999),
      ac: int(sheet.ac, `${path}.sheet.ac`, 1, 30),
      speed: int(sheet.speed ?? 30, `${path}.sheet.speed`, 0, 200),
      dex: int(sheet.dex ?? 10, `${path}.sheet.dex`, 1, 30),
      attacks: arr(sheet.attacks ?? [], `${path}.sheet.attacks`, 8).map((item, index) => parseAttack(item, `${path}.sheet.attacks[${index}]`)),
      traits: arr(sheet.traits ?? [], `${path}.sheet.traits`, 30).map((item, index) => str(item, `${path}.sheet.traits[${index}]`, 300)),
    },
  };
  if (value.picture !== undefined) monster.picture = parsePicture(value.picture, `${path}.picture`);
  return monster;
}

function parseCell(raw: unknown, path: string): [number, number] {
  const pair = arr(raw, path, 2);
  if (pair.length !== 2) throw new DraftError("expected [x, y]", path);
  return [int(pair[0], `${path}[0]`, 0, 63), int(pair[1], `${path}[1]`, 0, 63)];
}

function parseScene(raw: unknown, path: string): DraftScene {
  const value = obj(raw, path);
  const scene: DraftScene = { id: slug(value.id, `${path}.id`), title: str(value.title, `${path}.title`, 80, true) };
  if (value.art !== undefined) scene.art = parsePicture(value.art, `${path}.art`);
  if (value.map !== undefined) {
    const map = obj(value.map, `${path}.map`);
    scene.map = {
      picture: parsePicture(map.picture, `${path}.map.picture`),
      cols: int(map.cols, `${path}.map.cols`, 4, 64),
      rows: int(map.rows, `${path}.map.rows`, 4, 64),
      spawn: arr(map.spawn ?? [], `${path}.map.spawn`, 12).map((item, index) => parseCell(item, `${path}.map.spawn[${index}]`)),
    };
  }
  if (value.intro !== undefined) scene.intro = str(value.intro, `${path}.intro`, 2000, true);
  if (value.notes !== undefined) scene.notes = str(value.notes, `${path}.notes`, 6000, true);
  if (value.music !== undefined && value.music !== "") scene.music = slug(value.music, `${path}.music`);
  if (value.encounter !== undefined) {
    scene.encounter = arr(value.encounter, `${path}.encounter`, 40).map((item, index) => {
      const at = `${path}.encounter[${index}]`;
      const entry = obj(item, at);
      const [x, y] = parseCell([entry.x, entry.y], at);
      return { monsterId: slug(entry.monsterId, `${at}.monsterId`), x, y, ...(entry.hidden === true ? { hidden: true } : {}) };
    });
  }
  if (value.reveal !== undefined) {
    scene.reveal = arr(value.reveal, `${path}.reveal`, 40).map((item, index) => {
      const rect = arr(item, `${path}.reveal[${index}]`, 4);
      if (rect.length !== 4) throw new DraftError("expected [x, y, width, height]", `${path}.reveal[${index}]`);
      return rect.map((n, i) => int(n, `${path}.reveal[${index}][${i}]`, i < 2 ? 0 : 1, 64)) as [number, number, number, number];
    });
  }
  if (value.loot !== undefined) {
    scene.loot = arr(value.loot, `${path}.loot`, MAX_SCENE_LOOT).map((item, index) => {
      const at = `${path}.loot[${index}]`;
      const entry = obj(item, at);
      const loot: DraftLoot = { qty: int(entry.qty ?? 1, `${at}.qty`, 1, 999) };
      if (entry.catalogId !== undefined) loot.catalogId = slug(entry.catalogId, `${at}.catalogId`);
      if (entry.name !== undefined) loot.name = str(entry.name, `${at}.name`, 80, true);
      if (entry.text !== undefined) loot.text = str(entry.text, `${at}.text`, 300, true);
      if (entry.picture !== undefined) loot.picture = parsePicture(entry.picture, `${at}.picture`);
      return loot;
    });
  }
  return scene;
}

function parseTrack(raw: unknown, path: string): DraftTrack {
  const value = obj(raw, path);
  const id = slug(value.id, `${path}.id`);
  const title = str(value.title, `${path}.title`, 80);
  if (typeof value.builtin === "string") {
    if (!BUILTIN_TRACKS.some(track => track.id === value.builtin)) throw new DraftError("unknown built-in track", `${path}.builtin`);
    return { id, title, builtin: value.builtin };
  }
  if (typeof value.upload === "string" && UPLOAD_NAME.test(value.upload)) return { id, title, upload: value.upload };
  throw new DraftError("a built-in track or an upload", path);
}

// ---- Publishing --------------------------------------------------------------------

/** Where a package file comes from: a file the site serves, or an upload. */
export type PackageSource = { static: string } | { upload: string };

export interface DraftPackage {
  manifest: Record<string, unknown>;
  /** Package path → source. */
  files: Map<string, PackageSource>;
}

/** The adventure id a draft publishes under. */
export function draftAdventureId(draftId: string): string {
  const id = `ed-${draftId.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 40)}`;
  if (!ADVENTURE_ID_PATTERN.test(id)) throw new DraftError("bad draft id", "id");
  return id;
}

/**
 * Turns a draft into an adventure package. Errors name the field and say what
 * is missing in plain words, for the editor to show next to it.
 */
export function draftToPackage(draft: AdventureDraft, adventureId: string): DraftPackage {
  const files = new Map<string, PackageSource>();
  const picture = (value: DraftPicture | undefined, folder: string, path: string): string | undefined => {
    if (!value) return undefined;
    let source: PackageSource;
    let name: string;
    if ("upload" in value) {
      source = { upload: value.upload };
      name = value.upload;
    } else {
      const url = pictureUrl(value);
      if (!url) throw new DraftError("unknown picture", path);
      source = { static: url };
      name = `${value.library}-${value.id}.webp`;
    }
    const file = `${folder}/${name}`;
    files.set(file, source);
    return file;
  };

  if (!draft.title.trim()) throw new DraftError("give the adventure a title", "title");
  if (!draft.scenes.length) throw new DraftError("add at least one scene", "scenes");
  if (!draft.heroes.length) throw new DraftError("add at least one hero", "heroes");

  const includeHeroes: string[] = [];
  const heroes: Array<Record<string, unknown>> = [];
  const known = builtinHeroes();
  draft.heroes.forEach((hero, index) => {
    if (hero.kind === "builtin") {
      if (!known.some(item => item.id === hero.id)) throw new DraftError("unknown hero", `heroes[${index}]`);
      includeHeroes.push(hero.id);
      return;
    }
    const sheet = buildHero(hero.choices, hero.id);
    const { portrait: _url, ...rest } = sheet;
    const portraitId = hero.choices.portrait;
    const file = portraitId && heroPortraitUrl(portraitId) ? picture({ library: "portrait", id: portraitId }, "portraits", `heroes[${index}]`) : undefined;
    heroes.push({ ...rest, ...(file ? { portrait: file } : {}) });
  });

  const includeMonsters: string[] = [];
  const monsters: Array<Record<string, unknown>> = [];
  const monsterIds = new Set<string>();
  const builtIn = builtinMonsters();
  draft.monsters.forEach((monster, index) => {
    if (monsterIds.has(monster.id)) throw new DraftError("this monster is listed twice", `monsters[${index}]`);
    monsterIds.add(monster.id);
    if (monster.kind === "catalog") {
      if (builtIn.some(item => item.id === monster.id)) { includeMonsters.push(monster.id); return; }
      const found = CATALOG_MONSTERS.find(item => item.id === monster.id);
      if (!found) throw new DraftError("unknown monster", `monsters[${index}]`);
      const file = picture({ library: "monster", id: found.id }, "monsters", `monsters[${index}]`);
      monsters.push({ ...found, ...(file ? { portrait: file } : {}) });
      return;
    }
    const file = picture(monster.picture, "monsters", `monsters[${index}].picture`);
    monsters.push({ id: monster.id, ...monster.sheet, ...(file ? { portrait: file } : {}) });
  });

  const music: Array<Record<string, unknown>> = draft.music.map(track => {
    if ("builtin" in track) {
      const found = BUILTIN_TRACKS.find(item => item.id === track.builtin)!;
      const file = `music/${found.id}.ogg`;
      files.set(file, { static: found.file });
      return { id: track.id, title: track.title, file };
    }
    const file = `music/${track.upload}`;
    files.set(file, { upload: track.upload });
    return { id: track.id, title: track.title, file };
  });
  const trackIds = new Set(draft.music.map(track => track.id));

  const scenes = draft.scenes.map((scene, index) => {
    const at = `scenes[${index}]`;
    if (!scene.title.trim()) throw new DraftError("give the scene a title", `${at}.title`);
    const out: Record<string, unknown> = { id: scene.id, title: scene.title.trim() };
    if (scene.map) {
      if (!scene.map.spawn.length) throw new DraftError("mark where the heroes start on the map", `${at}.map.spawn`);
      out.map = { image: picture(scene.map.picture, "maps", `${at}.map`), cols: scene.map.cols, rows: scene.map.rows, spawn: scene.map.spawn };
      if (scene.encounter?.length) {
        for (const [i, entry] of scene.encounter.entries()) {
          if (!monsterIds.has(entry.monsterId)) throw new DraftError("this monster is not in the adventure's list", `${at}.encounter[${i}]`);
        }
        out.encounter = scene.encounter;
      }
      if (scene.reveal?.length) out.reveal = scene.reveal;
    } else if (scene.art) {
      out.art = picture(scene.art, "art", `${at}.art`);
    }
    if (scene.intro?.trim()) out.intro = scene.intro.trim();
    if (scene.notes?.trim()) out.notes = scene.notes.trim();
    if (scene.music) {
      if (!trackIds.has(scene.music)) throw new DraftError("that track is not in the adventure's music", `${at}.music`);
      out.music = scene.music;
    }
    if (scene.loot?.length) {
      out.loot = scene.loot.map((item, i) => {
        const where = `${at}.loot[${i}]`;
        const catalog = item.catalogId ? CATALOG_ITEMS.find(entry => entry.id === item.catalogId) : undefined;
        if (item.catalogId && !catalog) throw new DraftError("unknown item", where);
        const name = (item.name?.trim() || catalog?.name[0] || "").trim();
        if (!name) throw new DraftError("give the item a name", where);
        const text = item.text?.trim() || catalog?.text[0] || "";
        const icon = picture(item.picture ?? (catalog ? { library: "item", id: catalog.id } : undefined), "items", where);
        return { name, qty: item.qty, ...(text ? { text } : {}), ...(icon ? { icon } : {}) };
      });
    }
    return out;
  });
  if (draft.combatMusic && !trackIds.has(draft.combatMusic)) throw new DraftError("that track is not in the adventure's music", "combatMusic");

  const manifest: Record<string, unknown> = {
    schema: 1,
    id: adventureId,
    title: draft.title.trim(),
    summary: draft.summary.trim() || draft.title.trim(),
    level: draft.level,
    length: draft.length.trim(),
    ...(includeHeroes.length ? { includeHeroes } : {}),
    ...(heroes.length ? { heroes } : {}),
    ...(includeMonsters.length ? { includeMonsters } : {}),
    ...(monsters.length ? { monsters } : {}),
    ...(music.length ? { music } : {}),
    ...(draft.combatMusic ? { combatMusic: draft.combatMusic } : {}),
    scenes,
  };
  return { manifest, files };
}

/** A starting map size for a library map, or a guess from an uploaded picture's size (64 px per cell). */
export function suggestedGrid(picture: DraftPicture, size?: { width: number; height: number }): { cols: number; rows: number } {
  if (!("upload" in picture)) {
    const map = CATALOG_MAPS.find(item => item.id === picture.id);
    if (map) return { cols: map.cols, rows: map.rows };
    const builtin = BUILTIN_PICTURES.find(item => item.id === picture.id);
    if (builtin?.cols && builtin.rows) return { cols: builtin.cols, rows: builtin.rows };
  }
  if (size && size.width > 0 && size.height > 0) {
    const clamp = (n: number) => Math.max(4, Math.min(64, Math.round(n)));
    return { cols: clamp(size.width / 64), rows: clamp(size.height / 64) };
  }
  return { cols: 24, rows: 16 };
}

// ---- Primitive checks ----------------------------------------------------------------

function obj(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new DraftError("expected an object", path);
  return value as Record<string, unknown>;
}

function arr(value: unknown, path: string, max: number): unknown[] {
  if (!Array.isArray(value)) throw new DraftError("expected a list", path);
  if (value.length > max) throw new DraftError(`at most ${max} entries`, path);
  return value;
}

function str(value: unknown, path: string, max: number, allowEmpty = false): string {
  if (typeof value !== "string") throw new DraftError("expected text", path);
  if (!allowEmpty && !value.trim()) throw new DraftError("must not be empty", path);
  if (value.length > max) throw new DraftError(`at most ${max} characters`, path);
  return value;
}

function slug(value: unknown, path: string): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(value)) throw new DraftError("use letters, digits, dashes and underscores", path);
  return value;
}

function int(value: unknown, path: string, min: number, max: number): number {
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) throw new DraftError(`a whole number from ${min} to ${max}`, path);
  return value as number;
}
