import { onMounted, onUnmounted, watch } from "vue";

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
  /** Newer shells: feed the in-game overlay. */
  reportOverlay?(kind: "roster" | "speaking", value: unknown): void;
}

/** Who is in the current channel, for the desktop overlay. */
export interface DesktopOverlayRoster {
  connected: boolean;
  channel: string;
  members: { id: number; name: string; muted: boolean; self: boolean; avatar?: string }[];
}

export interface DesktopState {
  connected: boolean;
  micMuted: boolean;
  soundMuted: boolean;
  streaming: boolean;
  /** You are talking right now (voice activity on an unmuted microphone). */
  speaking?: boolean;
  /** Sharing program sound as accompaniment (the shell keeps its clean capture running). */
  accompaniment?: boolean;
}

export interface DesktopBridgeOptions {
  state: () => DesktopState;
  toggleMicrophone: () => unknown;
  toggleSound: () => unknown;
  startStream: () => unknown;
  stopStream: () => unknown;
  /** Screen share is starting (picker open, negotiation running). */
  streamStarting: () => boolean;
  /** Push-to-talk: the desktop client turns the mode on and reports the key. */
  setPushToTalkMode?: (enabled: boolean) => void;
  setPushToTalkHeld?: (held: boolean) => void;
  /** Whisper key of the desktop client held or released. */
  setWhisperHeld?: (held: boolean) => void;
  /** The current channel for the in-game overlay; changes rarely. */
  overlayRoster?: () => DesktopOverlayRoster;
  /** Ids talking now; changes many times a second. */
  speakingIds?: () => number[];
}

/** Push-to-talk messages from the desktop shell; they never play a sound. */
export function runPushToTalkAction(action: "pttDown" | "pttUp" | "pttModeOn" | "pttModeOff", options: DesktopBridgeOptions): string {
  if (action === "pttModeOn" || action === "pttModeOff") {
    options.setPushToTalkMode?.(action === "pttModeOn");
    return action === "pttModeOn" ? "ptt-mode-on" : "ptt-mode-off";
  }
  options.setPushToTalkHeld?.(action === "pttDown");
  return action === "pttDown" ? "ptt-down" : "ptt-up";
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
    if (action === "pttDown" || action === "pttUp" || action === "pttModeOn" || action === "pttModeOff") return runPushToTalkAction(action, options);
    if (action === "whisperDown" || action === "whisperUp") {
      options.setWhisperHeld?.(action === "whisperDown");
      return action === "whisperDown" ? "whisper-down" : "whisper-up";
    }
    if (action !== "mic" && action !== "sound" && action !== "stream") return "unknown-action";
    return runDesktopAction(action, options, playDesktopTone, sound === true);
  };
  const stopWatching = watch(options.state, (state) => {
    try { host.reportState({ ...state }); } catch { /* the shell went away */ }
  }, { immediate: true, deep: true });

  // The overlay data goes only to shells that can show it; the shell keeps it while the overlay is off.
  // Started once the page is set up: the getters read page state defined after this call.
  const overlayHost = typeof host.reportOverlay === "function" ? host : null;
  let stopRoster = () => {};
  let stopSpeaking = () => {};
  onMounted(() => {
    if (!overlayHost) return;
    if (options.overlayRoster) stopRoster = watch(options.overlayRoster, (roster) => {
      try { overlayHost.reportOverlay!("roster", roster); } catch { /* the shell went away */ }
    }, { immediate: true, deep: true });
    if (options.speakingIds) stopSpeaking = watch(() => [...options.speakingIds!()].sort((a, b) => a - b).join(","), (ids) => {
      try { overlayHost.reportOverlay!("speaking", ids ? ids.split(",").map(Number) : []); } catch { /* the shell went away */ }
    }, { immediate: true });
  });

  onUnmounted(() => {
    stopWatching();
    stopRoster();
    stopSpeaking();
    options.setPushToTalkMode?.(false);
    if (target.__webspeakDesktopAction) delete target.__webspeakDesktopAction;
  });
  return { isDesktop: true, openSettings: () => host.openSettings() };
}
