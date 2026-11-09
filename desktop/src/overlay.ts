import { join } from "node:path";
import { BrowserWindow, ipcMain, screen } from "electron";
import { EMPTY_ROSTER, overlayBounds, overlayWanted, type ForegroundWindow, type OverlayRoster } from "./overlay-state.js";
import type { OverlaySettings } from "./settings.js";

/**
 * A small always-on-top, click-through window showing who is talking.
 * It never takes focus or mouse input, so it can sit over a game. It exists
 * only while the overlay is turned on.
 */
export class OverlayController {
  private window: BrowserWindow | null = null;
  private settings: OverlaySettings | null = null;
  private roster: OverlayRoster = EMPTY_ROSTER;
  private speaking: number[] = [];
  private size = { width: 0, height: 0 };
  private ready = false;
  /** The active window, for "only in games"; null while unknown. */
  private foreground: ForegroundWindow | null = null;

  constructor(private readonly staticDir: string, private readonly preload: string) {
    ipcMain.on("overlay:size", (event, width: unknown, height: unknown) => {
      if (!this.window || event.sender !== this.window.webContents) return;
      const valid = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 4000;
      if (!valid(width) || !valid(height)) return;
      this.size = { width: Math.ceil(width as number), height: Math.ceil(height as number) };
      this.place();
    });
    ipcMain.on("overlay:ready", (event) => {
      if (!this.window || event.sender !== this.window.webContents) return;
      this.ready = true;
      this.push();
    });
    // Screens added, removed or rescaled move the corner.
    screen.on("display-metrics-changed", () => this.place());
    screen.on("display-added", () => this.place());
    screen.on("display-removed", () => this.place());
  }

  configure(settings: OverlaySettings): void {
    this.settings = settings;
    if (!settings.enabled) { this.destroy(); return; }
    if (!this.window || this.window.isDestroyed()) this.create();
    this.push();
    this.place();
  }

  /** The active window changed: show or hide for "only in games". */
  setForeground(foreground: ForegroundWindow | null): void {
    this.foreground = foreground;
    this.place();
  }

  setRoster(roster: OverlayRoster): void {
    this.roster = roster;
    if (this.ready) this.window?.webContents.send("overlay:roster", roster);
  }

  setSpeaking(ids: number[]): void {
    this.speaking = ids;
    if (this.ready) this.window?.webContents.send("overlay:speaking", ids);
  }

  /** The page went away (reload, other server): nobody is shown until it reports again. */
  reset(): void {
    this.setRoster(EMPTY_ROSTER);
    this.setSpeaking([]);
  }

  destroy(): void {
    const window = this.window;
    this.window = null;
    this.ready = false;
    this.size = { width: 0, height: 0 };
    if (window && !window.isDestroyed()) window.destroy();
  }

  private create(): void {
    const window = new BrowserWindow({
      width: 600, height: 200, x: 0, y: 0,
      show: false, frame: false, transparent: true, backgroundColor: "#00000000", hasShadow: false,
      resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: false,
      focusable: false, skipTaskbar: true, alwaysOnTop: true, title: "WebSpeak overlay",
      webPreferences: { preload: this.preload, contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false },
    });
    // Above full-screen (borderless) games; clicks go to whatever is underneath.
    window.setAlwaysOnTop(true, "screen-saver");
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    window.setIgnoreMouseEvents(true);
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (event) => event.preventDefault());
    window.on("closed", () => { if (this.window === window) { this.window = null; this.ready = false; } });
    this.window = window;
    this.ready = false;
    void window.loadFile(join(this.staticDir, "overlay.html"));
  }

  private push(): void {
    const window = this.window;
    if (!window || !this.ready || !this.settings) return;
    window.webContents.send("overlay:settings", this.settings);
    window.webContents.send("overlay:roster", this.roster);
    window.webContents.send("overlay:speaking", this.speaking);
  }

  /** Anchor the window to the chosen corner of the main screen, at the size of its content. */
  private place(): void {
    const window = this.window;
    const settings = this.settings;
    if (!window || window.isDestroyed() || !settings) return;
    const { width, height } = this.size;
    if (width < 1 || height < 1 || !overlayWanted(settings, this.foreground)) { if (window.isVisible()) window.hide(); return; }
    const bounds = overlayBounds(screen.getPrimaryDisplay().bounds, settings, width, height);
    window.setBounds(bounds);
    if (!window.isVisible()) window.showInactive();
    // Some games raise their own window; keep ours on top.
    window.setAlwaysOnTop(true, "screen-saver");
  }
}
