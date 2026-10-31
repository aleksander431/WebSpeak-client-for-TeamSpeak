import assert from "node:assert/strict";
import test from "node:test";
import { effectScope, nextTick, ref } from "vue";
import {
  DEFAULT_HOTKEYS, assignHotkey, bindingFromEvent, formatBinding, isTypingTarget, matchesBinding, needsModifier, parseHotkeys,
} from "./hotkeys.js";
import { useWebClientHotkeys } from "../composables/useWebClientHotkeys.js";

const key = (code: string, mods: Partial<Record<"ctrlKey" | "altKey" | "shiftKey" | "metaKey", boolean>> = {}, extra: Record<string, unknown> = {}) => ({
  code, key: code.replace(/^Key/, "").toLowerCase(), ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, repeat: false, isComposing: false,
  target: null, prevented: false, ...mods, ...extra,
  preventDefault() { (this as { prevented: boolean }).prevented = true; }, stopPropagation() {},
});

test("bindings match the physical key, so switching to the Russian layout keeps them working", () => {
  const ctrlShiftM = DEFAULT_HOTKEYS.toggleMicrophone;
  // On the Russian layout the same key reports key "ь" but code "KeyM".
  assert.equal(matchesBinding({ ...key("KeyM", { ctrlKey: true, shiftKey: true }), key: "ь" } as never, ctrlShiftM), true);
  assert.equal(matchesBinding(key("KeyM", { ctrlKey: true }) as never, ctrlShiftM), false, "modifiers must match exactly");
  assert.equal(formatBinding(ctrlShiftM), "Ctrl + Shift + M");
  assert.equal(formatBinding({ code: "Digit1", ctrl: false, alt: true, shift: false, meta: false }), "Alt + 1");
  assert.equal(formatBinding({ code: "KeyM", ctrl: true, alt: false, shift: true, meta: false }, true), "⌃⇧M");
});

test("stored bindings survive reloads, cleared ones stay cleared and corrupt data falls back", () => {
  const custom = assignHotkey(parseHotkeys(null), "toggleMicrophone", { code: "F8", ctrl: false, alt: false, shift: false, meta: false });
  const cleared = assignHotkey(custom, "toggleScreenShare", null);
  const restored = parseHotkeys(JSON.stringify(cleared));
  assert.equal(restored.toggleMicrophone?.code, "F8");
  assert.equal(restored.toggleScreenShare, null);
  assert.deepEqual(restored.toggleDeafen, DEFAULT_HOTKEYS.toggleDeafen);
  assert.deepEqual(parseHotkeys("{not json"), { ...DEFAULT_HOTKEYS });
  assert.deepEqual(parseHotkeys(JSON.stringify({ toggleMicrophone: { code: "ShiftLeft" } })).toggleMicrophone, DEFAULT_HOTKEYS.toggleMicrophone);
});

test("giving one action another action's keys moves them instead of duplicating", () => {
  const next = assignHotkey(parseHotkeys(null), "toggleScreenShare", DEFAULT_HOTKEYS.toggleMicrophone);
  assert.deepEqual(next.toggleScreenShare, DEFAULT_HOTKEYS.toggleMicrophone);
  assert.equal(next.toggleMicrophone, null);
});

test("text fields never trigger shortcuts, and plain letters require a modifier", () => {
  assert.equal(isTypingTarget({ tagName: "INPUT", type: "text" } as never), true);
  assert.equal(isTypingTarget({ tagName: "TEXTAREA" } as never), true);
  assert.equal(isTypingTarget({ tagName: "DIV", isContentEditable: true } as never), true);
  assert.equal(isTypingTarget({ tagName: "INPUT", type: "range" } as never), false);
  assert.equal(isTypingTarget({ tagName: "BUTTON" } as never), false);
  assert.equal(needsModifier({ code: "KeyM", ctrl: false, alt: false, shift: true, meta: false }), true, "Shift+M just types a capital M");
  assert.equal(needsModifier({ code: "F8", ctrl: false, alt: false, shift: false, meta: false }), false);
  assert.equal(bindingFromEvent(key("ControlLeft", { ctrlKey: true }) as never), null);
});

function harness(options: { storage?: Map<string, string>; mediaSession?: unknown } = {}) {
  const storage = options.storage ?? new Map<string, string>();
  const listeners = new Set<(event: unknown) => void>();
  const state = {
    connected: ref(true), microphoneMuted: ref(false), outputMuted: ref(false),
    screenShareActive: ref(false), screenShareStarting: ref(false), toasts: [] as string[], shares: 0, stops: 0, silentPlays: 0, silentStops: 0,
  };
  const scope = effectScope();
  const hotkeys = scope.run(() => useWebClientHotkeys({
    connected: state.connected, microphoneMuted: state.microphoneMuted, outputMuted: state.outputMuted,
    screenShareActive: state.screenShareActive, screenShareStarting: state.screenShareStarting,
    setMicrophoneMuted: (muted) => { state.microphoneMuted.value = muted; },
    toggleOutputMute: () => { state.outputMuted.value = !state.outputMuted.value; },
    startScreenShare: () => { state.shares++; },
    stopScreenShare: () => { state.stops++; },
    showToast: (message) => state.toasts.push(message),
    t: (k) => k,
    target: { addEventListener: (_type: string, listener: unknown) => listeners.add(listener as never), removeEventListener: (_type: string, listener: unknown) => listeners.delete(listener as never) } as never,
    storage: { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => { storage.set(k, v); } },
    mediaSession: (options.mediaSession ?? null) as MediaSession | null,
    createSilentAudio: () => ({ async play() { state.silentPlays++; }, stop() { state.silentStops++; } }),
  }))!;
  const press = (code: string, mods: Parameters<typeof key>[1] = {}, extra: Record<string, unknown> = {}) => {
    const event = key(code, mods, extra);
    for (const listener of listeners) listener(event);
    return event;
  };
  return { hotkeys, state, press, storage, listeners, stop: () => scope.stop() };
}

test("shortcuts toggle the microphone, ignore key repeat and typing, and do nothing when disconnected", () => {
  const h = harness();
  const event = h.press("KeyM", { ctrlKey: true, shiftKey: true });
  assert.equal(h.state.microphoneMuted.value, true);
  assert.equal(event.prevented, true, "the browser's own Ctrl+Shift+M action is suppressed");
  assert.deepEqual(h.state.toasts, ["microphoneMuted"]);
  h.press("KeyM", { ctrlKey: true, shiftKey: true }, { repeat: true });
  assert.equal(h.state.microphoneMuted.value, true, "holding the keys does not flip it back and forth");
  h.press("KeyM", { ctrlKey: true, shiftKey: true }, { target: { tagName: "INPUT", type: "text" } });
  assert.equal(h.state.microphoneMuted.value, true, "typing in chat is left alone");
  h.state.connected.value = false;
  h.press("KeyM", { ctrlKey: true, shiftKey: true });
  assert.equal(h.state.microphoneMuted.value, true);
  h.stop();
  assert.equal(h.listeners.size, 0, "the listener is removed with the page");
});

test("mute sound silences everyone and the microphone, then restores the microphone as it was", () => {
  const h = harness();
  h.press("KeyD", { ctrlKey: true, shiftKey: true });
  assert.equal(h.state.outputMuted.value, true);
  assert.equal(h.state.microphoneMuted.value, true);
  h.press("KeyD", { ctrlKey: true, shiftKey: true });
  assert.equal(h.state.outputMuted.value, false);
  assert.equal(h.state.microphoneMuted.value, false, "the microphone was live before, so it comes back");

  h.state.microphoneMuted.value = true;
  h.press("KeyD", { ctrlKey: true, shiftKey: true });
  h.press("KeyD", { ctrlKey: true, shiftKey: true });
  assert.equal(h.state.microphoneMuted.value, true, "an already muted microphone stays muted");
  h.stop();
});

test("the screen share shortcut starts or stops sharing", () => {
  const h = harness();
  h.press("KeyE", { ctrlKey: true, shiftKey: true });
  assert.equal(h.state.shares, 1);
  h.state.screenShareActive.value = true;
  h.press("KeyE", { ctrlKey: true, shiftKey: true });
  assert.equal(h.state.stops, 1);
  h.state.screenShareActive.value = false; h.state.screenShareStarting.value = true;
  h.press("KeyE", { ctrlKey: true, shiftKey: true });
  assert.equal(h.state.shares, 1, "no second picker while one is already open");
  h.stop();
});

test("recording assigns new keys, rejects bare letters, and Esc/Backspace cancel or clear", () => {
  const h = harness();
  h.hotkeys.startRecording("toggleMicrophone");
  h.press("ShiftLeft", { shiftKey: true });
  assert.equal(h.hotkeys.recording.value, "toggleMicrophone", "a modifier alone keeps waiting");
  h.press("KeyK");
  assert.equal(h.hotkeys.recordingHint.value, "hotkeyNeedsModifier");
  h.press("KeyK", { altKey: true });
  assert.equal(h.hotkeys.recording.value, null);
  assert.equal(h.hotkeys.bindings.value.toggleMicrophone?.code, "KeyK");
  assert.equal(JSON.parse(h.storage.get("webspeak:hotkeys")!).toggleMicrophone.alt, true, "saved for next time");
  assert.equal(h.state.microphoneMuted.value, false, "recording a key does not run the action");

  h.hotkeys.startRecording("toggleDeafen");
  h.press("Escape", {}, { key: "Escape" });
  assert.deepEqual(h.hotkeys.bindings.value.toggleDeafen, DEFAULT_HOTKEYS.toggleDeafen);
  h.hotkeys.startRecording("toggleDeafen");
  h.press("Backspace", {}, { key: "Backspace" });
  assert.equal(h.hotkeys.bindings.value.toggleDeafen, null);

  h.hotkeys.resetDefaults();
  assert.deepEqual(h.hotkeys.bindings.value, { ...DEFAULT_HOTKEYS });
  h.stop();
});

test("the Play/Pause media key toggles the microphone only when enabled and connected", async () => {
  const handlers = new Map<string, (() => void) | null>();
  const session = { playbackState: "none", metadata: null, setActionHandler(action: string, handler: (() => void) | null) { handlers.set(action, handler); } };
  const h = harness({ mediaSession: session });
  await nextTick();
  assert.equal(h.state.silentPlays, 0, "off by default");
  h.hotkeys.setMediaKeyEnabled(true);
  await nextTick(); await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(h.state.silentPlays, 1, "claims the media session with an inaudible track");
  assert.equal(session.playbackState, "playing", "microphone live shows as playing");
  handlers.get("pause")!();
  assert.equal(h.state.microphoneMuted.value, true);
  await nextTick();
  assert.equal(session.playbackState, "paused");
  handlers.get("play")!();
  assert.equal(h.state.microphoneMuted.value, false);
  assert.equal(h.storage.get("webspeak:hotkeys-media-key"), "1");

  h.state.connected.value = false;
  await nextTick(); await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(handlers.get("play"), null, "released after leaving the room");
  assert.equal(h.state.silentStops, 1);
  h.stop();
});
