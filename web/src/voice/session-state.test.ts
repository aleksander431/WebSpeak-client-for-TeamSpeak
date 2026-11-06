import { test } from "node:test";
import assert from "node:assert/strict";
import { createVoiceSessionState } from "./session-state.js";
import type { ServerMessage } from "../../../src/shared/server-messages.js";

function setup() {
  const state = createVoiceSessionState({ selfId: () => 1, onMemberRemoved() {}, onMembersChanged() {} });
  const channel = (members: Array<{ id: number; nickname: string; uid?: string }>) => state.receive({
    type: "channelList",
    channels: [{ id: "1", parentID: "0", order: "0", name: "Lobby", members }],
  } as unknown as ServerMessage);
  return { state, channel };
}

test("a private message teaches the key of a member the directory lists without a unique id", () => {
  const { state, channel } = setup();
  channel([{ id: 1, nickname: "Me", uid: "me" }, { id: 7, nickname: "Friend" }]);
  assert.match(state.memberConversationKey(7) ?? "", /^member-/);
  state.receive({ type: "chatMessage", scope: "private", targetId: "1", invokerId: 7, invokerName: "Friend", senderUid: "friend-uid", message: "hi" } as unknown as ServerMessage);
  // Replying to the member and the message thread are now one conversation.
  assert.equal(state.memberConversationKey(7), "uid:friend-uid");
  assert.equal(state.chatMessages.at(-1)?.conversationKey, "uid:friend-uid");
  // Later directory snapshots without the id keep it while the nickname matches.
  channel([{ id: 1, nickname: "Me", uid: "me" }, { id: 7, nickname: "Friend" }]);
  assert.equal(state.memberConversationKey(7), "uid:friend-uid");
  // Another person later given the same client id is not that conversation.
  channel([{ id: 1, nickname: "Me", uid: "me" }, { id: 7, nickname: "Stranger" }]);
  assert.match(state.memberConversationKey(7) ?? "", /^member-/);
});

test("a sender whose name differs from the listed member does not rename the member's conversation", () => {
  const { state, channel } = setup();
  channel([{ id: 1, nickname: "Me", uid: "me" }, { id: 7, nickname: "Friend" }]);
  const before = state.memberConversationKey(7);
  state.receive({ type: "chatMessage", scope: "private", targetId: "1", invokerId: 7, invokerName: "Someone else", senderUid: "other", message: "hi" } as unknown as ServerMessage);
  assert.equal(state.memberConversationKey(7), before);
});
