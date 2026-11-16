import assert from "node:assert/strict";
import test from "node:test";
import { parseChessClientMessage, parseChessServerMessage, type ChessRoomView, type ChessServerMessage } from "../shared/chess-room.js";
import { ChessCoordinator, type ChessParticipant } from "./chess-coordinator.js";

function setup() {
  let clock = 1_000_000;
  let ids = 0;
  const timers: Array<{ callback: () => void; at: number; cleared: boolean }> = [];
  const inbox = new Map<string, ChessServerMessage[]>();
  const coordinator = new ChessCoordinator({
    send: (entryId, message) => { inbox.set(entryId, [...(inbox.get(entryId) ?? []), message]); },
    now: () => clock,
    randomId: () => `g${++ids}`,
    setTimer: (callback, ms) => { const timer = { callback, at: clock + ms, cleared: false }; timers.push(timer); return timer; },
    clearTimer: timer => { (timer as { cleared: boolean }).cleared = true; },
  });
  const people: Record<string, ChessParticipant> = {
    ann: { entryId: "e1", nickname: "Ann", seatKey: "uid:a", roomKey: "ts#1" },
    bob: { entryId: "e2", nickname: "Bob", seatKey: "uid:b", roomKey: "ts#1" },
    cid: { entryId: "e3", nickname: "Cid", seatKey: "uid:c", roomKey: "ts#1" },
  };
  const room = (who: string): ChessRoomView => {
    const states = (inbox.get(people[who]!.entryId) ?? []).filter(message => message.type === "chessState");
    const last = states[states.length - 1];
    assert.ok(last && last.type === "chessState");
    return last.room;
  };
  const errors = (who: string) => (inbox.get(people[who]!.entryId) ?? []).flatMap(message => message.type === "chessError" ? [message.code] : []);
  const send = (who: string, message: unknown) => {
    const parsed = parseChessClientMessage(message);
    assert.ok(parsed && !("error" in parsed), JSON.stringify(message));
    coordinator.handleMessage(people[who]!, parsed);
  };
  const tick = (ms: number) => {
    clock += ms;
    for (const timer of timers) if (!timer.cleared && timer.at <= clock) { timer.cleared = true; timer.callback(); }
  };
  for (const who of Object.keys(people)) send(who, { type: "chessOpen" });
  return { coordinator, people, room, errors, send, tick };
}

test("two people sit, start, play to mate; onlookers see the same board", () => {
  const { room, errors, send } = setup();
  send("ann", { type: "chessSit", color: "w" });
  send("bob", { type: "chessSit", color: "w" });
  assert.deepEqual(errors("bob"), ["CHESS_SEAT_TAKEN"]);
  send("bob", { type: "chessSit", color: "b" });
  send("cid", { type: "chessStart" });
  assert.deepEqual(errors("cid"), ["CHESS_NOT_SEATED"]);
  send("bob", { type: "chessClock", minutes: 0, increment: 0 });
  send("bob", { type: "chessStart" });
  const id = room("ann").id;
  assert.equal(room("ann").phase, "playing");
  assert.equal(room("ann").you, "w");
  assert.equal(room("cid").you, null);
  assert.deepEqual(room("cid").spectators, ["Cid"]);
  send("bob", { type: "chessMove", id, from: "e7", to: "e5" });
  assert.deepEqual(errors("bob"), ["CHESS_SEAT_TAKEN", "CHESS_NOT_YOUR_TURN"]);
  send("ann", { type: "chessMove", id, from: "e2", to: "e5" });
  assert.deepEqual(errors("ann"), ["CHESS_ILLEGAL"]);
  for (const [who, from, to] of [["ann", "f2", "f3"], ["bob", "e7", "e5"], ["ann", "g2", "g4"], ["bob", "d8", "h4"]] as const) send(who, { type: "chessMove", id, from, to });
  const end = room("cid");
  assert.deepEqual(end.moves.map(move => move.san), ["f3", "e5", "g4", "Qh4#"]);
  assert.equal(end.phase, "over");
  assert.deepEqual(end.result, { winner: "b", reason: "checkmate" });
  assert.equal(end.times, null, "no clock");
  // A return game swaps the colours once both ask.
  send("ann", { type: "chessRematch", id });
  assert.deepEqual(room("bob").rematch, ["w"]);
  send("bob", { type: "chessRematch", id });
  assert.equal(room("ann").phase, "playing");
  assert.equal(room("ann").you, "b");
  assert.equal(room("ann").white?.name, "Bob");
  assert.notEqual(room("ann").id, id);
});

test("clocks with increment, loss on time, resignation and draw offers", () => {
  const { room, errors, send, tick } = setup();
  send("ann", { type: "chessSit", color: "w" });
  send("bob", { type: "chessSit", color: "b" });
  send("ann", { type: "chessClock", minutes: 1, increment: 2 });
  send("ann", { type: "chessStart" });
  let id = room("ann").id;
  tick(10_000);
  send("ann", { type: "chessMove", id, from: "e2", to: "e4" });
  assert.deepEqual(room("bob").times, { w: 52_000, b: 60_000 });
  assert.equal(room("bob").running, "b");
  tick(60_100);
  assert.deepEqual(room("cid").result, { winner: "w", reason: "timeout" });
  assert.equal(room("cid").times?.b, 0);

  send("ann", { type: "chessRematch", id });
  send("bob", { type: "chessRematch", id });
  id = room("ann").id;
  send("ann", { type: "chessDraw", id, action: "offer" });
  assert.equal(room("bob").drawOffer, "b", "Ann plays black in the return game");
  send("bob", { type: "chessMove", id, from: "d2", to: "d4" });
  assert.equal(room("bob").drawOffer, null, "moving instead of answering declines the offer");
  send("ann", { type: "chessDraw", id, action: "offer" });
  send("ann", { type: "chessMove", id, from: "d7", to: "d5" });
  assert.equal(room("bob").drawOffer, "b", "one's own move keeps one's offer standing");
  send("bob", { type: "chessDraw", id, action: "accept" });
  assert.deepEqual(errors("ann"), []);
  assert.deepEqual(room("ann").result, { winner: null, reason: "agreement" });

  send("ann", { type: "chessRematch", id });
  send("bob", { type: "chessRematch", id });
  id = room("ann").id;
  send("bob", { type: "chessResign", id });
  assert.deepEqual(room("cid").result, { winner: "w", reason: "resign" });
  assert.equal(room("cid").white?.name, "Ann");
});

test("a seat left by someone who went away can be taken; the board answers a reconnect", () => {
  const { coordinator, people, room, errors, send } = setup();
  send("ann", { type: "chessSit", color: "w" });
  coordinator.removePeer("e1");
  assert.equal(room("bob").white?.online, false);
  send("bob", { type: "chessSit", color: "w" });
  assert.deepEqual(errors("bob"), []);
  assert.equal(room("bob").white?.name, "Bob");
  coordinator.handleMessage(people.ann!, { type: "chessOpen" });
  assert.equal(room("ann").you, null);
  // Moving to another channel takes the page to that channel's board.
  coordinator.onRoomChanged({ ...people.bob!, roomKey: "ts#2" });
  assert.equal(room("bob").white, null);
  assert.equal(room("ann").white?.online, false);
});

test("the page checks what it receives", () => {
  assert.equal(parseChessServerMessage({ type: "chessState", room: { id: 1 } }), null);
  assert.deepEqual(parseChessServerMessage({ type: "chessError", code: "X" }), { type: "chessError", code: "X" });
  assert.ok("error" in (parseChessClientMessage({ type: "chessMove", id: "g1", from: "e2", to: "e9" }) ?? {}));
  assert.ok("error" in (parseChessClientMessage({ type: "chessClock", minutes: 7, increment: 0 }) ?? {}));
  assert.equal(parseChessClientMessage({ type: "gameOpen" }), null);
});
