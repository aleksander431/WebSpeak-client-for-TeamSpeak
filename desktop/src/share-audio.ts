/*
 * Electron-free helpers for the share sound capture, so they can be tested
 * without the desktop dependencies installed.
 */

/** The window handle in a desktopCapturer id ("window:<hwnd>:<n>"), or null for a screen. */
export function windowHandleOf(sourceId: string): string | null {
  const match = /^window:(\d+):/.exec(sourceId);
  return match && match[1] !== "0" ? match[1]! : null;
}

export type ShareKind = "stream" | "accompaniment";

export interface ShareActivity {
  streaming: boolean;
  /** Older pages do not report it. */
  accompaniment: boolean;
}

interface TrackerTimers {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/**
 * Ties each capture to the share that uses it. The display-media handler
 * cannot tell a screen share from an accompaniment request, so a new capture
 * waits for the page to report which share just started; it then lives as
 * long as that share. A capture no share claims within the grace period (the
 * page never used it) is released.
 */
export class ShareAudioTracker<C extends { stop(): void }> {
  private entries: Array<{ capture: C; kind: ShareKind | null; timer: unknown }> = [];
  private last: ShareActivity = { streaming: false, accompaniment: false };

  constructor(
    private readonly graceMs = 30_000,
    private readonly timers: TrackerTimers = { setTimeout: (callback, ms) => setTimeout(callback, ms), clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout) },
  ) {}

  get size(): number {
    return this.entries.length;
  }

  add(capture: C): void {
    const entry: { capture: C; kind: ShareKind | null; timer: unknown } = { capture, kind: null, timer: null };
    entry.timer = this.timers.setTimeout(() => { if (entry.kind === null) this.remove(entry); }, this.graceMs);
    this.entries.push(entry);
  }

  update(activity: ShareActivity): void {
    for (const kind of ["stream", "accompaniment"] as const) {
      const key = kind === "stream" ? "streaming" : "accompaniment";
      const was = this.last[key];
      const now = activity[key];
      if (!was && now) {
        // The share that just started uses the newest capture nobody claimed.
        const entry = [...this.entries].reverse().find((item) => item.kind === null);
        if (entry) { entry.kind = kind; this.timers.clearTimeout(entry.timer); entry.timer = null; }
      } else if (was && !now) {
        for (const entry of this.entries.filter((item) => item.kind === kind)) this.remove(entry);
      }
    }
    this.last = { ...activity };
  }

  /** The page went away: nothing uses any capture any more. */
  reset(): void {
    for (const entry of [...this.entries]) this.remove(entry);
    this.last = { streaming: false, accompaniment: false };
  }

  private remove(entry: { capture: C; kind: ShareKind | null; timer: unknown }): void {
    const index = this.entries.indexOf(entry);
    if (index < 0) return;
    this.entries.splice(index, 1);
    if (entry.timer !== null) this.timers.clearTimeout(entry.timer);
    try { entry.capture.stop(); } catch { /* already gone */ }
  }

  /** A capture whose helper exited on its own. */
  forget(capture: C): void {
    const entry = this.entries.find((item) => item.capture === capture);
    if (entry) this.remove(entry);
  }
}
