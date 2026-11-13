import { ref, type Ref } from "vue";
import type { OnlineMonthSummary, OnlineStats, OnlineStatsRange } from "../../../src/shared/online-stats.js";
import { isAdminRequestCancelled, type AdminApi } from "../services/admin-api.js";
import { createAdminRequests } from "../services/admin-requests.js";

interface Options {
  api: AdminApi;
  errorMessage: Ref<string>;
  errorText(code?: string): string;
}

/** The admin statistics page: one range at a time, refreshed while the page is open. */
export function useAdminStats(options: Options) {
  const requests = createAdminRequests();
  const range = ref<OnlineStatsRange>("day");
  const stats = ref<OnlineStats | null>(null);
  const loading = ref(false);

  async function load(): Promise<void> {
    const request = requests.begin("load");
    loading.value = true;
    try {
      const result = await options.api.onlineStats(range.value, new Date().getTimezoneOffset(), request.signal);
      if (request.isCurrent()) stats.value = result;
    } catch (error) {
      if (request.isCurrent() && !isAdminRequestCancelled(error)) options.errorMessage.value = options.errorText((error as { code?: string }).code);
    } finally {
      if (request.isCurrent()) loading.value = false;
      request.finish();
    }
  }

  function setRange(value: OnlineStatsRange): void {
    if (range.value === value) return;
    range.value = value;
    stats.value = null;
    void load();
  }

  // ---- Month in review ----
  const today = new Date();
  const month = ref(`${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`);
  const summary = ref<OnlineMonthSummary | null>(null);

  async function loadMonth(): Promise<void> {
    const request = requests.begin("month");
    try {
      const result = await options.api.onlineMonth(month.value, new Date().getTimezoneOffset(), request.signal);
      if (request.isCurrent()) summary.value = result;
    } catch (error) {
      if (request.isCurrent() && !isAdminRequestCancelled(error)) options.errorMessage.value = options.errorText((error as { code?: string }).code);
    } finally {
      request.finish();
    }
  }

  /** Steps a month back or forward, never past the current one. */
  function shiftMonth(step: number): void {
    const [year, number] = month.value.split("-").map(Number);
    const next = new Date(year!, number! - 1 + step, 1);
    const current = new Date(today.getFullYear(), today.getMonth(), 1);
    if (next > current) return;
    month.value = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`;
    summary.value = null;
    void loadMonth();
  }
  const isCurrentMonth = () => month.value === `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;

  return { range, stats, loading, load, setRange, month, summary, loadMonth, shiftMonth, isCurrentMonth };
}

export type AdminStatsModel = ReturnType<typeof useAdminStats>;
