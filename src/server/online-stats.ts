import type { OnlineMonthSummary, OnlineStats, OnlineStatsPoint, OnlineStatsRange } from "../shared/online-stats.js";

/*
 * Who is online, recorded once a minute for the admin console. Two sources:
 * the gateway's own WebSpeak sessions, and the TeamSpeak server's member list
 * when it is readable (a connected WebSpeak session sees it, or ServerQuery).
 * Only counts and nicknames are kept: the most people per five minutes, and
 * minutes online and visits per nickname per UTC day.
 */

export const ONLINE_TICK_MS = 60_000;
export const ONLINE_BUCKET_MS = 5 * 60_000;
const KEEP_DAYS = 400;
const DAY_MS = 86_400_000;
const HEATMAP_DAYS = 28;

export interface OnlineStatsStore {
  addOnlineSample(at: number, web: number, ts: number | null): void;
  addOnlinePresence(day: string, hour: number, entries: Array<{ nickname: string; minutes: number; web: boolean; visit: boolean }>): void;
  onlineHours(from: number, to: number): Array<{ hour: number; nickname: string; minutes: number }>;
  onlineFirstSeen(): Map<string, number>;
  onlineVisits(fromDay: string, toDay: string): Map<string, number>;
  onlineSamples(from: number, to: number): OnlineStatsPoint[];
  onlinePresence(fromDay: string, limit: number): OnlineStats["top"];
  onlinePeople(fromDay: string): number;
  pruneOnlineStats(beforeAt: number, beforeDay: string): void;
}

export interface OnlineStatsSources {
  /** Nicknames of WebSpeak sessions connected to TeamSpeak right now. */
  webSessions(): string[];
  /** Everyone on the TeamSpeak server now, or null when the list cannot be read. */
  serverMembers(): Promise<string[] | null>;
}

const dayOf = (at: number) => new Date(at).toISOString().slice(0, 10);

/** Accompaniment clients (`<nick> 🎵`) are the gateway's own helpers, not people. */
export function isHelperClient(nickname: string): boolean {
  return nickname.endsWith(" 🎵");
}

export class OnlineStatsRecorder {
  private previous = new Set<string>();
  private lastTick = 0;
  private timer: ReturnType<typeof setInterval> | undefined;
  private running = false;
  private lastPrune = 0;

  constructor(
    private readonly store: OnlineStatsStore,
    private readonly sources: OnlineStatsSources,
    private readonly now: () => number = Date.now,
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => { void this.tick(); }, ONLINE_TICK_MS);
    this.timer.unref?.();
    void this.tick();
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const at = this.now();
      // A minute counts once even if ticks bunch up after a pause; a long gap counts as one minute too.
      const minutes = this.lastTick && at - this.lastTick < ONLINE_TICK_MS / 2 ? 0 : 1;
      const web = [...new Set(this.sources.webSessions().filter(name => !isHelperClient(name)))];
      const listed = await this.sources.serverMembers().catch(() => null);
      const server = listed ? [...new Set(listed.filter(name => !isHelperClient(name)))] : null;
      const present = new Set([...web, ...(server ?? [])]);
      this.store.addOnlineSample(Math.floor(at / ONLINE_BUCKET_MS) * ONLINE_BUCKET_MS, web.length, server ? server.length : null);
      if (minutes) {
        const webSet = new Set(web);
        this.store.addOnlinePresence(dayOf(at), Math.floor(at / 3_600_000) * 3_600_000, [...present].map(nickname => ({
          nickname: nickname.slice(0, 64), minutes, web: webSet.has(nickname), visit: !this.previous.has(nickname),
        })));
        this.lastTick = at;
      }
      this.previous = present;
      if (at - this.lastPrune > DAY_MS) {
        this.lastPrune = at;
        this.store.pruneOnlineStats(at - KEEP_DAYS * DAY_MS, dayOf(at - KEEP_DAYS * DAY_MS));
      }
    } finally {
      this.running = false;
    }
  }
}

const RANGES: Record<OnlineStatsRange, { span: number; step: number }> = {
  day: { span: DAY_MS, step: ONLINE_BUCKET_MS },
  week: { span: 7 * DAY_MS, step: 30 * 60_000 },
  month: { span: 30 * DAY_MS, step: 2 * 3_600_000 },
};

/**
 * The admin view of one range. `tzOffset` is the browser's
 * `Date.getTimezoneOffset()` (minutes behind UTC), for the weekday × hour map.
 */
export function onlineStats(store: OnlineStatsStore, range: OnlineStatsRange, tzOffset: number, now: number, topLimit = 15): OnlineStats {
  const { span, step } = RANGES[range];
  const to = Math.ceil(now / step) * step;
  const from = to - span;
  const raw = store.onlineSamples(from, to);
  const buckets = new Map<number, OnlineStatsPoint>();
  for (const sample of raw) {
    const at = Math.floor(sample.at / step) * step;
    const bucket = buckets.get(at);
    if (!bucket) buckets.set(at, { at, web: sample.web, ts: sample.ts });
    else {
      bucket.web = Math.max(bucket.web, sample.web);
      if (sample.ts !== null) bucket.ts = Math.max(bucket.ts ?? 0, sample.ts);
    }
  }
  const points = [...buckets.values()].sort((a, b) => a.at - b.at);
  let peak: OnlineStats["peak"] = null;
  for (const point of raw) {
    const count = Math.max(point.web, point.ts ?? 0);
    if (count > 0 && (!peak || count > peak.count)) peak = { count, at: point.at };
  }

  const heat = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => ({ sum: 0, n: 0 })));
  const heatFrom = Math.floor(now / ONLINE_BUCKET_MS) * ONLINE_BUCKET_MS - HEATMAP_DAYS * DAY_MS;
  for (const sample of store.onlineSamples(heatFrom, now + ONLINE_BUCKET_MS)) {
    const local = new Date(sample.at - tzOffset * 60_000);
    const weekday = (local.getUTCDay() + 6) % 7;
    const cell = heat[weekday]![local.getUTCHours()]!;
    cell.sum += Math.max(sample.web, sample.ts ?? 0);
    cell.n += 1;
  }
  const first = store.onlineSamples(0, now + ONLINE_BUCKET_MS)[0];
  return {
    range, from, to, step, points,
    heatmap: heat.map(row => row.map(cell => cell.n ? Math.round(cell.sum / cell.n * 10) / 10 : 0)),
    peak,
    people: store.onlinePeople(dayOf(from)),
    top: store.onlinePresence(dayOf(from), topLimit),
    since: first ? first.at : null,
    serverKnown: raw.some(sample => sample.ts !== null),
  };
}

/** The first instant of a calendar month in a time zone `tzOffset` minutes behind UTC. */
function monthStart(year: number, month: number, tzOffset: number): number {
  return Date.UTC(year, month - 1, 1) + tzOffset * 60_000;
}

/**
 * Fun facts about one calendar month in the viewer's time zone, for the
 * statistics page and a message in the chat. `month` is 1–12.
 */
export function onlineMonthSummary(store: OnlineStatsStore, year: number, month: number, tzOffset: number, now: number): OnlineMonthSummary {
  const from = monthStart(year, month, tzOffset);
  const to = monthStart(month === 12 ? year + 1 : year, month === 12 ? 1 : month + 1, tzOffset);
  const previousFrom = monthStart(month === 1 ? year - 1 : year, month === 1 ? 12 : month - 1, tzOffset);
  const local = (at: number) => new Date(at - tzOffset * 60_000);
  const days = Math.round((to - from) / DAY_MS);
  const elapsedDays = Math.max(1, Math.min(days, Math.ceil((Math.min(now, to) - from) / DAY_MS)));

  const hours = store.onlineHours(from, to);
  const people = new Map<string, { minutes: number; night: number; morning: number; days: Set<number> }>();
  let total = 0;
  for (const row of hours) {
    const person = people.get(row.nickname) ?? { minutes: 0, night: 0, morning: 0, days: new Set<number>() };
    const when = local(row.hour);
    const hour = when.getUTCHours();
    person.minutes += row.minutes;
    if (hour < 5) person.night += row.minutes;
    else if (hour < 9) person.morning += row.minutes;
    person.days.add(when.getUTCDate());
    people.set(row.nickname, person);
    total += row.minutes;
  }
  // A month that was only partly recorded is no yardstick.
  const recordedSince = store.onlineSamples(0, now + ONLINE_BUCKET_MS)[0]?.at ?? Number.POSITIVE_INFINITY;
  // While the month runs, it is compared with the same stretch of the previous one.
  const partial = now < to;
  const previousTo = partial ? Math.min(from, previousFrom + (now - from)) : from;
  const previousTotal = recordedSince <= previousFrom + ONLINE_BUCKET_MS ? store.onlineHours(previousFrom, previousTo).reduce((sum, row) => sum + row.minutes, 0) : null;
  const best = <T>(items: Array<[string, T]>, score: (value: T) => number, minimum = 1) => {
    let winner: { nickname: string; value: number } | null = null;
    for (const [nickname, value] of items) {
      const points = score(value);
      if (points >= minimum && (!winner || points > winner.value)) winner = { nickname, value: points };
    }
    return winner;
  };
  const entries = [...people.entries()];
  const topTime = best(entries, person => person.minutes);
  const nightOwl = best(entries, person => person.night, 30);
  const earlyBird = best(entries, person => person.morning, 30);
  // Days first; on a tie, more time online wins (so the answer does not depend on row order).
  const regular = best(entries, person => person.days.size * 1e7 + person.minutes);
  const mostDays = regular && { nickname: regular.nickname, value: people.get(regular.nickname)!.days.size };
  const visits = store.onlineVisits(dayOf(from), dayOf(to - 1));
  const topVisits = best([...visits.entries()], value => value);

  // The busiest weekday and three-hour stretch, by the average people online.
  const samples = store.onlineSamples(from, to);
  let peak: OnlineMonthSummary["peak"] = null;
  const byWeekday = Array.from({ length: 7 }, () => ({ sum: 0, n: 0 }));
  const byHour = Array.from({ length: 24 }, () => ({ sum: 0, n: 0 }));
  for (const sample of samples) {
    const count = Math.max(sample.web, sample.ts ?? 0);
    if (count > 0 && (!peak || count > peak.count)) peak = { count, at: sample.at };
    const when = local(sample.at);
    const weekday = byWeekday[(when.getUTCDay() + 6) % 7]!;
    weekday.sum += count; weekday.n += 1;
    const hour = byHour[when.getUTCHours()]!;
    hour.sum += count; hour.n += 1;
  }
  const average = (cell: { sum: number; n: number }) => cell.n ? cell.sum / cell.n : 0;
  let busiestDay: OnlineMonthSummary["busiestDay"] = null;
  byWeekday.forEach((cell, weekday) => { if (average(cell) > 0 && (!busiestDay || average(cell) > busiestDay.average)) busiestDay = { weekday, average: Math.round(average(cell) * 10) / 10 }; });
  let busiestHours: OnlineMonthSummary["busiestHours"] = null;
  for (let start = 0; start < 24; start++) {
    const window = [0, 1, 2].map(offset => average(byHour[(start + offset) % 24]!));
    const value = window.reduce((a, b) => a + b, 0) / 3;
    if (value > 0 && (!busiestHours || value > busiestHours.average)) busiestHours = { from: start, to: (start + 3) % 24, average: Math.round(value * 10) / 10 };
  }

  const firstSeen = store.onlineFirstSeen();
  const newcomers = entries.filter(([nickname]) => (firstSeen.get(nickname) ?? 0) >= from).sort((a, b) => b[1].minutes - a[1].minutes).map(([nickname]) => nickname);
  return {
    month: `${year}-${String(month).padStart(2, "0")}`,
    from, to, days, elapsedDays,
    hasData: hours.length > 0 || samples.length > 0,
    totalMinutes: total, previousTotalMinutes: previousTotal, previousPartial: partial, people: people.size,
    topTime: topTime && { nickname: topTime.nickname, minutes: topTime.value },
    nightOwl: nightOwl && { nickname: nightOwl.nickname, minutes: nightOwl.value },
    earlyBird: earlyBird && { nickname: earlyBird.nickname, minutes: earlyBird.value },
    mostDays: mostDays && { nickname: mostDays.nickname, days: mostDays.value },
    topVisits: topVisits && { nickname: topVisits.nickname, visits: topVisits.value },
    peak, busiestDay, busiestHours,
    newcomers: newcomers.slice(0, 5), newcomerCount: newcomers.length,
  };
}
