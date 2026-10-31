import { HOTKEY_ACTIONS, isValidAccelerator, type HotkeyAction } from "./settings.js";

/** The subset of Electron's globalShortcut this module needs. */
export interface ShortcutApi {
  register(accelerator: string, callback: () => void): boolean;
  unregister(accelerator: string): void;
}

export type HotkeyStatus = "off" | "active" | "taken" | "invalid";

/**
 * Keeps the registered global hotkeys in step with the settings. A hotkey
 * another program already owns is reported as "taken" instead of failing
 * silently, so the settings window can say so.
 */
export class HotkeyManager {
  private registered = new Map<HotkeyAction, string>();
  private status: Record<HotkeyAction, HotkeyStatus> = { mic: "off", sound: "off", stream: "off" };
  /** Ignore auto-repeat: one press, one action. */
  private lastFired = new Map<HotkeyAction, number>();

  constructor(
    private readonly shortcuts: ShortcutApi,
    private readonly onAction: (action: HotkeyAction) => void,
    private readonly now: () => number = () => Date.now(),
  ) {}

  apply(hotkeys: Record<HotkeyAction, string>): Record<HotkeyAction, HotkeyStatus> {
    this.clear();
    for (const action of HOTKEY_ACTIONS) {
      const accelerator = hotkeys[action];
      if (!accelerator) { this.status[action] = "off"; continue; }
      if (!isValidAccelerator(accelerator)) { this.status[action] = "invalid"; continue; }
      let ok = false;
      try {
        ok = this.shortcuts.register(accelerator, () => this.fire(action));
      } catch {
        ok = false;
      }
      if (ok) this.registered.set(action, accelerator);
      this.status[action] = ok ? "active" : "taken";
    }
    return this.statuses();
  }

  statuses(): Record<HotkeyAction, HotkeyStatus> {
    return { ...this.status };
  }

  clear(): void {
    for (const accelerator of this.registered.values()) {
      try { this.shortcuts.unregister(accelerator); } catch { /* already gone */ }
    }
    this.registered.clear();
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
