import assert from "node:assert/strict";
import test from "node:test";
import {
  CALIBRATION_LEVELS, HdrCalibrationError, buildCalibrationCurve, parseHdrCalibration, runHdrCalibration,
  type CalibrationDisplay, type FrameSample, type FrameSampler,
} from "./hdr-calibration.js";

/**
 * A washed-out HDR capture like the one reported: shadows lifted, mid-tones
 * brightened, and everything above ~86% of white flattened into white.
 */
function washedOut(level: number): number {
  const x = level / 255;
  return Math.min(255, Math.round(255 * (0.06 + 0.94 * x ** 0.55) * 1.12));
}

function points(capture: (level: number) => number, tint = 0) {
  return CALIBRATION_LEVELS.map((level) => ({ level, r: Math.min(255, capture(level) + tint), g: capture(level), b: Math.max(0, capture(level) - tint) }));
}

test("the curve undoes a washed-out capture for every level that survived it", () => {
  const curve = buildCalibrationCurve(points(washedOut));
  for (let level = 0; level <= 255; level += 5) {
    const captured = washedOut(level);
    if (captured >= 255) continue; // flattened into white: not recoverable
    assert.ok(Math.abs(curve.g[captured]! - level) <= 6, `level ${level}: captured ${captured} -> ${curve.g[captured]}`);
  }
});

test("light greys that differ on screen differ again after correction", () => {
  // The reported problem: light-grey labels on a white panel became invisible.
  const curve = buildCalibrationCurve(points(washedOut));
  const capturedGap = washedOut(180) - washedOut(150);
  const correctedGap = curve.g[washedOut(180)]! - curve.g[washedOut(150)]!;
  assert.ok(capturedGap <= 21, `captured, they are close: ${capturedGap}`);
  assert.ok(correctedGap >= 26, `after correction the contrast is back: ${correctedGap}`);
});

test("the clip level tells where the capture starts losing light shades", () => {
  const curve = buildCalibrationCurve(points(washedOut));
  const firstWhite = CALIBRATION_LEVELS.find((level) => washedOut(level) >= 253)!;
  assert.equal(curve.clipLevel, firstWhite);
  const clean = buildCalibrationCurve(points((level) => level));
  assert.equal(clean.clipLevel, 255, "an accurate capture loses nothing");
  assert.ok(Array.from(clean.g).every((value, index) => Math.abs(value - index) <= 1), "and needs no correction");
});

test("each channel is corrected separately, removing a colour tint", () => {
  const curve = buildCalibrationCurve(points((level) => Math.round(30 + level * 0.8), 10));
  const level = 128, captured = Math.round(30 + level * 0.8);
  assert.ok(Math.abs(curve.r[captured + 10]! - level) <= 2);
  assert.ok(Math.abs(curve.b[captured - 10]! - level) <= 2);
});

test("noise that makes the measurement step backwards is ignored", () => {
  const noisy = points(washedOut);
  noisy[8] = { ...noisy[8]!, g: noisy[7]!.g - 3 };
  const curve = buildCalibrationCurve(noisy);
  for (let value = 1; value < 256; value++) assert.ok(curve.g[value]! >= curve.g[value - 1]!, "monotonic");
});

test("a capture that never showed the overlay is rejected", () => {
  assert.throws(() => buildCalibrationCurve(points(() => 120)), (error: unknown) => error instanceof HdrCalibrationError && error.code === "NOT_VISIBLE");
});

test("stored calibrations are validated before use", () => {
  const curve = buildCalibrationCurve(points(washedOut), "2026-10-30T00:00:00.000Z");
  const restored = parseHdrCalibration(JSON.parse(JSON.stringify({ ...curve, r: Array.from(curve.r), g: Array.from(curve.g), b: Array.from(curve.b) })));
  assert.deepEqual(restored && Array.from(restored.g), Array.from(curve.g));
  assert.equal(parseHdrCalibration({ ...restored, g: [1, 2, 3] }), null);
  assert.equal(parseHdrCalibration({ ...restored, version: 2 }), null);
  assert.equal(parseHdrCalibration("garbage"), null);
});

/** Simulated screen + capture: the captured frame shows the level painted `latencyMs` earlier. */
function rig(options: { latencyMs?: number; spread?: number; frameIntervalMs?: number; dropFramesAfter?: number } = {}) {
  let clock = 0, painted = 0, frames = 0;
  const history: Array<{ at: number; level: number }> = [{ at: -1_000, level: 0 }];
  const latency = options.latencyMs ?? 60, interval = options.frameIntervalMs ?? 16;
  const display: CalibrationDisplay & { shown: number[] } = {
    shown: [],
    async show(level) { this.shown.push(level); clock += 16; history.push({ at: clock, level }); painted++; },
  };
  const sampler: FrameSampler = {
    async next(after, timeoutMs) {
      const deadline = clock + timeoutMs;
      while (clock < deadline) {
        clock += interval;
        frames++;
        if (options.dropFramesAfter !== undefined && frames > options.dropFramesAfter) continue;
        if (clock <= after) continue;
        const visible = [...history].reverse().find((entry) => entry.at <= clock - latency)!;
        const value = washedOut(visible.level);
        const sample: FrameSample = { r: value, g: value, b: value, spread: options.spread ?? 2, at: clock };
        return sample;
      }
      return null;
    },
    dispose() {},
  };
  return { display, sampler, now: () => clock, painted: () => painted };
}

test("a full run waits out capture latency and reproduces the expected curve", async () => {
  const { display, sampler, now } = rig({ latencyMs: 90 });
  const result = await runHdrCalibration({ display, sampler, now });
  assert.deepEqual(display.shown, [...CALIBRATION_LEVELS]);
  const reference = buildCalibrationCurve(points(washedOut));
  assert.deepEqual(Array.from(result.g), Array.from(reference.g), "latency did not mix up neighbouring levels");
});

test("text or a window over the sampled area makes the run fail clearly", async () => {
  const { display, sampler, now } = rig({ spread: 80 });
  await assert.rejects(runHdrCalibration({ display, sampler, now }), (error: unknown) => error instanceof HdrCalibrationError && error.code === "NOT_VISIBLE");
});

test("no captured frames and cancellation are reported, not hung on", async () => {
  const silent = rig({ dropFramesAfter: 0 });
  await assert.rejects(runHdrCalibration({ display: silent.display, sampler: silent.sampler, now: silent.now }), (error: unknown) => error instanceof HdrCalibrationError && error.code === "NO_FRAMES");

  const controller = new AbortController();
  const cancelled = rig();
  const display = { ...cancelled.display, shown: [] as number[], async show(level: number) { if (level === 64) controller.abort(); return cancelled.display.show(level); } };
  await assert.rejects(runHdrCalibration({ display, sampler: cancelled.sampler, now: cancelled.now, signal: controller.signal }), (error: unknown) => error instanceof HdrCalibrationError && error.code === "CANCELLED");
});
