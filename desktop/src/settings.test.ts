import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DEFAULT_SETTINGS, SettingsStore, isValidAccelerator, normalizeServerUrl, sanitizeSettings } from "./settings.js";
import { HotkeyManager } from "./hotkeys.js";
import { parseWebClientState } from "./state.js";
import { ALL_LANGUAGES, createTranslator } from "./i18n.js";

test("accelerators need a modifier unless they are F-keys or media keys", () => {
  for (const ok of ["", "CommandOrControl+Shift+M", "Alt+F9", "F13", "Super+Space", "MediaPlayPause", "Shift+num5"]) assert.ok(isValidAccelerator(ok), ok);
  for (const bad of ["M", "5", "Ctrl+", "Shift+Shift+M", "Hyper+M", "CommandOrControl+Shift", "Alt++"]) assert.ok(!isValidAccelerator(bad), bad);
});

test("server addresses are normalised and only http(s) is accepted", () => {
  assert.equal(normalizeServerUrl("webts.afire-server.space"), "https://webts.afire-server.space");
  assert.equal(normalizeServerUrl(" https://example.com/voice/ "), "https://example.com/voice");
  assert.equal(normalizeServerUrl("http://192.168.1.5:3040/"), "http://192.168.1.5:3040");
  for (const bad of ["", "file:///C:/x", "javascript:alert(1)", "https://user:pass@example.com", 42]) assert.equal(normalizeServerUrl(bad), null, String(bad));
});

test("stored settings are merged over defaults and invalid values dropped", () => {
  const settings = sanitizeSettings({ serverUrl: "ftp://x", launchAtLogin: "yes", closeToTray: false, hotkeys: { mic: "Q", sound: "Alt+F10", stream: "Alt+F10" }, streamHotkeySource: "everything", window: { width: 100, height: 99999, x: 10, y: 20, maximized: true } });
  assert.equal(settings.serverUrl, DEFAULT_SETTINGS.serverUrl);
  assert.equal(settings.launchAtLogin, true);
  assert.equal(settings.closeToTray, false);
  assert.equal(settings.hotkeys.mic, DEFAULT_SETTINGS.hotkeys.mic, "a bare letter is refused");
  assert.equal(settings.hotkeys.sound, "Alt+F10");
  assert.equal(settings.hotkeys.stream, "", "the same keys cannot drive two actions");
  assert.equal(settings.streamHotkeySource, "picker");
  assert.deepEqual(settings.window, { width: 480, height: 10000, x: 10, y: 20, maximized: true });
});

test("the settings file survives restarts and damaged files fall back to defaults", () => {
  const directory = mkdtempSync(join(tmpdir(), "webspeak-desktop-"));
  const file = join(directory, "settings.json");
  const store = new SettingsStore(file);
  assert.deepEqual(store.value, sanitizeSettings({}));
  store.update({ serverUrl: "voice.example.org", hotkeys: { mic: "Alt+F9" } as never });
  const reopened = new SettingsStore(file);
  assert.equal(reopened.value.serverUrl, "https://voice.example.org");
  assert.equal(reopened.value.hotkeys.mic, "Alt+F9");
  assert.equal(reopened.value.hotkeys.sound, DEFAULT_SETTINGS.hotkeys.sound, "other hotkeys are kept");
  assert.ok(JSON.parse(readFileSync(file, "utf8")));
  writeFileSync(file, "{ not json");
  assert.equal(new SettingsStore(file).value.serverUrl, DEFAULT_SETTINGS.serverUrl);
});

test("hotkeys report taken keys, ignore auto-repeat and re-register cleanly", () => {
  const registered = new Map<string, () => void>();
  let now = 0;
  const fired: string[] = [];
  const manager = new HotkeyManager({
    register: (accelerator, callback) => {
      if (accelerator === "Alt+F10") return false; // owned by another program
      registered.set(accelerator, callback);
      return true;
    },
    unregister: (accelerator) => { registered.delete(accelerator); },
  }, (action) => fired.push(action), () => now);
  const status = manager.apply({ mic: "CommandOrControl+Shift+M", sound: "Alt+F10", stream: "" });
  assert.deepEqual(status, { mic: "active", sound: "taken", stream: "off" });
  const press = registered.get("CommandOrControl+Shift+M")!;
  press(); now += 40; press(); now += 40; press();
  assert.deepEqual(fired, ["mic"], "a held key is one press");
  now += 1000; press();
  assert.deepEqual(fired, ["mic", "mic"]);
  manager.apply({ mic: "Alt+F9", sound: "", stream: "" });
  assert.deepEqual([...registered.keys()], ["Alt+F9"]);
  manager.clear();
  assert.equal(registered.size, 0);
});

test("web client state is validated before it reaches the tray", () => {
  assert.deepEqual(parseWebClientState({ connected: true, micMuted: false, soundMuted: true, streaming: false, extra: 1 }), { connected: true, micMuted: false, soundMuted: true, streaming: false });
  assert.equal(parseWebClientState({ connected: "yes" }), null);
  assert.equal(parseWebClientState(null), null);
});

test("every language has every string and the locale picks a language", () => {
  const keys = Object.keys(ALL_LANGUAGES.en!).sort();
  for (const [language, strings] of Object.entries(ALL_LANGUAGES)) assert.deepEqual(Object.keys(strings).sort(), keys, language);
  assert.equal(createTranslator("ru-RU").language, "ru");
  assert.equal(createTranslator("pt-BR").language, "en");
  assert.equal(createTranslator("ru").t("installUpdate", { version: "1.2.3" }), "Перезапустить и обновить до 1.2.3");
});
