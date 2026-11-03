import assert from "node:assert/strict";
import test from "node:test";
import { sameChatMessage } from "./chat-dedupe.js";

const base = { scope: "channel" as const, targetId: "7", message: "Кря", timestamp: 1_000_000 };

test("our local copy matches the server copy made under an older identity", () => {
  const local = { ...base, invokerName: "afire.", isSelf: true, senderUid: "new-uid" };
  const server = { ...base, timestamp: base.timestamp + 300, invokerName: "afire.", isSelf: false, senderUid: "old-uid" };
  assert.equal(sameChatMessage(local, server), true);
  assert.equal(sameChatMessage(server, local), true);
});

test("someone else's identical text is a different message", () => {
  const mine = { ...base, invokerName: "afire.", isSelf: true };
  const theirs = { ...base, invokerName: ".ForeverAlive", isSelf: false, senderUid: "u2" };
  assert.equal(sameChatMessage(mine, theirs), false);
});

test("gateway references decide when both copies have one", () => {
  const one = { ...base, invokerName: "a", isSelf: false, ref: "00000000000000a1" };
  assert.equal(sameChatMessage(one, { ...one, ref: "00000000000000a2" }), false, "two quick identical messages stay two");
  assert.equal(sameChatMessage(one, { ...one, isSelf: true, invokerName: "You", ref: "00000000000000a1" }), true);
});

test("different channels, scopes or times never match", () => {
  const one = { ...base, invokerName: "a", isSelf: false };
  assert.equal(sameChatMessage(one, { ...one, targetId: "8" }), false);
  assert.equal(sameChatMessage(one, { ...one, scope: "server" }), false);
  assert.equal(sameChatMessage(one, { ...one, timestamp: base.timestamp + 10 * 60_000 }), false);
});
