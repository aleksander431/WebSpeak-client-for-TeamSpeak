import assert from "node:assert/strict";
import test from "node:test";
import { CLASSES, RACES, buildHero, pointBuyCost, suggestedAbilities, validateHeroChoices, heroPortraitUrl, HeroChoiceError } from "../shared/hero-builder.js";
import { parseDiceExpression, skillBonus } from "../shared/tabletop.js";

const base = {
  name: "Вера", race: "human", cls: "ranger", method: "array",
  abilities: { str: 12, dex: 15, con: 13, int: 8, wis: 14, cha: 10 },
  classSkills: ["perception", "stealth", "survival"], backgroundSkills: ["athletics", "history"],
};

test("a human ranger: racial bonuses, hit points, armour and attacks by the rules", () => {
  const hero = buildHero(validateHeroChoices(base), "pc-1", heroPortraitUrl);
  assert.deepEqual(hero.abilities, { str: 13, dex: 16, con: 14, int: 9, wis: 15, cha: 11 });
  assert.equal(hero.maxHp, 12, "d10 + Con 2");
  assert.equal(hero.ac, 16, "scale mail 14 + Dex (max 2)");
  assert.equal(hero.speed, 30);
  assert.deepEqual(hero.attacks.map(attack => [attack.name, attack.bonus, attack.damage]), [["Длинный лук", 5, "1d8+3"], ["Короткий меч", 5, "1d6+3"]]);
  assert.equal(skillBonus(hero, "perception"), 4);
  assert.equal(skillBonus(hero, "arcana"), -1);
});

test("every race and class builds a playable hero", () => {
  for (const race of RACES) {
    for (const cls of CLASSES) {
      const skills = cls.skillList.length ? cls.skillList.slice(0, cls.skillCount) : ["acrobatics", "arcana", "history"].slice(0, cls.skillCount);
      const background = ["medicine", "performance", "nature", "religion", "animalHandling", "sleightOfHand", "deception", "persuasion", "insight", "investigation"]
        .filter(skill => !skills.includes(skill as never) && !race.skills.includes(skill as never)).slice(0, 2);
      const taken = new Set([...skills, ...background, ...race.skills]);
      const bonusSkills = ["acrobatics", "athletics", "arcana", "survival", "stealth", "perception", "intimidation"].filter(skill => !taken.has(skill as never)).slice(0, 2);
      const choices = validateHeroChoices({
        ...base, race: race.id, cls: cls.id, abilities: suggestedAbilities(cls.id), classSkills: skills, backgroundSkills: background,
        ...(race.id === "half-elf" ? { bonusAbilities: ["dex", "con"], bonusSkills } : {}),
        ...(cls.id === "rogue" ? { expertise: skills.slice(0, 2) } : {}),
        ...(cls.id === "fighter" ? { fightingStyle: "defense" } : {}),
        ...(race.id === "dragonborn" ? { ancestry: "green" } : {}),
      });
      const hero = buildHero(choices, "x");
      assert.ok(hero.maxHp >= 7 && hero.maxHp <= 17, `${race.id} ${cls.id} hp ${hero.maxHp}`);
      assert.ok(hero.ac >= 10 && hero.ac <= 20, `${race.id} ${cls.id} ac ${hero.ac}`);
      assert.ok(hero.attacks.length >= 2);
      for (const attack of hero.attacks) assert.ok(parseDiceExpression(attack.damage), `${race.id} ${cls.id} ${attack.name} ${attack.damage}`);
    }
  }
});

test("class details: fighter style, rogue expertise, dragon breath, dwarf toughness", () => {
  const fighter = buildHero(validateHeroChoices({ ...base, cls: "fighter", abilities: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 }, classSkills: ["athletics", "perception"], backgroundSkills: ["history", "insight"], fightingStyle: "defense" }), "f");
  assert.equal(fighter.ac, 19, "chain mail, shield and the defense style");
  const archer = buildHero(validateHeroChoices({ ...base, cls: "fighter", abilities: { str: 10, dex: 15, con: 14, int: 8, wis: 13, cha: 12 }, classSkills: ["athletics", "perception"], backgroundSkills: ["history", "insight"], fightingStyle: "archery" }), "a");
  assert.equal(archer.attacks[0]!.bonus, 7, "longbow +2 prof +3 Dex +2 archery");
  const rogue = buildHero(validateHeroChoices({ ...base, race: "lightfoot-halfling", cls: "rogue", abilities: { str: 8, dex: 15, con: 14, int: 13, wis: 12, cha: 10 }, classSkills: ["stealth", "acrobatics", "deception", "perception"], backgroundSkills: ["history", "insight"], expertise: ["stealth", "perception"] }), "r");
  assert.equal(skillBonus(rogue, "stealth"), 7, "Dex +3 plus double proficiency");
  const dragon = buildHero(validateHeroChoices({ ...base, race: "dragonborn", cls: "paladin", abilities: { str: 15, dex: 10, con: 13, int: 8, wis: 12, cha: 14 }, classSkills: ["athletics", "religion"], backgroundSkills: ["history", "insight"], ancestry: "red" }), "d");
  assert.match(dragon.attacks.at(-1)!.note, /огонь, конус 15 фт.*СЛ 11/);
  const dwarf = buildHero(validateHeroChoices({ ...base, race: "hill-dwarf", cls: "wizard", abilities: { str: 8, dex: 13, con: 14, int: 15, wis: 12, cha: 10 }, classSkills: ["arcana", "history"], backgroundSkills: ["medicine", "insight"] }), "w");
  assert.equal(dwarf.maxHp, 10, "d6 + Con 3 + 1 for hill dwarves");
  assert.equal(dwarf.speed, 25);
});

test("choices that break the rules are refused", () => {
  const refused = (patch: Record<string, unknown>, code: string) => {
    assert.throws(() => validateHeroChoices({ ...base, ...patch }), (error: unknown) => error instanceof HeroChoiceError && error.code === code);
  };
  refused({ name: "" }, "HERO_NAME");
  refused({ race: "orc" }, "HERO_RACE");
  refused({ abilities: { str: 15, dex: 15, con: 13, int: 8, wis: 14, cha: 10 } }, "HERO_ABILITIES");
  refused({ abilities: { str: 18, dex: 15, con: 13, int: 8, wis: 14, cha: 10 } }, "HERO_ABILITIES");
  refused({ method: "pointbuy", abilities: { str: 15, dex: 15, con: 15, int: 10, wis: 8, cha: 8 } }, "HERO_ABILITIES");
  assert.equal(pointBuyCost({ str: 15, dex: 15, con: 15, int: 8, wis: 8, cha: 8 }), 27);
  assert.doesNotThrow(() => validateHeroChoices({ ...base, method: "pointbuy", abilities: { str: 15, dex: 15, con: 15, int: 8, wis: 8, cha: 8 } }));
  refused({ classSkills: ["perception", "stealth"] }, "HERO_CLASS_SKILLS");
  refused({ classSkills: ["perception", "stealth", "arcana"] }, "HERO_CLASS_SKILLS");
  refused({ backgroundSkills: ["perception", "history"] }, "HERO_SKILL_TWICE");
  refused({ race: "half-orc", backgroundSkills: ["intimidation", "history"] }, "HERO_SKILL_TWICE");
  refused({ race: "half-elf", bonusAbilities: ["cha", "dex"], bonusSkills: ["arcana", "nature"] }, "HERO_BONUS_ABILITIES");
  refused({ cls: "fighter", classSkills: ["intimidation", "perception"] }, "HERO_STYLE");
  refused({ portrait: "../x" }, "HERO_PORTRAIT");
});
