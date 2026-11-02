import { HOTKEY_ACTIONS, isValidAccelerator, isValidPushToTalk, needsNativeHotkey, type HotkeyAction } from "./settings.js";

/** The subset of Electron's globalShortcut this module needs. */
export interface ShortcutApi {
  register(accelerator: string, callback: () => void): boolean;
  unregister(accelerator: string): void;
}

export type HotkeyStatus = "off" | "active" | "taken" | "invalid" | "unsupported";
/** Status of every hotkey slot; `ptt` is push-to-talk. */
export type HotkeyStatusMap = Record<HotkeyAction | "ptt", HotkeyStatus>;
export type HotkeySlot = HotkeyAction | "ptt";

/** Registers hotkeys Electron cannot (Pause, mouse side buttons, push-to-talk) through the native helper. */
export interface NativeHotkeyApi {
  /** Replace all native hotkeys; results arrive through HotkeyManager.nativeResult. */
  set(bindings: { action: HotkeyAction; accelerator: string }[], pushToTalk?: string | null): boolean;
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
  private status: HotkeyStatusMap = { mic: "off", sound: "off", stream: "off", ptt: "off" };
  private pushToTalk = "";
  private pushToTalkHeld = false;
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
  ) {}

  apply(hotkeys: Record<HotkeyAction, string>, pushToTalk = ""): HotkeyStatusMap {
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
    // Push-to-talk needs press and release, which only the native helper reports.
    const ptt = pushToTalk && isValidPushToTalk(pushToTalk) ? pushToTalk : "";
    this.status.ptt = !pushToTalk ? "off" : ptt ? "active" : "invalid";
    this.pushToTalk = ptt;
    if (nativeBindings.length || ptt) {
      const started = this.native?.set(nativeBindings, ptt || null) ?? false;
      if (!started) {
        for (const { action } of nativeBindings) this.status[action] = "unsupported";
        if (ptt) { this.status.ptt = "unsupported"; this.pushToTalk = ""; }
      }
    }
    return this.statuses();
  }

  statuses(): HotkeyStatusMap {
    return { ...this.status };
  }

  /** Push-to-talk works only once the helper confirmed it. */
  get pushToTalkActive(): boolean {
    return Boolean(this.pushToTalk) && this.status.ptt === "active";
  }

  clear(): void {
    for (const accelerator of this.registered.values()) {
      try { this.shortcuts.unregister(accelerator); } catch { /* already gone */ }
    }
    this.registered.clear();
    this.nativeActions.clear();
    this.releasePushToTalk();
    this.pushToTalk = "";
    this.native?.set([], null);
  }

  /** The native helper confirmed, refused or lost a hotkey. */
  nativeResult(action: HotkeySlot, status: HotkeyStatus): void {
    if (action === "ptt") {
      if (!this.pushToTalk || this.status.ptt === status) return;
      this.status.ptt = status;
      if (status !== "active") this.releasePushToTalk();
      this.onStatusChange(this.statuses());
      return;
    }
    if (!this.nativeActions.has(action) || this.status[action] === status) return;
    this.status[action] = status;
    this.onStatusChange(this.statuses());
  }

  /** Push-to-talk pressed or released, as reported by the native helper. */
  nativeHold(held: boolean): void {
    if (!this.pushToTalk || held === this.pushToTalkHeld) return;
    this.pushToTalkHeld = held;
    this.onPushToTalk(held);
  }

  private releasePushToTalk(): void {
    if (!this.pushToTalkHeld) return;
    this.pushToTalkHeld = false;
    this.onPushToTalk(false);
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
