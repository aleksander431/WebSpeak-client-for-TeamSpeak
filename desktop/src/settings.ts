import { readFileSync, renameSync, writeFileSync } from "node:fs";

/** Actions a global hotkey can trigger in the web client. */
export const HOTKEY_ACTIONS = ["mic", "sound", "stream"] as const;
export type HotkeyAction = typeof HOTKEY_ACTIONS[number];

export interface DesktopSettings {
  /** Address of the WebSpeak server the window opens; empty until the user enters one. */
  serverUrl: string;
  /** Start with Windows. */
  launchAtLogin: boolean;
  /** When started with Windows, stay in the tray instead of showing the window. */
  startHidden: boolean;
  /** Closing the window keeps WebSpeak running in the tray. */
  closeToTray: boolean;
  /** Electron accelerators; an empty string means no hotkey. */
  hotkeys: Record<HotkeyAction, string>;
  /** Push-to-talk: while this key or mouse button is held you are heard; empty is off. */
  pushToTalk: string;
  /** While this key or mouse button is held, you whisper to the chosen members; empty is off. */
  whisper: string;
  /** What the stream hotkey shares: ask with the picker or take the main screen at once. */
  streamHotkeySource: "picker" | "screen";
  /** Short sounds when a hotkey mutes or unmutes. */
  hotkeySounds: boolean;
  /** Share the PC's sound with the screen (without WebSpeak's voices where Windows allows). */
  shareSystemAudio: boolean;
  /** Who is talking, drawn over games and other programs; off until the user turns it on. */
  overlay: OverlaySettings;
  /** Remembered window bounds. */
  window?: { x?: number; y?: number; width: number; height: number; maximized: boolean };
  /** The tray hint was shown once. */
  trayHintShown: boolean;
}

export const OVERLAY_CORNERS = ["top-left", "top-right", "bottom-left", "bottom-right"] as const;
export type OverlayCorner = typeof OVERLAY_CORNERS[number];

export interface OverlaySettings {
  enabled: boolean;
  corner: OverlayCorner;
  /** Distance from the screen edges, in pixels. */
  offsetX: number;
  offsetY: number;
  /** Size in percent (60–200). */
  scale: number;
  /** Opacity in percent (20–100). */
  opacity: number;
  /** "channel": everyone in the channel, talkers lit; "speaking": only who is talking now. */
  mode: "channel" | "speaking";
  /** Include yourself. */
  showSelf: boolean;
  /** Show the channel name above the list. */
  showChannel: boolean;
}

export const DEFAULT_OVERLAY: OverlaySettings = Object.freeze({
  enabled: false,
  corner: "top-left",
  offsetX: 24,
  offsetY: 24,
  scale: 100,
  opacity: 90,
  mode: "channel",
  showSelf: true,
  showChannel: true,
}) as OverlaySettings;

export function sanitizeOverlay(value: unknown, base: OverlaySettings = DEFAULT_OVERLAY): OverlaySettings {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const bool = (key: keyof OverlaySettings) => typeof input[key] === "boolean" ? input[key] as boolean : base[key] as boolean;
  const number = (key: "offsetX" | "offsetY" | "scale" | "opacity", min: number, max: number) => {
    const candidate = input[key];
    return typeof candidate === "number" && Number.isFinite(candidate) ? Math.max(min, Math.min(max, Math.round(candidate))) : base[key];
  };
  return {
    enabled: bool("enabled"),
    corner: (OVERLAY_CORNERS as readonly unknown[]).includes(input.corner) ? input.corner as OverlayCorner : base.corner,
    offsetX: number("offsetX", 0, 2000),
    offsetY: number("offsetY", 0, 2000),
    scale: number("scale", 60, 200),
    opacity: number("opacity", 20, 100),
    mode: input.mode === "channel" || input.mode === "speaking" ? input.mode : base.mode,
    showSelf: bool("showSelf"),
    showChannel: bool("showChannel"),
  };
}

export const DEFAULT_SETTINGS: DesktopSettings = Object.freeze({
  serverUrl: "",
  launchAtLogin: true,
  startHidden: true,
  closeToTray: true,
  hotkeys: Object.freeze({ mic: "CommandOrControl+Shift+M", sound: "CommandOrControl+Shift+D", stream: "CommandOrControl+Shift+L" }) as Record<HotkeyAction, string>,
  pushToTalk: "",
  whisper: "",
  streamHotkeySource: "picker",
  hotkeySounds: true,
  shareSystemAudio: false,
  overlay: DEFAULT_OVERLAY,
  trayHintShown: false,
}) as DesktopSettings;

const MODIFIERS = new Set(["CommandOrControl", "Control", "Ctrl", "Alt", "Shift", "Super", "Meta", "AltGr", "Option", "Command", "Cmd", "CmdOrCtrl"]);
const KEY_PATTERN = /^(?:[A-Z0-9]|F(?:[1-9]|1[0-9]|2[0-4])|Plus|Space|Tab|Backspace|Delete|Insert|Return|Enter|Up|Down|Left|Right|Home|End|PageUp|PageDown|Escape|Esc|num[0-9]|numdec|numadd|numsub|nummult|numdiv|[`\-=[\]\\;',./]|Capslock|Numlock|Scrolllock|PrintScreen|Pause|Mouse4|Mouse5|MediaPlayPause|MediaNextTrack|MediaPreviousTrack|MediaStop|VolumeUp|VolumeDown|VolumeMute)$/;
/** Keys Electron cannot register; the native helper (native/hotkeys.cpp) handles them. */
const NATIVE_KEYS = new Set(["Pause", "Mouse4", "Mouse5"]);

export function needsNativeHotkey(accelerator: string): boolean {
  return NATIVE_KEYS.has(accelerator.split("+").pop() ?? "");
}

/**
 * Keys that work alone. A global hotkey swallows its key in every program,
 * so keys used for typing (letters, digits, punctuation, Space, Enter, arrows,
 * editing keys) still need a modifier; everything else may stand alone.
 */
const TYPING_KEYS = /^(?:[A-Z0-9]|Plus|Space|Tab|Backspace|Delete|Return|Enter|Up|Down|Left|Right|Home|End|Escape|Esc|[`\-=[\]\\;',./])$/;

/**
 * A usable global accelerator: one key, optionally with modifiers. A bare
 * letter or digit is refused because it would stop working while typing in
 * every other program.
 */
export function isValidAccelerator(value: string): boolean {
  if (!value) return true;
  const parts = value.split("+");
  // "Plus" is the key name; a literal "+" key cannot be expressed otherwise.
  if (parts.some((part) => !part)) return false;
  const key = parts[parts.length - 1]!;
  const modifiers = parts.slice(0, -1);
  if (!KEY_PATTERN.test(key) || modifiers.some((modifier) => !MODIFIERS.has(modifier))) return false;
  if (new Set(modifiers).size !== modifiers.length) return false;
  return modifiers.length > 0 || !TYPING_KEYS.test(key);
}

/**
 * A push-to-talk key: one key (any, including letters: it is not taken from
 * other programs), Ctrl/Alt/Shift on their own, or a mouse button.
 */
const PUSH_TO_TALK_PATTERN = /^(?:[A-Z0-9]|F(?:[1-9]|1[0-9]|2[0-4])|Space|Tab|Backspace|Delete|Insert|Return|Enter|Up|Down|Left|Right|Home|End|PageUp|PageDown|num[0-9]|numdec|numadd|numsub|nummult|numdiv|[`\-=[\]\\;',./]|Capslock|Numlock|Scrolllock|PrintScreen|Pause|Ctrl|Alt|Shift|Mouse3|Mouse4|Mouse5)$/;

export function isValidPushToTalk(value: string): boolean {
  return value === "" || PUSH_TO_TALK_PATTERN.test(value);
}

/** Only http(s) origins; anything else falls back to the default server. */
export function normalizeServerUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  let text = value.trim();
  if (!text) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) text = `https://${text}`;
  try {
    const url = new URL(text);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.username || url.password) return null;
    return url.origin + (url.pathname === "/" ? "" : url.pathname.replace(/\/+$/, ""));
  } catch {
    return null;
  }
}

/** Merge stored or submitted values over the defaults, dropping anything invalid. */
export function sanitizeSettings(value: unknown, base: DesktopSettings = DEFAULT_SETTINGS): DesktopSettings {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const bool = (key: keyof DesktopSettings) => typeof input[key] === "boolean" ? input[key] as boolean : base[key] as boolean;
  const hotkeysInput = input.hotkeys && typeof input.hotkeys === "object" ? input.hotkeys as Record<string, unknown> : {};
  const hotkeys = { ...base.hotkeys };
  for (const action of HOTKEY_ACTIONS) {
    const candidate = hotkeysInput[action];
    if (typeof candidate === "string" && isValidAccelerator(candidate)) hotkeys[action] = candidate;
  }
  // The same accelerator cannot drive two actions: keep the first.
  const seen = new Set<string>();
  for (const action of HOTKEY_ACTIONS) {
    const key = hotkeys[action].toLowerCase();
    if (!key) continue;
    if (seen.has(key)) hotkeys[action] = "";
    seen.add(key);
  }
  // Push-to-talk cannot share a key with a toggle hotkey.
  let pushToTalk = typeof input.pushToTalk === "string" && isValidPushToTalk(input.pushToTalk) ? input.pushToTalk : base.pushToTalk;
  if (pushToTalk && seen.has(pushToTalk.toLowerCase())) pushToTalk = "";
  if (pushToTalk) seen.add(pushToTalk.toLowerCase());
  // Whisper is a second hold key: it cannot share a key with anything above.
  let whisper = typeof input.whisper === "string" && isValidPushToTalk(input.whisper) ? input.whisper : base.whisper ?? "";
  if (whisper && seen.has(whisper.toLowerCase())) whisper = "";
  const settings: DesktopSettings = {
    serverUrl: input.serverUrl === "" ? "" : normalizeServerUrl(input.serverUrl) ?? base.serverUrl,
    launchAtLogin: bool("launchAtLogin"),
    startHidden: bool("startHidden"),
    closeToTray: bool("closeToTray"),
    hotkeys,
    pushToTalk,
    whisper,
    streamHotkeySource: input.streamHotkeySource === "screen" || input.streamHotkeySource === "picker" ? input.streamHotkeySource : base.streamHotkeySource,
    hotkeySounds: bool("hotkeySounds"),
    shareSystemAudio: bool("shareSystemAudio"),
    overlay: sanitizeOverlay(input.overlay, base.overlay ?? DEFAULT_OVERLAY),
    trayHintShown: bool("trayHintShown"),
  };
  const windowInput = input.window as Record<string, unknown> | undefined;
  const finite = (number: unknown) => typeof number === "number" && Number.isFinite(number);
  if (windowInput && finite(windowInput.width) && finite(windowInput.height)) {
    settings.window = {
      width: Math.max(480, Math.min(10_000, Math.round(windowInput.width as number))),
      height: Math.max(360, Math.min(10_000, Math.round(windowInput.height as number))),
      maximized: windowInput.maximized === true,
      ...(finite(windowInput.x) && finite(windowInput.y) ? { x: Math.round(windowInput.x as number), y: Math.round(windowInput.y as number) } : {}),
    };
  } else if (base.window) settings.window = { ...base.window };
  return settings;
}

/** Settings file in the user's data folder; writes go through a temporary file. */
export class SettingsStore {
  private current: DesktopSettings;
  constructor(private readonly file: string) {
    let stored: unknown = {};
    try { stored = JSON.parse(readFileSync(file, "utf8")); } catch { /* first start or damaged file */ }
    this.current = sanitizeSettings(stored);
  }
  get value(): DesktopSettings {
    return this.current;
  }
  update(patch: Partial<DesktopSettings>): DesktopSettings {
    this.current = sanitizeSettings({ ...this.current, ...patch, hotkeys: { ...this.current.hotkeys, ...(patch.hotkeys ?? {}) },
      overlay: { ...this.current.overlay, ...(patch.overlay ?? {}) } }, this.current);
    try {
      writeFileSync(`${this.file}.tmp`, JSON.stringify(this.current, null, 2));
      renameSync(`${this.file}.tmp`, this.file);
    } catch {
      // Settings stay in memory; the next successful save writes them.
    }
    return this.current;
  }
}
