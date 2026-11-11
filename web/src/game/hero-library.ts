import { ref } from "vue";
import { HeroChoiceError, validateHeroChoices, type HeroChoices } from "../../../src/shared/hero-builder.js";

/**
 * The player's own heroes, kept in this browser as builder choices (the
 * gateway rebuilds the sheet from them whenever the hero is picked).
 */

const STORAGE_KEY = "webspeak:dnd-heroes";
const MAX_HEROES = 30;

export interface SavedHero {
  id: string;
  choices: HeroChoices;
  updatedAt: number;
}

function read(): SavedHero[] {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.flatMap(item => {
      if (typeof item !== "object" || !item || typeof (item as SavedHero).id !== "string") return [];
      try {
        return [{ id: (item as SavedHero).id, choices: validateHeroChoices((item as SavedHero).choices), updatedAt: Number((item as SavedHero).updatedAt) || 0 }];
      } catch (error: unknown) {
        if (error instanceof HeroChoiceError) return [];
        throw error;
      }
    }).slice(0, MAX_HEROES);
  } catch {
    return [];
  }
}

function write(list: SavedHero[]): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(list)); }
  catch { /* storage full or blocked: the list still lives for this visit */ }
}

const heroes = ref<SavedHero[]>(read());

export function useHeroLibrary() {
  return {
    heroes,
    save(choices: HeroChoices, id?: string): SavedHero {
      const entry: SavedHero = { id: id ?? `h${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, choices, updatedAt: Date.now() };
      heroes.value = [entry, ...heroes.value.filter(item => item.id !== entry.id)].slice(0, MAX_HEROES);
      write(heroes.value);
      return entry;
    },
    remove(id: string): void {
      heroes.value = heroes.value.filter(item => item.id !== id);
      write(heroes.value);
    },
  };
}
