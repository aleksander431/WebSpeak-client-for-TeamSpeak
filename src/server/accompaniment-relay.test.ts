import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { AccompanimentRelay, accompanimentNickname, type AccompanimentRelayClient } from "./accompaniment-relay.js";

class FakeClient extends EventEmitter implements AccompanimentRelayClient {
  channel = 1n;
  sent: Array<[number, number]> = [];
  moves: Array<[bigint, string | undefined]> = [];
  disconnected = false;
  failMove = false;
  async connect() {}
  async disconnect() { this.disconnected = true; }
  sendVoice(data: Buffer, codec = 4) { this.sent.push([data.length, codec]); }
  async switchChannel(id: bigint, password?: string) { if (this.failMove) throw new Error("needs password"); this.moves.push([id, password]); this.channel = id; }
  getChannelId() { return this.channel; }
  getClientId() { return 42; }
}

function setup(ownerChannel = 7n) {
  const client = new FakeClient();
  const events: string[] = [];
  let owner = ownerChannel;
  const relay = new AccompanimentRelay({
    create: () => client,
    ownerChannel: () => owner,
    channelPassword: id => (id === 9n ? "secret" : undefined),
    onLive: id => events.push(`live:${id}`),
    onEnded: () => events.push("ended"),
  });
  return { client, events, relay, move: (id: bigint) => { owner = id; } };
}

test("the music client joins its owner's channel and forwards frames as Opus Music", async () => {
  const { client, events, relay } = setup();
  assert.equal(await relay.start(), true);
  assert.deepEqual(client.moves, [[7n, undefined]]);
  assert.deepEqual(events, ["live:42"]);
  relay.send(Buffer.alloc(60));
  assert.deepEqual(client.sent, [[60, 5]]);
  assert.equal(relay.clientId, 42);
});

test("it follows the owner to another channel, with the owner's channel password", async () => {
  const { client, relay, move } = setup();
  await relay.start();
  move(9n);
  relay.send(Buffer.alloc(10));
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(client.moves.at(-1), [9n, "secret"]);
});

test("a channel it cannot enter means the owner keeps mixing", async () => {
  const { client, events, relay } = setup();
  client.failMove = true;
  assert.equal(await relay.start(), false);
  assert.equal(client.disconnected, true);
  assert.deepEqual(events, []);
  relay.send(Buffer.alloc(10));
  assert.deepEqual(client.sent, []);
});

test("a dropped music client tells the owner; stopping it does not", async () => {
  const first = setup();
  await first.relay.start();
  first.client.emit("kicked");
  assert.deepEqual(first.events, ["live:42", "ended"]);
  const second = setup();
  await second.relay.start();
  await second.relay.stop();
  second.client.emit("disconnected");
  assert.deepEqual(second.events, ["live:42"]);
  assert.equal(second.client.disconnected, true);
});

test("music nicknames stay within TeamSpeak's limit", () => {
  assert.equal(accompanimentNickname("Alex"), "Alex 🎵");
  assert.equal(Array.from(accompanimentNickname("x".repeat(40))).length, 30);
});
