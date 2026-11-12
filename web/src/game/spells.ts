/*
 * Spell cards for the spells the table's heroes and the hero builder use
 * (SRD 5.1, CC BY 4.0; retold briefly in plain words). Hero sheets list spells
 * by their Russian name, or by the English one on an English page, sometimes
 * as "Cantrips: A, B" lines — `spellNames` splits those.
 */

export interface SpellCard {
  ru: string;
  en: string;
  /** 0 for a cantrip. */
  level: number;
  time: [string, string];
  range: [string, string];
  duration: [string, string];
  concentration?: boolean;
  ritual?: boolean;
  text: [string, string];
}

const ACTION: [string, string] = ["действие", "1 action"];
const BONUS: [string, string] = ["бонусное действие", "1 bonus action"];
const NOW: [string, string] = ["мгновенно", "instantaneous"];
const TOUCH: [string, string] = ["касание", "touch"];
const SELF: [string, string] = ["на себя", "self"];
const ft = (n: number): [string, string] => [`${n} фт`, `${n} ft`];
const minutes = (n: number): [string, string] => [n === 1 ? "1 минута" : `${n} минут`, n === 1 ? "1 minute" : `${n} minutes`];
const hours = (n: number): [string, string] => [n === 1 ? "1 час" : `${n} часов`, n === 1 ? "1 hour" : `${n} hours`];

export const SPELLS: SpellCard[] = [
  // Cantrips
  { ru: "Злая насмешка", en: "Vicious Mockery", level: 0, time: ACTION, range: ft(60), duration: NOW,
    text: ["Цель, которая вас слышит, делает спасбросок Мудрости. Провал: 1к4 психического урона и помеха на её следующую атаку. На 5-м уровне 2к4.", "A creature that hears you makes a Wisdom save. On a failure it takes 1d4 psychic damage and has disadvantage on its next attack roll. 2d4 at 5th level."] },
  { ru: "Малая иллюзия", en: "Minor Illusion", level: 0, time: ACTION, range: ft(30), duration: minutes(1),
    text: ["Создаёт звук или неподвижную картинку предмета размером до куба 5 фт. Внимательный (Анализ против СЛ ваших заклинаний) поймёт, что это иллюзия.", "Creates a sound or a still image of an object no larger than a 5-ft cube. An Investigation check against your spell save DC reveals it as an illusion."] },
  { ru: "Священное пламя", en: "Sacred Flame", level: 0, time: ACTION, range: ft(60), duration: NOW,
    text: ["Сияние падает на цель: спасбросок Ловкости или 1к8 урона излучением. Укрытие не помогает. На 5-м уровне 2к8.", "Radiance descends on a creature: Dexterity save or 1d8 radiant damage. Cover doesn't help. 2d8 at 5th level."] },
  { ru: "Указание", en: "Guidance", level: 0, time: ACTION, range: TOUCH, duration: minutes(1), concentration: true,
    text: ["Союзник один раз добавляет 1к4 к любой своей проверке характеристики. Удобно перед важной проверкой.", "A willing creature adds 1d4 to one ability check of its choice. Handy before an important check."] },
  { ru: "Свет", en: "Light", level: 0, time: ACTION, range: TOUCH, duration: hours(1),
    text: ["Предмет светится: яркий свет на 20 фт и тусклый ещё на 20 фт.", "An object sheds bright light in a 20-ft radius and dim light for another 20 ft."] },
  { ru: "Сотворение пламени", en: "Produce Flame", level: 0, time: ACTION, range: SELF, duration: minutes(10),
    text: ["Огонёк на ладони светит на 10 фт. Можно метнуть его на 30 фт: дальнобойная атака заклинанием, 1к8 огнём. На 5-м уровне 2к8.", "A flame in your hand sheds light 10 ft. You can hurl it up to 30 ft: a ranged spell attack for 1d8 fire. 2d8 at 5th level."] },
  { ru: "Огненный снаряд", en: "Fire Bolt", level: 0, time: ACTION, range: ft(120), duration: NOW,
    text: ["Дальнобойная атака заклинанием: 1к10 огнём. Поджигает горючие вещи, которые никто не держит. На 5-м уровне 2к10.", "A ranged spell attack for 1d10 fire damage. Ignites flammable objects nobody is holding. 2d10 at 5th level."] },
  { ru: "Волшебная рука", en: "Mage Hand", level: 0, time: ACTION, range: ft(30), duration: minutes(1),
    text: ["Призрачная рука открывает двери, достаёт предметы, носит до 10 фунтов. Атаковать ею нельзя.", "A spectral hand opens doors, fetches items and carries up to 10 lb. It can't attack."] },
  { ru: "Леденящее прикосновение", en: "Chill Touch", level: 0, time: ACTION, range: ft(120), duration: ["1 раунд", "1 round"],
    text: ["Дальнобойная атака заклинанием: 1к8 некротическим уроном, и цель до вашего следующего хода не лечится. Нежить ещё и атакует вас с помехой. На 5-м уровне 2к8.", "A ranged spell attack for 1d8 necrotic damage; the target can't regain hit points until your next turn. Undead also attack you with disadvantage. 2d8 at 5th level."] },
  { ru: "Фокусы", en: "Prestidigitation", level: 0, time: ACTION, range: ft(10), duration: hours(1),
    text: ["Мелкие чудеса: искры, запах, почистить или испачкать вещь, согреть или охладить еду, зажечь свечу, оставить метку.", "Small tricks: sparks or a smell, clean or soil an object, warm or chill food, light a candle, leave a mark."] },
  { ru: "Мистический заряд", en: "Eldritch Blast", level: 0, time: ACTION, range: ft(120), duration: NOW,
    text: ["Дальнобойная атака заклинанием: 1к10 силовым полем. На 5-м уровне — два луча, каждый бросает атаку отдельно.", "A ranged spell attack for 1d10 force damage. At 5th level two beams, each with its own attack roll."] },
  { ru: "Чудотворство", en: "Thaumaturgy", level: 0, time: ACTION, range: ft(30), duration: minutes(1),
    text: ["Знак силы: громовой голос, дрожь земли, пламя мерцает, двери распахиваются, глаза меняют цвет.", "A sign of power: a booming voice, tremors, flickering flames, doors flying open, eyes changing."] },

  // 1st level
  { ru: "Лечащее слово", en: "Healing Word", level: 1, time: BONUS, range: ft(60), duration: NOW,
    text: ["Союзник, которого вы видите, восстанавливает 1к4 + модификатор заклинаний хитов. Лучшее средство поднять упавшего: можно издалека и бонусным действием.", "A creature you can see regains 1d4 + your spellcasting modifier hit points. The best way to get a fallen ally up: from afar, as a bonus action."] },
  { ru: "Усыпление", en: "Sleep", level: 1, time: ACTION, range: ft(90), duration: minutes(1),
    text: ["Бросьте 5к8: столько хитов существ в радиусе 20 фт засыпает, начиная с самых слабых. Без спасброска. Будит урон или встряска. Нежить не спит.", "Roll 5d8: that many hit points of creatures within 20 ft fall asleep, weakest first. No save. Damage or a shake wakes them. Undead are immune."] },
  { ru: "Очарование личности", en: "Charm Person", level: 1, time: ACTION, range: ft(30), duration: hours(1),
    text: ["Гуманоид делает спасбросок Мудрости (с преимуществом, если вы с ним сражаетесь) или считает вас приятелем. Потом он поймёт, что его очаровали.", "A humanoid makes a Wisdom save (with advantage if you're fighting it) or regards you as a friendly acquaintance. Afterwards it knows it was charmed."] },
  { ru: "Громовая волна", en: "Thunderwave", level: 1, time: ACTION, range: ["на себя (куб 15 фт)", "self (15-ft cube)"], duration: NOW,
    text: ["Все в кубе 15 фт рядом с вами: спасбросок Телосложения. Провал — 2к8 звуком и отбрасывание на 10 фт; успех — половина урона. Слышно за 300 фт.", "Everyone in a 15-ft cube next to you makes a Constitution save: 2d8 thunder and pushed 10 ft on a failure, half damage on a success. Heard 300 ft away."] },
  { ru: "Лечение ран", en: "Cure Wounds", level: 1, time: ACTION, range: TOUCH, duration: NOW,
    text: ["Существо, которого вы касаетесь, восстанавливает 1к8 + модификатор заклинаний хитов. Нежить и конструкты не лечит.", "A creature you touch regains 1d8 + your spellcasting modifier hit points. No effect on undead or constructs."] },
  { ru: "Благословение", en: "Bless", level: 1, time: ACTION, range: ft(30), duration: minutes(1), concentration: true,
    text: ["До трёх союзников прибавляют 1к4 к броскам атаки и спасброскам.", "Up to three creatures add 1d4 to their attack rolls and saving throws."] },
  { ru: "Щит веры", en: "Shield of Faith", level: 1, time: BONUS, range: ft(60), duration: minutes(10), concentration: true,
    text: ["Сияющее поле даёт существу +2 к КД.", "A shimmering field grants a creature +2 AC."] },
  { ru: "Нанесение ран", en: "Inflict Wounds", level: 1, time: ACTION, range: TOUCH, duration: NOW,
    text: ["Рукопашная атака заклинанием: 3к10 некротическим уроном.", "A melee spell attack for 3d10 necrotic damage."] },
  { ru: "Опутывание", en: "Entangle", level: 1, time: ACTION, range: ft(90), duration: minutes(1), concentration: true,
    text: ["Лозы покрывают квадрат 20 фт: труднопроходимая местность. Кто там — спасбросок Силы или опутан. Освободиться — действие и проверка Силы.", "Vines fill a 20-ft square of difficult terrain. Creatures there make a Strength save or are restrained; an action and a Strength check frees them."] },
  { ru: "Огонь фей", en: "Faerie Fire", level: 1, time: ACTION, range: ft(60), duration: minutes(1), concentration: true,
    text: ["Существа в кубе 20 фт: спасбросок Ловкости или светятся. Атаки по ним с преимуществом, невидимыми они быть не могут.", "Creatures in a 20-ft cube make a Dexterity save or are outlined in light: attacks against them have advantage and they can't be invisible."] },
  { ru: "Волшебная стрела", en: "Magic Missile", level: 1, time: ACTION, range: ft(120), duration: NOW,
    text: ["Три светящихся дротика, каждый попадает без броска: 1к4 + 1 силовым полем. Можно в разные цели. Ячейка выше — ещё один дротик за круг.", "Three glowing darts that always hit, 1d4 + 1 force each; aim them at one or several targets. One more dart per slot level above 1st."] },
  { ru: "Щит", en: "Shield", level: 1, time: ["реакция, когда по вам попали", "1 reaction, when you are hit"], range: SELF, duration: ["до начала вашего хода", "until your next turn"],
    text: ["+5 к КД до начала вашего следующего хода — в том числе против атаки, которая вызвала заклинание. Волшебная стрела вас не ранит.", "+5 AC until the start of your next turn, including against the triggering attack. Magic Missile doesn't harm you."] },
  { ru: "Доспехи мага", en: "Mage Armor", level: 1, time: ACTION, range: TOUCH, duration: hours(8),
    text: ["Существо без доспехов получает КД 13 + модификатор Ловкости. Обычно накладывают с утра на себя.", "A creature wearing no armour gets AC 13 + its Dexterity modifier. Usually cast on yourself in the morning."] },
  { ru: "Обнаружение магии", en: "Detect Magic", level: 1, time: ACTION, range: SELF, duration: minutes(10), concentration: true, ritual: true,
    text: ["Вы чувствуете магию в 30 фт и видите ауру вокруг магических предметов и существ. Ритуалом — без траты ячейки, но на 10 минут дольше.", "You sense magic within 30 ft and see auras around magical creatures and objects. As a ritual it costs no slot but takes 10 minutes longer."] },
  { ru: "Огненные ладони", en: "Burning Hands", level: 1, time: ACTION, range: ["на себя (конус 15 фт)", "self (15-ft cone)"], duration: NOW,
    text: ["Конус огня 15 фт: спасбросок Ловкости, 3к6 огнём, половина при успехе.", "A 15-ft cone of fire: Dexterity save, 3d6 fire damage, half on a success."] },
  { ru: "Божественная благосклонность", en: "Divine Favor", level: 1, time: BONUS, range: SELF, duration: minutes(1), concentration: true,
    text: ["Ваши атаки оружием наносят ещё 1к4 урона излучением.", "Your weapon attacks deal an extra 1d4 radiant damage."] },
  { ru: "Метка охотника", en: "Hunter's Mark", level: 1, time: BONUS, range: ft(90), duration: hours(1), concentration: true,
    text: ["Отметьте цель: каждое попадание оружием по ней наносит ещё 1к6. Вы с преимуществом ищете её Внимательностью и Выживанием. Если цель упала, метку можно перенести бонусным действием.", "Mark a creature: your weapon hits on it deal an extra 1d6, and you have advantage on Perception and Survival checks to find it. If it drops to 0, move the mark as a bonus action."] },

  // 2nd level
  { ru: "Невидимость", en: "Invisibility", level: 2, time: ACTION, range: TOUCH, duration: hours(1), concentration: true,
    text: ["Существо становится невидимым, пока не атакует или не сотворит заклинание.", "A creature turns invisible until it attacks or casts a spell."] },
  { ru: "Удержание личности", en: "Hold Person", level: 2, time: ACTION, range: ft(60), duration: minutes(1), concentration: true,
    text: ["Гуманоид делает спасбросок Мудрости или парализован. В конце каждого своего хода он повторяет спасбросок. Попадания рукопашными атаками в 5 фт — критические.", "A humanoid makes a Wisdom save or is paralyzed; it repeats the save at the end of each of its turns. Melee hits from within 5 ft are critical."] },
  { ru: "Духовное оружие", en: "Spiritual Weapon", level: 2, time: BONUS, range: ft(60), duration: minutes(1),
    text: ["Парящее призрачное оружие: рукопашная атака заклинанием, 1к8 + модификатор силовым полем. Каждый ход бонусным действием двигайте его на 20 фт и атакуйте снова. Концентрации не нужно.", "A floating spectral weapon: a melee spell attack for 1d8 + your modifier force damage. Each turn, as a bonus action, move it 20 ft and attack again. No concentration."] },
  { ru: "Малое восстановление", en: "Lesser Restoration", level: 2, time: ACTION, range: TOUCH, duration: NOW,
    text: ["Снимает с существа одну болезнь или одно состояние: ослеплён, оглох, парализован или отравлен.", "Ends one disease or one condition on a creature: blinded, deafened, paralyzed or poisoned."] },
  { ru: "Лунный луч", en: "Moonbeam", level: 2, time: ACTION, range: ft(120), duration: minutes(1), concentration: true,
    text: ["Столб лунного света радиусом 5 фт. Кто входит в него или начинает там ход: спасбросок Телосложения, 2к10 излучением, половина при успехе. Действием луч можно сдвинуть на 60 фт.", "A 5-ft-radius column of moonlight. A creature entering it or starting its turn there makes a Constitution save: 2d10 radiant, half on a success. Move it 60 ft as an action."] },
  { ru: "Порыв ветра", en: "Gust of Wind", level: 2, time: ACTION, range: ["на себя (линия 60 фт)", "self (60-ft line)"], duration: minutes(1), concentration: true,
    text: ["Сильный ветер линией 60 × 10 фт: спасбросок Силы или отбрасывает на 15 фт. Идти против ветра вдвое медленнее. Гасит огонь, разгоняет туман.", "A strong wind in a 60 × 10-ft line: Strength save or pushed 15 ft. Moving against it costs double. Puts out flames and disperses gas."] },
  { ru: "Магическое оружие", en: "Magic Weapon", level: 2, time: BONUS, range: TOUCH, duration: hours(1), concentration: true,
    text: ["Обычное оружие становится магическим: +1 к броскам атаки и урона.", "A nonmagical weapon becomes magical with +1 to attack and damage rolls."] },
  { ru: "Найти скакуна", en: "Find Steed", level: 2, time: minutes(10), range: ft(30), duration: NOW,
    text: ["Появляется верный дух-скакун (боевой конь, пони, верблюд, лось или мастиф) и понимает вас.", "A loyal spirit steed (warhorse, pony, camel, elk or mastiff) appears and understands you."] },
  { ru: "Бесследное передвижение", en: "Pass without Trace", level: 2, time: ACTION, range: SELF, duration: hours(1), concentration: true,
    text: ["Вы и союзники в 30 фт получаете +10 к Скрытности, и вас нельзя выследить без магии.", "You and allies within 30 ft get +10 to Stealth and can't be tracked except by magic."] },
  { ru: "Тёмное зрение", en: "Darkvision", level: 2, time: ACTION, range: TOUCH, duration: hours(8),
    text: ["Существо видит в темноте на 60 фт (как в тусклом свете).", "A creature can see in darkness within 60 ft as if it were dim light."] },
  { ru: "Отражения", en: "Mirror Image", level: 2, time: ACTION, range: SELF, duration: minutes(1),
    text: ["Три иллюзорных двойника. Когда по вам атакуют, к20 решает, не попадут ли по двойнику (6+ при трёх, 8+ при двух, 11+ при одном). Двойник исчезает от попадания.", "Three illusory duplicates. When you're attacked, a d20 decides whether a duplicate is targeted instead (6+ with three, 8+ with two, 11+ with one). A hit destroys it."] },
  { ru: "Паучье лазание", en: "Spider Climb", level: 2, time: ACTION, range: TOUCH, duration: hours(1), concentration: true,
    text: ["Существо ходит по стенам и потолку, руки свободны.", "A creature climbs walls and ceilings with its hands free."] },
  { ru: "Туманный шаг", en: "Misty Step", level: 2, time: BONUS, range: SELF, duration: NOW,
    text: ["Телепорт на 30 фт в свободное место, которое вы видите. Отличный способ выйти из окружения.", "Teleport up to 30 ft to an unoccupied space you can see. A great way out of being surrounded."] },
  { ru: "Тьма", en: "Darkness", level: 2, time: ACTION, range: ft(60), duration: minutes(10), concentration: true,
    text: ["Магическая тьма радиусом 15 фт: тёмное зрение и обычный свет её не пробивают.", "Magical darkness in a 15-ft radius; darkvision and nonmagical light can't pierce it."] },
  { ru: "Паутина", en: "Web", level: 2, time: ACTION, range: ft(60), duration: hours(1), concentration: true,
    text: ["Куб 20 фт липкой паутины: труднопроходимая местность. Спасбросок Ловкости или опутан; освободиться — проверка Силы. Паутина горит.", "A 20-ft cube of sticky webs, difficult terrain. Dexterity save or restrained; a Strength check frees a creature. The webs burn."] },
  { ru: "Палящий луч", en: "Scorching Ray", level: 2, time: ACTION, range: ft(120), duration: NOW,
    text: ["Три огненных луча, каждый — отдельная дальнобойная атака заклинанием на 2к6 огнём. Можно в разные цели.", "Three rays of fire, each a separate ranged spell attack for 2d6 fire; aim them at one or several targets."] },

  // 3rd level
  { ru: "Гипнотический узор", en: "Hypnotic Pattern", level: 3, time: ACTION, range: ft(120), duration: minutes(1), concentration: true,
    text: ["Мерцающий узор в кубе 30 фт: спасбросок Мудрости или очарован, недееспособен и не двигается. Урон или встряска будит.", "A twisting pattern in a 30-ft cube: Wisdom save or charmed, incapacitated and with speed 0. Damage or a shake ends it."] },
  { ru: "Рассеивание магии", en: "Dispel Magic", level: 3, time: ACTION, range: ft(120), duration: NOW,
    text: ["Заканчивает заклинания 3-го круга и ниже на цели. Против более сильных — проверка вашей характеристики заклинаний, СЛ 10 + круг.", "Ends spells of 3rd level or lower on the target. For stronger ones make a spellcasting ability check, DC 10 + the spell's level."] },
  { ru: "Духовные стражи", en: "Spirit Guardians", level: 3, time: ACTION, range: ["на себя (радиус 15 фт)", "self (15-ft radius)"], duration: minutes(10), concentration: true,
    text: ["Духи кружат вокруг вас на 15 фт: враги там двигаются вдвое медленнее. Враг, входящий или начинающий там ход: спасбросок Мудрости, 3к8 излучением, половина при успехе.", "Spirits circle you within 15 ft: enemies there move at half speed. An enemy entering or starting its turn there makes a Wisdom save: 3d8 radiant, half on a success."] },
  { ru: "Возрождение", en: "Revivify", level: 3, time: ACTION, range: TOUCH, duration: NOW,
    text: ["Существо, умершее не больше минуты назад, оживает с 1 хитом. Нужен алмаз за 300 зм, он исчезает.", "A creature that died within the last minute returns to life with 1 hit point. Consumes a diamond worth 300 gp."] },
  { ru: "Маяк надежды", en: "Beacon of Hope", level: 3, time: ACTION, range: ft(30), duration: minutes(1), concentration: true,
    text: ["Союзники получают преимущество на спасброски Мудрости и от смерти, а любое лечение даёт им максимум хитов.", "Allies have advantage on Wisdom and death saves, and any healing gives them the maximum possible."] },
  { ru: "Призыв молнии", en: "Call Lightning", level: 3, time: ACTION, range: ft(120), duration: minutes(10), concentration: true,
    text: ["Над полем боя грозовая туча. Действием бейте молнией в точку: все в 5 фт — спасбросок Ловкости, 3к10 электричеством, половина при успехе.", "A storm cloud gathers. As an action strike a point: everyone within 5 ft makes a Dexterity save, 3d10 lightning, half on a success."] },
  { ru: "Слияние с камнем", en: "Meld into Stone", level: 3, time: ACTION, range: TOUCH, duration: hours(8), ritual: true,
    text: ["Вы со снаряжением входите в каменную стену или глыбу и прячетесь внутри.", "You and your gear step into a stone wall or block and hide inside it."] },
  { ru: "Огненный шар", en: "Fireball", level: 3, time: ACTION, range: ft(150), duration: NOW,
    text: ["Взрыв радиусом 20 фт: спасбросок Ловкости, 8к6 огнём, половина при успехе. Осторожно с союзниками!", "An explosion in a 20-ft radius: Dexterity save, 8d6 fire damage, half on a success. Mind your allies!"] },
  { ru: "Ускорение", en: "Haste", level: 3, time: ACTION, range: ft(30), duration: minutes(1), concentration: true,
    text: ["Союзник: скорость вдвое больше, +2 к КД, преимущество на спасброски Ловкости и лишнее действие каждый ход (одна атака оружием, рывок, отход, засада или предмет). Когда заклинание кончается, он ход пропускает.", "An ally gets double speed, +2 AC, advantage on Dexterity saves and an extra action each turn (one weapon attack, Dash, Disengage, Hide or Use an Object). When it ends, the ally loses a turn."] },
  { ru: "Контрзаклинание", en: "Counterspell", level: 3, time: ["реакция", "1 reaction"], range: ft(60), duration: NOW,
    text: ["Прерывает чужое заклинание в момент сотворения: 3-й круг и ниже не срабатывают, против более сильных — проверка, СЛ 10 + круг.", "Interrupts a creature casting a spell: 3rd level or lower simply fails; stronger ones need an ability check, DC 10 + the spell's level."] },
  { ru: "Полёт", en: "Fly", level: 3, time: ACTION, range: TOUCH, duration: minutes(10), concentration: true,
    text: ["Существо летает со скоростью 60 фт. Если заклинание кончится в воздухе — оно падает.", "A creature gains a flying speed of 60 ft. If the spell ends while it is aloft, it falls."] },
  { ru: "Молния", en: "Lightning Bolt", level: 3, time: ACTION, range: ["на себя (линия 100 фт)", "self (100-ft line)"], duration: NOW,
    text: ["Линия молнии 100 × 5 фт: спасбросок Ловкости, 8к6 электричеством, половина при успехе.", "A 100 × 5-ft line of lightning: Dexterity save, 8d6 lightning damage, half on a success."] },
];

const BY_NAME = new Map<string, SpellCard>();
for (const spell of SPELLS) {
  BY_NAME.set(spell.ru.toLowerCase(), spell);
  BY_NAME.set(spell.en.toLowerCase(), spell);
}

export function findSpell(name: string): SpellCard | undefined {
  return BY_NAME.get(name.trim().toLowerCase());
}

/** Names from a sheet's spell lines: plain names or "Cantrips: A, B" / "1-й круг (подготовлены): A, B". */
export function spellNames(lines: readonly string[]): string[] {
  const names: string[] = [];
  for (const line of lines) {
    const list = line.includes(": ") ? line.slice(line.indexOf(": ") + 2) : line;
    for (const part of list.split(",")) {
      const name = part.trim().replace(/\.$/, "");
      if (name && !names.includes(name)) names.push(name);
    }
  }
  return names;
}
