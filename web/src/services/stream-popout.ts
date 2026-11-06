/**
 * Detach a screen-share stream into its own always-on-top window.
 *
 * Chromium (and the desktop client) offer Document Picture-in-Picture: a real,
 * resizable window we fill with our own video. Elsewhere the browser's video
 * Picture-in-Picture of the page's own <video> is used. Browsers allow one such
 * window per page, so opening another replaces the first.
 */

export interface StreamPopOut {
  readonly mode: "window" | "video";
  close(): void;
}

interface DocumentPictureInPictureApi {
  requestWindow(options?: { width?: number; height?: number }): Promise<Window>;
  readonly window: Window | null;
}

export interface StreamPopOutEnvironment {
  documentPictureInPicture?: DocumentPictureInPictureApi;
  /** document.pictureInPictureEnabled */
  videoPictureInPicture: boolean;
  exitVideoPictureInPicture(): Promise<void>;
  videoInPictureInPicture(): Element | null;
}

export function browserStreamPopOutEnvironment(): StreamPopOutEnvironment {
  const scope = typeof window === "undefined" ? undefined : window as Window & { documentPictureInPicture?: DocumentPictureInPictureApi; webspeakDesktop?: unknown };
  const doc = typeof document === "undefined" ? undefined : document;
  // The desktop shell exposes Document Picture-in-Picture but refuses its
  // window ("no window"), and by then the click no longer counts for the
  // fallback. Its video Picture-in-Picture works, so use that directly.
  const documentWindows = scope?.documentPictureInPicture && !scope.webspeakDesktop ? scope.documentPictureInPicture : undefined;
  return {
    ...(documentWindows ? { documentPictureInPicture: documentWindows } : {}),
    videoPictureInPicture: Boolean(doc && "pictureInPictureEnabled" in doc && doc.pictureInPictureEnabled),
    exitVideoPictureInPicture: () => doc?.exitPictureInPicture ? doc.exitPictureInPicture() : Promise.resolve(),
    videoInPictureInPicture: () => doc?.pictureInPictureElement ?? null,
  };
}

export function canPopOutStreams(environment: StreamPopOutEnvironment = browserStreamPopOutEnvironment()): boolean {
  return Boolean(environment.documentPictureInPicture) || environment.videoPictureInPicture;
}

export interface PopOutRequest {
  media: MediaStream;
  title: string;
  /** The page's own video for this stream, for browsers without window Picture-in-Picture. */
  pageVideo: HTMLVideoElement | null;
  /** Called once when the window goes away, however it was closed. */
  onClosed: () => void;
}

/** Must be called from a click: browsers only open these windows on a user gesture. */
export async function popOutStream(request: PopOutRequest, environment: StreamPopOutEnvironment = browserStreamPopOutEnvironment()): Promise<StreamPopOut | null> {
  let closed = false;
  const finish = () => { if (!closed) { closed = true; request.onClosed(); } };

  if (environment.documentPictureInPicture) {
    const size = videoSize(request.media);
    let pip: Window | null = null;
    try {
      pip = await environment.documentPictureInPicture.requestWindow({ width: size.width, height: size.height });
    } catch {
      // A refused window can still try video Picture-in-Picture, though the
      // browser may no longer accept it without a fresh click.
      pip = null;
    }
    if (pip) {
      const window = pip;
      fillWindow(window, request);
      window.addEventListener("pagehide", finish, { once: true });
      return {
        mode: "window",
        close() {
          finish();
          try { window.close(); } catch { /* already gone */ }
        },
      };
    }
  }

  const video = request.pageVideo;
  if (environment.videoPictureInPicture && video && typeof video.requestPictureInPicture === "function") {
    await video.requestPictureInPicture();
    video.addEventListener("leavepictureinpicture", finish, { once: true });
    return {
      mode: "video",
      close() {
        finish();
        if (environment.videoInPictureInPicture() === video) void environment.exitVideoPictureInPicture().catch(() => undefined);
      },
    };
  }
  return null;
}

/** Open at a comfortable size with the stream's own proportions. */
function videoSize(media: MediaStream): { width: number; height: number } {
  const settings = media.getVideoTracks()[0]?.getSettings?.() ?? {};
  const ratio = settings.width && settings.height ? settings.width / settings.height : 16 / 9;
  const width = 640;
  return { width, height: Math.round(width / Math.max(0.5, Math.min(3, ratio))) };
}

function fillWindow(pip: Window, request: PopOutRequest): void {
  const doc = pip.document;
  doc.title = request.title;
  const style = doc.createElement("style");
  style.textContent = `
    html, body { margin: 0; height: 100%; background: #000; overflow: hidden; font-family: system-ui, sans-serif; }
    video { position: fixed; inset: 0; width: 100%; height: 100%; object-fit: contain; background: #000; }
    .name { position: fixed; left: 8px; bottom: 8px; padding: 3px 8px; border-radius: 6px; color: #f2f4f5; background: #000000a8; font-size: 12px; font-weight: 600; opacity: 0; transition: opacity .15s; }
    body:hover .name { opacity: 1; }
  `;
  doc.head.append(style);
  const video = doc.createElement("video");
  video.autoplay = true;
  video.playsInline = true;
  // Sound keeps coming from the page, where its volume control is.
  video.muted = true;
  video.srcObject = request.media;
  const name = doc.createElement("span");
  name.className = "name";
  name.textContent = request.title;
  doc.body.append(video, name);
  void video.play().catch(() => undefined);
}
