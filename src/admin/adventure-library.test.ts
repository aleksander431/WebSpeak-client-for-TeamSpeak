import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { deflateRawSync } from "node:zlib";
import { AdventureLibrary, AdventureLibraryError } from "./adventure-library.js";
import { adventureForPlayers } from "../shared/adventure-package.js";

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
const crc32 = (bytes: Buffer) => {
  let value = 0xffffffff;
  for (const byte of bytes) value = crcTable[(value ^ byte) & 0xff]! ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
};

/** A minimal deflate ZIP writer for the tests. */
function zip(files: Record<string, Buffer | string>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content);
    const packed = deflateRawSync(data);
    const nameBytes = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6); local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc32(data), 14); local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x800, 8); central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc32(data), 16); central.writeUInt32LE(packed.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, packed);
    centrals.push(central, nameBytes);
    offset += 30 + nameBytes.length + packed.length;
  }
  const centralBytes = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(centralBytes.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBytes, end]);
}

const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBPVP8 "), Buffer.alloc(32)]);
const OGG = Buffer.concat([Buffer.from("OggS"), Buffer.alloc(60)]);

function manifest(overrides: Record<string, unknown> = {}) {
  return {
    schema: 1,
    id: "lighthouse",
    title: "Маяк",
    summary: "Огонь маяка погас.",
    level: 2,
    length: "Ваншот",
    includeHeroes: ["ilva", "grom"],
    includeMonsters: ["skeleton"],
    monsters: [{ id: "keeper", name: "Смотритель", cr: "1", maxHp: 30, ac: 12, dex: 12, attacks: [{ name: "Фонарь", bonus: 4, damage: "1d8+2", note: "" }], traits: [], portrait: "img/keeper.webp" }],
    music: [{ id: "sea", title: "Море", file: "music/sea.ogg" }],
    combatMusic: "sea",
    scenes: [
      { id: "shore", title: "Берег", art: "img/shore.webp", intro: "Волны.", notes: "Секрет.", music: "sea" },
      { id: "tower", title: "Башня", map: { image: "img/tower.webp", cols: 10, rows: 8, spawn: [[1, 7]] }, encounter: [{ monsterId: "keeper", x: 5, y: 2, hidden: true }], reveal: [[0, 6, 3, 2]] },
    ],
    ...overrides,
  };
}

function pack(doc: unknown, extra: Record<string, Buffer | string> = {}) {
  return zip({
    "lighthouse/adventure.json": JSON.stringify(doc),
    "lighthouse/img/shore.webp": WEBP,
    "lighthouse/img/tower.webp": WEBP,
    "lighthouse/img/keeper.webp": WEBP,
    "lighthouse/music/sea.ogg": OGG,
    ...Object.fromEntries(Object.entries(extra).map(([name, value]) => [`lighthouse/${name}`, value])),
  });
}

test("an adventure package installs, serves only its own files and survives a restart", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "webspeak-adventures-"));
  try {
    const library = new AdventureLibrary(directory);
    await library.load();
    const adventure = await library.install(pack(manifest(), { "img/unused.webp": WEBP, "README.md": "hi" }));
    assert.equal(adventure.id, "lighthouse");
    assert.deepEqual(adventure.heroes.map(hero => hero.id), ["ilva", "grom"], "built-in heroes by id");
    assert.deepEqual(adventure.monsters.map(monster => monster.id), ["skeleton", "keeper"]);
    assert.equal(adventure.scenes[0]!.art, "/api/adventures/lighthouse/files/img/shore.webp");
    assert.equal(adventure.music![0]!.file, "/api/adventures/lighthouse/files/music/sea.ogg");
    assert.equal(library.file("lighthouse", "img/tower.webp")?.mimeType, "image/webp");
    assert.equal(library.file("lighthouse", "img/unused.webp"), null, "unreferenced files are not kept");
    assert.equal(library.file("lighthouse", "../adventure.json"), null);
    assert.equal(library.file("lighthouse", "adventure.json"), null);

    const players = adventureForPlayers(adventure);
    assert.equal(players.scenes[0]!.notes, undefined);
    assert.equal(players.scenes[0]!.intro, undefined);
    assert.equal(players.scenes[1]!.encounter, undefined);
    assert.deepEqual([players.monsters[1]!.ac, players.monsters[1]!.attacks.length], [0, 0], "players do not get stat blocks");

    const again = new AdventureLibrary(directory);
    await again.load();
    assert.deepEqual(again.catalog().map(item => [item.id, item.scenes, item.heroes, item.tracks]), [["lighthouse", 2, 2, 1]]);
    assert.ok(again.file("lighthouse", "music/sea.ogg"));
    assert.equal(await again.remove("lighthouse"), true);
    assert.equal(again.list().length, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("broken adventure packages are refused with a reason", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "webspeak-adventures-"));
  try {
    const library = new AdventureLibrary(directory);
    await library.load();
    const refused = async (bytes: Buffer, code: string, pattern?: RegExp) => {
      await assert.rejects(library.install(bytes), (error: unknown) => {
        assert.ok(error instanceof AdventureLibraryError);
        assert.equal(error.code, code);
        if (pattern) assert.match(error.message, pattern);
        return true;
      });
    };
    await refused(Buffer.from("not a zip at all, sorry"), "ZIP_INVALID");
    await refused(zip({ "x/readme.txt": "no manifest" }), "ADVENTURE_MANIFEST_MISSING");
    await refused(pack(manifest({ id: "Bad Id" })), "ADVENTURE_INVALID", /^id:/);
    await refused(pack(manifest({ id: "solgard-bell" })), "ADVENTURE_ID_RESERVED");
    await refused(pack(manifest({ scenes: [{ id: "a", title: "A", art: "img/missing.webp" }] })), "ADVENTURE_INVALID", /scenes\[0\]\.art: file "img\/missing\.webp" is not in the package/);
    await refused(pack(manifest({ combatMusic: "nope" })), "ADVENTURE_INVALID", /combatMusic/);
    await refused(pack(manifest({ includeHeroes: [], heroes: [] })), "ADVENTURE_INVALID", /at least one hero/);
    await refused(pack(manifest({ scenes: [{ id: "a", title: "A", encounter: [] }] })), "ADVENTURE_INVALID", /need a map/);
    await refused(zip({ "adventure.json": JSON.stringify(manifest({ scenes: [{ id: "a", title: "A", art: "a.webp" }], monsters: [], music: [], combatMusic: undefined })), "a.webp": "<svg>not webp</svg>" }), "ADVENTURE_FILE_TYPE");
    assert.equal(library.list().length, 0);
    // A stored folder that no longer loads is skipped, not fatal.
    await writeFile(path.join(directory, "junk.txt"), "x");
    await library.load();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
