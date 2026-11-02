import { randomBytes } from "node:crypto";
import { CHAT_REACTION_EMOJI, isChatReactionEmoji, type ChatReaction, type ChatReactionEmoji } from "../shared/chat-reactions.js";

/** One gateway session may see a message slightly later than another. */
const SAME_MESSAGE_WINDOW_MS = 10_000;
/** Reactions live in memory for recent messages only. */
const MAX_MESSAGES = 5_000;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const NAMES_SHOWN = 8;

export interface ChatMessageIdentity {
  targetKey: string;
  scope: "channel" | "server";
  channelId: string;
  senderName: string;
  message: string;
}

/** Where reactions of stored messages are kept across restarts (chat history). */
export interface ChatReactionStore {
  /** The stored message with this reference, when history still has it. */
  find(ref: string): (ChatMessageIdentity & { timestamp: number }) | null;
  load(ref: string): { emoji: string; userKey: string; userName: string }[];
  save(ref: string, emoji: string, userKey: string, userName: string, active: boolean): void;
}

interface Entry extends ChatMessageIdentity {
  ref: string;
  seenAt: number;
  /** Last use; old but recently used messages stay in memory. */
  touchedAt: number;
  /** emoji -> user key -> display name */
  reactions: Map<ChatReactionEmoji, Map<string, string>>;
}

/**
 * Gives every channel/server message one reference shared by all gateway
 * sessions that see it, and keeps who reacted to it with what.
 */
export class ChatReactionHub {
  private readonly byRef = new Map<string, Entry>();
  private readonly byContent = new Map<string, Entry[]>();

  constructor(private readonly now: () => number = Date.now, private readonly store?: ChatReactionStore) {}

  /** The reference of a message seen now; the same message seen again shortly after gets the same one. */
  refFor(identity: ChatMessageIdentity, at = this.now()): string {
    const found = this.find(identity, at);
    if (found) return found.ref;
    return this.add(identity, randomBytes(8).toString("hex"), at, new Map()).ref;
  }

  private add(identity: ChatMessageIdentity, ref: string, seenAt: number, reactions: Entry["reactions"]): Entry {
    const entry: Entry = { ...normalize(identity), ref, seenAt, touchedAt: this.now(), reactions };
    this.byRef.set(entry.ref, entry);
    const key = contentKey(entry);
    this.byContent.set(key, [...(this.byContent.get(key) ?? []), entry]);
    this.prune(this.now());
    return entry;
  }

  /** A message known in memory, or brought back from the store with its reactions. */
  private entry(ref: string): Entry | null {
    const known = this.byRef.get(ref);
    if (known) { known.touchedAt = this.now(); return known; }
    const stored = this.store?.find(ref);
    if (!stored) return null;
    const reactions: Entry["reactions"] = new Map();
    for (const row of this.store!.load(ref)) {
      if (!isChatReactionEmoji(row.emoji)) continue;
      const users = reactions.get(row.emoji) ?? new Map<string, string>();
      users.set(row.userKey, row.userName);
      reactions.set(row.emoji, users);
    }
    return this.add(stored, ref, stored.timestamp, reactions);
  }

  /** The reference of a message recorded around `at` (stored history), if still known. */
  lookup(identity: ChatMessageIdentity, at: number): string | null {
    return this.find(identity, at)?.ref ?? null;
  }

  get(ref: string): Readonly<ChatMessageIdentity> | null {
    return this.entry(ref);
  }

  /** Add or remove one user's reaction; false when the message or emoji is unknown. */
  react(ref: string, user: { key: string; name: string }, emoji: string, active: boolean): boolean {
    const entry = this.entry(ref);
    if (!entry || !isChatReactionEmoji(emoji) || !user.key) return false;
    const users = entry.reactions.get(emoji) ?? new Map<string, string>();
    if (active) users.set(user.key, user.name.slice(0, 64));
    else users.delete(user.key);
    if (users.size) entry.reactions.set(emoji, users);
    else entry.reactions.delete(emoji);
    this.store?.save(ref, emoji, user.key, user.name.slice(0, 64), active);
    return true;
  }

  /** Reactions as one viewer sees them, in the fixed emoji order. */
  summary(ref: string, viewerKey: string): ChatReaction[] {
    const entry = this.entry(ref);
    if (!entry) return [];
    const result: ChatReaction[] = [];
    for (const emoji of CHAT_REACTION_EMOJI) {
      const users = entry.reactions.get(emoji);
      if (!users?.size) continue;
      result.push({ emoji, count: users.size, names: [...users.values()].slice(0, NAMES_SHOWN), mine: users.has(viewerKey) });
    }
    return result;
  }

  private find(identity: ChatMessageIdentity, at: number): Entry | null {
    const candidates = this.byContent.get(contentKey(normalize(identity)));
    if (!candidates) return null;
    let best: Entry | null = null;
    for (const entry of candidates) {
      const distance = Math.abs(entry.seenAt - at);
      if (distance < SAME_MESSAGE_WINDOW_MS && (!best || distance < Math.abs(best.seenAt - at))) best = entry;
    }
    return best;
  }

  private prune(at: number): void {
    for (const entry of this.byRef.values()) {
      if (this.byRef.size <= MAX_MESSAGES && at - entry.touchedAt <= MAX_AGE_MS) break;
      this.byRef.delete(entry.ref);
      const key = contentKey(entry);
      const rest = (this.byContent.get(key) ?? []).filter(candidate => candidate !== entry);
      if (rest.length) this.byContent.set(key, rest);
      else this.byContent.delete(key);
    }
  }
}

function normalize(identity: ChatMessageIdentity): ChatMessageIdentity {
  return { targetKey: identity.targetKey, scope: identity.scope, channelId: identity.scope === "channel" ? identity.channelId : "",
    senderName: identity.senderName, message: identity.message.trim() };
}

function contentKey(identity: ChatMessageIdentity): string {
  return JSON.stringify([identity.targetKey, identity.scope, identity.channelId, identity.senderName, identity.message]);
}
