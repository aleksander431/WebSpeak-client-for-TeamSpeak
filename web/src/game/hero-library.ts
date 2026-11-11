import { ref } from "vue";
import { HeroChoiceError, validateHeroChoices, type HeroChoices } from "../../../src/shared/hero-builder.js";

/**
 * The player's own heroes, kept in this browser as builder choices (level,
 * experience and belongings included; the gateway rebuilds the sheet from them
 * whenever the hero is picked). With a TeamSpeak unique id the gateway keeps a
 * copy too (`gameVault`), so the heroes follow the identity to other devices;
 * the newer `updatedAt` wins.
 */

const STORAGE_KEY = "webspeak:dnd-heroes";
const MAX_HEROES = 30;
export const EXPORT_FORMAT = "webspeak-dnd-heroes";

export interface SavedHero {
  id: string;
  choices: HeroChoices;
  updatedAt: number;
}

function parseList(raw: unknown): SavedHero[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap(item => {
    if (typeof item !== "object" || !item || typeof (item as SavedHero).id !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test((item as SavedHero).id)) return [];
    try {
      return [{ id: (item as SavedHero).id, choices: validateHeroChoices((item as SavedHero).choices), updatedAt: Number((item as SavedHero).updatedAt) || 0 }];
    } catch (error: unknown) {
      if (error instanceof HeroChoiceError) return [];
      throw error;
    }
  }).slice(0, MAX_HEROES);
}

function read(): SavedHero[] {
  try { return parseList(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]")); }
  catch { return []; }
}

function write(list: SavedHero[]): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(list)); }
  catch { /* storage full or blocked: the list still lives for this visit */ }
}

const heroes = ref<SavedHero[]>(read());

function put(entry: SavedHero): void {
  heroes.value = [entry, ...heroes.value.filter(item => item.id !== entry.id)].slice(0, MAX_HEROES);
  write(heroes.value);
}

export function newHeroId(): string {
  return `h${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function useHeroLibrary() {
  return {
    heroes,
    save(choices: HeroChoices, id?: string): SavedHero {
      const entry: SavedHero = { id: id ?? newHeroId(), choices, updatedAt: Date.now() };
      put(entry);
      return entry;
    },
    remove(id: string): void {
      heroes.value = heroes.value.filter(item => item.id !== id);
      write(heroes.value);
    },
    /**
     * Takes the gateway's copy: newer remote heroes replace local ones; returns
     * the local heroes the gateway lacks or has older, to send back.
     */
    merge(remote: readonly { id: string; choices: unknown; updatedAt: number }[]): SavedHero[] {
      const incoming = parseList(remote);
      const byId = new Map(heroes.value.map(item => [item.id, item]));
      for (const item of incoming) {
        const local = byId.get(item.id);
        if (!local || local.updatedAt < item.updatedAt) byId.set(item.id, item);
      }
      heroes.value = [...byId.values()].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_HEROES);
      write(heroes.value);
      return heroes.value.filter(item => {
        const there = incoming.find(candidate => candidate.id === item.id);
        return !there || there.updatedAt < item.updatedAt;
      });
    },
    exportText(list: readonly SavedHero[] = heroes.value): string {
      return JSON.stringify({ format: EXPORT_FORMAT, version: 1, heroes: list }, null, 2);
    },
    /** Adds the heroes of an exported file: those taken, or null for a file that is not one. */
    importText(text: string): SavedHero[] | null {
      let data: unknown;
      try { data = JSON.parse(text); } catch { return null; }
      if (typeof data !== "object" || !data || (data as { format?: unknown }).format !== EXPORT_FORMAT) return null;
      const list = parseList((data as { heroes?: unknown }).heroes);
      const taken: SavedHero[] = [];
      for (const item of list) {
        const existing = heroes.value.find(candidate => candidate.id === item.id);
        if (existing && existing.updatedAt >= item.updatedAt) continue;
        const entry = { ...item, updatedAt: Math.max(item.updatedAt, Date.now()) };
        put(entry);
        taken.push(entry);
      }
      return taken;
    },
  };
}
