import { computed, onScopeDispose, watch, type Ref } from "vue";

export const APPROVAL_PENDING = "APPROVAL_PENDING";
export const APPROVAL_DENIED = "APPROVAL_DENIED";
export const APPROVAL_QUEUE_FULL = "APPROVAL_QUEUE_FULL";
const POLL_INTERVAL_MS = 4_000;
const REQUEST_TIMEOUT_MS = 8_000;

interface Options {
  /** The current join failure code; approval states arrive here from /api/join-ticket. */
  errorCode: Readonly<Ref<string>>;
  /** Repeat the join once the administrator has answered. */
  retry(): void;
  /** Leave the waiting state without joining. */
  cancel(): void;
  fetch?: typeof fetch;
}

/**
 * While this browser waits for the administrator, poll the access status and
 * repeat the join as soon as the answer changes. The gateway re-evaluates the
 * join itself, so an approval connects and a denial shows the denied notice.
 */
export function useDeviceApproval(options: Options) {
  const fetcher = options.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const waiting = computed(() => options.errorCode.value === APPROVAL_PENDING);
  const denied = computed(() => options.errorCode.value === APPROVAL_DENIED);
  const queueFull = computed(() => options.errorCode.value === APPROVAL_QUEUE_FULL);
  const handlesError = computed(() => waiting.value || denied.value || queueFull.value);
  let timer: ReturnType<typeof setTimeout> | null = null;
  let controller: AbortController | null = null;
  let generation = 0;

  function stop() {
    generation += 1;
    if (timer !== null) clearTimeout(timer);
    timer = null;
    controller?.abort();
    controller = null;
  }

  function schedule(owner: number) {
    timer = setTimeout(() => { void poll(owner); }, POLL_INTERVAL_MS);
  }

  async function poll(owner: number) {
    timer = null;
    if (owner !== generation) return;
    const request = new AbortController();
    controller = request;
    const deadline = setTimeout(() => request.abort(), REQUEST_TIMEOUT_MS);
    let status = "";
    try {
      const response = await fetcher("/api/access-status", { headers: { accept: "application/json" }, cache: "no-store", signal: request.signal });
      const body: unknown = response.ok ? await response.json().catch(() => null) : null;
      if (body && typeof body === "object" && "status" in body && typeof body.status === "string") status = body.status;
    } catch {
      // A failed poll is retried on the next interval; the visitor keeps waiting.
    } finally {
      clearTimeout(deadline);
      if (controller === request) controller = null;
    }
    if (owner !== generation) return;
    if (status && status !== "pending") {
      stop();
      options.retry();
      return;
    }
    schedule(owner);
  }

  watch(waiting, (isWaiting) => {
    stop();
    if (isWaiting) schedule(generation);
  }, { immediate: true });

  function cancel() {
    stop();
    options.cancel();
  }

  onScopeDispose(stop);
  return { waiting, denied, queueFull, handlesError, cancel };
}
