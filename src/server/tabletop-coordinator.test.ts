import assert from "node:assert/strict";
import test from "node:test";
import { TabletopCoordinator, type TableParticipant } from "./tabletop-coordinator.js";
import { parseDiceExpression, parseGameClientMessage, skillBonus, type GameClientMessage, type GameServerMessage, type TableView } from "../shared/tabletop.js";
import { BUILT_IN_ADVENTURES, findHero } from "../shared/tabletop-adventures.js";

function fixture(dice: number[] = []) {
  const sent: Array<{ entryId: string; message: GameServerMessage }> = [];
  let now = 1_000;
  let id = 0;
  const coordinator = new TabletopCoordinator({
    send: (entryId, message) => sent.push({ entryId, message }),
    rollDie: sides => Math.min(sides, dice.shift() ?? 10),
    now: () => (now += 1000),
    randomId: () => `id${++id}`,
  });
  const person = (entryId: string, nickname: string, tableKey: string | null = "ts#1"): TableParticipant => ({ entryId, nickname, seatKey: `uid:${nickname}`, tableKey });
  const send = (who: TableParticipant, message: GameClientMessage) => coordinator.handleMessage(who, message);
  const state = (entryId: string): TableView => {
    const last = sent.filter(item => item.entryId === entryId && item.message.type === "gameState").at(-1);
    assert.ok(last && last.message.type === "gameState" && last.message.table);
    return last.message.table;
  };
  const lastError = (entryId: string) => {
    const last = sent.filter(item => item.entryId === entryId).at(-1)?.message;
    return last?.type === "gameError" ? last.code : null;
  };
  return { coordinator, sent, person, send, state, lastError, dice };
}

test("dice expressions accept the usual notation and refuse anything else", () => {
  assert.deepEqual(parseDiceExpression("2d6+1d4-1"), { terms: [{ count: 2, sides: 6, sign: 1 }, { count: 1, sides: 4, sign: 1 }], modifier: -1 });
  assert.deepEqual(parseDiceExpression("к20 + 5"), { terms: [{ count: 1, sides: 20, sign: 1 }], modifier: 5 });
  for (const bad of ["", "5", "d7", "21d6", "1d20*2", "1d20+x", "99d6"]) assert.equal(parseDiceExpression(bad), null, bad);
});

test("the built-in heroes follow the 5e numbers they show", () => {
  const ilva = findHero("solgard-bell", "ilva")!;
  assert.equal(skillBonus(ilva, "stealth"), 7, "Dex +3 and expertise +4");
  assert.equal(skillBonus(ilva, "perception"), 2);
  assert.equal(skillBonus(ilva, "athletics"), -1);
  for (const hero of BUILT_IN_ADVENTURES[0]!.heroes) for (const attack of hero.attacks) assert.ok(parseDiceExpression(attack.damage), `${hero.id} ${attack.name}`);
});

test("game frames are parsed strictly", () => {
  assert.equal(parseGameClientMessage({ type: "chat" }), null);
  assert.deepEqual(parseGameClientMessage({ type: "gameSeat", role: "gm" }), { type: "gameSeat", role: "gm" });
  assert.ok("error" in (parseGameClientMessage({ type: "gameRoll", source: { type: "free", expr: "1d7" }, mode: "normal", hidden: false }) as object));
  assert.ok("error" in (parseGameClientMessage({ type: "gameCheck", source: { type: "attack", index: 0 }, dc: 10, mode: "normal", targets: [] }) as object));
});

test("a table goes from seats to a running game and back", () => {
  const f = fixture();
  const gm = f.person("a", "Alex");
  const sasha = f.person("b", "Sasha");
  f.send(gm, { type: "gameOpen" });
  f.send(sasha, { type: "gameOpen" });
  f.send(gm, { type: "gameSeat", role: "gm" });
  f.send(sasha, { type: "gameSeat", role: "gm" });
  assert.equal(f.lastError("b"), "GM_SEAT_TAKEN");
  f.send(sasha, { type: "gameSeat", role: "player" });
  f.send(sasha, { type: "gameHero", heroId: "ilva" });
  assert.equal(f.lastError("b"), "UNKNOWN_HERO", "no adventure chosen yet");
  f.send(sasha, { type: "gameAdventure", adventureId: "solgard-bell" });
  assert.equal(f.lastError("b"), "GM_ONLY");
  f.send(gm, { type: "gameAdventure", adventureId: "solgard-bell" });
  f.send(sasha, { type: "gameHero", heroId: "ilva" });
  f.send(gm, { type: "gameStart" });
  assert.equal(f.lastError("a"), "PLAYERS_NOT_READY");
  f.send(sasha, { type: "gameReady", ready: true });
  f.send(gm, { type: "gameStart" });
  const view = f.state("b");
  assert.equal(view.phase, "playing");
  assert.equal(view.you.role, "player");
  assert.deepEqual(view.players.map(seat => [seat.nickname, seat.heroId, seat.hp, seat.online]), [["Sasha", "ilva", 10, true]]);
  f.send(gm, { type: "gameEnd" });
  assert.equal(f.state("a").phase, "lobby");
  assert.equal(f.state("a").players[0]!.ready, false);
});

test("the gateway rolls: skill bonuses, advantage, hidden rolls and checks with a secret difficulty", () => {
  const f = fixture();
  const gm = f.person("a", "Alex");
  const sasha = f.person("b", "Sasha");
  const kria = f.person("c", "Kria");
  for (const who of [gm, sasha, kria]) f.send(who, { type: "gameOpen" });
  f.send(gm, { type: "gameSeat", role: "gm" });
  f.send(gm, { type: "gameAdventure", adventureId: "solgard-bell" });
  f.send(sasha, { type: "gameSeat", role: "player" });
  f.send(sasha, { type: "gameHero", heroId: "ilva" });
  f.send(sasha, { type: "gameReady", ready: true });
  f.send(gm, { type: "gameStart" });

  f.dice.push(4, 15);
  f.send(sasha, { type: "gameRoll", source: { type: "skill", skill: "stealth" }, mode: "advantage", hidden: false });
  const rolled = f.sent.filter(item => item.entryId === "c" && item.message.type === "gameRolled").at(-1)!.message;
  assert.ok(rolled.type === "gameRolled");
  assert.equal(rolled.roll.total, 22, "15 kept + 7");
  assert.equal(rolled.roll.natural, 15);
  assert.deepEqual(rolled.roll.dice, [{ sides: 20, value: 4, dropped: true }, { sides: 20, value: 15 }]);

  f.send(kria, { type: "gameRoll", source: { type: "free", expr: "1d20" }, mode: "normal", hidden: false });
  assert.equal(f.lastError("c"), "NOT_SEATED", "spectators watch");

  f.dice.push(3);
  f.send(gm, { type: "gameRoll", source: { type: "free", expr: "1d20+2" }, mode: "normal", hidden: true });
  assert.equal(f.state("a").rolls.at(-1)!.total, 5);
  assert.deepEqual(f.state("b").rolls.at(-1), { id: "id2", at: f.state("b").rolls.at(-1)!.at, by: "Alex", label: "Скрытый бросок ведущего", secret: true, hidden: true });

  f.send(gm, { type: "gameCheck", source: { type: "skill", skill: "perception" }, dc: 14, mode: "normal", targets: [] });
  const check = f.state("b").checks[0]!;
  assert.equal(check.dc, undefined, "players never see the difficulty");
  assert.equal(f.state("a").checks[0]!.dc, 14);
  f.dice.push(11);
  f.send(sasha, { type: "gameRoll", source: { type: "free", expr: "1d4" }, mode: "normal", hidden: true, checkId: check.id });
  const result = f.state("b").rolls.at(-1)!;
  assert.equal(result.label, "Мудрость (Внимательность)", "the check decides what is rolled");
  assert.equal(result.total, 13);
  assert.equal(result.success, false);
  assert.equal(result.hidden, false, "players cannot hide rolls");
  assert.equal(result.dc, undefined);
  assert.equal(f.state("a").rolls.at(-1)!.dc, 14);
  assert.deepEqual(f.state("b").checks, [], "answered checks close");
  f.send(sasha, { type: "gameRoll", source: { type: "free", expr: "1d4" }, mode: "normal", hidden: false, checkId: check.id });
  assert.equal(f.lastError("b"), "CHECK_NOT_PENDING");
});

test("seats survive reconnects and follow the person between channels", () => {
  const f = fixture();
  f.send(f.person("a", "Alex"), { type: "gameOpen" });
  f.send(f.person("a", "Alex"), { type: "gameSeat", role: "gm" });
  f.coordinator.removePeer("a");
  const again = f.person("z", "Alex");
  f.send(again, { type: "gameOpen" });
  assert.equal(f.state("z").you.role, "gm", "the same unique id keeps the game master's seat");
  f.coordinator.onTableChanged({ ...again, tableKey: "ts#2" });
  assert.equal(f.state("z").gm, null, "another channel has its own table");
  f.coordinator.onTableChanged({ ...again, tableKey: "ts#1" });
  assert.equal(f.state("z").gm?.online, true);
});
