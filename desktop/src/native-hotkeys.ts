import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { HOTKEY_ACTIONS, type HotkeyAction } from "./settings.js";
import type { HoldSlot, HotkeySlot, HotkeyStatus, NativeHotkeyApi } from "./hotkeys.js";
import type { ForegroundWindow } from "./overlay-state.js";

const PUSH_TO_TALK_ID = 100;
const WHISPER_ID = 101;

/**
 * Runs native/hotkeys.cpp for hotkeys Electron cannot register (Pause and
 * mouse side buttons). The helper only runs while such a hotkey is set.
 */
export class NativeHotkeys implements NativeHotkeyApi {
  private child: ChildProcess | null = null;
  private buffer = "";
  /** The overlay wants to know the active window; keeps the helper running. */
  private watching = false;
  private hasBindings = false;
  /** Called with the active window, or null when it can no longer be known. */
  onForeground: (foreground: ForegroundWindow | null) => void = () => {};

  constructor(
    private readonly helperPath: string,
    private readonly onFire: (action: HotkeyAction) => void,
    private readonly onResult: (action: HotkeySlot, status: HotkeyStatus) => void,
    private readonly log: (message: string) => void = () => {},
    private readonly anyPlatform = false,
    private readonly onHold: (held: boolean, slot: HoldSlot) => void = () => {},
  ) {}

  set(bindings: { action: HotkeyAction; accelerator: string }[], pushToTalk: string | null = null, whisper: string | null = null): boolean {
    this.hasBindings = Boolean(bindings.length || pushToTalk || whisper);
    if (!this.hasBindings) {
      if (!this.watching) { this.stop(); return true; }
      this.child?.stdin?.writable && this.child.stdin.write("clear\n");
      return true;
    }
    if ((process.platform !== "win32" && !this.anyPlatform) || !existsSync(this.helperPath)) return false;
    const child = this.ensure();
    if (!child?.stdin?.writable) return false;
    const spec = (accelerator: string) => accelerator.split("+")
      .map((part) => (part === "CommandOrControl" || part === "Control" ? "Ctrl" : part === "Super" ? "Win" : part)).join("+");
    const lines = ["clear", ...bindings.map(({ action, accelerator }) => `set ${HOTKEY_ACTIONS.indexOf(action) + 1} ${spec(accelerator)}`)];
    if (pushToTalk) lines.push(`hold ${PUSH_TO_TALK_ID} ${pushToTalk}`);
    if (whisper) lines.push(`hold ${WHISPER_ID} ${whisper}`);
    child.stdin.write(lines.join("\n") + "\n");
    return true;
  }

  /**
   * Report the active window to onForeground (for the overlay's "only in
   * games"). False when the helper cannot run here.
   */
  watchForeground(on: boolean): boolean {
    if (on === this.watching) return on ? Boolean(this.child) : true;
    this.watching = on;
    if (!on) {
      if (this.child?.stdin?.writable) this.child.stdin.write("watch 0\n");
      if (!this.hasBindings) this.stop();
      return true;
    }
    if ((process.platform !== "win32" && !this.anyPlatform) || !existsSync(this.helperPath)) { this.watching = false; return false; }
    const child = this.ensure();
    if (!child?.stdin?.writable) { this.watching = false; return false; }
    child.stdin.write("watch 1\n");
    return true;
  }

  /** Quit the helper (the app ends). */
  shutdown(): void {
    this.watching = false;
    this.hasBindings = false;
    this.stop();
  }

  stop(): void {
    const child = this.child;
    this.child = null;
    if (!child) return;
    try { child.stdin?.end(); } catch { /* already closed */ }
    setTimeout(() => { if (child.exitCode === null) child.kill(); }, 1000);
  }

  private ensure(): ChildProcess | null {
    if (this.child && this.child.exitCode === null) return this.child;
    let child: ChildProcess;
    try {
      child = spawn(this.helperPath, [String(process.pid)], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    } catch (error) {
      this.log(`hotkey helper failed to start: ${String(error)}`);
      return null;
    }
    this.child = child;
    this.buffer = "";
    child.stdout!.setEncoding("utf8");
    child.stdout!.on("data", (chunk: string) => {
      this.buffer += chunk;
      let newline: number;
      while ((newline = this.buffer.indexOf("\n")) >= 0) {
        const line = this.buffer.slice(0, newline).trim();
        this.buffer = this.buffer.slice(newline + 1);
        this.handle(line);
      }
    });
    child.stderr!.on("data", (chunk: Buffer) => this.log(chunk.toString().trim()));
    child.on("error", (error) => this.log(`hotkey helper: ${String(error)}`));
    child.on("exit", () => {
      if (this.child !== child) return;
      this.child = null;
      // An unexpected exit leaves these hotkeys dead: report them, and never
      // leave push-to-talk stuck open.
      this.onHold(false, "ptt");
      this.onHold(false, "whisper");
      for (const action of HOTKEY_ACTIONS) this.onResult(action, "unsupported");
      this.onResult("ptt", "unsupported");
      this.onResult("whisper", "unsupported");
      if (this.watching) { this.watching = false; this.onForeground(null); }
    });
    child.stdin!.on("error", () => { /* helper gone; exit handler reports it */ });
    return child;
  }

  private handle(line: string): void {
    const [kind, idText] = line.split(" ");
    if (kind === "fg") {
      if (!this.watching) return;
      const exe = line.split(" ").slice(2).join(" ");
      this.onForeground({ fullscreen: idText === "1", exe: exe === "-" ? "" : exe.toLowerCase() });
      return;
    }
    const hold: HoldSlot | null = Number(idText) === PUSH_TO_TALK_ID ? "ptt" : Number(idText) === WHISPER_ID ? "whisper" : null;
    if (hold) {
      if (kind === "down" || kind === "up") this.onHold(kind === "down", hold);
      else if (kind === "ok") this.onResult(hold, "active");
      else if (kind === "taken") this.onResult(hold, "taken");
      else if (kind === "invalid") this.onResult(hold, "invalid");
      return;
    }
    const action = HOTKEY_ACTIONS[Number(idText) - 1];
    if (!action) return;
    if (kind === "fire") this.onFire(action);
    else if (kind === "ok") this.onResult(action, "active");
    else if (kind === "taken") this.onResult(action, "taken");
    else if (kind === "invalid") this.onResult(action, "invalid");
  }
}
