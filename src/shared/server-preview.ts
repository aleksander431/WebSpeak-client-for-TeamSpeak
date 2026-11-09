/**
 * Who is on the fixed TeamSpeak server before joining. Only nicknames and
 * channel names: no unique ids, addresses or descriptions.
 */
export interface ServerPreviewMember {
  nickname: string;
  away?: boolean;
  inputMuted?: boolean;
  outputMuted?: boolean;
}

export interface ServerPreviewChannel {
  id: string;
  parentID: string;
  order?: string;
  name: string;
  passwordProtected?: boolean;
  isPermanent?: boolean;
  members: ServerPreviewMember[];
}

export type ServerPreviewUnavailableReason = "open-mode" | "approval-required" | "no-source" | "unavailable";

export type ServerPreview =
  | { available: true; source: "live" | "query"; channels: ServerPreviewChannel[]; observedAt: string }
  | { available: false; reason: ServerPreviewUnavailableReason };

export const SERVER_PREVIEW_MAX_CHANNELS = 500;
export const SERVER_PREVIEW_MAX_MEMBERS = 1000;

const text = (value: unknown, max: number) => typeof value === "string" ? value.slice(0, max) : "";

/** Validate a preview from the network; anything malformed reads as unavailable. */
export function parseServerPreview(raw: unknown): ServerPreview {
  if (!raw || typeof raw !== "object") return { available: false, reason: "unavailable" };
  const value = raw as Record<string, unknown>;
  if (value.available !== true) {
    const reason = value.reason;
    return { available: false, reason: reason === "open-mode" || reason === "approval-required" || reason === "no-source" ? reason : "unavailable" };
  }
  if (!Array.isArray(value.channels)) return { available: false, reason: "unavailable" };
  let members = 0;
  const channels: ServerPreviewChannel[] = [];
  for (const entry of value.channels.slice(0, SERVER_PREVIEW_MAX_CHANNELS)) {
    if (!entry || typeof entry !== "object") continue;
    const channel = entry as Record<string, unknown>;
    const id = text(channel.id, 20);
    if (!id) continue;
    const list: ServerPreviewMember[] = [];
    for (const item of Array.isArray(channel.members) ? channel.members : []) {
      if (members >= SERVER_PREVIEW_MAX_MEMBERS || !item || typeof item !== "object") continue;
      const member = item as Record<string, unknown>;
      const nickname = text(member.nickname, 64);
      if (!nickname) continue;
      members += 1;
      list.push({ nickname, away: member.away === true, inputMuted: member.inputMuted === true, outputMuted: member.outputMuted === true });
    }
    channels.push({
      id,
      parentID: text(channel.parentID, 20) || "0",
      ...(typeof channel.order === "string" ? { order: channel.order.slice(0, 20) } : {}),
      name: text(channel.name, 128),
      ...(channel.passwordProtected === true ? { passwordProtected: true } : {}),
      ...(channel.isPermanent === true ? { isPermanent: true } : {}),
      members: list,
    });
  }
  return { available: true, source: value.source === "query" ? "query" : "live", channels, observedAt: text(value.observedAt, 40) };
}

/** The value for the join form's channel field: TeamSpeak's "Parent/Child" path. */
export function serverPreviewChannelPath(channels: readonly ServerPreviewChannel[], id: string): string {
  const byId = new Map(channels.map(channel => [channel.id, channel]));
  const names: string[] = [];
  const seen = new Set<string>();
  let current = byId.get(id);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    names.unshift(current.name);
    current = current.parentID && current.parentID !== "0" ? byId.get(current.parentID) : undefined;
  }
  return names.join("/");
}

/**
 * Channels in TeamSpeak's tree order with their depth: siblings follow their
 * `order` predecessor, children follow their parent. Iterative, so a
 * malformed or cyclic list cannot overflow the stack; every channel appears once.
 */
export function orderServerPreview(channels: readonly ServerPreviewChannel[]): Array<{ channel: ServerPreviewChannel; depth: number }> {
  const unique = new Map<string, ServerPreviewChannel>();
  for (const channel of channels) if (!unique.has(channel.id)) unique.set(channel.id, channel);
  const source = [...unique.values()];
  const index = new Map(source.map((channel, position) => [channel.id, position]));
  const byParent = new Map<string, ServerPreviewChannel[]>();
  for (const channel of source) {
    const parent = unique.has(channel.parentID) ? channel.parentID : "0";
    byParent.set(parent, [...(byParent.get(parent) ?? []), channel]);
  }
  const ordered = (siblings: ServerPreviewChannel[]): ServerPreviewChannel[] => {
    const ids = new Set(siblings.map(channel => channel.id));
    const after = new Map<string, ServerPreviewChannel[]>();
    const firsts: ServerPreviewChannel[] = [];
    for (const channel of siblings) {
      if (channel.order && channel.order !== "0" && ids.has(channel.order) && channel.order !== channel.id) after.set(channel.order, [...(after.get(channel.order) ?? []), channel]);
      else firsts.push(channel);
    }
    const result: ServerPreviewChannel[] = [];
    const seen = new Set<string>();
    const visit = (start: ServerPreviewChannel) => {
      const stack = [start];
      while (stack.length) {
        const next = stack.pop()!;
        if (seen.has(next.id)) continue;
        seen.add(next.id);
        result.push(next);
        const following = after.get(next.id) ?? [];
        for (let position = following.length - 1; position >= 0; position--) stack.push(following[position]!);
      }
    };
    const bySource = (left: ServerPreviewChannel, right: ServerPreviewChannel) => (index.get(left.id) ?? 0) - (index.get(right.id) ?? 0);
    for (const channel of firsts.sort(bySource)) visit(channel);
    for (const channel of [...siblings].sort(bySource)) visit(channel);
    return result;
  };
  const output: Array<{ channel: ServerPreviewChannel; depth: number }> = [];
  const placed = new Set<string>();
  const stack: Array<{ channel: ServerPreviewChannel; depth: number }> = ordered(byParent.get("0") ?? []).reverse().map(channel => ({ channel, depth: 0 }));
  const drain = () => {
    while (stack.length) {
      const { channel, depth } = stack.pop()!;
      if (placed.has(channel.id)) continue;
      placed.add(channel.id);
      output.push({ channel, depth });
      const children = ordered(byParent.get(channel.id) ?? []);
      for (let position = children.length - 1; position >= 0; position--) stack.push({ channel: children[position]!, depth: depth + 1 });
    }
  };
  drain();
  // A cycle never reaches the root: start it at its first channel in the source.
  for (const channel of source) if (!placed.has(channel.id)) { stack.push({ channel, depth: 0 }); drain(); }
  return output;
}
