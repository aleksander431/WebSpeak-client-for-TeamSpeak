import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { TabletopStore } from "./tabletop-coordinator.js";

/** Saved tables nobody played for this long are deleted at startup. */
const KEEP_MS = 60 * 24 * 60 * 60 * 1000;
const WRITE_DELAY_MS = 1500;

/**
 * Game tables on disk: one JSON file per table under `<data>/tables/`, named by
 * a hash of the table key (the key itself is inside). Everything is read once
 * at startup, so the coordinator's synchronous `load` never waits; writes are
 * coalesced per table and replace the file atomically.
 */
export class FileTabletopStore implements TabletopStore {
  private readonly tables = new Map<string, unknown>();
  private readonly pending = new Map<string, ReturnType<typeof setTimeout>>();
  private writing: Promise<void> = Promise.resolve();

  constructor(private readonly directory: string, private readonly warn: (message: string, details: Record<string, unknown>) => void = () => undefined) {}

  async open(now = Date.now()): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    for (const name of await readdir(this.directory)) {
      if (!name.endsWith(".json")) continue;
      const file = path.join(this.directory, name);
      try {
        if (now - (await stat(file)).mtimeMs > KEEP_MS) {
          await rm(file, { force: true });
          continue;
        }
        const saved = JSON.parse(await readFile(file, "utf8")) as { key?: unknown; table?: unknown };
        if (typeof saved.key !== "string" || this.fileFor(saved.key) !== file) throw new Error("key and file name differ");
        this.tables.set(saved.key, saved.table);
      } catch (error: unknown) {
        this.warn("Skipping a saved game table that does not load", { file: name, error: error instanceof Error ? error.message : String(error) });
      }
    }
  }

  load(key: string): unknown {
    return this.tables.get(key) ?? null;
  }

  save(key: string, table: unknown): void {
    if (table === null) this.tables.delete(key);
    else this.tables.set(key, table);
    clearTimeout(this.pending.get(key));
    this.pending.set(key, setTimeout(() => this.write(key), WRITE_DELAY_MS));
  }

  /** Writes everything still waiting (shutdown). */
  async flush(): Promise<void> {
    for (const [key, timer] of this.pending) {
      clearTimeout(timer);
      this.write(key);
    }
    await this.writing;
  }

  private write(key: string): void {
    this.pending.delete(key);
    const file = this.fileFor(key);
    const table = this.tables.get(key);
    this.writing = this.writing.then(async () => {
      try {
        if (table === undefined) {
          await rm(file, { force: true });
          return;
        }
        const temporary = `${file}.${process.pid}.tmp`;
        await writeFile(temporary, JSON.stringify({ key, table }));
        await rename(temporary, file);
      } catch (error: unknown) {
        this.warn("Could not save a game table", { error: error instanceof Error ? error.message : String(error) });
      }
    });
  }

  private fileFor(key: string): string {
    return path.join(this.directory, `${createHash("sha256").update(key).digest("hex").slice(0, 32)}.json`);
  }
}
