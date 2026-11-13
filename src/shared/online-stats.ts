/** Online statistics for the admin console. Browser-safe. */

export const ONLINE_STATS_RANGES = ["day", "week", "month"] as const;
export type OnlineStatsRange = typeof ONLINE_STATS_RANGES[number];

export interface OnlineStatsPoint {
  /** Start of the bucket, ms. */
  at: number;
  /** Most WebSpeak users seen at once in the bucket. */
  web: number;
  /** Most people on the TeamSpeak server at once, when it was known. */
  ts: number | null;
}

export interface OnlineStatsPerson {
  nickname: string;
  minutes: number;
  /** Of those minutes, how many through WebSpeak. */
  webMinutes: number;
  visits: number;
  /** Days with any time online. */
  days: number;
  /** Last UTC day seen (YYYY-MM-DD). */
  lastDay: string;
}

export interface OnlineStats {
  range: OnlineStatsRange;
  from: number;
  to: number;
  /** Bucket length of `points`, ms. */
  step: number;
  points: OnlineStatsPoint[];
  /** Average people online by weekday (0 = Monday) and hour in the viewer's time zone, over the last 28 days. */
  heatmap: number[][];
  peak: { count: number; at: number } | null;
  /** Distinct nicknames seen in the range. */
  people: number;
  top: OnlineStatsPerson[];
  /** When the recording began (first sample ever), or null without any data. */
  since: number | null;
  /** Whether the TeamSpeak server's own list was readable at some point in the range. */
  serverKnown: boolean;
}

/** Fun facts about one calendar month, in the viewer's time zone. */
export interface OnlineMonthSummary {
  /** `YYYY-MM`. */
  month: string;
  from: number;
  to: number;
  /** Days in the month, and how many of them have passed. */
  days: number;
  elapsedDays: number;
  hasData: boolean;
  /** Minutes online added up over everyone. */
  totalMinutes: number;
  /** The previous month's total, or null when recording began during or after it. */
  previousTotalMinutes: number | null;
  /** The comparison covers only as many days of the previous month as have passed in this one. */
  previousPartial: boolean;
  people: number;
  topTime: { nickname: string; minutes: number } | null;
  /** Most minutes between midnight and 5 am. */
  nightOwl: { nickname: string; minutes: number } | null;
  /** Most minutes between 5 and 9 am. */
  earlyBird: { nickname: string; minutes: number } | null;
  mostDays: { nickname: string; days: number } | null;
  topVisits: { nickname: string; visits: number } | null;
  peak: { count: number; at: number } | null;
  /** 0 = Monday. */
  busiestDay: { weekday: number; average: number } | null;
  /** Local hours [from, to). */
  busiestHours: { from: number; to: number; average: number } | null;
  /** First seen this month, most time online first. */
  newcomers: string[];
  newcomerCount: number;
}
