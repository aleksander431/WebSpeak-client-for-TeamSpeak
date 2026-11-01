/**
 * Decides when to play the "someone joined / left your channel" sound.
 *
 * The tracker compares the other members of the channel you are in between
 * updates. Anything that is not a real join or leave stays silent: the first
 * view of a channel, your own move to another channel, a reconnect or a new
 * session, and the moments right after those while the member list is still
 * filling in.
 */
export type PresenceChange = "joined" | "left";

export interface MemberPresenceTracker {
  /** `scope` identifies session + channel; an empty scope means not in a channel. */
  update(scope: string, memberIds: readonly number[]): PresenceChange | null;
}

/** Changes this soon after entering a channel are the list loading, not people moving. */
export const PRESENCE_SETTLE_MS = 1500;

export function createMemberPresenceTracker(now: () => number = () => Date.now()): MemberPresenceTracker {
  let scope = "";
  let known = new Set<number>();
  let scopeStartedAt = -Infinity;
  return {
    update(nextScope, memberIds) {
      const next = new Set(memberIds);
      if (nextScope !== scope) {
        scope = nextScope;
        known = next;
        scopeStartedAt = now();
        return null;
      }
      if (!scope) { known = next; return null; }
      const settling = now() - scopeStartedAt < PRESENCE_SETTLE_MS;
      let joined = false;
      let left = false;
      for (const id of next) if (!known.has(id)) joined = true;
      for (const id of known) if (!next.has(id)) left = true;
      known = next;
      if (settling) return null;
      // Someone arriving matters more than someone leaving in the same update.
      return joined ? "joined" : left ? "left" : null;
    },
  };
}
