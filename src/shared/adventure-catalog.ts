import type { MonsterSheet } from "./tabletop.js";
import type { RaceId } from "./hero-builder.js";

/*
 * The adventure editor's library: SRD 5.1 monsters with stat blocks, items,
 * battle maps, scene pictures and extra hero portraits. Pictures were made
 * with Z-Image Turbo on the owner's ComfyUI and live under
 * `web/public/dnd/library/`. Browser-safe: the editor page and the gateway
 * (which copies chosen pictures into a published adventure) share it.
 */

export const LIBRARY_ROOT = "/dnd/library";

export type LibraryKind = "monster" | "item" | "map" | "scene" | "portrait";

/** Where a library picture is served from. */
export function libraryUrl(kind: LibraryKind, id: string): string {
  if (kind === "portrait") return `/dnd/portraits/${id}.webp`;
  return `${LIBRARY_ROOT}/${kind}s/${id}.webp`;
}

// ---- Monsters (SRD 5.1) ------------------------------------------------------

type CatalogMonster = Omit<MonsterSheet, "portrait">;

export const CATALOG_MONSTERS: CatalogMonster[] = [
  {
    id: "goblin", name: "Гоблин", cr: "1/4", maxHp: 7, ac: 15, speed: 30, dex: 14,
    attacks: [
      { name: "Скимитар", bonus: 4, damage: "1d6+2", note: "рукопашная, рубящий" },
      { name: "Короткий лук", bonus: 4, damage: "1d6+2", note: "дальнобойная 80/320 фт, колющий" },
    ],
    traits: ["Проворный побег: отход или засада бонусным действием", "Тёмное зрение 60 фт"],
  },
  {
    id: "hobgoblin", name: "Хобгоблин", cr: "1/2", maxHp: 11, ac: 18, speed: 30, dex: 12,
    attacks: [
      { name: "Длинный меч", bonus: 3, damage: "1d8+1", note: "рукопашная, рубящий (1к10+1 двумя руками)" },
      { name: "Длинный лук", bonus: 3, damage: "1d8+1", note: "дальнобойная 150/600 фт, колющий" },
    ],
    traits: ["Воинское превосходство: раз в ход +2к6 урона, если союзник рядом с целью", "Тёмное зрение 60 фт"],
  },
  {
    id: "bugbear", name: "Багбир", cr: "1", maxHp: 27, ac: 16, speed: 30, dex: 14,
    attacks: [
      { name: "Моргенштерн", bonus: 4, damage: "2d8+2", note: "рукопашная, колющий" },
      { name: "Метательное копьё", bonus: 4, damage: "1d6+2", note: "метательная 30/120 фт, колющий (2к6+2 вблизи)" },
    ],
    traits: ["Громила: лишняя кость урона оружием вблизи (уже учтена)", "Внезапная атака: +2к6 по застигнутому врасплох в первом раунде", "Тёмное зрение 60 фт"],
  },
  {
    id: "kobold", name: "Кобольд", cr: "1/8", maxHp: 5, ac: 12, speed: 30, dex: 15,
    attacks: [
      { name: "Кинжал", bonus: 4, damage: "1d4+2", note: "рукопашная, колющий" },
      { name: "Праща", bonus: 4, damage: "1d4+2", note: "дальнобойная 30/120 фт, дробящий" },
    ],
    traits: ["Тактика стаи: преимущество, если союзник рядом с целью", "Чувствительность к солнцу: помеха на атаки и Внимательность на свету", "Тёмное зрение 60 фт"],
  },
  {
    id: "orc", name: "Орк", cr: "1/2", maxHp: 15, ac: 13, speed: 30, dex: 12,
    attacks: [
      { name: "Секира", bonus: 5, damage: "1d12+3", note: "рукопашная, рубящий" },
      { name: "Метательное копьё", bonus: 5, damage: "1d6+3", note: "рукопашная или метательная 30/120 фт, колющий" },
    ],
    traits: ["Агрессивный: бонусным действием двигается к врагу на свою скорость", "Тёмное зрение 60 фт"],
  },
  {
    id: "gnoll", name: "Гнолл", cr: "1/2", maxHp: 22, ac: 15, speed: 30, dex: 12,
    attacks: [
      { name: "Укус", bonus: 4, damage: "1d4+2", note: "рукопашная, колющий" },
      { name: "Копьё", bonus: 4, damage: "1d6+2", note: "рукопашная или метательная 20/60 фт, колющий" },
      { name: "Длинный лук", bonus: 3, damage: "1d8+1", note: "дальнобойная 150/600 фт, колющий" },
    ],
    traits: ["Буйство: уронив врага до 0 хитов, бонусным действием двигается на половину скорости и кусает", "Тёмное зрение 60 фт"],
  },
  {
    id: "bandit", name: "Разбойник", cr: "1/8", maxHp: 11, ac: 12, speed: 30, dex: 12,
    attacks: [
      { name: "Скимитар", bonus: 3, damage: "1d6+1", note: "рукопашная, рубящий" },
      { name: "Лёгкий арбалет", bonus: 3, damage: "1d8+1", note: "дальнобойная 80/320 фт, колющий" },
    ],
    traits: [],
  },
  {
    id: "bandit-captain", name: "Главарь разбойников", cr: "2", maxHp: 65, ac: 15, speed: 30, dex: 16,
    saves: { str: 4, dex: 5, wis: 2 },
    attacks: [
      { name: "Скимитар", bonus: 5, damage: "1d6+3", note: "три атаки за ход: два скимитара и кинжал; рукопашная, рубящий" },
      { name: "Кинжал", bonus: 5, damage: "1d4+3", note: "рукопашная или метательная 20/60 фт, колющий" },
    ],
    traits: ["Парирование: реакцией +2 к КД против одной рукопашной атаки"],
  },
  {
    id: "thug", name: "Головорез", cr: "1/2", maxHp: 32, ac: 11, speed: 30, dex: 11,
    attacks: [
      { name: "Булава", bonus: 4, damage: "1d6+2", note: "две атаки за ход, рукопашная, дробящий" },
      { name: "Тяжёлый арбалет", bonus: 2, damage: "1d10", note: "дальнобойная 100/400 фт, колющий" },
    ],
    traits: ["Тактика стаи: преимущество, если союзник рядом с целью"],
  },
  {
    id: "guard", name: "Стражник", cr: "1/8", maxHp: 11, ac: 16, speed: 30, dex: 12,
    attacks: [{ name: "Копьё", bonus: 3, damage: "1d6+1", note: "рукопашная или метательная 20/60 фт, колющий" }],
    traits: [],
  },
  {
    id: "veteran", name: "Ветеран", cr: "3", maxHp: 58, ac: 17, speed: 30, dex: 13,
    attacks: [
      { name: "Длинный меч", bonus: 5, damage: "1d8+3", note: "две атаки длинным мечом и одна коротким за ход; рукопашная, рубящий" },
      { name: "Короткий меч", bonus: 5, damage: "1d6+3", note: "рукопашная, колющий" },
      { name: "Тяжёлый арбалет", bonus: 3, damage: "1d10+1", note: "дальнобойная 100/400 фт, колющий" },
    ],
    traits: [],
  },
  {
    id: "acolyte", name: "Послушник", cr: "1/4", maxHp: 9, ac: 10, speed: 30, dex: 10,
    attacks: [
      { name: "Дубинка", bonus: 2, damage: "1d4", note: "рукопашная, дробящий" },
      { name: "Священное пламя", bonus: null, damage: "1d8", note: "заговор, 60 фт, излучение", save: { ability: "dex", dc: 12, half: false } },
    ],
    traits: ["Заклинания: Лечение ран (3 раза), Благословение, Святилище"],
  },
  {
    id: "wolf", name: "Волк", cr: "1/4", maxHp: 11, ac: 13, speed: 40, dex: 15,
    attacks: [{ name: "Укус", bonus: 4, damage: "2d4+2", note: "рукопашная, колющий; спасбросок Силы СЛ 11, иначе сбит с ног" }],
    traits: ["Острый слух и нюх", "Тактика стаи: преимущество, если союзник рядом с целью"],
  },
  {
    id: "dire-wolf", name: "Лютоволк", cr: "1", maxHp: 37, ac: 14, speed: 50, dex: 15,
    attacks: [{ name: "Укус", bonus: 5, damage: "2d6+3", note: "рукопашная, колющий; спасбросок Силы СЛ 13, иначе сбит с ног" }],
    traits: ["Острый слух и нюх", "Тактика стаи: преимущество, если союзник рядом с целью"],
  },
  {
    id: "giant-spider", name: "Гигантский паук", cr: "1", maxHp: 26, ac: 14, speed: 30, dex: 16,
    attacks: [
      { name: "Укус", bonus: 5, damage: "1d8+3", note: "рукопашная, колющий, плюс 2к8 ядом (спасбросок Телосложения СЛ 11 — половина)" },
    ],
    traits: ["Паутина (перезарядка 5–6): дальнобойная атака +5, 30/60 фт, цель опутана (Сила СЛ 12, чтобы вырваться)", "Паучье лазание", "Чувство паутины", "Хождение по паутине", "Слепое зрение 10 фт, тёмное зрение 60 фт"],
  },
  {
    id: "brown-bear", name: "Бурый медведь", cr: "1", maxHp: 34, ac: 11, speed: 40, dex: 10,
    attacks: [
      { name: "Укус", bonus: 6, damage: "1d8+4", note: "укус и когти за ход; рукопашная, колющий" },
      { name: "Когти", bonus: 6, damage: "2d6+4", note: "рукопашная, рубящий" },
    ],
    traits: ["Острый нюх", "Лазает 30 фт"],
  },
  {
    id: "swarm-of-rats", name: "Рой крыс", cr: "1/4", maxHp: 24, ac: 10, speed: 30, dex: 11,
    attacks: [{ name: "Укусы", bonus: 2, damage: "2d6", note: "рукопашная по существу в пространстве роя, колющий (1к6, если у роя половина хитов или меньше)" }],
    traits: ["Рой: занимает чужое пространство, лечиться не может", "Сопротивление дробящему, колющему и рубящему", "Острый нюх", "Тёмное зрение 30 фт"],
  },
  {
    id: "stirge", name: "Стирж", cr: "1/8", maxHp: 2, ac: 14, speed: 10, dex: 16,
    attacks: [{ name: "Высасывание крови", bonus: 5, damage: "1d4+3", note: "рукопашная, колющий; присасывается и каждый ход отнимает 1к4+3 хита" }],
    traits: ["Летает 40 фт", "Тёмное зрение 60 фт"],
  },
  {
    id: "giant-centipede", name: "Гигантская многоножка", cr: "1/4", maxHp: 4, ac: 13, speed: 30, dex: 14,
    attacks: [{ name: "Укус", bonus: 4, damage: "1d4+2", note: "рукопашная, колющий; спасбросок Телосложения СЛ 11 или 3к6 ядом" }],
    traits: ["Лазает 30 фт", "Слепое зрение 30 фт"],
  },
  {
    id: "owlbear", name: "Совомедведь", cr: "3", maxHp: 59, ac: 13, speed: 40, dex: 12,
    attacks: [
      { name: "Клюв", bonus: 7, damage: "1d10+5", note: "клюв и когти за ход; рукопашная, колющий" },
      { name: "Когти", bonus: 7, damage: "2d8+5", note: "рукопашная, рубящий" },
    ],
    traits: ["Острое зрение и нюх", "Тёмное зрение 60 фт"],
  },
  {
    id: "ogre", name: "Огр", cr: "2", maxHp: 59, ac: 11, speed: 40, dex: 8,
    attacks: [
      { name: "Палица", bonus: 6, damage: "2d8+4", note: "рукопашная, дробящий" },
      { name: "Метательное копьё", bonus: 6, damage: "2d6+4", note: "рукопашная или метательная 30/120 фт, колющий" },
    ],
    traits: ["Тёмное зрение 60 фт"],
  },
  {
    id: "troll", name: "Тролль", cr: "5", maxHp: 84, ac: 15, speed: 30, dex: 13,
    attacks: [
      { name: "Укус", bonus: 7, damage: "1d6+4", note: "укус и два удара когтями за ход; рукопашная, колющий" },
      { name: "Когти", bonus: 7, damage: "2d6+4", note: "рукопашная, рубящий" },
    ],
    traits: ["Регенерация: 10 хитов в начале хода, если не получил урон кислотой или огнём; умирает, только начав ход с 0 хитов без регенерации", "Острый нюх", "Тёмное зрение 60 фт"],
  },
  {
    id: "minotaur", name: "Минотавр", cr: "3", maxHp: 76, ac: 14, speed: 40, dex: 11,
    attacks: [
      { name: "Секира", bonus: 6, damage: "2d12+4", note: "рукопашная, рубящий" },
      { name: "Рога", bonus: 6, damage: "2d8+4", note: "рукопашная, колющий" },
    ],
    traits: ["Атака с разбега: пробежав 10 фт прямо и попав рогами, +2к8 и спасбросок Силы СЛ 14, иначе отброшен на 10 фт и сбит с ног", "Безупречная память лабиринтов", "Безрассудство: в начале хода может получить преимущество на атаки, тогда атаки по нему тоже с преимуществом", "Тёмное зрение 60 фт"],
  },
  {
    id: "gargoyle", name: "Горгулья", cr: "2", maxHp: 52, ac: 15, speed: 30, dex: 11,
    attacks: [
      { name: "Укус", bonus: 4, damage: "1d6+2", note: "укус и когти за ход; рукопашная, колющий" },
      { name: "Когти", bonus: 4, damage: "1d6+2", note: "рукопашная, рубящий" },
    ],
    traits: ["Летает 60 фт", "Обманчивая внешность: неподвижная, неотличима от статуи", "Сопротивление обычному оружию", "Иммунитет к яду, истощению и окаменению", "Тёмное зрение 60 фт"],
  },
  {
    id: "wight", name: "Умертвие", cr: "3", maxHp: 45, ac: 14, speed: 30, dex: 14,
    attacks: [
      { name: "Длинный меч", bonus: 4, damage: "1d8+2", note: "две атаки за ход (одну можно заменить вытягиванием жизни); рукопашная, рубящий" },
      { name: "Вытягивание жизни", bonus: 4, damage: "1d6+2", note: "рукопашная, некротический; спасбросок Телосложения СЛ 13, иначе максимум хитов уменьшается на урон" },
      { name: "Длинный лук", bonus: 4, damage: "1d8+2", note: "дальнобойная 150/600 фт, колющий" },
    ],
    traits: ["Сопротивление обычному оружию (не серебряному)", "Иммунитет к яду", "Чувствительность к солнцу", "Тёмное зрение 60 фт"],
  },
  {
    id: "ghost", name: "Привидение", cr: "4", maxHp: 45, ac: 11, speed: 0, dex: 13,
    attacks: [{ name: "Иссушающее касание", bonus: 5, damage: "4d6+3", note: "рукопашная, некротический" }],
    traits: ["Летает 40 фт и проходит сквозь стены", "Ужасающий облик: спасбросок Мудрости СЛ 13 или испуган на минуту", "Одержимость: может вселиться в человека (Харизма СЛ 13)", "Сопротивление обычному оружию, кислоте, огню, грому, молнии", "Иммунитет к холоду, некротическому и яду", "Тёмное зрение 60 фт"],
  },
  {
    id: "mummy", name: "Мумия", cr: "3", maxHp: 58, ac: 11, speed: 20, dex: 8,
    saves: { wis: 2 },
    attacks: [{ name: "Гниющий кулак", bonus: 5, damage: "2d6+3", note: "рукопашная, дробящий плюс 3к6 некротическим; спасбросок Телосложения СЛ 12 или проклятие гниения" }],
    traits: ["Жуткий взгляд: спасбросок Мудрости СЛ 11 или испуган до конца её следующего хода", "Уязвимость к огню", "Сопротивление обычному оружию", "Иммунитет к некротическому и яду", "Тёмное зрение 60 фт"],
  },
  {
    id: "shadow", name: "Тень", cr: "1/2", maxHp: 16, ac: 12, speed: 40, dex: 14,
    attacks: [{ name: "Вытягивание силы", bonus: 4, damage: "2d6+2", note: "рукопашная, некротический; Сила цели уменьшается на 1к4 до отдыха (на 0 — смерть)" }],
    traits: ["Аморфная: проходит в щели шириной в дюйм", "Скрытность в тени: засада бонусным действием в темноте", "Слабость на свету: помеха на атаки и проверки", "Уязвимость к излучению", "Тёмное зрение 60 фт"],
  },
  {
    id: "imp", name: "Бес", cr: "1", maxHp: 10, ac: 13, speed: 20, dex: 17,
    attacks: [{ name: "Жало", bonus: 5, damage: "1d4+3", note: "рукопашная, колющий плюс 3к6 ядом (спасбросок Телосложения СЛ 11 — половина)" }],
    traits: ["Летает 40 фт", "Невидимость по желанию", "Превращение в крысу, ворона или паука", "Видит в магической тьме", "Сопротивление к магии: преимущество на спасброски от заклинаний", "Сопротивление обычному оружию (не серебряному), холоду"],
  },
  {
    id: "quasit", name: "Квазит", cr: "1", maxHp: 7, ac: 13, speed: 40, dex: 17,
    attacks: [{ name: "Когти", bonus: 4, damage: "1d4+3", note: "рукопашная, колющий; спасбросок Телосложения СЛ 10 или 2к4 ядом и отравлен на минуту" }],
    traits: ["Невидимость по желанию", "Пугающий облик раз в день: Мудрость СЛ 10 или испуган", "Превращение в летучую мышь, многоножку или жабу", "Сопротивление к магии", "Сопротивление обычному оружию, холоду, огню, молнии"],
  },
  {
    id: "harpy", name: "Гарпия", cr: "1", maxHp: 38, ac: 11, speed: 20, dex: 13,
    attacks: [
      { name: "Когти", bonus: 3, damage: "2d4+1", note: "когти и дубина за ход; рукопашная, рубящий" },
      { name: "Дубина", bonus: 3, damage: "1d4+1", note: "рукопашная, дробящий" },
    ],
    traits: ["Летает 40 фт", "Манящая песня: спасбросок Мудрости СЛ 11, иначе очарован и идёт к гарпии"],
  },
  {
    id: "lizardfolk", name: "Людоящер", cr: "1/2", maxHp: 22, ac: 15, speed: 30, dex: 10,
    attacks: [
      { name: "Укус", bonus: 4, damage: "1d6+2", note: "две разные атаки за ход; рукопашная, колющий" },
      { name: "Тяжёлая дубина", bonus: 4, damage: "1d6+2", note: "рукопашная, дробящий" },
      { name: "Метательное копьё", bonus: 4, damage: "1d6+2", note: "метательная 30/120 фт, колющий" },
    ],
    traits: ["Плавает 30 фт", "Задерживает дыхание на 15 минут"],
  },
  {
    id: "gelatinous-cube", name: "Студенистый куб", cr: "2", maxHp: 84, ac: 6, speed: 15, dex: 3,
    attacks: [
      { name: "Ложноножка", bonus: 4, damage: "3d6", note: "рукопашная, кислота" },
      { name: "Поглощение", bonus: null, damage: "3d6", note: "куб входит в клетки существ: кислота, существо поглощено", save: { ability: "dex", dc: 12, half: false } },
    ],
    traits: ["Прозрачный: заметить неподвижный куб — Внимательность СЛ 15", "Поглощённые получают 6к6 кислотой в начале хода куба", "Иммунитет к ослеплению, очарованию, глухоте, истощению, испугу, сбиванию с ног", "Слепое зрение 60 фт"],
  },
  {
    id: "mimic", name: "Мимик", cr: "2", maxHp: 58, ac: 12, speed: 15, dex: 12,
    attacks: [
      { name: "Ложноножка", bonus: 5, damage: "1d8+3", note: "рукопашная, дробящий; цель приклеена (схвачена, СЛ 13)" },
      { name: "Укус", bonus: 5, damage: "1d8+3", note: "рукопашная, колющий плюс 1к8 кислотой" },
    ],
    traits: ["Превращение в предмет (сундук, дверь)", "Клейкий: прилипает ко всему, что его касается", "Обманчивая внешность", "Преимущество на атаки по схваченным", "Иммунитет к кислоте и сбиванию с ног", "Тёмное зрение 60 фт"],
  },
  {
    id: "animated-armor", name: "Оживлённые доспехи", cr: "1", maxHp: 33, ac: 18, speed: 25, dex: 11,
    attacks: [{ name: "Удар", bonus: 4, damage: "1d6+2", note: "две атаки за ход, рукопашная, дробящий" }],
    traits: ["Восприимчивость к антимагии", "Обманчивая внешность: неподвижные — обычные доспехи", "Иммунитет к яду, психическому урону и большинству состояний", "Слепое зрение 60 фт"],
  },
  {
    id: "will-o-wisp", name: "Блуждающий огонёк", cr: "2", maxHp: 22, ac: 19, speed: 0, dex: 28,
    attacks: [{ name: "Разряд", bonus: 4, damage: "2d8", note: "рукопашная, электричество" }],
    traits: ["Летает 50 фт (парит)", "Невидимость по желанию", "Поглощение жизни: бонусным действием добивает существо с 0 хитов (Телосложение СЛ 10)", "Сопротивление обычному оружию, кислоте, холоду, огню, некротическому, грому", "Иммунитет к электричеству и яду"],
  },
  {
    id: "red-dragon-wyrmling", name: "Вирмлинг красного дракона", cr: "4", maxHp: 75, ac: 17, speed: 30, dex: 10,
    saves: { dex: 2, con: 5, wis: 2, cha: 4 },
    attacks: [
      { name: "Укус", bonus: 6, damage: "1d10+4", note: "рукопашная, колющий плюс 1к6 огнём" },
      { name: "Огненное дыхание", bonus: null, damage: "7d6", note: "перезарядка 5–6, конус 15 фт, огонь", save: { ability: "dex", dc: 13, half: true } },
    ],
    traits: ["Летает 60 фт, лазает 30 фт", "Иммунитет к огню", "Слепое зрение 10 фт, тёмное зрение 60 фт"],
  },
  {
    id: "basilisk", name: "Василиск", cr: "3", maxHp: 52, ac: 15, speed: 20, dex: 8,
    attacks: [{ name: "Укус", bonus: 5, damage: "2d6+3", note: "рукопашная, колющий плюс 2к6 ядом" }],
    traits: ["Окаменяющий взгляд: начав ход в 30 фт и видя глаза василиска, спасбросок Телосложения СЛ 12 — при провале существо начинает каменеть", "Тёмное зрение 60 фт"],
  },
  {
    id: "werewolf", name: "Вервольф", cr: "3", maxHp: 58, ac: 12, speed: 30, dex: 13,
    attacks: [
      { name: "Укус", bonus: 4, damage: "1d8+2", note: "укус и когти за ход; рукопашная, колющий; спасбросок Телосложения СЛ 12 или проклятие ликантропии" },
      { name: "Когти", bonus: 4, damage: "2d4+2", note: "рукопашная, рубящий" },
    ],
    traits: ["Превращение в волка и обратно", "Острый слух и нюх", "Иммунитет к обычному оружию (не серебряному)"],
  },
  {
    id: "doppelganger", name: "Доппельгангер", cr: "3", maxHp: 52, ac: 14, speed: 30, dex: 18,
    attacks: [{ name: "Удар", bonus: 6, damage: "1d6+4", note: "две атаки за ход, рукопашная, дробящий" }],
    traits: ["Превращение в любого гуманоида, которого видел", "Чтение мыслей в 60 фт", "Засада: преимущество на атаки по застигнутым врасплох, при попадании +3к6", "Иммунитет к очарованию", "Тёмное зрение 60 фт"],
  },
  {
    id: "ettercap", name: "Эттеркап", cr: "2", maxHp: 44, ac: 13, speed: 30, dex: 15,
    attacks: [
      { name: "Укус", bonus: 4, damage: "1d8+2", note: "укус и когти за ход; рукопашная, колющий плюс 1к8 ядом; спасбросок Телосложения СЛ 11 или отравлен на минуту" },
      { name: "Когти", bonus: 4, damage: "2d4+2", note: "рукопашная, рубящий" },
    ],
    traits: ["Паутина (перезарядка 5–6): дальнобойная атака +4, 30/60 фт, цель опутана (Сила СЛ 11)", "Паучье лазание", "Чувство паутины", "Хождение по паутине", "Тёмное зрение 60 фт"],
  },
];

// ---- Items ---------------------------------------------------------------------

export type ItemKind = "potion" | "gear" | "weapon" | "armor" | "magic" | "treasure" | "quest";

export interface CatalogItem {
  id: string;
  name: [string, string];
  kind: ItemKind;
  /** Price in gold, 0 when it has none (quest items). */
  gp: number;
  text: [string, string];
}

export const CATALOG_ITEMS: CatalogItem[] = [
  { id: "healing-potion", name: ["Зелье лечения", "Potion of healing"], kind: "potion", gp: 50, text: ["Выпить (действие): восстанавливает 2к4+2 хита.", "Drink it (action) to regain 2d4 + 2 hit points."] },
  { id: "greater-healing-potion", name: ["Зелье большого лечения", "Potion of greater healing"], kind: "potion", gp: 150, text: ["Выпить (действие): восстанавливает 4к4+4 хита.", "Drink it (action) to regain 4d4 + 4 hit points."] },
  { id: "antitoxin", name: ["Противоядие", "Antitoxin"], kind: "potion", gp: 50, text: ["Час преимущества на спасброски от яда.", "Advantage on saves against poison for an hour."] },
  { id: "holy-water", name: ["Святая вода", "Holy water"], kind: "gear", gp: 25, text: ["Бросить во врага (дальнобойная атака, 20 фт): нежить и исчадия получают 2к6 излучением.", "Throw it (ranged attack, 20 ft): undead and fiends take 2d6 radiant."] },
  { id: "alchemists-fire", name: ["Алхимический огонь", "Alchemist's fire"], kind: "gear", gp: 50, text: ["Бросить (20 фт): цель горит, 1к4 огнём в начале каждого хода, пока не потушат (Ловкость СЛ 10).", "Throw it (20 ft): the target burns for 1d4 fire each turn until put out (DC 10 Dexterity)."] },
  { id: "spell-scroll", name: ["Свиток заклинания", "Spell scroll"], kind: "magic", gp: 50, text: ["Заклинание на свитке: прочитавший его заклинатель может сотворить его один раз.", "A spell written down: a caster who reads it may cast it once."] },
  { id: "rope", name: ["Пеньковая верёвка, 50 фт", "Hempen rope, 50 ft"], kind: "gear", gp: 1, text: ["Выдерживает 2 хита урона, порвать — Сила СЛ 17.", "Has 2 hit points; bursting it takes DC 17 Strength."] },
  { id: "torch", name: ["Факел", "Torch"], kind: "gear", gp: 0, text: ["Горит час: яркий свет 20 фт, тусклый ещё 20 фт.", "Burns for an hour: bright light 20 ft, dim light 20 ft more."] },
  { id: "lantern", name: ["Фонарь с колпаком", "Hooded lantern"], kind: "gear", gp: 5, text: ["Яркий свет 30 фт, тусклый ещё 30 фт; 6 часов на пинту масла.", "Bright light 30 ft, dim 30 ft more; 6 hours on a pint of oil."] },
  { id: "thieves-tools", name: ["Воровские инструменты", "Thieves' tools"], kind: "gear", gp: 25, text: ["Вскрыть замок или обезвредить ловушку (проверка Ловкости).", "Pick locks and disarm traps (Dexterity check)."] },
  { id: "healers-kit", name: ["Набор целителя", "Healer's kit"], kind: "gear", gp: 5, text: ["10 применений: стабилизировать умирающего без проверки.", "10 uses: stabilise a dying creature without a check."] },
  { id: "rations", name: ["Рацион на день", "Rations (1 day)"], kind: "gear", gp: 0, text: ["Сухари, вяленое мясо, сыр и сухофрукты.", "Hard bread, dried meat, cheese and dried fruit."] },
  { id: "crowbar", name: ["Ломик", "Crowbar"], kind: "gear", gp: 2, text: ["Преимущество на проверки Силы, где помогает рычаг.", "Advantage on Strength checks where leverage helps."] },
  { id: "dagger", name: ["Кинжал", "Dagger"], kind: "weapon", gp: 2, text: ["1к4 колющий, лёгкое, фехтовальное, метательное 20/60 фт.", "1d4 piercing; light, finesse, thrown 20/60 ft."] },
  { id: "longsword-plus-one", name: ["Длинный меч +1", "Longsword +1"], kind: "magic", gp: 500, text: ["Магический: +1 к атаке и урону. 1к8 рубящий (1к10 двумя руками).", "Magic: +1 to attack and damage. 1d8 slashing (1d10 two-handed)."] },
  { id: "longbow", name: ["Длинный лук", "Longbow"], kind: "weapon", gp: 50, text: ["1к8 колющий, дальнобойное 150/600 фт, двуручное.", "1d8 piercing, range 150/600 ft, two-handed."] },
  { id: "shield", name: ["Щит", "Shield"], kind: "armor", gp: 10, text: ["+2 к КД.", "+2 AC."] },
  { id: "chain-mail", name: ["Кольчуга", "Chain mail"], kind: "armor", gp: 75, text: ["Тяжёлый доспех: КД 16, нужна Сила 13, помеха на Скрытность.", "Heavy armour: AC 16, needs Strength 13, disadvantage on Stealth."] },
  { id: "leather-armor", name: ["Кожаный доспех", "Leather armour"], kind: "armor", gp: 10, text: ["Лёгкий доспех: КД 11 + Ловкость.", "Light armour: AC 11 + Dexterity."] },
  { id: "cloak-of-protection", name: ["Плащ защиты", "Cloak of protection"], kind: "magic", gp: 0, text: ["Настройка: +1 к КД и спасброскам.", "Attunement: +1 to AC and saving throws."] },
  { id: "ring-of-protection", name: ["Кольцо защиты", "Ring of protection"], kind: "magic", gp: 0, text: ["Настройка: +1 к КД и спасброскам.", "Attunement: +1 to AC and saving throws."] },
  { id: "boots-of-elvenkind", name: ["Эльфийские сапоги", "Boots of elvenkind"], kind: "magic", gp: 0, text: ["Шаги бесшумны: преимущество на Скрытность, когда двигаетесь тихо.", "Silent steps: advantage on Stealth checks to move silently."] },
  { id: "wand-of-magic-missiles", name: ["Жезл волшебных стрел", "Wand of magic missiles"], kind: "magic", gp: 0, text: ["7 зарядов: тратьте 1–3, чтобы сотворить Волшебную стрелу (за заряд — круг выше). Восстанавливает 1к6+1 на рассвете.", "7 charges: spend 1–3 to cast Magic Missile (a level higher per extra charge). Regains 1d6 + 1 at dawn."] },
  { id: "bag-of-holding", name: ["Сумка хранения", "Bag of holding"], kind: "magic", gp: 0, text: ["Внутри больше, чем снаружи: до 500 фунтов, весит всегда 15.", "Bigger inside: holds up to 500 lb, always weighs 15 lb."] },
  { id: "amulet", name: ["Таинственный амулет", "Mysterious amulet"], kind: "quest", gp: 0, text: ["Золотой амулет с рубином в форме глаза. Что он делает, знает ведущий.", "A gold amulet with an eye-shaped ruby. The game master knows what it does."] },
  { id: "gem", name: ["Изумруд", "Emerald"], kind: "treasure", gp: 100, text: ["Драгоценный камень, стоит около 100 зм.", "A gemstone worth about 100 gp."] },
  { id: "gold-pouch", name: ["Кошель с золотом", "Pouch of gold"], kind: "treasure", gp: 25, text: ["Около 25 золотых монет.", "About 25 gold coins."] },
  { id: "old-key", name: ["Старый ключ", "Old key"], kind: "quest", gp: 0, text: ["Железный ключ с черепом на кольце. Что-то он открывает.", "An iron key with a skull bow. It opens something."] },
  { id: "treasure-map", name: ["Карта сокровищ", "Treasure map"], kind: "quest", gp: 0, text: ["Потрёпанная карта с красным крестом.", "A worn map with a red X."] },
  { id: "sealed-letter", name: ["Запечатанное письмо", "Sealed letter"], kind: "quest", gp: 0, text: ["Письмо с чёрной печатью ворона.", "A letter sealed with a black raven seal."] },
];

// ---- Battle maps and scene pictures --------------------------------------------

export interface CatalogMap {
  id: string;
  name: [string, string];
  cols: number;
  rows: number;
}

export const CATALOG_MAPS: CatalogMap[] = [
  { id: "forest-road", name: ["Лесная дорога", "Forest road"], cols: 24, rows: 16 },
  { id: "forest-clearing", name: ["Поляна с руинами", "Forest clearing"], cols: 24, rows: 16 },
  { id: "river-ford", name: ["Брод через реку", "River ford"], cols: 24, rows: 16 },
  { id: "village-square", name: ["Деревенская площадь", "Village square"], cols: 24, rows: 16 },
  { id: "tavern-hall", name: ["Зал таверны", "Tavern hall"], cols: 16, rows: 12 },
  { id: "city-street", name: ["Ночная улица", "City street at night"], cols: 24, rows: 16 },
  { id: "harbor-docks", name: ["Пристань", "Harbor docks"], cols: 24, rows: 16 },
  { id: "crypt", name: ["Склеп", "Crypt"], cols: 24, rows: 16 },
  { id: "dungeon-corridors", name: ["Подземелье", "Dungeon"], cols: 24, rows: 16 },
  { id: "cave", name: ["Пещера", "Cave"], cols: 24, rows: 16 },
  { id: "abandoned-mine", name: ["Заброшенная шахта", "Abandoned mine"], cols: 24, rows: 16 },
  { id: "goblin-camp", name: ["Лагерь гоблинов", "Goblin camp"], cols: 24, rows: 16 },
  { id: "bandit-hideout", name: ["Логово разбойников", "Bandit hideout"], cols: 24, rows: 16 },
  { id: "temple-ruins", name: ["Руины храма", "Temple ruins"], cols: 24, rows: 16 },
  { id: "wizard-tower", name: ["Башня мага", "Wizard's tower"], cols: 16, rows: 12 },
  { id: "throne-room", name: ["Тронный зал", "Throne room"], cols: 24, rows: 16 },
  { id: "sewers", name: ["Канализация", "Sewers"], cols: 24, rows: 16 },
  { id: "swamp", name: ["Болото", "Swamp"], cols: 24, rows: 16 },
  { id: "mountain-pass", name: ["Горный перевал", "Mountain pass"], cols: 24, rows: 16 },
  { id: "snowy-camp", name: ["Зимний лагерь", "Snowy camp"], cols: 24, rows: 16 },
  { id: "desert-oasis", name: ["Оазис", "Desert oasis"], cols: 24, rows: 16 },
  { id: "ship-deck", name: ["Палуба корабля", "Ship deck"], cols: 24, rows: 16 },
  { id: "graveyard", name: ["Кладбище", "Graveyard"], cols: 24, rows: 16 },
  { id: "dragon-lair", name: ["Логово дракона", "Dragon's lair"], cols: 24, rows: 16 },
  { id: "fighting-pit", name: ["Бойцовская яма", "Fighting pit"], cols: 16, rows: 12 },
];

export const CATALOG_SCENES: Array<{ id: string; name: [string, string] }> = [
  { id: "city-gate", name: ["Городские ворота", "City gate"] },
  { id: "market", name: ["Рынок", "Market"] },
  { id: "castle", name: ["Замок над долиной", "Castle above the valley"] },
  { id: "dark-forest", name: ["Тёмный лес", "Dark forest"] },
  { id: "mountains", name: ["Горы", "Mountains"] },
  { id: "seaport", name: ["Морской порт", "Seaport"] },
  { id: "dark-temple", name: ["Тёмный храм", "Dark temple"] },
  { id: "campfire", name: ["Привал у костра", "Campfire"] },
  { id: "burning-village", name: ["Горящая деревня", "Burning village"] },
  { id: "throne-hall", name: ["Королевский зал", "Royal hall"] },
  { id: "library", name: ["Древняя библиотека", "Ancient library"] },
  { id: "underground-lake", name: ["Подземное озеро", "Underground lake"] },
  { id: "ruins-sunset", name: ["Руины на закате", "Ruins at sunset"] },
  { id: "crossroads-inn", name: ["Трактир на перекрёстке", "Crossroads inn"] },
  { id: "storm-sea", name: ["Шторм", "Storm at sea"] },
];

/** Hero portraits added with the library; the builder's gallery shows them after the first 24. */
export const EXTRA_PORTRAITS: Array<{ id: string; race: RaceId }> = [
  { id: "human-m-fighter2", race: "human" }, { id: "human-f-wizard2", race: "human" }, { id: "human-f-ranger", race: "human" },
  { id: "human-m-cleric", race: "human" }, { id: "human-f-bard", race: "human" }, { id: "human-m-warlock", race: "human" },
  { id: "human-m-paladin2", race: "human" }, { id: "human-f-sorcerer", race: "human" },
  { id: "elf-f-rogue", race: "high-elf" }, { id: "elf-m-wizard", race: "high-elf" }, { id: "elf-m-bard", race: "high-elf" },
  { id: "elf-f-paladin", race: "high-elf" }, { id: "elf-f-druid", race: "high-elf" },
  { id: "dwarf-f-cleric", race: "hill-dwarf" }, { id: "dwarf-m-fighter", race: "hill-dwarf" }, { id: "dwarf-m-rogue", race: "hill-dwarf" },
  { id: "dwarf-f-ranger", race: "hill-dwarf" },
  { id: "halfling-m-rogue", race: "lightfoot-halfling" }, { id: "halfling-f-cleric", race: "lightfoot-halfling" },
  { id: "halfling-m-ranger", race: "lightfoot-halfling" }, { id: "halfling-f-wizard", race: "lightfoot-halfling" },
  { id: "dragonborn-m-fighter", race: "dragonborn" }, { id: "dragonborn-f-cleric", race: "dragonborn" },
  { id: "dragonborn-m-warlock", race: "dragonborn" }, { id: "dragonborn-f-ranger", race: "dragonborn" },
  { id: "gnome-m-wizard", race: "rock-gnome" }, { id: "gnome-f-rogue", race: "rock-gnome" }, { id: "gnome-m-cleric", race: "rock-gnome" },
  { id: "halfelf-m-ranger", race: "half-elf" }, { id: "halfelf-f-paladin", race: "half-elf" }, { id: "halfelf-m-sorcerer", race: "half-elf" },
  { id: "halfelf-f-rogue", race: "half-elf" },
  { id: "halforc-m-barbarian", race: "half-orc" }, { id: "halforc-f-cleric", race: "half-orc" }, { id: "halforc-m-monk", race: "half-orc" },
  { id: "halforc-f-ranger", race: "half-orc" },
  { id: "tiefling-f-bard", race: "tiefling" }, { id: "tiefling-m-rogue", race: "tiefling" }, { id: "tiefling-f-paladin", race: "tiefling" },
  { id: "tiefling-m-wizard", race: "tiefling" },
];
