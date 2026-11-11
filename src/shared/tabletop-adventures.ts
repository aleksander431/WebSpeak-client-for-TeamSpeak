import type { AdventureSummary, HeroSheet } from "./tabletop.js";

/*
 * Built-in adventures. Rules content follows the SRD 5.1 (CC BY 4.0); the
 * adventure, its heroes and texts are original to WebSpeak.
 */

const ilva: HeroSheet = {
  id: "ilva",
  name: "Ильва Тенепряд",
  race: "Высшая эльфийка",
  cls: "Плутовка",
  level: 1,
  maxHp: 10,
  ac: 14,
  speed: 30,
  abilities: { str: 8, dex: 17, con: 14, int: 14, wis: 10, cha: 12 },
  saves: ["dex", "int"],
  skills: ["stealth", "acrobatics", "sleightOfHand", "deception", "perception"],
  expertise: ["stealth", "sleightOfHand"],
  attacks: [
    { name: "Рапира", bonus: 5, damage: "1d8+3", note: "рукопашная, колющий" },
    { name: "Короткий лук", bonus: 5, damage: "1d6+3", note: "дальнобойная 80/320 фт, колющий" },
    { name: "Скрытая атака", bonus: null, damage: "1d6", note: "раз в ход, при преимуществе или союзнике рядом с целью" },
  ],
  features: ["Скрытая атака 1к6", "Воровской жаргон", "Тёмное зрение 60 фт", "Транс: 4 часа вместо сна", "Наследие фей: преимущество против очарования"],
  equipment: ["Кожаный доспех", "Рапира", "Короткий лук и 20 стрел", "Воровские инструменты", "Тёмный плащ с капюшоном"],
  story: "Выросла среди контрабандистов портового Сольгарда. Ищет брата, пропавшего в катакомбах год назад.",
};

const osmund: HeroSheet = {
  id: "osmund",
  name: "Брат Осмунд",
  race: "Человек",
  cls: "Жрец (домен Жизни)",
  level: 1,
  maxHp: 10,
  ac: 18,
  speed: 30,
  abilities: { str: 14, dex: 9, con: 15, int: 11, wis: 16, cha: 13 },
  saves: ["wis", "cha"],
  skills: ["insight", "religion", "medicine", "persuasion"],
  attacks: [
    { name: "Булава", bonus: 4, damage: "1d6+2", note: "рукопашная, дробящий" },
    { name: "Священное пламя", bonus: null, damage: "1d8", note: "60 фт, спасбросок Ловкости СЛ 13, излучение" },
  ],
  features: ["Ученик Жизни: лечение +2 + уровень заклинания", "Тяжёлые доспехи", "Ячейки заклинаний 1-го круга: 2", "СЛ заклинаний 13, атака заклинанием +5"],
  equipment: ["Кольчуга", "Щит со знаком солнца", "Булава", "Священный символ", "Набор целителя"],
  spells: ["Священное пламя", "Указание", "Свет", "Лечение ран", "Благословение", "Лечащее слово"],
  story: "Последний служитель заброшенной часовни над катакомбами. Слышит колокол во снах.",
};

const mirra: HeroSheet = {
  id: "mirra",
  name: "Мирра Искра",
  race: "Тифлинг",
  cls: "Волшебница",
  level: 1,
  maxHp: 8,
  ac: 11,
  speed: 30,
  abilities: { str: 8, dex: 13, con: 14, int: 16, wis: 12, cha: 12 },
  saves: ["int", "wis"],
  skills: ["arcana", "history", "investigation", "insight"],
  attacks: [
    { name: "Огненный снаряд", bonus: 5, damage: "1d10", note: "120 фт, огонь" },
    { name: "Кинжал", bonus: 3, damage: "1d4+1", note: "рукопашная или метательная 20/60 фт" },
  ],
  features: ["Тёмное зрение 60 фт", "Сопротивление огню", "Магическое восстановление", "Ячейки заклинаний 1-го круга: 2", "СЛ заклинаний 13"],
  equipment: ["Книга заклинаний", "Посох-фокус", "Кинжал", "Сумка с компонентами", "Свиток с картой катакомб (неполной)"],
  spells: ["Огненный снаряд", "Свет", "Волшебная рука", "Волшебная стрела", "Щит", "Усыпление", "Доспехи мага"],
  story: "Изгнана из академии за чтение запретных трактатов о звуковой магии. Колокол — её шанс доказать правоту.",
};

const tiran: HeroSheet = {
  id: "tiran",
  name: "Тиран",
  race: "Полуорк",
  cls: "Варвар",
  level: 1,
  maxHp: 14,
  ac: 13,
  speed: 30,
  abilities: { str: 17, dex: 13, con: 15, int: 8, wis: 12, cha: 10 },
  saves: ["str", "con"],
  skills: ["athletics", "survival", "intimidation", "perception"],
  attacks: [
    { name: "Секира", bonus: 5, damage: "1d12+3", note: "двуручная, рубящий; в ярости +2 урона" },
    { name: "Метательное копьё", bonus: 5, damage: "1d6+3", note: "метательное 30/120 фт" },
  ],
  features: ["Ярость 2 раза в день: +2 урона, сопротивление физическому урону", "Защита без доспехов", "Тёмное зрение 60 фт", "Непоколебимая стойкость", "Свирепые атаки"],
  equipment: ["Секира", "4 метательных копья", "Набор путешественника", "Амулет из клыка вепря"],
  story: "Нанят часовней охранять паломников. Паломники пропали, плата — нет. Тиран хочет разобраться.",
};

const grom: HeroSheet = {
  id: "grom",
  name: "Гром Дарвин",
  race: "Холмовой дварф",
  cls: "Воин",
  level: 1,
  maxHp: 14,
  ac: 19,
  speed: 25,
  abilities: { str: 15, dex: 13, con: 16, int: 8, wis: 13, cha: 10 },
  saves: ["str", "con"],
  skills: ["athletics", "intimidation", "perception", "survival"],
  attacks: [
    { name: "Боевой топор", bonus: 4, damage: "1d8+2", note: "рукопашная, рубящий" },
    { name: "Ручной топор", bonus: 4, damage: "1d6+2", note: "метательный 20/60 фт" },
  ],
  features: ["Боевой стиль: Защита (+1 КД)", "Второе дыхание: 1к10+1 хитов, раз в отдых", "Тёмное зрение 60 фт", "Дварфийская устойчивость к яду", "Знание камня"],
  equipment: ["Кольчуга", "Щит", "Боевой топор", "2 ручных топора", "Кирка горняка"],
  story: "Строил своды под Сольгардом сорок лет назад и помнит, что колокол тогда был целым.",
};

export const BUILT_IN_ADVENTURES: AdventureSummary[] = [
  {
    id: "solgard-bell",
    title: "Колокол под Сольгардом",
    summary: "Под заброшенной часовней гудит треснувший колокол, и с каждым ударом из катакомб возвращаются мёртвые. Найдите, кто звонит.",
    level: 1,
    length: "Ваншот · 3–4 часа",
    scenes: ["Таверна «Ржавый якорь»", "Дорога к часовне", "Катакомбы, зал колокола", "Склеп настоятеля", "Святилище культа", "Развязка"],
    heroes: [ilva, osmund, mirra, tiran, grom],
  },
];

export function findAdventure(id: string | null | undefined): AdventureSummary | undefined {
  return BUILT_IN_ADVENTURES.find(adventure => adventure.id === id);
}

export function findHero(adventureId: string | null | undefined, heroId: string | null | undefined): HeroSheet | undefined {
  return findAdventure(adventureId)?.heroes.find(hero => hero.id === heroId);
}
