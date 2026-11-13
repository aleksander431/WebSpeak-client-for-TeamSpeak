import assert from "node:assert/strict";
import test from "node:test";
import { chatCommandHelp, parseChatCommand, parseTimerLength, runChatCommand } from "../shared/chat-commands.js";
import { parseClientCommand } from "../shared/client-commands.js";
import { ChatCommandRunner, type ChatPlace } from "./chat-command-runner.js";

const fixed = (...values: number[]) => () => values.shift() ?? 1;
const context = (rolls: number[], language: "ru" | "en" = "ru") => ({ language, rollDie: fixed(...rolls), now: Date.UTC(2026, 10, 13, 17, 10), tzOffset: -180 });

test("chat lines that are commands, in Latin or Cyrillic, with aliases; paths and smileys are not", () => {
  assert.deepEqual(parseChatCommand("/roll 2d6+3"), { name: "roll", word: "roll", args: "2d6+3" });
  assert.deepEqual(parseChatCommand("  /кубик  "), { name: "roll", word: "кубик", args: "" });
  assert.equal(parseChatCommand("/кто Саша Мирра")?.name, "pick");
  assert.equal(parseChatCommand("/таймер 5m")?.name, "timer");
  assert.equal(parseChatCommand("/помощь")?.name, "help");
  assert.deepEqual(parseChatCommand("/dance"), { name: null, word: "dance", args: "" });
  assert.equal(parseChatCommand("/home/me/file.txt"), null);
  assert.equal(parseChatCommand("смотри /roll"), null);
  assert.equal(parseChatCommand("/"), null);
  assert.equal(parseChatCommand("/ :)"), null);
  assert.match(chatCommandHelp("ru"), /\/roll/);
  assert.match(chatCommandHelp("en"), /\/timer stop/);
});

test("dice, coin and pick are worked out with the injected dice, worded in the asker's language", () => {
  assert.deepEqual(runChatCommand("roll", "2d6+3", context([4, 6])), { kind: "message", message: "🎲 2d6+3: [4, 6] +3 = 13" });
  assert.deepEqual(runChatCommand("roll", "", context([20])), { kind: "message", message: "🎲 d20: [20] = 20 — крит!" });
  assert.deepEqual(runChatCommand("roll", "к20", context([1], "en")), { kind: "message", message: "🎲 d20: [1] = 1 — fumble!" });
  assert.deepEqual(runChatCommand("roll", "d8-1d4", context([5, 3])), { kind: "message", message: "🎲 d8-1d4: [5] −[3] = 2" });
  assert.deepEqual(runChatCommand("roll", "50d6", context([])), { kind: "error", code: "CHAT_COMMAND_BAD_DICE" });
  assert.deepEqual(runChatCommand("roll", "d7", context([])), { kind: "error", code: "CHAT_COMMAND_BAD_DICE" });
  assert.deepEqual(runChatCommand("coin", "", context([2])), { kind: "message", message: "🪙 Монетка: решка" });
  assert.deepEqual(runChatCommand("pick", "Саша, Мирра Белая, Ivan", context([2])), { kind: "message", message: "🎯 Выбор из 3: Мирра Белая" });
  assert.deepEqual(runChatCommand("pick", "Саша Мирра", context([1], "en")), { kind: "message", message: "🎯 Picked out of 2: Саша" });
  assert.deepEqual(runChatCommand("pick", "Саша", context([])), { kind: "error", code: "CHAT_COMMAND_PICK_FEW" });
});

test("timer lengths and the ringing time in the asker's time zone", () => {
  assert.equal(parseTimerLength("5m"), 300_000);
  assert.equal(parseTimerLength("10"), 600_000);
  assert.equal(parseTimerLength("90s"), 90_000);
  assert.equal(parseTimerLength("1h30m"), 5_400_000);
  assert.equal(parseTimerLength("1:30"), 90_000);
  assert.equal(parseTimerLength("5 мин"), 300_000);
  assert.equal(parseTimerLength("soon"), null);
  const timer = runChatCommand("timer", "5m перерыв на чай", context([]));
  assert.deepEqual(timer, { kind: "timer", delayMs: 300_000, message: "⏱ Таймер на 5 мин — перерыв на чай (сработает в 20:15)", doneMessage: "⏰ Время! перерыв на чай (таймер на 5 мин)" });
  assert.deepEqual(runChatCommand("timer", "5s", context([])), { kind: "error", code: "CHAT_COMMAND_TIMER_RANGE" });
  assert.deepEqual(runChatCommand("timer", "25h", context([])), { kind: "error", code: "CHAT_COMMAND_TIMER_RANGE" });
  assert.deepEqual(runChatCommand("timer", "стоп", context([])), { kind: "timerStop" });
});

test("a session's runner: ordinary text passes, timers ring through the session and end with it", async () => {
  const sent: Array<[ChatPlace, string]> = [];
  const told: string[] = [];
  const pending: Array<() => void> = [];
  const runner = new ChatCommandRunner({
    send: async (place, message) => { sent.push([place, message]); return { channelId: "5", ref: "0123456789abcdef" }; },
    notifyOwner: (_place, message, info) => told.push(`${message}|${info?.ref}`),
    rollDie: fixed(3),
    now: () => Date.UTC(2026, 10, 13, 17, 10),
    setTimer: callback => { pending.push(callback); return pending.length as unknown as ReturnType<typeof setTimeout>; },
    clearTimer: () => undefined,
  });
  const channel: ChatPlace = { scope: "channel" };
  assert.equal(runner.run("привет", channel, "ru", -180), null);
  assert.equal(runner.run("/help", channel, "ru", -180), null, "help never reaches the gateway");
  assert.deepEqual(runner.run("/dance", channel, "ru", -180), { error: "CHAT_COMMAND_UNKNOWN" });
  assert.deepEqual(runner.run("/r 1d6", channel, "xx", "bad"), { message: "🎲 1d6: [3] = 3" }, "unknown languages fall back to English wording");
  assert.deepEqual(runner.run("/timer 1m", { scope: "private", clientId: 4 }, "ru", -180), { error: "CHAT_COMMAND_TIMER_PRIVATE" });
  assert.deepEqual(runner.run("/timer stop", channel, "ru", -180), { error: "CHAT_COMMAND_TIMER_NONE" });
  for (let i = 0; i < 3; i++) assert.ok("message" in (runner.run(`/timer ${i + 1}m чай`, channel, "ru", -180) ?? {}));
  assert.deepEqual(runner.run("/timer 1m", channel, "ru", -180), { error: "CHAT_COMMAND_TIMER_LIMIT" });
  pending[0]!();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(sent, [[channel, "⏰ Время! чай (таймер на 1 мин)"]]);
  assert.deepEqual(told, ["⏰ Время! чай (таймер на 1 мин)|0123456789abcdef"]);
  assert.equal(runner.activeTimers(), 2);
  assert.deepEqual(runner.run("/timer stop", channel, "ru", -180), { message: "⏹ Таймеры остановлены: 2" });
  runner.close();
  pending[1]!();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(sent.length, 1, "a closed session's timers stay silent");
});

test("the page may send its language and time zone with a chat message", () => {
  const ok = parseClientCommand(JSON.stringify({ type: "sendTextMessage", requestId: "r1", payload: { message: "/roll", lang: "ru", tz: -180 } }));
  assert.ok(!("error" in ok));
  const badLang = parseClientCommand(JSON.stringify({ type: "sendServerMessage", requestId: "r2", payload: { message: "/roll", lang: "russian" } }));
  assert.ok("error" in badLang);
  const badTz = parseClientCommand(JSON.stringify({ type: "sendPrivateMessage", requestId: "r3", payload: { clientId: 3, message: "/roll", tz: 5000 } }));
  assert.ok("error" in badTz);
});
