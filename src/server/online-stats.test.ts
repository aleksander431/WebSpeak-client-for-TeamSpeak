import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { WebSpeakDatabase } from "../persistence/database.js";
import { onlineStats, OnlineStatsRecorder } from "./online-stats.js";

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
