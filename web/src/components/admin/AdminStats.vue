<template>
  <section class="page-content stats-page" data-admin-scope="webspeak">
    <div class="page-heading"
      ><div
        ><h2>{{ tr("statsTitle") }}</h2
        ><p>{{ tr("statsLead") }}</p></div
      ><div class="stats-heading-actions"
        ><div
          class="stats-ranges"
          role="radiogroup"
          :aria-label="tr('statsTitle')"
          ><button
            v-for="item in RANGES"
            :key="item"
            type="button"
            role="radio"
            :aria-checked="range === item"
            :class="['stats-range', { active: range === item }]"
            @click="setRange(item)"
            >{{ tr(item === "day" ? "statsDay" : item === "week" ? "statsWeek" : "statsMonth") }}</button
          ></div
        ><button
          class="secondary-button"
          type="button"
          :disabled="loading"
          @click="load"
          ><span
            v-if="loading"
            class="spinner small"
          ></span
          ><Icon
            v-else
            name="refresh"
            :size="17"
          />{{ tr("refresh") }}</button
        ></div
      ></div
    >

    <article
      v-if="stats && stats.since === null"
      class="operation-card"
      ><p class="field-help">{{ tr("statsEmpty") }}</p></article
    >
    <template v-else-if="stats">
      <div class="metric-grid"
        ><article
          ><span><Icon name="users" :size="20" /></span
          ><small>{{ tr("statsNow") }}</small
          ><strong>{{ now ? (now.ts ?? now.web) : 0 }}</strong
          ><em v-if="now && now.ts !== null">{{ tr("statsWeb") }}: {{ now.web }}</em
          ><em v-else-if="stats.since">{{ tr("statsSince", { date: new Date(stats.since).toLocaleDateString() }) }}</em></article
        ><article
          ><span><Icon name="activity" :size="20" /></span
          ><small>{{ tr("statsPeak") }}</small
          ><strong>{{ stats.peak ? stats.peak.count : "—" }}</strong
          ><em>{{ stats.peak ? formatWhen(stats.peak.at) : tr("statsPeakNone") }}</em></article
        ><article
          ><span><Icon name="chart" :size="20" /></span
          ><small>{{ tr("statsPeople") }}</small
          ><strong>{{ stats.people }}</strong
          ><em v-if="stats.since">{{ tr("statsSince", { date: new Date(stats.since).toLocaleDateString() }) }}</em></article
        ></div
      >

      <article class="operation-card stats-chart-card">
        <header class="stats-card-head">
          <h3>{{ tr("statsChart") }}</h3>
          <div class="stats-legend">
            <span v-if="stats.serverKnown"><i class="stats-swatch stats-swatch-ts"></i>{{ tr("statsServer") }}</span>
            <span><i class="stats-swatch stats-swatch-web"></i>{{ tr("statsWeb") }}</span>
          </div>
        </header>
        <p v-if="!stats.serverKnown" class="field-help">{{ tr("statsServerUnknown") }}</p>
        <div
          ref="chartBox"
          class="stats-chart"
          @pointermove="onHover"
          @pointerleave="hover = null"
        >
          <svg :viewBox="`0 0 ${W} ${H}`" preserveAspectRatio="none" role="img" :aria-label="tr('statsChart')">
            <g class="stats-grid">
              <line v-for="tick in yTicks" :key="`y${tick}`" :x1="PAD_L" :x2="W - PAD_R" :y1="y(tick)" :y2="y(tick)" />
            </g>
            <path v-if="stats.serverKnown" class="stats-area-ts" :d="areaPath('ts')" />
            <path v-if="stats.serverKnown" class="stats-line-ts" :d="linePath('ts')" />
            <path class="stats-line-web" :d="linePath('web')" />
            <line v-if="hover" class="stats-cursor" :x1="x(hover.index)" :x2="x(hover.index)" :y1="PAD_T" :y2="H - PAD_B" />
          </svg>
          <span v-for="tick in yTicks" :key="`yl${tick}`" class="stats-y-label" :style="{ top: `${y(tick) / H * 100}%` }">{{ tick }}</span>
          <span v-for="label in xLabels" :key="`xl${label.index}`" class="stats-x-label" :style="{ left: `${x(label.index) / W * 100}%` }">{{ label.text }}</span>
          <div
            v-if="hover"
            class="stats-tip"
            :style="{ left: `${Math.min(80, Math.max(0, x(hover.index) / W * 100))}%` }"
          >
            <strong>{{ formatBucket(series[hover.index]!.at) }}</strong>
            <span v-if="stats.serverKnown">{{ tr("statsServer") }}: {{ series[hover.index]!.ts ?? "—" }}</span>
            <span>{{ tr("statsWeb") }}: {{ series[hover.index]!.web ?? "—" }}</span>
          </div>
        </div>
      </article>

      <div class="stats-columns">
        <article class="operation-card stats-heat-card">
          <h3>{{ tr("statsHeatmap") }}</h3>
          <div class="stats-heat" role="table" :aria-label="tr('statsHeatmap')">
            <span class="stats-heat-corner"></span>
            <span v-for="hour in 24" :key="`h${hour}`" class="stats-heat-hour">{{ (hour - 1) % 3 === 0 ? hour - 1 : "" }}</span>
            <template v-for="(row, day) in stats.heatmap" :key="`d${day}`">
              <span class="stats-heat-day">{{ weekdays[day] }}</span>
              <span
                v-for="(value, hour) in row"
                :key="`c${day}-${hour}`"
                class="stats-heat-cell"
                :style="{ '--level': heatMax ? value / heatMax : 0 }"
                :title="`${weekdays[day]} ${String(hour).padStart(2, '0')}:00 — ${value}`"
              ></span>
            </template>
          </div>
          <div class="stats-heat-scale"><span>{{ tr("statsHeatLess") }}</span><i></i><span>{{ tr("statsHeatMore") }}</span></div>
        </article>

        <article class="operation-card stats-top-card">
          <h3>{{ tr("statsTop") }}</h3>
          <p v-if="!stats.top.length" class="field-help">{{ tr("statsPeakNone") }}</p>
          <ol v-else class="stats-top">
            <li class="stats-top-head" aria-hidden="true">
              <span>{{ tr("statsColName") }}</span><span>{{ tr("statsColTime") }}</span><span>{{ tr("statsColVisits") }}</span><span>{{ tr("statsColDays") }}</span>
            </li>
            <li v-for="(person, index) in stats.top" :key="person.nickname" class="stats-top-row">
              <span class="stats-top-name">
                <b>{{ index + 1 }}</b>
                <span><strong>{{ person.nickname }}</strong><small v-if="person.webMinutes">{{ tr("statsWebShare", { share: Math.round(person.webMinutes / person.minutes * 100) }) }}</small></span>
              </span>
              <span class="stats-top-time">
                <span class="stats-bar"><i :style="{ width: `${person.minutes / topMax * 100}%` }"></i></span>{{ formatMinutes(person.minutes) }}
              </span>
              <span class="stats-top-num" :title="tr('statsColVisits')">{{ person.visits }}</span>
              <span class="stats-top-num" :title="tr('statsColDays')">{{ person.days }}</span>
            </li>
          </ol>
        </article>
      </div>
    </template>
    <article v-else class="operation-card"><span class="spinner small"></span></article>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import Icon from "../Icon.vue";
import type { OnlineStatsRange } from "../../../../src/shared/online-stats.js";
import type { AdminStatsModel } from "../../composables/useAdminStats.js";
import type { useAdminI18n } from "../../composables/useAdminI18n.js";

const RANGES: OnlineStatsRange[] = ["day", "week", "month"];
const W = 1000;
const H = 280;
const PAD_L = 34;
const PAD_R = 8;
const PAD_T = 12;
const PAD_B = 28;

const props = defineProps<{
  model: AdminStatsModel;
  i18n: Pick<ReturnType<typeof useAdminI18n>, "tr">;
}>();
const { range, stats, loading, load, setRange } = props.model;
const { tr } = props.i18n;

const weekdays = computed(() => tr("statsWeekdays").split(","));

/** Every bucket of the range, empty ones as gaps. */
const series = computed(() => {
  const value = stats.value;
  if (!value) return [];
  const byAt = new Map(value.points.map(point => [point.at, point]));
  const result: Array<{ at: number; web: number | null; ts: number | null }> = [];
  for (let at = value.from; at < value.to; at += value.step) {
    const point = byAt.get(at);
    result.push({ at, web: point ? point.web : null, ts: point ? point.ts : null });
  }
  return result;
});
const now = computed(() => {
  const points = stats.value?.points ?? [];
  const last = points[points.length - 1];
  return last && stats.value && last.at >= stats.value.to - 2 * stats.value.step ? last : null;
});
const top = computed(() => Math.max(4, ...series.value.map(point => Math.max(point.web ?? 0, point.ts ?? 0))));
const yMax = computed(() => {
  const raw = top.value;
  const step = raw <= 5 ? 1 : raw <= 10 ? 2 : raw <= 25 ? 5 : raw <= 50 ? 10 : 20;
  return Math.ceil(raw / step) * step;
});
const yTicks = computed(() => {
  const max = yMax.value;
  const step = max <= 5 ? 1 : max <= 10 ? 2 : max <= 25 ? 5 : max <= 50 ? 10 : 20;
  const ticks: number[] = [];
  for (let tick = 0; tick <= max; tick += step) ticks.push(tick);
  return ticks;
});
const x = (index: number) => PAD_L + (series.value.length > 1 ? index / (series.value.length - 1) : 0) * (W - PAD_L - PAD_R);
const y = (value: number) => H - PAD_B - value / yMax.value * (H - PAD_T - PAD_B);

function linePath(key: "web" | "ts"): string {
  let d = "";
  let open = false;
  series.value.forEach((point, index) => {
    const value = point[key];
    if (value === null) { open = false; return; }
    d += `${open ? "L" : "M"}${x(index).toFixed(1)},${y(value).toFixed(1)}`;
    open = true;
  });
  return d;
}
function areaPath(key: "web" | "ts"): string {
  let d = "";
  let run: number[] = [];
  const flush = () => {
    if (run.length) {
      d += `M${x(run[0]!).toFixed(1)},${y(0)}` + run.map(index => `L${x(index).toFixed(1)},${y(series.value[index]![key]!).toFixed(1)}`).join("") + `L${x(run[run.length - 1]!).toFixed(1)},${y(0)}Z`;
    }
    run = [];
  };
  series.value.forEach((point, index) => { if (point[key] === null) flush(); else run.push(index); });
  flush();
  return d;
}

const xLabels = computed(() => {
  const value = stats.value;
  if (!value || !series.value.length) return [];
  const labels: Array<{ index: number; text: string }> = [];
  let previousDay = -1;
  let dayCount = 0;
  series.value.forEach((point, index) => {
    const date = new Date(point.at);
    if (value.range === "day") {
      if (date.getMinutes() === 0 && date.getHours() % 3 === 0) labels.push({ index, text: `${String(date.getHours()).padStart(2, "0")}:00` });
      return;
    }
    // The first bucket of each local day: buckets follow UTC, local midnight may fall inside one.
    const day = date.getDate();
    if (day !== previousDay && index > 0 && (value.range === "week" || dayCount++ % 5 === 0)) {
      labels.push({ index, text: date.toLocaleDateString(undefined, value.range === "week" ? { weekday: "short", day: "numeric" } : { day: "numeric", month: "short" }) });
    }
    previousDay = day;
  });
  return labels;
});

const hover = ref<{ index: number } | null>(null);
const chartBox = ref<HTMLElement | null>(null);
function onHover(event: PointerEvent): void {
  const box = chartBox.value?.getBoundingClientRect();
  if (!box || !series.value.length) return;
  const svgX = (event.clientX - box.left) / box.width * W;
  const index = Math.round((svgX - PAD_L) / (W - PAD_L - PAD_R) * (series.value.length - 1));
  hover.value = { index: Math.max(0, Math.min(series.value.length - 1, index)) };
}

const heatMax = computed(() => Math.max(0, ...(stats.value?.heatmap.flat() ?? [0])));
const topMax = computed(() => Math.max(1, ...(stats.value?.top.map(person => person.minutes) ?? [1])));

function formatMinutes(minutes: number): string {
  return minutes >= 60 ? tr("statsHours", { hours: Math.floor(minutes / 60), minutes: minutes % 60 }) : tr("statsMinutes", { minutes });
}
function formatWhen(at: number): string {
  return new Date(at).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
function formatBucket(at: number): string {
  const value = stats.value;
  if (!value) return "";
  const start = new Date(at);
  const end = new Date(at + value.step);
  const time = (date: Date) => date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return `${start.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}, ${time(start)}–${time(end)}`;
}

onMounted(() => { void load(); });
// The current hour fills in while the page is open.
const timer = setInterval(() => { if (document.visibilityState === "visible") void load(); }, 60_000);
onBeforeUnmount(() => clearInterval(timer));
</script>

<style scoped>
.stats-heading-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
.stats-ranges { display: inline-flex; gap: 2px; padding: 3px; border-radius: 12px; border: 1px solid var(--admin-border); background: var(--admin-field); }
.stats-range { min-height: 34px; padding: 0 14px; border: 0; border-radius: 9px; background: transparent; color: var(--admin-muted); font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; }
.stats-range.active { background: var(--admin-accent); color: var(--admin-page); }
.stats-card-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; }
.stats-card-head h3, .stats-heat-card h3, .stats-top-card h3 { margin: 0; }
.stats-legend { display: flex; gap: 14px; color: var(--admin-muted); font-size: 13px; }
.stats-legend span { display: inline-flex; align-items: center; gap: 6px; }
.stats-swatch { display: inline-block; width: 14px; height: 4px; border-radius: 2px; }
.stats-swatch-ts { background: #d08a2c; }
.stats-swatch-web { background: var(--admin-accent); }
.stats-chart-card, .stats-heat-card, .stats-top-card { display: flex; flex-direction: column; gap: 12px; }
.stats-chart { position: relative; height: 280px; margin: 0 0 10px; touch-action: pan-y; }
.stats-chart svg { width: 100%; height: 100%; overflow: visible; }
.stats-grid line { stroke: var(--admin-border); stroke-width: 1; vector-effect: non-scaling-stroke; }
.stats-area-ts { fill: rgba(208, 138, 44, .16); }
.stats-line-ts { fill: none; stroke: #d08a2c; stroke-width: 2; vector-effect: non-scaling-stroke; stroke-linejoin: round; }
.stats-line-web { fill: none; stroke: var(--admin-accent); stroke-width: 2.5; vector-effect: non-scaling-stroke; stroke-linejoin: round; }
.stats-cursor { stroke: var(--admin-muted); stroke-width: 1; stroke-dasharray: 3 3; vector-effect: non-scaling-stroke; }
.stats-y-label { position: absolute; left: 0; transform: translateY(-50%); color: var(--admin-muted); font-size: 11px; font-variant-numeric: tabular-nums; }
.stats-x-label { position: absolute; bottom: 0; transform: translateX(-50%); color: var(--admin-muted); font-size: 11px; white-space: nowrap; }
.stats-tip { position: absolute; top: 4px; display: grid; gap: 2px; min-width: 170px; padding: 8px 10px; border-radius: 10px; border: 1px solid var(--admin-border); background: var(--admin-surface); box-shadow: 0 8px 24px rgba(0, 0, 0, .15); font-size: 12px; pointer-events: none; transform: translateX(8px); }
.stats-columns { display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr); gap: 16px; align-items: start; }
.stats-heat { display: grid; grid-template-columns: 26px repeat(24, minmax(0, 1fr)); gap: 3px; align-items: center; }
.stats-heat-hour { color: var(--admin-muted); font-size: 10px; text-align: left; font-variant-numeric: tabular-nums; }
.stats-heat-day { color: var(--admin-muted); font-size: 11px; }
.stats-heat-cell { aspect-ratio: 1; border-radius: 3px; background: color-mix(in srgb, var(--admin-accent) calc(8% + var(--level) * 92%), var(--admin-field)); }
.stats-heat-scale { display: flex; align-items: center; gap: 8px; color: var(--admin-muted); font-size: 11px; }
.stats-heat-scale i { width: 90px; height: 8px; border-radius: 4px; background: linear-gradient(90deg, color-mix(in srgb, var(--admin-accent) 8%, var(--admin-field)), var(--admin-accent)); }
.stats-top { display: grid; gap: 2px; margin: 0; padding: 0; list-style: none; }
.stats-top-head, .stats-top-row { display: grid; grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr) 52px 44px; align-items: center; gap: 12px; }
.stats-top-head { padding: 0 8px 6px; border-bottom: 1px solid var(--admin-border); color: var(--admin-muted); font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; }
.stats-top-head span:nth-child(n+3) { text-align: right; }
.stats-top-row { padding: 8px; border-radius: 10px; }
.stats-top-row:nth-child(even) { background: var(--admin-field); }
.stats-top-name { display: flex; align-items: center; gap: 10px; min-width: 0; }
.stats-top-name b { flex: 0 0 22px; color: var(--admin-muted); font-size: 12px; text-align: right; font-variant-numeric: tabular-nums; }
.stats-top-name > span { display: grid; min-width: 0; }
.stats-top-name strong { font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.stats-top-name small { color: var(--admin-muted); font-size: 11px; }
.stats-top-time { font-size: 13px; font-variant-numeric: tabular-nums; }
.stats-top-num { font-size: 14px; text-align: right; font-variant-numeric: tabular-nums; }
.stats-bar { display: block; width: 100%; max-width: 160px; height: 5px; margin-bottom: 4px; border-radius: 3px; background: var(--admin-field); overflow: hidden; }
.stats-bar i { display: block; height: 100%; border-radius: 3px; background: var(--admin-accent); }
@media (max-width: 980px) {
  .stats-columns { grid-template-columns: 1fr; }
}
@media (max-width: 640px) {
  .stats-chart { height: 220px; }
  .stats-top-head, .stats-top-row { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 36px; gap: 8px; }
  .stats-top-head span:last-child, .stats-top-row > span:last-child { display: none; }
}
</style>
