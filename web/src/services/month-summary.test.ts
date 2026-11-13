import assert from "node:assert/strict";
import test from "node:test";
import type { OnlineMonthSummary } from "../../../src/shared/online-stats.js";
import { statsAdminCopy } from "../i18n/stats-admin.js";
import { monthChatText, monthFacts } from "./month-summary.js";

const ru = statsAdminCopy.ru as Record<string, string>;
const tr = (key: string, variables: Record<string, string | number> = {}) =>
  Object.entries(variables).reduce((text, [name, value]) => text.replaceAll(`{{${name}}}`, String(value)), ru[key] ?? key);

const summary: OnlineMonthSummary = {
  month: "2026-11", from: 0, to: 0, days: 30, elapsedDays: 13, hasData: true, totalMinutes: 412 * 60, previousTotalMinutes: 349 * 60, previousPartial: false, people: 10,
  topTime: { nickname: "Саша", minutes: 51 * 60 + 7 }, nightOwl: { nickname: "Ivan", minutes: 14 * 60 }, earlyBird: { nickname: "Мирра", minutes: 45 },
  mostDays: { nickname: "Олег", days: 12 }, topVisits: { nickname: "Катя", visits: 64 }, peak: { count: 12, at: Date.UTC(2026, 10, 7, 18, 5) },
  busiestDay: { weekday: 5, average: 6.2 }, busiestHours: { from: 20, to: 23, average: 7.1 }, newcomers: ["Lena", "Kira"], newcomerCount: 2,
};

test("a month in review reads well as tiles and as one chat message", () => {
  const facts = monthFacts(summary, tr, "ru-RU");
  assert.deepEqual(facts.map(fact => fact.id), ["top", "night", "morning", "days", "visits", "peak", "busy", "total", "new"]);
  assert.equal(facts[0]!.value, "51 ч");
  assert.equal(facts[2]!.value, "45 мин с 5 до 9 утра");
  assert.equal(facts[3]!.value, "12 дн. из 13");
  assert.equal(facts.find(fact => fact.id === "busy")!.value, "суббота, 20:00–23:00");
  assert.equal(facts.find(fact => fact.id === "total")!.value, "412 ч (+18% к прошлому месяцу)");

  const text = monthChatText(summary, tr, "ru-RU");
  assert.match(text, /^📊 Итоги месяца: Ноябрь 2026/);
  assert.match(text, /🏆 Больше всех в сети — Саша: 51 ч/);
  assert.match(text, /🆕 Новенькие — Lena, Kira$/);
  assert.ok(new TextEncoder().encode(text).length <= 1000);

  const short = monthChatText(summary, tr, "ru-RU", 300);
  assert.ok(new TextEncoder().encode(short).length <= 300);
  assert.match(short, /^📊/);
  assert.ok(!short.includes("🆕"), "the last lines go first when the message is too long");
});
