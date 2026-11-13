import type { OnlineStats, OnlineStatsPoint, OnlineStatsRange } from "../shared/online-stats.js";

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
  addOnlinePresence(day: string, entries: Array<{ nickname: string; minutes: number; web: boolean; visit: boolean }>): void;
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
        this.store.addOnlinePresence(dayOf(at), [...present].map(nickname => ({
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
