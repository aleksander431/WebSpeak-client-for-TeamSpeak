import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { WebSpeakDatabase } from "../persistence/database.js";
import { onlineMonthSummary, onlineStats, OnlineStatsRecorder } from "./online-stats.js";

test("online statistics: peaks per bucket, minutes and visits per nickname, the weekday × hour map", async (context) => {
  const directory = mkdtempSync(path.join(tmpdir(), "webspeak-stats-"));
  const database = new WebSpeakDatabase(path.join(directory, "webspeak.sqlite"));
  context.after(() => {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  });

  // Monday 2026-11-09 18:00 UTC.
  let now = Date.UTC(2026, 10, 9, 18, 0, 0);
  let web = ["Саша", "Alex 🎵"];
  let server: string[] | null = ["Саша", "Мирра", "Ivan"];
  const recorder = new OnlineStatsRecorder(database, { webSessions: () => web, serverMembers: async () => server }, () => now);

  for (let minute = 0; minute < 10; minute++) {
    await recorder.tick();
    now += 60_000;
  }
  // Ivan leaves, comes back; the server list becomes unreadable for a while.
  server = ["Саша", "Мирра"];
  await recorder.tick(); now += 60_000;
  server = null;
  web = ["Саша"];
  await recorder.tick(); now += 60_000;
  server = ["Саша", "Мирра", "Ivan", "Олег"];
  await recorder.tick(); now += 60_000;

  const stats = onlineStats(database, "day", -180, now);
  assert.equal(stats.serverKnown, true);
  assert.deepEqual(stats.peak, { count: 4, at: Date.UTC(2026, 10, 9, 18, 10) });
  assert.equal(stats.people, 4, "the accompaniment helper is not a person");
  const sasha = stats.top.find(person => person.nickname === "Саша")!;
  assert.equal(sasha.minutes, 13);
  assert.equal(sasha.webMinutes, 13);
  assert.equal(sasha.visits, 1);
  const ivan = stats.top.find(person => person.nickname === "Ivan")!;
  assert.equal(ivan.minutes, 11);
  assert.equal(ivan.visits, 2, "leaving and coming back is a second visit");
  assert.equal(stats.top[0]!.nickname, "Саша");
  assert.ok(stats.points.every(point => point.at % (5 * 60_000) === 0));
  // 18:00 UTC is 21:00 in Moscow (UTC+3, getTimezoneOffset() = -180), a Monday.
  assert.ok(stats.heatmap[0]![21]! > 0);
  assert.equal(stats.heatmap[0]![18], 0);
  assert.equal(stats.since, Date.UTC(2026, 10, 9, 18, 0));

  const month = onlineStats(database, "month", -180, now);
  assert.equal(month.step, 2 * 3_600_000);
  assert.equal(month.points.length, 1);
  assert.equal(month.points[0]!.ts, 4);
});

test("online statistics are empty before anything was recorded", (context) => {
  const directory = mkdtempSync(path.join(tmpdir(), "webspeak-stats-"));
  const database = new WebSpeakDatabase(path.join(directory, "webspeak.sqlite"));
  context.after(() => {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const stats = onlineStats(database, "week", 0, Date.now());
  assert.equal(stats.points.length, 0);
  assert.equal(stats.peak, null);
  assert.equal(stats.since, null);
  assert.equal(stats.heatmap.length, 7);
  assert.equal(stats.heatmap[0]!.length, 24);
});

test("a month in review: most time, night owl, early bird, regulars, visits, peak, busy hours and newcomers", (context) => {
  const directory = mkdtempSync(path.join(tmpdir(), "webspeak-stats-"));
  const database = new WebSpeakDatabase(path.join(directory, "webspeak.sqlite"));
  context.after(() => {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const tz = -180; // Moscow
  const at = (day: number, hour: number, month = 11) => Date.UTC(2026, month - 1, day, hour) + tz * 60_000;
  const put = (when: number, rows: Array<[string, number, boolean?]>) =>
    database.addOnlinePresence(new Date(when).toISOString().slice(0, 10), Math.floor(when / 3_600_000) * 3_600_000, rows.map(([nickname, minutes, visit]) => ({ nickname, minutes, web: true, visit: visit ?? false })));

  put(at(20, 21, 10), [["Саша", 120, true]]); // October: Sasha is not new in November
  for (let day = 1; day <= 12; day++) put(at(day, 20), [["Саша", 60, true], ["Мирра", 30, true]]);
  put(at(3, 2), [["Ivan", 50, true]]);
  put(at(4, 3), [["Ivan", 40]]);
  put(at(5, 7), [["Олег", 45, true]]);
  for (let visit = 0; visit < 20; visit++) put(at(6, 12), [["Олег", 1, true]]);
  database.addOnlineSample(at(7, 21), 3, 9);
  database.addOnlineSample(at(8, 21), 2, 6);
  database.addOnlineSample(at(9, 10), 1, 1);

  const summary = onlineMonthSummary(database, 2026, 11, tz, at(13, 12));
  assert.equal(summary.month, "2026-11");
  assert.equal(summary.days, 30);
  assert.equal(summary.elapsedDays, 13);
  assert.deepEqual(summary.topTime, { nickname: "Саша", minutes: 720 });
  assert.deepEqual(summary.nightOwl, { nickname: "Ivan", minutes: 90 });
  assert.deepEqual(summary.earlyBird, { nickname: "Олег", minutes: 45 });
  assert.deepEqual(summary.mostDays, { nickname: "Саша", days: 12 }, "a tie in days goes to more time online");
  assert.deepEqual(summary.topVisits, { nickname: "Олег", visits: 21 });
  assert.deepEqual(summary.peak, { count: 9, at: at(7, 21) });
  assert.equal(summary.busiestDay?.weekday, 5, "7 November 2026 is a Saturday");
  assert.ok(summary.busiestHours && summary.busiestHours.from <= 21 && (summary.busiestHours.to > 21 || summary.busiestHours.to < summary.busiestHours.from));
  assert.deepEqual(summary.newcomers, ["Мирра", "Ivan", "Олег"]);
  assert.equal(summary.totalMinutes, 12 * 90 + 90 + 45 + 20);
  assert.equal(summary.previousTotalMinutes, null, "recording began in late October, so October is no yardstick");
  assert.equal(summary.people, 4);

  const empty = onlineMonthSummary(database, 2026, 1, tz, at(13, 12));
  assert.equal(empty.hasData, false);
  assert.equal(empty.topTime, null);
});
