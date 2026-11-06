type EventSource = Pick<EventTarget, "addEventListener" | "removeEventListener">;

export interface BackgroundRecoveryVisibility extends EventSource {
  readonly visibilityState: string;
}

export interface BackgroundRecoveryOptions {
  /** Whether automatic rejoining is on at all. */
  enabled(): boolean;
  /**
   * Keep retrying while the page is hidden. Desktop browsers and the desktop
   * shell (often minimised to the tray) do; phones wait until the page is back,
   * since a background tab's socket would be dropped again anyway.
   */
  retryWhileHidden?(): boolean;
  /** A session dropped by the transport (not by the user or the server) that may be rejoined now. */
  canResume(): boolean;
  /** Rejoin the last server. */
  resume(): void;
  /** Restart audio the browser paused while the page was in the background (all platforms; no-op when running). */
  wakeAudio(): void;
  /** What the page shows while it waits to rejoin. */
  onStatus?(status: RecoveryStatus): void;
}

export interface RecoveryStatus {
  /** A rejoin is pending (waiting for the next attempt, for the page to return, or for the network). */
  pending: boolean;
  /** Attempts made since the drop. */
  attempt: number;
  /** When the next automatic attempt runs (ms since epoch), or null when none is scheduled. */
  nextAttemptAt: number | null;
  /** The automatic attempts ran out; only the user (or the network/page coming back) can retry. */
  exhausted: boolean;
}

export interface BackgroundRecoveryTimers {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  now?(): number;
}

export interface BackgroundRecoveryController {
  /** The socket just dropped; retry soon (or, on a phone in the background, on return). */
  dropped(): void;
  /** The session is up again: forget earlier attempts. */
  connected(): void;
  /** The user left or changed servers: never rejoin on their behalf. */
  cancel(): void;
  /** The user asked to retry right away. */
  retryNow(): void;
  dispose(): void;
}

/**
 * Delays between rejoin attempts: quick at first for a network blip, then every
 * 30 s for about five minutes in all, long enough for a server restart.
 */
export const BACKGROUND_RECOVERY_DELAYS_MS = [1500, 3000, 5000, 10_000, 15_000, 30_000, 30_000, 30_000, 30_000, 30_000, 30_000, 30_000, 30_000, 30_000] as const;

/**
 * Rejoin a session that the network or a restart of the server dropped, and
 * wake suspended audio when the page returns.
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
  let nextAttemptAt: number | null = null;
  let disposed = false;
  const now = () => timers.now?.() ?? Date.now();

  const visible = () => visibility.visibilityState === "visible";
  const mayRetry = () => visible() || Boolean(options.retryWhileHidden?.());
  const exhausted = () => attempts >= BACKGROUND_RECOVERY_DELAYS_MS.length;
  const report = () => options.onStatus?.({ pending, attempt: attempts, nextAttemptAt, exhausted: pending && exhausted() && nextAttemptAt === null });
  const clearTimer = () => {
    if (timer !== null) timers.clearTimeout(timer);
    timer = null;
    nextAttemptAt = null;
  };

  const attempt = (): void => {
    clearTimer();
    if (disposed || !pending || !mayRetry() || !options.enabled() || !options.canResume()) { report(); return; }
    if (exhausted()) { report(); return; }
    attempts += 1;
    report();
    options.resume();
  };

  const schedule = (): void => {
    clearTimer();
    if (disposed || !pending || exhausted()) { report(); return; }
    const delay = BACKGROUND_RECOVERY_DELAYS_MS[attempts]!;
    nextAttemptAt = now() + delay;
    timer = timers.setTimeout(attempt, delay);
    report();
  };

  const onReturn: EventListener = () => {
    if (disposed || !visible()) return;
    options.wakeAudio();
    // Coming back is a fresh chance even after the retries ran out.
    if (pending) { attempts = 0; attempt(); }
  };
  const onOnline: EventListener = () => { if (pending && mayRetry()) { attempts = 0; attempt(); } };

  visibility.addEventListener("visibilitychange", onReturn);
  pageLifecycle.addEventListener("pageshow", onReturn);
  pageLifecycle.addEventListener("online", onOnline);

  return {
    dropped() {
      if (disposed || !options.enabled() || !options.canResume()) return;
      pending = true;
      if (!mayRetry()) { clearTimer(); report(); return; }
      schedule();
    },
    connected() {
      attempts = 0;
      pending = false;
      clearTimer();
      report();
    },
    cancel() {
      attempts = 0;
      pending = false;
      clearTimer();
      report();
    },
    retryNow() {
      if (disposed || !pending) return;
      // A manual retry restarts the schedule if it fails again.
      attempts = 0;
      clearTimer();
      if (!options.enabled() || !options.canResume()) { report(); return; }
      attempts = 1;
      report();
      options.resume();
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
