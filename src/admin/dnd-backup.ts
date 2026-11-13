import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Writable } from "node:stream";
import { crc32, readZipArchive, ZipArchiveError } from "./zip-archive.js";

/*
 * The D&D data lives in plain folders beside the database, not in it: saved
 * tables, the players' hero vault, uploaded adventures and the adventure
 * editor's drafts and uploads. The database backup does not carry them, so
 * this packs them into one ZIP and restores such a ZIP. A restore is staged
 * and applied at the next start, before anything reads those folders, so a
 * running gateway never sees half of one state and half of another.
 */

export const DND_BACKUP_FOLDERS = ["tables", "heroes", "adventures", "editor"] as const;
export const DND_BACKUP_MANIFEST = "webspeak-dnd-backup.json";
export const DND_BACKUP_FORMAT = "webspeak-dnd-backup";
/** Largest archive accepted for a restore (held in memory while checked). */
export const DND_RESTORE_LIMIT_BYTES = 1024 * 1024 * 1024;
const PENDING = "dnd-restore";
const PREVIOUS = "dnd-before-restore";
const MAX_FILES = 60_000;
/** Plain ZIP without ZIP64: stay clear of the 4 GiB offsets. */
const MAX_ARCHIVE_BYTES = 0xffff_0000;

export class DndBackupError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = "DndBackupError";
  }
}

interface FileItem { name: string; file: string; size: number; modified: Date }

/** Temporary files of the stores (being written or renamed into place) are left out. */
function skipped(name: string): boolean {
  return name.startsWith(".") || name.endsWith(".tmp") || name.endsWith(".part");
}

async function collect(dataDir: string): Promise<FileItem[]> {
  const items: FileItem[] = [];
  async function walk(directory: string, prefix: string): Promise<void> {
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); } catch { return; }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (skipped(entry.name)) continue;
      const file = path.join(directory, entry.name);
      const name = `${prefix}/${entry.name}`;
      if (entry.isDirectory()) await walk(file, name);
      else if (entry.isFile()) {
        const info = await stat(file);
        items.push({ name, file, size: info.size, modified: info.mtime });
      }
    }
  }
  for (const folder of DND_BACKUP_FOLDERS) await walk(path.join(dataDir, folder), folder);
  return items;
}

function dosTime(date: Date): { time: number; date: number } {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

/** Size of the whole archive and how many files, before writing anything. */
export async function dndBackupSize(dataDir: string): Promise<{ files: number; bytes: number }> {
  const items = await collect(dataDir);
  return { files: items.length, bytes: items.reduce((sum, item) => sum + item.size, 0) };
}

/**
 * Writes the archive to `out`, file by file, waiting for the stream to drain.
 * Files are stored uncompressed: pictures and music already are compressed.
 */
export async function writeDndBackup(dataDir: string, out: Writable, now = new Date()): Promise<void> {
  const items = await collect(dataDir);
  const manifest = Buffer.from(JSON.stringify({ format: DND_BACKUP_FORMAT, version: 1, createdAt: now.toISOString(), folders: DND_BACKUP_FOLDERS, files: items.length }, null, 2));
  const total = items.reduce((sum, item) => sum + item.size + 76 + 2 * Buffer.byteLength(item.name), 0) + manifest.length + 200;
  if (items.length + 1 > MAX_FILES || total > MAX_ARCHIVE_BYTES) throw new DndBackupError("The D&D data is too large for one archive.", "DND_BACKUP_TOO_LARGE");

  const central: Buffer[] = [];
  let offset = 0;
  const write = (chunk: Buffer) => new Promise<void>((resolve, reject) => {
    offset += chunk.length;
    if (out.write(chunk)) resolve();
    else {
      const cleanup = () => { out.off("drain", onDrain); out.off("close", onClose); out.off("error", onClose); };
      const onDrain = () => { cleanup(); resolve(); };
      const onClose = () => { cleanup(); reject(new DndBackupError("The download was interrupted.", "DND_BACKUP_ABORTED")); };
      out.once("drain", onDrain);
      out.once("close", onClose);
      out.once("error", onClose);
    }
  });
  async function add(name: string, data: Buffer, modified: Date): Promise<void> {
    const nameBytes = Buffer.from(name, "utf8");
    const crc = crc32(data);
    const { time, date } = dosTime(modified);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    const at = offset;
    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50, 0);
    record.writeUInt16LE((3 << 8) | 20, 4);
    record.writeUInt16LE(20, 6);
    record.writeUInt16LE(0x800, 8);
    record.writeUInt16LE(0, 10);
    record.writeUInt16LE(time, 12);
    record.writeUInt16LE(date, 14);
    record.writeUInt32LE(crc, 16);
    record.writeUInt32LE(data.length, 20);
    record.writeUInt32LE(data.length, 24);
    record.writeUInt16LE(nameBytes.length, 28);
    record.writeUInt32LE((0o100644 << 16) >>> 0, 38);
    record.writeUInt32LE(at, 42);
    central.push(record, nameBytes);
    await write(Buffer.concat([local, nameBytes]));
    await write(data);
  }

  await add(DND_BACKUP_MANIFEST, manifest, now);
  for (const item of items) {
    // A file may change or go away while the archive is written; it is then read as it is now.
    let data: Buffer;
    try { data = await readFile(item.file); } catch { continue; }
    await add(item.name, data, item.modified);
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(central.length / 2, 8);
  end.writeUInt16LE(central.length / 2, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  await write(directory);
  await write(end);
}

/**
 * Checks an archive made by `writeDndBackup` and stages it for the next start.
 * Only the folders it lists are replaced then; a newer staged restore replaces an older one.
 */
export async function stageDndRestore(dataDir: string, bytes: Buffer): Promise<{ files: number; bytes: number; createdAt: string }> {
  let files: Map<string, Buffer>;
  try {
    files = readZipArchive(bytes, { maxArchiveBytes: DND_RESTORE_LIMIT_BYTES, maxExpandedBytes: MAX_ARCHIVE_BYTES, maxFiles: MAX_FILES });
  } catch (error: unknown) {
    if (error instanceof ZipArchiveError) throw new DndBackupError(error.message, "DND_BACKUP_INVALID");
    throw error;
  }
  const manifestBytes = files.get(DND_BACKUP_MANIFEST);
  let manifest: { format?: unknown; version?: unknown; createdAt?: unknown; folders?: unknown } = {};
  try { manifest = manifestBytes ? JSON.parse(manifestBytes.toString("utf8")) as typeof manifest : {}; } catch { /* checked below */ }
  if (manifest.format !== DND_BACKUP_FORMAT || manifest.version !== 1 || !Array.isArray(manifest.folders)) {
    throw new DndBackupError("This is not a WebSpeak D&D backup.", "DND_BACKUP_INVALID");
  }
  const folders = manifest.folders.filter((item): item is typeof DND_BACKUP_FOLDERS[number] => (DND_BACKUP_FOLDERS as readonly unknown[]).includes(item));
  if (!folders.length) throw new DndBackupError("The backup names no D&D folders.", "DND_BACKUP_INVALID");
  let total = 0;
  for (const name of files.keys()) {
    if (name === DND_BACKUP_MANIFEST) continue;
    const [folder, ...rest] = name.split("/");
    if (!folders.includes(folder as typeof folders[number]) || !rest.length || rest.some(skipped)) {
      throw new DndBackupError(`Unexpected file in the backup: ${name}`, "DND_BACKUP_INVALID");
    }
  }
  const staging = path.join(dataDir, `.${PENDING}-${randomBytes(6).toString("hex")}`);
  try {
    for (const folder of folders) await mkdir(path.join(staging, folder), { recursive: true });
    for (const [name, data] of files) {
      const target = path.join(staging, ...name.split("/"));
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, data);
      if (name !== DND_BACKUP_MANIFEST) total += data.length;
    }
    await rm(path.join(dataDir, PENDING), { recursive: true, force: true });
    await rename(staging, path.join(dataDir, PENDING));
  } catch (error: unknown) {
    await rm(staging, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
  return { files: files.size - 1, bytes: total, createdAt: typeof manifest.createdAt === "string" ? manifest.createdAt : "" };
}

/** The restore waiting for the next start, if any. */
export async function pendingDndRestore(dataDir: string): Promise<{ createdAt: string } | null> {
  try {
    const manifest = JSON.parse(await readFile(path.join(dataDir, PENDING, DND_BACKUP_MANIFEST), "utf8")) as { createdAt?: unknown };
    return { createdAt: typeof manifest.createdAt === "string" ? manifest.createdAt : "" };
  } catch {
    return null;
  }
}

export async function cancelDndRestore(dataDir: string): Promise<void> {
  await rm(path.join(dataDir, PENDING), { recursive: true, force: true });
}

/**
 * At startup, before the stores open: swaps the staged folders in. What they
 * replace is kept in `dnd-before-restore/` until the next restore.
 */
export async function applyPendingDndRestore(dataDir: string, log: (message: string, details: Record<string, unknown>) => void): Promise<void> {
  const pending = path.join(dataDir, PENDING);
  if (!existsSync(path.join(pending, DND_BACKUP_MANIFEST))) {
    if (existsSync(pending)) await rm(pending, { recursive: true, force: true });
    return;
  }
  const previous = path.join(dataDir, PREVIOUS);
  await rm(previous, { recursive: true, force: true });
  await mkdir(previous, { recursive: true });
  const replaced: string[] = [];
  for (const folder of DND_BACKUP_FOLDERS) {
    const incoming = path.join(pending, folder);
    if (!existsSync(incoming)) continue;
    const current = path.join(dataDir, folder);
    if (existsSync(current)) await rename(current, path.join(previous, folder));
    await rename(incoming, current);
    replaced.push(folder);
  }
  await rm(pending, { recursive: true, force: true });
  log("Restored D&D data from a backup", { folders: replaced, previous });
}
