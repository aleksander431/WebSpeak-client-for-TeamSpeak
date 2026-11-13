import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_SETTINGS, SettingsStore, sanitizeOverlay, sanitizeSettings } from "./settings.js";
import { overlayBounds, parseOverlayRoster, parseOverlaySpeaking } from "./overlay-state.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("the overlay is off by default and its settings are bounded", () => {
  assert.equal(DEFAULT_SETTINGS.overlay.enabled, false);
  assert.equal(sanitizeSettings({}).overlay.enabled, false);
  const overlay = sanitizeOverlay({ enabled: true, corner: "bottom-right", scale: 999, opacity: 1, offsetX: -5, offsetY: 40.6, mode: "speaking", showSelf: false, showChannel: "yes" });
  assert.deepEqual(overlay, { enabled: true, corner: "bottom-right", offsetX: 0, offsetY: 41, scale: 200, opacity: 20, mode: "speaking", showSelf: false, showChannel: true, showWhen: "games", apps: [] });
  assert.equal(sanitizeOverlay({ corner: "middle", mode: "all" }).corner, "top-left");
  assert.equal(sanitizeOverlay({ corner: "middle", mode: "all" }).mode, "channel");
});

test("saving one overlay option keeps the others", () => {
  const store = new SettingsStore(join(mkdtempSync(join(tmpdir(), "webspeak-overlay-")), "settings.json"));
  store.update({ overlay: { ...store.value.overlay, corner: "top-right", scale: 120 } });
  const next = store.update({ overlay: { enabled: true } as never });
  assert.deepEqual([next.overlay.enabled, next.overlay.corner, next.overlay.scale], [true, "top-right", 120]);
});

test("the overlay sits in its corner, inset by the offsets, and stays on the screen", () => {
  const display = { x: -1920, y: 0, width: 1920, height: 1080 };
  assert.deepEqual(overlayBounds(display, { corner: "top-left", offsetX: 20, offsetY: 30 }, 300, 100), { x: -1900, y: 30, width: 300, height: 100 });
  assert.deepEqual(overlayBounds(display, { corner: "bottom-right", offsetX: 20, offsetY: 30 }, 300, 100), { x: -320, y: 950, width: 300, height: 100 });
  // The middles of the sides: centred along that side, the offset shifts along it and insets from the edge.
  assert.deepEqual(overlayBounds(display, { corner: "top-center", offsetX: 0, offsetY: 30 }, 300, 100), { x: -1110, y: 30, width: 300, height: 100 });
  assert.deepEqual(overlayBounds(display, { corner: "bottom-center", offsetX: 40, offsetY: 30 }, 300, 100), { x: -1070, y: 950, width: 300, height: 100 });
  assert.deepEqual(overlayBounds(display, { corner: "middle-left", offsetX: 20, offsetY: 0 }, 300, 100), { x: -1900, y: 490, width: 300, height: 100 });
  assert.deepEqual(overlayBounds(display, { corner: "middle-right", offsetX: 20, offsetY: -50 }, 300, 100), { x: -320, y: 440, width: 300, height: 100 });
  assert.equal(sanitizeOverlay({ corner: "middle-left" }).corner, "middle-left");
  assert.deepEqual(overlayBounds(display, { corner: "top-right", offsetX: 5000, offsetY: 5000 }, 300, 100), { x: -1920, y: 980, width: 300, height: 100 });
  assert.deepEqual(overlayBounds(display, { corner: "top-left", offsetX: 0, offsetY: 0 }, 5000, 5000), { x: -1920, y: 0, width: 1920, height: 1080 });
});

test("page reports are validated before they reach the overlay", () => {
  const avatar = "data:image/png;base64,iVBORw0KGgo=";
  const roster = parseOverlayRoster({ connected: true, channel: "Dota", members: [
    { id: 5, name: "Alex", muted: true, self: true, avatar },
    { id: 0, name: "bad id" },
    { id: 6, name: "Ivan", avatar: "javascript:alert(1)", streaming: true },
    { id: 7, name: "x".repeat(100), streaming: "yes" },
  ] });
  assert.deepEqual(roster, { connected: true, channel: "Dota", members: [
    { id: 5, name: "Alex", muted: true, self: true, avatar },
    { id: 6, name: "Ivan", muted: false, self: false, streaming: true },
    { id: 7, name: "x".repeat(64), muted: false, self: false },
  ] });
  assert.equal(parseOverlayRoster({ members: [] }), null);
  assert.deepEqual(parseOverlaySpeaking([3, 3, "4", 70000, 9]), [3, 9]);
  assert.equal(parseOverlaySpeaking("3"), null);
});

test("the overlay shows only in games when asked: full screen or a listed program, never a browser", async () => {
  const { overlayWanted } = await import("./overlay-state.js");
  const games = { enabled: true, showWhen: "games" as const, apps: ["dota2.exe"] };
  assert.equal(overlayWanted(games, { fullscreen: true, exe: "cs2.exe" }), true);
  assert.equal(overlayWanted(games, { fullscreen: false, exe: "cs2.exe" }), false);
  assert.equal(overlayWanted(games, { fullscreen: false, exe: "dota2.exe" }), true, "a listed game counts in a window too");
  assert.equal(overlayWanted(games, { fullscreen: true, exe: "chrome.exe" }), false, "full-screen video is not a game");
  assert.equal(overlayWanted(games, { fullscreen: false, exe: "" }), false, "the desktop");
  assert.equal(overlayWanted(games, null), true, "without the helper it shows as before");
  assert.equal(overlayWanted({ ...games, showWhen: "always" }, { fullscreen: false, exe: "notepad.exe" }), true);
  assert.equal(overlayWanted({ ...games, enabled: false }, { fullscreen: true, exe: "cs2.exe" }), false);
});

test("listed programs are kept as bare lower-case file names", async () => {
  const { sanitizeOverlay } = await import("./settings.js");
  const overlay = sanitizeOverlay({ showWhen: "games", apps: ["C:\\Games\\Dota 2\\Dota2.EXE", "cs2", "cs2.exe", "bad/../", 5, "Мой Клиент.exe"] });
  assert.deepEqual(overlay.apps, ["dota2.exe", "cs2.exe", "мой_клиент.exe"]);
  assert.equal(sanitizeOverlay({}).showWhen, "games");
  assert.equal(sanitizeOverlay({ showWhen: "sometimes" }).showWhen, "games");
});
