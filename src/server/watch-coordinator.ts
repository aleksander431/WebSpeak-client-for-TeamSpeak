import { parseWatchUrl, watchPositionAfter, type WatchAction, type WatchClientMessage, type WatchMedia, type WatchRoomView, type WatchServerMessage } from "../shared/watch-together.js";

/*
 * One shared player per channel (`<target key>#<channel id>`). The gateway
 * keeps only what is needed to agree on the picture: which video, playing or
 * paused, and where it was at a known moment of the gateway clock. Every
 * browser in the channel that opened the room gets the state after each
 * change, with the position already advanced to the moment of sending.
 * No Node-only imports: tests run it directly.
 */

export interface WatchParticipant {
  entryId: string;
  nickname: string;
  /** null while the session has no channel. */
  roomKey: string | null;
}

export interface WatchCoordinatorOptions {
  send: (entryId: string, message: WatchServerMessage) => void;
  now?: () => number;
  randomId?: () => string;
}

interface Room {
  id: string;
  media: WatchMedia;
  title: string;
  duration: number;
  startedBy: string;
  playing: boolean;
  /** Position at `updatedAt`, seconds. */
  position: number;
  updatedAt: number;
  last: { by: string; action: WatchAction; at: number };
}

interface Member { roomKey: string; nickname: string; watching: boolean }
interface Bucket { tokens: number; updatedAt: number }

const RATE = { rate: 4, burst: 12 };
/** A room nobody in the channel has open is forgotten after this long. */
export const WATCH_IDLE_MS = 30 * 60_000;

export class WatchCoordinator {
  private readonly rooms = new Map<string, Room>();
  private readonly members = new Map<string, Member>();
  private readonly buckets = new Map<string, Bucket>();
  /** When each room was last left by everyone. */
  private readonly emptySince = new Map<string, number>();
  private readonly now: () => number;
  private readonly randomId: () => string;

  constructor(private readonly options: WatchCoordinatorOptions) {
    this.now = options.now ?? Date.now;
    this.randomId = options.randomId ?? (() => Math.random().toString(36).slice(2, 12));
  }

  handleMessage(participant: WatchParticipant, message: WatchClientMessage): void {
    if (message.type === "watchClose") {
      this.removePeer(participant.entryId);
      return;
    }
    if (!participant.roomKey) {
      this.error(participant.entryId, "NO_CHANNEL");
      return;
    }
    if (message.type === "watchOpen") {
      this.join(participant.entryId, participant.roomKey, participant.nickname);
      return;
    }
    const member = this.members.get(participant.entryId);
    if (!member || member.roomKey !== participant.roomKey) {
      this.error(participant.entryId, "WATCH_NOT_OPEN");
      return;
    }
    if (!this.take(participant.entryId)) {
      this.error(participant.entryId, "RATE_LIMITED");
      return;
    }
    const code = this.apply(member, participant.nickname, message);
    if (code) this.error(participant.entryId, code);
  }

  /** The session moved to another channel (or lost it): the room follows. */
  onRoomChanged(participant: WatchParticipant): void {
    const member = this.members.get(participant.entryId);
    if (!member || member.roomKey === participant.roomKey) return;
    this.removePeer(participant.entryId);
    if (participant.roomKey) this.join(participant.entryId, participant.roomKey, participant.nickname);
    else this.options.send(participant.entryId, { type: "watchState", room: null });
  }

  removePeer(entryId: string): void {
    const member = this.members.get(entryId);
    this.members.delete(entryId);
    this.buckets.delete(entryId);
    if (!member) return;
    if (member.watching) this.broadcast(member.roomKey);
    this.forgetIdle();
  }

  /** For tests and diagnostics. */
  roomCount(): number {
    return this.rooms.size;
  }

  private join(entryId: string, roomKey: string, nickname: string): void {
    const previous = this.members.get(entryId);
    if (previous && previous.roomKey !== roomKey) this.removePeer(entryId);
    this.members.set(entryId, { roomKey, nickname, watching: previous?.roomKey === roomKey ? previous.watching : false });
    this.emptySince.delete(roomKey);
    this.forgetIdle();
    this.options.send(entryId, { type: "watchState", room: this.view(roomKey) });
  }

  private apply(member: Member, nickname: string, message: WatchClientMessage): string | null {
    const key = member.roomKey;
    const room = this.rooms.get(key);
    const now = this.now();
    switch (message.type) {
      case "watchStart": {
        const parsed = parseWatchUrl(message.url);
        if (!parsed) return "WATCH_BAD_URL";
        this.rooms.set(key, {
          id: this.randomId(), media: parsed.media, title: "", duration: 0, startedBy: nickname, playing: true,
          position: message.position ?? parsed.start, updatedAt: now, last: { by: nickname, action: "start", at: now },
        });
        // Everyone else is offered the new video rather than pulled into it.
        for (const other of this.members.values()) if (other.roomKey === key) other.watching = other === member;
        break;
      }
      case "watchControl": {
        if (!room || room.id !== message.id) return "WATCH_STALE";
        room.position = room.duration > 0 ? Math.min(message.position, room.duration) : message.position;
        if (message.action !== "seek") room.playing = message.action === "play";
        room.updatedAt = now;
        room.last = { by: nickname, action: message.action, at: now };
        break;
      }
      case "watchMeta": {
        if (!room || room.id !== message.id) return "WATCH_STALE";
        // The first browser that loaded the video names it; later ones agree.
        if (room.title && room.duration) return null;
        if (!room.title && message.title) room.title = message.title;
        if (!room.duration && message.duration) room.duration = message.duration;
        break;
      }
      case "watchView":
        if (member.watching === message.watching) return null;
        member.watching = message.watching;
        break;
      case "watchStop":
        if (!room) return null;
        this.rooms.delete(key);
        for (const other of this.members.values()) if (other.roomKey === key) other.watching = false;
        break;
      default:
        return null;
    }
    this.broadcast(key);
    return null;
  }

  private view(key: string): WatchRoomView | null {
    const room = this.rooms.get(key);
    if (!room) return null;
    const viewers = [...this.members.values()].filter(member => member.roomKey === key && member.watching).map(member => member.nickname);
    return {
      id: room.id, media: room.media, title: room.title, duration: room.duration, startedBy: room.startedBy,
      playing: room.playing, position: watchPositionAfter(room, this.now() - room.updatedAt), last: room.last,
      viewers: [...new Set(viewers)].sort((a, b) => a.localeCompare(b)),
    };
  }

  private broadcast(key: string): void {
    const room = this.view(key);
    for (const [entryId, member] of this.members) {
      if (member.roomKey === key) this.options.send(entryId, { type: "watchState", room });
    }
  }

  /** Rooms with nobody in the channel for a while are dropped; a video does not wait forever. */
  private forgetIdle(): void {
    const now = this.now();
    const occupied = new Set([...this.members.values()].map(member => member.roomKey));
    for (const key of this.rooms.keys()) {
      if (occupied.has(key)) { this.emptySince.delete(key); continue; }
      const since = this.emptySince.get(key);
      if (since === undefined) this.emptySince.set(key, now);
      else if (now - since > WATCH_IDLE_MS) { this.rooms.delete(key); this.emptySince.delete(key); }
    }
    // A finished video stops counting as playing once its end is long past.
    for (const room of this.rooms.values()) {
      if (room.playing && room.duration > 0 && watchPositionAfter(room, now - room.updatedAt) >= room.duration) {
        room.playing = false;
        room.position = room.duration;
        room.updatedAt = now;
      }
    }
  }

  private take(entryId: string): boolean {
    const now = this.now();
    const bucket = this.buckets.get(entryId) ?? { tokens: RATE.burst, updatedAt: now };
    bucket.tokens = Math.min(RATE.burst, bucket.tokens + (now - bucket.updatedAt) / 1000 * RATE.rate);
    bucket.updatedAt = now;
    this.buckets.set(entryId, bucket);
    if (bucket.tokens < 1) return false;
    bucket.tokens -= 1;
    return true;
  }

  private error(entryId: string, code: string): void {
    this.options.send(entryId, { type: "watchError", code });
  }
}
