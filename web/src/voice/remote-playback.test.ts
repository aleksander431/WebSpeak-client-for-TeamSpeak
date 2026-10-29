import assert from "node:assert/strict";
import test from "node:test";
import { MAX_PLAY_AHEAD_SECONDS, PLAYBACK_PREFILL_SECONDS, createRemotePlayback } from "./remote-playback.js";

interface Scheduled { start: number; duration: number; first: number }

/** Minimal Web Audio and WebCodecs fakes: enough to observe what gets scheduled when. */
function harness() {
  const state = { now: 0, decoders: 0, drops: 0, underruns: 0, decodeErrors: 0 };
  const scheduled: Scheduled[] = [];
  const globals = globalThis as Record<string, unknown>;
  const saved = { AudioDecoder: globals.AudioDecoder, EncodedAudioChunk: globals.EncodedAudioChunk };
  globals.EncodedAudioChunk = class { constructor(readonly init: { data: Uint8Array }) {} };
  globals.AudioDecoder = class {
    decodeQueueSize = 0;
    constructor(private readonly handlers: { output(chunk: unknown): void }) { state.decoders++; }
    configure() {}
    close() {}
    decode(chunk: { init: { data: Uint8Array } }) {
      this.handlers.output({
        sampleRate: 48_000, numberOfChannels: 1, numberOfFrames: 960,
        copyTo(target: Float32Array) { target.fill(0.5); },
        close() {},
      });
    }
  };
  const context = {
    get currentTime() { return state.now; },
    destination: {},
    createGain() { return { gain: { value: 1 }, connect() {}, disconnect() {} }; },
    createBuffer(_channels: number, frames: number, rate: number) {
      const data = new Float32Array(frames);
      return { duration: frames / rate, data, copyToChannel(samples: Float32Array) { data.set(samples); } };
    },
    createBufferSource() {
      const source = {
        buffer: null as null | { duration: number; data: Float32Array },
        connect() {}, disconnect() {}, addEventListener() {}, stop() {},
        start(at: number) { scheduled.push({ start: at, duration: source.buffer!.duration, first: source.buffer!.data[0]! }); },
      };
      return source;
    },
  } as unknown as AudioContext;
  const playback = createRemotePlayback({
    getContext: () => context,
    getVolume: () => 1,
    onDecodeError: () => { state.decodeErrors++; },
    onDrop: () => { state.drops++; },
    onUnderrun: () => { state.underruns++; },
  });
  const restore = () => { globals.AudioDecoder = saved.AudioDecoder; globals.EncodedAudioChunk = saved.EncodedAudioChunk; };
  return { state, scheduled, playback, restore };
}

/** Deterministic delivery delays: mostly a few ms, with occasional 25–55 ms spikes. */
function spikyDelays(count: number): number[] {
  let seed = 11;
  const random = () => { seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648; return seed / 2_147_483_648; };
  return Array.from({ length: count }, () => random() < 0.08 ? 0.025 + random() * 0.03 : random() * 0.005);
}

/** Feed 20 ms frames sent on time but delivered late, in order, like TCP. */
function deliver(h: ReturnType<typeof harness>, delays: number[]): void {
  let previous = 0;
  const arrivals = delays.map((delay, index) => (previous = Math.max(previous, index * 0.02 + delay)));
  for (const at of arrivals) {
    h.state.now = at;
    h.playback.play(7, new Uint8Array([1, 2, 3]));
  }
}

function gaps(scheduled: Scheduled[]): number {
  let count = 0;
  for (let index = 1; index < scheduled.length; index++) {
    const previousEnd = scheduled[index - 1]!.start + scheduled[index - 1]!.duration;
    if (Math.abs(scheduled[index]!.start - previousEnd) > 1e-6) count++;
  }
  return count;
}

test("ordinary jitter and spikes play back-to-back with no gaps", t => {
  const h = harness();
  t.after(h.restore);
  deliver(h, spikyDelays(500));
  assert.equal(h.scheduled.length, 500, "every frame is played");
  assert.equal(gaps(h.scheduled), 0, "no holes between frames");
  assert.equal(h.state.underruns, 0);
  assert.equal(h.state.drops, 0);
  assert.equal(h.state.decoders, 1, "the decoder is never thrown away");
});

test("playback starts after a short cushion and fades in", t => {
  const h = harness();
  t.after(h.restore);
  h.state.now = 1;
  h.playback.play(7, new Uint8Array([1, 2, 3]));
  assert.equal(h.scheduled[0]!.start, 1 + PLAYBACK_PREFILL_SECONDS);
  assert.ok(h.scheduled[0]!.first < 0.01, "the first sample ramps up from silence");
});

test("a real stall re-buffers once and fades back in instead of clicking", t => {
  const h = harness();
  t.after(h.restore);
  const delays = Array.from({ length: 100 }, (_, index) => index === 50 ? 0.3 : 0);
  deliver(h, delays);
  assert.equal(h.state.underruns, 1);
  const resumed = h.scheduled.find((item, index) => index > 0 && Math.abs(item.start - (h.scheduled[index - 1]!.start + h.scheduled[index - 1]!.duration)) > 1e-6);
  assert.ok(resumed && resumed.first < 0.01, "the frame after the gap fades in");
  assert.equal(h.state.decoders, 1);
});

test("a burst beyond the window drops frames but keeps the decoder and scheduled audio", t => {
  const h = harness();
  t.after(h.restore);
  h.state.now = 0;
  for (let index = 0; index < 30; index++) h.playback.play(7, new Uint8Array([1, 2, 3]));
  const maxEnd = Math.max(...h.scheduled.map(item => item.start + item.duration));
  assert.ok(maxEnd <= MAX_PLAY_AHEAD_SECONDS + 1e-9, "latency stays bounded");
  assert.ok(h.state.drops > 0);
  assert.equal(h.state.decoders, 1);
});
