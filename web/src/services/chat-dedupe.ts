import type { ChatMessage } from "../../../src/shared/voice-models.js";

/** Same message from local and server history (or the live session) within this window is one message. */
export const HISTORY_MATCH_WINDOW_MS = 120_000;

type Comparable = Pick<ChatMessage, "scope" | "targetId" | "message" | "invokerName" | "isSelf" | "timestamp" | "ref" | "senderUid">;

/**
 * Are these two copies (live, browser-local history, server history) the same message?
 * A gateway reference decides when both copies carry one. Otherwise the text, the
 * conversation and the time must match, and the sender: our own copy matches the
 * server's copy by nickname too, because a new identity changes our UID, so the
 * server no longer recognises the old message as ours.
 */
export function sameChatMessage(left: Comparable, right: Comparable): boolean {
  if (left.scope !== right.scope) return false;
  if (left.scope === "channel" && (left.targetId ?? "") !== (right.targetId ?? "")) return false;
  if (left.ref && right.ref) return left.ref === right.ref;
  if (left.message !== right.message || Math.abs(left.timestamp - right.timestamp) >= HISTORY_MATCH_WINDOW_MS) return false;
  if (left.isSelf && right.isSelf) return true;
  if (left.senderUid && right.senderUid && left.senderUid === right.senderUid) return true;
  return left.invokerName === right.invokerName;
}
