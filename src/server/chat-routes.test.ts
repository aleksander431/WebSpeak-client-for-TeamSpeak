import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import express from "express";
import { WebSpeakDatabase } from "../persistence/database.js";
import { ChatStorage } from "./chat-storage.js";
import { registerChatRoutes } from "./chat-routes.js";
import { CHAT_TOKEN_HEADER } from "../shared/chat-storage.js";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

async function serve(t: test.TestContext) {
  const directory = mkdtempSync(path.join(tmpdir(), "webspeak-chat-routes-"));
  const database = new WebSpeakDatabase(path.join(directory, "test.db"));
  const storage = new ChatStorage(database, path.join(directory, "files"));
  await storage.initialize();
  await storage.updateSettings({ maxFileBytes: 1024, quotaBytes: 100_000, historyEnabled: true });
  const app = express();
  app.use(express.json());
  let channelId = "5";
  registerChatRoutes(app, {
    storage,
    resolveSession: token => token === "valid-token-123456" ? { entryId: "e1", targetKey: "ts:1", channelId, nickname: "Kria", viewerKey: "uid:k" } : null,
    isSameOrigin: request => request.header("origin") === "https://webts.test",
    logger: { info() {}, warn() {} },
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return { base: `http://127.0.0.1:${address.port}`, storage, moveTo: (id: string) => { channelId = id; } };
}

const headers = (extra: Record<string, string> = {}) => ({
  origin: "https://webts.test", [CHAT_TOKEN_HEADER]: "valid-token-123456", "content-type": "application/octet-stream", ...extra,
});

test("a connected session uploads, and the file is served without running anything", async t => {
  const { base } = await serve(t);
  const upload = await fetch(`${base}/api/chat/files`, { method: "POST", headers: headers({ "x-webspeak-file-name": encodeURIComponent("скрин.png") }), body: PNG });
  assert.equal(upload.status, 201);
  const { file } = await upload.json() as { file: { id: string; mime: string; name: string } };
  assert.equal(file.mime, "image/png");
  assert.equal(file.name, "скрин.png");

  const image = await fetch(`${base}/api/chat/files/${file.id}/x.png`);
  assert.equal(image.status, 200);
  assert.equal(image.headers.get("content-type"), "image/png");
  assert.match(image.headers.get("content-disposition") ?? "", /^inline;/);
  assert.equal(image.headers.get("content-security-policy"), "default-src 'none'; sandbox");
  assert.deepEqual(Buffer.from(await image.arrayBuffer()), PNG);

  const html = await fetch(`${base}/api/chat/files`, { method: "POST", headers: headers({ "x-webspeak-file-name": "page.html" }), body: "<script>alert(1)</script>" });
  const { file: page } = await html.json() as { file: { id: string } };
  const download = await fetch(`${base}/api/chat/files/${page.id}`);
  assert.equal(download.headers.get("content-type"), "application/octet-stream");
  assert.match(download.headers.get("content-disposition") ?? "", /^attachment;/, "anything but a raster image is a download");

  assert.equal((await fetch(`${base}/api/chat/files/ffffffffffffffffffffffffffffffff`)).status, 404);
  assert.equal((await fetch(`${base}/api/chat/files/..%2F..%2Ftest.db`)).status, 404);
});

test("uploads need a live session, this origin and a size within the limit", async t => {
  const { base } = await serve(t);
  assert.equal((await fetch(`${base}/api/chat/files`, { method: "POST", headers: headers({ [CHAT_TOKEN_HEADER]: "stale" }), body: PNG })).status, 401);
  assert.equal((await fetch(`${base}/api/chat/files`, { method: "POST", headers: headers({ origin: "https://evil.test" }), body: PNG })).status, 403);
  const tooBig = await fetch(`${base}/api/chat/files`, { method: "POST", headers: headers(), body: Buffer.alloc(2048) });
  assert.equal(tooBig.status, 413);
  assert.equal((await tooBig.json() as { maxFileBytes: number }).maxFileBytes, 1024);
});

test("history is read for the session's own channel only", async t => {
  const { base, storage, moveTo } = await serve(t);
  storage.recordMessage({ targetKey: "ts:1", scope: "channel", channelId: "5", senderUid: "", senderName: "Kria", message: "в пятом" });
  storage.recordMessage({ targetKey: "ts:1", scope: "channel", channelId: "6", senderUid: "", senderName: "Kria", message: "в шестом" });
  await storage.flush();
  const read = async () => (await (await fetch(`${base}/api/chat/history?scope=channel`, { headers: headers() })).json() as { messages: { message: string }[] }).messages.map(message => message.message);
  assert.deepEqual(await read(), ["в пятом"]);
  moveTo("6");
  assert.deepEqual(await read(), ["в шестом"]);
  assert.equal((await fetch(`${base}/api/chat/history?scope=channel`, { headers: headers({ [CHAT_TOKEN_HEADER]: "stale" }) })).status, 401);
  const search = async (q: string) => (await (await fetch(`${base}/api/chat/history?scope=channel&q=${encodeURIComponent(q)}`, { headers: headers() })).json() as { messages: { message: string }[] }).messages.map(message => message.message);
  assert.deepEqual(await search("ШЕСТ"), ["в шестом"]);
  assert.deepEqual(await search("пятом"), [], "search stays within the current channel");
});
