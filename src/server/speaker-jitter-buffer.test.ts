import assert from "node:assert/strict";
import test from "node:test";
import { FRAME_MS, FRAME_SAMPLES, MAX_FRAMES, PREFILL_FRAMES, SpeakerJitterBuffer } from "./speaker-jitter-buffer.js";

// A clean tone: its largest natural sample-to-sample step is ~2πfA/48000 ≈ 580.
const AMPLITUDE = 10_000;
const FREQUENCY = 440;
const CLICK_STEP = 3_000;

function toneFrame(index: number): Int16Array {
  const frame = new Int16Array(FRAME_SAMPLES);
  for (let sample = 0; sample < FRAME_SAMPLES; sample++) {
    const t = (index * FRAME_SAMPLES + sample) / 48_000;
    frame[sample] = Math.round(AMPLITUDE * Math.sin(2 * Math.PI * FREQUENCY * t));
  }
  return frame;
}

/**
 * Deterministic jitter shaped like a real path: most packets within a few
 * milliseconds, and occasional spikes (a retransmission, a busy event loop).
 */
function jitterSequence(count: number, spikeMaxMs: number, seed = 7): number[] {
  let state = seed;
  const random = () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
  return Array.from({ length: count }, () => random() < 0.08 ? 25 + random() * (spikeMaxMs - 25) : random() * 5);
}

interface Speaker {
  push(samples: Int16Array, now: number): void;
  pull(now: number): Int16Array | null;
}

/** The mixer behaviour before this change: no cushion, hard silence on a miss. */
class LegacyQueue implements Speaker {
  private readonly queue: Int16Array[] = [];
  push(samples: Int16Array): void {
    if (this.queue.length >= 4) this.queue.shift();
    this.queue.push(samples);
  }
  pull(): Int16Array | null {
    return this.queue.shift() ?? null;
  }
}

/** Play `frames` sent every 20 ms but delivered late by `delays`, on a strict 20 ms clock. */
function simulate(speaker: Speaker, frames: number, delays: number[]): { output: number[]; clicks: number; silentTicks: number } {
  // Delivery keeps order (TCP, and UDP almost always): a late frame holds back
  // the ones after it, which then arrive together as a burst.
  let previous = 0;
  const arrivals = Array.from({ length: frames }, (_, index) => {
    previous = Math.max(previous, index * FRAME_MS + delays[index]!);
    return { at: previous, index };
  });
  const output: number[] = [];
  let next = 0;
  let silentTicks = 0;
  let started = false;
  for (let tick = 0; tick < frames + 20; tick++) {
    const now = tick * FRAME_MS + 0.5;
    while (next < arrivals.length && arrivals[next]!.at <= now) speaker.push(toneFrame(arrivals[next]!.index), arrivals[next]!.at), next++;
    const frame = speaker.pull(now);
    if (frame) started = true;
    if (started && next < arrivals.length && !frame) silentTicks++;
    for (let sample = 0; sample < FRAME_SAMPLES; sample++) output.push(frame ? frame[sample]! : 0);
  }
  let clicks = 0;
  for (let index = 1; index < output.length; index++) {
    if (Math.abs(output[index]! - output[index - 1]!) > CLICK_STEP) clicks++;
  }
  return { output, clicks, silentTicks };
}

test("the cushion absorbs normal network jitter that used to produce clicks", () => {
  const frames = 500; // 10 seconds of speech
  const delays = jitterSequence(frames, 55);
  const legacy = simulate(new LegacyQueue(), frames, delays);
  const buffered = simulate(new SpeakerJitterBuffer(), frames, delays);
  assert.ok(legacy.silentTicks > 0 && legacy.clicks > 0, `the old mixer drops to silence on 25-55 ms spikes (gaps ${legacy.silentTicks}, clicks ${legacy.clicks})`);
  assert.equal(buffered.clicks, 0, `no clicks with the jitter buffer (got ${buffered.clicks})`);
  assert.equal(buffered.silentTicks, 0, "no mid-speech gaps when jitter stays within the cushion");
});

test("a real gap fades out and back in instead of stepping", () => {
  const frames = 200;
  // A 200 ms stall in the middle (e.g. a TCP retransmit on the sender's side).
  const delays = Array.from({ length: frames }, (_, index) => index >= 100 && index < 110 ? 200 - (index - 100) * FRAME_MS : 0);
  const buffer = new SpeakerJitterBuffer();
  const result = simulate(buffer, frames, delays);
  assert.equal(result.clicks, 0, "gaps are smoothed");
  assert.ok(buffer.stats.underruns >= 1, "the stall is reported as an underrun");
});

test("latency stays bounded when a sender runs ahead", () => {
  const buffer = new SpeakerJitterBuffer();
  for (let index = 0; index < 30; index++) buffer.push(toneFrame(index), 0);
  assert.equal(buffer.size, MAX_FRAMES);
  assert.equal(buffer.stats.dropped, 30 - MAX_FRAMES);
  buffer.trim();
  assert.equal(buffer.size, PREFILL_FRAMES);
});

test("a short final utterance still plays after the prefill timeout", () => {
  const buffer = new SpeakerJitterBuffer();
  buffer.push(toneFrame(0), 0);
  assert.equal(buffer.pull(FRAME_MS), null, "waits for the cushion first");
  assert.ok(buffer.pull(PREFILL_FRAMES * FRAME_MS + 1), "then plays what it has");
  const tail = buffer.pull(PREFILL_FRAMES * FRAME_MS + 21);
  assert.ok(tail, "the end of speech fades out over one frame");
  assert.equal(buffer.pull(PREFILL_FRAMES * FRAME_MS + 41), null);
  assert.equal(buffer.idle, true, "an idle speaker can be released by the mixer");
});

test("frames of the wrong size are ignored", () => {
  const buffer = new SpeakerJitterBuffer();
  buffer.push(new Int16Array(10), 0);
  assert.equal(buffer.size, 0);
});
