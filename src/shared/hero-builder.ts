import {
  ABILITIES,
  SKILLS,
  abilityModifier,
  formatModifier,
  type Ability,
  type HeroAttack,
  type HeroSheet,
  type Skill,
} from "./tabletop.js";

/**
 * Level-1 heroes by the SRD 5.1 rules. A player sends only choices; the
 * gateway (and the page, for the preview) builds the sheet from them, so the
 * numbers cannot be tampered with. Browser-safe, no Node imports.
 */

export type RaceId = "human" | "high-elf" | "hill-dwarf" | "lightfoot-halfling" | "dragonborn" | "rock-gnome" | "half-elf" | "half-orc" | "tiefling";
export type ClassId = "barbarian" | "bard" | "cleric" | "druid" | "fighter" | "monk" | "paladin" | "ranger" | "rogue" | "sorcerer" | "warlock" | "wizard";
export type AbilityMethod = "array" | "pointbuy";

export interface HeroChoices {
  name: string;
  race: RaceId;
  cls: ClassId;
  method: AbilityMethod;
  /** Scores before racial bonuses. */
  abilities: Record<Ability, number>;
  /** Picked from the class list. */
  classSkills: Skill[];
  /** Two skills of the hero's background, any. */
  backgroundSkills: Skill[];
  /** Half-elves: two abilities other than Charisma (+1 each) and two more skills. */
  bonusAbilities?: Ability[];
  bonusSkills?: Skill[];
  /** Rogues: two of their proficient skills, doubled. */
  expertise?: Skill[];
  /** Fighters. */
  fightingStyle?: "defense" | "archery";
  /** Dragonborn ancestry colour. */
  ancestry?: DragonAncestry;
  portrait?: string;
  story?: string;
}

export type DragonAncestry = "red" | "blue" | "green" | "black" | "white" | "gold" | "silver" | "bronze" | "copper" | "brass";

export interface RaceInfo {
  id: RaceId;
  name: string;
  bonuses: Partial<Record<Ability, number>>;
  speed: number;
  /** Skills the race always gives. */
  skills: Skill[];
  hpPerLevel: number;
  features: string[];
  blurb: string;
}

interface WeaponPlan {
  name: string;
  /** Which ability drives it: a fixed one, finesse (the better of Strength and Dexterity) or the spellcasting ability. */
  ability: "str" | "dex" | "finesse" | "spell";
  die: string;
  note: string;
  /** Saving-throw spells roll no attack. */
  save?: Ability;
  /** Adds the ability modifier to damage (weapons do, most cantrips do not). */
  addModifier?: boolean;
  ranged?: boolean;
}

export interface ClassInfo {
  id: ClassId;
  name: string;
  hitDie: number;
  saves: Ability[];
  skillCount: number;
  /** Empty: any skill. */
  skillList: Skill[];
  spellAbility?: Ability;
  blurb: string;
  /** The abilities to put the best scores in. */
  primary: Ability[];
}

const DRAGON: Record<DragonAncestry, { name: string; damage: string; shape: string; save: Ability }> = {
  red: { name: "Красный", damage: "огонь", shape: "конус 15 фт", save: "dex" },
  gold: { name: "Золотой", damage: "огонь", shape: "конус 15 фт", save: "dex" },
  brass: { name: "Латунный", damage: "огонь", shape: "линия 5×30 фт", save: "dex" },
  blue: { name: "Синий", damage: "электричество", shape: "линия 5×30 фт", save: "dex" },
  bronze: { name: "Бронзовый", damage: "электричество", shape: "линия 5×30 фт", save: "dex" },
  black: { name: "Чёрный", damage: "кислота", shape: "линия 5×30 фт", save: "dex" },
  copper: { name: "Медный", damage: "кислота", shape: "линия 5×30 фт", save: "dex" },
  green: { name: "Зелёный", damage: "яд", shape: "конус 15 фт", save: "con" },
  white: { name: "Белый", damage: "холод", shape: "конус 15 фт", save: "con" },
  silver: { name: "Серебряный", damage: "холод", shape: "конус 15 фт", save: "con" },
};
export const DRAGON_ANCESTRIES = Object.entries(DRAGON).map(([id, info]) => ({ id: id as DragonAncestry, name: info.name, damage: info.damage }));

export const RACES: RaceInfo[] = [
  { id: "human", name: "Человек", bonuses: { str: 1, dex: 1, con: 1, int: 1, wis: 1, cha: 1 }, speed: 30, skills: [], hpPerLevel: 0,
    features: ["Владение одним дополнительным языком"], blurb: "+1 ко всем характеристикам. Везде свой." },
  { id: "high-elf", name: "Высший эльф", bonuses: { dex: 2, int: 1 }, speed: 30, skills: ["perception"], hpPerLevel: 0,
    features: ["Тёмное зрение 60 фт", "Наследие фей: преимущество против очарования, магией не усыпить", "Транс: 4 часа медитации вместо сна", "Заговор волшебника (Фокусы)"], blurb: "Ловкость и Интеллект, острый слух и магия в крови." },
  { id: "hill-dwarf", name: "Холмовой дварф", bonuses: { con: 2, wis: 1 }, speed: 25, skills: [], hpPerLevel: 1,
    features: ["Тёмное зрение 60 фт", "Дварфская стойкость: преимущество на спасброски от яда, сопротивление яду", "Знание камня", "Дварфская выдержка: +1 хит за уровень"], blurb: "Крепкий и мудрый, больше хитов. Скорость 25 фт." },
  { id: "lightfoot-halfling", name: "Легконогий полурослик", bonuses: { dex: 2, cha: 1 }, speed: 25, skills: [], hpPerLevel: 0,
    features: ["Везучий: перебросьте 1 на к20", "Храбрый: преимущество против испуга", "Проворство: проходите сквозь крупных существ", "Естественная скрытность"], blurb: "Ловкий и обаятельный, удача на его стороне." },
  { id: "dragonborn", name: "Драконорождённый", bonuses: { str: 2, cha: 1 }, speed: 30, skills: [], hpPerLevel: 0,
    features: [], blurb: "Сила и Харизма, оружие дыхания и сопротивление стихии." },
  { id: "rock-gnome", name: "Скальный гном", bonuses: { int: 2, con: 1 }, speed: 25, skills: [], hpPerLevel: 0,
    features: ["Тёмное зрение 60 фт", "Гномья хитрость: преимущество на спасброски Инт, Мдр и Хар от магии", "Знание ремесла", "Жестянщик: мелкие механизмы"], blurb: "Умный изобретатель, крепко стоит против магии." },
  { id: "half-elf", name: "Полуэльф", bonuses: { cha: 2 }, speed: 30, skills: [], hpPerLevel: 0,
    features: ["Тёмное зрение 60 фт", "Наследие фей: преимущество против очарования, магией не усыпить", "Разносторонность: +2 навыка, +1 к двум характеристикам"], blurb: "Харизма, две характеристики и два навыка на выбор." },
  { id: "half-orc", name: "Полуорк", bonuses: { str: 2, con: 1 }, speed: 30, skills: ["intimidation"], hpPerLevel: 0,
    features: ["Тёмное зрение 60 фт", "Непоколебимая стойкость: раз в день при 0 хитов остаётесь с 1", "Свирепые атаки: на крите ещё одна кость урона оружия"], blurb: "Сильный и выносливый, не падает с первого удара." },
  { id: "tiefling", name: "Тифлинг", bonuses: { cha: 2, int: 1 }, speed: 30, skills: [], hpPerLevel: 0,
    features: ["Тёмное зрение 60 фт", "Адское сопротивление: сопротивление огню", "Дьявольское наследие: заговор «Чудотворство»"], blurb: "Харизма и Интеллект, огонь ему не страшен." },
];

export const CLASSES: ClassInfo[] = [
  { id: "barbarian", name: "Варвар", hitDie: 12, saves: ["str", "con"], skillCount: 2, primary: ["str", "con", "dex"],
    skillList: ["animalHandling", "athletics", "intimidation", "nature", "perception", "survival"], blurb: "Ярость, огромный топор и больше всех хитов." },
  { id: "bard", name: "Бард", hitDie: 8, saves: ["dex", "cha"], skillCount: 3, skillList: [], spellAbility: "cha", primary: ["cha", "dex", "con"],
    blurb: "Магия музыки, вдохновение союзников, любые три навыка." },
  { id: "cleric", name: "Жрец (Домен жизни)", hitDie: 8, saves: ["wis", "cha"], skillCount: 2, spellAbility: "wis", primary: ["wis", "con", "str"],
    skillList: ["history", "insight", "medicine", "persuasion", "religion"], blurb: "Лечит лучше всех, носит тяжёлую броню." },
  { id: "druid", name: "Друид", hitDie: 8, saves: ["int", "wis"], skillCount: 2, spellAbility: "wis", primary: ["wis", "con", "dex"],
    skillList: ["arcana", "animalHandling", "insight", "medicine", "nature", "perception", "religion", "survival"], blurb: "Магия природы, огонь в ладони и опутывающие лозы." },
  { id: "fighter", name: "Воин", hitDie: 10, saves: ["str", "con"], skillCount: 2, primary: ["str", "con", "dex"],
    skillList: ["acrobatics", "animalHandling", "athletics", "history", "insight", "intimidation", "perception", "survival"], blurb: "Мастер оружия и доспехов, второе дыхание." },
  { id: "monk", name: "Монах", hitDie: 8, saves: ["str", "dex"], skillCount: 2, primary: ["dex", "wis", "con"],
    skillList: ["acrobatics", "athletics", "history", "insight", "religion", "stealth"], blurb: "Быстрые удары без оружия и защита без доспехов." },
  { id: "paladin", name: "Паладин", hitDie: 10, saves: ["wis", "cha"], skillCount: 2, primary: ["str", "cha", "con"],
    skillList: ["athletics", "insight", "intimidation", "medicine", "persuasion", "religion"], blurb: "Святой воин: латы, щит и наложение рук." },
  { id: "ranger", name: "Следопыт", hitDie: 10, saves: ["str", "dex"], skillCount: 3, primary: ["dex", "wis", "con"],
    skillList: ["animalHandling", "athletics", "insight", "investigation", "nature", "perception", "stealth", "survival"], blurb: "Лучник и охотник, знает дикие земли." },
  { id: "rogue", name: "Плут", hitDie: 8, saves: ["dex", "int"], skillCount: 4, primary: ["dex", "int", "con"],
    skillList: ["acrobatics", "athletics", "deception", "insight", "intimidation", "investigation", "perception", "performance", "persuasion", "sleightOfHand", "stealth"],
    blurb: "Скрытая атака, экспертиза в навыках, четыре навыка." },
  { id: "sorcerer", name: "Чародей (Драконья кровь)", hitDie: 6, saves: ["con", "cha"], skillCount: 2, spellAbility: "cha", primary: ["cha", "con", "dex"],
    skillList: ["arcana", "deception", "insight", "intimidation", "persuasion", "religion"], blurb: "Врождённая магия и драконья чешуя вместо доспеха." },
  { id: "warlock", name: "Колдун (Исчадие)", hitDie: 8, saves: ["wis", "cha"], skillCount: 2, spellAbility: "cha", primary: ["cha", "con", "dex"],
    skillList: ["arcana", "deception", "history", "intimidation", "investigation", "nature", "religion"], blurb: "Сделка с исчадием, мистический заряд." },
  { id: "wizard", name: "Волшебник", hitDie: 6, saves: ["int", "wis"], skillCount: 2, spellAbility: "int", primary: ["int", "con", "dex"],
    skillList: ["arcana", "history", "insight", "investigation", "medicine", "religion"], blurb: "Книга заклинаний: больше всех заклинаний." },
];

export const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8];
export const POINT_BUY_BUDGET = 27;
const POINT_COST: Record<number, number> = { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 };
const PROFICIENCY = 2;

export function pointBuyCost(abilities: Record<Ability, number>): number {
  return ABILITIES.reduce((sum, ability) => sum + (POINT_COST[abilities[ability]] ?? 99), 0);
}

export function findRace(id: unknown): RaceInfo | undefined {
  return RACES.find(race => race.id === id);
}

export function findClass(id: unknown): ClassInfo | undefined {
  return CLASSES.find(cls => cls.id === id);
}

/** Final scores with racial bonuses. */
export function finalAbilities(choices: Pick<HeroChoices, "race" | "abilities" | "bonusAbilities">): Record<Ability, number> {
  const race = findRace(choices.race);
  const result = { ...choices.abilities };
  for (const ability of ABILITIES) result[ability] += race?.bonuses[ability] ?? 0;
  if (choices.race === "half-elf") for (const ability of choices.bonusAbilities ?? []) result[ability] += 1;
  return result;
}

/** Skills the race and class give without a choice. */
export function grantedSkills(choices: Pick<HeroChoices, "race">): Skill[] {
  return findRace(choices.race)?.skills ?? [];
}

export class HeroChoiceError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "HeroChoiceError";
  }
}

const SKILL_SET = new Set(Object.keys(SKILLS));

/** Checks choices against the rules; throws HeroChoiceError with a code the page translates. */
export function validateHeroChoices(raw: unknown): HeroChoices {
  if (typeof raw !== "object" || raw === null) throw new HeroChoiceError("HERO_INVALID", "not an object");
  const value = raw as Record<string, unknown>;
  const name = typeof value.name === "string" ? value.name.trim() : "";
  if (!name || name.length > 40) throw new HeroChoiceError("HERO_NAME", "name: 1–40 characters");
  const race = findRace(value.race);
  if (!race) throw new HeroChoiceError("HERO_RACE", "unknown race");
  const cls = findClass(value.cls);
  if (!cls) throw new HeroChoiceError("HERO_CLASS", "unknown class");
  if (value.method !== "array" && value.method !== "pointbuy") throw new HeroChoiceError("HERO_ABILITIES", "unknown method");
  const scores = typeof value.abilities === "object" && value.abilities ? value.abilities as Record<string, unknown> : {};
  const abilities = {} as Record<Ability, number>;
  for (const ability of ABILITIES) {
    const score = scores[ability];
    if (!Number.isInteger(score) || (score as number) < 8 || (score as number) > 15) throw new HeroChoiceError("HERO_ABILITIES", `${ability}: 8–15`);
    abilities[ability] = score as number;
  }
  if (value.method === "array") {
    const sorted = ABILITIES.map(ability => abilities[ability]).sort((a, b) => b - a);
    if (sorted.join() !== STANDARD_ARRAY.join()) throw new HeroChoiceError("HERO_ABILITIES", "use 15, 14, 13, 12, 10, 8 once each");
  } else if (pointBuyCost(abilities) > POINT_BUY_BUDGET) {
    throw new HeroChoiceError("HERO_ABILITIES", `at most ${POINT_BUY_BUDGET} points`);
  }
  const skillList = (input: unknown, code: string): Skill[] => {
    if (input === undefined) return [];
    if (!Array.isArray(input) || !input.every(item => typeof item === "string" && SKILL_SET.has(item))) throw new HeroChoiceError(code, "unknown skill");
    if (new Set(input).size !== input.length) throw new HeroChoiceError(code, "a skill twice");
    return input as Skill[];
  };
  const classSkills = skillList(value.classSkills, "HERO_CLASS_SKILLS");
  if (classSkills.length !== cls.skillCount) throw new HeroChoiceError("HERO_CLASS_SKILLS", `pick ${cls.skillCount}`);
  if (cls.skillList.length && !classSkills.every(skill => cls.skillList.includes(skill))) throw new HeroChoiceError("HERO_CLASS_SKILLS", "not a class skill");
  const backgroundSkills = skillList(value.backgroundSkills, "HERO_BACKGROUND_SKILLS");
  if (backgroundSkills.length !== 2) throw new HeroChoiceError("HERO_BACKGROUND_SKILLS", "pick 2");
  const choices: HeroChoices = { name, race: race.id, cls: cls.id, method: value.method, abilities, classSkills, backgroundSkills };
  let bonusSkills: Skill[] = [];
  if (race.id === "half-elf") {
    const bonusAbilities = value.bonusAbilities;
    if (!Array.isArray(bonusAbilities) || bonusAbilities.length !== 2 || new Set(bonusAbilities).size !== 2
      || !bonusAbilities.every(item => (ABILITIES as readonly unknown[]).includes(item) && item !== "cha")) {
      throw new HeroChoiceError("HERO_BONUS_ABILITIES", "two different abilities other than Charisma");
    }
    choices.bonusAbilities = bonusAbilities as Ability[];
    bonusSkills = skillList(value.bonusSkills, "HERO_BONUS_SKILLS");
    if (bonusSkills.length !== 2) throw new HeroChoiceError("HERO_BONUS_SKILLS", "pick 2");
    choices.bonusSkills = bonusSkills;
  }
  const all = [...race.skills, ...classSkills, ...backgroundSkills, ...bonusSkills];
  if (new Set(all).size !== all.length) throw new HeroChoiceError("HERO_SKILL_TWICE", "the same skill from two sources");
  if (cls.id === "rogue") {
    const expertise = skillList(value.expertise, "HERO_EXPERTISE");
    if (expertise.length !== 2 || !expertise.every(skill => all.includes(skill))) throw new HeroChoiceError("HERO_EXPERTISE", "two of your skills");
    choices.expertise = expertise;
  }
  if (cls.id === "fighter") {
    if (value.fightingStyle !== "defense" && value.fightingStyle !== "archery") throw new HeroChoiceError("HERO_STYLE", "defense or archery");
    choices.fightingStyle = value.fightingStyle;
  }
  if (race.id === "dragonborn") {
    if (typeof value.ancestry !== "string" || !(value.ancestry in DRAGON)) throw new HeroChoiceError("HERO_ANCESTRY", "dragon colour");
    choices.ancestry = value.ancestry as DragonAncestry;
  }
  if (value.portrait !== undefined) {
    if (typeof value.portrait !== "string" || !/^[a-z0-9-]{1,48}$/.test(value.portrait)) throw new HeroChoiceError("HERO_PORTRAIT", "unknown portrait");
    choices.portrait = value.portrait;
  }
  if (value.story !== undefined) {
    if (typeof value.story !== "string" || value.story.length > 600) throw new HeroChoiceError("HERO_STORY", "at most 600 characters");
    if (value.story.trim()) choices.story = value.story.trim();
  }
  return choices;
}

/** The hero sheet the choices produce. `portraitUrl` turns a gallery id into a picture. */
export function buildHero(choices: HeroChoices, id: string, portraitUrl: (portrait: string) => string | undefined = () => undefined): HeroSheet {
  const race = findRace(choices.race)!;
  const cls = findClass(choices.cls)!;
  const scores = finalAbilities(choices);
  const mod = (ability: Ability) => abilityModifier(scores[ability]);
  const spell = cls.spellAbility ? mod(cls.spellAbility) : 0;
  const saveDc = 8 + PROFICIENCY + spell;
  const strongerHand: "str" | "dex" = mod("dex") > mod("str") ? "dex" : "str";

  const plan = classPlan(cls.id, choices, mod, strongerHand);
  const attacks: HeroAttack[] = plan.weapons.map(weapon => {
    const ability = weapon.ability === "finesse" ? (mod("dex") >= mod("str") ? "dex" : "str") : weapon.ability === "spell" ? cls.spellAbility ?? "int" : weapon.ability;
    const modifier = mod(ability);
    const archery = choices.fightingStyle === "archery" && weapon.ranged ? 2 : 0;
    const add = weapon.addModifier ?? weapon.ability !== "spell";
    const damage = `${weapon.die}${add && modifier ? formatModifier(modifier) : ""}`;
    if (weapon.save) {
      return { name: weapon.name, bonus: null, damage, note: `${weapon.note}; спасбросок ${ABILITY_SHORT[weapon.save]} СЛ ${saveDc}` };
    }
    return { name: weapon.name, bonus: PROFICIENCY + modifier + archery, damage, note: weapon.note };
  });
  if (race.id === "dragonborn" && choices.ancestry) {
    const breath = DRAGON[choices.ancestry];
    attacks.push({ name: "Оружие дыхания", bonus: null, damage: "2d6", note: `${breath.damage}, ${breath.shape}, раз на короткий отдых; спасбросок ${ABILITY_SHORT[breath.save]} СЛ ${8 + PROFICIENCY + mod("con")}, половина при успехе` });
  }

  const raceFeatures = race.id === "dragonborn" && choices.ancestry
    ? [`${DRAGON[choices.ancestry].name} дракон: сопротивление урону «${DRAGON[choices.ancestry].damage}»`]
    : race.features;
  const skills = [...new Set([...race.skills, ...choices.classSkills, ...choices.backgroundSkills, ...(choices.bonusSkills ?? [])])];
  const hp = cls.hitDie + mod("con") + race.hpPerLevel;
  return {
    id,
    name: choices.name,
    race: race.name,
    cls: cls.name,
    level: 1,
    maxHp: Math.max(1, hp),
    ac: plan.ac,
    speed: race.speed,
    abilities: scores,
    saves: [...cls.saves],
    skills,
    expertise: choices.expertise ? [...choices.expertise] : [],
    attacks,
    features: [...plan.features, ...raceFeatures],
    equipment: plan.equipment,
    ...(plan.spells.length ? { spells: plan.spells } : {}),
    story: choices.story ?? "",
    ...(choices.portrait && portraitUrl(choices.portrait) ? { portrait: portraitUrl(choices.portrait) } : {}),
  };
}

const ABILITY_SHORT: Record<Ability, string> = { str: "Сил", dex: "Лов", con: "Тел", int: "Инт", wis: "Мдр", cha: "Хар" };

interface Plan { ac: number; weapons: WeaponPlan[]; features: string[]; equipment: string[]; spells: string[] }

function classPlan(cls: ClassId, choices: HeroChoices, mod: (ability: Ability) => number, hand: "str" | "dex"): Plan {
  const dex = mod("dex");
  switch (cls) {
    case "barbarian": return {
      ac: 10 + dex + mod("con"),
      weapons: [
        { name: "Секира", ability: "str", die: "1d12", note: "двуручное, рубящий" },
        { name: "Ручной топор", ability: "str", die: "1d6", note: "метательное 20/60 фт, рубящий", ranged: true },
      ],
      features: ["Ярость (2 раза в день): +2 к урону Силой, сопротивление дробящему, колющему и рубящему, преимущество на проверки Силы", "Защита без доспехов: КД 10 + Лов + Тел"],
      equipment: ["Секира", "2 ручных топора", "4 метательных копья", "Набор путешественника"], spells: [],
    };
    case "bard": return {
      ac: 11 + dex,
      weapons: [
        { name: "Рапира", ability: "finesse", die: "1d8", note: "фехтовальное, колющий" },
        { name: "Злая насмешка", ability: "spell", die: "1d4", note: "заговор, 60 фт, психический, помеха на следующую атаку цели", save: "wis", addModifier: false },
      ],
      features: [`Вдохновение барда (к6, ${Math.max(1, mod("cha"))} раз в день)`, "Заклинания: 2 ячейки 1-го круга"],
      equipment: ["Рапира", "Лютня", "Кожаный доспех", "Кинжал", "Набор артиста"],
      spells: ["Заговоры: Злая насмешка, Малая иллюзия", "1-й круг: Лечащее слово, Усыпление, Очарование личности, Громовая волна"],
    };
    case "cleric": return {
      ac: 18,
      weapons: [
        { name: "Булава", ability: "str", die: "1d6", note: "рукопашная, дробящий" },
        { name: "Священное пламя", ability: "spell", die: "1d8", note: "заговор, 60 фт, излучение, укрытие не помогает", save: "dex", addModifier: false },
      ],
      features: ["Домен жизни: владение тяжёлыми доспехами", "Ученик жизни: лечебные заклинания восстанавливают ещё 2 + круг хитов", "Заклинания: 2 ячейки 1-го круга"],
      equipment: ["Булава", "Кольчуга", "Щит", "Священный символ", "Набор священника"],
      spells: ["Заговоры: Священное пламя, Указание, Свет", "1-й круг (подготовлены): Лечение ран, Благословение, Щит веры, Нанесение ран"],
    };
    case "druid": return {
      ac: 13 + dex,
      weapons: [
        { name: "Скимитар", ability: "finesse", die: "1d6", note: "фехтовальное, рубящий" },
        { name: "Сотворение пламени", ability: "spell", die: "1d8", note: "заговор, бросок 30 фт, огонь", ranged: true, addModifier: false },
      ],
      features: ["Друидический язык", "Заклинания: 2 ячейки 1-го круга"],
      equipment: ["Скимитар", "Кожаный доспех", "Деревянный щит", "Друидическая фокусировка", "Набор путешественника"],
      spells: ["Заговоры: Сотворение пламени, Указание", "1-й круг (подготовлены): Лечение ран, Опутывание, Громовая волна, Огонь фей"],
    };
    case "fighter": {
      const defense = choices.fightingStyle === "defense" ? 1 : 0;
      if (hand === "str") return {
        ac: 18 + defense,
        weapons: [
          { name: "Длинный меч", ability: "str", die: "1d8", note: "рукопашная, рубящий (1к10 двумя руками без щита)" },
          { name: "Лёгкий арбалет", ability: "dex", die: "1d8", note: "дальнобойная 80/320 фт, колющий", ranged: true },
        ],
        features: [choices.fightingStyle === "defense" ? "Боевой стиль: Защита (+1 КД в доспехе)" : "Боевой стиль: Стрельба (+2 к дальнобойным атакам)", `Второе дыхание: бонусным действием 1к10+1 хитов, раз на короткий отдых`],
        equipment: ["Кольчуга", "Длинный меч", "Щит", "Лёгкий арбалет, 20 болтов", "Набор исследователя подземелий"], spells: [],
      };
      return {
        ac: 11 + dex + defense,
        weapons: [
          { name: "Длинный лук", ability: "dex", die: "1d8", note: "дальнобойная 150/600 фт, колющий", ranged: true },
          { name: "Короткий меч", ability: "finesse", die: "1d6", note: "фехтовальное, колющий" },
        ],
        features: [choices.fightingStyle === "defense" ? "Боевой стиль: Защита (+1 КД в доспехе)" : "Боевой стиль: Стрельба (+2 к дальнобойным атакам)", `Второе дыхание: бонусным действием 1к10+1 хитов, раз на короткий отдых`],
        equipment: ["Кожаный доспех", "Длинный лук, 20 стрел", "2 коротких меча", "Набор исследователя подземелий"], spells: [],
      };
    }
    case "monk": return {
      ac: 10 + dex + mod("wis"),
      weapons: [
        { name: "Короткий меч", ability: "finesse", die: "1d6", note: "фехтовальное, колющий" },
        { name: "Безоружный удар", ability: "finesse", die: "1d4", note: "бонусным действием после атаки (боевые искусства)" },
      ],
      features: ["Защита без доспехов: КД 10 + Лов + Мдр", "Боевые искусства: к4 безоружно, удар бонусным действием"],
      equipment: ["Короткий меч", "10 дротиков", "Набор исследователя подземелий"], spells: [],
    };
    case "paladin": return {
      ac: 18,
      weapons: [
        { name: "Длинный меч", ability: "str", die: "1d8", note: "рукопашная, рубящий" },
        { name: "Метательное копьё", ability: "str", die: "1d6", note: "метательное 30/120 фт, колющий", ranged: true },
      ],
      features: [`Божественное чувство (${1 + Math.max(0, mod("cha"))} раз в день): чувствует нежить, исчадий и небожителей в 60 фт`, `Наложение рук: запас 5 хитов лечения в день`],
      equipment: ["Кольчуга", "Длинный меч", "Щит", "5 метательных копий", "Священный символ", "Набор священника"], spells: [],
    };
    case "ranger": return {
      ac: 14 + Math.min(2, dex),
      weapons: [
        { name: "Длинный лук", ability: "dex", die: "1d8", note: "дальнобойная 150/600 фт, колющий", ranged: true },
        { name: "Короткий меч", ability: "finesse", die: "1d6", note: "фехтовальное, колющий, можно с двух рук" },
      ],
      features: ["Избранный враг: нежить (преимущество на выслеживание и знания о ней)", "Исследователь природы: леса"],
      equipment: ["Чешуйчатый доспех (помеха Скрытности)", "Длинный лук, 20 стрел", "2 коротких меча", "Набор путешественника"], spells: [],
    };
    case "rogue": return {
      ac: 11 + dex,
      weapons: [
        { name: "Рапира", ability: "finesse", die: "1d8", note: "фехтовальное, колющий" },
        { name: "Короткий лук", ability: "dex", die: "1d6", note: "дальнобойная 80/320 фт, колющий", ranged: true },
        { name: "Скрытая атака", ability: "dex", die: "1d6", note: "раз в ход при преимуществе или союзнике рядом с целью", addModifier: false },
      ],
      features: ["Скрытая атака 1к6", "Экспертиза: двойной бонус мастерства в двух навыках", "Воровской жаргон"],
      equipment: ["Рапира", "Короткий лук, 20 стрел", "Кожаный доспех", "2 кинжала", "Воровские инструменты", "Набор взломщика"], spells: [],
    };
    case "sorcerer": return {
      ac: 13 + dex,
      weapons: [
        { name: "Огненный снаряд", ability: "spell", die: "1d10", note: "заговор, 120 фт, огонь", ranged: true, addModifier: false },
        { name: "Кинжал", ability: "finesse", die: "1d4", note: "фехтовальное, метательное 20/60 фт" },
      ],
      features: ["Драконья устойчивость: КД 13 + Лов без доспехов, +1 хит за уровень", "Заклинания: 2 ячейки 1-го круга"],
      equipment: ["Лёгкий арбалет", "2 кинжала", "Магическая фокусировка", "Набор исследователя подземелий"],
      spells: ["Заговоры: Огненный снаряд, Свет, Леденящее прикосновение, Фокусы", "1-й круг: Волшебная стрела, Щит"],
    };
    case "warlock": return {
      ac: 11 + dex,
      weapons: [
        { name: "Мистический заряд", ability: "spell", die: "1d10", note: "заговор, 120 фт, силовое поле", ranged: true, addModifier: false },
        { name: "Кинжал", ability: "finesse", die: "1d4", note: "фехтовальное, метательное 20/60 фт" },
      ],
      features: ["Покровитель — Исчадие: убив врага, получаете Хар + 1 временных хитов", "Магия договора: 1 ячейка 1-го круга, восстанавливается после короткого отдыха"],
      equipment: ["Лёгкий арбалет", "Кожаный доспех", "2 кинжала", "Магическая фокусировка", "Набор учёного"],
      spells: ["Заговоры: Мистический заряд, Фокусы", "1-й круг: Огненные ладони, Очарование личности"],
    };
    case "wizard": return {
      ac: 10 + dex,
      weapons: [
        { name: "Огненный снаряд", ability: "spell", die: "1d10", note: "заговор, 120 фт, огонь", ranged: true, addModifier: false },
        { name: "Кинжал", ability: "finesse", die: "1d4", note: "фехтовальное, метательное 20/60 фт" },
      ],
      features: ["Магическое восстановление: раз в день вернуть ячейку на коротком отдыхе", "Заклинания: 2 ячейки 1-го круга; «Доспехи мага» дают КД 13 + Лов"],
      equipment: ["Боевой посох", "Книга заклинаний", "Магическая фокусировка", "Набор учёного"],
      spells: ["Заговоры: Огненный снаряд, Свет, Волшебная рука", "Книга (1-й круг): Волшебная стрела, Щит, Усыпление, Доспехи мага, Обнаружение магии, Огненные ладони"],
    };
  }
}

/** A sensible starting point: the standard array in the class's preferred order. */
export function suggestedAbilities(cls: ClassId): Record<Ability, number> {
  const info = findClass(cls)!;
  const order = [...info.primary, ...ABILITIES.filter(ability => !info.primary.includes(ability))];
  const result = {} as Record<Ability, number>;
  order.forEach((ability, index) => { result[ability] = STANDARD_ARRAY[index]!; });
  return result;
}

/** The portrait gallery heroes may pick from (`/dnd/portraits/<id>.webp`). */
export const HERO_PORTRAITS: Array<{ id: string; race: RaceId }> = [
  { id: "human-f-fighter", race: "human" }, { id: "human-m-wizard", race: "human" }, { id: "human-m-monk", race: "human" },
  { id: "human-f-druid", race: "human" }, { id: "human-m-rogue", race: "human" }, { id: "human-f-paladin", race: "human" },
  { id: "elf-f-wizard", race: "high-elf" }, { id: "elf-m-ranger", race: "high-elf" }, { id: "elf-f-cleric", race: "high-elf" },
  { id: "dwarf-m-cleric", race: "hill-dwarf" }, { id: "dwarf-f-fighter", race: "hill-dwarf" }, { id: "dwarf-m-barbarian", race: "hill-dwarf" },
  { id: "halfling-f-rogue", race: "lightfoot-halfling" }, { id: "halfling-m-bard", race: "lightfoot-halfling" },
  { id: "dragonborn-m-paladin", race: "dragonborn" }, { id: "dragonborn-f-sorcerer", race: "dragonborn" },
  { id: "gnome-f-wizard", race: "rock-gnome" }, { id: "gnome-m-bard", race: "rock-gnome" },
  { id: "halfelf-f-bard", race: "half-elf" }, { id: "halfelf-m-warlock", race: "half-elf" },
  { id: "halforc-f-barbarian", race: "half-orc" }, { id: "halforc-m-fighter", race: "half-orc" },
  { id: "tiefling-m-warlock", race: "tiefling" }, { id: "tiefling-f-sorcerer", race: "tiefling" },
];

export function heroPortraitUrl(id: string): string | undefined {
  return HERO_PORTRAITS.some(portrait => portrait.id === id) ? `/dnd/portraits/${id}.webp` : undefined;
}
