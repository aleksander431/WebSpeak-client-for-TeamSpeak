import assert from "node:assert/strict";
import test from "node:test";
import { createMemberPresenceTracker, PRESENCE_SETTLE_MS } from "./channel-presence-sound.js";

test("joins and leaves in your channel are reported once settled", () => {
  let now = 0;
  const tracker = createMemberPresenceTracker(() => now);
  assert.equal(tracker.update("1:5", [2, 3]), null, "entering a channel is silent");
  now += PRESENCE_SETTLE_MS + 1;
  assert.equal(tracker.update("1:5", [2, 3, 4]), "joined");
  assert.equal(tracker.update("1:5", [2, 3, 4]), null, "no change, no sound");
  assert.equal(tracker.update("1:5", [2, 4]), "left");
  assert.equal(tracker.update("1:5", [4, 7]), "joined", "a join wins over a leave in the same update");
});

test("your own move, reconnects and the loading list stay silent", () => {
  let now = 0;
  const tracker = createMemberPresenceTracker(() => now);
  tracker.update("1:5", []);
  now += 200;
  assert.equal(tracker.update("1:5", [2, 3, 4]), null, "the member list filling in after entering");
  now += PRESENCE_SETTLE_MS;
  assert.equal(tracker.update("1:9", [8]), null, "you moved to another channel");
  now += PRESENCE_SETTLE_MS + 1;
  assert.equal(tracker.update("", []), null, "disconnected");
  assert.equal(tracker.update("2:9", [8, 10]), null, "a new session starts silently");
  now += PRESENCE_SETTLE_MS + 1;
  assert.equal(tracker.update("2:9", [8]), "left");
});
