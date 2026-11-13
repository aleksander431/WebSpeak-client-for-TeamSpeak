import type { WatchMedia } from "../../../src/shared/watch-together.js";

/*
 * One interface over the two kinds of player: the YouTube embed (driven
 * through its IFrame API) and a plain <video> for direct files. The page
 * drives either from the shared state; nothing here sends anything.
 */

export interface MediaPlayerEvents {
  /** Title and length once known (YouTube: from the player; files: the file name). */
  onMeta(title: string, duration: number): void;
  /** The browser refused to start playback without a click. */
  onBlocked(): void;
  onError(code: string): void;
  /** Played to the end. */
  onEnded(): void;
}

export interface MediaPlayer {
  play(): void;
  pause(): void;
  seek(seconds: number): void;
  currentTime(): number;
  duration(): number;
  playing(): boolean;
  buffering(): boolean;
  setVolume(volume: number, muted: boolean): void;
  destroy(): void;
}

// ---- YouTube ----

interface YtPlayer {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  setVolume(volume: number): void;
  mute(): void;
  unMute(): void;
  getVideoData?(): { title?: string };
  destroy(): void;
}
interface YtNamespace {
  Player: new (element: HTMLElement, options: { events: Record<string, (event: { data: number; target: YtPlayer }) => void> }) => YtPlayer;
}
declare global {
  interface Window { YT?: YtNamespace; onYouTubeIframeAPIReady?: () => void }
}

let apiLoading: Promise<YtNamespace> | null = null;

/** The IFrame API script, loaded once per page. */
export function loadYouTubeApi(): Promise<YtNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (apiLoading) return apiLoading;
  apiLoading = new Promise<YtNamespace>((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      if (window.YT) resolve(window.YT);
    };
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    script.onerror = () => { apiLoading = null; script.remove(); reject(new Error("WATCH_YOUTUBE_UNAVAILABLE")); };
    document.head.append(script);
  });
  return apiLoading;
}

const YT_PLAYING = 1;
const YT_PAUSED = 2;
const YT_BUFFERING = 3;
const YT_UNSTARTED = -1;
const YT_CUED = 5;
const YT_ENDED = 0;

async function youtubePlayer(host: HTMLElement, id: string, start: number, events: MediaPlayerEvents): Promise<MediaPlayer> {
  const api = await loadYouTubeApi();
  const frame = document.createElement("iframe");
  const params = new URLSearchParams({
    enablejsapi: "1", controls: "0", disablekb: "1", rel: "0", playsinline: "1", iv_load_policy: "3", fs: "0",
    modestbranding: "1", origin: location.origin, start: String(Math.floor(start)),
  });
  frame.src = `https://www.youtube.com/embed/${id}?${params}`;
  // The page's own policy sends no referrer to other sites, and YouTube refuses embeds without one.
  frame.referrerPolicy = "strict-origin-when-cross-origin";
  frame.allow = "autoplay; encrypted-media; picture-in-picture";
  frame.title = "YouTube";
  host.replaceChildren(frame);
  let player: YtPlayer | null = null;
  let state = YT_UNSTARTED;
  let wantPlay = false;
  let playAskedAt = 0;
  let volume = { level: 1, muted: false };
  let metaSent = false;
  const ready = new Promise<void>(resolve => {
    new api.Player(frame, {
      events: {
        onReady: event => { player = event.target; applyVolume(); resolve(); },
        onStateChange: event => {
          state = event.data;
          if (state === YT_ENDED) { wantPlay = false; events.onEnded(); }
          if (state === YT_PLAYING && !metaSent && player) {
            metaSent = true;
            events.onMeta(player.getVideoData?.().title ?? "", player.getDuration() || 0);
          }
        },
        onError: event => events.onError(event.data === 101 || event.data === 150 ? "WATCH_EMBED_FORBIDDEN" : "WATCH_VIDEO_UNAVAILABLE"),
      },
    });
  });
  function applyVolume(): void {
    if (!player) return;
    player.setVolume(Math.round(volume.level * 100));
    if (volume.muted) player.mute(); else player.unMute();
  }
  // A play request that leaves the player unstarted or paused was refused (no click yet).
  const watchdog = setInterval(() => {
    if (wantPlay && player && performance.now() - playAskedAt > 2500 && (state === YT_UNSTARTED || state === YT_CUED || state === YT_PAUSED)) {
      wantPlay = false;
      events.onBlocked();
    }
  }, 500);
  await ready;
  return {
    play() { if (!player) return; wantPlay = true; playAskedAt = performance.now(); player.playVideo(); },
    pause() { wantPlay = false; player?.pauseVideo(); },
    seek(seconds) { player?.seekTo(seconds, true); },
    currentTime: () => player?.getCurrentTime() ?? 0,
    duration: () => player?.getDuration() ?? 0,
    playing: () => state === YT_PLAYING,
    buffering: () => state === YT_BUFFERING,
    setVolume(level, muted) { volume = { level, muted }; applyVolume(); },
    destroy() {
      clearInterval(watchdog);
      try { player?.destroy(); } catch { /* the frame is going away anyway */ }
      host.replaceChildren();
    },
  };
}

// ---- Direct video files ----

function filePlayer(host: HTMLElement, url: string, start: number, events: MediaPlayerEvents): MediaPlayer {
  const video = document.createElement("video");
  video.playsInline = true;
  video.preload = "auto";
  video.src = url;
  host.replaceChildren(video);
  let waiting = false;
  video.addEventListener("waiting", () => { waiting = true; });
  video.addEventListener("playing", () => { waiting = false; });
  video.addEventListener("canplay", () => { waiting = false; });
  video.addEventListener("loadedmetadata", () => {
    if (start > 0) video.currentTime = start;
    const name = decodeURIComponent(new URL(url, location.href).pathname.split("/").pop() ?? "");
    events.onMeta(/\.[a-z0-9]{2,4}$/i.test(name) ? name : "", Number.isFinite(video.duration) ? video.duration : 0);
  }, { once: true });
  video.addEventListener("error", () => events.onError("WATCH_VIDEO_UNAVAILABLE"));
  video.addEventListener("ended", () => events.onEnded());
  return {
    play() {
      video.play().catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "NotAllowedError") events.onBlocked();
      });
    },
    pause() { video.pause(); },
    seek(seconds) { video.currentTime = seconds; },
    currentTime: () => video.currentTime,
    duration: () => Number.isFinite(video.duration) ? video.duration : 0,
    playing: () => !video.paused && !video.ended,
    buffering: () => waiting || video.seeking,
    setVolume(level, muted) { video.volume = level; video.muted = muted; },
    destroy() {
      video.pause();
      video.removeAttribute("src");
      video.load();
      host.replaceChildren();
    },
  };
}

export async function createMediaPlayer(host: HTMLElement, media: WatchMedia, start: number, events: MediaPlayerEvents): Promise<MediaPlayer> {
  return media.kind === "youtube" ? youtubePlayer(host, media.id, start, events) : filePlayer(host, media.url, start, events);
}
