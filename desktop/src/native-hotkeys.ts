import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { HOTKEY_ACTIONS, type HotkeyAction } from "./settings.js";
import type { HotkeyStatus, NativeHotkeyApi } from "./hotkeys.js";

/**
 * Runs native/hotkeys.cpp for hotkeys Electron cannot register (Pause and
 * mouse side buttons). The helper only runs while such a hotkey is set.
 */
export class NativeHotkeys implements NativeHotkeyApi {
  private child: ChildProcess | null = null;
  private buffer = "";

  constructor(
    private readonly helperPath: string,
    private readonly onFire: (action: HotkeyAction) => void,
    private readonly onResult: (action: HotkeyAction, status: HotkeyStatus) => void,
    private readonly log: (message: string) => void = () => {},
    private readonly anyPlatform = false,
  ) {}

  set(bindings: { action: HotkeyAction; accelerator: string }[]): boolean {
    if (!bindings.length) { this.stop(); return true; }
    if ((process.platform !== "win32" && !this.anyPlatform) || !existsSync(this.helperPath)) return false;
    const child = this.ensure();
    if (!child?.stdin?.writable) return false;
    const spec = (accelerator: string) => accelerator.split("+")
      .map((part) => (part === "CommandOrControl" || part === "Control" ? "Ctrl" : part === "Super" ? "Win" : part)).join("+");
    const lines = ["clear", ...bindings.map(({ action, accelerator }) => `set ${HOTKEY_ACTIONS.indexOf(action) + 1} ${spec(accelerator)}`)];
    child.stdin.write(lines.join("\n") + "\n");
    return true;
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
      // An unexpected exit leaves these hotkeys dead: report them.
      for (const action of HOTKEY_ACTIONS) this.onResult(action, "unsupported");
    });
    child.stdin!.on("error", () => { /* helper gone; exit handler reports it */ });
    return child;
  }

  private handle(line: string): void {
    const [kind, idText] = line.split(" ");
    const action = HOTKEY_ACTIONS[Number(idText) - 1];
    if (!action) return;
    if (kind === "fire") this.onFire(action);
    else if (kind === "ok") this.onResult(action, "active");
    else if (kind === "taken") this.onResult(action, "taken");
    else if (kind === "invalid") this.onResult(action, "invalid");
  }
}
