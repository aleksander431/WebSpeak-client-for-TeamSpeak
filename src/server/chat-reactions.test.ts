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

test("reactions of stored messages come back after a restart", () => {
  const saved = new Map<string, { emoji: string; userKey: string; userName: string }[]>();
  const messages = new Map<string, typeof message & { timestamp: number }>();
  const store = {
    find: (ref: string) => messages.get(ref) ?? null,
    load: (ref: string) => saved.get(ref) ?? [],
    save: (ref: string, emoji: string, userKey: string, userName: string, active: boolean) => {
      const rest = (saved.get(ref) ?? []).filter(row => !(row.emoji === emoji && row.userKey === userKey));
      saved.set(ref, active ? [...rest, { emoji, userKey, userName }] : rest);
    },
  };
  const before = new ChatReactionHub(() => 5_000, store);
  const ref = before.refFor(message);
  messages.set(ref, { ...message, timestamp: 5_000 });
  before.react(ref, { key: "uid:a", name: "Ann" }, "🔥", true);
  before.react(ref, { key: "uid:b", name: "Bob" }, "🔥", true);
  before.react(ref, { key: "uid:b", name: "Bob" }, "🔥", false);

  // A new gateway process: nothing in memory, the store still has the message.
  const after = new ChatReactionHub(() => 9_000_000_000, store);
  assert.deepEqual(after.summary(ref, "uid:a"), [{ emoji: "🔥", count: 1, names: ["Ann"], mine: true }]);
  assert.equal(after.get(ref)?.channelId, "5");
  assert.equal(after.react(ref, { key: "uid:b", name: "Bob" }, "👍", true), true, "old stored messages can still be reacted to");
  assert.deepEqual(after.lookup(message, 5_000), ref);
  assert.equal(new ChatReactionHub(Date.now, store).get("ffffffffffffffff"), null);
});

test("pins are kept per conversation, once each, up to the limit, with their own text", async () => {
  const { ChatPinStore } = await import("./chat-pins.js");
  const { CHAT_PIN_LIMIT } = await import("../shared/chat-pins.js");
  let clock = 100;
  const store = new ChatPinStore(undefined, () => clock++);
  const lobby = { targetKey: "ts:1", scope: "channel" as const, channelId: "5" };
  const pin = (ref: string) => store.pin(lobby, { ref, senderName: "Kria", message: `m-${ref}`, timestamp: 1 }, "Alex");
  assert.equal(pin("0000000000000001"), "pinned");
  assert.equal(pin("0000000000000001"), "pinned", "pinning twice keeps one pin");
  assert.deepEqual(store.list(lobby), [{ ref: "0000000000000001", senderName: "Kria", message: "m-0000000000000001", timestamp: 1, pinnedBy: "Alex", pinnedAt: 100 }]);
  assert.deepEqual(store.list({ ...lobby, channelId: "6" }), []);
  for (let index = 2; index <= CHAT_PIN_LIMIT; index++) pin(index.toString(16).padStart(16, "0"));
  assert.equal(store.list(lobby).length, CHAT_PIN_LIMIT);
  assert.equal(pin("ffffffffffffffff"), "limit");
  store.unpin(lobby, "0000000000000001");
  assert.equal(store.list(lobby).some(entry => entry.ref === "0000000000000001"), false);
});
