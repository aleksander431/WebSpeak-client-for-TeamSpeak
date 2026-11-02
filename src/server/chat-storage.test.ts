import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { WebSpeakDatabase } from "../persistence/database.js";
import { ChatStorage, ChatStorageError, sanitizeFileName, sniffImageType } from "./chat-storage.js";
import { chatAttachmentMessage, parseChatAttachmentUrl, parseChatMessage } from "../shared/chat-storage.js";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

function fixture(t: test.TestContext) {
  const directory = mkdtempSync(path.join(tmpdir(), "webspeak-chat-"));
  const database = new WebSpeakDatabase(path.join(directory, "test.db"));
  let clock = 1_000;
  const storage = new ChatStorage(database, path.join(directory, "chat-files"), () => clock);
  t.after(() => { database.close(); rmSync(directory, { recursive: true, force: true }); });
  return { storage, database, directory, tick: (ms = 1) => { clock += ms; } };
}

async function* body(...chunks: Buffer[]) { for (const chunk of chunks) yield chunk; }
const bytes = (size: number, fill = 1) => Buffer.alloc(size, fill);

test("uploads are stored, typed by content and refused above the per-file limit", async t => {
  const { storage } = fixture(t);
  await storage.initialize();
  await storage.updateSettings({ maxFileBytes: 100, quotaBytes: 10_000, historyEnabled: true });
  const image = await storage.storeUpload(body(PNG, bytes(20)), "../../shot.png", "ts:1");
  assert.equal(image.mime, "image/png");
  assert.equal(image.name, "shot.png", "path components are dropped");
  assert.equal(image.size, PNG.length + 20);
  assert.ok(storage.file(image.id));
  const renamed = await storage.storeUpload(body(bytes(10)), "evil.png", "ts:1");
  assert.equal(renamed.mime, "application/octet-stream", "an extension alone does not make an image");
  await assert.rejects(storage.storeUpload(body(bytes(60), bytes(60)), "big.bin", "ts:1"), (error: unknown) => error instanceof ChatStorageError && error.code === "FILE_TOO_LARGE");
  await assert.rejects(storage.storeUpload(body(), "empty", "ts:1"), (error: unknown) => error instanceof ChatStorageError && error.code === "FILE_EMPTY");
  assert.deepEqual(readdirSync(storage.directory).filter(name => name.startsWith(".upload-")), [], "rejected uploads leave no temporary files");
  await storage.updateSettings({ maxFileBytes: 0, quotaBytes: 10_000, historyEnabled: true });
  await assert.rejects(storage.storeUpload(body(bytes(5)), "x", "ts:1"), (error: unknown) => error instanceof ChatStorageError && error.code === "CHAT_UPLOADS_DISABLED");
});

test("when the quota is full the oldest files and messages make room", async t => {
  const { storage, tick } = fixture(t);
  await storage.initialize();
  await storage.updateSettings({ maxFileBytes: 400, quotaBytes: 1_000, historyEnabled: true });
  const first = await storage.storeUpload(body(bytes(400)), "a", "ts:1"); tick();
  const second = await storage.storeUpload(body(bytes(400)), "b", "ts:1"); tick();
  const third = await storage.storeUpload(body(bytes(400)), "c", "ts:1"); tick();
  assert.equal(storage.file(first.id), null, "the oldest file was removed");
  assert.equal(existsSync(path.join(storage.directory, first.id)), false);
  assert.ok(storage.file(second.id) && storage.file(third.id));
  assert.equal(storage.currentUsage().usedBytes, 800);

  storage.recordMessage({ targetKey: "ts:1", scope: "channel", channelId: "5", senderUid: "u", senderName: "Kria", message: "x".repeat(100) });
  await storage.flush();
  assert.ok(storage.file(second.id), "a message that fits removes nothing");
  storage.recordMessage({ targetKey: "ts:1", scope: "channel", channelId: "5", senderUid: "u", senderName: "Kria", message: "y".repeat(100) });
  await storage.flush();
  assert.equal(storage.file(second.id), null, "the next message rotates out the oldest file");
  assert.ok(storage.currentUsage().usedBytes <= 1_000);

  await storage.updateSettings({ maxFileBytes: 400, quotaBytes: 300, historyEnabled: true });
  assert.equal(storage.file(third.id), null, "lowering the quota applies at once");
  assert.ok(storage.currentUsage().usedBytes <= 300);
});

test("history is kept once per message and read per channel", async t => {
  const { storage, tick } = fixture(t);
  await storage.initialize();
  const record = { targetKey: "ts:1", scope: "channel" as const, channelId: "5", senderUid: "", senderName: "Kria", message: "привет" };
  storage.recordMessage(record);
  storage.recordMessage({ ...record, senderUid: "uid-1" }); // the same message seen by a second gateway session
  tick(20_000);
  storage.recordMessage({ ...record, message: "ещё" });
  storage.recordMessage({ ...record, channelId: "6", message: "другой канал" });
  storage.recordMessage({ ...record, scope: "server", channelId: "", message: "всем" });
  await storage.flush();
  assert.deepEqual(storage.history("ts:1", "channel", "5").map(message => message.message), ["привет", "ещё"]);
  assert.deepEqual(storage.history("ts:1", "server", "").map(message => message.message), ["всем"]);
  assert.deepEqual(storage.history("ts:2", "channel", "5"), []);
  const [, latest] = storage.history("ts:1", "channel", "5");
  assert.deepEqual(storage.history("ts:1", "channel", "5", latest!.timestamp).map(message => message.message), ["привет"]);

  await storage.updateSettings({ maxFileBytes: 100, quotaBytes: 10_000, historyEnabled: false });
  storage.recordMessage({ ...record, message: "не сохраняется" });
  await storage.flush();
  assert.deepEqual(storage.history("ts:1", "channel", "5"), [], "disabled history is neither shown nor stored");
});

test("history search is case-insensitive, per conversation and newest first", async t => {
  const { storage, tick } = fixture(t);
  await storage.initialize();
  const record = { targetKey: "ts:1", scope: "channel" as const, channelId: "5", senderUid: "", senderName: "Kria", message: "" };
  for (const message of ["Сборка УПАЛА", "всё ок", "сборка снова упала", "Deploy done"]) { storage.recordMessage({ ...record, message }); tick(20_000); }
  storage.recordMessage({ ...record, channelId: "6", message: "сборка в другом канале" });
  await storage.flush();
  assert.deepEqual(storage.search("ts:1", "channel", "5", "  упала ").map(message => message.message), ["сборка снова упала", "Сборка УПАЛА"]);
  assert.deepEqual(storage.search("ts:1", "channel", "5", "kria").length, 4, "sender names match too");
  assert.deepEqual(storage.search("ts:1", "channel", "5", "   "), []);
  assert.deepEqual(storage.search("ts:2", "channel", "5", "сборка"), []);
});

test("startup removes files without a row and rows without a file", async t => {
  const { storage, database } = fixture(t);
  await storage.initialize();
  const kept = await storage.storeUpload(body(bytes(10)), "a", "ts:1");
  const lost = await storage.storeUpload(body(bytes(10)), "b", "ts:1");
  rmSync(path.join(storage.directory, lost.id));
  const stray = "0123456789abcdef0123456789abcdef";
  writeFileSync(path.join(storage.directory, stray), "x");
  writeFileSync(path.join(storage.directory, ".upload-dead"), "x");
  const fresh = new ChatStorage(database, storage.directory);
  await fresh.initialize();
  assert.ok(fresh.file(kept.id));
  assert.equal(fresh.file(lost.id), null);
  assert.deepEqual(readdirSync(storage.directory).sort(), [kept.id]);
  assert.equal(fresh.currentUsage().fileCount, 1);
});

test("settings are validated", async t => {
  const { storage } = fixture(t);
  await assert.rejects(storage.updateSettings({ maxFileBytes: -1, quotaBytes: 10, historyEnabled: true }), ChatStorageError);
  await assert.rejects(storage.updateSettings({ maxFileBytes: 1, quotaBytes: 1.5, historyEnabled: true }), ChatStorageError);
  await assert.rejects(storage.updateSettings({ maxFileBytes: 1, quotaBytes: 1, historyEnabled: "yes" as unknown as boolean }), ChatStorageError);
});

test("image sniffing and file names", () => {
  assert.equal(sniffImageType(PNG), "image/png");
  assert.equal(sniffImageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), "image/jpeg");
  assert.equal(sniffImageType(Buffer.from("GIF89a....")), "image/gif");
  assert.equal(sniffImageType(Buffer.from("RIFF\0\0\0\0WEBPVP8 ")), "image/webp");
  assert.equal(sniffImageType(Buffer.from("<svg xmlns=")), null);
  assert.equal(sanitizeFileName("C:\\Users\\me\\отчёт.pdf"), "отчёт.pdf");
  assert.equal(sanitizeFileName("..\u0000"), "file");
  assert.equal(sanitizeFileName(".htaccess"), "htaccess");
});

test("attachment messages round-trip through TeamSpeak BBCode", () => {
  const origin = "https://webts.example.test";
  const message = chatAttachmentMessage(origin, { id: "0123456789abcdef0123456789abcdef", name: "скрин [1].png" });
  assert.equal(message, "[URL=https://webts.example.test/api/chat/files/0123456789abcdef0123456789abcdef]скрин _1_.png[/URL]");
  const [part] = parseChatMessage(message);
  assert.deepEqual(part, { kind: "link", href: "https://webts.example.test/api/chat/files/0123456789abcdef0123456789abcdef", text: "скрин _1_.png" });
  assert.equal(parseChatAttachmentUrl((part as { href: string }).href, origin), "0123456789abcdef0123456789abcdef");
  assert.equal(parseChatAttachmentUrl((part as { href: string }).href, "https://other.test"), null, "another server's link is just a link");

  assert.deepEqual(parseChatMessage("see [URL]https://a.test/x[/URL] and http://b.test ok"), [
    { kind: "text", text: "see " }, { kind: "link", href: "https://a.test/x", text: "https://a.test/x" },
    { kind: "text", text: " and " }, { kind: "link", href: "http://b.test/", text: "http://b.test" }, { kind: "text", text: " ok" },
  ]);
  assert.deepEqual(parseChatMessage("[URL=javascript:alert(1)]x[/URL]"), [{ kind: "text", text: "[URL=javascript:alert(1)]x[/URL]" }], "only http(s) becomes a link");
  const long = chatAttachmentMessage(origin, { id: "0123456789abcdef0123456789abcdef", name: `${"очень длинное имя ".repeat(10)}.mp4` });
  assert.ok(long.length < 200, "long names are shortened to fit a TeamSpeak message");
  assert.match(long, /\.mp4\[\/URL\]$/);
});
