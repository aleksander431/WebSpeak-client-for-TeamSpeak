import type { CalibrationDisplay } from "./hdr-calibration.js";

export interface CalibrationOverlay extends CalibrationDisplay {
  /** Aborted when the user presses Escape or leaves fullscreen. */
  readonly signal: AbortSignal;
  close(): void;
}

export interface CalibrationOverlayTexts {
  progress(done: number, total: number): string;
}

/**
 * Full-screen solid grey that the capture can measure.
 *
 * Must be opened directly from a click handler: fullscreen needs the user
 * gesture. The centre half of the screen stays perfectly uniform; the
 * progress text and a small ticker that changes every frame sit in a corner.
 * The ticker keeps the capture producing frames, since screen capture may
 * stop sending frames of a static picture.
 */
export function openCalibrationOverlay(texts: CalibrationOverlayTexts): CalibrationOverlay {
  const controller = new AbortController();
  const overlay = document.createElement("div");
  overlay.setAttribute("role", "status");
  overlay.tabIndex = -1;
  Object.assign(overlay.style, {
    position: "fixed", inset: "0", zIndex: "2147483647", background: "rgb(0, 0, 0)",
    cursor: "none", outline: "none",
  } satisfies Partial<CSSStyleDeclaration>);
  const label = document.createElement("div");
  Object.assign(label.style, {
    position: "absolute", left: "16px", bottom: "14px", display: "flex", alignItems: "center", gap: "10px",
    font: "600 13px/1.3 system-ui, sans-serif", color: "#fff",
  } satisfies Partial<CSSStyleDeclaration>);
  const ticker = document.createElement("span");
  Object.assign(ticker.style, { width: "12px", height: "12px", borderRadius: "2px", background: "#fff" } satisfies Partial<CSSStyleDeclaration>);
  const text = document.createElement("span");
  label.append(ticker, text);
  overlay.append(label);
  document.body.append(overlay);

  let frame = 0, raf = 0, closed = false;
  const tick = () => {
    frame++;
    ticker.style.opacity = frame % 2 ? "1" : "0.35";
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);

  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape") { event.preventDefault(); controller.abort(); }
  };
  const onFullscreenChange = () => {
    // Escape in fullscreen is consumed by the browser to leave fullscreen.
    if (!document.fullscreenElement) controller.abort();
  };
  window.addEventListener("keydown", onKey, true);
  let fullscreenRequested = false;
  try {
    const request = overlay.requestFullscreen?.({ navigationUI: "hide" });
    if (request) {
      fullscreenRequested = true;
      void request.then(
        () => document.addEventListener("fullscreenchange", onFullscreenChange),
        () => undefined, // the viewport-sized overlay still works when the page fills the shared surface
      );
    }
  } catch { /* fullscreen unavailable */ }
  overlay.focus({ preventScroll: true });

  const nextPaint = () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

  return {
    signal: controller.signal,
    async show(level: number) {
      const value = Math.max(0, Math.min(255, Math.round(level)));
      overlay.style.background = `rgb(${value}, ${value}, ${value})`;
      const contrast = value > 140 ? "#000" : "#fff";
      label.style.color = contrast;
      ticker.style.background = contrast;
      await nextPaint();
    },
    setProgress(done: number, total: number) {
      text.textContent = texts.progress(done, total);
    },
    close() {
      if (closed) return;
      closed = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onKey, true);
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      if (fullscreenRequested && document.fullscreenElement === overlay) void document.exitFullscreen().catch(() => undefined);
      overlay.remove();
    },
  };
}
