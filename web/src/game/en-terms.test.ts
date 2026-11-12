import assert from "node:assert/strict";
import test from "node:test";
import { CLASSES, DRAGON_ANCESTRIES, RACES, buildHero, suggestedAbilities, validateHeroChoices } from "../../../src/shared/hero-builder.js";
import { enHero, enLine, enRollText } from "./en-terms.js";
import { BUILT_IN_ADVENTURES } from "../../../src/shared/tabletop-adventures.js";
import { findSpell, spellNames } from "./spells.js";

const CYRILLIC = /[А-Яа-яЁё]/;

test("every builder text has English: all races, classes and levels", () => {
  for (const race of RACES) assert.doesNotMatch(enLine(race.name) + enLine(race.blurb) + race.features.map(enLine).join(), CYRILLIC, race.id);
  for (const cls of CLASSES) assert.doesNotMatch(enLine(cls.name) + enLine(cls.blurb), CYRILLIC, cls.id);
  for (const ancestry of DRAGON_ANCESTRIES) assert.doesNotMatch(enLine(ancestry.name) + enLine(ancestry.damage), CYRILLIC);
  for (const race of RACES) {
    for (const cls of CLASSES) {
      for (const level of [1, 2, 3, 4, 5]) {
        const skills = cls.skillList.length ? cls.skillList.slice(0, cls.skillCount) : ["acrobatics", "arcana", "history"].slice(0, cls.skillCount);
        const background = ["medicine", "performance", "nature", "religion", "animalHandling", "sleightOfHand", "deception", "persuasion", "insight", "investigation"]
          .filter(skill => !skills.includes(skill as never) && !race.skills.includes(skill as never)).slice(0, 2);
        const taken = new Set([...skills, ...background, ...race.skills]);
        const bonusSkills = ["acrobatics", "athletics", "arcana", "survival", "stealth", "perception", "intimidation"].filter(skill => !taken.has(skill as never)).slice(0, 2);
        const choices = validateHeroChoices({
          name: "Name", race: race.id, cls: cls.id, method: "array", abilities: suggestedAbilities(cls.id), classSkills: skills, backgroundSkills: background,
          level, xp: [0, 0, 300, 900, 2700, 6500][level],
          ...(level >= 4 ? { asi: ["dex", "con"] } : {}),
          ...(race.id === "half-elf" ? { bonusAbilities: ["dex", "con"], bonusSkills } : {}),
          ...(cls.id === "rogue" || (cls.id === "bard" && level >= 3) ? { expertise: skills.slice(0, 2) } : {}),
          ...(cls.id === "fighter" ? { fightingStyle: "archery" } : {}),
          ...(race.id === "dragonborn" ? { ancestry: "silver" } : {}),
        });
        const built = buildHero(choices, "x");
        for (const name of spellNames(built.spells ?? [])) assert.ok(findSpell(name), `spell card for ${name}`);
        const hero = enHero(built);
        for (const name of spellNames(hero.spells ?? [])) assert.ok(findSpell(name), `spell card for ${name}`);
        const text = JSON.stringify({ ...hero, name: "", story: "" });
        assert.doesNotMatch(text, CYRILLIC, `${race.id} ${cls.id} ${level}: ${text.match(/"[^"]*[А-Яа-яЁё][^"]*"/)?.[0]}`);
      }
    }
  }
});

test("roll labels and reasons read in English", () => {
  assert.equal(enRollText("Атака: Длинный лук"), "Attack: Longbow");
  assert.equal(enRollText("Урон: Секира (крит)"), "Damage: Greataxe (critical)");
  assert.equal(enRollText("Ловкость (Скрытность)"), "Dexterity (Stealth)");
  assert.equal(enRollText("Спасбросок: Мудрость"), "Wisdom save");
  assert.equal(enRollText("Священное пламя: спасбросок Ловкость"), "Sacred Flame: Dexterity save");
  assert.equal(enRollText("отравлен: помеха"), "poisoned: disadvantage");
  assert.equal(enRollText("цель опутан: преимущество"), "target restrained: advantage");
  assert.equal(enRollText("Опыт +300: Вера"), "Experience +300: Вера");
  assert.equal(enRollText("Паутина: спасбросок Ловкость, при провале — опутан"), "Паутина: Dexterity save, on a failure restrained");
});

test("the adventures' heroes have a card for every spell", () => {
  for (const adventure of BUILT_IN_ADVENTURES) {
    for (const hero of adventure.heroes) for (const name of spellNames(hero.spells ?? [])) assert.ok(findSpell(name), `${hero.id}: ${name}`);
  }
  assert.deepEqual(spellNames(["Заговоры: Огненный снаряд, Свет", "1-й круг (подготовлены): Лечение ран"]), ["Огненный снаряд", "Свет", "Лечение ран"]);
});
