import assert from "node:assert/strict";
import test from "node:test";
import { createWebRtcInput } from "./webrtc-input.js";

/** Minimal Web Audio graph that records connections and gain values. */
class FakeNode {
  readonly outputs = new Set<FakeNode>();
  constructor(readonly name: string) {}
  connect(target: FakeNode): FakeNode { this.outputs.add(target); return target; }
  disconnect(target?: FakeNode): void { if (target) this.outputs.delete(target); else this.outputs.clear(); }
}
class FakeGain extends FakeNode { readonly gain = { value: 1 }; }
class FakeDestination extends FakeNode {
  channelCount = 2;
  channelCountMode = "max";
  readonly stream = { getAudioTracks: () => [{ readyState: "live" }], getTracks: () => [{ stop() {} }] };
}

function harness() {
  const gains: FakeGain[] = [];
  const destinations: FakeDestination[] = [];
  const sources: FakeNode[] = [];
  const context = {
    createMediaStreamDestination: () => { const node = new FakeDestination(destinations.length ? "music" : "voice"); destinations.push(node); return node; },
    createMediaStreamSource: (stream: { id: string }) => { const node = new FakeNode(stream.id); sources.push(node); return node; },
    createGain: () => { const node = new FakeGain("gain"); gains.push(node); return node; },
  };
  const stream = (id: string) => ({ id, getAudioTracks: () => [{ readyState: "live" }] });
  return { context: context as unknown as AudioContext, gains, sources, destinations, stream: stream as (id: string) => MediaStream };
}

test("accompaniment goes through its own gain, separate from the microphone", () => {
  const { context, gains, sources, stream } = harness();
  const input = createWebRtcInput(context, stream("mic"), 0.8, 0.5);
  const [microphoneGain, accompanimentGain] = gains;
  assert.equal(microphoneGain!.gain.value, 0.8);
  assert.equal(accompanimentGain!.gain.value, 0.5);

  input.setAccompaniment(stream("music"));
  const music = sources.find(node => node.name === "music")!;
  assert.ok(music.outputs.has(accompanimentGain!), "music feeds the accompaniment gain");
  assert.ok(!music.outputs.has(microphoneGain!), "music bypasses microphone gain");

  input.setAccompanimentVolume(0.2);
  assert.equal(accompanimentGain!.gain.value, 0.2);
  assert.equal(microphoneGain!.gain.value, 0.8, "microphone level unchanged");

  input.setVolume(0);
  assert.equal(accompanimentGain!.gain.value, 0.2, "microphone mute leaves the accompaniment alone");

  input.setAccompanimentVolume(3);
  assert.equal(accompanimentGain!.gain.value, 1);
  input.setAccompanimentVolume(Number.NaN);
  assert.equal(accompanimentGain!.gain.value, 1);
  input.dispose();
  input.setAccompanimentVolume(0.4);
});

test("accompaniment volume defaults to the full source level when not given", () => {
  const { context, gains, stream } = harness();
  createWebRtcInput(context, stream("mic"), 1);
  assert.equal(gains[1]!.gain.value, 1);
});

test("accompaniment moves between the voice and its own track without a gap", () => {
  const { context, gains, destinations, stream } = harness();
  const input = createWebRtcInput(context, stream("mic"), 1, 0.7);
  const [voice, music] = destinations;
  const accompanimentGain = gains[1]!;
  assert.equal(music!.channelCount, 2, "music keeps stereo");
  assert.ok(accompanimentGain.outputs.has(voice!));
  input.setAccompanimentSeparate(true);
  assert.deepEqual([...accompanimentGain.outputs], [music], "only on its own track");
  assert.ok(gains[0]!.outputs.has(voice!), "the microphone stays in the voice");
  input.setAccompanimentSeparate(false);
  assert.deepEqual([...accompanimentGain.outputs], [voice]);
  input.dispose();
  input.setAccompanimentSeparate(true);
});
