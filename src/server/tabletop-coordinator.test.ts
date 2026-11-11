import assert from "node:assert/strict";
import test from "node:test";
import { TabletopCoordinator, conditionMode, type TableParticipant, type TabletopStore } from "./tabletop-coordinator.js";
import { parseDiceExpression, parseGameClientMessage, skillBonus, type AdventureSummary, type GameClientMessage, type GameServerMessage, type TableView } from "../shared/tabletop.js";
import { BUILT_IN_ADVENTURES, findHero } from "../shared/tabletop-adventures.js";

/** The built-in adventure without its prepared encounters, music and lit areas: the older tests set maps up by hand. */
const BARE_ADVENTURES = BUILT_IN_ADVENTURES.map(adventure => ({
  ...adventure,
  combatMusic: undefined,
  scenes: adventure.scenes.map(({ encounter: _encounter, reveal: _reveal, music: _music, ...scene }) => scene),
}));

function fixture(dice: number[] = [], adventures: readonly AdventureSummary[] = BARE_ADVENTURES, store?: TabletopStore) {
  const sent: Array<{ entryId: string; message: GameServerMessage }> = [];
  let now = 1_000;
  let id = 0;
  const coordinator = new TabletopCoordinator({
    send: (entryId, message) => sent.push({ entryId, message }),
    rollDie: sides => Math.min(sides, dice.shift() ?? 10),
    now: () => (now += 1000),
    randomId: () => `id${++id}`,
    adventures: () => adventures,
    ...(store ? { store } : {}),
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

test("maps: hero tokens at the entrance, fog hides monsters from players, scenes keep their state", () => {
  const f = fixture();
  const gm = f.person("a", "Alex");
  const sasha = f.person("b", "Sasha");
  const kria = f.person("c", "Kria");
  for (const who of [gm, sasha, kria]) f.send(who, { type: "gameOpen" });
  f.send(gm, { type: "gameSeat", role: "gm" });
  f.send(gm, { type: "gameAdventure", adventureId: "solgard-bell" });
  for (const [who, hero] of [[sasha, "ilva"], [kria, "grom"]] as const) {
    f.send(who, { type: "gameSeat", role: "player" });
    f.send(who, { type: "gameHero", heroId: hero });
    f.send(who, { type: "gameReady", ready: true });
  }
  f.send(gm, { type: "gameStart" });
  assert.equal(f.state("b").map, null, "the tavern is a story scene");
  f.send(gm, { type: "gameTokenAdd", monsterId: "skeleton", x: 1, y: 1 });
  assert.equal(f.lastError("a"), "NO_MAP");

  f.send(sasha, { type: "gameScene", index: 2 });
  assert.equal(f.lastError("b"), "GM_ONLY");
  f.send(gm, { type: "gameScene", index: 2 });
  const map = f.state("b").map!;
  assert.equal(map.cols * map.rows, map.fog.length);
  const heroes = map.tokens.filter(token => token.kind === "hero");
  assert.deepEqual(heroes.map(token => [token.heroId, token.x, token.y]), [["ilva", 11, 15], ["grom", 12, 15]]);
  assert.equal(map.fog[13 * map.cols + 11], "1", "light around the heroes");
  assert.equal(map.fog[2 * map.cols + 2], "0");

  const ilva = heroes.find(token => token.heroId === "ilva")!;
  const grom = heroes.find(token => token.heroId === "grom")!;
  f.send(sasha, { type: "gameTokenMove", id: ilva.id, x: 2, y: 2 });
  assert.equal(f.lastError("b"), "IN_FOG");
  f.send(sasha, { type: "gameTokenMove", id: grom.id, x: 12, y: 14 });
  assert.equal(f.lastError("b"), "NOT_YOUR_TOKEN");
  f.send(sasha, { type: "gameTokenMove", id: ilva.id, x: 12, y: 15 });
  assert.equal(f.lastError("b"), "CELL_TAKEN");
  f.send(sasha, { type: "gameTokenMove", id: ilva.id, x: 11, y: 14 });
  assert.deepEqual(f.state("c").map!.tokens.find(token => token.id === ilva.id)!.y, 14);

  f.send(gm, { type: "gameTokenAdd", monsterId: "skeleton", x: 3, y: 3 });
  f.send(gm, { type: "gameTokenAdd", monsterId: "skeleton", x: 4, y: 3 });
  const gmTokens = f.state("a").map!.tokens.filter(token => token.kind === "monster");
  assert.deepEqual(gmTokens.map(token => [token.name, token.hp]), [["Скелет 1", 13], ["Скелет 2", 13]]);
  assert.equal(f.state("b").map!.tokens.filter(token => token.kind === "monster").length, 0, "under fog");

  f.send(gm, { type: "gameFog", cells: [3 * 24 + 3, 3 * 24 + 4], reveal: true });
  let seen = f.state("b").map!.tokens.filter(token => token.kind === "monster");
  assert.equal(seen.length, 2);
  assert.equal(seen[0]!.hp, undefined, "players never see monster hit points");
  f.send(gm, { type: "gameTokenHp", id: gmTokens[0]!.id, hp: 6 });
  f.send(gm, { type: "gameTokenHide", id: gmTokens[1]!.id, hidden: true });
  seen = f.state("b").map!.tokens.filter(token => token.kind === "monster");
  assert.deepEqual(seen.map(token => [token.name, token.condition]), [["Скелет 1", "bloodied"]]);
  assert.equal(f.state("a").map!.tokens.find(token => token.id === gmTokens[1]!.id)!.hidden, true);

  f.send(sasha, { type: "gamePing", x: 5.5, y: 3.5 });
  const ping = f.sent.filter(item => item.entryId === "c" && item.message.type === "gamePinged").at(-1)!.message;
  assert.deepEqual(ping, { type: "gamePinged", by: "Ильва Тенепряд", x: 5.5, y: 3.5, gm: false });

  f.send(gm, { type: "gameScene", index: 3 });
  assert.equal(f.state("b").map!.tokens.filter(token => token.kind === "monster").length, 0, "a fresh crypt");
  f.send(gm, { type: "gameScene", index: 2 });
  assert.equal(f.state("a").map!.tokens.filter(token => token.kind === "monster").length, 2, "the hall as we left it");
  f.send(gm, { type: "gameFogAll", reveal: false });
  assert.equal(f.state("b").map!.fog.includes("1"), false);

  f.send(kria, { type: "gameSeat", role: "spectator" });
  assert.equal(f.state("a").map!.tokens.some(token => token.heroId === "grom"), false, "a hero leaves with its player");
  f.send(gm, { type: "gameEnd" });
  assert.equal(f.state("a").map, null);
});

test("combat: initiative, turns, attacks against a target, damage in one click, death saves", () => {
  const f = fixture();
  const gm = f.person("a", "Alex");
  const sasha = f.person("b", "Sasha");
  const kria = f.person("c", "Kria");
  for (const who of [gm, sasha, kria]) f.send(who, { type: "gameOpen" });
  f.send(gm, { type: "gameSeat", role: "gm" });
  f.send(gm, { type: "gameAdventure", adventureId: "solgard-bell" });
  for (const [who, hero] of [[sasha, "ilva"], [kria, "grom"]] as const) {
    f.send(who, { type: "gameSeat", role: "player" });
    f.send(who, { type: "gameHero", heroId: hero });
    f.send(who, { type: "gameReady", ready: true });
  }
  f.send(gm, { type: "gameStart" });
  f.send(gm, { type: "gameCombatStart" });
  assert.equal(f.lastError("a"), "NO_MAP");
  f.send(gm, { type: "gameScene", index: 2 });
  f.send(gm, { type: "gameTokenAdd", monsterId: "skeleton", x: 11, y: 13 });
  f.send(gm, { type: "gameTokenAdd", monsterId: "ghoul", x: 3, y: 3 });
  const tokens = f.state("a").map!.tokens;
  const ilva = tokens.find(token => token.heroId === "ilva")!;
  const skeleton = tokens.find(token => token.monsterId === "skeleton")!;

  f.send(sasha, { type: "gameCombatStart" });
  assert.equal(f.lastError("b"), "GM_ONLY");
  f.dice.push(15, 3);
  f.send(gm, { type: "gameCombatStart" });
  let combat = f.state("a").combat!;
  assert.equal(combat.phase, "initiative");
  assert.deepEqual(combat.order.map(item => [item.name, item.initiative]), [["Ильва Тенепряд", null], ["Гром Дарвин", null], ["Скелет 1", 17], ["Упырь 1", 5]]);
  assert.equal(f.state("b").combat!.order.length, 3, "players do not see the ghoul in the dark");

  f.dice.push(18);
  f.send(sasha, { type: "gameRoll", source: { type: "initiative" }, mode: "normal", hidden: false });
  f.dice.push(4);
  f.send(gm, { type: "gameCombatRollAll" });
  combat = f.state("a").combat!;
  assert.equal(combat.phase, "running");
  assert.equal(combat.round, 1);
  assert.deepEqual(combat.order.map(item => [item.name, item.initiative]), [["Ильва Тенепряд", 21], ["Скелет 1", 17], ["Упырь 1", 5], ["Гром Дарвин", 5]], "ties go to the higher Dexterity");
  assert.equal(combat.activeId, combat.order[0]!.id);

  f.send(kria, { type: "gameCombatNext" });
  assert.equal(f.lastError("c"), "NOT_YOUR_TURN");
  f.send(sasha, { type: "gameCombatNext" });
  assert.equal(f.state("b").combat!.activeId, combat.order[1]!.id, "the skeleton's turn");

  f.send(sasha, { type: "gameRoll", source: { type: "monsterAttack", tokenId: skeleton.id, index: 0 }, mode: "normal", hidden: false });
  assert.equal(f.lastError("b"), "GM_ONLY");
  f.dice.push(12);
  f.send(gm, { type: "gameRoll", source: { type: "monsterAttack", tokenId: skeleton.id, index: 0 }, mode: "normal", hidden: false, targetId: ilva.id });
  let seen = f.state("b").rolls.at(-1)!;
  assert.deepEqual([seen.heroName, seen.label, seen.total, seen.targetName, seen.hit, seen.targetAc], ["Скелет 1", "Атака: Короткий меч", 16, "Ильва Тенепряд", true, undefined]);
  assert.equal(f.state("a").rolls.at(-1)!.targetAc, 14);

  f.dice.push(5);
  f.send(gm, { type: "gameRoll", source: { type: "monsterDamage", tokenId: skeleton.id, index: 0 }, mode: "normal", hidden: false, targetId: ilva.id });
  const hit = f.state("a").rolls.at(-1)!;
  assert.deepEqual([hit.total, hit.damage, hit.applied], [7, true, false]);
  f.send(sasha, { type: "gameApply", rollId: hit.id, half: false });
  assert.equal(f.lastError("b"), "GM_ONLY");
  f.send(gm, { type: "gameApply", rollId: hit.id, half: false });
  assert.equal(f.state("b").players.find(seat => seat.heroId === "ilva")!.hp, 3);
  f.send(gm, { type: "gameApply", rollId: hit.id, half: false });
  assert.equal(f.lastError("a"), "ALREADY_APPLIED");
  f.dice.push(6);
  f.send(gm, { type: "gameRoll", source: { type: "monsterDamage", tokenId: skeleton.id, index: 0 }, mode: "normal", hidden: false, targetId: ilva.id });
  f.send(gm, { type: "gameApply", rollId: f.state("a").rolls.at(-1)!.id, half: false });
  assert.deepEqual(f.state("b").players.find(seat => seat.heroId === "ilva")!.dying, { successes: 0, failures: 0, state: "dying" });

  f.send(kria, { type: "gameRoll", source: { type: "deathSave" }, mode: "normal", hidden: false });
  assert.equal(f.lastError("c"), "NOT_DYING");
  f.dice.push(9);
  f.send(sasha, { type: "gameRoll", source: { type: "deathSave" }, mode: "normal", hidden: false });
  assert.equal(f.state("b").rolls.at(-1)!.deathSave, "failure");
  f.dice.push(1);
  f.send(sasha, { type: "gameRoll", source: { type: "deathSave" }, mode: "normal", hidden: false });
  assert.equal(f.state("b").players.find(seat => seat.heroId === "ilva")!.dying!.state, "dead", "a natural 1 counts twice");

  f.send(gm, { type: "gameCombatNext" });
  assert.equal(f.state("b").combat!.activeId, null, "the ghoul acts unseen");
  assert.equal(f.state("b").combat!.activeHidden, true);
  f.send(gm, { type: "gameTokenHp", id: skeleton.id, hp: 0 });
  f.send(gm, { type: "gameCombatNext" });
  f.send(kria, { type: "gameCombatNext" });
  combat = f.state("a").combat!;
  assert.equal(combat.round, 2);
  assert.equal(combat.order.find(item => item.id === combat.activeId)!.name, "Упырь 1", "the dead hero and the destroyed skeleton are skipped");

  f.send(gm, { type: "gameScene", index: 3 });
  assert.equal(f.state("a").combat, null, "a fight belongs to its map");
});

test("story: prepared encounters, lit areas, narration and music that follows scenes and combat", () => {
  const f = fixture([], BUILT_IN_ADVENTURES);
  const gm = f.person("a", "Alex");
  const sasha = f.person("b", "Sasha");
  for (const who of [gm, sasha]) f.send(who, { type: "gameOpen" });
  f.send(gm, { type: "gameSeat", role: "gm" });
  f.send(gm, { type: "gameAdventure", adventureId: "solgard-bell" });
  f.send(sasha, { type: "gameSeat", role: "player" });
  f.send(sasha, { type: "gameHero", heroId: "ilva" });
  f.send(sasha, { type: "gameReady", ready: true });
  assert.equal(f.state("a").music, null, "the lobby is silent");
  const data = (entryId: string) => {
    const last = f.sent.filter(item => item.entryId === entryId && item.message.type === "gameAdventureData").at(-1)?.message;
    assert.ok(last?.type === "gameAdventureData");
    return last.adventure;
  };
  assert.match(data("a").scenes[2]!.notes ?? "", /скелета/, "the game master gets the notes");
  assert.equal(data("b").scenes[2]!.notes, undefined, "players do not");
  assert.equal(data("b").scenes[2]!.encounter, undefined);
  assert.equal(f.sent.filter(item => item.entryId === "b" && item.message.type === "gameAdventureData").length, 1, "sent once, not with every state");
  f.send(gm, { type: "gameStart" });
  assert.equal(f.state("b").music!.trackId, "tavern");
  assert.equal(f.state("b").musicAuto, true);

  f.send(sasha, { type: "gameNarrate" });
  assert.equal(f.lastError("b"), "GM_ONLY");
  f.send(gm, { type: "gameNarrate" });
  const narration = f.state("b").narration!;
  assert.equal(narration.title, "Таверна «Ржавый якорь»");
  assert.match(narration.text, /^Дождь третий день/);
  f.send(gm, { type: "gameNarrate", text: "Дверь со скрипом открывается." });
  assert.equal(f.state("b").narration!.text, "Дверь со скрипом открывается.");

  f.send(gm, { type: "gameScene", index: 2 });
  assert.equal(f.state("b").narration, null, "a new scene clears the narration");
  assert.equal(f.state("b").music!.trackId, "catacombs");
  const gmMap = f.state("a").map!;
  assert.deepEqual(gmMap.tokens.filter(token => token.kind === "monster").map(token => [token.name, token.hidden ?? false]),
    [["Скелет 1", false], ["Скелет 2", false], ["Скелет 3", false], ["Гигантская крыса 1", true], ["Гигантская крыса 2", true]]);
  assert.equal(gmMap.fog[12 * gmMap.cols + 9], "1", "the stairs are lit");
  assert.equal(f.state("b").map!.tokens.some(token => token.monsterId === "giant-rat"), false);

  f.send(gm, { type: "gameCombatStart" });
  assert.equal(f.state("b").music!.trackId, "battle");
  f.send(gm, { type: "gameCombatEnd" });
  assert.equal(f.state("b").music!.trackId, "catacombs");

  f.send(gm, { type: "gameMusic", trackId: "nope" });
  assert.equal(f.lastError("a"), "UNKNOWN_TRACK");
  f.send(gm, { type: "gameMusic", trackId: "finale" });
  f.send(gm, { type: "gameScene", index: 3 });
  assert.deepEqual([f.state("b").music!.trackId, f.state("b").musicAuto], ["finale", false], "a chosen track stays");
  f.send(gm, { type: "gameMusic", trackId: null });
  assert.equal(f.state("b").music, null);
  f.send(gm, { type: "gameMusicAuto" });
  assert.equal(f.state("b").music!.trackId, "catacombs");
  f.send(gm, { type: "gameEnd" });
  assert.equal(f.state("b").music, null);
});

test("hero builder: a player's own hero is built by the gateway, plays like any other and leaves with its seat", () => {
  const f = fixture([15, 12]);
  const gm = f.person("a", "Alex");
  const sasha = f.person("b", "Sasha");
  for (const who of [gm, sasha]) f.send(who, { type: "gameOpen" });
  f.send(gm, { type: "gameSeat", role: "gm" });
  f.send(sasha, { type: "gameSeat", role: "player" });
  const choices = {
    name: "Вера", race: "human", cls: "ranger", method: "array",
    abilities: { str: 12, dex: 15, con: 14, int: 8, wis: 13, cha: 10 },
    classSkills: ["perception", "stealth", "survival"], backgroundSkills: ["athletics", "nature"], portrait: "human-f-fighter",
  };
  f.send(gm, { type: "gameCustomHero", choices });
  assert.equal(f.lastError("a"), "PLAYERS_ONLY");
  f.send(sasha, { type: "gameCustomHero", choices: { ...choices, name: "" } });
  assert.equal(f.lastError("b"), "HERO_NAME");
  f.send(sasha, { type: "gameCustomHero", choices: { ...choices, abilities: { ...choices.abilities, str: 18 } } });
  assert.equal(f.lastError("b"), "HERO_ABILITIES", "numbers are checked, not trusted");
  f.send(sasha, { type: "gameCustomHero", choices });
  let view = f.state("a");
  const hero = view.customHeroes[0]!;
  assert.equal(hero.name, "Вера");
  assert.match(hero.id, /^pc-/);
  assert.equal(hero.portrait, "/dnd/portraits/human-f-fighter.webp");
  assert.equal(view.players[0]!.heroId, hero.id);
  assert.equal(view.players[0]!.hp, hero.maxHp);

  f.send(gm, { type: "gameAdventure", adventureId: "solgard-bell" });
  assert.equal(f.state("b").players[0]!.heroId, hero.id, "an own hero stays when the adventure changes");
  f.send(sasha, { type: "gameReady", ready: true });
  f.send(gm, { type: "gameStart" });
  assert.equal(f.state("b").phase, "playing");
  f.send(sasha, { type: "gameRoll", source: { type: "skill", skill: "stealth" }, mode: "normal", hidden: false });
  view = f.state("b");
  assert.equal(view.rolls.at(-1)!.total, 15 + 5, "Dex +3 (15+1 human) and proficiency +2");
  f.send(sasha, { type: "gameCustomHero", choices });
  assert.equal(f.lastError("b"), "GAME_RUNNING");
  f.send(gm, { type: "gameEnd" });

  f.send(sasha, { type: "gameHero", heroId: "ilva" });
  view = f.state("a");
  assert.deepEqual(view.customHeroes, [], "picking an adventure hero drops the own one");
  f.send(sasha, { type: "gameCustomHero", choices });
  f.send(sasha, { type: "gameSeat", role: "spectator" });
  assert.deepEqual(f.state("a").customHeroes, [], "and so does leaving the seat");
});

/** A table in the bell hall with Ilva (Sasha), Osmund (Kria) and Grom (Lena). */
function hallTable(f: ReturnType<typeof fixture>) {
  const gm = f.person("a", "Alex");
  const sasha = f.person("b", "Sasha");
  const kria = f.person("c", "Kria");
  const lena = f.person("d", "Lena");
  for (const who of [gm, sasha, kria, lena]) f.send(who, { type: "gameOpen" });
  f.send(gm, { type: "gameSeat", role: "gm" });
  f.send(gm, { type: "gameAdventure", adventureId: "solgard-bell" });
  for (const [who, hero] of [[sasha, "ilva"], [kria, "osmund"], [lena, "grom"]] as const) {
    f.send(who, { type: "gameSeat", role: "player" });
    f.send(who, { type: "gameHero", heroId: hero });
    f.send(who, { type: "gameReady", ready: true });
  }
  f.send(gm, { type: "gameStart" });
  f.send(gm, { type: "gameScene", index: 2 });
  return { gm, sasha, kria, lena };
}

test("conditions: players mark their own hero, the master marks monsters, and rolls follow the rules", () => {
  const f = fixture([5, 18, 5, 18, 12, 3, 17]);
  const { gm, sasha, kria } = hallTable(f);
  f.send(sasha, { type: "gameCondition", target: "uid:Kria", condition: "poisoned", active: true });
  assert.equal(f.lastError("b"), "NOT_YOUR_HERO");
  f.send(sasha, { type: "gameCondition", target: "uid:Sasha", condition: "poisoned", active: true });
  f.send(sasha, { type: "gameCondition", target: "uid:Sasha", condition: "invisible", active: true });
  assert.deepEqual(f.state("a").players[0]!.conditions, ["invisible", "poisoned"]);
  // Poisoned: disadvantage on a check.
  f.send(sasha, { type: "gameRoll", source: { type: "skill", skill: "stealth" }, mode: "normal", hidden: false });
  let roll = f.state("b").rolls.at(-1)!;
  assert.equal(roll.mode, "disadvantage");
  assert.equal(roll.total, 5 + 7);
  assert.deepEqual(roll.reasons, ["отравлен: помеха"]);
  // Poisoned and invisible at once cancel out on an attack, asking for advantage changes nothing.
  f.send(sasha, { type: "gameRoll", source: { type: "attack", index: 0 }, mode: "advantage", hidden: false });
  roll = f.state("b").rolls.at(-1)!;
  assert.equal(roll.mode, "normal");

  f.send(gm, { type: "gameTokenAdd", monsterId: "skeleton", x: 11, y: 13 });
  const skeleton = f.state("a").map!.tokens.find(token => token.kind === "monster")!;
  f.send(kria, { type: "gameCondition", target: skeleton.id, condition: "prone", active: true });
  assert.equal(f.lastError("c"), "GM_ONLY");
  f.send(gm, { type: "gameCondition", target: skeleton.id, condition: "restrained", active: true });
  assert.deepEqual(f.state("b").map!.tokens.find(token => token.id === skeleton.id)!.conditions, ["restrained"], "players see conditions on visible monsters");
  f.send(gm, { type: "gameExhaustion", key: "uid:Kria", level: 3 });
  assert.equal(f.state("c").players[1]!.exhaustion, 3);

  assert.deepEqual(conditionMode("normal", "attack", {}, null, { conditions: ["restrained"] }), { mode: "advantage", reasons: ["цель опутан: преимущество"] });
  assert.equal(conditionMode("normal", "save", { conditions: ["paralyzed"] }, "dex").reasons[0], "провал спасброска Силы и Ловкости автоматически");
  f.send(gm, { type: "gameEnd" });
  for (const who of [sasha, kria, f.person("d", "Lena")]) f.send(who, { type: "gameReady", ready: true });
  f.send(gm, { type: "gameStart" });
  assert.equal(f.state("a").phase, "playing");
  assert.equal(f.state("a").players[0]!.conditions, undefined, "a new game starts clean");
});

test("resources, hit dice and rests", () => {
  const f = fixture([6, 4]);
  const { gm, sasha, kria, lena } = hallTable(f);
  assert.equal(f.state("d").players[2]!.hitDice, 1);
  f.send(lena, { type: "gameResource", key: "uid:Lena", resourceId: "second-wind", used: 1 });
  f.send(kria, { type: "gameResource", key: "uid:Kria", resourceId: "slot1", used: 5 });
  assert.deepEqual(f.state("a").players[1]!.used, { slot1: 2 }, "never more than the maximum");
  f.send(sasha, { type: "gameResource", key: "uid:Sasha", resourceId: "slot1", used: 1 });
  assert.equal(f.lastError("b"), "UNKNOWN_RESOURCE");
  f.send(sasha, { type: "gameResource", key: "uid:Lena", resourceId: "second-wind", used: 0 });
  assert.equal(f.lastError("b"), "NOT_YOUR_HERO");

  f.send(gm, { type: "gameHp", key: "uid:Lena", hp: 3 });
  f.send(lena, { type: "gameHitDie", key: "uid:Lena" });
  let view = f.state("d");
  assert.equal(view.players[2]!.hp, 3 + 6 + 3, "d10 + Con +3");
  assert.equal(view.players[2]!.hitDice, 0);
  assert.equal(view.rolls.at(-1)!.healed, 9);
  f.send(lena, { type: "gameHitDie", key: "uid:Lena" });
  assert.equal(f.lastError("d"), "NO_HIT_DICE");

  f.send(sasha, { type: "gameRest", kind: "short" });
  assert.equal(f.lastError("b"), "GM_ONLY");
  f.send(gm, { type: "gameRest", kind: "short" });
  view = f.state("a");
  assert.deepEqual(view.players[2]!.used, undefined, "second wind comes back on a short rest");
  assert.deepEqual(view.players[1]!.used, { slot1: 2 }, "spell slots do not");
  f.send(gm, { type: "gameHp", key: "uid:Kria", hp: 2 });
  f.send(gm, { type: "gameExhaustion", key: "uid:Kria", level: 2 });
  f.send(gm, { type: "gameRest", kind: "long" });
  view = f.state("a");
  assert.equal(view.players[1]!.hp, 10);
  assert.equal(view.players[1]!.used, undefined);
  assert.equal(view.players[1]!.exhaustion, 1);
  assert.equal(view.players[2]!.hitDice, 1);
  assert.match(view.rolls.at(-1)!.label, /Долгий отдых/);
});

test("saving-throw attacks roll every target's save and apply the damage at once", () => {
  // Damage 1d8 = 6; then saves: skeleton 15 (+2 Dex = 17, saves), ghoul hidden 3 (fails).
  const f = fixture([6, 15, 3, 7, 4, 2, 9]);
  const { gm, sasha, kria } = hallTable(f);
  f.send(gm, { type: "gameTokenAdd", monsterId: "skeleton", x: 11, y: 13 });
  f.send(gm, { type: "gameTokenAdd", monsterId: "ghoul", x: 12, y: 13 });
  const monsters = f.state("a").map!.tokens.filter(token => token.kind === "monster");
  f.send(gm, { type: "gameTokenHide", id: monsters[1]!.id, hidden: true });
  f.send(kria, { type: "gameSaveAttack", source: { type: "attack", index: 1 }, targets: monsters.map(token => token.id) });
  assert.equal(f.lastError("c"), "UNKNOWN_TOKEN", "players cannot aim at what they cannot see");
  f.send(gm, { type: "gameTokenHide", id: monsters[1]!.id, hidden: false });
  f.send(kria, { type: "gameSaveAttack", source: { type: "attack", index: 0 }, targets: [monsters[0]!.id] });
  assert.equal(f.lastError("c"), "NOT_A_SAVE_ATTACK", "a mace hits with an attack roll");
  f.send(gm, { type: "gameTokenHide", id: monsters[1]!.id, hidden: true });
  f.send(gm, { type: "gameFogAll", reveal: true });
  f.send(gm, { type: "gameTokenHide", id: monsters[1]!.id, hidden: false });
  f.send(kria, { type: "gameSaveAttack", source: { type: "attack", index: 1 }, targets: monsters.map(token => token.id) });
  const gmView = f.state("a");
  const roll = gmView.rolls.at(-1)!;
  assert.equal(roll.total, 6);
  assert.equal(roll.dc, 13);
  assert.deepEqual(roll.saves!.map(item => [item.name, item.total, item.success, item.damage]), [["Скелет 1", 17, true, 0], ["Упырь 1", 5, false, 6]]);
  assert.deepEqual(gmView.map!.tokens.filter(token => token.kind === "monster").map(token => token.hp), [13, 16]);
  assert.equal(f.state("c").rolls.at(-1)!.dc, undefined, "players do not see the difficulty");

  // The master's monster breathes on a concentrating cleric: damage, then a concentration save.
  f.send(gm, { type: "gameTokenAdd", monsterId: "cult-fanatic", x: 5, y: 5 });
  const fanatic = f.state("a").map!.tokens.find(token => token.monsterId === "cult-fanatic")!;
  const osmund = f.state("a").map!.tokens.find(token => token.heroId === "osmund")!;
  f.send(kria, { type: "gameCondition", target: "uid:Kria", condition: "concentration", active: true });
  f.send(gm, { type: "gameSaveAttack", source: { type: "monsterAttack", tokenId: fanatic.id, index: 1 }, targets: [osmund.id] });
  const view = f.state("c");
  const flame = view.rolls.at(-2)!;
  assert.equal(flame.saves![0]!.success, false, "4 − 1 Dex < 11");
  assert.equal(flame.saves![0]!.damage, 7);
  assert.equal(view.players[1]!.hp, 3);
  const concentration = view.rolls.at(-1)!;
  assert.match(concentration.label, /Концентрация/);
  assert.equal(concentration.success, false, "2 + 2 Con < DC 10");
  assert.equal(view.players[1]!.conditions, undefined, "concentration is lost");
});

test("tables survive a gateway restart through the store", () => {
  const saved = new Map<string, unknown>();
  const store: TabletopStore = { load: key => saved.get(key) ?? null, save: (key, snapshot) => { if (snapshot === null) saved.delete(key); else saved.set(key, JSON.parse(JSON.stringify(snapshot))); } };
  const f = fixture([], BARE_ADVENTURES, store);
  const { gm, kria } = hallTable(f);
  f.send(gm, { type: "gameTokenAdd", monsterId: "skeleton", x: 11, y: 13 });
  f.send(gm, { type: "gameHp", key: "uid:Kria", hp: 4 });
  f.send(kria, { type: "gameResource", key: "uid:Kria", resourceId: "slot1", used: 1 });
  f.send(gm, { type: "gameFog", cells: [0, 1, 2], reveal: true });
  const before = f.state("c");

  const again = fixture([], BARE_ADVENTURES, store);
  const kria2 = again.person("x", "Kria");
  again.send(kria2, { type: "gameOpen" });
  const after = again.state("x");
  assert.equal(after.phase, "playing");
  assert.equal(after.scene, 2);
  assert.equal(after.you.role, "player");
  assert.deepEqual(after.players.map(seat => [seat.heroId, seat.hp, seat.online]), before.players.map(seat => [seat.heroId, seat.hp, seat.key === "uid:Kria"]));
  assert.deepEqual(after.players[1]!.used, { slot1: 1 });
  assert.equal(after.map!.fog, before.map!.fog);
  assert.deepEqual(after.map!.tokens.map(token => token.name), before.map!.tokens.map(token => token.name));
  assert.equal(after.rolls.length, before.rolls.length);

  for (const who of ["a", "b", "c", "d"]) f.coordinator.removePeer(who);
  for (const name of ["Alex", "Sasha", "Lena"]) {
    const person = again.person(`p-${name}`, name);
    again.send(person, { type: "gameOpen" });
    again.send(person, { type: "gameSeat", role: "spectator" });
  }
  again.send(kria2, { type: "gameSeat", role: "spectator" });
  again.coordinator.removePeer("x");
  for (const name of ["Alex", "Sasha", "Lena"]) again.coordinator.removePeer(`p-${name}`);
  assert.equal(saved.size, 0, "an emptied table is deleted");
});

test("experience, level-ups of own heroes, belongings and the hero vault", () => {
  const vaultData = new Map<string, unknown>();
  const vault: TabletopStore = { load: key => vaultData.get(key) ?? null, save: (key, value) => { if (value === null) vaultData.delete(key); else vaultData.set(key, value); } };
  const sent: Array<{ entryId: string; message: GameServerMessage }> = [];
  const coordinator = new TabletopCoordinator({ send: (entryId, message) => sent.push({ entryId, message }), adventures: () => BARE_ADVENTURES, vault, randomId: (() => { let id = 0; return () => `v${++id}`; })() });
  const gm: TableParticipant = { entryId: "a", nickname: "Alex", seatKey: "uid:Alex", tableKey: "ts#1" };
  const sasha: TableParticipant = { entryId: "b", nickname: "Sasha", seatKey: "uid:Sasha", tableKey: "ts#1" };
  const guest: TableParticipant = { entryId: "c", nickname: "Guest", seatKey: "nick:Guest", tableKey: "ts#1" };
  const state = (entryId: string) => (sent.filter(item => item.entryId === entryId && item.message.type === "gameState").at(-1)!.message as { table: TableView }).table;
  const lastError = (entryId: string) => { const last = sent.filter(item => item.entryId === entryId).at(-1)?.message; return last?.type === "gameError" ? last.code : null; };
  for (const who of [gm, sasha, guest]) coordinator.handleMessage(who, { type: "gameOpen" });
  assert.deepEqual(sent.find(item => item.entryId === "b" && item.message.type === "gameVault")?.message, { type: "gameVault", heroes: [] });
  assert.equal(sent.some(item => item.entryId === "c" && item.message.type === "gameVault"), false, "no vault without a unique id");

  const choices = {
    name: "Вера", race: "human", cls: "fighter", method: "array", abilities: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 },
    classSkills: ["athletics", "perception"], backgroundSkills: ["history", "insight"], fightingStyle: "defense",
    inventory: [{ name: "Верёвка", qty: 1 }], coins: { gp: 40, sp: 3, cp: 0 },
  };
  coordinator.handleMessage(sasha, { type: "gameVaultSave", hero: { id: "h1", choices, updatedAt: 1 } });
  assert.equal((vaultData.get("uid:Sasha") as unknown[]).length, 1);
  coordinator.handleMessage(guest, { type: "gameVaultSave", hero: { id: "h1", choices, updatedAt: 1 } });
  assert.equal(lastError("c"), "NO_VAULT");
  coordinator.handleMessage(sasha, { type: "gameVaultSave", hero: { id: "h1", choices: { ...choices, level: 3 }, updatedAt: 2 } });
  assert.equal(lastError("b"), "HERO_XP", "the vault checks the rules too");

  coordinator.handleMessage(gm, { type: "gameSeat", role: "gm" });
  coordinator.handleMessage(sasha, { type: "gameSeat", role: "player" });
  coordinator.handleMessage(sasha, { type: "gameCustomHero", choices });
  let view = state("b");
  assert.deepEqual(view.players[0]!.inventory, [{ name: "Верёвка", qty: 1 }]);
  assert.deepEqual(view.players[0]!.coins, { gp: 40, sp: 3, cp: 0 });
  assert.equal(state("c").players[0]!.inventory, undefined, "other people do not see the bag");
  assert.equal(state("a").players[0]!.coins!.gp, 40, "the master does");

  coordinator.handleMessage(sasha, { type: "gameLevelUp", choices: { ...choices, level: 2 } });
  assert.equal(lastError("b"), "HERO_XP");
  coordinator.handleMessage(gm, { type: "gameXp", keys: ["uid:Sasha"], amount: 1000 });
  assert.equal(state("b").players[0]!.xp, 1000);
  coordinator.handleMessage(sasha, { type: "gameLevelUp", choices: { ...choices, level: 2, fightingStyle: "archery" } });
  assert.equal(lastError("b"), "HERO_CHANGED");
  coordinator.handleMessage(sasha, { type: "gameLevelUp", choices: { ...choices, level: 3 } });
  assert.equal(lastError("b"), "HERO_LEVEL", "one level at a time");
  coordinator.handleMessage(sasha, { type: "gameLevelUp", choices: { ...choices, level: 2, name: "Вера Стойкая" } });
  view = state("b");
  const hero = view.customHeroes[0]!;
  assert.equal(hero.level, 2);
  assert.equal(hero.name, "Вера Стойкая");
  assert.equal(hero.maxHp, 12 + 8);
  assert.equal(view.players[0]!.hp, 20);
  assert.ok(hero.resources!.some(item => item.id === "action-surge"));

  coordinator.handleMessage(gm, { type: "gameInventory", key: "uid:Sasha", inventory: [{ name: "Зелье лечения", qty: 2, note: "2к4+2" }], coins: { gp: 100, sp: 0, cp: 0 } });
  assert.deepEqual(state("b").players[0]!.inventory, [{ name: "Зелье лечения", qty: 2, note: "2к4+2" }]);
  coordinator.handleMessage(guest, { type: "gameInventory", key: "uid:Sasha", inventory: [], coins: { gp: 0 } });
  assert.equal(lastError("c"), "NOT_YOUR_HERO");
  coordinator.handleMessage(sasha, { type: "gameInventory", key: "uid:Sasha", inventory: [{ name: "x".repeat(81), qty: 1 }], coins: { gp: 0 } });
  assert.equal(lastError("b"), "HERO_INVENTORY");

  coordinator.handleMessage(sasha, { type: "gameVaultRemove", id: "h1" });
  assert.equal(vaultData.has("uid:Sasha"), false);
});
