import assert from "node:assert/strict";
import test from "node:test";
import { WhiteboardCoordinator, whiteboardBoardKey } from "./whiteboard-coordinator.js";
import { MemoryWhiteboardStore, SqliteWhiteboardStore, type WhiteboardStore } from "./whiteboard-store.js";
import { WebSpeakDatabase } from "../persistence/database.js";
import {
  parseWhiteboardClientMessage,
  parseWhiteboardServerMessage,
  WHITEBOARD_LIMITS,
  type WhiteboardElement,
  type WhiteboardServerMessage,
} from "../shared/whiteboard.js";

const BOARD = whiteboardBoardKey("ts.example:9987", 5n);
const OTHER_BOARD = whiteboardBoardKey("ts.example:9987", 6n);

function rect(id: string, x = 10): WhiteboardElement {
  return { id, type: "rect", x, y: 20, w: 30, h: 40, z: 1, stroke: "#112233", fill: null, strokeWidth: 2 };
}

function harness(store: WhiteboardStore = new MemoryWhiteboardStore(), now = { value: 0 }) {
  const inbox = new Map<string, WhiteboardServerMessage[]>();
  let ids = 0;
  const coordinator = new WhiteboardCoordinator({
    store,
    send: (entryId, message) => {
      // Everything sent must survive the browser-side validator.
      assert.ok(parseWhiteboardServerMessage(JSON.parse(JSON.stringify(message))), `invalid ${message.type}`);
      inbox.set(entryId, [...(inbox.get(entryId) ?? []), message]);
    },
    now: () => now.value,
    randomId: () => `id${++ids}`,
  });
  const take = (entryId: string) => { const messages = inbox.get(entryId) ?? []; inbox.set(entryId, []); return messages; };
  const last = <T extends WhiteboardServerMessage["type"]>(entryId: string, type: T) =>
    (inbox.get(entryId) ?? []).filter((message) => message.type === type).at(-1) as Extract<WhiteboardServerMessage, { type: T }> | undefined;
  const user = (entryId: string, boardKey: string | null = BOARD) => ({ entryId, nickname: `nick-${entryId}`, boardKey });
  return { coordinator, take, last, user, store, now };
}

test("opening creates the first sheet and sends the state", () => {
  const { coordinator, last, user } = harness();
  coordinator.handleMessage(user("a"), { type: "whiteboardOpen" });
  const state = last("a", "whiteboardState")!;
  assert.equal(state.sheets.length, 1);
  assert.equal(state.sheets[0]!.name, "");
  assert.deepEqual(state.elements, []);
  assert.deepEqual(state.peers.map((peer) => peer.nickname), ["nick-a"]);
  assert.equal(state.self.nickname, "nick-a");
});

test("changes are echoed to everyone on the sheet, sender included, and stored", () => {
  const { coordinator, take, last, user, store } = harness();
  coordinator.handleMessage(user("a"), { type: "whiteboardOpen" });
  coordinator.handleMessage(user("b"), { type: "whiteboardOpen" });
  const sheetId = last("a", "whiteboardState")!.sheetId;
  assert.deepEqual(last("a", "whiteboardPeers")!.peers.map((peer) => peer.nickname), ["nick-a", "nick-b"]);
  take("a"); take("b");

  coordinator.handleMessage(user("a"), { type: "whiteboardUpsert", sheetId, elements: [rect("r1")] });
  for (const id of ["a", "b"]) {
    const upserted = last(id, "whiteboardUpserted")!;
    assert.equal(upserted.elements[0]!.id, "r1");
    assert.equal(upserted.elements[0]!.author, "nick-a");
  }
  assert.equal(store.loadElements(BOARD, sheetId).length, 1);

  coordinator.handleMessage(user("b"), { type: "whiteboardDelete", sheetId, ids: ["r1", "missing"] });
  assert.deepEqual(last("a", "whiteboardDeleted")!.ids, ["r1"]);
  assert.equal(store.loadElements(BOARD, sheetId).length, 0);

  coordinator.handleMessage(user("a"), { type: "whiteboardUpsert", sheetId, elements: [rect("r2"), rect("r3")] });
  coordinator.handleMessage(user("b"), { type: "whiteboardClear", sheetId });
  assert.ok(last("a", "whiteboardCleared"));
  assert.equal(store.loadElements(BOARD, sheetId).length, 0);
});

test("previews and cursors go to the others only and are not stored", () => {
  const { coordinator, take, last, user, store } = harness();
  coordinator.handleMessage(user("a"), { type: "whiteboardOpen" });
  coordinator.handleMessage(user("b"), { type: "whiteboardOpen" });
  const sheetId = last("a", "whiteboardState")!.sheetId;
  take("a"); take("b");
  coordinator.handleMessage(user("a"), { type: "whiteboardPreview", sheetId, elements: [rect("p1")] });
  coordinator.handleMessage(user("a"), { type: "whiteboardCursor", sheetId, x: 5, y: 6 });
  assert.deepEqual(take("a"), []);
  const seen = take("b");
  assert.deepEqual(seen.map((message) => message.type), ["whiteboardPreview", "whiteboardCursor"]);
  assert.equal(store.loadElements(BOARD, sheetId).length, 0);
});

test("boards are per channel and follow the user when they move", () => {
  const { coordinator, take, last, user } = harness();
  coordinator.handleMessage(user("a"), { type: "whiteboardOpen" });
  coordinator.handleMessage(user("b", OTHER_BOARD), { type: "whiteboardOpen" });
  const sheetA = last("a", "whiteboardState")!.sheetId;
  take("b");
  coordinator.handleMessage(user("a"), { type: "whiteboardUpsert", sheetId: sheetA, elements: [rect("r1")] });
  assert.deepEqual(take("b"), [], "a different channel sees nothing");

  coordinator.onBoardChanged(user("b", BOARD));
  const state = last("b", "whiteboardState")!;
  assert.equal(state.sheetId, sheetA);
  assert.deepEqual(state.elements.map((element) => element.id), ["r1"]);

  // A stale frame from the old channel is rejected.
  take("a");
  coordinator.handleMessage(user("a", OTHER_BOARD), { type: "whiteboardClear", sheetId: sheetA });
  assert.equal(last("a", "whiteboardError")!.code, "WHITEBOARD_NOT_OPEN");

  coordinator.onBoardChanged(user("b", null));
  assert.equal(coordinator.isSubscribed("b"), false);
});

test("sheets can be created, renamed, switched and deleted while keeping the others", () => {
  const { coordinator, take, last, user, store } = harness();
  coordinator.handleMessage(user("a"), { type: "whiteboardOpen" });
  coordinator.handleMessage(user("b"), { type: "whiteboardOpen" });
  const first = last("a", "whiteboardState")!.sheetId;
  coordinator.handleMessage(user("a"), { type: "whiteboardUpsert", sheetId: first, elements: [rect("old")] });
  take("a"); take("b");

  coordinator.handleMessage(user("a"), { type: "whiteboardCreateSheet", name: "Plan" });
  const sheets = last("b", "whiteboardSheets")!.sheets;
  assert.deepEqual(sheets.map((sheet) => sheet.name), ["", "Plan"]);
  const second = sheets[1]!.id;
  assert.equal(last("a", "whiteboardState")!.sheetId, second, "the creator moves to the new sheet");
  assert.equal(last("b", "whiteboardState"), undefined, "others stay where they are");

  coordinator.handleMessage(user("a"), { type: "whiteboardUpsert", sheetId: second, elements: [rect("new")] });
  assert.equal(last("b", "whiteboardUpserted"), undefined, "other sheets do not receive edits");

  coordinator.handleMessage(user("b"), { type: "whiteboardRenameSheet", sheetId: second, name: "Plan B" });
  assert.equal(last("a", "whiteboardSheets")!.sheets[1]!.name, "Plan B");
  assert.equal(store.listSheets(BOARD)[1]!.name, "Plan B");

  coordinator.handleMessage(user("b"), { type: "whiteboardSelectSheet", sheetId: second });
  assert.deepEqual(last("b", "whiteboardState")!.elements.map((element) => element.id), ["new"]);
  take("a"); take("b");

  coordinator.handleMessage(user("a"), { type: "whiteboardDeleteSheet", sheetId: second });
  for (const id of ["a", "b"]) {
    const state = last(id, "whiteboardState")!;
    assert.equal(state.sheetId, first, "viewers of a deleted sheet move to the remaining one");
    assert.deepEqual(state.elements.map((element) => element.id), ["old"]);
  }
  assert.equal(store.listSheets(BOARD).length, 1);
  assert.deepEqual(store.loadElements(BOARD, second), []);

  coordinator.handleMessage(user("a"), { type: "whiteboardDeleteSheet", sheetId: first });
  assert.equal(last("a", "whiteboardError")!.code, "WHITEBOARD_LAST_SHEET");
});

test("sheet limits and rate limits are enforced", () => {
  const { coordinator, take, last, user, now } = harness();
  coordinator.handleMessage(user("a"), { type: "whiteboardOpen" });
  const sheetId = last("a", "whiteboardState")!.sheetId;
  for (let index = 1; index < WHITEBOARD_LIMITS.maxSheetsPerBoard; index++) {
    now.value += 1000;
    coordinator.handleMessage(user("a"), { type: "whiteboardCreateSheet", name: "" });
  }
  take("a");
  now.value += 1000;
  coordinator.handleMessage(user("a"), { type: "whiteboardCreateSheet", name: "" });
  assert.equal(last("a", "whiteboardError")!.code, "WHITEBOARD_SHEET_LIMIT");

  coordinator.handleMessage(user("a"), { type: "whiteboardSelectSheet", sheetId });
  take("a");
  for (let index = 0; index < 200; index++) coordinator.handleMessage(user("a"), { type: "whiteboardUpsert", sheetId, elements: [rect(`r${index}`)] });
  assert.equal(last("a", "whiteboardError")!.code, "WHITEBOARD_RATE_LIMITED");
});

test("a sheet over its byte budget rejects the whole change", () => {
  const { coordinator, last, user } = harness();
  coordinator.handleMessage(user("a"), { type: "whiteboardOpen" });
  const sheetId = last("a", "whiteboardState")!.sheetId;
  const image = (id: string): WhiteboardElement => ({ id, type: "image", x: 0, y: 0, w: 10, h: 10, z: 1, stroke: "#000000", strokeWidth: 1, src: `data:image/png;base64,${"A".repeat(2_000_000)}` });
  for (let index = 0; index < 15; index++) coordinator.handleMessage(user("a"), { type: "whiteboardUpsert", sheetId, elements: [image(`i${index}`)] });
  coordinator.handleMessage(user("a"), { type: "whiteboardUpsert", sheetId, elements: [image("over")] });
  assert.equal(last("a", "whiteboardError")!.code, "WHITEBOARD_SHEET_FULL");
});

test("closing and disconnecting remove the cursor peer", () => {
  const { coordinator, last, user } = harness();
  coordinator.handleMessage(user("a"), { type: "whiteboardOpen" });
  coordinator.handleMessage(user("b"), { type: "whiteboardOpen" });
  coordinator.handleMessage(user("b"), { type: "whiteboardClose" });
  assert.deepEqual(last("a", "whiteboardPeers")!.peers.map((peer) => peer.nickname), ["nick-a"]);
  coordinator.removePeer("a");
  assert.equal(coordinator.subscriberCount, 0);
  coordinator.handleMessage(user("a"), { type: "whiteboardCursor", sheetId: "x", x: 1, y: 1 });
  assert.equal(last("a", "whiteboardError")!.code, "WHITEBOARD_NOT_OPEN");
});

test("the SQLite store keeps sheets and elements across restarts", () => {
  const database = new WebSpeakDatabase(":memory:");
  try {
    const store = new SqliteWhiteboardStore(database);
    const first = harness(store);
    first.coordinator.handleMessage(first.user("a"), { type: "whiteboardOpen" });
    const sheetId = first.last("a", "whiteboardState")!.sheetId;
    first.coordinator.handleMessage(first.user("a"), { type: "whiteboardUpsert", sheetId, elements: [rect("r1"), { id: "t1", type: "text", x: 1, y: 2, w: 50, h: 20, z: 2, stroke: "#000000", strokeWidth: 1, text: "Привет", fontSize: 20 }] });
    first.coordinator.handleMessage(first.user("a"), { type: "whiteboardUpsert", sheetId, elements: [rect("r1", 99)] });
    first.coordinator.handleMessage(first.user("a"), { type: "whiteboardCreateSheet", name: "Второй" });

    const second = harness(store);
    second.coordinator.handleMessage(second.user("z"), { type: "whiteboardOpen", sheetId });
    const state = second.last("z", "whiteboardState")!;
    assert.deepEqual(state.sheets.map((sheet) => sheet.name), ["", "Второй"]);
    const byId = new Map(state.elements.map((element) => [element.id, element]));
    assert.equal(byId.get("r1")!.x, 99);
    assert.equal(byId.get("t1")!.text, "Привет");
  } finally {
    database.close();
  }
});

test("client frames are validated before they reach the coordinator", () => {
  assert.equal(parseWhiteboardClientMessage(JSON.stringify({ type: "join" })), null);
  assert.deepEqual(parseWhiteboardClientMessage(JSON.stringify({ type: "whiteboardOpen" })), { type: "whiteboardOpen" });
  const bad = (value: unknown) => assert.ok(parseWhiteboardClientMessage(JSON.stringify(value)) && "error" in parseWhiteboardClientMessage(JSON.stringify(value))!, JSON.stringify(value).slice(0, 80));
  bad({ type: "whiteboardUpsert", sheetId: "s", elements: [{ ...rect("r"), stroke: "red" }] });
  bad({ type: "whiteboardUpsert", sheetId: "s", elements: [{ ...rect("r"), x: Infinity }] });
  bad({ type: "whiteboardUpsert", sheetId: "s", elements: [{ ...rect("r"), type: "script" }] });
  bad({ type: "whiteboardUpsert", sheetId: "s", elements: [{ ...rect("r"), type: "image", src: "javascript:alert(1)" }] });
  bad({ type: "whiteboardUpsert", sheetId: "../x", elements: [rect("r")] });
  bad({ type: "whiteboardUpsert", sheetId: "s", elements: [] });
  bad({ type: "whiteboardDelete", sheetId: "s", ids: ["ok", "no spaces"] });
  const name = parseWhiteboardClientMessage(JSON.stringify({ type: "whiteboardCreateSheet", name: `  a\u0000b  ${"x".repeat(80)}` }));
  assert.ok(name && !("error" in name) && name.type === "whiteboardCreateSheet");
  assert.equal(name.name.length, WHITEBOARD_LIMITS.maxSheetNameLength);
  assert.ok(name.name.startsWith("a b"));
});
