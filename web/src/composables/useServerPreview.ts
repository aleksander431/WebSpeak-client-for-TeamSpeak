import { onBeforeUnmount, shallowRef, watch, type Ref } from "vue";
import { parseServerPreview, type ServerPreview } from "../../../src/shared/server-preview.js";

/** How often the join page refreshes who is on the server while it is visible. */
export const SERVER_PREVIEW_POLL_MS = 10_000;

/**
 * Who is on the fixed server, for the join page. Polls only while enabled
 * and the page is visible; every request belongs to the current enablement.
 */
export function useServerPreview(enabled: Readonly<Ref<boolean>>, fetcher: typeof fetch = (...args) => fetch(...args)) {
  const preview = shallowRef<ServerPreview | null>(null);
  const loading = shallowRef(false);
  let timer: ReturnType<typeof setTimeout> | null = null;
  let controller: AbortController | null = null;
  let generation = 0;

  const visible = () => typeof document === "undefined" || document.visibilityState === "visible";
  const clear = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    controller?.abort();
    controller = null;
  };
  const schedule = (current: number) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { if (current === generation) void load(current); }, SERVER_PREVIEW_POLL_MS);
  };

  async function load(current: number): Promise<void> {
    if (!enabled.value || current !== generation) return;
    if (!visible()) return;
    controller?.abort();
    const request = new AbortController();
    controller = request;
    loading.value = preview.value === null;
    try {
      const response = await fetcher("/api/server-preview", { credentials: "same-origin", cache: "no-store", signal: request.signal });
      const next = parseServerPreview(await response.json());
      if (current !== generation) return;
      preview.value = next;
      // Nothing will change for an unapproved browser or an open gateway.
      if (!next.available && (next.reason === "approval-required" || next.reason === "open-mode")) return;
    } catch {
      if (current !== generation || request.signal.aborted) return;
      preview.value ??= { available: false, reason: "unavailable" };
    } finally {
      if (current === generation) loading.value = false;
      if (controller === request) controller = null;
    }
    schedule(current);
  }

  const restart = () => {
    generation += 1;
    clear();
    if (enabled.value) void load(generation);
  };
  const onVisibility = () => { if (enabled.value && visible() && !controller) { clear(); void load(generation); } };

  watch(enabled, value => { if (value) restart(); else { generation += 1; clear(); } }, { immediate: true });
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisibility);
  onBeforeUnmount(() => {
    generation += 1;
    clear();
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisibility);
  });

  return { preview, loading, refresh: restart };
}
