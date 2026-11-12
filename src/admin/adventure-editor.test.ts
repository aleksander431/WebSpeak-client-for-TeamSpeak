import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { AdventureEditorError, AdventureEditorStore } from "./adventure-editor.js";
import { AdventureLibrary } from "./adventure-library.js";
import { adventureForPlayers } from "../shared/adventure-package.js";
import { draftToPackage, emptyDraft, parseDraft, type AdventureDraft } from "../shared/adventure-draft.js";
import { suggestedAbilities } from "../shared/hero-builder.js";

const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBPVP8 "), Buffer.alloc(32)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
const OGG = Buffer.concat([Buffer.from("OggS"), Buffer.alloc(32)]);
const KEY = "a".repeat(64);
const OTHER = "b".repeat(64);

async function setup() {
  const root = await mkdtemp(path.join(tmpdir(), "webspeak-editor-"));
  const library = new AdventureLibrary(path.join(root, "adventures"));
  await library.load();
  const reads: string[] = [];
  const store = new AdventureEditorStore(path.join(root, "editor"), library, async url => {
    reads.push(url);
    return url.endsWith(".ogg") ? OGG : WEBP;
  });
  await store.load();
  return { root, library, store, reads, done: () => rm(root, { recursive: true, force: true }) };
}

function sampleDraft(upload: string): AdventureDraft {
  return {
    ...emptyDraft("Пещера гоблинов"),
    summary: "Гоблины украли козу.",
    heroes: [
      { kind: "builtin", id: "ilva" },
      { kind: "built", id: "pc-bran", choices: {
        name: "Бран", race: "human", cls: "fighter", method: "array", abilities: suggestedAbilities("fighter"),
        classSkills: ["athletics", "perception"], backgroundSkills: ["survival", "intimidation"], fightingStyle: "defense", portrait: "human-m-fighter2",
      } },
    ],
    monsters: [{ kind: "catalog", id: "goblin" }, { kind: "catalog", id: "giant-rat" }, {
      kind: "custom", id: "boss", sheet: { name: "Вождь Грык", cr: "1", maxHp: 21, ac: 15, speed: 30, dex: 14, attacks: [{ name: "Тесак", bonus: 4, damage: "1d8+2", note: "" }], traits: [] },
      picture: { upload },
    }],
    music: [{ id: "cave", title: "Пещера", builtin: "catacombs" }, { id: "fight", title: "Бой", builtin: "battle" }],
    combatMusic: "fight",
    scenes: [
      { id: "s1", title: "Деревня", art: { library: "scene", id: "market" }, intro: "Коза пропала!", music: "cave" },
      {
        id: "s2", title: "Пещера", map: { picture: { library: "map", id: "cave" }, cols: 24, rows: 16, spawn: [[1, 14], [2, 14]] },
        encounter: [{ monsterId: "goblin", x: 10, y: 5, hidden: true }, { monsterId: "boss", x: 20, y: 3 }],
        reveal: [[0, 12, 6, 4]],
        loot: [{ catalogId: "healing-potion", qty: 2 }, { name: "Коза Марта", text: "Очень недовольна.", qty: 1, picture: { upload } }],
      },
    ],
  };
}

test("an editor link: ask, approve, draft, upload and publish into the library", async () => {
  const { store, library, reads, done } = await setup();
  try {
    const link = await store.createLink("Для Саши");
    assert.deepEqual(store.status(link.token, KEY), { label: "Для Саши", status: "none" });
    await assert.rejects(store.request("wrong", KEY, "Саша"), (error: unknown) => error instanceof AdventureEditorError && error.code === "EDITOR_LINK_UNKNOWN");
    assert.deepEqual(await store.request(link.token, KEY, "Саша"), { status: "pending" });
    assert.equal(store.pendingCount(), 1);
    assert.throws(() => store.drafts(link.token, KEY), (error: unknown) => error instanceof AdventureEditorError && error.code === "EDITOR_NOT_APPROVED");

    const deviceId = store.links()[0]!.devices[0]!.id;
    assert.equal(await store.decide(link.id, deviceId, "approved"), true);
    assert.equal(store.status(link.token, KEY).status, "approved");
    assert.throws(() => store.drafts(link.token, OTHER), "another browser is still unknown");

    const { id } = await store.createDraft(link.token, KEY, "Пещера");
    const uploaded = await store.upload(link.token, KEY, id, PNG);
    assert.match(uploaded.file, /^[0-9a-f]{32}\.png$/);
    assert.ok(store.filePath(uploaded.file));
    await assert.rejects(store.upload(link.token, KEY, id, Buffer.from("<script>")), (error: unknown) => error instanceof AdventureEditorError && error.code === "EDITOR_FILE_TYPE");
    await assert.rejects(store.saveDraft(link.token, KEY, id, sampleDraft(`${"f".repeat(32)}.png`)), (error: unknown) => error instanceof AdventureEditorError && error.code === "EDITOR_FILE_UNKNOWN",
      "a draft may only name its own uploads");
    await store.saveDraft(link.token, KEY, id, sampleDraft(uploaded.file));
    assert.equal(store.drafts(link.token, KEY)[0]!.title, "Пещера гоблинов");

    const adventure = await store.publish(link.token, KEY, id);
    assert.equal(adventure.id, `ed-${id}`);
    assert.ok(library.has(adventure.id));
    assert.deepEqual(adventure.heroes.map(hero => hero.id), ["ilva", "pc-bran"]);
    assert.match(adventure.heroes[1]!.portrait ?? "", /^\/api\/adventures\/ed-[0-9a-f]+\/files\/portraits\/portrait-human-m-fighter2\.webp$/);
    assert.deepEqual(adventure.monsters.map(monster => monster.id).sort(), ["boss", "giant-rat", "goblin"]);
    const cave = adventure.scenes[1]!;
    assert.equal(cave.map?.cols, 24);
    assert.equal(cave.loot?.[0]?.name, "Зелье лечения");
    assert.match(cave.loot?.[0]?.icon ?? "", /files\/items\/item-healing-potion\.webp$/);
    assert.equal(cave.loot?.[1]?.text, "Очень недовольна.");
    assert.ok(reads.includes("/dnd/library/maps/cave.webp") && reads.includes("/dnd/solgard-bell/music-battle.ogg"));
    assert.equal(adventureForPlayers(adventure).scenes[1]!.loot, undefined, "players do not see the loot list");
    assert.ok(library.file(adventure.id, "music/battle.ogg"));
    assert.equal(store.drafts(link.token, KEY)[0]!.publishedId, adventure.id);

    // Publishing again replaces the same adventure.
    await store.publish(link.token, KEY, id);
    assert.equal(library.list().filter(item => item.id === adventure.id).length, 1);

    // Removing the link removes its drafts and uploads, not the published adventure.
    assert.equal(await store.removeLink(link.id), true);
    assert.equal(store.filePath(uploaded.file), null);
    assert.ok(library.has(adventure.id));
  } finally { await done(); }
});

test("drafts explain what is missing before publishing", async () => {
  const draft = sampleDraft(`${"a".repeat(32)}.png`);
  assert.throws(() => draftToPackage({ ...draft, heroes: [] }, "ed-x1"), /add at least one hero/);
  assert.throws(() => draftToPackage({ ...draft, scenes: [{ id: "s", title: "Карта", map: { picture: { library: "map", id: "cave" }, cols: 24, rows: 16, spawn: [] } }] }, "ed-x1"),
    (error: Error & { path?: string }) => /mark where the heroes start/.test(error.message) && error.path === "scenes[0].map.spawn");
  assert.throws(() => draftToPackage({ ...draft, monsters: [] }, "ed-x1"), /not in the adventure's list/);
  assert.throws(() => parseDraft({ ...draft, scenes: [{ id: "s", title: "x", art: { upload: "../../etc/passwd" } }] }), /unknown upload/);
  assert.throws(() => parseDraft({ ...draft, heroes: [{ kind: "built", id: "h", choices: { name: "" } }] }));
});
