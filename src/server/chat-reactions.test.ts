import assert from "node:assert/strict";
import test from "node:test";
import { ChatReactionHub } from "./chat-reactions.js";
import { parseChatReactions } from "../shared/chat-reactions.js";

const message = { targetKey: "ts:1", scope: "channel" as const, channelId: "5", senderName: "Kria", message: "привет" };

test("sessions seeing the same message share one reference", () => {
  let clock = 1_000;
  const hub = new ChatReactionHub(() => clock);
  const ref = hub.refFor(message);
  assert.match(ref, /^[0-9a-f]{16}$/);
  clock += 3_000;
  assert.equal(hub.refFor({ ...message, message: " привет " }), ref, "a second session, a little later");
  clock += 30_000;
  const again = hub.refFor(message);
  assert.notEqual(again, ref, "the same text sent again later is another message");
  assert.equal(hub.lookup(message, 1_500), ref);
  assert.equal(hub.lookup(message, clock), again);
  assert.equal(hub.lookup({ ...message, channelId: "6" }, 1_000), null);
  assert.notEqual(hub.refFor({ ...message, scope: "server" }), ref);
});

test("reactions are per user and per emoji, and unknown input is refused", () => {
  const hub = new ChatReactionHub();
  const ref = hub.refFor(message);
  assert.equal(hub.react(ref, { key: "uid:a", name: "Ann" }, "👍", true), true);
  hub.react(ref, { key: "uid:a", name: "Ann" }, "👍", true);
  hub.react(ref, { key: "uid:b", name: "Bob" }, "👍", true);
  hub.react(ref, { key: "uid:b", name: "Bob" }, "🔥", true);
  assert.deepEqual(hub.summary(ref, "uid:a"), [
    { emoji: "👍", count: 2, names: ["Ann", "Bob"], mine: true },
    { emoji: "🔥", count: 1, names: ["Bob"], mine: false },
  ]);
  hub.react(ref, { key: "uid:b", name: "Bob" }, "🔥", false);
  assert.deepEqual(hub.summary(ref, "uid:b").map(reaction => reaction.emoji), ["👍"]);
  assert.equal(hub.react(ref, { key: "uid:a", name: "Ann" }, "💩", true), false);
  assert.equal(hub.react("0000000000000000", { key: "uid:a", name: "Ann" }, "👍", true), false);
  assert.equal(hub.react(ref, { key: "", name: "Ann" }, "👍", true), false);
  assert.deepEqual(parseChatReactions(hub.summary(ref, "uid:a")), hub.summary(ref, "uid:a"));
  assert.equal(parseChatReactions([{ emoji: "💩", count: 1 }]), null);
});
