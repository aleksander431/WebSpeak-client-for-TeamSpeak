import assert from "node:assert/strict";
import test from "node:test";
import { desktopHost, runDesktopAction, type DesktopState } from "./useDesktopBridge.js";

function harness(initial: Partial<DesktopState> = {}) {
  const state: DesktopState = { connected: true, micMuted: false, soundMuted: false, streaming: false, ...initial };
  const calls: string[] = [];
  const tones: string[] = [];
  let starting = false;
  const options = {
    state: () => state,
    toggleMicrophone: () => { calls.push("mic"); state.micMuted = !state.micMuted; },
    toggleSound: () => { calls.push("sound"); state.soundMuted = !state.soundMuted; },
    startStream: () => { calls.push("start"); starting = true; },
    stopStream: () => { calls.push("stop"); starting = false; state.streaming = false; },
    streamStarting: () => starting,
  };
  return { state, calls, tones, options, run: (action: "mic" | "sound" | "stream", sound = true) => runDesktopAction(action, options, (tone) => tones.push(tone), sound) };
}

test("hotkeys toggle the microphone and sound with matching cues", () => {
  const h = harness();
  assert.equal(h.run("mic"), "mic-off");
  assert.equal(h.run("mic"), "mic-on");
  assert.equal(h.run("sound"), "sound-off");
  assert.deepEqual(h.calls, ["mic", "mic", "sound"]);
  assert.deepEqual(h.tones, ["off", "on", "off"]);
  h.run("sound", false);
  assert.equal(h.tones.length, 3, "cues can be turned off");
});

test("the stream hotkey starts, and stops a share that is running or still starting", () => {
  const h = harness();
  assert.equal(h.run("stream"), "stream-start");
  assert.equal(h.run("stream"), "stream-stop", "a second press cancels a share still starting");
  h.state.streaming = true;
  assert.equal(h.run("stream"), "stream-stop");
  assert.deepEqual(h.calls, ["start", "stop", "stop"]);
});

test("nothing happens while not connected, only a short cue", () => {
  const h = harness({ connected: false });
  assert.equal(h.run("mic"), "not-connected");
  assert.equal(h.run("stream"), "not-connected");
  assert.deepEqual(h.calls, []);
  assert.deepEqual(h.tones, ["denied", "denied"]);
});

test("the bridge only activates inside the desktop client", () => {
  assert.equal(desktopHost({}), null);
  assert.equal(desktopHost({ webspeakDesktop: { platform: "windows" } }), null);
  assert.ok(desktopHost({ webspeakDesktop: { platform: "windows", reportState() {}, openSettings() {} } }));
});
