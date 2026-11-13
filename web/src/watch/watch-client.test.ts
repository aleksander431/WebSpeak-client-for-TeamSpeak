import assert from "node:assert/strict";
import test from "node:test";
import type { WatchClientMessage, WatchRoomView, WatchServerMessage } from "../../../src/shared/watch-together.js";
import { WatchClient } from "./watch-client.js";

function harness() {
  let now = 0;
  const sent: WatchClientMessage[] = [];
  let listener: (message: WatchServerMessage) => void = () => {};
  const client = new WatchClient({ isOpen: () => true, send: message => sent.push(message), subscribe: next => { listener = next; return () => {}; } }, () => now);
  return { client, sent, receive: (message: WatchServerMessage) => listener(message), advance: (ms: number) => { now += ms; } };
}

const room = (id: string, extra: Partial<WatchRoomView> = {}): WatchRoomView => ({
  id, media: { kind: "youtube", id: "dQw4w9WgXcQ", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }, title: "", duration: 0, startedBy: "Саша",
  playing: true, position: 10, last: { by: "Саша", action: "start", at: 1 }, viewers: ["Саша"], queue: [], continued: false, ...extra,
});

test("the page follows the shared clock and only opens the player for its own video", () => {
  const { client, sent, receive, advance } = harness();
  client.setConnected(true);
  assert.deepEqual(sent, [{ type: "watchOpen" }]);

  // Someone else's video is offered, not opened.
  receive({ type: "watchState", room: room("v1") });
  assert.equal(client.state.watching, false);
  advance(2500);
  assert.equal(client.expectedPosition(), 12.5);

  client.setWatching(true);
  assert.deepEqual(sent.at(-1), { type: "watchView", watching: true });
  client.control("pause", 12.5);
  assert.deepEqual(sent.at(-1), { type: "watchControl", id: "v1", action: "pause", position: 12.5 });
  advance(5000);
  assert.equal(client.expectedPosition(), 12.5, "paused at once, before the echo");

  // A new video from someone else closes the player and offers it instead.
  receive({ type: "watchState", room: room("v2", { position: 0 }) });
  assert.equal(client.state.watching, false);

  // Starting one opens it here.
  client.start("https://youtu.be/dQw4w9WgXcQ");
  receive({ type: "watchState", room: room("v3", { startedBy: "me", viewers: ["me"] }) });
  assert.equal(client.state.watching, true);

  // A refused link does not leave a later video opening by itself.
  client.start("https://example.org/page");
  receive({ type: "watchError", code: "WATCH_BAD_URL" });
  receive({ type: "watchState", room: room("v4") });
  assert.equal(client.state.watching, false);

  // The next video from the queue keeps those watching in.
  client.setWatching(true);
  receive({ type: "watchState", room: room("v5", { continued: true }) });
  assert.equal(client.state.watching, true);
  client.queue("https://youtu.be/aaaaaaaaaaa");
  assert.deepEqual(sent.at(-1), { type: "watchQueue", url: "https://youtu.be/aaaaaaaaaaa" });
  client.ended("old");
  assert.notEqual(sent.at(-1)?.type, "watchEnded", "a stale end is not reported");
  client.ended("v5");
  assert.deepEqual(sent.at(-1), { type: "watchEnded", id: "v5" });

  receive({ type: "watchState", room: null });
  assert.equal(client.state.room, null);
});
