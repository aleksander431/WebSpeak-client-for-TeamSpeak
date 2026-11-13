import assert from "node:assert/strict";
import test from "node:test";
import { emptyDraft, type AdventureDraft } from "../../../src/shared/adventure-draft.js";
import { startPlaytest } from "./playtest.js";

const upload = "0123456789abcdef0123456789abcdef.webp";

function draft(): AdventureDraft {
  return {
    ...emptyDraft("Пещера гоблинов"),
    heroes: [{ kind: "builtin", id: "ilva" }],
    monsters: [{ kind: "catalog", id: "goblin" }],
    music: [{ id: "cave", title: "Пещера", builtin: "catacombs" }],
    scenes: [
      { id: "s1", title: "Деревня", art: { upload }, intro: "Коза пропала!", music: "cave" },
      { id: "s2", title: "Пещера", map: { picture: { library: "map", id: "cave" }, cols: 24, rows: 16, spawn: [[1, 14]] }, encounter: [{ monsterId: "goblin", x: 10, y: 5, hidden: true }] },
    ],
  };
}

const settle = () => new Promise(resolve => setTimeout(resolve, 0));

test("a draft plays in the page with a game master and a player, without publishing", async () => {
  const run = startPlaytest(draft(), "abc123", { gm: "Ведущий", player: "Игрок" });
  await settle();
  const gm = run.clients.gm.state.table;
  const player = run.clients.player.state.table;
  assert.equal(gm?.phase, "playing");
  assert.equal(gm?.you.role, "gm");
  assert.equal(player?.you.role, "player");
  assert.equal(run.adventure.id, "ed-abc123");
  assert.equal(run.adventure.scenes[0]?.art, `/api/editor-files/${upload}`);
  assert.equal(run.clients.gm.adventureData.value?.scenes[0]?.intro, "Коза пропала!");
  assert.equal(run.clients.player.adventureData.value?.scenes[0]?.intro, undefined, "players see what published players would");

  run.clients.gm.scene(1);
  await settle();
  const tokens = run.clients.gm.state.table?.map?.tokens ?? [];
  assert.ok(tokens.some(token => token.kind === "monster"), "the prepared encounter is placed");
  assert.ok(!(run.clients.player.state.table?.map?.tokens ?? []).some(token => token.kind === "monster"), "a hidden monster stays hidden from the player");

  run.dispose();
  assert.equal(run.clients.gm.state.open, false);
});

test("a draft with problems does not start", () => {
  assert.throws(() => startPlaytest({ ...draft(), heroes: [] }, "abc123", { gm: "Ведущий", player: "Игрок" }), /add at least one hero/);
});
