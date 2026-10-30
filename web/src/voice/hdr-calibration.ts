/**
 * Measured HDR correction for screen sharing.
 *
 * The manual curve in hdr-correction.ts is a guess. Here the sharer's own
 * capture is measured instead: the page shows a sequence of known grey levels
 * full-screen, the raw captured frames are read back, and the inverse of what
 * the capture did is built per colour channel. Applying that inverse makes the
 * viewer see the levels the page actually painted.
 *
 * Levels that the capture already flattened into white cannot be told apart
 * afterwards; `clipLevel` reports where that starts so the UI can suggest
 * lowering Windows' "SDR content brightness".
 */

/** Per-channel lookup tables: index = captured value (0..255), value = corrected value. */
export interface HdrCalibrationCurve {
  r: ArrayLike<number>;
  g: ArrayLike<number>;
  b: ArrayLike<number>;
}

export interface HdrCalibrationResult extends HdrCalibrationCurve {
  version: 1;
  /** First painted level (0..255) that already comes out as the capture's maximum. */
  clipLevel: number;
  createdAt: string;
}

export interface CalibrationPoint {
  level: number;
  r: number;
  g: number;
  b: number;
}

export type HdrCalibrationErrorCode = "NOT_VISIBLE" | "NO_FRAMES" | "UNSTABLE" | "CANCELLED" | "UNSUPPORTED";

export class HdrCalibrationError extends Error {
  constructor(readonly code: HdrCalibrationErrorCode) {
    super(code);
    this.name = "HdrCalibrationError";
  }
}

/** Painted grey levels, denser near white where HDR capture loses detail. */
export const CALIBRATION_LEVELS: readonly number[] = [
  0, 8, 16, 32, 48, 64, 80, 96, 112, 128, 144, 160, 176, 192,
  200, 208, 216, 224, 232, 240, 248, 255,
];
/** Wait after a level is painted before trusting a captured frame. */
export const CALIBRATION_SETTLE_MS = 120;
/** Give up on a level if no usable frame arrives within this time. */
export const CALIBRATION_FRAME_TIMEOUT_MS = 1_500;
/** Two consecutive frames must agree this closely (0..255) to accept a level. */
const STABLE_TOLERANCE = 4;
/** A uniform screen varies less than this across the sampled centre region. */
export const MAX_UNIFORM_SPREAD = 24;
/** Black and white must differ at least this much, or the overlay was not captured. */
const MIN_CAPTURED_RANGE = 64;
const MAX_STABILITY_ATTEMPTS = 6;

export interface FrameSample {
  r: number;
  g: number;
  b: number;
  /** Max minus min luma over the sampled region; large when the region is not uniform. */
  spread: number;
  /** Arrival time of the frame (same clock as `now`). */
  at: number;
}

export interface FrameSampler {
  /** The first sample from a frame that arrived after `after`, or null on timeout. */
  next(after: number, timeoutMs: number): Promise<FrameSample | null>;
  dispose(): void;
}

export interface CalibrationDisplay {
  /** Paint the level full-screen; resolves once it has been painted. */
  show(level: number): Promise<void>;
  setProgress?(done: number, total: number): void;
}

const luma = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** Measure every level and build the correction curve. */
export async function runHdrCalibration(options: {
  sampler: FrameSampler;
  display: CalibrationDisplay;
  now(): number;
  signal?: AbortSignal;
  levels?: readonly number[];
  settleMs?: number;
  timeoutMs?: number;
}): Promise<HdrCalibrationResult> {
  const levels = options.levels ?? CALIBRATION_LEVELS;
  const settleMs = options.settleMs ?? CALIBRATION_SETTLE_MS;
  const timeoutMs = options.timeoutMs ?? CALIBRATION_FRAME_TIMEOUT_MS;
  const points: CalibrationPoint[] = [];
  const checkCancelled = () => { if (options.signal?.aborted) throw new HdrCalibrationError("CANCELLED"); };
  for (const [index, level] of levels.entries()) {
    checkCancelled();
    options.display.setProgress?.(index, levels.length);
    await options.display.show(level);
    checkCancelled();
    const paintedAt = options.now();
    let previous = await options.sampler.next(paintedAt + settleMs, timeoutMs);
    checkCancelled();
    if (!previous) throw new HdrCalibrationError("NO_FRAMES");
    let accepted: FrameSample | null = null;
    for (let attempt = 0; attempt < MAX_STABILITY_ATTEMPTS; attempt++) {
      const current = await options.sampler.next(previous.at, timeoutMs);
      checkCancelled();
      if (!current) {
        // A static screen may stop producing frames; one settled frame is enough then.
        accepted = previous;
        break;
      }
      if (Math.abs(luma(current.r, current.g, current.b) - luma(previous.r, previous.g, previous.b)) <= STABLE_TOLERANCE) {
        accepted = current;
        break;
      }
      previous = current;
    }
    if (!accepted) throw new HdrCalibrationError("UNSTABLE");
    // Text, windows or the cursor in the sampled area mean the overlay is not what was captured.
    if (accepted.spread > MAX_UNIFORM_SPREAD) throw new HdrCalibrationError("NOT_VISIBLE");
    points.push({ level, r: accepted.r, g: accepted.g, b: accepted.b });
  }
  options.display.setProgress?.(levels.length, levels.length);
  return buildCalibrationCurve(points);
}

/**
 * Invert the measured mapping (painted level -> captured value) into a lookup
 * table (captured value -> painted level) for each channel.
 */
export function buildCalibrationCurve(points: readonly CalibrationPoint[], createdAt = new Date().toISOString()): HdrCalibrationResult {
  const sorted = [...points].sort((left, right) => left.level - right.level);
  if (sorted.length < 4) throw new HdrCalibrationError("NOT_VISIBLE");
  const first = sorted[0]!, last = sorted.at(-1)!;
  if (luma(last.r, last.g, last.b) - luma(first.r, first.g, first.b) < MIN_CAPTURED_RANGE) {
    throw new HdrCalibrationError("NOT_VISIBLE");
  }
  const channel = (key: "r" | "g" | "b") => invert(sorted.map((point) => point.level), sorted.map((point) => point[key]));
  // Where the capture stops getting brighter: everything from here up looks the same.
  const capturedLuma = monotonic(sorted.map((point) => luma(point.r, point.g, point.b)));
  const maxLuma = capturedLuma.at(-1)!;
  const clipIndex = capturedLuma.findIndex((value) => value >= maxLuma - 2);
  return {
    version: 1,
    r: channel("r"),
    g: channel("g"),
    b: channel("b"),
    clipLevel: sorted[Math.max(0, clipIndex)]!.level,
    createdAt,
  };
}

/** Running maximum, so measurement noise cannot make the curve go backwards. */
function monotonic(values: readonly number[]): number[] {
  let running = -Infinity;
  return values.map((value) => (running = Math.max(running, value)));
}

function invert(levels: readonly number[], measured: readonly number[]): number[] {
  const captured = monotonic(measured);
  const table: number[] = new Array(256);
  for (let value = 0; value < 256; value++) {
    if (value <= captured[0]!) { table[value] = levels[0]!; continue; }
    if (value >= captured.at(-1)!) {
      // At or above the brightest captured value: the first level that reached it.
      const index = captured.findIndex((candidate) => candidate >= captured.at(-1)! - 1e-9);
      table[value] = levels[index]!;
      continue;
    }
    let mapped = levels.at(-1)!;
    for (let index = 0; index < captured.length - 1; index++) {
      const low = captured[index]!, high = captured[index + 1]!;
      if (high <= low || value < low || value > high) continue;
      const fraction = (value - low) / (high - low);
      mapped = levels[index]! + fraction * (levels[index + 1]! - levels[index]!);
      break;
    }
    table[value] = mapped;
  }
  return table.map((value) => Math.max(0, Math.min(255, Math.round(value))));
}

/** Validate a calibration read back from storage. */
export function parseHdrCalibration(value: unknown): HdrCalibrationResult | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const table = (input: unknown) => Array.isArray(input) && input.length === 256
    && input.every((entry) => typeof entry === "number" && Number.isInteger(entry) && entry >= 0 && entry <= 255) ? input as number[] : null;
  const r = table(record.r), g = table(record.g), b = table(record.b);
  if (record.version !== 1 || !r || !g || !b) return null;
  const clipLevel = typeof record.clipLevel === "number" && record.clipLevel >= 0 && record.clipLevel <= 255 ? record.clipLevel : 255;
  return { version: 1, r, g, b, clipLevel, createdAt: typeof record.createdAt === "string" ? record.createdAt : "" };
}

type TrackProcessorConstructor = new (init: { track: MediaStreamTrack; maxBufferSize?: number }) => { readable: ReadableStream<VideoFrame> };

/** Small sampling canvas: the frame is averaged down, then the centre half is read. */
const SAMPLE_WIDTH = 32;
const SAMPLE_HEIGHT = 18;

/**
 * Reads raw frames from a clone of the captured track (so the HDR correction
 * itself never feeds back into the measurement) and averages the centre of
 * each frame on request.
 */
export function createFrameSampler(source: MediaStreamTrack, now: () => number = () => performance.now()): FrameSampler {
  const Processor = (globalThis as Record<string, unknown>).MediaStreamTrackProcessor as TrackProcessorConstructor | undefined;
  if (typeof Processor !== "function" || typeof OffscreenCanvas !== "function") throw new HdrCalibrationError("UNSUPPORTED");
  const track = source.clone();
  const reader = new Processor({ track, maxBufferSize: 1 }).readable.getReader();
  const canvas = new OffscreenCanvas(SAMPLE_WIDTH, SAMPLE_HEIGHT);
  const context = canvas.getContext("2d", { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D | null;
  if (!context) { track.stop(); throw new HdrCalibrationError("UNSUPPORTED"); }
  const waiters = new Set<{ after: number; resolve(sample: FrameSample | null): void; timer: ReturnType<typeof setTimeout> }>();
  let disposed = false;

  function measure(frame: VideoFrame, at: number): FrameSample {
    context!.drawImage(frame as unknown as CanvasImageSource, 0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT);
    const x0 = SAMPLE_WIDTH / 4, y0 = SAMPLE_HEIGHT / 4;
    const data = context!.getImageData(x0, y0, SAMPLE_WIDTH / 2, SAMPLE_HEIGHT / 2).data;
    let r = 0, g = 0, b = 0, min = Infinity, max = -Infinity;
    const pixels = data.length / 4;
    for (let offset = 0; offset < data.length; offset += 4) {
      const pr = data[offset]!, pg = data[offset + 1]!, pb = data[offset + 2]!;
      r += pr; g += pg; b += pb;
      const value = luma(pr, pg, pb);
      min = Math.min(min, value); max = Math.max(max, value);
    }
    return { r: r / pixels, g: g / pixels, b: b / pixels, spread: max - min, at };
  }

  void (async () => {
    try {
      while (!disposed) {
        const { value: frame, done } = await reader.read();
        if (done || !frame) break;
        const at = now();
        const due = [...waiters].filter((waiter) => at > waiter.after);
        if (due.length) {
          let sample: FrameSample | null = null;
          try { sample = measure(frame, at); } catch { sample = null; }
          for (const waiter of due) {
            waiters.delete(waiter);
            clearTimeout(waiter.timer);
            waiter.resolve(sample);
          }
        }
        frame.close();
      }
    } catch {
      // The clone ended or the reader was cancelled; pending waiters time out.
    }
  })();

  return {
    next(after, timeoutMs) {
      if (disposed) return Promise.resolve(null);
      return new Promise((resolve) => {
        const waiter = {
          after,
          resolve,
          timer: setTimeout(() => { waiters.delete(waiter); resolve(null); }, timeoutMs),
        };
        waiters.add(waiter);
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const waiter of waiters) { clearTimeout(waiter.timer); waiter.resolve(null); }
      waiters.clear();
      void reader.cancel().catch(() => undefined);
      try { track.stop(); } catch { /* already stopped */ }
    },
  };
}
