import type { Skill } from "../../../src/shared/tabletop.js";

/*
 * The table's built-in rules help: D&D 5e (SRD 5.1) told in plain words for
 * people at their first game, plus how this table works. The "now" section is
 * assembled by GameHelp.vue from the table's state; these are the fixed ones.
 */

export type HelpId = "now" | "basics" | "turn" | "combat" | "conditions" | "rest" | "magic" | "table" | "gm" | "words";

export interface HelpBlock {
  h?: string;
  p?: string;
  list?: string[];
  /** First row is the header. */
  table?: string[][];
  /** A short highlighted hint. */
  tip?: string;
}

export interface HelpSection {
  id: Exclude<HelpId, "now" | "conditions">;
  icon: string;
  title: string;
  gmOnly?: boolean;
  blocks: HelpBlock[];
}

export interface HelpText {
  button: string;
  title: string;
  search: string;
  nothing: string;
  nowTitle: string;
  conditionsTitle: string;
  conditionsLead: string;
  exhaustionTitle: string;
  firstTime: string;
  firstTimeOpen: string;
  dismiss: string;
  skillsTitle: string;
  more: string;
  sections: HelpSection[];
  skills: Record<Skill, string>;
  now: NowText;
}

/** Sentences for the "what is happening now" section. */
export interface NowText {
  spectator: string[];
  lobbyGm: string[];
  lobbyNoHero: string[];
  lobbyNotReady: string[];
  lobbyReady: string[];
  story: string[];
  explore: string[];
  checkForYou: (label: string) => string[];
  initiativeRoll: string[];
  initiativeWait: string[];
  yourTurn: (speed: number) => string[];
  otherTurn: (name: string) => string[];
  dying: string[];
  stable: string[];
  dead: string[];
  levelUp: string[];
  gmPlay: string[];
  gmCombat: string[];
  gmChecks: string[];
}

const ru: HelpText = {
  button: "Справка",
  title: "Справка по игре",
  search: "Поиск: инициатива, КД, отравлен…",
  nothing: "Ничего не нашлось",
  nowTitle: "Что сейчас",
  conditionsTitle: "Состояния",
  conditionsLead: "Состояния ставит ведущий (на героя — и сам игрок). Помеху и преимущество от них стол учитывает сам и пишет причину в журнале.",
  exhaustionTitle: "Истощение (уровни 1–6)",
  firstTime: "Первый раз играете? Справка расскажет, что происходит и что можно сделать.",
  firstTimeOpen: "Открыть справку",
  dismiss: "Понятно",
  skillsTitle: "Навыки",
  more: "Подробнее",
  skills: {
    acrobatics: "равновесие, кувырки, вывернуться из захвата",
    animalHandling: "успокоить зверя, править конём",
    arcana: "знания о магии, рунах, артефактах",
    athletics: "лазать, прыгать, плыть, схватить и толкнуть",
    deception: "убедительно солгать, отвлечь",
    history: "прошлое, королевства, войны, легенды",
    insight: "понять, врёт ли собеседник и чего он хочет",
    intimidation: "напугать угрозой или видом",
    investigation: "найти улику, разобраться в механизме или ловушке",
    medicine: "стабилизировать умирающего (СЛ 10), понять, от чего рана",
    nature: "звери, растения, погода, местность",
    perception: "заметить засаду, услышать шорох, найти дверь",
    performance: "музыка, танец, представление",
    persuasion: "уговорить честно, договориться",
    religion: "боги, культы, нежить, обряды",
    sleightOfHand: "залезть в карман, спрятать предмет, фокус",
    stealth: "красться, прятаться в тени",
    survival: "идти по следу, найти дорогу и еду",
  },
  sections: [
    {
      id: "basics", icon: "🎲", title: "Как устроена игра",
      blocks: [
        { p: "Ведущий описывает мир и играет за всех, кроме героев. Вы говорите голосом или в чате, что делает ваш герой. Если исход неочевиден, ведущий просит бросить кубик." },
        { tip: "Не нужно знать правила, чтобы играть: говорите, что хотите сделать, а ведущий скажет, что бросать." },
        { h: "Бросок к20", p: "Почти всё решает двадцатигранник: к20 + модификатор. Если вышло не меньше сложности (СЛ), получилось. Сложность знает только ведущий, а стол сам покажет «успех» или «провал»." },
        { table: [["СЛ", "Насколько трудно"], ["5", "очень легко"], ["10", "легко"], ["15", "средне"], ["20", "трудно"], ["25", "очень трудно"], ["30", "почти невозможно"]] },
        { h: "Шесть характеристик", list: [
          "Сила: поднять, толкнуть, ударить мечом",
          "Ловкость: увернуться, прокрасться, выстрелить из лука",
          "Телосложение: выносливость и хиты",
          "Интеллект: знания и рассуждение",
          "Мудрость: внимательность, интуиция, сила воли",
          "Харизма: обаяние, ложь, лидерство",
        ] },
        { p: "Значение 10–11 даёт +0, каждые 2 сверху ещё +1 (14 → +2, 16 → +3), каждые 2 снизу −1 (8 → −1). В бросок идёт именно модификатор." },
        { h: "Бонус мастерства", p: "Если герой владеет навыком, оружием или спасброском, к броску прибавляется бонус мастерства: +2 на 1–4 уровне, +3 на 5-м. Экспертиза удваивает его. Лист героя уже всё посчитал: число на кнопке и есть ваш бонус." },
        { h: "Спасбросок", p: "Это не ваше действие, а ответ на опасность: Ловкость, чтобы увернуться от огня, Телосложение, чтобы выдержать яд, Мудрость, чтобы не поддаться чарам." },
        { h: "Преимущество и помеха", p: "При преимуществе бросаются два к20 и берётся больший, при помехе — меньший. И то и другое сразу дают обычный бросок. Ведущий говорит, когда они есть; от состояний стол ставит их сам и пишет почему." },
        { h: "20 и 1", p: "В атаке натуральная 20 на кубике — крит: попадание, и кубики урона удваиваются. Натуральная 1 — промах. Для проверок навыков на этом столе 20 тоже всегда успех, а 1 всегда провал." },
      ],
    },
    {
      id: "turn", icon: "⚔", title: "Ваш ход в бою",
      blocks: [
        { h: "Инициатива", p: "Когда начинается бой, все бросают инициативу (к20 + Ловкость). Ходят по очереди, от большей к меньшей. Полный круг называется раундом, это около 6 секунд в мире игры." },
        { h: "Что можно за свой ход", list: [
          "Переместиться на свою скорость: 30 фт — это 6 клеток (одна клетка = 5 фт). Можно частями, до и после действия.",
          "Одно действие (список ниже).",
          "Бонусное действие, если умение или заклинание прямо так сказано (например, «Второе дыхание», «Хитрое действие»).",
          "Мелочи бесплатно: сказать пару слов, открыть дверь, достать оружие.",
        ] },
        { h: "Действия", table: [
          ["Действие", "Что даёт"],
          ["Атака", "удар оружием или выстрел"],
          ["Заклинание", "сотворить заклинание из листа"],
          ["Рывок", "ещё одно перемещение на скорость"],
          ["Отход", "уйти от врагов без провоцированных атак"],
          ["Уклонение", "атаки по вам с помехой, спасброски Ловкости с преимуществом"],
          ["Помощь", "союзник получает преимущество на следующий бросок"],
          ["Засада", "спрятаться (Скрытность)"],
          ["Подготовка", "«если враг откроет дверь — стреляю»: срабатывает реакцией"],
          ["Поиск", "Внимательность или Анализ"],
          ["Использовать предмет", "выпить зелье, бросить факел"],
        ] },
        { h: "Реакция", p: "Одна за раунд, даже не в свой ход. Самая частая — провоцированная атака: враг уходит из вашей досягаемости, вы бьёте вслед. На этом столе кубики можно бросать в любой момент, так что реакции работают просто: скажите и бросьте." },
        { h: "Как атаковать здесь", list: [
          "Нажмите на врага на карте: он станет целью.",
          "В «Действиях» нажмите бонус атаки (например, +5). Стол сравнит результат с КД цели и скажет «попал» или «мимо».",
          "При попадании нажмите кнопку урона. Ведущий применит урон к цели.",
          "Закончили — нажмите «Конец хода».",
        ] },
        { tip: "Можно всё, что придумаете: сбросить люстру, перекатиться под столом, уговорить врага сдаться. Опишите, а ведущий решит, что бросать." },
      ],
    },
    {
      id: "combat", icon: "❤", title: "Урон, хиты и смерть",
      blocks: [
        { h: "КД и хиты", p: "Класс доспеха (КД) показывает, как трудно по вам попасть: атака попадает, если результат не меньше КД. Хиты — запас сил. Урон их отнимает, лечение возвращает (не выше максимума)." },
        { h: "0 хитов", p: "Герой падает без сознания и начинает умирать. В начале каждого своего хода он бросает спасбросок от смерти: чистый к20 без бонусов." },
        { list: [
          "10 и больше — успех, меньше 10 — провал.",
          "Три успеха — герой стабилен, без сознания, но не умрёт.",
          "Три провала — смерть.",
          "1 на кубике — два провала, 20 — герой встаёт с 1 хитом.",
          "Урон по лежащему — ещё один провал.",
          "Любое лечение поднимает героя сразу.",
        ] },
        { tip: "Друг может спасти умирающего: проверка Медицины СЛ 10 делает его стабильным. Зелье лечения поднимает на ноги." },
        { h: "Укрытие", table: [["Укрытие", "Эффект"], ["Половинное (бочка, колонна)", "+2 к КД и спасброскам Ловкости"], ["На три четверти (бойница)", "+5"], ["Полное", "по вам нельзя попасть напрямую"]] },
        { h: "Полезно знать", list: [
          "Стрелять или колдовать дальнюю атаку, когда враг рядом, — с помехой.",
          "Схватить или толкнуть — проверка Атлетики против Атлетики или Акробатики цели.",
          "По лежащему врагу рукопашные атаки идут с преимуществом, стрелы — с помехой.",
          "Невидимого труднее ударить (помеха), а сам он бьёт с преимуществом.",
        ] },
      ],
    },
    {
      id: "rest", icon: "🌙", title: "Отдых, ресурсы, магия",
      blocks: [
        { h: "Короткий отдых", p: "Около часа передышки. Можно потратить кости хитов: бросок кости плюс Телосложение возвращает хиты. Восстанавливаются умения с пометкой «кор. отдых» (второе дыхание, ячейки колдуна…)." },
        { h: "Долгий отдых", p: "Ночь сна. Возвращает все хиты, ячейки заклинаний, умения, половину костей хитов и снимает один уровень истощения." },
        { tip: "Отдых объявляет ведущий кнопкой в карточке партии. Свои ресурсы вы отмечаете кружками в карточке «Ресурсы»." },
        { h: "Заклинания", p: "Заговоры бесплатны и бесконечны. Заклинание 1-го круга и выше тратит ячейку этого круга (или выше)." },
        { list: [
          "Атакующее заклинание бросается как атака по цели.",
          "Заклинание со спасброском (огненные ладони, священное пламя): нажмите «Спасбросок», отметьте цели, и стол бросит урон и спасброски всех целей.",
          "СЛ ваших заклинаний = 8 + бонус мастерства + магическая характеристика; она уже записана в листе.",
        ] },
        { h: "Концентрация", p: "Некоторые заклинания держатся, пока вы концентрируетесь, и только одно за раз. Получив урон, вы делаете спасбросок Телосложения СЛ 10 (или половина урона, если она больше), иначе заклинание прерывается. Отметьте 🔮 «Концентрация» — стол будет бросать сам." },
      ],
    },
    {
      id: "table", icon: "🖱", title: "Как пользоваться столом",
      blocks: [
        { h: "Сесть за стол", list: [
          "«Свободное место» — стать игроком, «Стать ведущим» — вести игру.",
          "Выберите готового героя или соберите своего («Создать героя»).",
          "Нажмите «Готов». Ведущий начнёт игру, когда все готовы.",
        ] },
        { h: "Лист героя", list: [
          "Нажмите на навык, спасбросок или характеристику, чтобы бросить.",
          "Если ведущий сказал «с преимуществом», выберите режим справа перед броском.",
          "Хиты, состояния, ресурсы и инвентарь — в карточках слева.",
        ] },
        { h: "Карта", list: [
          "Перетащите свою фишку, чтобы пойти. Подпись покажет расстояние.",
          "Колесо мыши — масштаб, перетаскивание пустого места — сдвиг.",
          "Двойной щелчок — метка, которую видят все («сюда!»).",
          "Щелчок по фишке делает её целью для атак.",
          "Тёмные места — туман: там ещё не были, он открывается вокруг героев.",
        ] },
        { h: "Кубики и журнал", p: "Все кубики бросает сервер, подделать их нельзя. Свой бросок можно набрать вручную: «2d6+3» или «2к6+3». В журнале справа видны все броски, а значок 🎲 в середине экрана показывает последний." },
        { h: "Свой герой", p: "Собранные герои хранятся в вашем браузере (и на сервере, если у вас TeamSpeak-идентичность), растут до 5-го уровня и подходят к любому приключению. Кнопка «Повысить уровень» появится, когда хватит опыта." },
      ],
    },
    {
      id: "gm", icon: "🧙", title: "Ведущему", gmOnly: true,
      blocks: [
        { h: "Перед игрой", list: [
          "Выберите приключение в лобби. В карточке сцены есть текст для чтения вслух, заметки, музыка и подготовленные монстры.",
          "Начните с «Показать игрокам», чтобы задать настроение.",
        ] },
        { h: "Когда просить бросок", p: "Только если исход неочевиден и у провала есть интересные последствия. Открыть незапертую дверь — не бросок. Взломать замок под стражей — бросок." },
        { list: [
          "«Запросить проверку»: навык, СЛ (таблица во вкладке «Как устроена игра») и кому. Игроки увидят карточку с кнопкой.",
          "Групповая проверка: если справилась хотя бы половина — успех всей группы.",
          "Скрытый бросок — для того, что игроки не должны знать (например, Внимательность против засады).",
          "Находчивость можно поощрять преимуществом.",
        ] },
        { h: "Бой", list: [
          "Расставьте монстров (список слева, затем щелчок по карте), при желании спрятанными.",
          "«Начать бой»: стол бросит инициативу монстрам и подождёт игроков.",
          "В ход монстра выберите цель и нажмите его атаку, затем урон и «нанести».",
          "«Применить…» у любого броска в журнале — урон, половина или лечение выбранным фишкам.",
          "«⚠ Опасность» — своя ловушка со спасброском и состоянием при провале.",
          "«Своё существо» — монстр, которого нет в приключении.",
        ] },
        { h: "Награды и отдых", table: [["Что", "Опыт на героя, 1–2 уровень"], ["Лёгкий бой", "≈ 25–50"], ["Обычный бой", "≈ 50–100"], ["Трудный бой", "≈ 100–150"], ["Хорошая идея, решённая загадка", "≈ 25–50"]] },
        { tip: "Правило «да, но…»: если игрок придумал что-то, чего нет в правилах, — разрешите и назначьте бросок. Хорошая история важнее точных правил." },
      ],
    },
    {
      id: "words", icon: "📖", title: "Словарь",
      blocks: [
        { table: [
          ["Слово", "Что значит"],
          ["к20 (d20)", "двадцатигранный кубик; 2к6 — два шестигранных"],
          ["Ведущий (мастер, ГМ)", "рассказывает историю и играет за мир"],
          ["КД", "класс доспеха: сколько нужно выбросить, чтобы попасть"],
          ["СЛ", "сложность проверки или спасброска"],
          ["Хиты", "здоровье героя"],
          ["Модификатор", "прибавка от характеристики: −1, +0, +2…"],
          ["Бонус мастерства", "+2…+3 к тому, чем герой владеет"],
          ["Спасбросок", "бросок, чтобы избежать опасности"],
          ["Инициатива", "очерёдность в бою"],
          ["Раунд", "все сходили по разу, ≈ 6 секунд"],
          ["Преимущество / помеха", "бросить 2к20 и взять лучший / худший"],
          ["Крит", "20 на кубике атаки: двойные кубики урона"],
          ["Ячейка заклинания", "«патрон» для заклинания 1-го круга и выше"],
          ["Заговор", "заклинание без ячейки"],
          ["Концентрация", "держит заклинание, пока не собьют"],
          ["НИП", "неигровой персонаж: все, за кого играет ведущий"],
          ["Ваншот", "приключение на один вечер"],
          ["фт", "футы: одна клетка карты = 5 фт"],
        ] },
      ],
    },
  ],
  now: {
    spectator: ["Вы зритель: видите карту, журнал и общий рассказ.", "Чтобы играть, нажмите «Свободное место», чтобы вести — «Стать ведущим» (если место ведущего свободно)."],
    lobbyGm: ["Вы ведущий. Выберите приключение в карточке «Партия».", "Игроки выбирают героев и нажимают «Готов». Когда все готовы, нажмите «Начать игру».", "Совет: прочитайте заметки первой сцены — там подсказки, что бросать и что спрятано."],
    lobbyNoHero: ["Выберите героя: готового из приключения или своего («Создать героя»).", "Новичкам проще с готовым: у него уже всё подобрано. Посмотрите историю героя — её удобно отыгрывать."],
    lobbyNotReady: ["Герой выбран. Посмотрите его лист после начала игры, а пока нажмите «Готов»."],
    lobbyReady: ["Вы готовы. Ждём остальных и ведущего.", "Пока можно открыть вкладку «Как устроена игра» — это 2 минуты чтения."],
    story: ["Идёт сюжетная сцена. Слушайте ведущего и говорите, что делает ваш герой: расспросить, осмотреться, пойти дальше.", "Если ведущий попросит бросок, появится карточка с кнопкой."],
    explore: ["Вы на карте. Перетаскивайте свою фишку, чтобы ходить; туман откроется вокруг.", "Хотите что-то осмотреть, открыть, найти — скажите ведущему. Обычно это Внимательность или Анализ."],
    checkForYou: label => [`Ведущий просит бросок: «${label}». Нажмите кнопку в карточке проверки сверху листа.`, "Сложность знает только ведущий; стол сам покажет успех или провал."],
    initiativeRoll: ["Начался бой! Бросьте инициативу — кнопка в полоске очерёдности.", "После этого все ходят по очереди, от большей инициативы к меньшей."],
    initiativeWait: ["Начался бой. Ждём, пока остальные бросят инициативу."],
    yourTurn: speed => [`Ваш ход! Можно пройти до ${speed} фт (${Math.floor(speed / 5)} клеток), сделать одно действие и, если умение позволяет, бонусное.`, "Атака: щёлкните по врагу на карте → бонус атаки в «Действиях» → при попадании урон.", "Закончили — нажмите «Конец хода»."],
    otherTurn: name => [`Сейчас ходит ${name}. Можно продумать свой ход.`, "Реакция: если враг уходит от вас, можно ударить вслед (провоцированная атака) — скажите ведущему и бросьте атаку."],
    dying: ["Ваш герой при смерти (0 хитов). В свой ход бросайте спасбросок от смерти кнопкой на листе.", "10+ — успех, три успеха — стабилен; три провала — смерть. Союзник может спасти Медициной (СЛ 10) или лечением."],
    stable: ["Герой стабилен: без сознания, но не умирает. Через 1к4 часа очнётся с 1 хитом, а лечение поднимет сразу."],
    dead: ["Герой погиб. Воскресить его может только ведущий (например, заклинанием «Возрождение»). Можно продолжить новым героем."],
    levelUp: ["Опыта хватает на новый уровень! Нажмите «Повысить уровень» на листе (вне боя)."],
    gmPlay: ["Вы ведёте игру. Сцены переключаются стрелками над картой, текст сцены — «Показать игрокам».", "Просите броски карточкой «Запросить проверку», если исход неочевиден. Подсказки — во вкладке «Ведущему»."],
    gmCombat: ["Идёт бой. Ход монстра: выберите цель, нажмите атаку монстра, затем урон и «нанести».", "«Следующий ход» передаёт очередь; урон по героям применяется кнопками в журнале."],
    gmChecks: ["Ждём бросков по вашей проверке — карточка слева показывает, кто ещё не бросил."],
  },
};

const en: HelpText = {
  button: "Help",
  title: "Game help",
  search: "Search: initiative, AC, poisoned…",
  nothing: "Nothing found",
  nowTitle: "Right now",
  conditionsTitle: "Conditions",
  conditionsLead: "The game master sets conditions (players may set their own hero's). The table applies the advantage and disadvantage they give and writes why in the log.",
  exhaustionTitle: "Exhaustion (levels 1–6)",
  firstTime: "First game? The help explains what is going on and what you can do.",
  firstTimeOpen: "Open help",
  dismiss: "Got it",
  skillsTitle: "Skills",
  more: "More",
  skills: {
    acrobatics: "balance, tumbling, slipping out of a grapple",
    animalHandling: "calming a beast, riding",
    arcana: "lore of magic, runes and artefacts",
    athletics: "climbing, jumping, swimming, grappling and shoving",
    deception: "lying convincingly, distracting",
    history: "the past, kingdoms, wars, legends",
    insight: "telling whether someone lies and what they want",
    intimidation: "scaring with threats or looks",
    investigation: "finding clues, working out mechanisms and traps",
    medicine: "stabilising the dying (DC 10), reading wounds",
    nature: "beasts, plants, weather, terrain",
    perception: "spotting ambushes, hearing noises, finding doors",
    performance: "music, dance, a show",
    persuasion: "convincing honestly, striking deals",
    religion: "gods, cults, undead, rites",
    sleightOfHand: "picking pockets, hiding things, tricks",
    stealth: "sneaking, hiding in the shadows",
    survival: "tracking, finding the way and food",
  },
  sections: [
    {
      id: "basics", icon: "🎲", title: "How the game works",
      blocks: [
        { p: "The game master describes the world and plays everyone except the heroes. You say, by voice or in chat, what your hero does. When the outcome is uncertain, the master asks for a roll." },
        { tip: "You do not need to know the rules to play: say what you want to do, and the master tells you what to roll." },
        { h: "The d20 roll", p: "Almost everything is a twenty-sided die: d20 + a modifier. Meet or beat the difficulty class (DC) and you succeed. Only the master knows the DC; the table shows success or failure." },
        { table: [["DC", "How hard"], ["5", "very easy"], ["10", "easy"], ["15", "medium"], ["20", "hard"], ["25", "very hard"], ["30", "nearly impossible"]] },
        { h: "Six abilities", list: [
          "Strength: lifting, pushing, swinging a sword",
          "Dexterity: dodging, sneaking, shooting a bow",
          "Constitution: stamina and hit points",
          "Intelligence: knowledge and reasoning",
          "Wisdom: awareness, intuition, willpower",
          "Charisma: charm, lies, leadership",
        ] },
        { p: "A score of 10–11 gives +0, every 2 above adds +1 (14 → +2, 16 → +3), every 2 below −1 (8 → −1). Rolls use the modifier." },
        { h: "Proficiency bonus", p: "When a hero is proficient in a skill, weapon or save, the proficiency bonus is added: +2 at levels 1–4, +3 at level 5. Expertise doubles it. The sheet has done the maths: the number on the button is your bonus." },
        { h: "Saving throw", p: "Not your action but a reaction to danger: Dexterity to dodge fire, Constitution to resist poison, Wisdom to shake off a charm." },
        { h: "Advantage and disadvantage", p: "With advantage roll two d20s and keep the higher, with disadvantage the lower. Both at once make a normal roll. The master says when; for conditions the table sets them itself and says why." },
        { h: "20 and 1", p: "On an attack a natural 20 is a critical hit: it hits and the damage dice double. A natural 1 misses. At this table a 20 on a skill check always succeeds and a 1 always fails." },
      ],
    },
    {
      id: "turn", icon: "⚔", title: "Your turn in combat",
      blocks: [
        { h: "Initiative", p: "When a fight starts everyone rolls initiative (d20 + Dexterity). Turns go from highest to lowest. One full round is about 6 seconds in the game world." },
        { h: "On your turn", list: [
          "Move up to your speed: 30 ft is 6 squares (one square = 5 ft). You may split it before and after your action.",
          "Take one action (list below).",
          "A bonus action, if a feature or spell says so (Second Wind, Cunning Action…).",
          "Small things are free: a few words, opening a door, drawing a weapon.",
        ] },
        { h: "Actions", table: [
          ["Action", "What it does"],
          ["Attack", "strike with a weapon or shoot"],
          ["Cast a spell", "a spell from your sheet"],
          ["Dash", "move your speed again"],
          ["Disengage", "leave enemies without opportunity attacks"],
          ["Dodge", "attacks against you have disadvantage, Dexterity saves advantage"],
          ["Help", "an ally gets advantage on the next roll"],
          ["Hide", "a Stealth check"],
          ["Ready", "“if the door opens, I shoot”: happens as a reaction"],
          ["Search", "Perception or Investigation"],
          ["Use an object", "drink a potion, throw a torch"],
        ] },
        { h: "Reaction", p: "One per round, even outside your turn. The usual one is an opportunity attack: an enemy leaves your reach and you strike. Dice can be rolled at any time here, so just say it and roll." },
        { h: "Attacking here", list: [
          "Click an enemy on the map: it becomes your target.",
          "Under Actions, press the attack bonus (e.g. +5). The table compares it with the target's AC and says hit or miss.",
          "On a hit, press the damage button. The master applies it.",
          "Done? Press End turn.",
        ] },
        { tip: "Anything you think of is allowed: drop the chandelier, roll under the table, talk the enemy into giving up. Describe it, and the master decides what to roll." },
      ],
    },
    {
      id: "combat", icon: "❤", title: "Damage, hit points and death",
      blocks: [
        { h: "AC and hit points", p: "Armor class (AC) is how hard you are to hit: an attack hits when it meets your AC. Hit points are your stamina: damage takes them away, healing brings them back (up to the maximum)." },
        { h: "0 hit points", p: "The hero falls unconscious and is dying. At the start of each turn they roll a death saving throw: a plain d20 with no bonus." },
        { list: [
          "10 or more succeeds, under 10 fails.",
          "Three successes: stable, unconscious but not dying.",
          "Three failures: death.",
          "A 1 counts as two failures, a 20 brings the hero up with 1 hit point.",
          "Damage while down is another failure.",
          "Any healing brings the hero back at once.",
        ] },
        { tip: "A friend can save the dying: a DC 10 Medicine check makes them stable. A healing potion gets them up." },
        { h: "Cover", table: [["Cover", "Effect"], ["Half (a barrel, a pillar)", "+2 to AC and Dexterity saves"], ["Three-quarters (an arrow slit)", "+5"], ["Total", "cannot be targeted directly"]] },
        { h: "Good to know", list: [
          "Ranged attacks with an enemy next to you have disadvantage.",
          "Grappling or shoving: Athletics against the target's Athletics or Acrobatics.",
          "Melee attacks against a prone foe have advantage, ranged ones disadvantage.",
          "An invisible creature is harder to hit (disadvantage) and attacks with advantage.",
        ] },
      ],
    },
    {
      id: "rest", icon: "🌙", title: "Rest, resources, magic",
      blocks: [
        { h: "Short rest", p: "About an hour of breather. Spend hit dice: each one rolled plus Constitution returns hit points. Short-rest features come back (Second Wind, warlock slots…)." },
        { h: "Long rest", p: "A night's sleep. All hit points, spell slots and features come back, half the hit dice too, and one level of exhaustion goes away." },
        { tip: "The master calls rests with the buttons in the party card. Mark your own uses with the dots in the Resources card." },
        { h: "Spells", p: "Cantrips are free and unlimited. A spell of level 1 or higher uses a slot of that level (or higher)." },
        { list: [
          "Spell attacks roll like weapon attacks against a target.",
          "Spells with a saving throw (Burning Hands, Sacred Flame): press Saving throw, mark the targets, and the table rolls the damage and every target's save.",
          "Your spell DC = 8 + proficiency + spellcasting ability; the sheet already shows it.",
        ] },
        { h: "Concentration", p: "Some spells last while you concentrate, one at a time. When damaged, roll a Constitution save, DC 10 or half the damage (whichever is higher), or the spell ends. Mark 🔮 Concentrating and the table rolls it for you." },
      ],
    },
    {
      id: "table", icon: "🖱", title: "Using the table",
      blocks: [
        { h: "Taking a seat", list: [
          "Free seat to play, Be the game master to run the game.",
          "Pick a ready hero or build your own (Create a hero).",
          "Press Ready. The master starts once everyone is ready.",
        ] },
        { h: "Hero sheet", list: [
          "Click a skill, save or ability to roll it.",
          "If the master says “with advantage”, pick the mode on the right before rolling.",
          "Hit points, conditions, resources and inventory are in the cards on the left.",
        ] },
        { h: "Map", list: [
          "Drag your token to move. The label shows the distance.",
          "Mouse wheel zooms, dragging empty space pans.",
          "Double-click places a mark everyone sees (“here!”).",
          "Clicking a token makes it your target.",
          "Dark areas are fog: nobody has been there yet; it opens around heroes.",
        ] },
        { h: "Dice and log", p: "The server rolls every die, so nobody can fake them. Type your own roll as “2d6+3”. The log on the right shows every roll, and the big die in the middle shows the latest." },
        { h: "Your own hero", p: "Heroes you build are kept in your browser (and on the server with a TeamSpeak identity), grow to level 5 and fit any adventure. Level up appears once you have enough experience." },
      ],
    },
    {
      id: "gm", icon: "🧙", title: "For the game master", gmOnly: true,
      blocks: [
        { h: "Before the game", list: [
          "Pick the adventure in the lobby. The scene card has read-aloud text, notes, music and prepared monsters.",
          "Start with Show to players to set the mood.",
        ] },
        { h: "When to ask for a roll", p: "Only when the outcome is uncertain and failure is interesting. Opening an unlocked door is no roll. Picking a lock under guard is." },
        { list: [
          "Ask for a check: a skill, a DC (table under How the game works) and who. Players get a card with a button.",
          "Group check: if at least half succeed, the group succeeds.",
          "Secret rolls are for what players must not know (Perception against an ambush).",
          "Reward clever ideas with advantage.",
        ] },
        { h: "Combat", list: [
          "Place monsters (list on the left, then click the map), hidden if you like.",
          "Start combat: the table rolls the monsters' initiative and waits for the players.",
          "On a monster's turn pick a target, press its attack, then damage and apply.",
          "Apply… on any roll in the log: damage, half or healing to chosen tokens.",
          "⚠ Hazard: your own trap with a save and a condition on failure.",
          "Your own creature: a monster the adventure does not have.",
        ] },
        { h: "Rewards and rest", table: [["What", "Experience per hero, levels 1–2"], ["Easy fight", "≈ 25–50"], ["Normal fight", "≈ 50–100"], ["Hard fight", "≈ 100–150"], ["A good idea, a solved riddle", "≈ 25–50"]] },
        { tip: "“Yes, but…”: when a player invents something the rules do not cover, allow it and call for a roll. A good story matters more than exact rules." },
      ],
    },
    {
      id: "words", icon: "📖", title: "Glossary",
      blocks: [
        { table: [
          ["Word", "Meaning"],
          ["d20", "a twenty-sided die; 2d6 is two six-sided dice"],
          ["Game master (GM, DM)", "tells the story and plays the world"],
          ["AC", "armor class: what an attack must reach to hit"],
          ["DC", "difficulty of a check or save"],
          ["Hit points", "the hero's health"],
          ["Modifier", "what an ability adds: −1, +0, +2…"],
          ["Proficiency bonus", "+2…+3 to what the hero is trained in"],
          ["Saving throw", "a roll to avoid danger"],
          ["Initiative", "turn order in combat"],
          ["Round", "everyone acted once, ≈ 6 seconds"],
          ["Advantage / disadvantage", "roll 2d20 and keep the best / worst"],
          ["Critical hit", "a 20 on an attack die: double damage dice"],
          ["Spell slot", "fuel for a spell of level 1 or higher"],
          ["Cantrip", "a spell that needs no slot"],
          ["Concentration", "holding a spell until it is broken"],
          ["NPC", "non-player character: anyone the master plays"],
          ["One-shot", "an adventure for one evening"],
          ["ft", "feet: one map square = 5 ft"],
        ] },
      ],
    },
  ],
  now: {
    spectator: ["You are watching: you see the map, the log and the story.", "To play, press Free seat; to run the game, Be the game master (if nobody holds it)."],
    lobbyGm: ["You are the game master. Pick an adventure in the Adventure card.", "Players pick heroes and press Ready. When everyone is ready, press Start the game.", "Tip: read the first scene's notes — they say what to roll and what is hidden."],
    lobbyNoHero: ["Pick a hero: a ready one from the adventure or your own (Create a hero).", "Newcomers find ready heroes easier: everything is chosen. Read the hero's story — it is fun to play."],
    lobbyNotReady: ["Your hero is chosen. Press Ready; you will see the full sheet once the game starts."],
    lobbyReady: ["You are ready. Waiting for the others and the master.", "Meanwhile, How the game works takes two minutes to read."],
    story: ["A story scene. Listen to the master and say what your hero does: ask around, look around, move on.", "If the master asks for a roll, a card with a button appears."],
    explore: ["You are on the map. Drag your token to walk; the fog opens around you.", "Want to search, open or find something? Tell the master — usually Perception or Investigation."],
    checkForYou: label => [`The master asks for a roll: “${label}”. Press the button in the check card above your sheet.`, "Only the master knows the DC; the table shows success or failure."],
    initiativeRoll: ["Combat! Roll initiative — the button is in the turn order strip.", "Then everyone acts in turn, from highest initiative down."],
    initiativeWait: ["Combat has started. Waiting for the others to roll initiative."],
    yourTurn: speed => [`Your turn! Move up to ${speed} ft (${Math.floor(speed / 5)} squares), take one action and, if a feature allows, a bonus action.`, "To attack: click an enemy on the map → the attack bonus under Actions → damage on a hit.", "Done? Press End turn."],
    otherTurn: name => [`It is ${name}'s turn. Plan yours.`, "Reaction: if an enemy moves away from you, you may strike as it leaves (opportunity attack) — tell the master and roll the attack."],
    dying: ["Your hero is dying (0 hit points). On your turn roll the death saving throw with the button on your sheet.", "10+ succeeds, three successes stabilise; three failures mean death. An ally can save you with Medicine (DC 10) or healing."],
    stable: ["Your hero is stable: unconscious but not dying. They wake with 1 hit point in 1d4 hours; healing brings them back at once."],
    dead: ["Your hero has died. Only the master can bring them back (Revivify, for one). You may go on with a new hero."],
    levelUp: ["You have enough experience for a new level! Press Level up on your sheet (out of combat)."],
    gmPlay: ["You are running the game. Scenes switch with the arrows above the map; Show to players reads the scene text.", "Ask for rolls with the check card when the outcome is uncertain. Tips are under For the game master."],
    gmCombat: ["Combat. On a monster's turn: pick a target, press the monster's attack, then damage and apply.", "Next turn passes the turn; damage to heroes is applied with the buttons in the log."],
    gmChecks: ["Waiting for rolls on your check — the card on the left shows who still has to roll."],
  },
};

export function helpText(russian: boolean): HelpText {
  return russian ? ru : en;
}
