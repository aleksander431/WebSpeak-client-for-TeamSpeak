/**
 * Keyboard shortcuts for the voice room.
 *
 * Bindings use KeyboardEvent.code (the physical key), so a shortcut keeps
 * working when the keyboard layout is switched, e.g. between Russian and
 * English. They only fire while the WebSpeak tab has focus: browsers do not
 * deliver key presses from other applications to web pages.
 */

export type HotkeyAction = "toggleMicrophone" | "toggleDeafen" | "toggleScreenShare";

export const HOTKEY_ACTIONS: readonly HotkeyAction[] = ["toggleMicrophone", "toggleDeafen", "toggleScreenShare"];

export interface HotkeyBinding {
  code: string;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
}

export type HotkeyBindings = Record<HotkeyAction, HotkeyBinding | null>;

const binding = (code: string, ctrl = true, shift = true, alt = false, meta = false): HotkeyBinding => ({ code, ctrl, alt, shift, meta });

/** Defaults follow Discord's mute/deafen keys; all are reassignable. */
export const DEFAULT_HOTKEYS: Readonly<HotkeyBindings> = Object.freeze({
  toggleMicrophone: binding("KeyM"),
  toggleDeafen: binding("KeyD"),
  toggleScreenShare: binding("KeyE"),
});

export const HOTKEYS_STORAGE_KEY = "webspeak:hotkeys";
export const MEDIA_KEY_STORAGE_KEY = "webspeak:hotkeys-media-key";

const MODIFIER_CODES = new Set(["ControlLeft", "ControlRight", "ShiftLeft", "ShiftRight", "AltLeft", "AltRight", "MetaLeft", "MetaRight", "OSLeft", "OSRight"]);
const CODE_PATTERN = /^[A-Za-z0-9]{1,32}$/;

export function isModifierCode(code: string): boolean {
  return MODIFIER_CODES.has(code);
}

/** A binding from a key press, or null for a bare modifier. */
export function bindingFromEvent(event: Pick<KeyboardEvent, "code" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey">): HotkeyBinding | null {
  if (!event.code || isModifierCode(event.code) || !CODE_PATTERN.test(event.code)) return null;
  return { code: event.code, ctrl: event.ctrlKey, alt: event.altKey, shift: event.shiftKey, meta: event.metaKey };
}

export function matchesBinding(event: Pick<KeyboardEvent, "code" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey">, target: HotkeyBinding | null): boolean {
  return Boolean(target && event.code === target.code && event.ctrlKey === target.ctrl && event.altKey === target.alt
    && event.shiftKey === target.shift && event.metaKey === target.meta);
}

export function sameBinding(left: HotkeyBinding | null, right: HotkeyBinding | null): boolean {
  return Boolean(left && right && left.code === right.code && left.ctrl === right.ctrl && left.alt === right.alt
    && left.shift === right.shift && left.meta === right.meta);
}

/** Readable label such as "Ctrl + Shift + M"; the key is named by its position, not the layout. */
export function formatBinding(value: HotkeyBinding | null, isMac = false): string {
  if (!value) return "";
  const parts: string[] = [];
  if (value.ctrl) parts.push(isMac ? "⌃" : "Ctrl");
  if (value.alt) parts.push(isMac ? "⌥" : "Alt");
  if (value.shift) parts.push(isMac ? "⇧" : "Shift");
  if (value.meta) parts.push(isMac ? "⌘" : "Win");
  parts.push(keyName(value.code));
  return parts.join(isMac ? "" : " + ");
}

function keyName(code: string): string {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Numpad\d$/.test(code)) return `Num ${code.slice(6)}`;
  if (/^F\d{1,2}$/.test(code)) return code;
  const names: Record<string, string> = {
    Backquote: "`", Minus: "-", Equal: "=", BracketLeft: "[", BracketRight: "]", Backslash: "\\", Semicolon: ";",
    Quote: "'", Comma: ",", Period: ".", Slash: "/", Space: "Space", Enter: "Enter", Tab: "Tab", Insert: "Insert",
    Home: "Home", End: "End", PageUp: "PgUp", PageDown: "PgDn", ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→",
    Pause: "Pause", ScrollLock: "Scroll Lock", NumpadAdd: "Num +", NumpadSubtract: "Num -", NumpadMultiply: "Num *", NumpadDivide: "Num /",
  };
  return names[code] ?? code;
}

function parseBinding(value: unknown): HotkeyBinding | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.code !== "string" || !CODE_PATTERN.test(record.code) || isModifierCode(record.code)) return null;
  return { code: record.code, ctrl: record.ctrl === true, alt: record.alt === true, shift: record.shift === true, meta: record.meta === true };
}

/** Stored bindings merged over the defaults; `null` stores a deliberately cleared shortcut. */
export function parseHotkeys(raw: string | null): HotkeyBindings {
  const result: HotkeyBindings = { ...DEFAULT_HOTKEYS };
  if (!raw) return result;
  try {
    const stored = JSON.parse(raw) as Record<string, unknown>;
    if (!stored || typeof stored !== "object") return result;
    for (const action of HOTKEY_ACTIONS) {
      if (!(action in stored)) continue;
      result[action] = stored[action] === null ? null : parseBinding(stored[action]) ?? DEFAULT_HOTKEYS[action];
    }
  } catch { /* corrupt storage falls back to defaults */ }
  return result;
}

/** Assign a binding to one action; another action using the same keys loses it. */
export function assignHotkey(current: HotkeyBindings, action: HotkeyAction, value: HotkeyBinding | null): HotkeyBindings {
  const next: HotkeyBindings = { ...current, [action]: value };
  if (value) {
    for (const other of HOTKEY_ACTIONS) {
      if (other !== action && sameBinding(next[other], value)) next[other] = null;
    }
  }
  return next;
}

/** True for text fields, where typed letters must never trigger shortcuts. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== "object") return false;
  const element = target as { tagName?: string; isContentEditable?: boolean; type?: string };
  if (element.isContentEditable) return true;
  const tag = typeof element.tagName === "string" ? element.tagName.toUpperCase() : "";
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag !== "INPUT") return false;
  const type = (element.type ?? "text").toLowerCase();
  return !["checkbox", "radio", "range", "button", "submit", "reset", "color", "file"].includes(type);
}

/** A shortcut with only a plain letter/digit would fire while typing elsewhere; ask for a modifier. */
export function needsModifier(value: HotkeyBinding): boolean {
  const plain = !value.ctrl && !value.alt && !value.meta;
  return plain && /^(Key[A-Z]|Digit\d|Space|Enter|Tab)$/.test(value.code);
}
