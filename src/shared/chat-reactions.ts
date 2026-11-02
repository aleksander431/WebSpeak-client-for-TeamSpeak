// Emoji reactions on channel and server chat messages. TeamSpeak has no such
// thing, so the gateway keeps them (in memory) for its own WebSpeak sessions;
// native TeamSpeak clients never see them.

/** The fixed set of reactions; anything else is refused. */
export const CHAT_REACTION_EMOJI = ["👍", "👎", "😂", "❤️", "🔥", "😮", "😢", "🎉"] as const;
export type ChatReactionEmoji = typeof CHAT_REACTION_EMOJI[number];

export interface ChatReaction {
  emoji: ChatReactionEmoji;
  count: number;
  /** Up to a few names of who reacted, for the tooltip. */
  names: string[];
  /** The receiving session reacted with this emoji. */
  mine: boolean;
}

/** Gateway-issued message reference: 16 lowercase hex characters. */
export const CHAT_REF_PATTERN = /^[0-9a-f]{16}$/;

export function isChatReactionEmoji(value: unknown): value is ChatReactionEmoji {
  return typeof value === "string" && (CHAT_REACTION_EMOJI as readonly string[]).includes(value);
}

export function parseChatReactions(value: unknown): ChatReaction[] | null {
  if (!Array.isArray(value) || value.length > CHAT_REACTION_EMOJI.length) return null;
  const reactions: ChatReaction[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return null;
    const record = item as Record<string, unknown>;
    if (!isChatReactionEmoji(record.emoji) || typeof record.count !== "number" || !Number.isInteger(record.count) || record.count < 1) return null;
    const names = Array.isArray(record.names) ? record.names.filter((name): name is string => typeof name === "string").slice(0, 10) : [];
    reactions.push({ emoji: record.emoji, count: record.count, names, mine: record.mine === true });
  }
  return reactions;
}
