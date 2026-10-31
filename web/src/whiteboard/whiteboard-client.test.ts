import assert from "node:assert/strict";
import test from "node:test";
import { WhiteboardClient } from "./whiteboard-client.js";
import { WhiteboardCoordinator, whiteboardBoardKey } from "../../../src/server/whiteboard-coordinator.js";
import { MemoryWhiteboardStore } from "../../../src/server/whiteboard-store.js";
import { parseWhiteboardClientMessage, parseWhiteboardServerMessage, type WhiteboardElement } from "../../../src/shared/whiteboard.js";

/**
 * Browsers talking to a real coordinator through queues, so tests decide
 * when frames are delivered (to model the network reordering nothing but
 * timing: each direction stays FIFO, like a WebSocket).
 */
function network() {
  const store = new MemoryWhiteboardStore();
  const toServer: { from: string; raw: string }[] = [];
  const toClient = new Map<string, string[]>();
  const clients = new Map<string, WhiteboardClient>();
  const online = new Map<string, boolean>();
  const boards = new Map<string, string>();
  let ids = 0;
  const coordinator = new WhiteboardCoordinator({
    store,
    send: (entryId, message) => toClient.set(entryId, [...(toClient.get(entryId) ?? []), JSON.stringify(message)]),
    randomId: () => `s${++ids}`,
  });
  function add(name: string, board = whiteboardBoardKey("ts:9987", 1)) {
    online.set(name, true);
    boards.set(name, board);
    const client = new WhiteboardClient({
      transport: { isOpen: () => online.get(name) === true, send: (message) => toServer.push({ from: name, raw: JSON.stringify(message) }) },
      setTimer: (callback) => { callback(); return 1; },
      clearTimer: () => {},
    });
    clients.set(name, client);
    return client;
  }
  function flushServer() {
    while (toServer.length) {
      const { from, raw } = toServer.shift()!;
      const message = parseWhiteboardClientMessage(raw);
      assert.ok(message && !("error" in message), `client sent an invalid frame: ${raw.slice(0, 120)}`);
      coordinator.handleMessage({ entryId: from, nickname: from, boardKey: boards.get(from)! }, message);
    }
  }
  function flushClient(name: string) {
    const queue = toClient.get(name) ?? [];
    toClient.set(name, []);
    for (const raw of queue) {
      const message = parseWhiteboardServerMessage(JSON.parse(raw));
      assert.ok(message, `gateway sent an invalid frame: ${raw.slice(0, 120)}`);
      clients.get(name)!.receive(message);
    }
  }
  function settle() {
    for (let round = 0; round < 10; round++) {
      flushServer();
      for (const name of clients.keys()) flushClient(name);
      if (!toServer.length && [...toClient.values()].every((queue) => !queue.length)) return;
    }
  }
  return { coordinator, store, add, flushServer, flushClient, settle, online, boards, clients };
}

const rect = (id: string, x = 0, z = 1): WhiteboardElement => ({ id, type: "rect", x, y: 0, w: 10, h: 10, z, stroke: "#000000", fill: null, strokeWidth: 2 });
const ids = (client: WhiteboardClient) => [...client.elements.keys()].sort();
const xs = (client: WhiteboardClient) => Object.fromEntries([...client.elements.values()].map((element) => [element.id, element.x]));

test("two browsers see each other's drawing and converge on the gateway's order", () => {
  const net = network();
  const a = net.add("a"), b = net.add("b");
  a.open(); b.open();
  net.settle();
  assert.ok(a.ready && b.ready);
  assert.equal(a.sheetId, b.sheetId);

  a.upsert([rect("r1")]);
  assert.deepEqual(ids(a), ["r1"], "shown immediately before the echo");
  assert.equal(a.pendingCount, 1);
  net.settle();
  assert.equal(a.pendingCount, 0);
  assert.deepEqual(ids(b), ["r1"]);

  // Concurrent edits of the same element: whoever reaches the gateway last wins, everywhere.
  a.upsert([rect("r1", 100)]);
  b.upsert([rect("r1", 200)]);
  net.flushServer(); // a's edit first, then b's
  net.flushClient("a");
  net.flushClient("b");
  assert.deepEqual(xs(a), { r1: 200 });
  assert.deepEqual(xs(b), { r1: 200 });

  // b's edit is still in flight while a's echo arrives: b keeps showing its own change.
  b.upsert([rect("r1", 300)]);
  a.upsert([rect("r1", 400)]);
  net.flushServer(); // b first now
  net.flushClient("b");
  net.flushClient("a");
  assert.deepEqual(xs(a), { r1: 400 });
  assert.deepEqual(xs(b), { r1: 400 });
});

test("undo and redo restore earlier states for everyone", () => {
  const net = network();
  const a = net.add("a"), b = net.add("b");
  a.open(); b.open(); net.settle();
  a.upsert([rect("r1", 0)]); net.settle();
  a.upsert([rect("r1", 50)]); net.settle();
  a.remove(["r1"]); net.settle();
  assert.deepEqual(ids(b), []);
  a.undo(); net.settle();
  assert.deepEqual(xs(b), { r1: 50 });
  a.undo(); net.settle();
  assert.deepEqual(xs(b), { r1: 0 });
  a.undo(); net.settle();
  assert.deepEqual(ids(b), []);
  assert.equal(a.canUndo, false);
  a.redo(); a.redo(); net.settle();
  assert.deepEqual(xs(b), { r1: 50 });
  a.upsert([rect("r2")]);
  assert.equal(a.canRedo, false, "a new change drops the redo history");
});

test("clearing is undoable and large restores are split into several frames", () => {
  const net = network();
  const a = net.add("a"), b = net.add("b");
  a.open(); b.open(); net.settle();
  a.upsert(Array.from({ length: 450 }, (_, index) => rect(`r${index}`, index)));
  net.settle();
  assert.equal(b.elements.size, 450);
  a.clear(); net.settle();
  assert.equal(b.elements.size, 0);
  a.undo(); net.settle();
  assert.equal(b.elements.size, 450);
  assert.equal(a.pendingCount, 0);
});

test("peers' previews and cursors are shown but never stored", () => {
  const net = network();
  const a = net.add("a"), b = net.add("b");
  a.open(); b.open(); net.settle();
  a.sendPreview([rect("draft", 5)]);
  a.sendCursor(12.4, 30.6);
  net.settle();
  assert.deepEqual(b.drawList().map((element) => element.id), ["draft"]);
  assert.deepEqual(b.cursors().map((cursor) => [cursor.peer.nickname, cursor.x, cursor.y]), [["a", 12, 31]]);
  assert.equal(b.elements.size, 0);
  a.upsert([rect("draft", 5)]); net.settle();
  assert.deepEqual(b.drawList().map((element) => element.id), ["draft"], "the committed element replaces the preview");
  a.close(); net.settle();
  assert.deepEqual(b.cursors(), []);
  assert.deepEqual(b.peers.map((peer) => peer.nickname), ["b"]);
});

test("sheets: a new sheet starts empty, old sheets keep their drawings", () => {
  const net = network();
  const a = net.add("a"), b = net.add("b");
  a.open(); b.open(); net.settle();
  const first = a.sheetId;
  a.upsert([rect("old")]); net.settle();
  a.createSheet(""); net.settle();
  assert.notEqual(a.sheetId, first);
  assert.equal(a.elements.size, 0);
  assert.equal(b.sheetId, first, "others stay on their sheet");
  assert.equal(b.sheets.length, 2, "but see the new tab");
  a.upsert([rect("new")]); net.settle();
  assert.deepEqual(ids(b), ["old"]);
  a.selectSheet(first); net.settle();
  assert.deepEqual(ids(a), ["old"]);
  assert.equal(a.canUndo, false, "history is per sheet");
});

test("reconnecting reopens the same sheet and drops unconfirmed changes", () => {
  const net = network();
  const a = net.add("a");
  a.open(); net.settle();
  a.createSheet("Второй"); net.settle();
  const second = a.sheetId;
  a.upsert([rect("lost")]);
  net.online.set("a", false);
  a.setConnected(false);
  net.coordinator.removePeer("a");
  assert.equal(a.ready, false);
  net.online.set("a", true);
  // The frame sent before the drop never reached the gateway.
  net.settle();
  a.setConnected(true); net.settle();
  assert.equal(a.ready, true);
  assert.equal(a.sheetId, second);
});

test("invalid elements are dropped locally instead of breaking the queue", () => {
  const net = network();
  const a = net.add("a");
  a.open(); net.settle();
  a.upsert([rect("ok"), { ...rect("bad"), stroke: "red" }]);
  net.settle();
  assert.deepEqual(ids(a), ["ok"]);
  assert.equal(a.pendingCount, 0);
});

test("moving to another channel switches to that channel's board", () => {
  const net = network();
  const a = net.add("a"), b = net.add("b", whiteboardBoardKey("ts:9987", 2));
  a.open(); b.open(); net.settle();
  b.upsert([rect("other")]); net.settle();
  net.boards.set("a", whiteboardBoardKey("ts:9987", 2));
  net.coordinator.onBoardChanged({ entryId: "a", nickname: "a", boardKey: whiteboardBoardKey("ts:9987", 2) });
  net.settle();
  assert.deepEqual(ids(a), ["other"]);
});

test("switching sheets replaces what is shown", () => {
  const net = network();
  const a = net.add("a");
  a.open(); net.settle();
  a.upsert([rect("one"), rect("two")]); net.settle();
  assert.equal(a.elements.size, 2);
  a.createSheet(""); net.settle();
  assert.equal(a.elements.size, 0, "the new sheet starts empty");
  assert.deepEqual(a.drawList(), []);
});
