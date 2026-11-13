import { parseDiceExpression } from "./tabletop.js";

/*
 * Slash commands in the chat: /roll, /coin, /pick and /timer are worked out by
 * the gateway (it rolls the dice, so nobody can fake a result) and sent as an
 * ordinary message from the person's own TeamSpeak client, so native clients
 * see them too. /help is shown only in the asker's own browser. Browser-safe.
 */

export const CHAT_COMMAND_LANGUAGES = ["ru", "en", "de", "zh", "ja"] as const;
export type ChatCommandLanguage = typeof CHAT_COMMAND_LANGUAGES[number];
export type ChatCommandName = "roll" | "coin" | "pick" | "timer" | "help";

const ALIASES: Record<string, ChatCommandName> = {
  roll: "roll", r: "roll", dice: "roll", d: "roll", кубик: "roll", кубики: "roll", кости: "roll", бросок: "roll",
  coin: "coin", flip: "coin", монетка: "coin", монета: "coin",
  pick: "pick", choose: "pick", random: "pick", выбери: "pick", выбрать: "pick", кто: "pick",
  timer: "timer", t: "timer", таймер: "timer",
  help: "help", commands: "help", помощь: "help", команды: "help", справка: "help",
};

export const TIMER_MIN_MS = 10_000;
export const TIMER_MAX_MS = 24 * 3_600_000;
export const MAX_TIMERS = 3;
const MAX_PICK = 20;

/**
 * A chat line that is a command: `/word` (Latin or Cyrillic letters) and an
 * optional argument. `name` is null for an unknown word. Anything else (a path
 * such as `/home/me`, a lone slash, a smiley) is ordinary text.
 */
export function parseChatCommand(text: string): { name: ChatCommandName | null; word: string; args: string } | null {
  const match = /^\/([a-zа-яё]{1,16})(?:\s+([\s\S]*))?$/iu.exec(text.trim());
  if (!match) return null;
  const word = match[1]!.toLowerCase();
  return { name: ALIASES[word] ?? null, word, args: (match[2] ?? "").trim() };
}

export function chatCommandLanguage(value: unknown): ChatCommandLanguage {
  return (CHAT_COMMAND_LANGUAGES as readonly unknown[]).includes(value) ? value as ChatCommandLanguage : "en";
}

type Texts = {
  roll: (expression: string, rolls: string, total: number) => string;
  natural20: string;
  natural1: string;
  heads: string;
  tails: string;
  pick: (count: number, choice: string) => string;
  timer: (length: string, label: string, at: string) => string;
  timerDone: (label: string, length: string) => string;
  timerStopped: (count: number) => string;
  minutes: (value: number) => string;
  hours: (h: number, m: number) => string;
  seconds: (value: number) => string;
  help: string;
};

const TEXTS: Record<ChatCommandLanguage, Texts> = {
  ru: {
    roll: (e, r, t) => `🎲 ${e}: ${r} = ${t}`, natural20: " — крит!", natural1: " — провал!",
    heads: "🪙 Монетка: орёл", tails: "🪙 Монетка: решка",
    pick: (n, c) => `🎯 Выбор из ${n}: ${c}`,
    timer: (l, label, at) => `⏱ Таймер на ${l}${label ? ` — ${label}` : ""} (сработает в ${at})`,
    timerDone: (label, l) => `⏰ Время!${label ? ` ${label}` : ""} (таймер на ${l})`,
    timerStopped: n => `⏹ Таймеры остановлены: ${n}`,
    minutes: v => `${v} мин`, hours: (h, m) => m ? `${h} ч ${m} мин` : `${h} ч`, seconds: v => `${v} с`,
    help: [
      "**Команды чата**",
      "`/roll 2d6+3` — бросить кубики (без аргумента — d20). Также `/r`, `/кубик`",
      "`/coin` — подбросить монетку. Также `/монетка`",
      "`/pick Саша, Мирра, Ivan` — выбрать случайно. Также `/кто`, `/выбери`",
      "`/timer 5m перерыв` — таймер: `90s`, `10` (минуты), `1h30m`; `/timer stop` — остановить свои. Также `/таймер`",
      "`/help` — этот список (видите только вы)",
      "Кубики бросает сервер, поэтому результат честный; его видят все, даже в обычном TeamSpeak.",
    ].join("\n"),
  },
  en: {
    roll: (e, r, t) => `🎲 ${e}: ${r} = ${t}`, natural20: " — critical!", natural1: " — fumble!",
    heads: "🪙 Coin: heads", tails: "🪙 Coin: tails",
    pick: (n, c) => `🎯 Picked out of ${n}: ${c}`,
    timer: (l, label, at) => `⏱ Timer for ${l}${label ? ` — ${label}` : ""} (rings at ${at})`,
    timerDone: (label, l) => `⏰ Time's up!${label ? ` ${label}` : ""} (${l} timer)`,
    timerStopped: n => `⏹ Timers stopped: ${n}`,
    minutes: v => `${v} min`, hours: (h, m) => m ? `${h} h ${m} min` : `${h} h`, seconds: v => `${v} s`,
    help: [
      "**Chat commands**",
      "`/roll 2d6+3` — roll dice (no argument: d20). Also `/r`, `/dice`",
      "`/coin` — flip a coin. Also `/flip`",
      "`/pick Sasha, Mirra, Ivan` — pick one at random. Also `/choose`",
      "`/timer 5m break` — a timer: `90s`, `10` (minutes), `1h30m`; `/timer stop` stops yours. Also `/t`",
      "`/help` — this list (only you see it)",
      "The server rolls the dice, so results are fair; everyone sees them, even in the regular TeamSpeak client.",
    ].join("\n"),
  },
  de: {
    roll: (e, r, t) => `🎲 ${e}: ${r} = ${t}`, natural20: " — kritisch!", natural1: " — Patzer!",
    heads: "🪙 Münze: Kopf", tails: "🪙 Münze: Zahl",
    pick: (n, c) => `🎯 Gewählt aus ${n}: ${c}`,
    timer: (l, label, at) => `⏱ Timer für ${l}${label ? ` — ${label}` : ""} (klingelt um ${at})`,
    timerDone: (label, l) => `⏰ Zeit ist um!${label ? ` ${label}` : ""} (Timer für ${l})`,
    timerStopped: n => `⏹ Timer gestoppt: ${n}`,
    minutes: v => `${v} Min.`, hours: (h, m) => m ? `${h} Std. ${m} Min.` : `${h} Std.`, seconds: v => `${v} s`,
    help: [
      "**Chatbefehle**",
      "`/roll 2d6+3` — würfeln (ohne Angabe: d20). Auch `/r`, `/dice`",
      "`/coin` — Münze werfen. Auch `/flip`",
      "`/pick Sascha, Mirra, Ivan` — zufällig wählen. Auch `/choose`",
      "`/timer 5m Pause` — Timer: `90s`, `10` (Minuten), `1h30m`; `/timer stop` stoppt deine. Auch `/t`",
      "`/help` — diese Liste (nur für dich)",
      "Der Server würfelt, die Ergebnisse sind also fair; alle sehen sie, auch im normalen TeamSpeak.",
    ].join("\n"),
  },
  zh: {
    roll: (e, r, t) => `🎲 ${e}：${r} = ${t}`, natural20: "——暴击！", natural1: "——大失败！",
    heads: "🪙 硬币：正面", tails: "🪙 硬币：反面",
    pick: (n, c) => `🎯 从 ${n} 个中选中：${c}`,
    timer: (l, label, at) => `⏱ 计时 ${l}${label ? `——${label}` : ""}（${at} 提醒）`,
    timerDone: (label, l) => `⏰ 时间到！${label ? ` ${label}` : ""}（${l} 计时）`,
    timerStopped: n => `⏹ 已停止计时：${n}`,
    minutes: v => `${v} 分钟`, hours: (h, m) => m ? `${h} 小时 ${m} 分钟` : `${h} 小时`, seconds: v => `${v} 秒`,
    help: [
      "**聊天命令**",
      "`/roll 2d6+3` — 掷骰（不填为 d20）。也可用 `/r`、`/dice`",
      "`/coin` — 抛硬币。也可用 `/flip`",
      "`/pick 小明, 小红, 小刚` — 随机选一个。也可用 `/choose`",
      "`/timer 5m 休息` — 计时：`90s`、`10`（分钟）、`1h30m`；`/timer stop` 停止自己的。也可用 `/t`",
      "`/help` — 本列表（只有你能看到）",
      "骰子由服务器掷出，结果公平；所有人都能看到，普通 TeamSpeak 客户端也一样。",
    ].join("\n"),
  },
  ja: {
    roll: (e, r, t) => `🎲 ${e}：${r} = ${t}`, natural20: "——クリティカル！", natural1: "——ファンブル！",
    heads: "🪙 コイン：表", tails: "🪙 コイン：裏",
    pick: (n, c) => `🎯 ${n} 個から選択：${c}`,
    timer: (l, label, at) => `⏱ ${l}のタイマー${label ? `——${label}` : ""}（${at} に通知）`,
    timerDone: (label, l) => `⏰ 時間です！${label ? ` ${label}` : ""}（${l}のタイマー）`,
    timerStopped: n => `⏹ タイマーを停止：${n}`,
    minutes: v => `${v} 分`, hours: (h, m) => m ? `${h} 時間 ${m} 分` : `${h} 時間`, seconds: v => `${v} 秒`,
    help: [
      "**チャットコマンド**",
      "`/roll 2d6+3` — ダイスを振る（省略時は d20）。`/r`、`/dice` でも可",
      "`/coin` — コインを投げる。`/flip` でも可",
      "`/pick A, B, C` — ランダムに 1 つ選ぶ。`/choose` でも可",
      "`/timer 5m 休憩` — タイマー：`90s`、`10`（分）、`1h30m`；`/timer stop` で自分のタイマーを停止。`/t` でも可",
      "`/help` — この一覧（自分にだけ表示）",
      "ダイスはサーバーが振るので結果は公平です。通常の TeamSpeak クライアントを含め全員に表示されます。",
    ].join("\n"),
  },
};

export function chatCommandHelp(language: ChatCommandLanguage): string {
  return TEXTS[language].help;
}

/** `5m`, `90s`, `1h30m`, `1:30` (minutes:seconds), a bare number of minutes; null when it is not a length. */
export function parseTimerLength(value: string): number | null {
  const text = value.trim().toLowerCase().replace(/мин|min/g, "m").replace(/ч|hr?/g, "h").replace(/сек|сек\.|с|sec/g, "s").replace(/\s+/g, "");
  if (/^\d{1,4}$/.test(text)) return Number(text) * 60_000;
  const clock = /^(\d{1,3}):([0-5]\d)$/.exec(text);
  if (clock) return (Number(clock[1]) * 60 + Number(clock[2])) * 1000;
  const match = /^(?:(\d{1,2})h)?(?:(\d{1,4})m)?(?:(\d{1,5})s)?$/.exec(text);
  if (!match || !(match[1] || match[2] || match[3])) return null;
  return ((Number(match[1] ?? 0) * 60 + Number(match[2] ?? 0)) * 60 + Number(match[3] ?? 0)) * 1000;
}

export function formatTimerLength(ms: number, language: ChatCommandLanguage): string {
  const texts = TEXTS[language];
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return texts.seconds(seconds);
  if (seconds % 60 && seconds < 600) return `${texts.minutes(Math.floor(seconds / 60))} ${texts.seconds(seconds % 60)}`;
  const minutes = Math.round(seconds / 60);
  return minutes < 60 ? texts.minutes(minutes) : texts.hours(Math.floor(minutes / 60), minutes % 60);
}

export type ChatCommandOutcome =
  | { kind: "message"; message: string }
  | { kind: "timer"; message: string; delayMs: number; doneMessage: string }
  | { kind: "timerStop" }
  | { kind: "error"; code: string };

export interface ChatCommandContext {
  language: ChatCommandLanguage;
  /** Uniform integer in [1, sides]. */
  rollDie: (sides: number) => number;
  now: number;
  /** The asker's `Date.getTimezoneOffset()`, for "rings at 20:15". */
  tzOffset: number;
}

/** Works out a gateway command (/help never reaches the gateway). */
export function runChatCommand(name: Exclude<ChatCommandName, "help">, args: string, context: ChatCommandContext): ChatCommandOutcome {
  const texts = TEXTS[context.language];
  if (name === "roll") {
    const source = args || "d20";
    const expression = parseDiceExpression(source);
    if (!expression) return { kind: "error", code: "CHAT_COMMAND_BAD_DICE" };
    const parts: string[] = [];
    let total = expression.modifier;
    let single: number | null = null;
    for (const term of expression.terms) {
      const rolls = Array.from({ length: term.count }, () => context.rollDie(term.sides));
      total += term.sign * rolls.reduce((sum, value) => sum + value, 0);
      parts.push(`${term.sign < 0 ? "−" : ""}[${rolls.join(", ")}]`);
      if (expression.terms.length === 1 && term.count === 1 && term.sides === 20) single = rolls[0]!;
    }
    if (expression.modifier) parts.push(expression.modifier > 0 ? `+${expression.modifier}` : `−${-expression.modifier}`);
    const label = source.replace(/\s+/g, "").replace(/к/gi, "d");
    const message = texts.roll(label, parts.join(" "), total) + (single === 20 ? texts.natural20 : single === 1 ? texts.natural1 : "");
    return { kind: "message", message };
  }
  if (name === "coin") return { kind: "message", message: context.rollDie(2) === 1 ? texts.heads : texts.tails };
  if (name === "pick") {
    const options = (args.includes(",") || args.includes(";") ? args.split(/[,;]/) : args.split(/\s+/)).map(option => option.trim()).filter(Boolean).slice(0, MAX_PICK);
    if (options.length < 2) return { kind: "error", code: "CHAT_COMMAND_PICK_FEW" };
    return { kind: "message", message: texts.pick(options.length, options[context.rollDie(options.length) - 1]!) };
  }
  // timer
  if (/^(stop|cancel|стоп|отмена|停止|停止する)$/i.test(args)) return { kind: "timerStop" };
  const [first = "", ...rest] = args.split(/\s+/);
  const length = parseTimerLength(first);
  if (length === null) return { kind: "error", code: "CHAT_COMMAND_BAD_TIMER" };
  if (length < TIMER_MIN_MS || length > TIMER_MAX_MS) return { kind: "error", code: "CHAT_COMMAND_TIMER_RANGE" };
  const label = rest.join(" ").slice(0, 200);
  const at = new Date(context.now + length - context.tzOffset * 60_000);
  const clock = `${String(at.getUTCHours()).padStart(2, "0")}:${String(at.getUTCMinutes()).padStart(2, "0")}`;
  const lengthText = formatTimerLength(length, context.language);
  return { kind: "timer", message: texts.timer(lengthText, label, clock), delayMs: length, doneMessage: texts.timerDone(label, lengthText) };
}

export function timerStoppedMessage(count: number, language: ChatCommandLanguage): string {
  return TEXTS[language].timerStopped(count);
}
