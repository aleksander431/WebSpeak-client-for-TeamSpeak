import assert from "node:assert/strict";
import test from "node:test";
import { browserStreamPopOutEnvironment, canPopOutStreams, popOutStream, type StreamPopOutEnvironment } from "./stream-popout.js";

function fakeWindow() {
  const listeners = new Map<string, () => void>();
  const appended: string[] = [];
  const element = (tag: string) => ({ tag, style: {}, className: "", textContent: "", srcObject: null as unknown, muted: false, autoplay: false, playsInline: false, play: () => Promise.resolve() });
  const window = {
    closed: false,
    document: {
      title: "",
      createElement: element,
      head: { append: (...nodes: Array<{ tag: string }>) => appended.push(...nodes.map(node => node.tag)) },
      body: { append: (...nodes: Array<{ tag: string }>) => appended.push(...nodes.map(node => node.tag)) },
    },
    addEventListener: (type: string, listener: () => void) => { listeners.set(type, listener); },
    close() { this.closed = true; listeners.get("pagehide")?.(); },
  };
  return { window, appended, listeners };
}

const media = { getVideoTracks: () => [{ getSettings: () => ({ width: 1920, height: 1080 }) }] } as unknown as MediaStream;

test("a document Picture-in-Picture window gets a muted copy of the stream", async () => {
  const fake = fakeWindow();
  let size: unknown;
  const environment: StreamPopOutEnvironment = {
    documentPictureInPicture: { window: null, requestWindow: async (options) => { size = options; return fake.window as unknown as Window; } },
    videoPictureInPicture: false,
    exitVideoPictureInPicture: async () => {},
    videoInPictureInPicture: () => null,
  };
  assert.equal(canPopOutStreams(environment), true);
  let closed = 0;
  const handle = await popOutStream({ media, title: "Sasha", pageVideo: null, onClosed: () => { closed += 1; } }, environment);
  assert.equal(handle?.mode, "window");
  assert.deepEqual(size, { width: 640, height: 360 });
  assert.equal(fake.window.document.title, "Sasha");
  assert.ok(fake.appended.includes("video"));
  fake.window.close();
  handle?.close();
  assert.equal(closed, 1, "closing reports once, from either side");
});

test("without window Picture-in-Picture the page's own video floats instead", async () => {
  let requested = 0;
  const listeners = new Map<string, () => void>();
  const video = { requestPictureInPicture: async () => { requested += 1; }, addEventListener: (type: string, listener: () => void) => listeners.set(type, listener) } as unknown as HTMLVideoElement;
  let exited = 0;
  const environment: StreamPopOutEnvironment = {
    documentPictureInPicture: { window: null, requestWindow: async () => { throw new Error("refused"); } },
    videoPictureInPicture: true,
    exitVideoPictureInPicture: async () => { exited += 1; },
    videoInPictureInPicture: () => video as unknown as Element,
  };
  const handle = await popOutStream({ media, title: "Ivan", pageVideo: video, onClosed: () => {} }, environment);
  assert.equal(handle?.mode, "video");
  assert.equal(requested, 1);
  handle?.close();
  assert.equal(exited, 1);

  const unsupported: StreamPopOutEnvironment = { videoPictureInPicture: false, exitVideoPictureInPicture: async () => {}, videoInPictureInPicture: () => null };
  assert.equal(canPopOutStreams(unsupported), false);
  assert.equal(await popOutStream({ media, title: "", pageVideo: null, onClosed: () => {} }, unsupported), null);
});

test("the desktop shell skips document Picture-in-Picture, whose window it refuses", () => {
  const scope = globalThis as unknown as Record<string, unknown>;
  const saved = { window: scope.window, document: scope.document };
  const api = { requestWindow: async () => { throw new Error("no window"); }, window: null };
  try {
    scope.document = { pictureInPictureEnabled: true };
    scope.window = { documentPictureInPicture: api };
    assert.equal(browserStreamPopOutEnvironment().documentPictureInPicture, api);
    scope.window = { documentPictureInPicture: api, webspeakDesktop: { reportState() {} } };
    const environment = browserStreamPopOutEnvironment();
    assert.equal(environment.documentPictureInPicture, undefined);
    assert.equal(environment.videoPictureInPicture, true);
  } finally {
    scope.window = saved.window;
    scope.document = saved.document;
  }
});
