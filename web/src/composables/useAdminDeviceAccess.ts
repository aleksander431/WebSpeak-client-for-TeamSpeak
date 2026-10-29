import { onScopeDispose, reactive, ref, watch, type Ref } from "vue";
import type { DeviceAccessDevice } from "../../../src/shared/admin-responses.js";
import type { copy } from "../i18n/admin.js";
import { isAdminRequestCancelled, type AdminApi } from "../services/admin-api.js";
import { createAdminRequests } from "../services/admin-requests.js";

const POLL_INTERVAL_MS = 10_000;

interface Options {
  api: AdminApi;
  errorMessage: Ref<string>;
  errorText(code?: string): string;
  tr(key: keyof typeof copy.zh, vars?: Record<string, string | number>): string;
  /** True while an authenticated administrator is looking at the console. */
  active: Readonly<Ref<boolean>>;
}

export type DeviceDecision = "approve" | "deny" | "forget";

/**
 * Device approval state for the console. The pending count is refreshed in
 * the background on every admin page so a new request shows up in the
 * sidebar badge and the tab title without a manual refresh.
 */
export function useAdminDeviceAccess(options: Options) {
  const requests = createAdminRequests();
  const pollRequests = createAdminRequests();
  const loading = ref(false), savingSetting = ref(false);
  const busyDevices = reactive(new Set<string>());
  const access = reactive({ required: false, pendingCount: 0, devices: [] as DeviceAccessDevice[], loaded: false });
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  const baseTitle = typeof document === "undefined" ? "" : document.title;

  function apply(listing: { required: boolean; pendingCount: number; devices: DeviceAccessDevice[] }) {
    access.required = listing.required;
    access.pendingCount = listing.pendingCount;
    access.devices = listing.devices;
    access.loaded = true;
  }
  function report(error: unknown) {
    if (!isAdminRequestCancelled(error)) options.errorMessage.value = options.errorText((error as { code?: string }).code);
  }
  function cancelRequests() {
    requests.reset();
    loading.value = false; savingSetting.value = false;
    busyDevices.clear();
  }
  function reset() {
    cancelRequests();
    stopPolling();
    access.required = false; access.pendingCount = 0; access.devices = []; access.loaded = false;
  }

  async function load() {
    const request = requests.begin("load");
    loading.value = true;
    try {
      const listing = await options.api.deviceAccess(request.signal);
      if (request.isCurrent()) apply(listing);
    } catch (error) { if (request.isCurrent()) report(error); }
    finally { if (request.isCurrent()) loading.value = false; request.finish(); }
  }

  async function setRequired(required: boolean) {
    if (savingSetting.value) return;
    const request = requests.begin("setting");
    savingSetting.value = true; options.errorMessage.value = "";
    let saved = false;
    try {
      await options.api.setDeviceApprovalRequired(required, request.signal);
      if (request.isCurrent()) { access.required = required; saved = true; }
    } catch (error) { if (request.isCurrent()) report(error); }
    finally { if (request.isCurrent()) savingSetting.value = false; request.finish(); }
    if (saved) await load();
  }

  async function decide(device: DeviceAccessDevice, action: DeviceDecision) {
    if (busyDevices.has(device.id)) return;
    const name = device.nickname || options.tr("deviceUnnamed");
    if (action === "forget" && !window.confirm(options.tr("deviceConfirmForget", { nickname: name }))) return;
    if (action === "deny" && device.status === "approved" && !window.confirm(options.tr("deviceConfirmRevoke", { nickname: name }))) return;
    const request = requests.begin(`decide:${device.id}`);
    busyDevices.add(device.id); options.errorMessage.value = "";
    try {
      await options.api.decideDevice(device.id, action, request.signal);
      if (request.isCurrent()) await load();
    } catch (error) { if (request.isCurrent()) report(error); }
    finally { busyDevices.delete(device.id); request.finish(); }
  }

  async function pollOnce() {
    const request = pollRequests.begin("poll");
    try {
      const listing = await options.api.deviceAccess(request.signal);
      // Only the count and setting are refreshed here; the list itself is
      // replaced too, unless the administrator is in the middle of a decision.
      if (!request.isCurrent()) return;
      if (busyDevices.size === 0 && !loading.value) apply(listing);
      else { access.pendingCount = listing.pendingCount; access.required = listing.required; }
    } catch {
      // Background refresh failures are silent; the next tick retries.
    } finally { request.finish(); }
  }
  function startPolling() {
    stopPolling();
    void pollOnce();
    pollTimer = setInterval(() => { void pollOnce(); }, POLL_INTERVAL_MS);
  }
  function stopPolling() {
    if (pollTimer !== undefined) clearInterval(pollTimer);
    pollTimer = undefined;
    pollRequests.reset();
  }

  watch(options.active, (active) => { if (active) startPolling(); else stopPolling(); }, { immediate: true });
  watch(() => access.pendingCount, (count) => {
    if (typeof document !== "undefined") document.title = count > 0 ? `(${count}) ${baseTitle}` : baseTitle;
  });
  onScopeDispose(() => {
    reset();
    if (typeof document !== "undefined") document.title = baseTitle;
  });

  return { access, loading, savingSetting, busyDevices, load, setRequired, decide, cancelRequests, reset };
}

export type AdminDeviceAccessModel = ReturnType<typeof useAdminDeviceAccess>;
