import assert from "node:assert/strict";
import test from "node:test";
import { createCallMediaSession, silentWav } from "./call-media-session.js";

function fakeEnvironment({ autoplay = true } = {}) {
  const handlers = new Map<string, (() => void) | null>();
  const session = {
    metadata: null as unknown,
    playbackState: "none",
    microphoneActive: undefined as boolean | undefined,
    setActionHandler(action: string, handler: (() => void) | null) { handlers.set(action, handler); },
    setMicrophoneActive(active: boolean) { this.microphoneActive = active; },
  };
  const audio = { paused: true, loop: false, preload: "", src: "", plays: 0, attributes: {} as Record<string, string>,
    setAttribute(name: string, value: string) { this.attributes[name] = value; },
    removeAttribute(name: string) { delete this.attributes[name]; this.src = ""; },
    load() {},
    play() { this.plays += 1; if (!autoplay) return Promise.reject(new Error("NotAllowed")); this.paused = false; return Promise.resolve(); },
    pause() { this.paused = true; },
  };
  let gesture: (() => void) | null = null;
  return {
    handlers, session, audio,
    gesture: () => gesture,
    environment: {
      mediaSession: session,
      createMetadata: (init: unknown) => init,
      createAudio: () => audio as unknown as HTMLAudioElement,
      onGesture(retry: () => void) { gesture = retry; return () => { gesture = null; }; },
    },
  };
}

test("the silent clip is a valid 8-bit WAV of silence", () => {
  const wav = silentWav(1, 8000);
  assert.equal(wav.length, 44 + 8000);
  assert.equal(String.fromCharCode(...wav.slice(0, 4)), "RIFF");
  assert.equal(String.fromCharCode(...wav.slice(8, 12)), "WAVE");
  assert.ok(wav.slice(44).every(byte => byte === 128));
});

test("the card shows the channel and maps lock-screen buttons to the microphone", async () => {
  const fake = fakeEnvironment();
  let toggles = 0;
  let hangUps = 0;
  const card = createCallMediaSession({
    toggleMicrophone: () => { toggles += 1; },
    hangUp: () => { hangUps += 1; },
    labels: () => ({ microphoneOn: "Mic on", microphoneOff: "Mic off" }),
  }, fake.environment);
  card.update({ channel: "Lobby", server: "Afire", microphoneMuted: false });
  await Promise.resolve();
  assert.deepEqual(fake.session.metadata, { title: "Lobby", artist: "Mic on · Afire", album: "WebSpeak", artwork: [] });
  assert.equal(fake.session.playbackState, "playing");
  assert.equal(fake.session.microphoneActive, true);
  assert.equal(fake.audio.loop, true);
  assert.equal(fake.audio.paused, false);
  fake.handlers.get("pause")?.();
  fake.handlers.get("togglemicrophone")?.();
  fake.handlers.get("hangup")?.();
  assert.equal(toggles, 2);
  assert.equal(hangUps, 1);

  card.update({ channel: "Lobby", server: "Afire", microphoneMuted: true });
  assert.equal(fake.session.playbackState, "paused");
  assert.equal(fake.session.microphoneActive, false);

  card.update(null);
  assert.equal(fake.session.metadata, null);
  assert.equal(fake.session.playbackState, "none");
  assert.equal(fake.handlers.get("play"), null);
  assert.equal(fake.audio.paused, true);
  card.dispose();
});

test("refused autoplay retries on the next gesture", async () => {
  const fake = fakeEnvironment({ autoplay: false });
  const card = createCallMediaSession({ toggleMicrophone() {}, hangUp() {}, labels: () => ({ microphoneOn: "", microphoneOff: "" }) }, fake.environment);
  card.update({ channel: "A", server: "", microphoneMuted: false });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.ok(fake.gesture(), "waits for a gesture");
  card.update(null);
  assert.equal(fake.gesture(), null, "leaving removes the gesture listener");
  card.dispose();
});
