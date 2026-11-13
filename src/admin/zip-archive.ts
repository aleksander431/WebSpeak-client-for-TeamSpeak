import { inflateRawSync } from "node:zlib";

/**
 * A strict reader for uploaded ZIP packages: no ZIP64, encryption or
 * multi-disk archives, safe relative paths only, no duplicates (ignoring
 * case), regular files and directories only, bounded sizes and compression
 * ratios, and every file's CRC checked. The same rules as skin packages.
 */

export interface ZipLimits {
  maxArchiveBytes: number;
  maxExpandedBytes: number;
  maxFiles: number;
}

export class ZipArchiveError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = "ZipArchiveError";
  }
}

interface Entry {
  path: string;
  compressedSize: number;
  expandedSize: number;
  compression: number;
  crc: number;
  localOffset: number;
  flags: number;
  isDirectory: boolean;
}

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

/** Every file in the archive by path (directories left out), with a shared top folder removed. */
export function readZipArchive(bytes: Buffer, limits: ZipLimits): Map<string, Buffer> {
  const entries = inspect(bytes, limits);
  const files = entries.filter(entry => !entry.isDirectory);
  const prefix = singleRootPrefix(entries.map(entry => entry.path));
  const result = new Map<string, Buffer>();
  for (const entry of files) {
    const content = extract(bytes, entry);
    if (content.byteLength !== entry.expandedSize || crc32(content) !== entry.crc) throw new ZipArchiveError("The package has a damaged file entry.", "ZIP_INVALID");
    result.set(entry.path.slice(prefix.length), content);
  }
  return result;
}

export function isSafeArchivePath(value: string, allowDirectory = false): boolean {
  const candidate = allowDirectory ? value.slice(0, -1) : value;
  return Boolean(candidate) && !candidate.startsWith("/") && !candidate.includes("\\") && !candidate.includes("\0") && !/^[a-z]:/i.test(candidate)
    && candidate.split("/").every(part => Boolean(part) && part !== "." && part !== ".." && !part.includes(":"));
}

function inspect(bytes: Buffer, limits: ZipLimits): Entry[] {
  if (bytes.byteLength < 22 || bytes.byteLength > limits.maxArchiveBytes) throw new ZipArchiveError("The package is empty or too large.", "ZIP_SIZE");
  const minOffset = Math.max(0, bytes.byteLength - 22 - 0xffff);
  let endOffset = -1;
  for (let offset = bytes.byteLength - 22; offset >= minOffset; offset -= 1) {
    if (bytes.readUInt32LE(offset) === EOCD_SIGNATURE) { endOffset = offset; break; }
  }
  if (endOffset < 0) throw new ZipArchiveError("The upload is not a valid ZIP package.", "ZIP_INVALID");
  const disk = bytes.readUInt16LE(endOffset + 4);
  const centralDisk = bytes.readUInt16LE(endOffset + 6);
  const entriesOnDisk = bytes.readUInt16LE(endOffset + 8);
  const entryCount = bytes.readUInt16LE(endOffset + 10);
  const centralSize = bytes.readUInt32LE(endOffset + 12);
  const centralOffset = bytes.readUInt32LE(endOffset + 16);
  const commentLength = bytes.readUInt16LE(endOffset + 20);
  if (disk !== 0 || centralDisk !== 0 || entriesOnDisk !== entryCount || entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff || endOffset + 22 + commentLength !== bytes.byteLength) {
    throw new ZipArchiveError("Multi-disk and ZIP64 packages are not supported.", "ZIP_FORMAT");
  }
  if (!entryCount || entryCount > limits.maxFiles || centralOffset + centralSize !== endOffset) throw new ZipArchiveError("The ZIP directory is invalid or contains too many files.", "ZIP_FILE_COUNT");

  const decoder = new TextDecoder("utf-8", { fatal: true });
  const entries: Entry[] = [];
  const seen = new Set<string>();
  let offset = centralOffset;
  let totalExpanded = 0;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > endOffset || bytes.readUInt32LE(offset) !== CENTRAL_SIGNATURE) throw new ZipArchiveError("The ZIP directory entry is invalid.", "ZIP_INVALID");
    const madeBy = bytes.readUInt16LE(offset + 4);
    const flags = bytes.readUInt16LE(offset + 8);
    const compression = bytes.readUInt16LE(offset + 10);
    const crc = bytes.readUInt32LE(offset + 16);
    const compressedSize = bytes.readUInt32LE(offset + 20);
    const expandedSize = bytes.readUInt32LE(offset + 24);
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const fileCommentLength = bytes.readUInt16LE(offset + 32);
    const diskStart = bytes.readUInt16LE(offset + 34);
    const externalAttributes = bytes.readUInt32LE(offset + 38);
    const localOffset = bytes.readUInt32LE(offset + 42);
    const recordEnd = offset + 46 + nameLength + extraLength + fileCommentLength;
    if (recordEnd > endOffset || diskStart !== 0 || flags & ~0x0808 || (compression !== 0 && compression !== 8) || compressedSize === 0xffffffff || expandedSize === 0xffffffff || localOffset === 0xffffffff) {
      throw new ZipArchiveError("Encrypted, multi-disk and unsupported ZIP entries are not allowed.", "ZIP_FORMAT");
    }
    let entryPath: string;
    try { entryPath = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength)); }
    catch { throw new ZipArchiveError("ZIP filenames must be valid UTF-8.", "ZIP_PATH"); }
    if (!(flags & 0x800) && /[^\x00-\x7f]/.test(entryPath)) throw new ZipArchiveError("Non-ASCII ZIP filenames must be encoded as UTF-8.", "ZIP_PATH");
    const isDirectory = entryPath.endsWith("/");
    if (!isSafeArchivePath(entryPath, isDirectory)) throw new ZipArchiveError("The package contains an unsafe path.", "ZIP_PATH");
    const normalized = entryPath.toLowerCase();
    if (seen.has(normalized)) throw new ZipArchiveError("The package contains duplicate or case-conflicting paths.", "ZIP_DUPLICATE");
    seen.add(normalized);
    const unixFileType = madeBy >> 8 === 3 ? (externalAttributes >>> 16) & 0xf000 : 0;
    if (unixFileType !== 0 && unixFileType !== 0x8000 && unixFileType !== 0x4000) throw new ZipArchiveError("Only regular files and directories are allowed.", "ZIP_FILE_TYPE");
    if ((unixFileType === 0x4000) !== isDirectory && unixFileType !== 0) throw new ZipArchiveError("ZIP file type does not match its path.", "ZIP_FILE_TYPE");
    if (isDirectory && (compressedSize !== 0 || expandedSize !== 0)) throw new ZipArchiveError("ZIP directory entries cannot contain data.", "ZIP_INVALID");
    if (compression === 0 && compressedSize !== expandedSize) throw new ZipArchiveError("A stored ZIP entry has inconsistent sizes.", "ZIP_INVALID");
    if (!isDirectory) {
      totalExpanded += expandedSize;
      if (totalExpanded > limits.maxExpandedBytes) throw new ZipArchiveError("The expanded package is too large.", "ZIP_EXPANDED_SIZE");
      if (expandedSize > 1024 * 1024 && expandedSize > Math.max(compressedSize, 1) * 250) throw new ZipArchiveError("The package has an abnormal compression ratio.", "ZIP_COMPRESSION_RATIO");
    }
    entries.push({ path: entryPath, compressedSize, expandedSize, compression, crc, localOffset, flags, isDirectory });
    offset = recordEnd;
  }
  if (offset !== centralOffset + centralSize) throw new ZipArchiveError("The ZIP directory length is inconsistent.", "ZIP_INVALID");
  checkLocalEntries(bytes, entries, centralOffset, decoder);
  return entries;
}

function checkLocalEntries(bytes: Buffer, entries: Entry[], centralOffset: number, decoder: TextDecoder): void {
  const spans: Array<{ start: number; end: number }> = [];
  for (const entry of entries) {
    const offset = entry.localOffset;
    if (offset + 30 > centralOffset || bytes.readUInt32LE(offset) !== LOCAL_SIGNATURE) throw new ZipArchiveError("A ZIP local file header is invalid.", "ZIP_INVALID");
    const flags = bytes.readUInt16LE(offset + 6);
    const compression = bytes.readUInt16LE(offset + 8);
    const nameLength = bytes.readUInt16LE(offset + 26);
    const extraLength = bytes.readUInt16LE(offset + 28);
    const headerEnd = offset + 30 + nameLength + extraLength;
    // With a data descriptor (flag 0x08) the local sizes and CRC may be zero; the central directory is authoritative.
    if (!(entry.flags & 0x08)) {
      const crc = bytes.readUInt32LE(offset + 14);
      const compressedSize = bytes.readUInt32LE(offset + 18);
      const expandedSize = bytes.readUInt32LE(offset + 22);
      if (crc !== entry.crc || compressedSize !== entry.compressedSize || expandedSize !== entry.expandedSize) throw new ZipArchiveError("ZIP local and central headers disagree.", "ZIP_INVALID");
    }
    if (headerEnd > centralOffset || flags !== entry.flags || compression !== entry.compression) throw new ZipArchiveError("ZIP local and central headers disagree.", "ZIP_INVALID");
    let localPath: string;
    try { localPath = decoder.decode(bytes.subarray(offset + 30, offset + 30 + nameLength)); }
    catch { throw new ZipArchiveError("ZIP filenames must be valid UTF-8.", "ZIP_PATH"); }
    if (localPath !== entry.path) throw new ZipArchiveError("ZIP local and central filenames disagree.", "ZIP_INVALID");
    const end = headerEnd + entry.compressedSize;
    if (end > centralOffset) throw new ZipArchiveError("A ZIP entry overlaps the central directory.", "ZIP_INVALID");
    spans.push({ start: offset, end });
  }
  spans.sort((left, right) => left.start - right.start);
  for (let index = 1; index < spans.length; index += 1) {
    if (spans[index]!.start < spans[index - 1]!.end) throw new ZipArchiveError("ZIP local file entries overlap.", "ZIP_INVALID");
  }
}

function extract(archive: Buffer, entry: Entry): Buffer {
  const offset = entry.localOffset;
  const nameLength = archive.readUInt16LE(offset + 26);
  const extraLength = archive.readUInt16LE(offset + 28);
  const dataStart = offset + 30 + nameLength + extraLength;
  const dataEnd = dataStart + entry.compressedSize;
  if (dataEnd > archive.byteLength) throw new ZipArchiveError("A ZIP entry extends past the archive.", "ZIP_INVALID");
  const compressed = archive.subarray(dataStart, dataEnd);
  if (entry.compression === 0) return Buffer.from(compressed);
  try { return inflateRawSync(compressed, { maxOutputLength: entry.expandedSize + 1 }); }
  catch { throw new ZipArchiveError("A ZIP entry could not be safely decompressed.", "ZIP_INVALID"); }
}

function singleRootPrefix(paths: string[]): string {
  if (!paths.length) return "";
  const firstSlash = paths[0]!.indexOf("/");
  if (firstSlash < 1) return "";
  const prefix = paths[0]!.slice(0, firstSlash + 1);
  return paths.every(item => item.startsWith(prefix)) ? prefix : "";
}

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

export function crc32(bytes: Buffer): number {
  let value = 0xffffffff;
  for (const byte of bytes) value = crcTable[(value ^ byte) & 0xff]! ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}
