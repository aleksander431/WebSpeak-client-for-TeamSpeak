import type { AdventureSummary, HeroSheet, MonsterSheet } from "./tabletop.js";

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


// SRD 5.1 creatures (names and texts in Russian).
const MONSTERS: MonsterSheet[] = [
  {
    id: "skeleton", name: "Скелет", cr: "1/4", maxHp: 13, ac: 13, speed: 30, dex: 14,
    attacks: [
      { name: "Короткий меч", bonus: 4, damage: "1d6+2", note: "рукопашная, колющий" },
      { name: "Короткий лук", bonus: 4, damage: "1d6+2", note: "дальнобойная 80/320 фт, колющий" },
    ],
    traits: ["Уязвимость к дробящему урону", "Иммунитет к яду и истощению", "Тёмное зрение 60 фт"],
  },
  {
    id: "zombie", name: "Зомби", cr: "1/4", maxHp: 22, ac: 8, speed: 20, dex: 6,
    attacks: [{ name: "Удар", bonus: 3, damage: "1d6+1", note: "рукопашная, дробящий" }],
    traits: ["Стойкость нежити: при падении до 0 хитов спасбросок Телосложения СЛ 5 + урон, при успехе остаётся 1 хит (не от излучения и не от крита)", "Иммунитет к яду", "Тёмное зрение 60 фт"],
  },
  {
    id: "giant-rat", name: "Гигантская крыса", cr: "1/8", maxHp: 7, ac: 12, speed: 30, dex: 15,
    attacks: [{ name: "Укус", bonus: 4, damage: "1d4+2", note: "рукопашная, колющий" }],
    traits: ["Тактика стаи: преимущество, если союзник рядом с целью", "Острый нюх", "Тёмное зрение 60 фт"],
  },
  {
    id: "ghoul", name: "Упырь", cr: "1", maxHp: 22, ac: 12, speed: 30, dex: 15,
    attacks: [
      { name: "Укус", bonus: 2, damage: "2d6+2", note: "рукопашная, колющий" },
      { name: "Когти", bonus: 4, damage: "2d4+2", note: "рукопашная, рубящий; спасбросок Телосложения СЛ 10 или паралич на 1 минуту (не эльфы и не нежить)" },
    ],
    traits: ["Иммунитет к яду и очарованию", "Тёмное зрение 60 фт"],
  },
  {
    id: "specter", name: "Призрак", cr: "1", maxHp: 22, ac: 12, speed: 50, dex: 14,
    attacks: [{ name: "Вытягивание жизни", bonus: 4, damage: "3d6", note: "рукопашная, некротический; спасбросок Телосложения СЛ 10, иначе максимум хитов уменьшается на урон" }],
    traits: ["Летает и проходит сквозь стены", "Сопротивление обычному оружию, кислоте, огню, грому, молнии", "Чувствительность к солнцу: помеха на атаки и проверки Мудрости (Внимательность)"],
  },
  {
    id: "cultist", name: "Культист", cr: "1/8", maxHp: 9, ac: 12, speed: 30, dex: 12,
    attacks: [{ name: "Скимитар", bonus: 3, damage: "1d6+1", note: "рукопашная, рубящий" }],
    traits: ["Тёмная преданность: преимущество на спасброски от очарования и испуга"],
  },
  {
    id: "cult-fanatic", name: "Фанатик культа", cr: "2", maxHp: 33, ac: 13, speed: 30, dex: 14,
    attacks: [
      { name: "Кинжал", bonus: 4, damage: "1d4+2", note: "две атаки за ход, рукопашная или метательная 20/60 фт" },
      { name: "Священное пламя", bonus: null, damage: "1d8", note: "60 фт, спасбросок Ловкости СЛ 11, излучение" },
      { name: "Духовное оружие", bonus: 4, damage: "1d8+2", note: "бонусное действие, 60 фт, силовое поле" },
    ],
    traits: ["Тёмная преданность", "Заклинания (СЛ 11): удержание личности, щит веры, нанесение ран, приказ", "Ячейки: 1-й круг 4, 2-й круг 3"],
  },
];

const ART = "/dnd/solgard-bell";

export const BUILT_IN_ADVENTURES: AdventureSummary[] = [
  {
    id: "solgard-bell",
    title: "Колокол под Сольгардом",
    summary: "Под заброшенной часовней гудит треснувший колокол, и с каждым ударом из катакомб возвращаются мёртвые. Найдите, кто звонит.",
    level: 1,
    length: "Ваншот · 3–4 часа",
    scenes: [
      { id: "tavern", title: "Таверна «Ржавый якорь»", art: `${ART}/art-tavern.webp` },
      { id: "road", title: "Дорога к часовне", art: `${ART}/art-road.webp` },
      { id: "bell-hall", title: "Катакомбы, зал колокола", map: { image: `${ART}/map-bell-hall.webp`, cols: 24, rows: 16, spawn: [[11, 15], [12, 15], [10, 15], [13, 15], [11, 14], [12, 14]] } },
      { id: "crypt", title: "Склеп настоятеля", map: { image: `${ART}/map-crypt.webp`, cols: 24, rows: 16, spawn: [[11, 15], [12, 15], [11, 14], [12, 14], [10, 15], [13, 15]] } },
      { id: "sanctum", title: "Святилище культа", map: { image: `${ART}/map-sanctum.webp`, cols: 24, rows: 16, spawn: [[2, 5], [3, 5], [2, 6], [3, 6], [4, 5], [4, 6]] } },
      { id: "finale", title: "Развязка", art: `${ART}/art-finale.webp` },
    ],
    heroes: [ilva, osmund, mirra, tiran, grom].map(hero => ({ ...hero, portrait: `${ART}/hero-${hero.id}.webp` })),
    monsters: MONSTERS.map(monster => ({ ...monster, portrait: `${ART}/monster-${monster.id}.webp` })),
  },
];

export function findAdventure(id: string | null | undefined): AdventureSummary | undefined {
  return BUILT_IN_ADVENTURES.find(adventure => adventure.id === id);
}

export function findHero(adventureId: string | null | undefined, heroId: string | null | undefined): HeroSheet | undefined {
  return findAdventure(adventureId)?.heroes.find(hero => hero.id === heroId);
}

export function findMonster(adventureId: string | null | undefined, monsterId: string | null | undefined): MonsterSheet | undefined {
  return findAdventure(adventureId)?.monsters.find(monster => monster.id === monsterId);
}
