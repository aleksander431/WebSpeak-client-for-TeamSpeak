import { join } from "node:path";
import {
  app,
  BrowserWindow,
  desktopCapturer,
  globalShortcut,
  ipcMain,
  Menu,
  net,
  nativeImage,
  Notification,
  screen,
  session,
  shell,
  Tray,
  type DesktopCapturerSource,
  type MenuItemConstructorOptions,
  type Session,
} from "electron";
import { autoUpdater } from "electron-updater";
import { HotkeyManager, type HotkeyStatus } from "./hotkeys.js";
import { createTranslator } from "./i18n.js";
import { SettingsStore, normalizeServerUrl, type DesktopSettings, type HotkeyAction } from "./settings.js";
import { parseWebClientState, type WebClientState } from "./state.js";
import { SystemAudio } from "./system-audio.js";

/*
 * WebSpeak desktop shell. The window shows the WebSpeak site of the
 * configured server, so the interface is always the server's version; this
 * program only adds what a browser tab cannot: tray, autostart, global
 * hotkeys, a screen picker and self-updates from GitHub releases.
 */

const APP_ID = "space.afire-server.webspeak";
const PARTITION = "persist:webspeak";
const STATIC = join(__dirname, "..", "static");
const startedHidden = process.argv.includes("--hidden");

const primaryInstance = app.requestSingleInstanceLock();
if (!primaryInstance) app.quit();
else app.on("second-instance", () => showWindow());

app.setAppUserModelId(APP_ID);
// Voice must keep playing and capturing while the window is hidden.
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-background-timer-throttling");

let settings: SettingsStore;
let mainWindow: BrowserWindow | null = null;
let settingsWindow: BrowserWindow | null = null;
let pickerWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let hotkeys: HotkeyManager;
let hotkeyStatus: Record<HotkeyAction, HotkeyStatus> = { mic: "off", sound: "off", stream: "off" };
let webState: WebClientState = { connected: false, micMuted: false, soundMuted: false, streaming: false };
let quitting = false;
let updateState: { status: "idle" | "checking" | "downloading" | "ready" | "error" | "current"; version?: string } = { status: "idle" };
let manualUpdateCheck = false;
/** The next display-media request comes from the stream hotkey with "main screen" chosen. */
let directScreenRequest = false;
let systemAudio: SystemAudio;
/** Stops the clean system sound if the page never actually starts sharing. */
let systemAudioWatchdog: NodeJS.Timeout | null = null;
// The locale is only known once the app is ready.
let translator = createTranslator("en");
const t: typeof translator.t = (key, variables) => translator.t(key, variables);

function serverOrigin(): string | null {
  try { return settings.value.serverUrl ? new URL(settings.value.serverUrl).origin : null; } catch { return null; }
}

function isServerUrl(url: string): boolean {
  const origin = serverOrigin();
  try { return origin !== null && new URL(url).origin === origin; } catch { return false; }
}

// ---------------------------------------------------------------- window

function createMainWindow(): BrowserWindow {
  const saved = settings.value.window;
  const bounds = saved && isVisibleOnSomeDisplay(saved) ? saved : undefined;
  const window = new BrowserWindow({
    title: "WebSpeak",
    width: bounds?.width ?? 1280,
    height: bounds?.height ?? 800,
    ...(bounds?.x !== undefined ? { x: bounds.x, y: bounds.y } : {}),
    minWidth: 480,
    minHeight: 360,
    show: false,
    backgroundColor: "#101614",
    icon: join(STATIC, "icon.png"),
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      partition: PARTITION,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      spellcheck: true,
    },
  });
  window.setMenuBarVisibility(false);
  if (saved?.maximized) window.maximize();

  window.once("ready-to-show", () => {
    if (!(startedHidden && settings.value.startHidden)) window.show();
  });

  window.on("close", (event) => {
    saveBounds(window);
    if (quitting || !settings.value.closeToTray) return;
    event.preventDefault();
    window.hide();
    if (!settings.value.trayHintShown && tray) {
      tray.displayBalloon({ title: t("trayHintTitle"), content: t("trayHintBody"), iconType: "info" });
      settings.update({ trayHintShown: true });
    }
  });
  window.on("closed", () => { if (mainWindow === window) mainWindow = null; });
  let boundsTimer: NodeJS.Timeout | null = null;
  const scheduleSave = () => {
    if (boundsTimer) clearTimeout(boundsTimer);
    boundsTimer = setTimeout(() => saveBounds(window), 800);
  };
  window.on("resize", scheduleSave);
  window.on("move", scheduleSave);

  const contents = window.webContents;
  // Other sites open in the normal browser; the window stays on the server.
  contents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  contents.on("will-navigate", (event, url) => {
    if (isServerUrl(url) || url.startsWith("file:")) return;
    event.preventDefault();
    if (/^https?:/i.test(url)) void shell.openExternal(url);
  });
  contents.on("did-fail-load", (_event, code, _description, url, isMainFrame) => {
    // -3 is an aborted load (a newer navigation replaced it).
    if (!isMainFrame || code === -3 || url.startsWith("file:")) return;
    void window.loadFile(join(STATIC, "offline.html"), { query: { url: settings.value.serverUrl } });
  });
  contents.on("render-process-gone", () => setTimeout(() => loadServer(window), 1000));
  contents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") return;
    if (input.key === "F5" || (input.control && input.key.toLowerCase() === "r")) { event.preventDefault(); contents.reload(); }
    if (input.key === "F12" || (input.control && input.shift && input.key.toLowerCase() === "i")) { event.preventDefault(); contents.toggleDevTools(); }
  });

  loadServer(window);
  return window;
}

function loadServer(window: BrowserWindow): void {
  webState = { connected: false, micMuted: false, soundMuted: false, streaming: false };
  refreshTray();
  // First start: ask for the server once; it is remembered afterwards.
  if (!settings.value.serverUrl) { void window.loadFile(join(STATIC, "setup.html")); return; }
  void window.loadURL(settings.value.serverUrl).catch(() => { /* did-fail-load shows the offline page */ });
}

function isVisibleOnSomeDisplay(bounds: { x?: number; y?: number; width: number; height: number }): boolean {
  if (bounds.x === undefined || bounds.y === undefined) return true;
  return screen.getAllDisplays().some(({ workArea }) =>
    bounds.x! + 100 > workArea.x && bounds.x! < workArea.x + workArea.width - 100
    && bounds.y! >= workArea.y - 10 && bounds.y! < workArea.y + workArea.height - 100);
}

function saveBounds(window: BrowserWindow): void {
  if (window.isDestroyed() || window.isMinimized()) return;
  const maximized = window.isMaximized();
  const bounds = maximized ? (settings.value.window ?? window.getNormalBounds()) : window.getBounds();
  settings.update({ window: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height, maximized } });
}

function showWindow(): void {
  if (!mainWindow) { mainWindow = createMainWindow(); mainWindow.once("ready-to-show", () => mainWindow?.show()); return; }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

// ------------------------------------------------------------- session

const ALLOWED_PERMISSIONS = new Set(["media", "display-capture", "notifications", "fullscreen", "clipboard-sanitized-write", "speaker-selection", "window-management"]);

function configureSession(target: Session): void {
  target.setPermissionRequestHandler((_contents, permission, callback, details) => {
    callback(isServerUrl(details.requestingUrl) && ALLOWED_PERMISSIONS.has(permission));
  });
  target.setPermissionCheckHandler((_contents, permission, origin) => isServerUrl(origin) && ALLOWED_PERMISSIONS.has(permission));
  target.setDisplayMediaRequestHandler((request, callback) => {
    const direct = directScreenRequest;
    directScreenRequest = false;
    if (!isServerUrl(request.securityOrigin || request.frame?.url || "")) { callback({}); return; }
    void chooseDisplaySource(direct).then(async (choice) => {
      systemAudio.stop();
      if (!choice) { callback({}); return; }
      if (!choice.audio) { callback({ video: choice.source }); return; }
      // Prefer system sound without WebSpeak's voices; plain loopback otherwise.
      const frame = await systemAudio.start();
      if (frame) {
        if (systemAudioWatchdog) clearTimeout(systemAudioWatchdog);
        systemAudioWatchdog = setTimeout(() => { if (!webState.streaming) systemAudio.stop(); }, 30_000);
        callback({ video: choice.source, audio: frame });
        return;
      }
      callback({ video: choice.source, audio: "loopback" });
    }).catch(() => callback({}));
  });
}

async function chooseDisplaySource(direct: boolean): Promise<{ source: DesktopCapturerSource; audio: boolean } | null> {
  if (direct) {
    const screens = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width: 0, height: 0 } });
    const primary = String(screen.getPrimaryDisplay().id);
    const source = screens.find((item) => item.display_id === primary) ?? screens[0];
    return source ? { source, audio: settings.value.shareSystemAudio } : null;
  }
  const sources = await desktopCapturer.getSources({ types: ["screen", "window"], thumbnailSize: { width: 320, height: 180 }, fetchWindowIcons: true });
  // Our own window would show an endless mirror; leave it out.
  const ownTitles = new Set(["WebSpeak", t("pickerTitle"), t("settingsTitle")]);
  const list = sources.filter((source) => !(source.id.startsWith("window:") && ownTitles.has(source.name)));
  return new Promise((resolve) => {
    pickerWindow?.destroy();
    const picker = new BrowserWindow({
      title: t("pickerTitle"), width: 860, height: 640, minWidth: 520, minHeight: 420,
      alwaysOnTop: true, show: false, autoHideMenuBar: true, backgroundColor: "#101614",
      icon: join(STATIC, "icon.png"),
      webPreferences: { preload: join(__dirname, "picker-preload.js"), contextIsolation: true, sandbox: true },
    });
    pickerWindow = picker;
    let settled = false;
    const finish = (value: { source: DesktopCapturerSource; audio: boolean } | null) => {
      if (settled) return;
      settled = true;
      ipcMain.removeHandler("picker:sources");
      ipcMain.removeAllListeners("picker:choose");
      if (!picker.isDestroyed()) picker.destroy();
      if (pickerWindow === picker) pickerWindow = null;
      resolve(value);
    };
    ipcMain.removeHandler("picker:sources");
    ipcMain.handle("picker:sources", (event) => {
      if (event.sender !== picker.webContents) return null;
      return {
        strings: pickerStrings(),
        audio: settings.value.shareSystemAudio,
        sources: list.map((source) => ({
          id: source.id,
          name: source.name,
          kind: source.id.startsWith("screen:") ? "screen" : "window",
          thumbnail: source.thumbnail.isEmpty() ? "" : source.thumbnail.toDataURL(),
          icon: source.appIcon && !source.appIcon.isEmpty() ? source.appIcon.toDataURL() : "",
        })),
      };
    });
    ipcMain.removeAllListeners("picker:choose");
    ipcMain.on("picker:choose", (event, id: unknown, audio: unknown) => {
      if (event.sender !== picker.webContents) return;
      const source = typeof id === "string" ? list.find((item) => item.id === id) : undefined;
      if (source && settings.value.shareSystemAudio !== (audio === true)) settings.update({ shareSystemAudio: audio === true });
      finish(source ? { source, audio: audio === true } : null);
    });
    picker.on("closed", () => finish(null));
    picker.once("ready-to-show", () => { picker.show(); picker.focus(); });
    void picker.loadFile(join(STATIC, "picker.html"));
  });
}

function pickerStrings() {
  const audio = systemAudio.supported ? t("pickerAudioClean") : t("pickerAudio");
  return { title: t("pickerTitle"), screens: t("pickerScreens"), windows: t("pickerWindows"), audio, share: t("pickerShare"), cancel: t("cancel") };
}

// ----------------------------------------------------------- web actions

/**
 * Run an action in the page as if the user clicked: starting a screen share
 * needs a user gesture, and a hotkey pressed inside a game is not one.
 */
async function runWebAction(action: HotkeyAction, fromHotkey: boolean): Promise<void> {
  const window = mainWindow;
  if (!window || window.isDestroyed() || !isServerUrl(window.webContents.getURL())) return;
  if (action === "stream" && fromHotkey && settings.value.streamHotkeySource === "screen" && !webState.streaming) directScreenRequest = true;
  const sound = fromHotkey && settings.value.hotkeySounds;
  try {
    await window.webContents.executeJavaScript(
      `typeof window.__webspeakDesktopAction === "function" ? window.__webspeakDesktopAction(${JSON.stringify(action)}, ${sound}) : "unavailable"`,
      true,
    );
  } catch {
    // The page is reloading; the hotkey is simply lost.
  } finally {
    // A request that never came (not connected, already sharing) must not
    // skip the picker the next time the user shares from the page.
    setTimeout(() => { directScreenRequest = false; }, 1500);
  }
}

// ------------------------------------------------------------------ tray

function refreshTray(): void {
  if (!tray) return;
  const muted = webState.connected && (webState.micMuted || webState.soundMuted);
  tray.setImage(nativeImage.createFromPath(join(STATIC, muted ? "tray-muted.png" : "tray.png")));
  const notes = [
    webState.connected && webState.micMuted ? t("tooltipMicMuted") : "",
    webState.connected && webState.soundMuted ? t("tooltipSoundMuted") : "",
    webState.streaming ? t("tooltipStreaming") : "",
  ].filter(Boolean);
  const tooltip = notes.length ? `WebSpeak — ${notes.join(", ")}` : "WebSpeak";
  tray.setToolTip(tooltip);
  (globalThis as { __trayTooltip?: string }).__trayTooltip = tooltip;
  const connected = webState.connected;
  const template: MenuItemConstructorOptions[] = [
    { label: t("open"), click: () => showWindow() },
    { type: "separator" },
    ...(connected ? [] : [{ label: t("notConnected"), enabled: false } satisfies MenuItemConstructorOptions]),
    { label: webState.micMuted ? t("micOn") : t("micOff"), enabled: connected, accelerator: settings.value.hotkeys.mic || undefined, registerAccelerator: false, click: () => void runWebAction("mic", false) },
    { label: webState.soundMuted ? t("soundOn") : t("soundOff"), enabled: connected, accelerator: settings.value.hotkeys.sound || undefined, registerAccelerator: false, click: () => void runWebAction("sound", false) },
    { label: webState.streaming ? t("streamStop") : t("streamStart"), enabled: connected, accelerator: settings.value.hotkeys.stream || undefined, registerAccelerator: false, click: () => void runWebAction("stream", false) },
    { type: "separator" },
    { label: t("settings"), click: () => openSettings() },
    { label: t("reload"), click: () => { if (mainWindow) loadServer(mainWindow); } },
    updateState.status === "ready"
      ? { label: t("installUpdate", { version: updateState.version ?? "" }), click: () => installUpdate() }
      : { label: updateState.status === "downloading" ? t("updateDownloading", { version: updateState.version ?? "" }) : t("checkUpdates"), enabled: updateState.status !== "downloading" && updateState.status !== "checking", click: () => checkForUpdates(true) },
    { type: "separator" },
    { label: t("quit"), click: () => { quitting = true; app.quit(); } },
  ];
  tray.setContextMenu(Menu.buildFromTemplate(template));
}

// --------------------------------------------------------------- settings

function openSettings(): void {
  if (settingsWindow && !settingsWindow.isDestroyed()) { settingsWindow.show(); settingsWindow.focus(); return; }
  const window = new BrowserWindow({
    title: t("settingsTitle"), width: 600, height: 760, minWidth: 460, minHeight: 480,
    show: false, autoHideMenuBar: true, backgroundColor: "#101614", icon: join(STATIC, "icon.png"),
    webPreferences: { preload: join(__dirname, "settings-preload.js"), contextIsolation: true, sandbox: true },
  });
  settingsWindow = window;
  window.once("ready-to-show", () => window.show());
  window.on("closed", () => {
    if (settingsWindow === window) settingsWindow = null;
    // Hotkeys were paused while a field was capturing keys.
    hotkeyStatus = hotkeys.apply(settings.value.hotkeys);
  });
  void window.loadFile(join(STATIC, "settings.html"));
}

function settingsSnapshot() {
  return { settings: settings.value, hotkeyStatus, version: app.getVersion(), packaged: app.isPackaged, updateState, strings: translator.strings };
}

function applySettings(next: DesktopSettings, previous: DesktopSettings): void {
  if (app.isPackaged) {
    app.setLoginItemSettings({ openAtLogin: next.launchAtLogin, path: process.execPath, args: ["--hidden"] });
  }
  hotkeyStatus = hotkeys.apply(next.hotkeys);
  if (next.serverUrl !== previous.serverUrl && mainWindow) loadServer(mainWindow);
  refreshTray();
}

function registerIpc(): void {
  const fromSettings = (sender: Electron.WebContents) => settingsWindow !== null && sender === settingsWindow.webContents;
  ipcMain.handle("settings:get", (event) => (fromSettings(event.sender) ? settingsSnapshot() : null));
  ipcMain.handle("settings:save", (event, patch: unknown) => {
    if (!fromSettings(event.sender) || !patch || typeof patch !== "object") return null;
    const previous = settings.value;
    const input = patch as Partial<DesktopSettings>;
    if (input.serverUrl !== undefined && !normalizeServerUrl(input.serverUrl)) return { error: "serverInvalid" };
    const next = settings.update(input);
    applySettings(next, previous);
    return settingsSnapshot();
  });
  // While a hotkey field listens, the current global hotkeys must not swallow the keys.
  ipcMain.on("settings:capture", (event, capturing: unknown) => {
    if (!fromSettings(event.sender)) return;
    if (capturing === true) hotkeys.clear();
    else hotkeyStatus = hotkeys.apply(settings.value.hotkeys);
  });
  ipcMain.on("settings:check-updates", (event) => { if (fromSettings(event.sender)) checkForUpdates(true); });
  ipcMain.on("settings:install-update", (event) => { if (fromSettings(event.sender)) installUpdate(); });

  ipcMain.on("webspeak:state", (event, value: unknown) => {
    if (!mainWindow || event.sender !== mainWindow.webContents || !isServerUrl(event.senderFrame?.url ?? "")) return;
    const parsed = parseWebClientState(value);
    if (!parsed) return;
    // The share ended: release the clean system-sound capture.
    if (webState.streaming && !parsed.streaming) systemAudio.stop();
    webState = parsed;
    refreshTray();
  });
  ipcMain.on("webspeak:open-settings", (event) => {
    if (mainWindow && event.sender === mainWindow.webContents) openSettings();
  });

  ipcMain.handle("setup:strings", (event) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) return null;
    return {
      title: t("setupTitle"), body: t("setupBody"), placeholder: t("setupPlaceholder"), next: t("setupContinue"),
      checking: t("setupChecking"), unreachable: t("setupUnreachable"), anyway: t("setupSaveAnyway"), invalid: t("serverInvalid"),
      hint: t("setupHint"), value: settings.value.serverUrl,
    };
  });
  // Check the address answers like a WebSpeak gateway before saving it.
  ipcMain.handle("setup:check", async (event, value: unknown) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) return { ok: false, reason: "invalid" };
    const url = normalizeServerUrl(value);
    if (!url) return { ok: false, reason: "invalid" };
    try {
      const response = await net.fetch(`${new URL(url).origin}/api/health`, { signal: AbortSignal.timeout(8000), cache: "no-store" });
      const body = await response.json().catch(() => null) as { status?: unknown } | null;
      return { ok: response.ok && body?.status === "ok", url };
    } catch {
      return { ok: false, url, reason: "unreachable" };
    }
  });
  ipcMain.handle("setup:save", (event, value: unknown) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) return false;
    const url = normalizeServerUrl(value);
    if (!url) return false;
    const previous = settings.value;
    applySettings(settings.update({ serverUrl: url }), previous);
    return true;
  });

  ipcMain.on("offline:retry", (event) => {
    if (mainWindow && event.sender === mainWindow.webContents) loadServer(mainWindow);
  });
  ipcMain.handle("offline:strings", (event) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) return null;
    return { title: t("offlineTitle"), body: t("offlineBody", { url: settings.value.serverUrl }), retry: t("retry"), change: t("changeServer") };
  });
}

// ---------------------------------------------------------------- updates

function setUpdateState(next: typeof updateState): void {
  updateState = next;
  refreshTray();
  settingsWindow?.webContents.send("settings:update-state", updateState);
}

function configureUpdater(): void {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on("checking-for-update", () => setUpdateState({ status: "checking" }));
  autoUpdater.on("update-available", (info) => setUpdateState({ status: "downloading", version: info.version }));
  autoUpdater.on("update-not-available", () => {
    setUpdateState({ status: "current", version: app.getVersion() });
    if (manualUpdateCheck) notify(t("upToDateTitle"), t("upToDateBody", { version: app.getVersion() }));
    manualUpdateCheck = false;
  });
  autoUpdater.on("update-downloaded", (info) => {
    setUpdateState({ status: "ready", version: info.version });
    notify(t("updateReadyTitle"), t("updateReadyBody", { version: info.version }));
    manualUpdateCheck = false;
  });
  autoUpdater.on("error", (error) => {
    setUpdateState({ status: "error" });
    if (manualUpdateCheck) notify(t("updateErrorTitle"), error instanceof Error ? error.message.split("\n")[0]!.slice(0, 200) : "");
    manualUpdateCheck = false;
  });
}

function checkForUpdates(manual: boolean): void {
  if (!app.isPackaged) return;
  if (updateState.status === "ready") { if (manual) notify(t("updateReadyTitle"), t("updateReadyBody", { version: updateState.version ?? "" })); return; }
  manualUpdateCheck = manual;
  void autoUpdater.checkForUpdates().catch(() => { /* reported through the error event */ });
}

function installUpdate(): void {
  if (updateState.status !== "ready") return;
  quitting = true;
  // Silent install, then start WebSpeak again.
  autoUpdater.quitAndInstall(true, true);
}

function notify(title: string, body: string): void {
  if (Notification.isSupported()) new Notification({ title, body, icon: join(STATIC, "icon.png") }).show();
}

// ---------------------------------------------------------------- startup

void app.whenReady().then(() => {
  if (!primaryInstance) return;
  translator = createTranslator(app.getPreferredSystemLanguages()[0] || app.getLocale() || "en");
  settings = new SettingsStore(join(app.getPath("userData"), "settings.json"));
  Menu.setApplicationMenu(null);
  configureSession(session.fromPartition(PARTITION));
  registerIpc();
  systemAudio = new SystemAudio(
    // WEBSPEAK_SYSTEM_AUDIO_HELPER lets tests substitute a fake helper on any OS.
    process.env.WEBSPEAK_SYSTEM_AUDIO_HELPER
      || (app.isPackaged ? join(process.resourcesPath, "webspeak-audio-capture.exe") : join(__dirname, "..", "native", "bin", "webspeak-audio-capture.exe")),
    STATIC,
    join(__dirname, "system-audio-preload.js"),
    (message) => console.log(message),
    Boolean(process.env.WEBSPEAK_SYSTEM_AUDIO_HELPER),
  );
  void systemAudio.detect();
  hotkeys = new HotkeyManager(globalShortcut, (action) => void runWebAction(action, true));
  hotkeyStatus = hotkeys.apply(settings.value.hotkeys);

  tray = new Tray(nativeImage.createFromPath(join(STATIC, "tray.png")));
  tray.on("click", () => showWindow());
  tray.on("double-click", () => showWindow());

  if (app.isPackaged) {
    // Keep the registry entry in step with the setting (also after updates move the exe).
    app.setLoginItemSettings({ openAtLogin: settings.value.launchAtLogin, path: process.execPath, args: ["--hidden"] });
  }
  mainWindow = createMainWindow();
  configureUpdater();
  refreshTray();
  checkForUpdates(false);
  setInterval(() => checkForUpdates(false), 4 * 60 * 60 * 1000);
});

app.on("before-quit", () => { quitting = true; });
app.on("will-quit", () => { globalShortcut.unregisterAll(); systemAudio?.stop(); });
// The tray keeps the app alive when every window is closed.
app.on("window-all-closed", () => { if (!settings?.value.closeToTray) app.quit(); });

