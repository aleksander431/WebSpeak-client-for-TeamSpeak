import { reactive } from "vue";
import { watchPositionAfter, type WatchClientMessage, type WatchRoomView, type WatchServerMessage } from "../../../src/shared/watch-together.js";

export interface WatchTransport {
  isOpen(): boolean;
  send(message: WatchClientMessage): void;
  subscribe(listener: (message: WatchServerMessage) => void): () => void;
}

/**
 * The page's view of its channel's shared video. The gateway owns the state;
 * this remembers when each state arrived so the expected position can be
 * worked out at any moment, and forwards what this person does.
 */
export class WatchClient {
  readonly state = reactive({
    room: null as WatchRoomView | null,
    /** `performance.now()` when `room` arrived. */
    receivedAt: 0,
    /** Bumped on every state, so the player re-syncs even when nothing else changed. */
    revision: 0,
    /** This browser has the player open. */
    watching: false,
    error: "",
  });
  private readonly unsubscribe: () => void;
  private startedHere = false;

  constructor(private readonly transport: WatchTransport, private readonly clock: () => number = () => performance.now()) {
    this.unsubscribe = transport.subscribe(message => this.receive(message));
  }

  receive(message: WatchServerMessage): void {
    if (message.type === "watchError") {
      this.state.error = message.code;
      this.startedHere = false;
      return;
    }
    const previous = this.state.room;
    this.state.room = message.room;
    this.state.receivedAt = this.clock();
    this.state.revision++;
    // A new video opens the player only for the one who started it; the page offers it to the rest.
    if (!message.room) this.state.watching = false;
    else if (previous?.id !== message.room.id && (previous || this.startedHere)) this.state.watching = this.startedHere;
    if (message.room && previous?.id !== message.room.id) this.startedHere = false;
  }

  /** After connecting (or reconnecting, or moving): ask for the channel's state. */
  setConnected(connected: boolean): void {
    if (!connected) {
      this.state.room = null;
      return;
    }
    if (!this.transport.isOpen()) return;
    this.transport.send({ type: "watchOpen" });
    if (this.state.watching) this.transport.send({ type: "watchView", watching: true });
  }

  /** Where the shared clock says the video is now, seconds. */
  expectedPosition(): number {
    const room = this.state.room;
    return room ? watchPositionAfter(room, this.clock() - this.state.receivedAt) : 0;
  }

  start(url: string, position?: number): void {
    this.state.error = "";
    this.state.watching = true;
    this.startedHere = true;
    this.send({ type: "watchStart", url, ...(position === undefined ? {} : { position }) });
  }

  control(action: "play" | "pause" | "seek", position: number): void {
    const room = this.state.room;
    if (!room) return;
    // Show it at once; the gateway's echo confirms it a moment later.
    room.playing = action === "seek" ? room.playing : action === "play";
    room.position = Math.max(0, position);
    this.state.receivedAt = this.clock();
    this.state.revision++;
    this.send({ type: "watchControl", id: room.id, action, position: Math.max(0, position) });
  }

  meta(title: string, duration: number): void {
    const room = this.state.room;
    if (!room || (room.title && room.duration)) return;
    this.send({ type: "watchMeta", id: room.id, title, duration: Math.max(0, duration) });
  }

  setWatching(watching: boolean): void {
    if (this.state.watching === watching) return;
    this.state.watching = watching;
    if (this.state.room || !watching) this.send({ type: "watchView", watching });
  }

  stop(): void {
    this.send({ type: "watchStop" });
  }

  clearError(): void {
    this.state.error = "";
  }

  dispose(): void {
    this.unsubscribe();
  }

  private send(message: WatchClientMessage): void {
    if (this.transport.isOpen()) this.transport.send(message);
  }
}
