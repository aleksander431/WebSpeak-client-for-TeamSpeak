/**
 * A "call in progress" card in the phone's notification shade and lock screen.
 *
 * Mobile browsers only show Media Session controls for a playing media element
 * with sound, and WebRTC/WebAudio voice does not count, so the card is carried
 * by a looping silent clip. It also tells the browser the page is busy with a
 * call, which makes it less eager to freeze the tab in the background.
 */

export interface CallMediaSessionState {
  channel: string;
  server: string;
  microphoneMuted: boolean;
}

export interface CallMediaSessionLabels {
  microphoneOn: string;
  microphoneOff: string;
}

export interface CallMediaSessionOptions {
  toggleMicrophone(): void;
  hangUp(): void;
  labels(): CallMediaSessionLabels;
  /** Absolute URL of the app icon for the card. */
  artwork?: string;
}

export interface CallMediaSessionController {
  /** Show or refresh the card; `null` removes it. */
  update(state: CallMediaSessionState | null): void;
  dispose(): void;
}

type Action = "play" | "pause" | "togglemicrophone" | "hangup";

interface MediaSessionLike {
  metadata: unknown;
  playbackState: string;
  setActionHandler(action: Action, handler: (() => void) | null): void;
  setMicrophoneActive?: (active: boolean) => void | Promise<void>;
}

export interface CallMediaSessionEnvironment {
  mediaSession?: MediaSessionLike;
  createMetadata?: (init: { title: string; artist: string; album: string; artwork: { src: string; sizes: string; type: string }[] }) => unknown;
  createAudio?: () => HTMLAudioElement;
  /** Retry playback after the next gesture when autoplay was refused. */
  onGesture?: (retry: () => void) => () => void;
}

/** A silent 8 kHz, 8-bit mono WAV clip; long enough for browsers to treat it as media. */
export function silentWav(seconds = 10, sampleRate = 8000): Uint8Array {
  const samples = Math.max(1, Math.round(seconds * sampleRate));
  const bytes = new Uint8Array(44 + samples);
  const view = new DataView(bytes.buffer);
  const ascii = (offset: number, text: string) => { for (let i = 0; i < text.length; i++) bytes[offset + i] = text.charCodeAt(i); };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + samples, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true);
  ascii(36, "data");
  view.setUint32(40, samples, true);
  bytes.fill(128, 44);
  return bytes;
}

export function browserCallMediaSessionEnvironment(): CallMediaSessionEnvironment {
  const nav = typeof navigator === "undefined" ? undefined : navigator as Navigator & { mediaSession?: MediaSessionLike };
  const Metadata = typeof window === "undefined" ? undefined : (window as Window & { MediaMetadata?: new (init: unknown) => unknown }).MediaMetadata;
  return {
    ...(nav?.mediaSession ? { mediaSession: nav.mediaSession } : {}),
    ...(Metadata ? { createMetadata: (init) => new Metadata(init) } : {}),
    createAudio: () => document.createElement("audio"),
    onGesture(retry) {
      const events = ["pointerdown", "touchend", "keydown"] as const;
      for (const event of events) window.addEventListener(event, retry, { passive: true });
      return () => { for (const event of events) window.removeEventListener(event, retry); };
    },
  };
}

export function createCallMediaSession(options: CallMediaSessionOptions, environment: CallMediaSessionEnvironment = browserCallMediaSessionEnvironment()): CallMediaSessionController {
  const session = environment.mediaSession;
  let audio: HTMLAudioElement | null = null;
  let clipUrl = "";
  let removeGesture: (() => void) | null = null;
  let active = false;
  let disposed = false;
  const guard = (operation: () => void) => { try { operation(); } catch { /* optional browser feature */ } };

  function setHandlers(enabled: boolean): void {
    if (!session) return;
    const handlers: Record<Action, (() => void) | null> = {
      // Lock screens show play/pause; for a call that is the microphone.
      play: enabled ? () => options.toggleMicrophone() : null,
      pause: enabled ? () => options.toggleMicrophone() : null,
      togglemicrophone: enabled ? () => options.toggleMicrophone() : null,
      hangup: enabled ? () => options.hangUp() : null,
    };
    for (const [action, handler] of Object.entries(handlers) as [Action, (() => void) | null][]) guard(() => session.setActionHandler(action, handler));
  }

  function startClip(): void {
    if (!environment.createAudio || audio) return;
    guard(() => {
      const element = environment.createAudio!();
      if (!clipUrl && typeof URL !== "undefined" && typeof Blob !== "undefined") clipUrl = URL.createObjectURL(new Blob([silentWav() as BlobPart], { type: "audio/wav" }));
      element.loop = true;
      element.preload = "auto";
      element.setAttribute("playsinline", "");
      element.setAttribute("aria-hidden", "true");
      if (clipUrl) element.src = clipUrl;
      audio = element;
    });
    play();
  }

  function play(): void {
    const element = audio;
    if (!element || !active) return;
    let result: Promise<void> | undefined;
    try { result = element.play(); } catch { result = Promise.reject(new Error("play failed")); }
    void Promise.resolve(result).then(() => {
      removeGesture?.();
      removeGesture = null;
    }, () => {
      if (!active || removeGesture || !environment.onGesture) return;
      removeGesture = environment.onGesture(() => play());
    });
  }

  function stopClip(): void {
    removeGesture?.();
    removeGesture = null;
    const element = audio;
    audio = null;
    if (element) {
      guard(() => element.pause());
      guard(() => { element.removeAttribute("src"); element.load(); });
    }
  }

  return {
    update(state) {
      if (disposed) return;
      if (!state) {
        if (!active) return;
        active = false;
        stopClip();
        setHandlers(false);
        if (session) {
          guard(() => { session.metadata = null; });
          guard(() => { session.playbackState = "none"; });
        }
        return;
      }
      const first = !active;
      active = true;
      if (first) { setHandlers(true); startClip(); }
      else if (audio?.paused) play();
      if (!session) return;
      const labels = options.labels();
      if (environment.createMetadata) {
        const artwork = options.artwork ? [{ src: options.artwork, sizes: "512x512", type: "image/png" }] : [];
        guard(() => {
          session.metadata = environment.createMetadata!({
            title: state.channel || state.server || "WebSpeak",
            artist: `${state.microphoneMuted ? labels.microphoneOff : labels.microphoneOn}${state.server && state.channel ? ` · ${state.server}` : ""}`,
            album: "WebSpeak",
            artwork,
          });
        });
      }
      // "Playing" shows the pause button, which mutes; "paused" shows play, which unmutes.
      guard(() => { session.playbackState = state.microphoneMuted ? "paused" : "playing"; });
      if (session.setMicrophoneActive) guard(() => { void Promise.resolve(session.setMicrophoneActive!(!state.microphoneMuted)).catch(() => undefined); });
    },
    dispose() {
      if (disposed) return;
      this.update(null);
      disposed = true;
      if (clipUrl) guard(() => URL.revokeObjectURL(clipUrl));
      clipUrl = "";
    },
  };
}
