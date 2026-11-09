import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter, once } from "node:events";
import { createServer } from "node:http";
import { setImmediate as nextTurn } from "node:timers/promises";
import { WebSocket, type WebSocketServer } from "ws";
import pino from "pino";
import { VoiceBridge } from "./voice-bridge.js";
import { JoinTicketStore } from "./join-ticket.js";
import type { TSClient, TSDirectorySnapshot } from "./ts-client.js";
import type { WebRtcAudioSession, WebRtcAudioSessionOptions } from "./webrtc-audio.js";

// Loopback gateway wiring with TeamSpeak and the WebRTC peer stubbed out.
class Stub extends EventEmitter {
  disconnected = false;
  accompaniment: boolean[] = [];
  voice: Array<[number, number]> = [];
  moves: bigint[] = [];
  constructor(readonly nickname: string, readonly clientId: number, public channel: bigint) { super(); }
  directory: TSDirectorySnapshot = { channels: [], clients: [] };
  async connect() { this.disconnected = false; this.emit("directorySnapshot", this.directory); }
  async disconnect() { this.disconnected = true; }
  getClientId() { return this.clientId; }
  getChannelId() { return this.channel; }
  isConnected() { return !this.disconnected; }
  getIdentityString() { return ""; }
  async getServerInfo() { return { name: "Test", iconId: null }; }
  async getServerPresentation() { return { bannerUrl: "", welcomeMessage: "" }; }
  async getServerIcon() { return null; }
  async restoreOwnAvatar() { return { outcome: "stale" as const }; }
  async setInputMuted() {}
  async setAccompanimentActive(active: boolean) { this.accompaniment.push(active); }
  async switchChannel(channel: bigint) { this.moves.push(channel); this.channel = channel; }
  sendVoice(data: Buffer, codec = 4) { this.voice.push([data.length, codec]); }
  sendWhisper() {}
}

test("accompaniment gets its own TeamSpeak client in the owner's channel, and falls back to mixing when it leaves", { timeout: 8_000 }, async t => {
  const main = new Stub("Alex", 1, 7n);
  const clients: Stub[] = [];
  const peerMixed: boolean[] = [];
  let musicFrame: ((data: Buffer) => void) | undefined;
  const tickets = new JoinTicketStore();
  const bridge = new VoiceBridge({ joinTickets: tickets, webRtc: { enabled: true, publicHost: "127.0.0.1" } }, pino({ enabled: false }), (options: WebRtcAudioSessionOptions) => {
    musicFrame = options.onMusicFrame;
    return {
      hasMusicTrack: true,
      createAnswer: async () => ({ type: "answer", sdp: "v=0" }),
      close: async () => {},
      getStats: () => ({}),
      setAccompanimentActive: (active: boolean) => { peerMixed.push(active); },
      setMicrophoneMuted() {}, setVoiceGateOpen() {}, pushTeamSpeakVoice() {}, setMemberVolume() {}, removeClient() {},
    } as unknown as WebRtcAudioSession;
  }, {
    createEncoder: () => ({ encode: () => Buffer.alloc(0), dispose: () => {} }),
    createTeamSpeakClient: (options) => {
      if (!clients.length) { clients.push(main); return main as unknown as TSClient; }
      const music = new Stub(options.nickname, 42, 1n);
      clients.push(music);
      return music as unknown as TSClient;
    },
  });
  const server = createServer();
  bridge.attach(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const ticket = tickets.create({ target: { host: "voice.example.invalid", port: 9987 }, nickname: "Alex", serverPassword: "pw" });
  const socket = new WebSocket(`ws://127.0.0.1:${address.port}/ws/voice?ticket=${ticket}`);
  const messages: Array<Record<string, unknown>> = [];
  socket.on("message", (data, binary) => { if (!binary) messages.push(JSON.parse(data.toString())); });
  t.after(async () => {
    socket.terminate();
    const wss = (bridge as unknown as { wss: WebSocketServer }).wss;
    for (const peer of wss.clients) peer.terminate();
    await bridge.shutdown();
    await new Promise<void>(resolve => server.close(() => resolve()));
  });
  const until = async (check: () => boolean) => { while (!check()) await nextTurn(); };
  await until(() => messages.some(message => message.type === "connected"));
  socket.send(JSON.stringify({ type: "webrtcOffer", payload: { sdp: { type: "offer", sdp: "v=0" }, muted: false, accompanimentActive: false } }));
  await until(() => messages.some(message => message.type === "webrtcAnswer"));

  const before = main.accompaniment.length;
  socket.send(JSON.stringify({ type: "setAccompanimentActive", requestId: "a1", payload: { active: true } }));
  await until(() => messages.some(message => message.type === "accompanimentRoute"));
  const music = clients[1]!;
  assert.equal(music.nickname, "Alex 🎵");
  assert.deepEqual(music.moves, [7n], "the music client joins its owner's channel");
  assert.deepEqual(messages.find(message => message.type === "accompanimentRoute"), { type: "accompanimentRoute", separate: true, clientId: 42 });
  await until(() => main.accompaniment.length >= before + 2);
  assert.deepEqual(main.accompaniment.slice(before), [true, false], "mixed while it connects, then the voice is plain voice again");
  assert.deepEqual(peerMixed, [true, false]);

  musicFrame?.(Buffer.alloc(80));
  assert.deepEqual(music.voice, [[80, 5]], "music frames go out as Opus Music through the music client");

  // The music client is kicked: the browser mixes again so the music keeps playing.
  messages.length = 0;
  music.emit("kicked");
  await until(() => messages.some(message => message.type === "accompanimentRoute"));
  assert.deepEqual(messages.find(message => message.type === "accompanimentRoute"), { type: "accompanimentRoute", separate: false });
  await until(() => main.accompaniment.at(-1) === true);

  socket.send(JSON.stringify({ type: "setAccompanimentActive", requestId: "a2", payload: { active: false } }));
  await until(() => main.accompaniment.at(-1) === false);
  assert.equal(music.disconnected, true);
});
