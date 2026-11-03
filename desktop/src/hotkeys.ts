import { HOTKEY_ACTIONS, isValidAccelerator, isValidPushToTalk, needsNativeHotkey, type HotkeyAction } from "./settings.js";

/** The subset of Electron's globalShortcut this module needs. */
export interface ShortcutApi {
  register(accelerator: string, callback: () => void): boolean;
  unregister(accelerator: string): void;
}

const HOLD_SLOTS: readonly HoldSlot[] = ["ptt", "whisper"];

export type HotkeyStatus = "off" | "active" | "taken" | "invalid" | "unsupported";
/** Keys that act while held: push-to-talk and whisper. */
export type HoldSlot = "ptt" | "whisper";
/** Status of every hotkey slot; `ptt` is push-to-talk, `whisper` whisper-while-held. */
export type HotkeyStatusMap = Record<HotkeyAction | HoldSlot, HotkeyStatus>;
export type HotkeySlot = HotkeyAction | HoldSlot;

/** Registers hotkeys Electron cannot (Pause, mouse side buttons, push-to-talk) through the native helper. */
export interface NativeHotkeyApi {
  /** Replace all native hotkeys; results arrive through HotkeyManager.nativeResult. */
  set(bindings: { action: HotkeyAction; accelerator: string }[], pushToTalk?: string | null, whisper?: string | null): boolean;
}

/**
 * Keeps the registered global hotkeys in step with the settings. A hotkey
 * another program already owns is reported as "taken" instead of failing
 * silently, so the settings window can say so.
 */
export class HotkeyManager {
  private registered = new Map<HotkeyAction, string>();
  /** Actions currently handled by the native helper. */
  private nativeActions = new Set<HotkeyAction>();
  private status: HotkeyStatusMap = { mic: "off", sound: "off", stream: "off", ptt: "off", whisper: "off" };
  /** The key of each hold slot (empty when off) and whether it is held now. */
  private holdKeys: Record<HoldSlot, string> = { ptt: "", whisper: "" };
  private held: Record<HoldSlot, boolean> = { ptt: false, whisper: false };
  /** Ignore auto-repeat: one press, one action. */
  private lastFired = new Map<HotkeyAction, number>();

  constructor(
    private readonly shortcuts: ShortcutApi,
    private readonly onAction: (action: HotkeyAction) => void,
    private readonly now: () => number = () => Date.now(),
    private readonly native: NativeHotkeyApi | null = null,
    private readonly onStatusChange: (status: HotkeyStatusMap) => void = () => {},
    /** Push-to-talk pressed (true) or released (false). */
    private readonly onPushToTalk: (held: boolean) => void = () => {},
    /** Whisper key pressed (true) or released (false). */
    private readonly onWhisper: (held: boolean) => void = () => {},
  ) {}

  apply(hotkeys: Record<HotkeyAction, string>, pushToTalk = "", whisper = ""): HotkeyStatusMap {
    this.clear();
    const nativeBindings: { action: HotkeyAction; accelerator: string }[] = [];
    for (const action of HOTKEY_ACTIONS) {
      const accelerator = hotkeys[action];
      if (!accelerator) { this.status[action] = "off"; continue; }
      if (!isValidAccelerator(accelerator)) { this.status[action] = "invalid"; continue; }
      if (needsNativeHotkey(accelerator)) {
        nativeBindings.push({ action, accelerator });
        // Confirmed or corrected once the helper answers.
        this.status[action] = "active";
        continue;
      }
      let ok = false;
      try {
        ok = this.shortcuts.register(accelerator, () => this.fire(action));
      } catch {
        ok = false;
      }
      if (ok) this.registered.set(action, accelerator);
      this.status[action] = ok ? "active" : "taken";
    }
    this.nativeActions = new Set(nativeBindings.map(({ action }) => action));
    // Held keys need press and release, which only the native helper reports.
    const requested: Record<HoldSlot, string> = { ptt: pushToTalk, whisper };
    for (const slot of HOLD_SLOTS) {
      const key = requested[slot] && isValidPushToTalk(requested[slot]) ? requested[slot] : "";
      this.status[slot] = !requested[slot] ? "off" : key ? "active" : "invalid";
      this.holdKeys[slot] = key;
    }
    if (nativeBindings.length || this.holdKeys.ptt || this.holdKeys.whisper) {
      const started = this.native?.set(nativeBindings, this.holdKeys.ptt || null, this.holdKeys.whisper || null) ?? false;
      if (!started) {
        for (const { action } of nativeBindings) this.status[action] = "unsupported";
        for (const slot of HOLD_SLOTS) if (this.holdKeys[slot]) { this.status[slot] = "unsupported"; this.holdKeys[slot] = ""; }
      }
    }
    return this.statuses();
  }

  statuses(): HotkeyStatusMap {
    return { ...this.status };
  }

  /** Push-to-talk works only once the helper confirmed it. */
  get pushToTalkActive(): boolean {
    return Boolean(this.holdKeys.ptt) && this.status.ptt === "active";
  }

  clear(): void {
    for (const accelerator of this.registered.values()) {
      try { this.shortcuts.unregister(accelerator); } catch { /* already gone */ }
    }
    this.registered.clear();
    this.nativeActions.clear();
    for (const slot of HOLD_SLOTS) { this.release(slot); this.holdKeys[slot] = ""; }
    this.native?.set([], null, null);
  }

  /** The native helper confirmed, refused or lost a hotkey. */
  nativeResult(action: HotkeySlot, status: HotkeyStatus): void {
    if (action === "ptt" || action === "whisper") {
      if (!this.holdKeys[action] || this.status[action] === status) return;
      this.status[action] = status;
      if (status !== "active") this.release(action);
      this.onStatusChange(this.statuses());
      return;
    }
    if (!this.nativeActions.has(action) || this.status[action] === status) return;
    this.status[action] = status;
    this.onStatusChange(this.statuses());
  }

  /** A held key pressed or released, as reported by the native helper. */
  nativeHold(held: boolean, slot: HoldSlot = "ptt"): void {
    if (!this.holdKeys[slot] || held === this.held[slot]) return;
    this.held[slot] = held;
    (slot === "ptt" ? this.onPushToTalk : this.onWhisper)(held);
  }

  private release(slot: HoldSlot): void {
    if (!this.held[slot]) return;
    this.held[slot] = false;
    (slot === "ptt" ? this.onPushToTalk : this.onWhisper)(false);
  }

  /** A press reported by the native helper. */
  nativeFire(action: HotkeyAction): void {
    if (this.nativeActions.has(action)) this.fire(action);
  }

  private fire(action: HotkeyAction): void {
    const now = this.now();
    const last = this.lastFired.get(action) ?? -Infinity;
    // Windows repeats a held hotkey roughly every 30-50 ms.
    if (now - last < 250) { this.lastFired.set(action, now); return; }
    this.lastFired.set(action, now);
    this.onAction(action);
  }
}
