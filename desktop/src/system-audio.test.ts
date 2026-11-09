import { test } from "node:test";
import assert from "node:assert/strict";
import { ShareAudioTracker, windowHandleOf } from "./system-audio.js";

test("a window source names its handle; screens have none", () => {
  assert.equal(windowHandleOf("window:132456:0"), "132456");
  assert.equal(windowHandleOf("window:0:0"), null);
  assert.equal(windowHandleOf("screen:0:0"), null);
  assert.equal(windowHandleOf("window:abc:0"), null);
  assert.equal(windowHandleOf(""), null);
});

function tracker() {
  const pending = new Map<number, () => void>();
  let next = 0;
  const shares = new ShareAudioTracker<{ name: string; stop(): void }>(30_000, {
    setTimeout: (callback) => { pending.set(++next, callback); return next; },
    clearTimeout: (handle) => { pending.delete(handle as number); },
  });
  const stopped: string[] = [];
  const capture = (name: string) => ({ name, stop: () => stopped.push(name) });
  const elapse = () => { for (const callback of [...pending.values()]) callback(); pending.clear(); };
  return { shares, stopped, capture, elapse };
}

test("an accompaniment keeps its sound past the grace period and loses it when it stops", () => {
  const { shares, stopped, capture, elapse } = tracker();
  shares.add(capture("music"));
  shares.update({ streaming: false, accompaniment: true });
  elapse();
  assert.deepEqual(stopped, [], "a claimed capture outlives the grace period");
  shares.update({ streaming: false, accompaniment: false });
  assert.deepEqual(stopped, ["music"]);
});

test("a screen share and an accompaniment run side by side and end separately", () => {
  const { shares, stopped, capture } = tracker();
  shares.add(capture("music"));
  shares.update({ streaming: false, accompaniment: true });
  shares.add(capture("screen"));
  shares.update({ streaming: true, accompaniment: true });
  shares.update({ streaming: false, accompaniment: true });
  assert.deepEqual(stopped, ["screen"]);
  shares.update({ streaming: false, accompaniment: false });
  assert.deepEqual(stopped, ["screen", "music"]);
});

test("a capture no share claims is released after the grace period; a reload releases all", () => {
  const { shares, stopped, capture, elapse } = tracker();
  shares.add(capture("unused"));
  elapse();
  assert.deepEqual(stopped, ["unused"]);
  shares.add(capture("screen"));
  shares.update({ streaming: true, accompaniment: false });
  shares.reset();
  assert.deepEqual(stopped, ["unused", "screen"]);
  assert.equal(shares.size, 0);
});
