import { onScopeDispose, ref, watch, type Ref } from "vue";
import {
  HOTKEY_ACTIONS, HOTKEYS_STORAGE_KEY, MEDIA_KEY_STORAGE_KEY, assignHotkey, bindingFromEvent, isTypingTarget,
  matchesBinding, needsModifier, parseHotkeys, type HotkeyAction, type HotkeyBindings,
} from "../services/hotkeys.js";

interface Options {
  connected: Readonly<Ref<boolean>>;
  microphoneMuted: Readonly<Ref<boolean>>;
  outputMuted: Readonly<Ref<boolean>>;
  screenShareActive: Readonly<Ref<boolean>>;
  screenShareStarting: Readonly<Ref<boolean>>;
  setMicrophoneMuted(muted: boolean): void;
  toggleOutputMute(): void;
  startScreenShare(): void | Promise<void>;
  stopScreenShare(): void;
  showToast(message: string): void;
  t(key: string): string;
  /** Replaceable for tests. */
  target?: Pick<Window, "addEventListener" | "removeEventListener">;
  storage?: Pick<Storage, "getItem" | "setItem">;
  mediaSession?: MediaSession | null;
  createSilentAudio?: () => SilentAudio | null;
}

export interface SilentAudio {
  play(): Promise<void>;
  stop(): void;
}

/**
 * Room shortcuts plus an optional media-key mode.
 *
 * The media-key mode is the only way to toggle the microphone from a game
 * without an extension: Windows routes the keyboard or headset Play/Pause
 * key to the browser's active media session even when it is in the
 * background. The page claims that session with an inaudible looping track.
 * Another player (Spotify, YouTube) that started later can take the key.
 */
export function useWebClientHotkeys(options: Options) {
  const storage = options.storage ?? safeStorage();
  const bindings = ref<HotkeyBindings>(parseHotkeys(storage?.getItem(HOTKEYS_STORAGE_KEY) ?? null));
  /** Action whose new keys are being recorded. */
  const recording = ref<HotkeyAction | null>(null);
  const recordingHint = ref("");
  const mediaKeyEnabled = ref(storage?.getItem(MEDIA_KEY_STORAGE_KEY) === "1");
  const mediaKeySupported = Boolean(options.mediaSession !== undefined ? options.mediaSession : typeof navigator !== "undefined" && "mediaSession" in navigator);
  const target = options.target ?? (typeof window !== "undefined" ? window : null);
  /** Microphone state before "mute sound" muted it, restored when sound returns. */
  let microphoneBeforeDeafen: boolean | null = null;

  function persist(): void {
    try { storage?.setItem(HOTKEYS_STORAGE_KEY, JSON.stringify(bindings.value)); } catch { /* shortcuts still work this session */ }
  }

  function toggleMicrophone(): void {
    if (!options.connected.value) return;
    const muted = !options.microphoneMuted.value;
    options.setMicrophoneMuted(muted);
    options.showToast(options.t(muted ? "microphoneMuted" : "microphoneActive"));
  }

  /** Like "deafen" in TeamSpeak: silence everyone and the microphone, then restore both. */
  function toggleDeafen(): void {
    if (!options.connected.value) return;
    if (!options.outputMuted.value) {
      microphoneBeforeDeafen = options.microphoneMuted.value;
      options.toggleOutputMute();
      if (!options.microphoneMuted.value) options.setMicrophoneMuted(true);
      options.showToast(options.t("hotkeyDeafened"));
    } else {
      options.toggleOutputMute();
      if (microphoneBeforeDeafen === false && options.microphoneMuted.value) options.setMicrophoneMuted(false);
      microphoneBeforeDeafen = null;
      options.showToast(options.t("hotkeyUndeafened"));
    }
  }

  function toggleScreenShare(): void {
    if (!options.connected.value) return;
    if (options.screenShareActive.value) options.stopScreenShare();
    else if (!options.screenShareStarting.value) void options.startScreenShare();
  }

  const handlers: Record<HotkeyAction, () => void> = { toggleMicrophone, toggleDeafen, toggleScreenShare };

  function onKeydown(event: KeyboardEvent): void {
    if (recording.value) {
      captureBinding(event);
      return;
    }
    if (event.repeat || event.isComposing || isTypingTarget(event.target)) return;
    for (const action of HOTKEY_ACTIONS) {
      if (!matchesBinding(event, bindings.value[action])) continue;
      event.preventDefault();
      event.stopPropagation();
      handlers[action]();
      return;
    }
  }

  function captureBinding(event: KeyboardEvent): void {
    const action = recording.value!;
    if (event.key === "Escape" && !event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey) {
      event.preventDefault(); event.stopPropagation();
      stopRecording();
      return;
    }
    if ((event.key === "Backspace" || event.key === "Delete") && !event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey) {
      event.preventDefault(); event.stopPropagation();
      bindings.value = assignHotkey(bindings.value, action, null);
      persist();
      stopRecording();
      return;
    }
    const value = bindingFromEvent(event);
    if (!value) return; // a modifier on its own: keep waiting for the key
    event.preventDefault(); event.stopPropagation();
    if (needsModifier(value)) {
      recordingHint.value = "hotkeyNeedsModifier";
      return;
    }
    bindings.value = assignHotkey(bindings.value, action, value);
    persist();
    stopRecording();
  }

  function startRecording(action: HotkeyAction): void {
    recording.value = action;
    recordingHint.value = "";
  }

  function stopRecording(): void {
    recording.value = null;
    recordingHint.value = "";
  }

  function resetDefaults(): void {
    bindings.value = parseHotkeys(null);
    persist();
    stopRecording();
  }

  // Capture phase, so dialogs that stop propagation cannot swallow shortcuts.
  target?.addEventListener("keydown", onKeydown as EventListener, true);

  // ---- Media key (Play/Pause) toggles the microphone, also from other apps ----
  const session = options.mediaSession !== undefined ? options.mediaSession : (typeof navigator !== "undefined" && "mediaSession" in navigator ? navigator.mediaSession : null);
  let silent: SilentAudio | null = null;
  let mediaKeyActive = false;

  function setMediaHandlers(active: boolean): void {
    if (!session) return;
    const handler = active ? () => toggleMicrophone() : null;
    for (const action of ["play", "pause", "togglemicrophone"] as const) {
      try { session.setActionHandler(action as MediaSessionAction, handler); } catch { /* action unsupported in this browser */ }
    }
  }

  function syncMediaState(): void {
    if (!session || !mediaKeyActive) return;
    try {
      // "Playing" while the microphone is live, so the system media flyout shows the real state.
      session.playbackState = options.microphoneMuted.value ? "paused" : "playing";
      session.metadata = typeof MediaMetadata === "function"
        ? new MediaMetadata({ title: options.t(options.microphoneMuted.value ? "microphoneMuted" : "microphoneActive"), artist: "WebSpeak" })
        : session.metadata;
    } catch { /* metadata is cosmetic */ }
  }

  async function updateMediaKey(): Promise<void> {
    const shouldRun = mediaKeySupported && mediaKeyEnabled.value && options.connected.value;
    if (shouldRun === mediaKeyActive) { syncMediaState(); return; }
    mediaKeyActive = shouldRun;
    if (shouldRun) {
      silent ??= (options.createSilentAudio ?? createSilentAudio)();
      try { await silent?.play(); } catch { /* autoplay may need another click; handlers still work in-page */ }
      if (!mediaKeyActive) { silent?.stop(); return; }
      setMediaHandlers(true);
      syncMediaState();
    } else {
      setMediaHandlers(false);
      silent?.stop();
      if (session) {
        try { session.playbackState = "none"; session.metadata = null; } catch { /* cosmetic */ }
      }
    }
  }

  function setMediaKeyEnabled(enabled: boolean): void {
    mediaKeyEnabled.value = enabled;
    try { storage?.setItem(MEDIA_KEY_STORAGE_KEY, enabled ? "1" : "0"); } catch { /* applies this session */ }
  }

  watch([mediaKeyEnabled, options.connected], () => { void updateMediaKey(); }, { immediate: true });
  watch(options.microphoneMuted, syncMediaState);
  watch(options.connected, (connected) => { if (!connected) microphoneBeforeDeafen = null; });

  onScopeDispose(() => {
    target?.removeEventListener("keydown", onKeydown as EventListener, true);
    mediaKeyActive = false;
    setMediaHandlers(false);
    silent?.stop();
    silent = null;
  });

  return {
    bindings,
    recording,
    recordingHint,
    mediaKeyEnabled,
    mediaKeySupported,
    startRecording,
    stopRecording,
    resetDefaults,
    setMediaKeyEnabled,
    clear(action: HotkeyAction) { bindings.value = assignHotkey(bindings.value, action, null); persist(); },
    /** Exposed for tests and the settings dialog. */
    run(action: HotkeyAction) { handlers[action](); },
  };
}

export type WebClientHotkeys = ReturnType<typeof useWebClientHotkeys>;

function safeStorage(): Pick<Storage, "getItem" | "setItem"> | null {
  try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
}

/**
 * An inaudible looping track (±1 LSB noise, about -90 dB) that lets the
 * page own the system media session. Pure digital silence is avoided because
 * some systems treat a silent element as inactive.
 */
export function createSilentAudio(): SilentAudio | null {
  if (typeof Audio !== "function" || typeof URL === "undefined" || typeof Blob !== "function") return null;
  const sampleRate = 8_000, seconds = 10, samples = sampleRate * seconds;
  const buffer = new ArrayBuffer(44 + samples * 2);
  const view = new DataView(buffer);
  const text = (offset: number, value: string) => { for (let index = 0; index < value.length; index++) view.setUint8(offset + index, value.charCodeAt(index)); };
  text(0, "RIFF"); view.setUint32(4, 36 + samples * 2, true); text(8, "WAVE"); text(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  text(36, "data"); view.setUint32(40, samples * 2, true);
  for (let index = 0; index < samples; index++) view.setInt16(44 + index * 2, (index * 7919) % 3 - 1, true);
  const url = URL.createObjectURL(new Blob([buffer], { type: "audio/wav" }));
  const audio = new Audio(url);
  audio.loop = true;
  audio.preload = "auto";
  return {
    async play() { await audio.play(); },
    stop() { audio.pause(); },
  };
}
