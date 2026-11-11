import { reactive } from "vue";
import type { MusicView } from "../../../src/shared/tabletop.js";

const VOLUME_KEY = "webspeak:dnd-music-volume";
const MUTED_KEY = "webspeak:dnd-music-muted";
const FADE_MS = 1200;
const FADE_STEP_MS = 50;

function readNumber(key: string, fallback: number): number {
  try {
    const value = Number(localStorage.getItem(key));
    return localStorage.getItem(key) !== null && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback;
  } catch {
    return fallback;
  }
}

function readFlag(key: string): boolean {
  try { return localStorage.getItem(key) === "1"; } catch { return false; }
}

function write(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* optional */ }
}

interface Playing {
  trackId: string;
  audio: HTMLAudioElement;
  /** 0..1 fade level, multiplied by the listener's volume. */
  level: number;
  timer?: ReturnType<typeof setInterval>;
}

/**
 * The table's background music on this page. The gateway says which track plays
 * and for how long it has played; every page joins it at about the same point,
 * loops it and cross-fades on changes. Volume and mute are per browser.
 */
export class GameMusicPlayer {
  readonly state = reactive({
    volume: readNumber(VOLUME_KEY, 0.35),
    muted: readFlag(MUTED_KEY),
    /** The browser refused to start playback without a click. */
    blocked: false,
  });
  private current: Playing | null = null;
  private readonly leaving = new Set<Playing>();

  /** Follow the table: start, switch or stop. */
  sync(view: MusicView | null): void {
    if (view?.trackId === this.current?.trackId) return;
    if (this.current) this.fadeOut(this.current);
    this.current = null;
    this.state.blocked = false;
    if (!view) return;
    const audio = new Audio(view.url);
    audio.loop = true;
    audio.preload = "auto";
    audio.volume = 0;
    const playing: Playing = { trackId: view.trackId, audio, level: 0 };
    this.current = playing;
    const receivedAt = performance.now();
    audio.addEventListener("loadedmetadata", () => {
      if (this.current !== playing || !Number.isFinite(audio.duration) || audio.duration <= 0) return;
      const elapsed = (view.elapsedMs + performance.now() - receivedAt) / 1000;
      try { audio.currentTime = elapsed % audio.duration; } catch { /* seeking is optional */ }
    }, { once: true });
    this.start(playing);
  }

  /** After a refused autoplay: the click that calls this lets the browser play. */
  resume(): void {
    if (this.current) this.start(this.current);
  }

  setVolume(volume: number): void {
    this.state.volume = Math.max(0, Math.min(1, volume));
    write(VOLUME_KEY, String(this.state.volume));
    this.apply(this.current);
  }

  setMuted(muted: boolean): void {
    this.state.muted = muted;
    write(MUTED_KEY, muted ? "1" : "0");
    this.apply(this.current);
  }

  dispose(): void {
    for (const playing of [...this.leaving, ...(this.current ? [this.current] : [])]) this.stop(playing);
    this.leaving.clear();
    this.current = null;
  }

  private start(playing: Playing): void {
    playing.audio.play().then(() => {
      if (this.current !== playing) return;
      this.state.blocked = false;
      this.fade(playing, 1);
    }, () => {
      if (this.current === playing) this.state.blocked = true;
    });
  }

  private fadeOut(playing: Playing): void {
    this.leaving.add(playing);
    this.fade(playing, 0, () => {
      this.stop(playing);
      this.leaving.delete(playing);
    });
  }

  private fade(playing: Playing, target: number, done?: () => void): void {
    clearInterval(playing.timer);
    const step = FADE_STEP_MS / FADE_MS;
    playing.timer = setInterval(() => {
      playing.level = target > playing.level ? Math.min(target, playing.level + step) : Math.max(target, playing.level - step);
      this.apply(playing);
      if (playing.level === target) {
        clearInterval(playing.timer);
        playing.timer = undefined;
        done?.();
      }
    }, FADE_STEP_MS);
  }

  private apply(playing: Playing | null): void {
    if (!playing) return;
    const listener = this.state.muted ? 0 : this.state.volume;
    // A quadratic curve feels more even than the linear element volume.
    playing.audio.volume = Math.max(0, Math.min(1, listener * listener * playing.level));
  }

  private stop(playing: Playing): void {
    clearInterval(playing.timer);
    try {
      playing.audio.pause();
      playing.audio.removeAttribute("src");
      playing.audio.load();
    } catch { /* already released */ }
  }
}
