import type { HeroSheet } from "../../../src/shared/tabletop.js";

/*
 * English for the D&D table's rules texts. The gateway builds hero sheets and
 * roll labels in Russian (the canonical form, shared by everyone at a table);
 * an English page shows them through these tables: exact strings first, then
 * the patterns the builder and the gateway assemble. Unknown text (an
 * adventure's own heroes and story) stays as written.
 */

const WORDS: Record<string, string> = {
  // Races and classes
  "Человек": "Human", "Высший эльф": "High elf", "Холмовой дварф": "Hill dwarf", "Легконогий полурослик": "Lightfoot halfling",
  "Драконорождённый": "Dragonborn", "Скальный гном": "Rock gnome", "Полуэльф": "Half-elf", "Полуорк": "Half-orc", "Тифлинг": "Tiefling",
  "Варвар": "Barbarian", "Бард": "Bard", "Жрец (Домен жизни)": "Cleric (Life Domain)", "Друид": "Druid", "Воин": "Fighter", "Монах": "Monk",
  "Паладин": "Paladin", "Следопыт": "Ranger", "Плут": "Rogue", "Чародей (Драконья кровь)": "Sorcerer (Draconic Bloodline)",
  "Колдун (Исчадие)": "Warlock (the Fiend)", "Волшебник": "Wizard",
  // Race and class blurbs
  "+1 ко всем характеристикам. Везде свой.": "+1 to every ability. At home anywhere.",
  "Ловкость и Интеллект, острый слух и магия в крови.": "Dexterity and Intelligence, keen senses and magic in the blood.",
  "Крепкий и мудрый, больше хитов. Скорость 25 фт.": "Tough and wise, more hit points. Speed 25 ft.",
  "Ловкий и обаятельный, удача на его стороне.": "Nimble and charming, luck on their side.",
  "Сила и Харизма, оружие дыхания и сопротивление стихии.": "Strength and Charisma, a breath weapon and elemental resistance.",
  "Умный изобретатель, крепко стоит против магии.": "A clever tinkerer who stands firm against magic.",
  "Харизма, две характеристики и два навыка на выбор.": "Charisma, two abilities and two skills of your choice.",
  "Сильный и выносливый, не падает с первого удара.": "Strong and enduring, hard to put down.",
  "Харизма и Интеллект, огонь ему не страшен.": "Charisma and Intelligence, unafraid of fire.",
  "Ярость, огромный топор и больше всех хитов.": "Rage, a huge axe and the most hit points.",
  "Магия музыки, вдохновение союзников, любые три навыка.": "Music magic, inspiring allies, any three skills.",
  "Лечит лучше всех, носит тяжёлую броню.": "The best healer, wears heavy armour.",
  "Магия природы, огонь в ладони и опутывающие лозы.": "Nature magic, fire in the palm and grasping vines.",
  "Мастер оружия и доспехов, второе дыхание.": "Master of weapons and armour, second wind.",
  "Быстрые удары без оружия и защита без доспехов.": "Fast unarmed strikes and defense without armour.",
  "Святой воин: латы, щит и наложение рук.": "A holy warrior: plate, shield and laying on of hands.",
  "Лучник и охотник, знает дикие земли.": "Archer and hunter who knows the wilds.",
  "Скрытая атака, экспертиза в навыках, четыре навыка.": "Sneak attack, expertise, four skills.",
  "Врождённая магия и драконья чешуя вместо доспеха.": "Innate magic and dragon scales for armour.",
  "Сделка с исчадием, мистический заряд.": "A pact with a fiend, eldritch blast.",
  "Книга заклинаний: больше всех заклинаний.": "A spellbook: the most spells of all.",
  // Dragons and damage
  "Красный": "Red", "Золотой": "Gold", "Латунный": "Brass", "Синий": "Blue", "Бронзовый": "Bronze", "Чёрный": "Black", "Медный": "Copper",
  "Зелёный": "Green", "Белый": "White", "Серебряный": "Silver",
  "огонь": "fire", "электричество": "lightning", "кислота": "acid", "яд": "poison", "холод": "cold", "конус 15 фт": "15-ft cone", "линия 5×30 фт": "5 × 30-ft line",
  // Race features
  "Владение одним дополнительным языком": "One extra language",
  "Тёмное зрение 60 фт": "Darkvision 60 ft",
  "Наследие фей: преимущество против очарования, магией не усыпить": "Fey ancestry: advantage against being charmed, magic cannot put you to sleep",
  "Транс: 4 часа медитации вместо сна": "Trance: 4 hours of meditation instead of sleep",
  "Заговор волшебника (Фокусы)": "A wizard cantrip (Prestidigitation)",
  "Дварфская стойкость: преимущество на спасброски от яда, сопротивление яду": "Dwarven resilience: advantage on saves against poison, resistance to poison",
  "Знание камня": "Stonecunning", "Дварфская выдержка: +1 хит за уровень": "Dwarven toughness: +1 hit point per level",
  "Везучий: перебросьте 1 на к20": "Lucky: reroll a 1 on a d20", "Храбрый: преимущество против испуга": "Brave: advantage against being frightened",
  "Проворство: проходите сквозь крупных существ": "Nimbleness: move through larger creatures", "Естественная скрытность": "Naturally stealthy",
  "Гномья хитрость: преимущество на спасброски Инт, Мдр и Хар от магии": "Gnome cunning: advantage on Int, Wis and Cha saves against magic",
  "Знание ремесла": "Artificer's lore", "Жестянщик: мелкие механизмы": "Tinker: small clockwork devices",
  "Разносторонность: +2 навыка, +1 к двум характеристикам": "Skill versatility: +2 skills, +1 to two abilities",
  "Непоколебимая стойкость: раз в день при 0 хитов остаётесь с 1": "Relentless endurance: once a day drop to 1 hit point instead of 0",
  "Свирепые атаки: на крите ещё одна кость урона оружия": "Savage attacks: one more weapon die on a critical hit",
  "Адское сопротивление: сопротивление огню": "Hellish resistance: resistance to fire",
  "Дьявольское наследие: заговор «Чудотворство»": "Infernal legacy: the Thaumaturgy cantrip",
  // Class features (level 1)
  "Ярость (2 раза в день): +2 к урону Силой, сопротивление дробящему, колющему и рубящему, преимущество на проверки Силы": "Rage (twice a day): +2 Strength damage, resistance to bludgeoning, piercing and slashing, advantage on Strength checks",
  "Защита без доспехов: КД 10 + Лов + Тел": "Unarmored defense: AC 10 + Dex + Con",
  "Заклинания: 2 ячейки 1-го круга": "Spells: two 1st-level slots",
  "Домен жизни: владение тяжёлыми доспехами": "Life Domain: heavy armour proficiency",
  "Ученик жизни: лечебные заклинания восстанавливают ещё 2 + круг хитов": "Disciple of life: healing spells restore 2 + the spell's level more",
  "Друидический язык": "Druidic",
  "Боевой стиль: Защита (+1 КД в доспехе)": "Fighting style: Defense (+1 AC in armour)",
  "Боевой стиль: Стрельба (+2 к дальнобойным атакам)": "Fighting style: Archery (+2 to ranged attacks)",
  "Второе дыхание: бонусным действием 1к10+1 хитов, раз на короткий отдых": "Second wind: a bonus action for 1d10+1 hit points, once per short rest",
  "Защита без доспехов: КД 10 + Лов + Мдр": "Unarmored defense: AC 10 + Dex + Wis",
  "Боевые искусства: к4 безоружно, удар бонусным действием": "Martial arts: d4 unarmed, a bonus-action strike",
  "Наложение рук: запас 5 хитов лечения в день": "Lay on hands: a pool of 5 hit points of healing a day",
  "Избранный враг: нежить (преимущество на выслеживание и знания о ней)": "Favored enemy: undead (advantage to track and recall lore)",
  "Исследователь природы: леса": "Natural explorer: forests",
  "Скрытая атака 1к6": "Sneak attack 1d6", "Экспертиза: двойной бонус мастерства в двух навыках": "Expertise: double proficiency in two skills",
  "Воровской жаргон": "Thieves' cant",
  "Драконья устойчивость: КД 13 + Лов без доспехов, +1 хит за уровень": "Draconic resilience: AC 13 + Dex without armour, +1 hit point per level",
  "Покровитель — Исчадие: убив врага, получаете Хар + 1 временных хитов": "Patron — the Fiend: dropping a foe gives Cha + 1 temporary hit points",
  "Магия договора: 1 ячейка 1-го круга, восстанавливается после короткого отдыха": "Pact magic: one 1st-level slot, back after a short rest",
  "Магическое восстановление: раз в день вернуть ячейку на коротком отдыхе": "Arcane recovery: once a day regain a slot on a short rest",
  "Заклинания: 2 ячейки 1-го круга; «Доспехи мага» дают КД 13 + Лов": "Spells: two 1st-level slots; Mage Armor gives AC 13 + Dex",
  // Level features
  "Безрассудная атака: преимущество на рукопашные атаки Силой, но и атаки по вам с преимуществом": "Reckless attack: advantage on melee Strength attacks, but attacks against you have advantage too",
  "Чувство опасности: преимущество на видимые спасброски Ловкости": "Danger sense: advantage on Dexterity saves against effects you can see",
  "Путь берсерка — бешенство: в ярости бонусная атака оружием каждый ход (потом 1 истощение)": "Path of the Berserker — frenzy: a bonus weapon attack each turn while raging (then 1 exhaustion)",
  "Дополнительная атака: две атаки за действие": "Extra attack: two attacks per action",
  "Быстрое передвижение: +10 фт без тяжёлых доспехов": "Fast movement: +10 ft without heavy armour",
  "Мастер на все руки: +1 к проверкам без владения": "Jack of all trades: +1 to checks without proficiency",
  "Песнь отдыха: союзники получают ещё 1к6 хитов на коротком отдыхе": "Song of rest: allies regain an extra 1d6 on a short rest",
  "Коллегия знаний — острое словцо: реакцией вычесть кость вдохновения из броска врага": "College of Lore — cutting words: a reaction to subtract an inspiration die from a foe's roll",
  "Компетентность: удвоенный бонус мастерства в двух навыках": "Expertise: double proficiency in two skills",
  "Вдохновение барда к8, источник вдохновения: восстанавливается на коротком отдыхе": "Bardic inspiration d8, font of inspiration: back on a short rest",
  "Божественный канал: Изгнание нежити; Сохранение жизни (5 × уровень хитов союзникам)": "Channel divinity: Turn Undead; Preserve Life (5 × level hit points among allies)",
  "Заклинания 2-го круга": "2nd-level spells", "Заклинания 3-го круга": "3rd-level spells",
  "Уничтожение нежити (ОП 1/2 и ниже)": "Destroy undead (CR 1/2 or lower)",
  "Дикий облик: 2 раза, звери с ОП до 1/4, без плавания и полёта": "Wild shape: twice, beasts up to CR 1/4, no swimming or flying",
  "Круг земли: Естественное восстановление, дополнительный заговор": "Circle of the Land: natural recovery, a bonus cantrip",
  "Дикий облик: звери с ОП до 1/2, плавание": "Wild shape: beasts up to CR 1/2, swimming",
  "Всплеск действий: ещё одно действие, раз на короткий отдых": "Action surge: one more action, once per short rest",
  "Чемпион — улучшенный критический удар: крит на 19–20": "Champion — improved critical: crit on 19–20",
  "Ци (очки = уровню): шквал ударов, терпеливая оборона, поступь ветра": "Ki (points = level): flurry of blows, patient defense, step of the wind",
  "Движение без доспехов: +10 фт": "Unarmored movement: +10 ft",
  "Путь открытой ладони: шквал ударов сбивает с ног или отталкивает": "Way of the Open Hand: flurry of blows knocks prone or pushes",
  "Отражение снарядов": "Deflect missiles", "Медленное падение": "Slow fall", "Дополнительная атака": "Extra attack",
  "Ошеломляющий удар: 1 ци, спасбросок Телосложения или ошеломлён": "Stunning strike: 1 ki, a Constitution save or stunned",
  "Боевые искусства к6": "Martial arts d6",
  "Боевой стиль: Защита (+1 КД)": "Fighting style: Defense (+1 AC)",
  "Божественная кара: +2к8 излучением за ячейку": "Divine smite: +2d8 radiant per slot",
  "Заклинания: ячейки 1-го круга": "Spells: 1st-level slots",
  "Божественное здоровье: иммунитет к болезням": "Divine health: immune to disease",
  "Клятва преданности: Священное оружие, Изгнание нечестивцев": "Oath of Devotion: Sacred Weapon, Turn the Unholy",
  "Охотник — убийца колоссов: +1к8 урона раз в ход по раненой цели": "Hunter — colossus slayer: +1d8 once a turn against a wounded target",
  "Первозданная осведомлённость": "Primeval awareness",
  "Хитрое действие: Рывок, Отход или Засада бонусным действием": "Cunning action: Dash, Disengage or Hide as a bonus action",
  "Вор — быстрые руки и работа на втором этаже": "Thief — fast hands and second-story work",
  "Скрытая атака 2к6": "Sneak attack 2d6", "Скрытая атака 3к6": "Sneak attack 3d6",
  "Невероятное уклонение: реакцией вдвое уменьшить урон от атаки": "Uncanny dodge: a reaction to halve an attack's damage",
  "Источник магии: единицы чародейства, гибкое колдовство": "Font of magic: sorcery points, flexible casting",
  "Метамагия: Усиленное и Ускоренное заклинание": "Metamagic: Empowered and Quickened Spell",
  "Воззвания: Мучительный взрыв (+Хар к урону мистического заряда), Дьявольский взгляд": "Invocations: Agonizing Blast (+Cha to eldritch blast damage), Devil's Sight",
  "Договор гримуара: три заговора любого класса": "Pact of the Tome: three cantrips from any class",
  "Ячейки договора 2-го круга": "Pact slots of 2nd level", "Ячейки договора 3-го круга": "Pact slots of 3rd level", "Ещё одно воззвание": "One more invocation",
  "Школа воплощения: знаток воплощения, создание безопасных зон в своих заклинаниях": "School of Evocation: evocation savant, sculpt spells",
  // Resources
  "Ярость": "Rage", "Вдохновение барда": "Bardic inspiration", "Божественный канал": "Channel divinity", "Дикий облик": "Wild shape",
  "Второе дыхание": "Second wind", "Всплеск действий": "Action surge", "Ци": "Ki", "Наложение рук (хиты)": "Lay on hands (hit points)",
  "Божественное чувство": "Divine sense", "Единицы чародейства": "Sorcery points", "Магическое восстановление": "Arcane recovery",
  "Оружие дыхания": "Breath weapon", "Непоколебимая стойкость": "Relentless endurance",
  // Weapons and notes
  "Секира": "Greataxe", "Ручной топор": "Handaxe", "Рапира": "Rapier", "Злая насмешка": "Vicious Mockery", "Булава": "Mace",
  "Священное пламя": "Sacred Flame", "Скимитар": "Scimitar", "Сотворение пламени": "Produce Flame", "Длинный меч": "Longsword",
  "Лёгкий арбалет": "Light crossbow", "Длинный лук": "Longbow", "Короткий меч": "Shortsword", "Безоружный удар": "Unarmed strike",
  "Метательное копьё": "Javelin", "Короткий лук": "Shortbow", "Скрытая атака": "Sneak attack", "Огненный снаряд": "Fire Bolt",
  "Кинжал": "Dagger", "Мистический заряд": "Eldritch Blast",
  "двуручное, рубящий": "two-handed, slashing", "метательное 20/60 фт, рубящий": "thrown 20/60 ft, slashing",
  "фехтовальное, колющий": "finesse, piercing", "заговор, 60 фт, психический, помеха на следующую атаку цели": "cantrip, 60 ft, psychic, disadvantage on the target's next attack",
  "рукопашная, дробящий": "melee, bludgeoning", "заговор, 60 фт, излучение, укрытие не помогает": "cantrip, 60 ft, radiant, cover does not help",
  "фехтовальное, рубящий": "finesse, slashing", "заговор, бросок 30 фт, огонь": "cantrip, thrown 30 ft, fire",
  "рукопашная, рубящий (1к10 двумя руками без щита)": "melee, slashing (1d10 two-handed without a shield)",
  "дальнобойная 80/320 фт, колющий": "ranged 80/320 ft, piercing", "дальнобойная 150/600 фт, колющий": "ranged 150/600 ft, piercing",
  "бонусным действием после атаки (боевые искусства)": "a bonus action after attacking (martial arts)",
  "рукопашная, рубящий": "melee, slashing", "метательное 30/120 фт, колющий": "thrown 30/120 ft, piercing",
  "фехтовальное, колющий, можно с двух рук": "finesse, piercing, two-weapon fighting",
  "раз в ход при преимуществе или союзнике рядом с целью": "once a turn with advantage or an ally next to the target",
  "заговор, 120 фт, огонь": "cantrip, 120 ft, fire", "фехтовальное, метательное 20/60 фт": "finesse, thrown 20/60 ft",
  "заговор, 120 фт, силовое поле": "cantrip, 120 ft, force",
  // Equipment
  "2 ручных топора": "2 handaxes", "4 метательных копья": "4 javelins", "Набор путешественника": "Explorer's pack", "Лютня": "Lute",
  "Кожаный доспех": "Leather armour", "Набор артиста": "Entertainer's pack", "Кольчуга": "Chain mail", "Щит": "Shield",
  "Священный символ": "Holy symbol", "Набор священника": "Priest's pack", "Деревянный щит": "Wooden shield",
  "Друидическая фокусировка": "Druidic focus", "Лёгкий арбалет, 20 болтов": "Light crossbow, 20 bolts",
  "Набор исследователя подземелий": "Dungeoneer's pack", "Длинный лук, 20 стрел": "Longbow, 20 arrows", "2 коротких меча": "2 shortswords",
  "10 дротиков": "10 darts", "5 метательных копий": "5 javelins", "Чешуйчатый доспех (помеха Скрытности)": "Scale mail (disadvantage on Stealth)",
  "Короткий лук, 20 стрел": "Shortbow, 20 arrows", "2 кинжала": "2 daggers", "Воровские инструменты": "Thieves' tools",
  "Набор взломщика": "Burglar's pack", "Магическая фокусировка": "Arcane focus", "Набор учёного": "Scholar's pack",
  "Боевой посох": "Quarterstaff", "Книга заклинаний": "Spellbook",
};

const SPELLS: Record<string, string> = {
  "Злая насмешка": "Vicious Mockery", "Малая иллюзия": "Minor Illusion", "Лечащее слово": "Healing Word", "Усыпление": "Sleep",
  "Очарование личности": "Charm Person", "Громовая волна": "Thunderwave", "Священное пламя": "Sacred Flame", "Указание": "Guidance",
  "Свет": "Light", "Лечение ран": "Cure Wounds", "Благословение": "Bless", "Щит веры": "Shield of Faith", "Нанесение ран": "Inflict Wounds",
  "Сотворение пламени": "Produce Flame", "Опутывание": "Entangle", "Огонь фей": "Faerie Fire", "Огненный снаряд": "Fire Bolt",
  "Леденящее прикосновение": "Chill Touch", "Фокусы": "Prestidigitation", "Волшебная стрела": "Magic Missile", "Щит": "Shield",
  "Мистический заряд": "Eldritch Blast", "Огненные ладони": "Burning Hands", "Волшебная рука": "Mage Hand", "Доспехи мага": "Mage Armor",
  "Обнаружение магии": "Detect Magic", "Невидимость": "Invisibility", "Удержание личности": "Hold Person", "Гипнотический узор": "Hypnotic Pattern",
  "Рассеивание магии": "Dispel Magic", "Духовное оружие": "Spiritual Weapon", "Малое восстановление": "Lesser Restoration",
  "Духовные стражи": "Spirit Guardians", "Возрождение": "Revivify", "Маяк надежды": "Beacon of Hope", "Лунный луч": "Moonbeam",
  "Порыв ветра": "Gust of Wind", "Призыв молнии": "Call Lightning", "Слияние с камнем": "Meld into Stone",
  "Божественная благосклонность": "Divine Favor", "Магическое оружие": "Magic Weapon", "Найти скакуна": "Find Steed",
  "Метка охотника": "Hunter's Mark", "Бесследное передвижение": "Pass without Trace", "Тёмное зрение": "Darkvision",
  "Отражения": "Mirror Image", "Паучье лазание": "Spider Climb", "Огненный шар": "Fireball", "Ускорение": "Haste",
  "Туманный шаг": "Misty Step", "Тьма": "Darkness", "Контрзаклинание": "Counterspell", "Полёт": "Fly", "Паутина": "Web",
  "Палящий луч": "Scorching Ray", "Молния": "Lightning Bolt",
};

const ABILITY_SHORT: Record<string, string> = { Сил: "Str", Лов: "Dex", Тел: "Con", Инт: "Int", Мдр: "Wis", Хар: "Cha" };
const ABILITY_NAME: Record<string, string> = {
  Сила: "Strength", Ловкость: "Dexterity", Телосложение: "Constitution", Интеллект: "Intelligence", Мудрость: "Wisdom", Харизма: "Charisma",
};
const SKILL_NAME: Record<string, string> = {
  Акробатика: "Acrobatics", "Уход за животными": "Animal Handling", Магия: "Arcana", Атлетика: "Athletics", Обман: "Deception",
  История: "History", Проницательность: "Insight", Запугивание: "Intimidation", Анализ: "Investigation", Медицина: "Medicine",
  Природа: "Nature", Внимательность: "Perception", Выступление: "Performance", Убеждение: "Persuasion", Религия: "Religion",
  "Ловкость рук": "Sleight of Hand", Скрытность: "Stealth", Выживание: "Survival",
};
const CONDITION_WORD: Record<string, string> = {
  ослеплён: "blinded", очарован: "charmed", оглох: "deafened", испуган: "frightened", схвачен: "grappled", недееспособен: "incapacitated",
  невидим: "invisible", парализован: "paralyzed", окаменел: "petrified", отравлен: "poisoned", "сбит с ног": "prone", опутан: "restrained",
  ошеломлён: "stunned", "без сознания": "unconscious", невидима: "invisible",
};

const dice = (text: string) => text.replace(/(\d*)к(\d+)/g, "$1d$2");
const spellList = (list: string) => list.split(", ").map(name => SPELLS[name] ?? name).join(", ");
const ordinal = (n: string) => `${n}${n === "1" ? "st" : n === "2" ? "nd" : n === "3" ? "rd" : "th"}`;

/** One line of a sheet (a feature, a note, an item) in English when the tables know it. */
export function enLine(text: string): string {
  const exact = WORDS[text];
  if (exact) return exact;
  let match: RegExpExecArray | null;
  if ((match = /^4 ур\.: Увеличение характеристик \((.+)\)$/.exec(text))) return `Level 4: Ability score improvement (${match[1]!.replace(/[А-Яа-я]{3}/g, word => ABILITY_SHORT[word] ?? word)})`;
  if ((match = /^(\d) ур\.: (.+)$/.exec(text))) return `Level ${match[1]}: ${enLine(match[2]!)}`;
  if ((match = /^Ячейки договора \((\d)-й круг\)$/.exec(text))) return `Pact slots (${ordinal(match[1]!)} level)`;
  if ((match = /^Ячейки (\d)-го круга$/.exec(text))) return `${ordinal(match[1]!)}-level spell slots`;
  if ((match = /^Вдохновение барда \(к6, (\d+) раз в день\)$/.exec(text))) return `Bardic inspiration (d6, ${match[1]} times a day)`;
  if ((match = /^Божественное чувство \((\d+) раз в день\): (.+)$/.exec(text))) return `Divine sense (${match[1]} times a day): sense undead, fiends and celestials within 60 ft`;
  if ((match = /^(.+) дракон: сопротивление урону «(.+)»$/.exec(text))) return `${WORDS[match[1]!] ?? match[1]} dragon: resistance to ${WORDS[match[2]!] ?? match[2]} damage`;
  if ((match = /^(.+), (.+), раз на короткий отдых; спасбросок (\S+) СЛ (\d+), половина при успехе$/.exec(text))) {
    return `${WORDS[match[1]!] ?? match[1]}, ${WORDS[match[2]!] ?? match[2]}, once per short rest; ${ABILITY_SHORT[match[3]!] ?? match[3]} save DC ${match[4]}, half on a success`;
  }
  if ((match = /^(.+); спасбросок (\S+) СЛ (\d+)$/.exec(text))) return `${enLine(match[1]!)}; ${ABILITY_SHORT[match[2]!] ?? match[2]} save DC ${match[3]}`;
  if ((match = /^Заговоры: (.+)$/.exec(text))) return `Cantrips: ${spellList(match[1]!)}`;
  if ((match = /^Книга \((\d)-й круг\): (.+)$/.exec(text))) return `Spellbook (${ordinal(match[1]!)} level): ${spellList(match[2]!)}`;
  if ((match = /^(\d)-й круг \(подготовлены\): (.+)$/.exec(text))) return `${ordinal(match[1]!)} level (prepared): ${spellList(match[2]!)}`;
  if ((match = /^(\d)-й круг: (.+)$/.exec(text))) return `${ordinal(match[1]!)} level: ${spellList(match[2]!)}`;
  return text;
}

/** A hero sheet with the builder's words in English (names and stories stay). */
export function enHero(hero: HeroSheet): HeroSheet {
  return {
    ...hero,
    race: enLine(hero.race),
    cls: enLine(hero.cls),
    features: hero.features.map(enLine),
    equipment: hero.equipment.map(enLine),
    ...(hero.spells ? { spells: hero.spells.map(enLine) } : {}),
    attacks: hero.attacks.map(attack => ({ ...attack, name: enLine(attack.name), note: enLine(attack.note) })),
    ...(hero.resources ? { resources: hero.resources.map(resource => ({ ...resource, name: enLine(resource.name) })) } : {}),
  };
}

/** The gateway's roll labels and reasons in English. */
export function enRollText(text: string): string {
  let match: RegExpExecArray | null;
  const ability = (word: string) => ABILITY_NAME[word] ?? word;
  if (SKILL_NAME[text]) return SKILL_NAME[text]!;
  if ((match = /^(Сила|Ловкость|Телосложение|Интеллект|Мудрость|Харизма) \((.+)\)$/.exec(text))) return `${ability(match[1]!)} (${SKILL_NAME[match[2]!] ?? match[2]})`;
  if ((match = /^Атака: (.+)$/.exec(text))) return `Attack: ${enLine(match[1]!)}`;
  if ((match = /^Урон: (.+?)( \(крит\))?$/.exec(text))) return `Damage: ${enLine(match[1]!)}${match[2] ? " (critical)" : ""}`;
  if ((match = /^Спасбросок: (.+)$/.exec(text))) return `${ability(match[1]!)} save`;
  if ((match = /^Проверка: (.+)$/.exec(text))) return `${ability(match[1]!)} check`;
  if ((match = /^Концентрация: спасбросок Телосложения$/.exec(text))) return "Concentration: Constitution save";
  if ((match = /^(.+): спасбросок (.+)$/.exec(text))) return `${enLine(match[1]!)}: ${ability(match[2]!)} save`;
  if ((match = /^Опыт ([+−])(\d+): (.+)$/.exec(text))) return `Experience ${match[1] === "+" ? "+" : "−"}${match[2]}: ${match[3]}`;
  if ((match = /^Новый уровень: (\d+) \(\+(\d+) к максимуму хитов\)$/.exec(text))) return `New level: ${match[1]} (+${match[2]} maximum hit points)`;
  if ((match = /^(.+): помеха$/.exec(text))) return `${enCondition(match[1]!)}: disadvantage`;
  if ((match = /^(.+): преимущество$/.exec(text))) return `${enCondition(match[1]!)}: advantage`;
  const fixed: Record<string, string> = {
    "Инициатива": "Initiative", "Спасбросок от смерти": "Death saving throw", "Бросок": "Roll", "Скрытый бросок ведущего": "The master's secret roll",
    "Кость хитов": "Hit die", "Долгий отдых: хиты, ячейки и умения восстановлены": "Long rest: hit points, slots and features restored",
    "Короткий отдых: можно тратить кости хитов": "Short rest: hit dice may be spent",
    "провал спасброска Силы и Ловкости автоматически": "Strength and Dexterity saves fail automatically",
  };
  return fixed[text] ?? dice(text);
}

function enCondition(text: string): string {
  let match: RegExpExecArray | null;
  if ((match = /^истощение (\d)$/.exec(text))) return `exhaustion ${match[1]}`;
  if ((match = /^цель (.+)$/.exec(text))) return `target ${CONDITION_WORD[match[1]!] ?? match[1]}`;
  if (text === "цель невидима") return "target invisible";
  return CONDITION_WORD[text] ?? text;
}
