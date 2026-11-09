/**
 * Accompaniment as its own TeamSpeak client ("Alex 🎵"), so every listener
 * (native TeamSpeak or WebSpeak) gets a separate volume slider for the music.
 *
 * The browser sends the shared program sound as its own WebRTC track; the
 * gateway forwards those Opus frames, unchanged, through this second client,
 * which follows its owner from channel to channel. When it cannot connect or
 * drops, the owner's browser goes back to mixing the music into its voice.
 */
export interface AccompanimentRelayClient {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  sendVoice(data: Buffer, codec?: number): void;
  switchChannel(channelId: bigint, password?: string): Promise<void>;
  getChannelId(): bigint;
  getClientId(): number;
  on(event: "disconnected" | "kicked", listener: (...args: unknown[]) => void): unknown;
}

export interface AccompanimentRelayOptions {
  create(): AccompanimentRelayClient;
  /** The owner's current channel (0 while unknown). */
  ownerChannel(): bigint;
  /** A password the owner used for this channel, if any. */
  channelPassword?(channelId: bigint): string | undefined;
  /** The music client is in the owner's channel: its TeamSpeak client id. */
  onLive(clientId: number): void;
  /** The music client went away on its own (kicked, server restart, network). */
  onEnded(): void;
  log?(message: string, error?: unknown): void;
}

/** TeamSpeak's nickname limit is 30 characters; keep the note visible. */
export function accompanimentNickname(owner: string): string {
  const suffix = " 🎵";
  const chars = Array.from(owner.trim() || "WebSpeak");
  const room = 30 - Array.from(suffix).length;
  return chars.slice(0, room).join("") + suffix;
}

/** TeamSpeak's codec number for Opus Music. */
const OPUS_MUSIC = 5;

export class AccompanimentRelay {
  private client: AccompanimentRelayClient | null = null;
  private live = false;
  private generation = 0;
  private moving: Promise<void> | null = null;
  private channel = 0n;

  constructor(private readonly options: AccompanimentRelayOptions) {}

  get active(): boolean {
    return this.live;
  }

  get clientId(): number {
    return this.live ? this.client?.getClientId() ?? 0 : 0;
  }

  /** Connect the music client and move it to its owner. False when it could not. */
  async start(): Promise<boolean> {
    await this.stop();
    const generation = ++this.generation;
    const current = () => generation === this.generation;
    let client: AccompanimentRelayClient;
    try {
      client = this.options.create();
    } catch (error) {
      this.options.log?.("accompaniment client could not be created", error);
      return false;
    }
    this.client = client;
    const ended = () => {
      if (!current() || this.client !== client) return;
      const wasLive = this.live;
      void this.stop();
      if (wasLive) this.options.onEnded();
    };
    client.on("disconnected", ended);
    client.on("kicked", ended);
    try {
      await client.connect();
      if (!current()) { await client.disconnect().catch(() => undefined); return false; }
      this.channel = client.getChannelId();
      await this.follow(client, generation);
      if (!current()) return false;
      if (this.options.ownerChannel() !== 0n && this.channel !== this.options.ownerChannel()) throw new Error("could not join the owner's channel");
      this.live = true;
      this.options.onLive(client.getClientId());
      return true;
    } catch (error) {
      if (current()) {
        this.options.log?.("accompaniment client could not join", error);
        await this.stop();
      }
      return false;
    }
  }

  /** One Opus frame of the music track. Also keeps the client in its owner's channel. */
  send(frame: Buffer): void {
    const client = this.client;
    if (!this.live || !client) return;
    if (!this.moving && this.options.ownerChannel() !== 0n && this.options.ownerChannel() !== this.channel) {
      const generation = this.generation;
      this.moving = this.follow(client, generation).catch((error: unknown) => this.options.log?.("accompaniment client could not follow", error))
        .finally(() => { this.moving = null; });
    }
    try { client.sendVoice(frame, OPUS_MUSIC); } catch { /* a dropping client reports through its events */ }
  }

  async stop(): Promise<void> {
    this.generation += 1;
    this.live = false;
    this.moving = null;
    const client = this.client;
    this.client = null;
    this.channel = 0n;
    if (client) await client.disconnect().catch(() => undefined);
  }

  private async follow(client: AccompanimentRelayClient, generation: number): Promise<void> {
    const target = this.options.ownerChannel();
    if (target === 0n || target === this.channel) return;
    await client.switchChannel(target, this.options.channelPassword?.(target));
    if (generation === this.generation && this.client === client) this.channel = target;
  }
}
