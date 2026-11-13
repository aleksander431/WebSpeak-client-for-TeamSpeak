import type { OnlineMonthSummary } from "../../../src/shared/online-stats.js";

/*
 * "Month in review": the facts the statistics page shows as tiles and the
 * same facts as one chat message (WebSpeak chat takes at most 1,000 UTF-8
 * bytes, so the least important lines go first when it is too long).
 */

type Translate = (key: string, variables?: Record<string, string | number>) => string;

export interface MonthFact {
  id: string;
  emoji: string;
  label: string;
  /** The person the fact is about, if any. */
  who?: string;
  value: string;
}

export const CHAT_SUMMARY_MAX_BYTES = 1000;

export function monthDuration(minutes: number, tr: Translate): string {
  if (minutes < 60) return tr("statsMinutes", { minutes });
  const hours = minutes / 60;
  return tr("statsHoursShort", { hours: hours < 10 ? Math.round(hours * 10) / 10 : Math.round(hours) });
}

export function monthLabel(summary: Pick<OnlineMonthSummary, "month">, locale: string): string {
  const [year, month] = summary.month.split("-").map(Number);
  const text = new Date(Date.UTC(year!, month! - 1, 15)).toLocaleDateString(locale, { month: "long", year: "numeric", timeZone: "UTC" });
  return text.charAt(0).toLocaleUpperCase(locale) + text.slice(1);
}

export function monthFacts(summary: OnlineMonthSummary, tr: Translate, locale: string): MonthFact[] {
  const facts: MonthFact[] = [];
  const weekday = (index: number) => new Date(Date.UTC(2024, 0, 1 + index)).toLocaleDateString(locale, { weekday: "long", timeZone: "UTC" });
  const hour = (value: number) => `${String(value).padStart(2, "0")}:00`;
  if (summary.topTime) facts.push({ id: "top", emoji: "🏆", label: tr("statsFactTop"), who: summary.topTime.nickname, value: monthDuration(summary.topTime.minutes, tr) });
  if (summary.nightOwl) facts.push({ id: "night", emoji: "🦉", label: tr("statsFactNight"), who: summary.nightOwl.nickname, value: tr("statsFactNightValue", { time: monthDuration(summary.nightOwl.minutes, tr) }) });
  if (summary.earlyBird) facts.push({ id: "morning", emoji: "🐦", label: tr("statsFactMorning"), who: summary.earlyBird.nickname, value: tr("statsFactMorningValue", { time: monthDuration(summary.earlyBird.minutes, tr) }) });
  if (summary.mostDays) facts.push({ id: "days", emoji: "📅", label: tr("statsFactDays"), who: summary.mostDays.nickname, value: tr("statsFactDaysValue", { days: summary.mostDays.days, total: summary.elapsedDays }) });
  if (summary.topVisits) facts.push({ id: "visits", emoji: "🚪", label: tr("statsFactVisits"), who: summary.topVisits.nickname, value: tr("statsFactVisitsValue", { count: summary.topVisits.visits }) });
  if (summary.peak) {
    const when = new Date(summary.peak.at).toLocaleString(locale, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
    facts.push({ id: "peak", emoji: "👥", label: tr("statsFactPeak"), value: tr("statsFactPeakValue", { count: summary.peak.count, date: when }) });
  }
  if (summary.busiestDay && summary.busiestHours) {
    facts.push({ id: "busy", emoji: "🔥", label: tr("statsFactBusy"), value: tr("statsFactBusyValue", { day: weekday(summary.busiestDay.weekday), from: hour(summary.busiestHours.from), to: hour(summary.busiestHours.to) }) });
  }
  if (summary.totalMinutes) {
    let value = monthDuration(summary.totalMinutes, tr);
    if (summary.previousTotalMinutes) {
      const change = Math.round((summary.totalMinutes / summary.previousTotalMinutes - 1) * 100);
      value += ` (${tr(summary.previousPartial ? "statsFactTotalChangeSoFar" : "statsFactTotalChange", { change: `${change > 0 ? "+" : ""}${change}%` })})`;
    }
    facts.push({ id: "total", emoji: "⏱", label: tr("statsFactTotal"), value });
  }
  if (summary.newcomers.length) {
    const more = summary.newcomerCount - summary.newcomers.length;
    facts.push({ id: "new", emoji: "🆕", label: tr("statsFactNew"), value: summary.newcomers.join(", ") + (more > 0 ? ` ${tr("statsFactNewMore", { count: more })}` : "") });
  }
  return facts;
}

const bytes = (text: string) => new TextEncoder().encode(text).length;

/** One chat message; lines are dropped from the end until it fits. */
export function monthChatText(summary: OnlineMonthSummary, tr: Translate, locale: string, maxBytes = CHAT_SUMMARY_MAX_BYTES): string {
  const lines = [`📊 ${tr("statsChatTitle", { month: monthLabel(summary, locale) })}`];
  for (const fact of monthFacts(summary, tr, locale)) lines.push(`${fact.emoji} ${fact.label} — ${fact.who ? `${fact.who}: ` : ""}${fact.value}`);
  while (lines.length > 1 && bytes(lines.join("\n")) > maxBytes) lines.pop();
  return lines.join("\n");
}
