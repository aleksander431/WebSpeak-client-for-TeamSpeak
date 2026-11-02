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
  assert.deepEqual(overlay, { enabled: true, corner: "bottom-right", offsetX: 0, offsetY: 41, scale: 200, opacity: 20, mode: "speaking", showSelf: false, showChannel: true });
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
  assert.deepEqual(overlayBounds(display, { corner: "top-right", offsetX: 5000, offsetY: 5000 }, 300, 100), { x: -1920, y: 980, width: 300, height: 100 });
  assert.deepEqual(overlayBounds(display, { corner: "top-left", offsetX: 0, offsetY: 0 }, 5000, 5000), { x: -1920, y: 0, width: 1920, height: 1080 });
});

test("page reports are validated before they reach the overlay", () => {
  const avatar = "data:image/png;base64,iVBORw0KGgo=";
  const roster = parseOverlayRoster({ connected: true, channel: "Dota", members: [
    { id: 5, name: "Alex", muted: true, self: true, avatar },
    { id: 0, name: "bad id" },
    { id: 6, name: "Ivan", avatar: "javascript:alert(1)" },
    { id: 7, name: "x".repeat(100) },
  ] });
  assert.deepEqual(roster, { connected: true, channel: "Dota", members: [
    { id: 5, name: "Alex", muted: true, self: true, avatar },
    { id: 6, name: "Ivan", muted: false, self: false },
    { id: 7, name: "x".repeat(64), muted: false, self: false },
  ] });
  assert.equal(parseOverlayRoster({ members: [] }), null);
  assert.deepEqual(parseOverlaySpeaking([3, 3, "4", 70000, 9]), [3, 9]);
  assert.equal(parseOverlaySpeaking("3"), null);
});
