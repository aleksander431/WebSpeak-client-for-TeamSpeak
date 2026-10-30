import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import vue from "@vitejs/plugin-vue";
import { createServer } from "vite";
import { createRenderer, createSSRApp, nextTick, shallowRef, markRaw } from "vue";
import { renderToString } from "@vue/server-renderer";
let vite, useWebClientScreenShare, VoiceMemberCards, VoiceChannelTree, ChannelMemberPanel;
const renderer = createRenderer({ createComment: text => ({ text }), createText: text => ({ text }), createElement: () => ({}), insert() {}, remove() {}, setText() {}, setElementText() {}, patchProp() {}, parentNode: () => null, nextSibling: () => null });
before(async () => {
  vite = await createServer({ configFile: false, plugins: [vue()], root: fileURLToPath(new URL("../", import.meta.url)), server: { middlewareMode: true, hmr: false, ws: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] }, appType: "custom" });
  ({ useWebClientScreenShare } = await vite.ssrLoadModule("/src/composables/useWebClientScreenShare.ts"));
  ({ default: VoiceMemberCards } = await vite.ssrLoadModule("/src/components/web-client/VoiceMemberCards.vue"));
  ({ default: VoiceChannelTree } = await vite.ssrLoadModule("/src/components/web-client/VoiceChannelTree.vue"));
  ({ default: ChannelMemberPanel } = await vite.ssrLoadModule("/src/components/web-client/ChannelMemberPanel.vue"));
});
after(async () => { await vite?.close(); });

test("both tree layouts render spacer labels without channel icons/counts, and preserve children and members", async () => {
  const channels = [
    { id: "1", parentID: "0", depth: 0, name: "[cspacer0]🏔 后山 🏔", isPermanent: true, members: [{ id: 7, nickname: "Visible member" }] },
    { id: "2", parentID: "1", depth: 1, name: "[cspacer1]Nested ordinary", isPermanent: true, members: [] },
    { id: "3", parentID: "0", depth: 0, name: "[*spacer3]★", isPermanent: true, members: [] },
    { id: "4", parentID: "0", depth: 0, name: "[cspacer4]", isPermanent: true, members: [] },
    { id: "5", parentID: "0", depth: 0, name: "[cspacer5]<img src=x onerror=alert(1)>", isPermanent: true, members: [] },
  ];
  for (const layout of ["default", "server-sidebar"]) {
    const html = await renderToString(createSSRApp(VoiceChannelTree, {
      channels, layout, avatarStyle: () => ({}), avatarInitial: name => name[0], isSpeaking: () => false, t: key => key,
    }));
    assert.equal((html.match(/data-ws-part="voice.channel-spacer"/g) ?? []).length, 4);
    assert.equal((html.match(/data-ws-part="voice.channel-tree.icon"/g) ?? []).length, 1);
    assert.equal((html.match(/data-ws-part="voice.channel-tree.count"/g) ?? []).length, 1);
    assert.match(html, /Visible member/);
    assert.match(html, /\[cspacer1\]Nested ordinary/);
    assert.doesNotMatch(html, /\[cspacer0\]|\[\*spacer3\]|\[cspacer4\]|<img/);
    assert.match(html, /&lt;img/);
  }
});

test("the standard member panel uses the same spacer display and hides only empty spacer hints", async () => {
  const html = await renderToString(createSSRApp(ChannelMemberPanel, {
    model: { memberDisplayName: member => member.nickname, isSpeaking: () => false }, query: "",
    filteredMemberChannels: [
      { id: "1", parentID: "0", depth: 0, name: "[rspacer0]右侧标题", isPermanent: true, members: [] },
      { id: "2", parentID: "0", depth: 0, name: "Ordinary", members: [] },
    ],
    mobileVisible: true, isMobileViewport: false, volumes: {}, avatarStyle: () => ({}), avatarInitial: name => name[0], rangeStyle: () => ({}), t: key => key,
  }));
  assert.match(html, /data-alignment="right"/);
  assert.match(html, /右侧标题/);
  assert.doesNotMatch(html, /\[rspacer0\]/);
  assert.equal((html.match(/noMembersInChannel/g) ?? []).length, 1);
});

function mount(t, initialStream = null, memberAvatar = () => "", extra = {}, initialStorage = {}) {
  const listeners = new Set(), starts = [], storage = new Map(Object.entries(initialStorage)); let exits = 0, ui;
  class Element {}
  class Video extends Element { srcObject = null; volume = 1; plays = 0; async play() { this.plays++; } }
  const doc = { fullscreenElement: null, addEventListener: (_event, fn) => listeners.add(fn), removeEventListener: (_event, fn) => listeners.delete(fn), async exitFullscreen() { exits++; doc.fullscreenElement = null; for (const fn of listeners) fn(); } };
  for (const [key, value] of Object.entries({ HTMLElement: Element, HTMLVideoElement: Video, document: doc, localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) } })) {
    const original = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => { if (original) Object.defineProperty(globalThis, key, original); else delete globalThis[key]; });
  }
  const viewing = shallowRef(true), stream = shallowRef(initialStream), volume = shallowRef(.4), streams = [];
  const app = renderer.createApp({ setup() { ui = useWebClientScreenShare({ streams, viewing, viewingStreamId: shallowRef("s"), remoteStream: stream, remoteVolume: volume, error: shallowRef(""), errorCode: shallowRef(""), startScreenShare: async (...args) => starts.push(args), joinScreenShare() {}, leaveScreenShare() {}, nickname: shallowRef("Self"), avatarStyle: () => ({}), memberAvatar, t: key => key, ...extra }); return () => null; } });
  app.mount({});
  return { ui, app, doc, viewing, stream, volume, streams, starts, storage, listeners, exits: () => exits, video: () => markRaw(new Video()), player: () => markRaw(new Element()) };
}

test("a newly mounted or replaced video receives the existing stream and volume", async t => {
  const media = { id: "stream" }, f = mount(t, media);
  try {
    const first = f.video(); f.ui.setVideoElement(first); await nextTick();
    assert.equal(first.srcObject, media); assert.equal(first.volume, .4);
    const second = f.video(); f.ui.setVideoElement(second); await nextTick();
    assert.equal(first.srcObject, null); assert.equal(second.srcObject, media); assert.equal(second.volume, .4);
    f.volume.value = .7; await nextTick(); assert.equal(second.volume, .7);
  } finally { f.app.unmount(); }
});

test("screen-share player fills the content width, limits height, and letterboxes in black", async () => {
  const css = await readFile(new URL("../src/styles/web-client.css", import.meta.url), "utf8");
  const component = await readFile(new URL("../src/components/web-client/ScreenSharePlayer.vue", import.meta.url), "utf8");
  const playerRule = css.match(/:deep\(\.screen-share-player\)\s*\{([^}]*)\}/)?.[1] ?? "";
  const stageRule = css.match(/:deep\(\.screen-share-player-stage\)\s*\{([^}]*)\}/)?.[1] ?? "";
  const videoRule = css.match(/:deep\(\.screen-share-player-video\)\s*\{([^}]*)\}/)?.[1] ?? "";
  const fullscreenRule = css.match(/:deep\(\.screen-share-player:fullscreen\)\s*\{([^}]*)\}/)?.[1] ?? "";
  const fullscreenStageRule = css.match(/:deep\(\.screen-share-player:fullscreen \.screen-share-player-stage\)\s*\{([^}]*)\}/)?.[1] ?? "";
  assert.match(playerRule, /width:\s*100%/);
  assert.doesNotMatch(playerRule, /width:\s*fit-content/);
  assert.match(stageRule, /width:\s*100%/);
  assert.match(stageRule, /height:\s*min\(64vh,\s*640px\)/);
  assert.match(stageRule, /background:\s*#000/);
  assert.match(videoRule, /object-fit:\s*contain/);
  assert.match(videoRule, /background:\s*#000/);
  assert.match(fullscreenRule, /position:\s*fixed/);
  assert.match(fullscreenRule, /inset:\s*0/);
  assert.match(fullscreenRule, /height:\s*100dvh/);
  assert.match(fullscreenRule, /background:\s*#000/);
  assert.match(fullscreenStageRule, /height:\s*100%/);
  assert.match(fullscreenStageRule, /min-height:\s*0/);
  assert.match(component, /document\.addEventListener\("fullscreenchange", updateStageSize\)/);
  assert.match(component, /document\.fullscreenElement === player/);
  assert.doesNotMatch(component, /video\.video(?:Width|Height)/, "source dimensions must not resize the player stage");
  assert.doesNotMatch(component, /ResizeObserver/, "player sizing must not create a resize-feedback loop while video starts");
  assert.match(component, /if \(playerElement\.value === next\) return;/, "stable function refs must not rewrite player styles on every render");
  assert.match(component, /if \(stageElement\.value === next\) return;/, "stable function refs must not rewrite stage styles on every render");
  assert.match(playerRule, /z-index:\s*3/, "the shared video must layer above decorative activity artwork");
});

test("unmount detaches video and retires a pending binding without stopping its stream", async t => {
  let stops = 0; const media = { getTracks: () => [{ stop: () => stops++ }] }, f = mount(t, media);
  try { const video = f.video(); f.ui.setVideoElement(video); await nextTick();
    f.volume.value = .8; f.app.unmount(); await nextTick();
    assert.equal(video.srcObject, null); assert.equal(stops, 0); assert.equal(f.listeners.size, 0);
  } finally { if (f.listeners.size) f.app.unmount(); }
});

test("absent player is never fullscreen and does not request fullscreen exit", async t => {
  const f = mount(t);
  try { f.ui.syncFullscreen(); assert.equal(f.ui.fullscreen.value, false); f.viewing.value = false; await nextTick(); assert.equal(f.exits(), 0); }
  finally { f.app.unmount(); }
});

test("removing a fullscreen player exits only that player's fullscreen", async t => {
  const f = mount(t);
  try { const player = f.player(); f.ui.setPlayerElement(player); f.doc.fullscreenElement = player; f.ui.syncFullscreen();
    assert.equal(f.ui.fullscreen.value, true); f.ui.setPlayerElement(null); await nextTick();
    assert.equal(f.exits(), 1); assert.equal(f.ui.fullscreen.value, false);
    f.ui.setPlayerElement(f.player()); f.doc.fullscreenElement = f.player(); f.ui.setPlayerElement(null);
    assert.equal(f.exits(), 1);
  } finally { f.app.unmount(); }
});

test("known screen owner IDs cannot fall back to another member with the same nickname", t => {
  const f = mount(t);
  try { f.streams.push({ streamId: "s", ownerClientId: 7, ownerPeerId: "peer", ownerNickname: "Same", source: "browser" });
    assert.equal(f.ui.streamForMember({ id: 8, nickname: "Same" }), null);
    assert.equal(f.ui.streamForMember({ id: 7, nickname: "Renamed" }).streamId, "s");
    f.streams[0] = { streamId: "ts", ownerPeerId: "ts-7", ownerNickname: "Same", source: "teamspeak" };
    assert.equal(f.ui.streamForMember({ id: 8, nickname: "Same" }), null);
    f.streams[0] = { streamId: "legacy", ownerPeerId: "unknown", ownerNickname: "Same", source: "browser" };
    assert.equal(f.ui.streamForMember({ id: 8, nickname: "Same" }).streamId, "legacy");
  } finally { f.app.unmount(); }
});

test("viewers resolve their avatar locally from a client id instead of the roster payload", async t => {
  // `streams` is a plain array, so `viewers` (a computed) caches its first read:
  // each scenario needs its own mount.
  async function avatarFor(viewer, memberAvatar = () => "") {
    const f = mount(t, null, memberAvatar);
    try {
      f.streams[0] = { streamId: "s", viewers: [viewer] };
      await nextTick();
      assert.equal(f.ui.viewers.value.length, 1);
      return f.ui.viewers.value[0].avatar;
    } finally { f.app.unmount(); }
  }
  // Current gateway: the roster carries a client id and the avatar comes from the directory.
  assert.equal(
    await avatarFor({ peerId: "v", nickname: "Visitor", clientId: 42 }, clientId => (clientId === 42 ? "data:image/png;base64,LOCAL" : "")),
    "data:image/png;base64,LOCAL",
  );
  // Legacy gateway: the inline avatar still renders.
  assert.equal(
    await avatarFor({ peerId: "v", nickname: "Visitor", avatar: "data:image/png;base64,LEGACY" }),
    "data:image/png;base64,LEGACY",
  );
  // Unknown member: degrades to the initial instead of throwing.
  assert.equal(await avatarFor({ peerId: "v", nickname: "Visitor", clientId: 99 }), "");
});

test("member cards detect and expose a remote share without depending on local share status", async () => {
  let lookupCount = 0;
  const html = await renderToString(createSSRApp(VoiceMemberCards, {
    currentMembers: [
      { id: 7, nickname: "Remote sharer", isSelf: false, inputMuted: false },
      { id: 8, nickname: "Local viewer", isSelf: true, inputMuted: false },
    ],
    isMobileViewport: false,
    controls: {
      streamForMember: member => { lookupCount++; return member.id === 7 ? { streamId: "active-share" } : null; },
      toggleForMember() {},
      startWithSettings() {},
    },
    isSpeaking: () => false,
    avatarStyle: () => ({}),
    avatarInitial: nickname => nickname[0],
    t: key => key,
  }));

  assert.ok(lookupCount > 0, "member cards query the available share controls");
  assert.match(html, /screen-share-live-indicator/);
  assert.match(html, /sharingScreen/);
  assert.match(html, /screen-share-card-button/);
  assert.match(html, /watchScreenShare/);
  assert.equal((html.match(/screen-share-card-actions/g) ?? []).length, 1);
  assert.doesNotMatch(html, /startScreenShare/);
});

test("channel tree marks only members who own an active screen share", async () => {
  const component = await readFile(new URL("../src/components/web-client/VoiceChannelTreeItem.vue", import.meta.url), "utf8");
  const html = await renderToString(createSSRApp(VoiceChannelTree, {
    channels: [{
      id: "channel-1",
      parentID: "0",
      depth: 0,
      name: "General",
      members: [
        { id: 7, nickname: "MeissS" },
        { id: 8, nickname: "NoShare" },
      ],
    }],
    currentChannelId: "channel-1",
    layout: "server-sidebar",
    avatarStyle: () => ({}),
    avatarInitial: nickname => nickname[0],
    isSpeaking: () => false,
    isScreenSharing: member => member.id === 7,
    t: key => key,
  }));

  assert.equal((html.match(/data-ws-part="voice\.channel-tree\.member-screen-share"/g) ?? []).length, 1);
  assert.match(html, /aria-label="screenShare"/);
  assert.match(html, /d="M4 4h16v12H4zM8 20h8M12 16v4"/);
  assert.match(component, /background:\s*#72c800/);
});

test("a skin can explicitly opt the member-card widget out of screen-share UI", async () => {
  const html = await renderToString(createSSRApp(VoiceMemberCards, {
    currentMembers: [{ id: 7, nickname: "Remote sharer", isSelf: false, inputMuted: false }],
    isMobileViewport: false,
    showScreenShare: false,
    controls: { streamForMember: () => ({ streamId: "active-share" }), toggleForMember() {}, startWithSettings() {} },
    isSpeaking: () => false,
    avatarStyle: () => ({}),
    avatarInitial: nickname => nickname[0],
    t: key => key,
  }));

  assert.doesNotMatch(html, /screen-share-live-indicator|screen-share-card-button/);
});

test("share settings default to 30 FPS and send 1440p with the chosen priority", async t => {
  const f = mount(t);
  try {
    assert.equal(f.ui.frameRate.value, 30);
    f.ui.resolutionPreset.value = "1440p"; f.ui.priority.value = "motion"; await f.ui.startWithSettings();
    assert.deepEqual(f.starts, [[true, { maxWidth: 2560, maxHeight: 1440, maxFrameRate: 30, priority: "motion" }]]);
    assert.equal(f.storage.get("webspeak:screen-share-priority"), "motion");
    assert.equal(f.ui.hdrSupported, false, "HDR correction needs Chromium's frame processing");
  } finally { f.app.unmount(); }
});

test("while sharing, changed settings apply to the running share at once", async t => {
  const updates = [], sharing = shallowRef(false);
  const f = mount(t, null, () => "", { sharing, updateScreenShareOutputSettings: async settings => { updates.push(settings); } });
  try {
    f.ui.frameRate.value = 60; await nextTick();
    assert.deepEqual(updates, [], "nothing is sent before sharing starts");
    sharing.value = true;
    f.ui.frameRate.value = 15; f.ui.resolutionPreset.value = "720p"; await nextTick();
    assert.deepEqual(updates, [{ maxWidth: 1280, maxHeight: 720, maxFrameRate: 15 }]);
    assert.equal(f.storage.get("webspeak:screen-share-framerate"), "15");
  } finally { f.app.unmount(); }
});

function fakeOverlay() {
  const state = { opened: 0, closed: 0, levels: [], controller: null };
  return {
    state,
    open() {
      state.opened++;
      state.controller = new AbortController();
      return { signal: state.controller.signal, async show(level) { state.levels.push(level); }, setProgress() {}, close() { state.closed++; } };
    },
  };
}
const identityCurve = Array.from({ length: 256 }, (_, value) => value);
/** Pretend to be Chromium so HDR correction and calibration are offered. */
function pretendChromium(t) {
  for (const name of ["MediaStreamTrackProcessor", "MediaStreamTrackGenerator", "OffscreenCanvas", "VideoFrame"]) {
    const original = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: class {} });
    t.after(() => { if (original) Object.defineProperty(globalThis, name, original); else delete globalThis[name]; });
  }
}

test("calibration applies the measured curve at full strength and remembers it", async t => {
  const updates = [], sharing = shallowRef(true), overlay = fakeOverlay();
  const curve = { version: 1, r: identityCurve, g: identityCurve.map(value => Math.max(0, value - 40)), b: identityCurve, clipLevel: 216, createdAt: "now" };
  const f = mount(t, null, () => "", {
    sharing, updateScreenShareOutputSettings: async settings => { updates.push(settings); },
    measureHdrCalibration: async display => { await display.show(128); display.setProgress(22, 22); return curve; },
    openCalibrationDisplay: () => overlay.open(),
  });
  try {
    // hdrSupported is false in Node; the controller must refuse instead of measuring.
    await f.ui.calibrateHdr();
    assert.equal(overlay.state.opened, 0);
    assert.equal(f.ui.canCalibrate.value, false);
  } finally { f.app.unmount(); }
});
test("a successful calibration is applied live at full strength and stored", async t => {
  pretendChromium(t);
  const updates = [], sharing = shallowRef(true), overlay = fakeOverlay();
  const curve = { version: 1, r: identityCurve, g: identityCurve.map(value => Math.max(0, value - 40)), b: identityCurve, clipLevel: 216, createdAt: "now" };
  const f = mount(t, null, () => "", {
    sharing, updateScreenShareOutputSettings: async settings => { updates.push(settings); },
    measureHdrCalibration: async display => { await display.show(128); display.setProgress(22, 22); return curve; },
    openCalibrationDisplay: () => overlay.open(),
  });
  try {
    assert.equal(f.ui.canCalibrate.value, true);
    await f.ui.calibrateHdr();
    await nextTick();
    assert.deepEqual(overlay.state.levels, [128]);
    assert.equal(overlay.state.closed, 1, "the overlay always closes");
    assert.equal(f.ui.calibrationState.value, "done");
    assert.equal(f.ui.hdrEnabled.value, true);
    assert.equal(f.ui.hdrStrength.value, 100);
    const last = updates.at(-1);
    assert.equal(last.hdrCorrection, 1);
    assert.equal(last.hdrCalibration.g[200], 160, "viewers get the measured curve");
    assert.equal(JSON.parse(f.storage.get("webspeak:screen-share-hdr-calibration")).clipLevel, 216);

    f.ui.resetHdrCalibration();
    await nextTick();
    assert.equal(updates.at(-1).hdrCalibration, undefined, "reset returns to the generic curve");
    assert.equal(f.storage.has("webspeak:screen-share-hdr-calibration"), false);
  } finally { f.app.unmount(); }
});

test("a stored calibration is restored, and failed or cancelled runs keep it", async t => {
  pretendChromium(t);
  const overlay = fakeOverlay();
  const stored = { version: 1, r: identityCurve, g: identityCurve, b: identityCurve, clipLevel: 255, createdAt: "earlier" };
  let failWith = "NOT_VISIBLE";
  const { HdrCalibrationError } = await vite.ssrLoadModule("/src/voice/hdr-calibration.ts");
  const f = mount(t, null, () => "", {
    sharing: shallowRef(true), updateScreenShareOutputSettings: async () => {},
    measureHdrCalibration: async () => { throw new HdrCalibrationError(failWith); },
    openCalibrationDisplay: () => overlay.open(),
  }, { "webspeak:screen-share-hdr-calibration": JSON.stringify(stored) });
  try {
    assert.equal(f.ui.hdrCalibration.value?.createdAt, "earlier");
    await f.ui.calibrateHdr();
    assert.equal(f.ui.calibrationState.value, "failed");
    assert.equal(f.ui.calibrationError.value, "NOT_VISIBLE");
    assert.equal(f.ui.hdrCalibration.value?.createdAt, "earlier", "a failed run keeps the previous calibration");
    failWith = "CANCELLED";
    await f.ui.calibrateHdr();
    assert.equal(f.ui.calibrationState.value, "idle", "Esc is not reported as an error");
    assert.equal(overlay.state.closed, 2);
  } finally { f.app.unmount(); }
});

test("share settings submit the selected resolution and frame rate", async t => {
  const f = mount(t);
  try { f.ui.settingsOpen.value = true; f.ui.resolutionPreset.value = "720p"; f.ui.frameRate.value = 30; await f.ui.startWithSettings();
    assert.deepEqual(f.starts, [[true, { maxWidth: 1280, maxHeight: 720, maxFrameRate: 30 }]]);
    assert.equal(f.ui.settingsOpen.value, false); assert.equal(f.storage.get("webspeak:screen-share-framerate"), "30");
  } finally { f.app.unmount(); }
});
