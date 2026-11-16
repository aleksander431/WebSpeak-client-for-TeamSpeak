import assert from "node:assert/strict";
import test from "node:test";
import { dealtMafia, DEFAULT_MAFIA_SETTINGS, mafiaCountFor, parseMafiaClientMessage, parseMafiaServerMessage, type MafiaRoomView, type MafiaServerMessage } from "../shared/mafia.js";
import { MafiaCoordinator, type MafiaParticipant } from "./mafia-coordinator.js";

const NAMES = ["Ann", "Bob", "Cid", "Dan", "Eve", "Fay"];

function setup(count = 6, options: { random?: (max: number) => number } = {}) {
  let clock = 5_000_000;
  let ids = 0;
  const timers: Array<{ callback: () => void; at: number; cleared: boolean }> = [];
  const inbox = new Map<string, MafiaServerMessage[]>();
  const coordinator = new MafiaCoordinator({
    send: (entryId, message) => { inbox.set(entryId, [...(inbox.get(entryId) ?? []), message]); },
    now: () => clock,
    randomId: () => `m${++ids}`,
    // No shuffle: roles are dealt in order (mafia first, then doctor, detective, citizens).
    random: options.random ?? (max => max - 1),
    setTimer: (callback, ms) => { const timer = { callback, at: clock + ms, cleared: false }; timers.push(timer); return timer; },
    clearTimer: timer => { (timer as { cleared: boolean }).cleared = true; },
  });
  const people = NAMES.slice(0, count).map((name, index): MafiaParticipant => ({ entryId: `e${index}`, nickname: name, seatKey: `uid:${name}`, roomKey: "ts#1" }));
  const spectator: MafiaParticipant = { entryId: "e-spec", nickname: "Zed", seatKey: "uid:Zed", roomKey: "ts#1" };
  const who = (name: string) => name === "Zed" ? spectator : people.find(person => person.nickname === name)!;
  const view = (name: string): MafiaRoomView => {
    const states = (inbox.get(who(name).entryId) ?? []).filter(message => message.type === "mafiaState");
    const last = states[states.length - 1];
    assert.ok(last && last.type === "mafiaState");
    return last.room;
  };
  const errors = (name: string) => (inbox.get(who(name).entryId) ?? []).flatMap(message => message.type === "mafiaError" ? [message.code] : []);
  const send = (name: string, message: Record<string, unknown>) => {
    const parsed = parseMafiaClientMessage(message);
    assert.ok(parsed && !("error" in parsed), JSON.stringify(message));
    coordinator.handleMessage(who(name), parsed);
  };
  const tick = (ms: number) => {
    clock += ms;
    for (const timer of timers) if (!timer.cleared && timer.at <= clock) { timer.cleared = true; timer.callback(); }
  };
  const idOf = (name: string) => view("Zed").players.find(player => player.name === name)!.id;
  for (const person of people) coordinator.handleMessage(person, { type: "mafiaOpen" });
  coordinator.handleMessage(spectator, { type: "mafiaOpen" });
  for (const person of people) send(person.nickname, { type: "mafiaJoin" });
  return { coordinator, view, errors, send, tick, idOf, people };
}

/** With the dealing above and six players: Ann and Bob mafia, Cid doctor, Dan detective, Eve and Fay citizens. */
function started(count = 6, settings: Partial<typeof DEFAULT_MAFIA_SETTINGS> = {}) {
  const table = setup(count);
  table.send("Ann", { type: "mafiaSettings", settings: { ...DEFAULT_MAFIA_SETTINGS, ...settings } });
  table.send("Ann", { type: "mafiaStart" });
  return { ...table, game: table.view("Ann").id };
}

test("how many mafia a table gets, and tables that cannot be dealt", () => {
  assert.deepEqual([4, 5, 6, 8, 9, 12, 16].map(mafiaCountFor), [1, 1, 2, 2, 3, 4, 5]);
  assert.equal(dealtMafia(3, DEFAULT_MAFIA_SETTINGS), null);
  assert.equal(dealtMafia(6, { ...DEFAULT_MAFIA_SETTINGS, mafia: 3 }), null, "the town must outnumber the mafia");
  assert.equal(dealtMafia(6, { ...DEFAULT_MAFIA_SETTINGS, mafia: 2 }), 2);
});

test("roles are secret: each sees their own, the mafia see each other, onlookers see nothing", () => {
  const { view, errors, send } = started();
  assert.equal(view("Ann").phase, "night");
  assert.deepEqual(view("Ann").players.map(player => player.role), ["mafia", "mafia", null, null, null, null]);
  assert.deepEqual(view("Cid").players.map(player => player.role), [null, null, "doctor", null, null, null]);
  assert.ok(view("Zed").players.every(player => player.role === null));
  assert.equal(view("Zed").you, null);
  assert.deepEqual(view("Zed").spectators, ["Zed"]);
  send("Eve", { type: "mafiaAct", id: view("Eve").id, target: "p1" });
  assert.deepEqual(errors("Eve"), ["MAFIA_NO_ACTION"], "citizens sleep");
  send("Ann", { type: "mafiaAct", id: view("Ann").id, target: "p2" });
  assert.deepEqual(errors("Ann"), ["MAFIA_BAD_TARGET"], "no killing one's own");
  send("Ann", { type: "mafiaChat", id: view("Ann").id, text: "Ева?" });
  assert.deepEqual(view("Bob").chat.map(message => message.text), ["Ева?"]);
  assert.deepEqual(view("Eve").chat, [], "the town never sees the mafia's chat");
});

test("a full game: the doctor saves, the detective finds, the town votes the mafia out", () => {
  const { view, send, idOf, game } = started();
  // Night 1: mafia go for Eve, the doctor guesses right, the detective checks Ann.
  send("Ann", { type: "mafiaAct", id: game, target: idOf("Eve") });
  send("Bob", { type: "mafiaAct", id: game, target: idOf("Eve") });
  assert.deepEqual(view("Ann").secret.picks, [{ from: idOf("Ann"), to: idOf("Eve") }, { from: idOf("Bob"), to: idOf("Eve") }]);
  send("Dan", { type: "mafiaAct", id: game, target: idOf("Ann") });
  assert.deepEqual(view("Dan").secret.checks, [{ round: 1, target: idOf("Ann"), mafia: true }]);
  assert.equal(view("Ann").phase, "night", "the doctor has not chosen yet");
  send("Cid", { type: "mafiaAct", id: game, target: idOf("Eve") });
  assert.equal(view("Zed").phase, "day");
  assert.deepEqual(view("Zed").log.at(-1), { kind: "quiet", round: 1 });
  // Day 1: the host calls the vote, the town picks Ann.
  send("Ann", { type: "mafiaAdvance", id: game });
  assert.equal(view("Bob").phase, "vote");
  for (const voter of ["Cid", "Dan", "Eve", "Fay"]) send(voter, { type: "mafiaVote", id: game, target: idOf("Ann") });
  assert.equal(view("Zed").players.find(player => player.name === "Eve")!.vote, idOf("Ann"), "voting is open");
  send("Ann", { type: "mafiaVote", id: game, target: "skip" });
  send("Bob", { type: "mafiaVote", id: game, target: idOf("Fay") });
  assert.deepEqual(view("Zed").log.at(-2), { kind: "executed", round: 1, name: "Ann", role: "mafia", votes: 4 });
  assert.equal(view("Zed").players[0]!.role, "mafia", "the dead are revealed");
  // Night 2: the doctor may not heal Eve twice in a row; Bob kills Fay.
  assert.equal(view("Cid").phase, "night");
  assert.equal(view("Cid").secret.lastHeal, idOf("Eve"));
  send("Cid", { type: "mafiaAct", id: game, target: idOf("Eve") });
  assert.equal(view("Cid").acted, null);
  send("Cid", { type: "mafiaAct", id: game, target: idOf("Cid") });
  send("Dan", { type: "mafiaAct", id: game, target: idOf("Bob") });
  send("Bob", { type: "mafiaAct", id: game, target: idOf("Fay") });
  assert.deepEqual(view("Zed").log.at(-1), { kind: "killed", round: 2, name: "Fay", role: "citizen" });
  send("Bob", { type: "mafiaAdvance", id: game });
  assert.equal(view("Zed").phase, "day", "only the host moves the day on");
  send("Ann", { type: "mafiaAdvance", id: game });
  for (const voter of ["Cid", "Dan", "Eve"]) send(voter, { type: "mafiaVote", id: game, target: idOf("Bob") });
  send("Bob", { type: "mafiaVote", id: game, target: idOf("Dan") });
  const end = view("Zed");
  assert.equal(end.phase, "over");
  assert.equal(end.winner, "town");
  assert.deepEqual(end.players.map(player => player.role), ["mafia", "mafia", "doctor", "detective", "citizen", "citizen"]);
  // Back to the table for another round with the same people.
  send("Ann", { type: "mafiaReset" });
  assert.equal(view("Eve").phase, "lobby");
  assert.equal(view("Eve").players.length, 6);
  assert.ok(view("Eve").players.every(player => player.alive && player.role === null));
});

test("the mafia win once they match the town; a split mafia waits for the clock; ties spare everyone", () => {
  const { view, send, tick, idOf, game } = started(6, { nightSeconds: 30, daySeconds: 0, voteSeconds: 0 });
  send("Ann", { type: "mafiaAct", id: game, target: idOf("Eve") });
  send("Bob", { type: "mafiaAct", id: game, target: idOf("Fay") });
  send("Cid", { type: "mafiaAct", id: game, target: idOf("Cid") });
  send("Dan", { type: "mafiaAct", id: game, target: idOf("Cid") });
  assert.equal(view("Zed").phase, "night", "the mafia disagree");
  assert.ok(view("Zed").endsIn! <= 30_000);
  tick(30_000);
  assert.equal(view("Zed").phase, "day");
  // The test's lot takes the last leader: Fay.
  assert.deepEqual(view("Zed").log.at(-1), { kind: "killed", round: 1, name: "Fay", role: "citizen" });
  assert.equal(view("Zed").endsIn, null, "no day timer");
  send("Ann", { type: "mafiaAdvance", id: game });
  send("Ann", { type: "mafiaVote", id: game, target: idOf("Ann") });
  assert.equal(view("Ann").players[0]!.vote, null, "nobody votes for themselves");
  for (const [voter, target] of [["Ann", "Cid"], ["Bob", "Cid"], ["Cid", "Ann"], ["Dan", "Ann"], ["Eve", "skip"]] as const) send(voter, { type: "mafiaVote", id: game, target: target === "skip" ? "skip" : idOf(target) });
  assert.deepEqual(view("Zed").log.at(-2), { kind: "spared", round: 1 });
  send("Ann", { type: "mafiaAct", id: game, target: idOf("Eve") });
  send("Bob", { type: "mafiaAct", id: game, target: idOf("Eve") });
  send("Cid", { type: "mafiaAct", id: game, target: idOf("Dan") });
  send("Dan", { type: "mafiaAct", id: game, target: idOf("Bob") });
  // Eve dies: 2 mafia against Cid and Dan.
  assert.equal(view("Zed").phase, "over");
  assert.equal(view("Zed").winner, "mafia");
});

test("lobby rules, the host, players who go away, and onlookers who cannot join a running game", () => {
  const { coordinator, view, errors, send, people } = setup(4);
  send("Bob", { type: "mafiaStart" });
  assert.deepEqual(errors("Bob"), ["MAFIA_NOT_HOST"]);
  assert.equal(view("Ann").youHost, true);
  coordinator.removePeer("e0");
  assert.deepEqual(view("Bob").players.map(player => player.name), ["Bob", "Cid", "Dan"], "leaving the channel before the start leaves the table");
  assert.equal(view("Bob").youHost, true, "the next player hosts");
  send("Bob", { type: "mafiaStart" });
  assert.deepEqual(errors("Bob"), ["MAFIA_NOT_HOST", "MAFIA_TOO_FEW"]);
  coordinator.handleMessage(people[0]!, { type: "mafiaOpen" });
  send("Ann", { type: "mafiaJoin" });
  send("Bob", { type: "mafiaStart" });
  assert.equal(view("Ann").phase, "night");
  send("Zed", { type: "mafiaJoin" });
  assert.deepEqual(errors("Zed"), ["MAFIA_IN_PROGRESS"]);
  // A player who goes away mid-game keeps the role; the host may then remove them.
  coordinator.removePeer("e3");
  assert.equal(view("Bob").players.find(player => player.name === "Dan")!.online, false);
  send("Bob", { type: "mafiaKick", player: view("Bob").players.find(player => player.name === "Dan")!.id });
  assert.equal(view("Bob").players.find(player => player.name === "Dan")!.alive, false);
  assert.deepEqual(view("Bob").log.at(-1), { kind: "left", name: "Dan", role: "detective" });
  assert.equal(view("Bob").phase, "night", "the night goes on without the detective");
});

test("the page checks what it receives", () => {
  assert.equal(parseMafiaServerMessage({ type: "mafiaState", room: { id: "x" } }), null);
  assert.ok("error" in (parseMafiaClientMessage({ type: "mafiaSettings", settings: { ...DEFAULT_MAFIA_SETTINGS, nightSeconds: 45 } }) ?? {}));
  assert.ok("error" in (parseMafiaClientMessage({ type: "mafiaChat", id: "m1", text: "   " }) ?? {}));
  assert.equal(parseMafiaClientMessage({ type: "chessOpen" }), null);
});
