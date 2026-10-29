import { computed, onScopeDispose, reactive, watch, type Ref } from "vue";

export const APPROVAL_PENDING = "APPROVAL_PENDING";
export const APPROVAL_DENIED = "APPROVAL_DENIED";
export const APPROVAL_QUEUE_FULL = "APPROVAL_QUEUE_FULL";
export const ACCOUNT_PASSWORD_REQUIRED = "ACCOUNT_PASSWORD_REQUIRED";
export const ACCOUNT_PASSWORD_MIN_LENGTH = 6;
const SETUP_DISMISSED_KEY = "webspeak:account-setup-dismissed";
const POLL_INTERVAL_MS = 4_000;
const REQUEST_TIMEOUT_MS = 8_000;

interface Options {
  /** The current join failure code; approval states arrive here from /api/join-ticket. */
  errorCode: Readonly<Ref<string>>;
  /** Repeat the join once the administrator has answered. */
  retry(): void;
  /** Leave the waiting state without joining. */
  cancel(): void;
  /** The nickname being used, for password-protected nicknames. */
  nickname: Readonly<Ref<string>>;
  /** True once the voice session is connected. */
  connected: Readonly<Ref<boolean>>;
  /** Whether the gateway asks for administrator approval at all. */
  approvalRequired: Readonly<Ref<boolean>>;
  /** Shown after a password was created. */
  onAccountCreated?(): void;
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
  const passwordRequired = computed(() => options.errorCode.value === ACCOUNT_PASSWORD_REQUIRED);
  const handlesError = computed(() => waiting.value || denied.value || queueFull.value || passwordRequired.value);
  /** The password dialog: sign in to a protected nickname, or protect one. */
  const accountDialog = reactive({ open: false, mode: "sign-in" as "sign-in" | "create", nickname: "", busy: false, errorCode: "" });
  let accountGeneration = 0;
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

  function openAccountDialog(mode: "sign-in" | "create", nickname: string) {
    accountGeneration += 1;
    Object.assign(accountDialog, { open: true, mode, nickname, busy: false, errorCode: "" });
  }

  function closeAccountDialog() {
    accountGeneration += 1;
    const wasSignIn = accountDialog.open && accountDialog.mode === "sign-in";
    if (accountDialog.open && accountDialog.mode === "create") rememberDismissed(accountDialog.nickname);
    Object.assign(accountDialog, { open: false, busy: false, errorCode: "" });
    if (wasSignIn && passwordRequired.value) options.cancel();
  }

  async function submitAccountPassword(password: string) {
    if (!accountDialog.open || accountDialog.busy) return;
    const owner = ++accountGeneration;
    const { mode, nickname } = accountDialog;
    accountDialog.busy = true; accountDialog.errorCode = "";
    let code = "";
    try {
      const response = await fetcher(`/api/account/${mode === "create" ? "setup" : "sign-in"}`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ nickname, password }),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) code = body && typeof body === "object" && "code" in body && typeof body.code === "string" ? body.code : "REQUEST_FAILED";
    } catch {
      code = "REQUEST_FAILED";
    }
    if (owner !== accountGeneration) return;
    accountDialog.busy = false;
    if (code) { accountDialog.errorCode = code; return; }
    Object.assign(accountDialog, { open: false, errorCode: "" });
    if (mode === "create") options.onAccountCreated?.();
    else options.retry();
  }

  // A protected nickname on a browser that is not linked to it: ask for its password.
  watch(passwordRequired, (required) => {
    if (required) openAccountDialog("sign-in", options.nickname.value.trim());
    else if (accountDialog.open && accountDialog.mode === "sign-in") { accountGeneration += 1; accountDialog.open = false; }
  }, { immediate: true });

  // After joining from an approved browser, offer to protect the nickname
  // with a password so the owner can approve their other devices.
  watch([options.connected, options.approvalRequired], async ([connected, required]) => {
    if (!connected || !required || accountDialog.open) return;
    const nickname = options.nickname.value.trim();
    if (!nickname || isDismissed(nickname)) return;
    const owner = ++accountGeneration;
    try {
      const response = await fetcher(`/api/access-status?nickname=${encodeURIComponent(nickname)}`, { headers: { accept: "application/json" }, cache: "no-store" });
      const body: unknown = response.ok ? await response.json().catch(() => null) : null;
      if (owner !== accountGeneration || !options.connected.value) return;
      if (body && typeof body === "object" && "canCreate" in body && body.canCreate === true) openAccountDialog("create", nickname);
    } catch {
      // Optional prompt; failure leaves the session untouched.
    }
  });

  onScopeDispose(() => { stop(); accountGeneration += 1; });
  return {
    waiting, denied, queueFull, passwordRequired, handlesError, cancel,
    accountDialog, submitAccountPassword, closeAccountDialog, passwordMinLength: ACCOUNT_PASSWORD_MIN_LENGTH,
  };
}

function storage(): Storage | null {
  try { return typeof sessionStorage === "undefined" ? null : sessionStorage; } catch { return null; }
}

/** "Later" hides the prompt for that nickname until the browser tab is closed. */
function rememberDismissed(nickname: string) {
  try { storage()?.setItem(`${SETUP_DISMISSED_KEY}:${nickname.toLocaleLowerCase("en-US")}`, "1"); } catch { /* optional */ }
}

function isDismissed(nickname: string): boolean {
  try { return storage()?.getItem(`${SETUP_DISMISSED_KEY}:${nickname.toLocaleLowerCase("en-US")}`) === "1"; } catch { return false; }
}
