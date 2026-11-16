/*
 * Short board sounds made with Web Audio (no files): a move, a capture, a
 * check, the end of the game. On or off per browser.
 */

export type ChessSound = "move" | "capture" | "check" | "end";

const KEY = "webspeak:chess-sound";
let context: AudioContext | null = null;

export function chessSoundOn(): boolean {
  try { return localStorage.getItem(KEY) !== "0"; } catch { return true; }
}
export function setChessSoundOn(on: boolean): void {
  try { localStorage.setItem(KEY, on ? "1" : "0"); } catch { /* per-browser convenience */ }
}

/** Which sound a new move in SAN calls for. */
export function soundForSan(san: string): ChessSound {
  if (san.endsWith("#")) return "end";
  if (san.endsWith("+")) return "check";
  return san.includes("x") ? "capture" : "move";
}

export function playChessSound(sound: ChessSound): void {
  if (!chessSoundOn() || typeof AudioContext === "undefined") return;
  try {
    context ??= new AudioContext();
    if (context.state === "suspended") void context.resume();
    const now = context.currentTime;
    const knock = (at: number, frequency: number, length: number, gain: number, type: OscillatorType = "triangle") => {
      const oscillator = context!.createOscillator();
      const level = context!.createGain();
      oscillator.type = type;
      oscillator.frequency.setValueAtTime(frequency, now + at);
      oscillator.frequency.exponentialRampToValueAtTime(frequency * 0.55, now + at + length);
      level.gain.setValueAtTime(0.0001, now + at);
      level.gain.exponentialRampToValueAtTime(gain, now + at + 0.005);
      level.gain.exponentialRampToValueAtTime(0.0001, now + at + length);
      oscillator.connect(level).connect(context!.destination);
      oscillator.start(now + at);
      oscillator.stop(now + at + length + 0.02);
    };
    if (sound === "move") knock(0, 520, 0.09, 0.22);
    if (sound === "capture") { knock(0, 700, 0.07, 0.25, "square"); knock(0.05, 360, 0.1, 0.2); }
    if (sound === "check") { knock(0, 880, 0.12, 0.18, "sine"); knock(0.11, 660, 0.14, 0.18, "sine"); }
    if (sound === "end") { knock(0, 523, 0.35, 0.16, "sine"); knock(0.12, 659, 0.35, 0.14, "sine"); knock(0.24, 784, 0.5, 0.14, "sine"); }
  } catch {
    // Sound is a nicety.
  }
}
