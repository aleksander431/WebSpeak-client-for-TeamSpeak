import { test } from "node:test";
import assert from "node:assert/strict";
import { ServerPreviewService, SERVER_PREVIEW_QUERY_TTL_MS, SERVER_PREVIEW_QUERY_RETRY_MS } from "./server-preview.js";
import { projectPreview } from "../admin/ts-admin-service.js";
import { parseServerPreview, serverPreviewChannelPath } from "../shared/server-preview.js";

const lobby = { id: "1", parentID: "0", name: "Lobby", members: [{ nickname: "Alex" }] };

test("a connected session's live list wins and never touches ServerQuery", async () => {
  let queries = 0;
  const service = new ServerPreviewService({ fixed: () => true, live: async () => [lobby], query: async () => { queries += 1; return []; } });
  const preview = await service.read();
  assert.equal(preview.available, true);
  assert.equal(preview.available && preview.source, "live");
  assert.equal(queries, 0);
});

test("ServerQuery results are cached, and a missing source is retried later", async () => {
  let time = 1_000;
  let queries = 0;
  let result: typeof lobby[] | null = null;
  const service = new ServerPreviewService({ fixed: () => true, live: async () => null, query: async () => { queries += 1; return result; }, now: () => time });
  assert.deepEqual(await service.read(), { available: false, reason: "no-source" });
  result = [lobby];
  time += SERVER_PREVIEW_QUERY_RETRY_MS - 1;
  await service.read();
  assert.equal(queries, 1, "a failed or unconfigured query is not repeated at once");
  time += 2;
  assert.equal((await service.read()).available, true);
  time += SERVER_PREVIEW_QUERY_TTL_MS - 1;
  await Promise.all([service.read(), service.read()]);
  assert.equal(queries, 2);
});

test("an open gateway shows nothing", async () => {
  const service = new ServerPreviewService({ fixed: () => false, live: async () => [lobby], query: async () => [lobby] });
  assert.deepEqual(await service.read(), { available: false, reason: "open-mode" });
});

test("the query projection keeps voice clients only, by channel, without unique ids", () => {
  const channels = projectPreview(
    [{ id: 1n, parentID: 0n, order: 0n, name: "Lobby", hasPassword: false }, { id: 2n, parentID: 1n, name: "Games", hasPassword: true, isPermanent: true }],
    [
      { channelID: 2n, nickname: "Sasha", type: 0, isAway: true, isInputMuted: true },
      { channelID: 1n, nickname: "serveradmin", type: 1, isAway: false },
    ],
  );
  assert.deepEqual(channels, [
    { id: "1", parentID: "0", order: "0", name: "Lobby", members: [] },
    { id: "2", parentID: "1", name: "Games", passwordProtected: true, isPermanent: true, members: [{ nickname: "Sasha", away: true, inputMuted: true, outputMuted: false }] },
  ]);
});

test("the browser parser drops malformed entries and builds channel paths", () => {
  const preview = parseServerPreview({ available: true, source: "query", observedAt: "x", channels: [
    { id: "1", parentID: "0", name: "Lobby", members: [{ nickname: "Alex", uid: "secret" }, { nickname: 5 }] },
    { id: "2", parentID: "1", name: "Games", members: "nope" },
    { name: "no id" },
  ] });
  assert.equal(preview.available, true);
  if (!preview.available) return;
  assert.equal(preview.channels.length, 2);
  assert.deepEqual(preview.channels[0]!.members, [{ nickname: "Alex", away: false, inputMuted: false, outputMuted: false }]);
  assert.equal(serverPreviewChannelPath(preview.channels, "2"), "Lobby/Games");
  assert.deepEqual(parseServerPreview({ available: false, reason: "weird" }), { available: false, reason: "unavailable" });
});

test("channels come out in tree order with depth, cycles included once", async () => {
  const { orderServerPreview } = await import("../shared/server-preview.js");
  const rows = orderServerPreview([
    { id: "3", parentID: "0", order: "1", name: "Second", members: [] },
    { id: "1", parentID: "0", order: "0", name: "First", members: [] },
    { id: "5", parentID: "1", order: "0", name: "Child", members: [] },
    { id: "8", parentID: "9", name: "Loop A", members: [] },
    { id: "9", parentID: "8", name: "Loop B", members: [] },
  ]);
  assert.deepEqual(rows.map(row => `${row.depth}:${row.channel.name}`), ["0:First", "1:Child", "0:Second", "0:Loop A", "1:Loop B"]);
});
