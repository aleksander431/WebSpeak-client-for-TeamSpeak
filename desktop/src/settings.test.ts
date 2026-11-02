import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DEFAULT_SETTINGS, SettingsStore, isValidAccelerator, isValidPushToTalk, normalizeServerUrl, sanitizeSettings } from "./settings.js";
import { HotkeyManager } from "./hotkeys.js";
import { parseWebClientState } from "./state.js";
import { ALL_LANGUAGES, createTranslator } from "./i18n.js";

test("typing keys need a modifier, other keys may stand alone", () => {
  for (const ok of ["", "CommandOrControl+Shift+M", "Alt+F9", "F13", "Super+Space", "MediaPlayPause", "Shift+num5"]) assert.ok(isValidAccelerator(ok), ok);
  for (const bad of ["M", "5", "Space", "Enter", "Up", "`", "Ctrl+", "Shift+Shift+M", "Hyper+M", "CommandOrControl+Shift", "Alt++"]) assert.ok(!isValidAccelerator(bad), bad);
  for (const single of ["Insert", "PageDown", "num5", "numadd", "Scrolllock", "PrintScreen", "F24", "Pause", "Mouse4", "Mouse5"]) assert.ok(isValidAccelerator(single), `${single} works alone`);
  assert.ok(isValidAccelerator("CommandOrControl+Mouse5"));
});

test("server addresses are normalised and only http(s) is accepted", () => {
  assert.equal(normalizeServerUrl("webts.afire-server.space"), "https://webts.afire-server.space");
  assert.equal(normalizeServerUrl(" https://example.com/voice/ "), "https://example.com/voice");
  assert.equal(normalizeServerUrl("http://192.168.1.5:3040/"), "http://192.168.1.5:3040");
  for (const bad of ["", "file:///C:/x", "javascript:alert(1)", "https://user:pass@example.com", 42]) assert.equal(normalizeServerUrl(bad), null, String(bad));
});

test("stored settings are merged over defaults and invalid values dropped", () => {
  const settings = sanitizeSettings({ serverUrl: "ftp://x", launchAtLogin: "yes", closeToTray: false, hotkeys: { mic: "Q", sound: "Alt+F10", stream: "Alt+F10" }, streamHotkeySource: "everything", window: { width: 100, height: 99999, x: 10, y: 20, maximized: true } });
  assert.equal(settings.serverUrl, "", "no server until the user enters one");
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
  assert.equal(store.value.serverUrl, "", "a fresh install has no server");
  store.update({ serverUrl: "voice.example.org", hotkeys: { mic: "Alt+F9" } as never });
  const reopened = new SettingsStore(file);
  assert.equal(reopened.value.serverUrl, "https://voice.example.org");
  assert.equal(reopened.value.hotkeys.mic, "Alt+F9");
  assert.equal(reopened.value.hotkeys.sound, DEFAULT_SETTINGS.hotkeys.sound, "other hotkeys are kept");
  assert.ok(JSON.parse(readFileSync(file, "utf8")));
  writeFileSync(file, "{ not json");
  assert.equal(new SettingsStore(file).value.serverUrl, "");
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
  assert.deepEqual(status, { mic: "active", sound: "taken", stream: "off", ptt: "off" });
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
  assert.deepEqual(parseWebClientState({ connected: true, micMuted: false, soundMuted: true, streaming: false, extra: 1 }), { connected: true, micMuted: false, soundMuted: true, streaming: false, speaking: false }, "older pages without speaking");
  assert.equal(parseWebClientState({ connected: true, micMuted: false, soundMuted: false, streaming: false, speaking: true })?.speaking, true);
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

test("Pause and mouse buttons go to the native helper and report its answers", () => {
  const sets: { action: string; accelerator: string }[][] = [];
  let helperAvailable = true;
  const fired: string[] = [];
  const changes: unknown[] = [];
  let now = 0;
  const manager = new HotkeyManager(
    { register: () => true, unregister: () => {} },
    (action) => fired.push(action),
    () => now,
    { set: (bindings) => { sets.push(bindings); return helperAvailable; } },
    (status) => changes.push(status),
  );
  const status = manager.apply({ mic: "Pause", sound: "CommandOrControl+Shift+D", stream: "Mouse5" });
  assert.deepEqual(status, { mic: "active", sound: "active", stream: "active", ptt: "off" });
  assert.deepEqual(sets.at(-1), [{ action: "mic", accelerator: "Pause" }, { action: "stream", accelerator: "Mouse5" }]);
  manager.nativeResult("stream", "taken");
  assert.equal(manager.statuses().stream, "taken");
  manager.nativeResult("sound", "unsupported");
  assert.equal(manager.statuses().sound, "active", "the helper cannot change keys it does not own");
  manager.nativeFire("mic");
  manager.nativeFire("sound");
  assert.deepEqual(fired, ["mic"]);
  assert.equal(changes.length, 1);
  helperAvailable = false;
  assert.equal(manager.apply({ mic: "Pause", sound: "", stream: "" }).mic, "unsupported", "no helper (not Windows) is reported");
  manager.clear();
  assert.deepEqual(sets.at(-1), [], "clearing stops the helper's hotkeys");
});

test("push-to-talk accepts one held key, modifier or mouse button", () => {
  for (const key of ["", "V", "Capslock", "`", "F13", "Ctrl", "Alt", "Shift", "Mouse3", "Mouse4", "Mouse5", "num0", "Space"]) assert.ok(isValidPushToTalk(key), key);
  for (const key of ["Ctrl+V", "MediaPlayPause", "VolumeUp", "Win", "v", "Mouse1"]) assert.equal(isValidPushToTalk(key), false, key);
  assert.equal(DEFAULT_SETTINGS.pushToTalk, "");
  assert.equal(sanitizeSettings({ pushToTalk: "Mouse4" }).pushToTalk, "Mouse4");
  assert.equal(sanitizeSettings({ pushToTalk: "Ctrl+V" }).pushToTalk, "");
  assert.equal(sanitizeSettings({ hotkeys: { mic: "Mouse4", sound: "", stream: "" }, pushToTalk: "Mouse4" }).pushToTalk, "", "it cannot share a key with a toggle hotkey");
});

test("push-to-talk goes to the native helper, reports press and release, and never stays held", () => {
  const sets: Array<{ bindings: unknown[]; ptt: string | null | undefined }> = [];
  const holds: boolean[] = [];
  const changes: Array<Record<string, string>> = [];
  let helperAvailable = true;
  const manager = new HotkeyManager(
    { register: () => true, unregister: () => {} },
    () => {}, () => 0,
    { set: (bindings, ptt) => { sets.push({ bindings, ptt }); return helperAvailable; } },
    (status) => changes.push(status),
    (held) => holds.push(held),
  );
  const status = manager.apply({ mic: "Alt+F9", sound: "", stream: "" }, "Mouse4");
  assert.equal(status.ptt, "active");
  assert.deepEqual(sets.at(-1), { bindings: [], ptt: "Mouse4" }, "the helper runs for push-to-talk alone");
  assert.equal(manager.pushToTalkActive, true);
  manager.nativeHold(true);
  manager.nativeHold(true);
  manager.nativeHold(false);
  assert.deepEqual(holds, [true, false], "repeats are ignored");
  manager.nativeHold(true);
  manager.nativeResult("ptt", "unsupported");
  assert.deepEqual(holds, [true, false, true, false], "losing the helper releases a held key");
  assert.equal(manager.pushToTalkActive, false);
  assert.equal(changes.at(-1)?.ptt, "unsupported");

  manager.apply({ mic: "", sound: "", stream: "" }, "V");
  manager.nativeHold(true);
  manager.clear();
  assert.equal(holds.at(-1), false, "pausing hotkeys (settings capture) releases push-to-talk");
  assert.deepEqual(sets.at(-1), { bindings: [], ptt: null });

  helperAvailable = false;
  const without = manager.apply({ mic: "", sound: "", stream: "" }, "V");
  assert.equal(without.ptt, "unsupported");
  assert.equal(manager.pushToTalkActive, false, "without the helper the page keeps an open microphone");
  assert.equal(manager.apply({ mic: "", sound: "", stream: "" }, "Ctrl+V").ptt, "invalid");
});
