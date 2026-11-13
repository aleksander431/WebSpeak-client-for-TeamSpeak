import assert from "node:assert/strict";
import test from "node:test";
import { parseWatchClientMessage, parseWatchUrl, watchableLink, watchPositionAfter, type WatchServerMessage } from "../shared/watch-together.js";
import { WATCH_IDLE_MS, WatchCoordinator } from "./watch-coordinator.js";

test("video links: YouTube in its usual forms with start times, direct files and chat attachments", () => {
  const yt = (url: string) => parseWatchUrl(url);
  assert.deepEqual(yt("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1m30s"), { media: { kind: "youtube", id: "dQw4w9WgXcQ", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }, start: 90 });
  assert.equal(yt("youtu.be/dQw4w9WgXcQ?t=42")?.start, 42);
  assert.equal(yt("https://m.youtube.com/shorts/dQw4w9WgXcQ")?.media.kind, "youtube");
  assert.equal(yt("https://music.youtube.com/watch?v=dQw4w9WgXcQ")?.media.kind, "youtube");
  assert.equal(yt("https://www.youtube.com/live/dQw4w9WgXcQ?feature=share")?.media.kind, "youtube");
  assert.equal(yt("https://www.youtube.com/embed/dQw4w9WgXcQ?start=5")?.start, 5);
  assert.equal(yt("https://www.youtube.com/watch?v=short"), null);
  assert.deepEqual(yt("https://cdn.example.org/films/trailer.MP4?sig=1"), { media: { kind: "file", url: "https://cdn.example.org/films/trailer.MP4?sig=1" }, start: 0 });
  assert.equal(yt("https://talk.example.org/api/chat/files/0123456789abcdef0123456789abcdef")?.media.kind, "file");
  assert.equal(yt("https://example.org/page.html"), null);
  assert.equal(yt("javascript:alert(1)//x.mp4"), null);
  assert.equal(yt("ftp://example.org/a.mp4"), null);
  assert.equal(yt("https://user:pass@example.org/a.mp4"), null);
  assert.equal(watchableLink("глянь https://example.org/x и https://youtu.be/dQw4w9WgXcQ!"), "https://youtu.be/dQw4w9WgXcQ");
  assert.equal(watchableLink("[URL=https://talk.example.org/api/chat/files/0123456789abcdef0123456789abcdef]кот.mp4[/URL]"), "https://talk.example.org/api/chat/files/0123456789abcdef0123456789abcdef");
  assert.equal(watchableLink("просто текст https://example.org/page"), null);
  assert.equal(watchableLink("[URL=https://talk.example.org/api/chat/files/0123456789abcdef0123456789abcdef]кот.png[/URL]"), null);
});

test("watch frames are checked before they reach the coordinator", () => {
  assert.equal(parseWatchClientMessage({ type: "chat" }), null);
  assert.deepEqual(parseWatchClientMessage({ type: "watchControl", id: "abc", action: "pause", position: 12.5 }), { type: "watchControl", id: "abc", action: "pause", position: 12.5 });
  assert.ok("error" in (parseWatchClientMessage({ type: "watchControl", id: "abc", action: "rewind", position: 1 }) ?? {}));
  assert.ok("error" in (parseWatchClientMessage({ type: "watchControl", id: "abc", action: "seek", position: -1 }) ?? {}));
  assert.deepEqual(parseWatchClientMessage({ type: "watchMeta", id: "abc", title: " Film\nname ", duration: 300 }), { type: "watchMeta", id: "abc", title: "Film name", duration: 300 });
  assert.equal(watchPositionAfter({ playing: true, position: 10, duration: 0 }, 2500), 12.5);
  assert.equal(watchPositionAfter({ playing: true, position: 10, duration: 11 }, 5000), 11);
  assert.equal(watchPositionAfter({ playing: false, position: 10, duration: 0 }, 5000), 10);
});

test("one shared player per channel: start, pause, seek, viewers, moving and leaving", () => {
  let now = 1_000_000;
  const sent: Array<{ to: string; message: WatchServerMessage }> = [];
  let ids = 0;
  const watch = new WatchCoordinator({ send: (to, message) => sent.push({ to, message }), now: () => now, randomId: () => `v${++ids}` });
  const sasha = { entryId: "a", nickname: "Саша", roomKey: "srv#1" };
  const mirra = { entryId: "b", nickname: "Мирра", roomKey: "srv#1" };
  const ivan = { entryId: "c", nickname: "Ivan", roomKey: "srv#2" };
  const last = (to: string) => [...sent].reverse().find(item => item.to === to)?.message;
  const room = (to: string) => { const message = last(to); return message?.type === "watchState" ? message.room : undefined; };

  watch.handleMessage(sasha, { type: "watchStart", url: "https://youtu.be/dQw4w9WgXcQ" });
  assert.deepEqual(last("a"), { type: "watchError", code: "WATCH_NOT_OPEN" });
  for (const who of [sasha, mirra, ivan]) watch.handleMessage(who, { type: "watchOpen" });
  assert.equal(room("a"), null);

  watch.handleMessage(sasha, { type: "watchStart", url: "https://youtu.be/dQw4w9WgXcQ?t=30" });
  assert.equal(room("b")?.media.kind, "youtube");
  assert.equal(room("b")?.position, 30);
  assert.deepEqual(room("b")?.viewers, ["Саша"]);
  assert.equal(room("c"), null, "another channel sees nothing");

  now += 10_000;
  watch.handleMessage(mirra, { type: "watchView", watching: true });
  assert.equal(room("a")?.position, 40, "the position runs on the gateway clock");
  assert.deepEqual(room("a")?.viewers, ["Мирра", "Саша"]);

  watch.handleMessage(mirra, { type: "watchMeta", id: "v1", title: "Song", duration: 212 });
  watch.handleMessage(sasha, { type: "watchMeta", id: "v1", title: "Other", duration: 999 });
  assert.equal(room("a")?.title, "Song");
  assert.equal(room("a")?.duration, 212);

  watch.handleMessage(mirra, { type: "watchControl", id: "v1", action: "pause", position: 41 });
  now += 60_000;
  assert.equal(room("a")?.playing, false);
  assert.deepEqual(room("a")?.last, { by: "Мирра", action: "pause", at: 1_010_000 });
  watch.handleMessage(sasha, { type: "watchControl", id: "v1", action: "seek", position: 100 });
  assert.equal(room("b")?.position, 100);
  assert.equal(room("b")?.playing, false, "seeking keeps a paused video paused");
  watch.handleMessage(sasha, { type: "watchControl", id: "old", action: "play", position: 0 });
  assert.deepEqual(last("a"), { type: "watchError", code: "WATCH_STALE" });

  watch.handleMessage(mirra, { type: "watchStart", url: "https://example.org/page" });
  assert.deepEqual(last("b"), { type: "watchError", code: "WATCH_BAD_URL" });

  // Mirra moves to Ivan's channel: she sees nothing there, and leaves Sasha's viewers.
  watch.onRoomChanged({ ...mirra, roomKey: "srv#2" });
  assert.equal(room("b"), null);
  assert.deepEqual(room("a")?.viewers, ["Саша"]);

  watch.handleMessage(sasha, { type: "watchStop" });
  assert.equal(room("a"), null);
  assert.equal(watch.roomCount(), 0);
});

test("a room nobody is in is forgotten after a while", () => {
  let now = 0;
  const watch = new WatchCoordinator({ send: () => {}, now: () => now });
  const sasha = { entryId: "a", nickname: "Саша", roomKey: "srv#1" };
  watch.handleMessage(sasha, { type: "watchOpen" });
  watch.handleMessage(sasha, { type: "watchStart", url: "https://youtu.be/dQw4w9WgXcQ" });
  watch.removePeer("a");
  assert.equal(watch.roomCount(), 1, "a short absence keeps the video");
  now += WATCH_IDLE_MS + 1;
  watch.handleMessage({ entryId: "b", nickname: "Мирра", roomKey: "srv#9" }, { type: "watchOpen" });
  assert.equal(watch.roomCount(), 0);
});

test("a queue: added from anywhere, removed, skipped to and played on when a video ends", () => {
  let now = 0;
  let ids = 0;
  const sent: Array<{ to: string; message: WatchServerMessage }> = [];
  const watch = new WatchCoordinator({ send: (to, message) => sent.push({ to, message }), now: () => now, randomId: () => `k${++ids}` });
  const sasha = { entryId: "a", nickname: "Саша", roomKey: "srv#1" };
  const mirra = { entryId: "b", nickname: "Мирра", roomKey: "srv#1" };
  const room = (to: string) => { const message = [...sent].reverse().find(item => item.to === to)?.message; return message?.type === "watchState" ? message.room : undefined; };
  for (const who of [sasha, mirra]) watch.handleMessage(who, { type: "watchOpen" });

  // Queueing with nothing playing starts the video.
  watch.handleMessage(sasha, { type: "watchQueue", url: "https://youtu.be/dQw4w9WgXcQ" });
  assert.equal(room("b")?.media.kind, "youtube");
  assert.deepEqual(room("b")?.queue, []);
  const first = room("b")!.id;
  watch.handleMessage(mirra, { type: "watchView", watching: true });

  watch.handleMessage(mirra, { type: "watchQueue", url: "https://example.org/a.mp4" });
  watch.handleMessage(sasha, { type: "watchQueue", url: "https://youtu.be/aaaaaaaaaaa?t=10" });
  watch.handleMessage(sasha, { type: "watchQueue", url: "https://example.org/page" });
  assert.deepEqual([...sent].reverse().find(item => item.to === "a")?.message, { type: "watchError", code: "WATCH_BAD_URL" });
  assert.deepEqual(room("b")?.queue.map(item => [item.addedBy, item.media.kind, item.start]), [["Мирра", "file", 0], ["Саша", "youtube", 10]]);

  // Skipping plays the next one; those watching keep watching.
  watch.handleMessage(mirra, { type: "watchNext", id: first });
  const second = room("a")!;
  assert.notEqual(second.id, first);
  assert.equal(second.media.kind, "file");
  assert.equal(second.startedBy, "Мирра");
  assert.equal(second.continued, true);
  assert.deepEqual(second.viewers, ["Мирра", "Саша"]);
  watch.handleMessage(mirra, { type: "watchNext", id: first });
  assert.equal(room("a")?.id, second.id, "a second skip of the same video is ignored");

  // An end report before the shared clock reaches the end does nothing.
  watch.handleMessage(sasha, { type: "watchMeta", id: second.id, title: "A", duration: 60 });
  now += 30_000;
  watch.handleMessage(sasha, { type: "watchEnded", id: second.id });
  assert.equal(room("a")?.id, second.id);
  now += 31_000;
  watch.handleMessage(sasha, { type: "watchEnded", id: second.id });
  const third = room("a")!;
  assert.equal(third.media.kind, "youtube");
  assert.equal(third.position, 10);
  assert.deepEqual(third.queue, []);

  watch.handleMessage(mirra, { type: "watchQueue", url: "https://example.org/b.webm" });
  const key = room("a")!.queue[0]!.key;
  watch.handleMessage(sasha, { type: "watchQueueRemove", key });
  assert.deepEqual(room("a")?.queue, []);

  // The last video ending stops on its last frame.
  watch.handleMessage(sasha, { type: "watchMeta", id: third.id, title: "B", duration: 20 });
  now += 20_000;
  watch.handleMessage(mirra, { type: "watchEnded", id: third.id });
  assert.equal(room("a")?.playing, false);
  assert.equal(room("a")?.position, 20);
});
