type EventSource = Pick<EventTarget, "addEventListener" | "removeEventListener">;

export interface BackgroundRecoveryVisibility extends EventSource {
  readonly visibilityState: string;
}

export interface BackgroundRecoveryOptions {
  /** Phone browsers only: desktop browsers and the desktop shell keep today's behaviour. */
  enabled(): boolean;
  /** A session dropped by the transport (not by the user or the server) that may be rejoined now. */
  canResume(): boolean;
  /** Rejoin the last server. */
  resume(): void;
  /** Restart audio the browser paused while the page was in the background (all platforms; no-op when running). */
  wakeAudio(): void;
}

export interface BackgroundRecoveryTimers {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface BackgroundRecoveryController {
  /** The socket just dropped; retry soon if the page is visible, otherwise on return. */
  dropped(): void;
  /** The session is up again: forget earlier attempts. */
  connected(): void;
  /** The user left or changed servers: never rejoin on their behalf. */
  cancel(): void;
  dispose(): void;
}

/** Delays between rejoin attempts while the page stays visible; then the user decides. */
export const BACKGROUND_RECOVERY_DELAYS_MS = [1500, 5000, 15000] as const;

/**
 * Rejoin a phone session that the browser or the network dropped while the page
 * was in the background, and wake suspended audio when the page returns.
 */
export function createBackgroundRecovery(
  visibility: BackgroundRecoveryVisibility,
  pageLifecycle: EventSource,
  options: BackgroundRecoveryOptions,
  timers: BackgroundRecoveryTimers = { setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms), clearTimeout: handle => globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>) },
): BackgroundRecoveryController {
  let attempts = 0;
  let pending = false;
  let timer: unknown = null;
  let disposed = false;

  const visible = () => visibility.visibilityState === "visible";
  const clearTimer = () => {
    if (timer !== null) timers.clearTimeout(timer);
    timer = null;
  };

  const attempt = (): void => {
    clearTimer();
    if (disposed || !pending || !visible() || !options.enabled() || !options.canResume()) return;
    if (attempts >= BACKGROUND_RECOVERY_DELAYS_MS.length) return;
    attempts += 1;
    options.resume();
  };

  const schedule = (): void => {
    clearTimer();
    if (disposed || !pending || attempts >= BACKGROUND_RECOVERY_DELAYS_MS.length) return;
    timer = timers.setTimeout(attempt, BACKGROUND_RECOVERY_DELAYS_MS[attempts]);
  };

  const onReturn: EventListener = () => {
    if (disposed || !visible()) return;
    options.wakeAudio();
    // Coming back is a fresh chance even after the visible retries ran out.
    if (pending) { attempts = 0; attempt(); }
  };
  const onOnline: EventListener = () => { if (pending && visible()) { attempts = 0; attempt(); } };

  visibility.addEventListener("visibilitychange", onReturn);
  pageLifecycle.addEventListener("pageshow", onReturn);
  pageLifecycle.addEventListener("online", onOnline);

  return {
    dropped() {
      if (disposed || !options.enabled() || !options.canResume()) return;
      pending = true;
      if (!visible()) { clearTimer(); return; }
      schedule();
    },
    connected() {
      attempts = 0;
      pending = false;
      clearTimer();
    },
    cancel() {
      attempts = 0;
      pending = false;
      clearTimer();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      clearTimer();
      visibility.removeEventListener("visibilitychange", onReturn);
      pageLifecycle.removeEventListener("pageshow", onReturn);
      pageLifecycle.removeEventListener("online", onOnline);
    },
  };
}
