import type { Ability, JournalKind } from "../../../src/shared/tabletop.js";

/*
 * Words for the newcomer aids around the sheet: hover hints, the roll
 * breakdown, the party journal and spell cards. Kept apart from dnd-text so
 * the rules help and these hints can be edited together.
 */

export interface LearnText {
  tips: {
    hp: string;
    ac: string;
    initiative: string;
    speed: string;
    xp: string;
    ability: Record<Ability, string>;
    abilityHow: string;
    skill: (ability: string, proficient: boolean) => string;
    save: (proficient: boolean) => string;
    attack: (bonus: string) => string;
    damage: string;
    crit: string;
    saveAttack: string;
    resource: string;
    hitDice: string;
    proficiency: (bonus: string) => string;
  };
  breakdown: {
    die: string;
    kept: (mode: "advantage" | "disadvantage") => string;
    proficiency: string;
    expertise: string;
    attack: string;
    flat: string;
    dice: string;
  };
  journal: {
    button: string;
    title: string;
    lead: string;
    placeholder: string;
    add: string;
    save: string;
    cancel: string;
    edit: string;
    remove: string;
    empty: string;
    spectator: string;
    all: string;
    kinds: Record<JournalKind, string>;
    icons: Record<JournalKind, string>;
  };
  spells: {
    tab: string;
    cantrip: string;
    level: (level: number) => string;
    time: string;
    range: string;
    duration: string;
    concentration: string;
    ritual: string;
    unknown: string;
    cantripNote: string;
    slotNote: (level: number) => string;
  };
}

const ru: LearnText = {
  tips: {
    hp: "Хиты — сколько урона герой выдержит. На 0 он падает без сознания и бросает спасброски от смерти. − и + меняют хиты вручную (например, выпили зелье).",
    ac: "Класс доспеха (КД). Чтобы попасть по герою, враг должен выбросить на атаке столько же или больше.",
    initiative: "Инициатива — прибавка к к20 в начале боя: кто выбросит больше, ходит раньше. Нажмите, чтобы бросить.",
    speed: "Скорость — сколько футов можно пройти за ход. Одна клетка карты — 5 футов: 30 фт = 6 клеток.",
    xp: "Опыт за бои и задания. Наберёте нужное число — появится кнопка повышения уровня.",
    ability: {
      str: "Сила: поднять, толкнуть, выбить дверь, ударить тяжёлым оружием.",
      dex: "Ловкость: увернуться, прокрасться, выстрелить из лука, лёгкое оружие.",
      con: "Телосложение: здоровье и выносливость; добавляет хиты.",
      int: "Интеллект: знания, логика, магия волшебника.",
      wis: "Мудрость: внимательность, чутьё, магия жреца и друида.",
      cha: "Харизма: убедить, обмануть, запугать; магия барда, чародея, колдуна.",
    },
    abilityHow: "Крупное число — модификатор, его прибавляют к броскам; мелкое — сама характеристика. Нажмите, чтобы бросить проверку.",
    skill: (ability, proficient) => `Бросок к20 + ${ability}${proficient ? " + бонус мастерства (герой владеет навыком — он подсвечен)" : ""}. Обычно его просит ведущий. Нажмите, чтобы бросить.`,
    save: proficient => `Спасбросок — попытка избежать опасности: яда, заклинания, ловушки. Обычно его просит ведущий.${proficient ? " Герой владеет им: прибавляется бонус мастерства." : ""}`,
    attack: bonus => `Бросок атаки: к20 ${bonus}. Если итог не меньше КД цели — попадание, тогда бросайте урон. Сначала выберите цель на карте.`,
    damage: "Урон: бросайте после попадания. Ведущий нанесёт его цели.",
    crit: "Критический урон: если на кубике атаки выпало 20, кости урона удваиваются.",
    saveAttack: "Эта атака не бросает к20: цели сами бросают спасбросок, а урон применяется сразу.",
    resource: "Ограниченные способности и ячейки заклинаний. Кружок гаснет, когда вы тратите заряд; отдых возвращает их.",
    hitDice: "Кости хитов: на коротком отдыхе потратьте одну, чтобы восстановить хиты. Долгий отдых возвращает половину.",
    proficiency: bonus => `Бонус мастерства ${bonus}: прибавляется ко всему, чем герой владеет — навыкам, спасброскам, оружию.`,
  },
  breakdown: {
    die: "кубик",
    kept: mode => (mode === "advantage" ? "преимущество: взят больший" : "помеха: взят меньший"),
    proficiency: "мастерство",
    expertise: "экспертиза",
    attack: "бонус атаки",
    flat: "прибавка",
    dice: "кости",
  },
  journal: {
    button: "Журнал",
    title: "Журнал партии",
    lead: "Общие записи: задания, кого встретили, где были, зацепки. Видят все за столом, хранится между играми.",
    placeholder: "Что записать? Например: «Марта обещала 50 зм, если колокол замолчит»",
    add: "Записать",
    save: "Сохранить",
    cancel: "Отмена",
    edit: "Изменить",
    remove: "Удалить",
    empty: "Пока пусто. Записывайте задания, имена и зацепки — через неделю они пригодятся.",
    spectator: "Писать могут игроки и ведущий.",
    all: "Все",
    kinds: { quest: "Задание", person: "Персонаж", place: "Место", clue: "Зацепка", note: "Заметка" },
    icons: { quest: "🎯", person: "👤", place: "🗺️", clue: "🔍", note: "📝" },
  },
  spells: {
    tab: "Заклинания",
    cantrip: "Заговор",
    level: level => `${level}-й круг`,
    time: "Время",
    range: "Дальность",
    duration: "Длительность",
    concentration: "концентрация",
    ritual: "ритуал",
    unknown: "Описания нет — спросите ведущего.",
    cantripNote: "Заговор: бесплатно, сколько угодно раз.",
    slotNote: level => `Тратит ячейку ${level}-го круга (раздел «Ресурсы»).`,
  },
};

const en: LearnText = {
  tips: {
    hp: "Hit points: how much damage the hero can take. At 0 they fall unconscious and roll death saves. − and + change them by hand (a potion, say).",
    ac: "Armour class (AC). To hit the hero, an attack roll must equal or beat it.",
    initiative: "Initiative: added to a d20 when combat starts; higher goes first. Click to roll.",
    speed: "Speed: how far the hero moves in a turn. One map square is 5 ft: 30 ft = 6 squares.",
    xp: "Experience for fights and quests. Once you have enough, a level-up button appears.",
    ability: {
      str: "Strength: lift, shove, break a door, swing heavy weapons.",
      dex: "Dexterity: dodge, sneak, shoot a bow, light weapons.",
      con: "Constitution: health and stamina; adds hit points.",
      int: "Intelligence: knowledge, reasoning, wizard magic.",
      wis: "Wisdom: perception, insight, cleric and druid magic.",
      cha: "Charisma: persuade, deceive, intimidate; bard, sorcerer and warlock magic.",
    },
    abilityHow: "The big number is the modifier you add to rolls; the small one is the score. Click to roll a check.",
    skill: (ability, proficient) => `d20 + ${ability}${proficient ? " + proficiency (the hero is proficient — it is highlighted)" : ""}. Usually the game master asks for it. Click to roll.`,
    save: proficient => `A saving throw resists danger: poison, a spell, a trap. Usually the game master asks for it.${proficient ? " The hero is proficient: proficiency is added." : ""}`,
    attack: bonus => `Attack roll: d20 ${bonus}. If the total equals or beats the target's AC it hits; then roll damage. Pick the target on the map first.`,
    damage: "Damage: roll it after a hit. The game master applies it to the target.",
    crit: "Critical damage: when the attack die shows 20, the damage dice are doubled.",
    saveAttack: "No d20 for this attack: the targets roll saving throws and the damage is applied at once.",
    resource: "Limited abilities and spell slots. A dot goes dark when you spend a use; rests bring them back.",
    hitDice: "Hit dice: on a short rest spend one to regain hit points. A long rest returns half of them.",
    proficiency: bonus => `Proficiency bonus ${bonus}: added to everything the hero is proficient in — skills, saves, weapons.`,
  },
  breakdown: {
    die: "die",
    kept: mode => (mode === "advantage" ? "advantage: higher kept" : "disadvantage: lower kept"),
    proficiency: "proficiency",
    expertise: "expertise",
    attack: "attack bonus",
    flat: "bonus",
    dice: "dice",
  },
  journal: {
    button: "Journal",
    title: "Party journal",
    lead: "Shared notes: quests, people you met, places, clues. Everyone at the table sees them; kept between games.",
    placeholder: "What to note? E.g. \"Martha promised 50 gp if the bell goes quiet\"",
    add: "Add",
    save: "Save",
    cancel: "Cancel",
    edit: "Edit",
    remove: "Remove",
    empty: "Nothing yet. Write down quests, names and clues — a week later you will need them.",
    spectator: "Players and the game master can write.",
    all: "All",
    kinds: { quest: "Quest", person: "Person", place: "Place", clue: "Clue", note: "Note" },
    icons: { quest: "🎯", person: "👤", place: "🗺️", clue: "🔍", note: "📝" },
  },
  spells: {
    tab: "Spells",
    cantrip: "Cantrip",
    level: level => `Level ${level}`,
    time: "Casting time",
    range: "Range",
    duration: "Duration",
    concentration: "concentration",
    ritual: "ritual",
    unknown: "No description — ask the game master.",
    cantripNote: "Cantrip: free, as often as you like.",
    slotNote: level => `Spends a level ${level} slot (see Resources).`,
  },
};

export function learnText(russian: boolean): LearnText {
  return russian ? ru : en;
}
