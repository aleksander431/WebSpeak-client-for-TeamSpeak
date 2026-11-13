import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import { applyPendingDndRestore, cancelDndRestore, DndBackupError, pendingDndRestore, stageDndRestore, writeDndBackup } from "./dnd-backup.js";
import { readZipArchive } from "./zip-archive.js";

async function put(root: string, name: string, content: string | Buffer): Promise<void> {
  const file = path.join(root, ...name.split("/"));
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content);
}

async function archive(dataDir: string): Promise<Buffer> {
  const out = new PassThrough();
  const chunks: Buffer[] = [];
  out.on("data", chunk => chunks.push(chunk as Buffer));
  await writeDndBackup(dataDir, out, new Date("2026-11-13T12:00:00Z"));
  out.end();
  return Buffer.concat(chunks);
}

test("D&D data is packed into a backup and restored at the next start", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "dnd-backup-"));
  try {
    const source = path.join(root, "old");
    await put(source, "tables/ab.json", "{\"table\":1}");
    await put(source, "tables/ab.json.123.tmp", "half written");
    await put(source, "heroes/cd.json", "{\"heroes\":[]}");
    await put(source, "adventures/ed-x/adventure.json", "{}");
    await put(source, "adventures/ed-x/files/maps/cave.webp", Buffer.from([1, 2, 3]));
    await put(source, "adventures/.incoming-1/adventure.json", "{}");
    await put(source, "editor/state.json", "{\"links\":[]}");
    await put(source, "editor/files/0123.webp.part", "partial");
    await put(source, "webspeak.db", "not D&D");

    const bytes = await archive(source);
    const files = readZipArchive(bytes, { maxArchiveBytes: bytes.length, maxExpandedBytes: 1e9, maxFiles: 100 });
    assert.deepEqual([...files.keys()].sort(), [
      "adventures/ed-x/adventure.json", "adventures/ed-x/files/maps/cave.webp", "editor/state.json", "heroes/cd.json", "tables/ab.json", "webspeak-dnd-backup.json",
    ]);

    const target = path.join(root, "new");
    await put(target, "tables/zz.json", "{\"table\":\"current\"}");
    await put(target, "webspeak.db", "kept");
    assert.equal(await pendingDndRestore(target), null);
    const staged = await stageDndRestore(target, bytes);
    assert.equal(staged.files, 5);
    assert.equal(staged.createdAt, "2026-11-13T12:00:00.000Z");
    assert.deepEqual(await pendingDndRestore(target), { createdAt: "2026-11-13T12:00:00.000Z" });
    assert.ok(existsSync(path.join(target, "tables", "zz.json")), "nothing changes until the next start");

    const logged: unknown[] = [];
    await applyPendingDndRestore(target, (_message, details) => logged.push(details));
    assert.equal(await readFile(path.join(target, "tables", "ab.json"), "utf8"), "{\"table\":1}");
    assert.ok(!existsSync(path.join(target, "tables", "zz.json")));
    assert.deepEqual(await readFile(path.join(target, "adventures", "ed-x", "files", "maps", "cave.webp")), Buffer.from([1, 2, 3]));
    assert.equal(await readFile(path.join(target, "dnd-before-restore", "tables", "zz.json"), "utf8"), "{\"table\":\"current\"}");
    assert.equal(await readFile(path.join(target, "webspeak.db"), "utf8"), "kept");
    assert.equal(await pendingDndRestore(target), null);
    assert.equal(logged.length, 1);

    await applyPendingDndRestore(target, () => assert.fail("nothing is pending"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("only WebSpeak D&D backups are accepted, and a staged restore can be cancelled", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "dnd-backup-"));
  try {
    await put(root, "tables/a.json", "{}");
    const bytes = await archive(root);
    await assert.rejects(stageDndRestore(root, Buffer.from("not a zip")), (error: unknown) => error instanceof DndBackupError && error.code === "DND_BACKUP_INVALID");
    const forged = Buffer.from(bytes.toString("latin1").replace("webspeak-dnd-backup\"", "something-else\"").replace("webspeak-dnd-backup\"", "something-else\""), "latin1");
    await assert.rejects(stageDndRestore(root, forged), (error: unknown) => error instanceof DndBackupError);
    await stageDndRestore(root, bytes);
    assert.ok(await pendingDndRestore(root));
    await cancelDndRestore(root);
    assert.equal(await pendingDndRestore(root), null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
