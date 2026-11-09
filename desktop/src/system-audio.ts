import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { BrowserWindow, ipcMain, type WebFrameMain } from "electron";

/*
 * System sound for a screen share WITHOUT WebSpeak's own audio.
 *
 * Chromium's "loopback" audio is everything the PC plays, so viewers would
 * also hear the channel's voices. On Windows 10 2004+ a small helper
 * (native/audio-capture.cpp) uses WASAPI process loopback: for a screen it
 * captures everything except this process tree, for a window only the program
 * that owns that window. Its PCM is played in a hidden, muted window whose
 * frame audio Electron can attach to the screen share as its audio track. That
 * window belongs to WebSpeak, so the helper never hears it back.
 */

/** The window handle in a desktopCapturer id ("window:<hwnd>:<n>"), or null for a screen. */
export function windowHandleOf(sourceId: string): string | null {
  const match = /^window:(\d+):/.exec(sourceId);
  return match && match[1] !== "0" ? match[1]! : null;
}

type Probe = "unknown" | "supported" | "unsupported";

/** One running capture: its frame carries the sound; stop() releases the helper and window. */
export interface SystemAudioCapture {
  readonly frame: WebFrameMain;
  stop(): void;
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

export class SystemAudio {
  private probe: Probe = "unknown";
  private readonly captures = new Set<SystemAudioCapture>();

  constructor(
    private readonly helperPath: string,
    private readonly staticDir: string,
    private readonly preloadPath: string,
    private readonly log: (message: string) => void = () => {},
    private readonly anyPlatform = false,
  ) {}

  get supported(): boolean {
    return this.probe === "supported";
  }

  get active(): boolean {
    return this.captures.size > 0;
  }

  /** Check once whether the helper exists and process loopback works on this PC. */
  async detect(): Promise<boolean> {
    if (this.probe !== "unknown") return this.supported;
    if ((process.platform !== "win32" && !this.anyPlatform) || !existsSync(this.helperPath)) {
      this.probe = "unsupported";
      return false;
    }
    const ok = await new Promise<boolean>((resolve) => {
      const child = spawn(this.helperPath, [String(process.pid), "--probe"], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
      const timer = setTimeout(() => { child.kill(); resolve(false); }, 8000);
      child.on("error", () => { clearTimeout(timer); resolve(false); });
      child.on("exit", (code) => { clearTimeout(timer); resolve(code === 0); });
    });
    this.probe = ok ? "supported" : "unsupported";
    this.log(`system audio without WebSpeak: ${this.probe}`);
    return ok;
  }

  /**
   * Start a capture and return it, or null when it could not start (the caller
   * then falls back). Several captures may run at once, e.g. a screen share and
   * an accompaniment; onEnded runs when the helper exits on its own.
   */
  async start(windowHandle: string | null = null, onEnded: (capture: SystemAudioCapture) => void = () => {}): Promise<SystemAudioCapture | null> {
    if (!(await this.detect())) return null;
    let stopped = false;
    let helper: ChildProcess | null = null;
    const window = new BrowserWindow({
      show: false,
      width: 200,
      height: 100,
      skipTaskbar: true,
      webPreferences: {
        preload: this.preloadPath,
        contextIsolation: true,
        sandbox: true,
        backgroundThrottling: false,
        autoplayPolicy: "no-user-gesture-required",
      },
    });
    const capture: SystemAudioCapture = {
      frame: window.webContents.mainFrame,
      stop: () => {
        if (stopped) return;
        stopped = true;
        this.captures.delete(capture);
        if (helper && helper.exitCode === null) helper.kill();
        if (!window.isDestroyed()) window.destroy();
      },
    };
    this.captures.add(capture);
    // Viewers get the sound through the capture; the sharer already hears it.
    window.webContents.setAudioMuted(true);
    const ready = new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => { ipcMain.removeListener("system-audio:ready", onReady); resolve(false); }, 5000);
      const onReady = (event: Electron.IpcMainEvent) => {
        if (window.isDestroyed() || event.sender !== window.webContents) return;
        clearTimeout(timer);
        ipcMain.removeListener("system-audio:ready", onReady);
        resolve(true);
      };
      ipcMain.on("system-audio:ready", onReady);
    });
    void window.loadFile(join(this.staticDir, "system-audio.html"));
    if (!(await ready) || stopped) { capture.stop(); return null; }

    const args = windowHandle ? [String(process.pid), "--window", windowHandle] : [String(process.pid)];
    const child = spawn(this.helperPath, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    helper = child;
    child.stdout!.on("data", (chunk: Buffer) => {
      if (!stopped && !window.isDestroyed()) window.webContents.send("system-audio:chunk", new Uint8Array(chunk));
    });
    child.stderr!.on("data", (chunk: Buffer) => this.log(chunk.toString().trim()));
    const started = await new Promise<boolean>((resolve) => {
      // Silence produces no data, so a helper still running after a moment counts as started.
      const timer = setTimeout(() => resolve(true), 800);
      child.once("error", () => { clearTimeout(timer); resolve(false); });
      child.once("exit", (code) => {
        clearTimeout(timer);
        if (code === 3) this.probe = "unsupported";
        resolve(false);
      });
    });
    if (!started || stopped) { capture.stop(); return null; }
    child.once("exit", () => { if (!stopped) { capture.stop(); onEnded(capture); } });
    return capture;
  }

  /** Release every capture (the app quits). */
  stop(): void {
    for (const capture of [...this.captures]) capture.stop();
  }
}
