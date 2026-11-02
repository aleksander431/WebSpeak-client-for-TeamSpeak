import type { ChannelMember } from "../../../src/shared/voice-models.js";

/**
 * Saved per-member volumes live in one map (the persisted `volumesByUid`).
 * The TeamSpeak UID is the stable key; the nickname is a fallback, because the
 * same person gets a different UID in another browser, the desktop client or
 * after clearing site data. Nickname keys carry a prefix no UID can contain.
 */
export function nicknameVolumeKey(nickname: string | undefined): string | null {
  const name = nickname?.trim().toLowerCase();
  return name ? `name:${name}` : null;
}

/** Keys to store a member's volume under: UID and nickname. */
export function memberVolumeKeys(member: Pick<ChannelMember, "uid" | "nickname">): string[] {
  const keys: string[] = [];
  if (member.uid) keys.push(member.uid);
  const name = nicknameVolumeKey(member.nickname);
  if (name) keys.push(name);
  return keys;
}

/** Restore stable per-member preferences onto the connection-local client IDs. */
export function applySavedMemberVolumes(
  members: readonly ChannelMember[],
  savedByUid: Readonly<Record<string, number>>,
  volumes: Record<number, number>,
): number[] {
  const updatedIds: number[] = [];
  for (const member of members) {
    if (member.isSelf) continue;
    // The UID wins; the nickname only covers a UID we have not seen.
    const byUid = member.uid ? savedByUid[member.uid] : undefined;
    const nameKey = nicknameVolumeKey(member.nickname);
    const saved = typeof byUid === "number" ? byUid : nameKey ? savedByUid[nameKey] : undefined;
    if (typeof saved !== "number" || !Number.isFinite(saved)) continue;
    const normalized = Math.max(0, Math.min(4, saved));
    if (volumes[member.id] === normalized) continue;
    volumes[member.id] = normalized;
    updatedIds.push(member.id);
  }
  return updatedIds;
}
