import { randomBytes } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  ADVENTURE_AUDIO_EXTENSIONS,
  ADVENTURE_IMAGE_EXTENSIONS,
  AdventurePackageError,
  parseAdventurePackage,
} from "../shared/adventure-package.js";
import type { AdventureSummary, HeroSheet, MonsterSheet } from "../shared/tabletop.js";
import { BUILT_IN_ADVENTURES } from "../shared/tabletop-adventures.js";
import { ZipArchiveError, isSafeArchivePath, readZipArchive } from "./zip-archive.js";

export const ADVENTURE_ARCHIVE_LIMIT_BYTES = 200 * 1024 * 1024;
const LIMITS = { maxArchiveBytes: ADVENTURE_ARCHIVE_LIMIT_BYTES, maxExpandedBytes: 300 * 1024 * 1024, maxFiles: 400 };
const MAX_IMAGE_BYTES = 16 * 1024 * 1024;
const MAX_AUDIO_BYTES = 40 * 1024 * 1024;
const MAX_ADVENTURES = 30;
const MANIFEST = "adventure.json";

const MIME: Record<string, string> = {
  webp: "image/webp", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
  ogg: "audio/ogg", opus: "audio/ogg", mp3: "audio/mpeg", m4a: "audio/mp4", webm: "audio/webm",
};

export class AdventureLibraryError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = "AdventureLibraryError";
  }
}

interface Installed {
  adventure: AdventureSummary;
  /** Package paths the adventure uses (the only files served). */
  files: Set<string>;
  installedAt: string;
  bytes: number;
}

/** Built-in heroes and monsters a package may reuse by id. */
function builtInLibrary(): { heroes: HeroSheet[]; monsters: MonsterSheet[] } {
  return {
    heroes: BUILT_IN_ADVENTURES.flatMap(adventure => adventure.heroes),
    monsters: BUILT_IN_ADVENTURES.flatMap(adventure => adventure.monsters),
  };
}

export function adventureAssetUrl(id: string, file: string): string {
  return `/api/adventures/${id}/files/${file.split("/").map(encodeURIComponent).join("/")}`;
}

/**
 * Adventures the administrator uploaded: `<directory>/<id>/adventure.json`
 * plus the pictures and music it names under `<directory>/<id>/files/`.
 * Kept in memory after loading; the tables read `list()` on every change.
 */
export class AdventureLibrary {
  private readonly installed = new Map<string, Installed>();

  constructor(private readonly directory: string) {}

  /** Reads every stored adventure; a broken one is skipped and reported. */
  async load(warn: (message: string, details: Record<string, unknown>) => void = () => undefined): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    this.installed.clear();
    for (const entry of await readdir(this.directory, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      try {
        const folder = path.join(this.directory, entry.name);
        const manifest = JSON.parse(await readFile(path.join(folder, MANIFEST), "utf8")) as unknown;
        const present = new Set(await listFiles(path.join(folder, "files")));
        const meta = JSON.parse(await readFile(path.join(folder, "meta.json"), "utf8").catch(() => "{}")) as { installedAt?: string; bytes?: number };
        const installed = this.parse(manifest, file => present.has(file));
        if (installed.adventure.id !== entry.name) throw new AdventureLibraryError("folder and id differ", "ADVENTURE_ID_MISMATCH");
        this.installed.set(entry.name, { ...installed, installedAt: meta.installedAt ?? "", bytes: meta.bytes ?? 0 });
      } catch (error: unknown) {
        warn("Skipping a stored adventure that does not load", { id: entry.name, error: error instanceof Error ? error.message : String(error) });
      }
    }
  }

  list(): AdventureSummary[] {
    return [...this.installed.values()].map(item => item.adventure).sort((a, b) => a.title.localeCompare(b.title));
  }

  catalog(): Array<{ id: string; title: string; summary: string; scenes: number; heroes: number; tracks: number; installedAt: string; bytes: number }> {
    return [...this.installed.values()].map(({ adventure, installedAt, bytes }) => ({
      id: adventure.id, title: adventure.title, summary: adventure.summary, scenes: adventure.scenes.length,
      heroes: adventure.heroes.length, tracks: adventure.music?.length ?? 0, installedAt, bytes,
    })).sort((a, b) => a.title.localeCompare(b.title));
  }

  has(id: string): boolean {
    return this.installed.has(id);
  }

  /** Validates a ZIP package and stores it, replacing an earlier version with the same id. */
  async install(archive: Buffer): Promise<AdventureSummary> {
    let files: Map<string, Buffer>;
    try { files = readZipArchive(archive, LIMITS); }
    catch (error: unknown) {
      if (error instanceof ZipArchiveError) throw new AdventureLibraryError(error.message, error.code);
      throw error;
    }
    const manifestBytes = files.get(MANIFEST);
    if (!manifestBytes) throw new AdventureLibraryError("The package has no adventure.json at its top.", "ADVENTURE_MANIFEST_MISSING");
    let manifest: unknown;
    try { manifest = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(manifestBytes)); }
    catch { throw new AdventureLibraryError("adventure.json is not valid UTF-8 JSON.", "ADVENTURE_MANIFEST_JSON"); }
    const { adventure, files: used } = this.parse(manifest, file => files.has(file));
    if (BUILT_IN_ADVENTURES.some(item => item.id === adventure.id)) throw new AdventureLibraryError("That id belongs to a built-in adventure.", "ADVENTURE_ID_RESERVED");
    if (!this.installed.has(adventure.id) && this.installed.size >= MAX_ADVENTURES) throw new AdventureLibraryError(`At most ${MAX_ADVENTURES} adventures can be installed.`, "ADVENTURE_LIMIT");
    let bytes = manifestBytes.byteLength;
    for (const file of used) {
      const content = files.get(file)!;
      const audio = (ADVENTURE_AUDIO_EXTENSIONS as readonly string[]).includes(extension(file));
      if (content.byteLength > (audio ? MAX_AUDIO_BYTES : MAX_IMAGE_BYTES)) throw new AdventureLibraryError(`${file} is too large.`, "ADVENTURE_FILE_SIZE");
      if (!sniff(file, content)) throw new AdventureLibraryError(`${file} is not the kind of file its name says.`, "ADVENTURE_FILE_TYPE");
      bytes += content.byteLength;
    }

    await mkdir(this.directory, { recursive: true });
    const staging = path.join(this.directory, `.incoming-${randomBytes(6).toString("hex")}`);
    const target = path.join(this.directory, adventure.id);
    const retired = path.join(this.directory, `.retired-${randomBytes(6).toString("hex")}`);
    const installedAt = new Date().toISOString();
    try {
      for (const file of used) {
        const destination = path.join(staging, "files", ...file.split("/"));
        await mkdir(path.dirname(destination), { recursive: true });
        await writeFile(destination, files.get(file)!);
      }
      await writeFile(path.join(staging, MANIFEST), manifestBytes);
      await writeFile(path.join(staging, "meta.json"), JSON.stringify({ installedAt, bytes }));
      if (this.installed.has(adventure.id)) await rename(target, retired).catch(() => undefined);
      else await rm(target, { recursive: true, force: true });
      await rename(staging, target);
    } catch (error: unknown) {
      await rm(staging, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    } finally {
      await rm(retired, { recursive: true, force: true }).catch(() => undefined);
    }
    this.installed.set(adventure.id, { adventure, files: used, installedAt, bytes });
    return adventure;
  }

  async remove(id: string): Promise<boolean> {
    if (!this.installed.has(id)) return false;
    this.installed.delete(id);
    await rm(path.join(this.directory, id), { recursive: true, force: true });
    return true;
  }

  /** Where a file an installed adventure uses lies on disk, or null (unknown adventure, unused file). */
  file(id: string, file: string): { path: string; mimeType: string } | null {
    const installed = this.installed.get(id);
    if (!installed || !isSafeArchivePath(file) || !installed.files.has(file)) return null;
    const mimeType = MIME[extension(file)];
    if (!mimeType) return null;
    return { path: path.join(this.directory, id, "files", ...file.split("/")), mimeType };
  }

  private parse(manifest: unknown, exists: (file: string) => boolean): { adventure: AdventureSummary; files: Set<string> } {
    const used = new Set<string>();
    let id = "";
    try {
      if (typeof manifest === "object" && manifest && typeof (manifest as { id?: unknown }).id === "string") id = (manifest as { id: string }).id;
      const adventure = parseAdventurePackage(manifest, (file, kind) => {
        const allowed: readonly string[] = kind === "image" ? ADVENTURE_IMAGE_EXTENSIONS : ADVENTURE_AUDIO_EXTENSIONS;
        if (!isSafeArchivePath(file) || file === MANIFEST || !allowed.includes(extension(file)) || !exists(file)) return null;
        used.add(file);
        return adventureAssetUrl(id, file);
      }, builtInLibrary());
      return { adventure, files: used };
    } catch (error: unknown) {
      if (error instanceof AdventurePackageError) throw new AdventureLibraryError(error.message, "ADVENTURE_INVALID");
      throw error;
    }
  }
}

function extension(file: string): string {
  return file.split(".").pop()?.toLowerCase() ?? "";
}

/** The first bytes must match the extension, so a renamed file is not served as a picture or a track. */
function sniff(file: string, bytes: Buffer): boolean {
  const head = (length: number) => bytes.subarray(0, length);
  switch (extension(file)) {
    case "png": return head(8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    case "jpg": case "jpeg": return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    case "webp": return head(4).toString("latin1") === "RIFF" && bytes.subarray(8, 12).toString("latin1") === "WEBP";
    case "ogg": case "opus": return head(4).toString("latin1") === "OggS";
    case "mp3": return head(3).toString("latin1") === "ID3" || (bytes[0] === 0xff && ((bytes[1] ?? 0) & 0xe0) === 0xe0);
    case "m4a": return bytes.subarray(4, 8).toString("latin1") === "ftyp";
    case "webm": return head(4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
    default: return false;
  }
}

async function listFiles(root: string, prefix = ""): Promise<string[]> {
  const result: string[] = [];
  let entries;
  try { entries = await readdir(root, { withFileTypes: true }); }
  catch { return result; }
  for (const entry of entries) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) result.push(...await listFiles(path.join(root, entry.name), relative));
    else if (entry.isFile()) result.push(relative);
  }
  return result;
}
