import { ref, type Ref } from "vue";
import type { OnlineStats, OnlineStatsRange } from "../../../src/shared/online-stats.js";
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

  return { range, stats, loading, load, setRange };
}

export type AdminStatsModel = ReturnType<typeof useAdminStats>;
