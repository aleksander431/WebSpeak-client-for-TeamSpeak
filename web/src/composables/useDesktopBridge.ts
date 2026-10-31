import { onUnmounted, watch } from "vue";

/*
 * Bridge to the WebSpeak desktop client (Electron). The desktop shell's
 * preload exposes `window.webspeakDesktop`; in a normal browser it is absent
 * and nothing here runs.
 *
 * Global hotkeys and tray items call `window.__webspeakDesktopAction`, which
 * the shell runs with a user gesture so screen sharing may start from a
 * hotkey pressed inside a game.
 */

export type DesktopAction = "mic" | "sound" | "stream";

export interface DesktopHost {
  platform: string;
  reportState(state: DesktopState): void;
  openSettings(): void;
}

export interface DesktopState {
  connected: boolean;
  micMuted: boolean;
  soundMuted: boolean;
  streaming: boolean;
}

export interface DesktopBridgeOptions {
  state: () => DesktopState;
  toggleMicrophone: () => unknown;
  toggleSound: () => unknown;
  startStream: () => unknown;
  stopStream: () => unknown;
  /** Screen share is starting (picker open, negotiation running). */
  streamStarting: () => boolean;
}

type Tone = "on" | "off" | "denied";

export function desktopHost(target: unknown = typeof window === "undefined" ? undefined : window): DesktopHost | null {
  const host = (target as { webspeakDesktop?: unknown } | undefined)?.webspeakDesktop as Partial<DesktopHost> | undefined;
  return host && typeof host.reportState === "function" ? host as DesktopHost : null;
}

/** Run one desktop action; returns what happened for the shell and tests. */
export function runDesktopAction(action: DesktopAction, options: DesktopBridgeOptions, playTone: (tone: Tone) => void, sound: boolean): string {
  // Copy: the toggles below may change the live state object.
  const state = { ...options.state() };
  if (!state.connected) {
    if (sound) playTone("denied");
    return "not-connected";
  }
  switch (action) {
    case "mic":
      void options.toggleMicrophone();
      if (sound) playTone(state.micMuted ? "on" : "off");
      return state.micMuted ? "mic-on" : "mic-off";
    case "sound":
      void options.toggleSound();
      if (sound) playTone(state.soundMuted ? "on" : "off");
      return state.soundMuted ? "sound-on" : "sound-off";
    case "stream":
      if (state.streaming || options.streamStarting()) {
        void options.stopStream();
        if (sound) playTone("off");
        return "stream-stop";
      }
      void options.startStream();
      if (sound) playTone("on");
      return "stream-start";
  }
}

let toneContext: AudioContext | null = null;

/** Short two-note cue, like other voice apps: rising for on, falling for off. */
function playDesktopTone(tone: Tone): void {
  try {
    toneContext ??= new AudioContext();
    const context = toneContext;
    if (context.state === "suspended") void context.resume();
    const notes = tone === "on" ? [523, 784] : tone === "off" ? [784, 523] : [330, 330];
    const start = context.currentTime + 0.01;
    notes.forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      const at = start + index * 0.09;
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(0.12, at + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.08);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(at);
      oscillator.stop(at + 0.09);
    });
  } catch {
    // Feedback sounds are optional.
  }
}

export function useDesktopBridge(options: DesktopBridgeOptions, target: Window & { __webspeakDesktopAction?: unknown } = window) {
  const host = desktopHost(target);
  if (!host) return { isDesktop: false, openSettings: () => {} };

  target.__webspeakDesktopAction = (action: unknown, sound: unknown) => {
    if (action !== "mic" && action !== "sound" && action !== "stream") return "unknown-action";
    return runDesktopAction(action, options, playDesktopTone, sound === true);
  };
  const stopWatching = watch(options.state, (state) => {
    try { host.reportState({ ...state }); } catch { /* the shell went away */ }
  }, { immediate: true, deep: true });

  onUnmounted(() => {
    stopWatching();
    if (target.__webspeakDesktopAction) delete target.__webspeakDesktopAction;
  });
  return { isDesktop: true, openSettings: () => host.openSettings() };
}
