import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { FileTabletopStore } from "./tabletop-store.js";

test("the table store keeps tables on disk, removes emptied ones and forgets stale ones", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "webspeak-tables-"));
  try {
    const store = new FileTabletopStore(directory);
    await store.open();
    store.save("ts#1", { v: 1, phase: "playing" });
    store.save("ts#2", { v: 1, phase: "lobby" });
    store.save("ts#2", null);
    await store.flush();
    assert.equal((await readdir(directory)).length, 1);

    const reopened = new FileTabletopStore(directory);
    await reopened.open();
    assert.deepEqual(reopened.load("ts#1"), { v: 1, phase: "playing" });
    assert.equal(reopened.load("ts#2"), null);

    const [file] = await readdir(directory);
    const old = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    await utimes(path.join(directory, file!), old, old);
    await writeFile(path.join(directory, "broken.json"), "{");
    const warnings: string[] = [];
    const later = new FileTabletopStore(directory, message => warnings.push(message));
    await later.open();
    assert.equal(later.load("ts#1"), null, "two months untouched");
    assert.equal(warnings.length, 1, "a broken file is skipped with a warning");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
