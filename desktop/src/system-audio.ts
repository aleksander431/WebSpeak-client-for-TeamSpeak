import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { BrowserWindow, ipcMain, type WebFrameMain } from "electron";

/*
 * System sound for a screen share WITHOUT WebSpeak's own audio.
 *
 * Chromium's "loopback" audio is everything the PC plays, so viewers would
 * also hear the channel's voices. On Windows 10 2004+ a small helper
 * (native/audio-capture.cpp) captures everything except this process tree
 * with WASAPI process loopback. Its PCM is played in a hidden, muted window
 * whose frame audio Electron can attach to the screen share as its audio
 * track. That window belongs to WebSpeak, so the helper never hears it back.
 */

type Probe = "unknown" | "supported" | "unsupported";

export class SystemAudio {
  private probe: Probe = "unknown";
  private window: BrowserWindow | null = null;
  private helper: ChildProcess | null = null;
  private generation = 0;

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
    return this.helper !== null;
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
   * Start capturing and return the frame whose audio carries it, or null
   * when it could not start (the caller then falls back to plain loopback).
   */
  async start(): Promise<WebFrameMain | null> {
    this.stop();
    if (!(await this.detect())) return null;
    const generation = ++this.generation;
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
    this.window = window;
    // Viewers get the sound through the capture; the sharer already hears it.
    window.webContents.setAudioMuted(true);
    const ready = new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => { ipcMain.removeListener("system-audio:ready", onReady); resolve(false); }, 5000);
      const onReady = (event: Electron.IpcMainEvent) => {
        if (event.sender !== window.webContents) return;
        clearTimeout(timer);
        ipcMain.removeListener("system-audio:ready", onReady);
        resolve(true);
      };
      ipcMain.on("system-audio:ready", onReady);
    });
    void window.loadFile(join(this.staticDir, "system-audio.html"));
    if (!(await ready) || generation !== this.generation) { if (generation === this.generation) this.stop(); return null; }

    const helper = spawn(this.helperPath, [String(process.pid)], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    this.helper = helper;
    helper.stdout!.on("data", (chunk: Buffer) => {
      if (this.window === window && !window.isDestroyed()) window.webContents.send("system-audio:chunk", new Uint8Array(chunk));
    });
    helper.stderr!.on("data", (chunk: Buffer) => this.log(chunk.toString().trim()));
    const started = await new Promise<boolean>((resolve) => {
      // Silence produces no data, so a helper still running after a moment counts as started.
      const timer = setTimeout(() => resolve(true), 800);
      helper.once("error", () => { clearTimeout(timer); resolve(false); });
      helper.once("exit", (code) => {
        clearTimeout(timer);
        if (code === 3) this.probe = "unsupported";
        resolve(false);
      });
    });
    if (!started || generation !== this.generation) {
      if (generation === this.generation) this.stop();
      return null;
    }
    helper.once("exit", () => { if (this.helper === helper) this.stop(); });
    return window.webContents.mainFrame;
  }

  stop(): void {
    this.generation++;
    const helper = this.helper;
    this.helper = null;
    if (helper && helper.exitCode === null) helper.kill();
    const window = this.window;
    this.window = null;
    if (window && !window.isDestroyed()) window.destroy();
  }
}
