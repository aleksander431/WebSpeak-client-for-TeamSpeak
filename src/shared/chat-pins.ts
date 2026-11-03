// Pinned channel and server messages. The gateway keeps them (with their own
// copy of the text) for its WebSpeak sessions; native TeamSpeak clients do
// not see pins.

/** Most pins one conversation may hold. */
export const CHAT_PIN_LIMIT = 50;

export interface ChatPin {
  /** The pinned message's gateway reference. */
  ref: string;
  senderName: string;
  message: string;
  /** When the message was sent. */
  timestamp: number;
  pinnedBy: string;
  pinnedAt: number;
}

const REF = /^[0-9a-f]{16}$/;

export function parseChatPins(value: unknown): ChatPin[] | null {
  if (!Array.isArray(value) || value.length > CHAT_PIN_LIMIT) return null;
  const pins: ChatPin[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return null;
    const record = item as Record<string, unknown>;
    if (typeof record.ref !== "string" || !REF.test(record.ref)) return null;
    if (typeof record.message !== "string" || record.message.length > 2048) return null;
    if (typeof record.timestamp !== "number" || typeof record.pinnedAt !== "number") return null;
    pins.push({
      ref: record.ref, message: record.message, timestamp: record.timestamp, pinnedAt: record.pinnedAt,
      senderName: typeof record.senderName === "string" ? record.senderName.slice(0, 64) : "",
      pinnedBy: typeof record.pinnedBy === "string" ? record.pinnedBy.slice(0, 64) : "",
    });
  }
  return pins;
}
