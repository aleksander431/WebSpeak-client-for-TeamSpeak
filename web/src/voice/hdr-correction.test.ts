import assert from "node:assert/strict";
import test from "node:test";
import { buildCorrectionLut, correctChannel, createHdrCorrection, isHdrCorrectionSupported } from "./hdr-correction.js";

interface FakeFrame { id: string; timestamp: number; duration: number | null; displayWidth: number; displayHeight: number; closed: boolean; close(): void }

function frame(id: string, timestamp: number): FakeFrame {
  return { id, timestamp, duration: 16_666, displayWidth: 1920, displayHeight: 1080, closed: false, close() { this.closed = true; } };
}

/** Fake MediaStreamTrackProcessor/Generator: frames are pushed by the test, written frames collected. */
function environment() {
  let push!: (value: FakeFrame) => void;
  let end!: () => void;
  const written: FakeFrame[] = [];
  const state = { generatorStopped: false, writerClosed: false, readerCancelled: false, rendered: 0, failures: 0 };
  class Processor {
    readable = new ReadableStream<FakeFrame>({
      start(controller) { push = value => controller.enqueue(value); end = () => controller.close(); },
      cancel() { state.readerCancelled = true; },
    });
  }
  class Generator {
    kind = "video";
    writable = new WritableStream<FakeFrame>({
      write(value) { written.push(value); },
      close() { state.writerClosed = true; },
    });
    stop() { state.generatorStopped = true; }
  }
  const env = {
    Processor: Processor as never,
    Generator: Generator as never,
    createCanvas: () => ({}) as OffscreenCanvas,
    createFrame: (_canvas: OffscreenCanvas, init: VideoFrameInit) => frame("corrected", init.timestamp!) as unknown as VideoFrame,
  };
  return { env, written, state, push: (value: FakeFrame) => push(value), end: () => end() };
}

const tick = () => new Promise(resolve => setTimeout(resolve, 5));
const source = {} as MediaStreamTrack;

test("strength 0 passes frames through untouched without using the GPU", async () => {
  const fake = environment();
  const correction = createHdrCorrection(source, 0, { environment: fake.env, renderer: () => { throw new Error("must not render"); } });
  const original = frame("a", 100);
  fake.push(original);
  await tick();
  assert.equal(fake.written[0], original);
  assert.equal(original.closed, false, "ownership moves to the generator");
  correction.dispose();
});

test("corrected frames keep the capture timestamp and release the original", async () => {
  const fake = environment();
  const correction = createHdrCorrection(source, 0.5, {
    environment: fake.env,
    renderer: () => ({ render: (_frame, lut) => { assert.equal(lut[128 * 4], Math.round(correctChannel(128 / 255, 0.5) * 255)); fake.state.rendered++; }, dispose() {} }),
  });
  const original = frame("a", 4242);
  fake.push(original);
  await tick();
  assert.equal(fake.state.rendered, 1);
  assert.equal(fake.written[0]!.id, "corrected");
  assert.equal(fake.written[0]!.timestamp, 4242);
  assert.equal(original.closed, true);
  correction.setStrength(0);
  fake.push(frame("b", 5000));
  await tick();
  assert.equal(fake.written[1]!.id, "b", "turning the slider to 0 stops processing live");
  correction.dispose();
});

test("a GPU failure keeps the share running with the original picture", async () => {
  const fake = environment();
  const correction = createHdrCorrection(source, 1, {
    environment: fake.env,
    renderer: () => ({ render() { throw new Error("context lost"); }, dispose() {} }),
    onFailure: () => { fake.state.failures++; },
  });
  fake.push(frame("a", 1));
  fake.push(frame("b", 2));
  await tick();
  assert.deepEqual(fake.written.map(item => item.id), ["a", "b"]);
  assert.equal(fake.state.failures, 1, "reported once");
  correction.dispose();
});

test("dispose stops the corrected track and the source ending closes it", async () => {
  const fake = environment();
  const correction = createHdrCorrection(source, 0.5, { environment: fake.env, renderer: () => ({ render() {}, dispose() {} }) });
  correction.dispose();
  correction.dispose();
  await tick();
  assert.equal(fake.state.generatorStopped, true);
  assert.equal(fake.state.readerCancelled, true);

  const other = environment();
  createHdrCorrection(source, 0.5, { environment: other.env, renderer: () => ({ render() {}, dispose() {} }) });
  other.end();
  await tick();
  assert.equal(other.state.writerClosed, true);
});

test("strength is clamped and unsupported browsers are detected", () => {
  const fake = environment();
  const correction = createHdrCorrection(source, 5, { environment: fake.env });
  assert.equal(correction.strength, 1);
  correction.setStrength(-1);
  assert.equal(correction.strength, 0);
  correction.dispose();
  assert.equal(isHdrCorrectionSupported(), false, "Node has no MediaStreamTrackProcessor");
  assert.throws(() => createHdrCorrection(source, 0.5), /HDR_CORRECTION_UNSUPPORTED/);
});

test("the curve deepens washed-out mid-tones but keeps black and white", () => {
  assert.equal(correctChannel(0, 1), 0);
  assert.ok(Math.abs(correctChannel(1, 1) - 1) < 1e-9);
  assert.ok(correctChannel(0.5, 0.5) < 0.5);
  assert.ok(correctChannel(0.5, 1) < correctChannel(0.5, 0.5));
  assert.ok(Math.abs(correctChannel(0.5, 0) - 0.5) < 1e-9);
});

test("the lookup table follows the manual curve or blends in a calibration", () => {
  const manual = buildCorrectionLut(0.5, null);
  assert.equal(manual[200 * 4], Math.round(correctChannel(200 / 255, 0.5) * 255));
  assert.equal(manual[3], 255);
  const inverse = Array.from({ length: 256 }, (_, value) => Math.max(0, value - 60));
  const calibrated = buildCorrectionLut(1, { r: inverse, g: inverse, b: inverse });
  assert.equal(calibrated[200 * 4 + 1], 140);
  const half = buildCorrectionLut(0.5, { r: inverse, g: inverse, b: inverse });
  assert.equal(half[200 * 4 + 2], 170, "strength blends between the original and the calibration");
});

test("switching calibration on a running correction rebuilds the table it renders with", async () => {
  const fake = environment();
  const seen: number[] = [];
  const correction = createHdrCorrection(source, 1, {
    environment: fake.env,
    renderer: () => ({ render: (_frame, lut, version) => { seen.push(lut[200 * 4]! * 1000 + version); }, dispose() {} }),
  });
  fake.push(frame("a", 1));
  await tick();
  const inverse = Array.from({ length: 256 }, (_, value) => Math.max(0, value - 60));
  correction.setCalibration({ r: inverse, g: inverse, b: inverse });
  fake.push(frame("b", 2));
  await tick();
  assert.equal(Math.floor(seen[1]! / 1000), 140);
  assert.ok(seen[1]! % 1000 > seen[0]! % 1000, "a new table version is uploaded");
  correction.dispose();
});
