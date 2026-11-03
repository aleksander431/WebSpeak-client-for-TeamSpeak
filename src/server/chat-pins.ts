import type { WebSpeakDatabase } from "../persistence/database.js";
import { CHAT_PIN_LIMIT, type ChatPin } from "../shared/chat-pins.js";

export interface ChatPinScope {
  targetKey: string;
  scope: "channel" | "server";
  channelId: string;
}

export type ChatPinResult = "pinned" | "unpinned" | "limit";

/**
 * Pinned messages per conversation. Saved in SQLite when the gateway has a
 * database (pins outlive restarts and history rotation), otherwise in memory.
 */
export class ChatPinStore {
  private readonly memory = new Map<string, ChatPin[]>();

  constructor(private readonly database?: WebSpeakDatabase, private readonly now: () => number = Date.now) {}

  list(scope: ChatPinScope): ChatPin[] {
    const channelId = scope.scope === "channel" ? scope.channelId : "";
    if (!this.database) return [...(this.memory.get(key(scope)) ?? [])];
    return this.database.listChatPins(scope.targetKey, scope.scope, channelId).map(row => ({
      ref: row.ref, senderName: row.senderName, message: row.message, timestamp: row.createdAt, pinnedBy: row.pinnedBy, pinnedAt: row.pinnedAt,
    }));
  }

  pin(scope: ChatPinScope, message: Omit<ChatPin, "pinnedBy" | "pinnedAt">, pinnedBy: string): ChatPinResult {
    const pins = this.list(scope);
    if (pins.some(pin => pin.ref === message.ref)) return "pinned";
    if (pins.length >= CHAT_PIN_LIMIT) return "limit";
    const pin: ChatPin = { ...message, senderName: message.senderName.slice(0, 64), message: message.message.slice(0, 2048), pinnedBy: pinnedBy.slice(0, 64), pinnedAt: this.now() };
    const channelId = scope.scope === "channel" ? scope.channelId : "";
    if (this.database) {
      this.database.addChatPin({ targetKey: scope.targetKey, scope: scope.scope, channelId, ref: pin.ref, senderName: pin.senderName,
        message: pin.message, createdAt: pin.timestamp, pinnedBy: pin.pinnedBy, pinnedAt: pin.pinnedAt });
    } else {
      this.memory.set(key(scope), [...pins, pin]);
    }
    return "pinned";
  }

  unpin(scope: ChatPinScope, ref: string): ChatPinResult {
    const channelId = scope.scope === "channel" ? scope.channelId : "";
    if (this.database) this.database.removeChatPin(scope.targetKey, scope.scope, channelId, ref);
    else this.memory.set(key(scope), this.list(scope).filter(pin => pin.ref !== ref));
    return "unpinned";
  }
}

function key(scope: ChatPinScope): string {
  return JSON.stringify([scope.targetKey, scope.scope, scope.scope === "channel" ? scope.channelId : ""]);
}
