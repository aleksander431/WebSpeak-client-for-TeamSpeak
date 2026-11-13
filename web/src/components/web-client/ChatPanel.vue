<template>
  <section
    :class="['chat-panel', { 'mobile-section-hidden': mobileHidden }]"
    :data-ws-chat-tab="chatTab"
    :data-ws-chat-panel-open="panelOpen"
    data-ws-part="voice.chat"
    @dragenter="onDragEnter"
    @dragover="onDragOver"
    @dragleave="onDragLeave"
    @drop="onDrop"
  >
    <div
      v-if="dragActive"
      class="chat-drop-overlay"
      data-ws-part="voice.chat.drop-overlay"
      ><Icon
        name="paperclip"
        :size="28"
      /><strong>{{ t("chatDropFiles") }}</strong
      ><span v-if="maxFileBytes">{{ t("chatFileLimit", { size: formatBytes(maxFileBytes) }) }}</span></div
    >
    <div
      class="chat-tabs"
      data-ws-part="voice.chat.tabs"
      role="tablist"
      :aria-label="t('chatTabs')"
    >
      <button
        type="button"
        data-ws-part="voice.chat.tab"
        data-ws-chat-kind="channel"
        :data-ws-state="chatTab === 'channel' ? 'active' : 'idle'"
        :class="{ active: chatTab === 'channel' }"
        @click="chatTab = 'channel'"
        ><Icon
          name="hash"
          :size="15"
        />
        {{ currentChannelName }}</button
      >
      <button
        type="button"
        data-ws-part="voice.chat.tab"
        data-ws-chat-kind="server"
        :data-ws-state="chatTab === 'server' ? 'active' : 'idle'"
        :class="{ active: chatTab === 'server' }"
        @click="chatTab = 'server'"
        ><Icon
          name="server"
          :size="15"
        />
        {{ t("serverChat") }}</button
      >
      <button
        v-for="conversation in privateConversations"
        :key="conversation.key"
        type="button"
        data-ws-part="voice.chat.tab"
        data-ws-chat-kind="private"
        :data-ws-state="
          chatTab === 'private' && privateConversationKey === conversation.key ? 'active' : 'idle'
        "
        :class="{ active: chatTab === 'private' && privateConversationKey === conversation.key }"
        class="chat-private-tab"
        @click="openConversation(conversation)"
        @auxclick.middle.prevent="closeConversation(conversation)"
        @keydown.delete.prevent="closeConversation(conversation)"
        ><Icon
          name="message"
          :size="15"
        />
        {{ conversation.name
        }}<span
          class="chat-tab-close"
          data-ws-part="voice.chat.tab-close"
          role="button"
          :aria-label="t('closePrivateChat', { name: conversation.name })"
          :title="t('closePrivateChat', { name: conversation.name })"
          @click.stop="closeConversation(conversation)"
          ><Icon
            name="close"
            :size="12" /></span
      ></button>
      <button
        type="button"
        data-ws-part="voice.chat.tab"
        data-ws-chat-kind="events"
        :data-ws-state="chatTab === 'events' ? 'active' : 'idle'"
        :class="{ active: chatTab === 'events' }"
        @click="chatTab = 'events'"
        ><Icon
          name="bell"
          :size="15"
        />
        {{ t("eventLog") }}</button
      >
    </div>
    <div
      class="section-heading chat-heading"
      data-ws-part="voice.chat.heading"
      ><div
        ><span class="section-kicker">{{ chatTabLabel }}</span
        ><h2
          ><Icon
            :name="
              chatTab === 'server'
                ? 'server'
                : chatTab === 'events'
                  ? 'bell'
                  : chatTab === 'private'
                    ? 'message'
                    : 'hash'
            "
            :size="20"
          />
          {{ chatTitle }}</h2
        ></div
      ><span class="section-counter">{{
        chatTab === "events"
          ? t("eventCount", { count: serverEvents.length })
          : t("messageCount", { count: visibleChatMessages.length })
      }}</span
      ><button
        v-if="chatTab !== 'events'"
        type="button"
        class="chat-search-toggle"
        data-ws-part="voice.chat.search-toggle"
        :data-ws-state="searchOpen ? 'open' : 'closed'"
        :aria-pressed="searchOpen"
        :title="t('chatSearch')"
        :aria-label="t('chatSearch')"
        @click="toggleSearchAndFocus"
        ><Icon
          name="search"
          :size="16" /></button
    ></div>
    <div
      v-if="searchOpen && chatTab !== 'events'"
      class="chat-search"
      data-ws-part="voice.chat.search"
      role="search"
      ><Icon
        name="search"
        :size="15"
      /><input
        ref="searchInput"
        v-model="searchQuery"
        type="search"
        maxlength="100"
        :placeholder="t('chatSearchPlaceholder')"
        :aria-label="t('chatSearch')"
        @keydown.esc.prevent="toggleSearch"
      /><span
        class="chat-search-status"
        role="status"
        >{{ searching ? t("chatSearching") : searchQuery.trim() ? t("chatSearchFound", { count: visibleChatMessages.length }) : "" }}</span
      ><button
        type="button"
        :title="t('close')"
        :aria-label="t('close')"
        @click="toggleSearch"
        ><Icon
          name="close"
          :size="14" /></button
    ></div>
    <div
      v-if="(chatTab === 'channel' || chatTab === 'server') && currentPins.length"
      class="chat-pinned"
      data-ws-part="voice.chat.pinned"
      ><button
        type="button"
        class="chat-pinned-bar"
        data-ws-part="voice.chat.pinned-bar"
        :aria-expanded="pinsOpen"
        @click="pinsOpen = !pinsOpen"
        ><Icon
          name="pin"
          :size="16"
        /><span class="chat-pinned-copy"
          ><strong>{{ t("chatPinned") }} · {{ currentPins.length }}</strong
          ><small>{{ latestPin ? `${latestPin.senderName}: ${pinExcerpt(latestPin.message)}` : "" }}</small></span
        ><Icon
          name="chevron-down"
          :size="15"
          :class="['chat-pinned-chevron', { open: pinsOpen }]"
      /></button
      ><ul
        v-if="pinsOpen"
        class="chat-pinned-list"
        data-ws-part="voice.chat.pinned-list"
        ><li
          v-for="pin in pinsNewestFirst"
          :key="pin.ref"
          data-ws-part="voice.chat.pinned-item"
          ><button
            type="button"
            class="chat-pinned-jump"
            :title="t('chatPinnedJump')"
            @click="jumpTo(pin.ref)"
            ><strong>{{ pin.senderName }} <time>{{ formatTime(pin.timestamp) }}</time></strong
            ><span>{{ pinExcerpt(pin.message) }}</span
            ><small>{{ t("chatPinnedBy", { name: pin.pinnedBy }) }}</small></button
          ><button
            v-if="canPin"
            type="button"
            class="chat-pinned-unpin"
            data-ws-part="voice.chat.pinned-unpin"
            :title="t('chatUnpin')"
            :aria-label="t('chatUnpin')"
            @click="unpin(pin.ref)"
            ><Icon
              name="close"
              :size="14" /></button
        ></li
      ></ul
    ></div>
    <div
      ref="chatListEl"
      class="message-list"
      data-ws-part="voice.chat.messages"
      @scroll.passive="onScroll"
    >
      <div v-if="chatTab === 'events'">
        <article
          v-for="event in serverEvents"
          :key="event.id"
          class="event-row"
          data-ws-part="voice.chat.event"
          ><time>{{ formatTime(event.timestamp) }}</time
          ><span>{{ eventText(event) }}</span></article
        >
        <div
          v-if="!serverEvents.length"
          class="chat-empty"
          data-ws-part="voice.chat.empty"
          data-ws-state="events-empty"
          ><div class="chat-empty-icon"
            ><Icon
              name="bell"
              :size="24" /></div
          ><strong>{{ t("noEvents") }}</strong
          ><span>{{ t("noEventsLead") }}</span></div
        >
      </div>
      <div
        v-else-if="!visibleChatMessages.length && searchOpen && searchQuery.trim()"
        class="chat-empty"
        data-ws-part="voice.chat.empty"
        data-ws-state="search-empty"
        ><strong>{{ searching ? t("chatSearching") : t("chatSearchNothing") }}</strong></div
      >
      <div
        v-else-if="!visibleChatMessages.length"
        class="chat-empty"
        data-ws-part="voice.chat.empty"
        data-ws-state="messages-empty"
        ><strong>{{ chatTab === "private" ? t("privateChatStart") : t("chatStart") }}</strong
        ><span>{{
          chatTab === "private" ? t("privateChatStartLead") : t("chatStartLead")
        }}</span></div
      >
      <template
        v-for="message in visibleChatMessages"
        :key="message.id"
      >
        <article
          v-if="chatTab !== 'events'"
          :class="['message-row', { mine: message.isSelf, 'mentions-me': mentionsMe(message) }]"
          data-ws-part="voice.chat.message"
          :data-ws-state="message.isSelf ? 'mine' : 'other'"
          :data-ws-mention="mentionsMe(message) ? 'self' : undefined"
          :data-ws-ref="message.ref"
        >
          <div
            class="message-avatar"
            data-ws-part="voice.chat.message-avatar"
            :style="avatarStyle(message.invokerName, message.isSelf, messageAvatar(message))"
            >{{ messageAvatar(message) ? "" : avatarInitial(message.invokerName) }}</div
          >
          <div
            class="message-body"
            data-ws-part="voice.chat.message-body"
            ><div class="message-meta"
              ><strong>{{ message.isSelf ? t("you") : message.invokerName }}</strong
              ><time>{{ formatTime(message.timestamp) }}</time
              ><Icon
                v-if="isPinned(message)"
                name="pin"
                :size="12"
                class="message-pin-marker"
                data-ws-part="voice.chat.message-pin"
                :aria-label="t('chatPinned')"
            /></div
            ><div
              class="message-bubble"
              data-ws-part="voice.chat.message-bubble"
              ><ChatMessageContent
                :message="message.message"
                :t="t"
                :mention-names="mentionNames"
                :self-name="selfName"
                @media-loaded="scrollIfFollowing"
            /></div
            ><button
              v-if="watchLink && watchableOf(message)"
              type="button"
              class="chat-watch-link"
              data-ws-part="voice.chat.watch-link"
              :title="t('watchChatLinkHint')"
              @click="watchLink(watchableOf(message)!)"
              ><Icon
                name="play"
                :size="12"
              /> <span>{{ t("watchChatLink") }}</span></button
            ><div
              v-if="reactionsOf(message).length"
              class="chat-reactions"
              data-ws-part="voice.chat.reactions"
              ><button
                v-for="reaction in reactionsOf(message)"
                :key="reaction.emoji"
                type="button"
                :class="['chat-reaction', { mine: reaction.mine }]"
                data-ws-part="voice.chat.reaction"
                :data-ws-state="reaction.mine ? 'mine' : 'other'"
                :aria-pressed="reaction.mine"
                :title="reaction.names.join(', ')"
                :disabled="!canReact"
                @click="toggleReaction(message, reaction.emoji)"
                ><span class="chat-reaction-emoji">{{ reaction.emoji }}</span
                ><span class="chat-reaction-count">{{ reaction.count }}</span></button
              ></div
            ></div
          >
          <div
            v-if="canSendChat"
            class="message-actions"
            data-ws-part="voice.chat.message-actions"
            ><button
              type="button"
              data-ws-part="voice.chat.reply"
              :title="t('chatReply')"
              :aria-label="t('chatReply')"
              @click="replyAndFocus(message)"
              ><Icon
                name="reply"
                :size="15" /></button
            ><button
              v-if="message.ref && canPin"
              type="button"
              data-ws-part="voice.chat.pin"
              :aria-pressed="isPinned(message)"
              :title="isPinned(message) ? t('chatUnpin') : t('chatPin')"
              :aria-label="isPinned(message) ? t('chatUnpin') : t('chatPin')"
              @click="togglePin(message)"
              ><Icon
                name="pin"
                :size="15" /></button
            ><button
              v-if="message.ref && canReact"
              type="button"
              data-ws-part="voice.chat.react"
              :aria-expanded="reactionPickerFor === message.id"
              :title="t('chatReact')"
              :aria-label="t('chatReact')"
              @click="reactionPickerFor = reactionPickerFor === message.id ? '' : message.id"
              ><Icon
                name="smile"
                :size="15" /></button
            ><div
              v-if="reactionPickerFor === message.id"
              class="chat-reaction-picker"
              data-ws-part="voice.chat.reaction-picker"
              role="menu"
              ><button
                v-for="emoji in CHAT_REACTION_EMOJI"
                :key="emoji"
                type="button"
                role="menuitem"
                :aria-label="emoji"
                @click="toggleReaction(message, emoji); reactionPickerFor = ''"
                >{{ emoji }}</button
              ></div
            ></div
          >
        </article>
      </template>
    </div>
    <form
      v-if="chatTab !== 'events'"
      class="message-composer"
      data-ws-part="voice.chat.composer"
      @submit.prevent="!composing && submitAll()"
    >
      <ul
        v-if="uploads.length"
        class="chat-uploads"
        data-ws-part="voice.chat.uploads"
      >
        <li
          v-for="upload in uploads"
          :key="upload.key"
          :data-ws-state="upload.error ? 'failed' : 'uploading'"
          ><Icon
            name="paperclip"
            :size="14"
          /><span class="chat-upload-name">{{ upload.name }}</span
          ><span
            v-if="upload.error"
            class="chat-upload-error"
            role="alert"
            >{{ upload.error }}</span
          ><progress
            v-else
            max="1"
            :value="upload.progress"
            :aria-label="t('chatUploading')"
          ></progress
          ><button
            v-if="upload.error"
            type="button"
            :title="t('close')"
            :aria-label="t('close')"
            @click="dismissUpload(upload.key)"
            ><Icon
              name="close"
              :size="13" /></button
        ></li>
      </ul>
      <ul
        v-if="staged.length"
        class="chat-staged"
        data-ws-part="voice.chat.staged"
        :aria-label="t('chatStagedFiles')"
        ><li
          v-for="item in staged"
          :key="item.key"
          :class="{ image: item.url }"
          :title="item.file.name"
          ><img
            v-if="item.url"
            :src="item.url"
            alt=""
          /><span
            v-else
            class="chat-staged-file"
            ><Icon
              name="paperclip"
              :size="16"
            /><span class="chat-staged-name">{{ item.file.name }}</span
            ><small>{{ formatBytes(item.file.size) }}</small></span
          ><button
            type="button"
            class="chat-staged-remove"
            :title="t('chatStagedRemove')"
            :aria-label="t('chatStagedRemove')"
            @click="unstage(item.key)"
            ><Icon
              name="close"
              :size="12" /></button
        ></li
        ><li class="chat-staged-hint">{{ t("chatStagedHint") }}</li></ul
      >
      <div
        v-if="replyTo"
        class="chat-reply-preview"
        data-ws-part="voice.chat.reply-preview"
        ><Icon
          name="reply"
          :size="14"
        /><span
          ><strong>{{ t("chatReplyingTo", { name: replyTo.isSelf ? t("you") : replyTo.invokerName }) }}</strong
          ><small>{{ replyExcerpt }}</small></span
        ><button
          type="button"
          :title="t('close')"
          :aria-label="t('close')"
          @click="cancelReply"
          ><Icon
            name="close"
            :size="13" /></button
      ></div>
      <ul
        v-if="mentionSuggestions.length"
        class="chat-mention-suggestions"
        data-ws-part="voice.chat.mention-suggestions"
        role="listbox"
        :aria-label="t('chatMentionSuggestions')"
        ><li
          v-for="(name, index) in mentionSuggestions"
          :key="name"
          role="option"
          :aria-selected="index === mentionIndex"
          :class="{ active: index === mentionIndex }"
          @mousedown.prevent="applyMention(name)"
          >@{{ name }}</li
        ></ul
      >
      <button
        v-if="canAttach"
        class="attach-button"
        type="button"
        data-ws-part="voice.chat.attach"
        :title="t('chatAttach')"
        :aria-label="t('chatAttach')"
        @click="fileInput?.click()"
        ><Icon
          name="paperclip"
          :size="18"
      /></button>
      <input
        ref="fileInput"
        class="chat-file-input"
        type="file"
        multiple
        hidden
        @change="onFilesChosen"
      />
      <textarea
        ref="draftInput"
        v-model="messageDraft"
        class="message-input"
        data-ws-part="voice.chat.input"
        rows="1"
        maxlength="20000"
        @paste="onPaste"
        enterkeyhint="send"
        autocomplete="off"
        spellcheck="true"
        @compositionstart="composing = true"
        @compositionend="composing = false"
        @keydown="onDraftKeydown"
        @input="onDraftInput"
        @click="updateMentionQuery"
        :placeholder="chatPlaceholder"
        :aria-label="t('send')"
      ></textarea>
      <button
        class="send-button"
        type="submit"
        :disabled="!canSendChat || (!messageDraft.trim() && !staged.length)"
        :title="t('send')"
        :aria-label="t('send')"
        ><Icon
          name="send"
          :size="18"
      /></button>
    </form>
    <p
      v-if="chatTab !== 'events' && (draftTooLong || draftBytes > CHAT_MESSAGE_MAX_BYTES * 0.8)"
      :class="['chat-length', { over: draftTooLong }]"
      data-ws-part="voice.chat.length"
      role="status"
      >{{ draftTooLong ? (canAttach ? t("chatSendsAsFile") : t("chatMessageTooLong")) : t("chatBytesLeft", { count: CHAT_MESSAGE_MAX_BYTES - draftBytes }) }}</p
    >
    <p
      v-if="chatStatus"
      class="chat-status"
      data-ws-part="voice.chat.status"
      role="status"
      >{{ chatStatus }}</p
    >
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, type CSSProperties } from "vue";
import Icon from "../Icon.vue";
import ChatMessageContent from "./ChatMessageContent.vue";
import { formatBytes } from "../../../../src/shared/chat-storage.js";
import { CHAT_MESSAGE_MAX_BYTES, chatPlainText, parseChatMarkup } from "../../../../src/shared/chat-markup.js";
import { CHAT_REACTION_EMOJI } from "../../../../src/shared/chat-reactions.js";
import { watchableLink } from "../../../../src/shared/watch-together.js";
import type { useWebClientChat } from "../../composables/useWebClientChat.js";
import type { ChatMessage, ServerEvent } from "../../composables/useVoiceWebSocket.js";

type ChatPanelModel = Pick<ReturnType<typeof useWebClientChat>,
  | "tab" | "privateConversationKey" | "canSend" | "status" | "messageDraft"
  | "panelOpen"
  | "listElement" | "conversations" | "visibleMessages" | "tabLabel" | "title"
  | "placeholder" | "openConversation" | "closeConversation" | "submitMessage" | "onScroll"
  | "uploads" | "canAttach" | "maxFileBytes" | "sendFiles" | "dismissUpload" | "scrollIfFollowing"
  | "replyTo" | "startReply" | "cancelReply" | "reactionsOf" | "toggleReaction" | "canReact"
  | "searchOpen" | "searchQuery" | "searching" | "toggleSearch"
  | "mentionNames" | "selfName" | "draftBytes" | "draftTooLong"
  | "currentPins" | "canPin" | "pinsOpen" | "isPinned" | "togglePin" | "unpin"
>;

const props = defineProps<{
  model: ChatPanelModel;
  t: (key: string, variables?: Record<string, string | number>) => string;
  currentChannelName: string;
  mobileHidden: boolean;
  serverEvents: readonly ServerEvent[];
  avatarStyle: (name: string, isSelf?: boolean, avatar?: string) => CSSProperties;
  avatarInitial: (name: string) => string;
  messageAvatar: (message: ChatMessage) => string;
  formatTime: (timestamp: number) => string;
  /** Plays a video link for the channel (or queues it); without it no button is shown. */
  watchLink?: (url: string) => void;
}>();
const watchableOf = (message: ChatMessage) => watchableLink(message.message);

// The page owns one stable controller across room and mobile view changes.
// Keep its list ref attached to the rendered scroller, including unmount cleanup.
const {
  tab: chatTab,
  panelOpen,
  privateConversationKey,
  canSend: canSendChat,
  status: chatStatus,
  messageDraft,
  listElement: chatListEl,
  conversations: privateConversations,
  visibleMessages: visibleChatMessages,
  tabLabel: chatTabLabel,
  title: chatTitle,
  placeholder: chatPlaceholder,
  openConversation,
  closeConversation,
  submitMessage,
  onScroll,
  uploads,
  canAttach,
  maxFileBytes,
  sendFiles,
  dismissUpload,
  scrollIfFollowing,
  replyTo,
  startReply,
  cancelReply,
  reactionsOf,
  toggleReaction,
  canReact,
  searchOpen,
  searchQuery,
  searching,
  toggleSearch,
  mentionNames,
  selfName,
  draftBytes,
  draftTooLong,
  currentPins,
  canPin,
  pinsOpen,
  isPinned,
  togglePin,
  unpin,
} = props.model;

const latestPin = computed(() => currentPins.value.at(-1) ?? null);
const pinsNewestFirst = computed(() => [...currentPins.value].reverse());
function pinExcerpt(message: string): string {
  const text = chatPlainText(message).replace(/\s+/g, " ").trim();
  return text.length > 120 ? `${text.slice(0, 119)}…` : text;
}
/** Scroll to a pinned message if it is loaded, and briefly highlight it. */
function jumpTo(ref: string): void {
  const row = chatListEl.value?.querySelector<HTMLElement>(`[data-ws-ref="${CSS.escape(ref)}"]`);
  if (!row) return;
  pinsOpen.value = false;
  row.scrollIntoView({ block: "center", behavior: "smooth" });
  row.classList.remove("flash");
  void row.offsetWidth;
  row.classList.add("flash");
  setTimeout(() => row.classList.remove("flash"), 1600);
}

const draftInput = ref<HTMLTextAreaElement | null>(null);
const searchInput = ref<HTMLInputElement | null>(null);
const reactionPickerFor = ref("");
// A pointer anywhere outside the open picker closes it.
function closePickerOutside(event: PointerEvent): void {
  if (reactionPickerFor.value && !(event.target instanceof Element && event.target.closest(".message-actions"))) reactionPickerFor.value = "";
}
onMounted(() => document.addEventListener("pointerdown", closePickerOutside, true));
onBeforeUnmount(() => document.removeEventListener("pointerdown", closePickerOutside, true));

function mentionsMe(message: ChatMessage): boolean {
  if (message.isSelf || !selfName.value || !message.message.includes("@")) return false;
  return parseChatMarkup(message.message, { mentionNames: [selfName.value], selfName: selfName.value }).mentionsSelf;
}

const replyExcerpt = computed(() => {
  const text = replyTo.value ? chatPlainText(replyTo.value.message).replace(/\s+/g, " ").trim() : "";
  return text.length > 90 ? `${text.slice(0, 89)}…` : text;
});

function replyAndFocus(message: ChatMessage): void {
  startReply(message);
  void nextTick(() => draftInput.value?.focus());
}

function toggleSearchAndFocus(): void {
  toggleSearch();
  if (searchOpen.value) void nextTick(() => searchInput.value?.focus());
}

/** The message box grows with its text, up to a limit, then scrolls. */
function resizeDraft(): void {
  const input = draftInput.value;
  if (!input) return;
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 200)}px`;
}
watch(messageDraft, () => void nextTick(resizeDraft));

// @mention autocomplete: the word being typed right before the caret.
const mentionQuery = ref<{ start: number; text: string } | null>(null);
const mentionIndex = ref(0);
const mentionSuggestions = computed(() => {
  const query = mentionQuery.value;
  if (!query) return [];
  const needle = query.text.toLocaleLowerCase();
  return mentionNames.value
    .filter(name => name !== selfName.value && name.toLocaleLowerCase().startsWith(needle))
    .sort((a, b) => a.localeCompare(b))
    .slice(0, 6);
});
function updateMentionQuery(): void {
  const input = draftInput.value;
  if (!input || input.selectionStart !== input.selectionEnd) { mentionQuery.value = null; return; }
  const before = input.value.slice(0, input.selectionStart);
  const match = /(^|[\s(])@([^\s@]{0,32})$/.exec(before);
  mentionQuery.value = match ? { start: before.length - match[2].length - 1, text: match[2] } : null;
  mentionIndex.value = 0;
}
function onDraftInput(): void {
  updateMentionQuery();
}
function applyMention(name: string): void {
  const input = draftInput.value;
  const query = mentionQuery.value;
  if (!input || !query) return;
  const end = query.start + 1 + query.text.length;
  const value = messageDraft.value;
  messageDraft.value = `${value.slice(0, query.start)}@${name} ${value.slice(end)}`;
  mentionQuery.value = null;
  const caret = query.start + name.length + 2;
  void nextTick(() => { input.focus(); input.setSelectionRange(caret, caret); });
}

const fileInput = ref<HTMLInputElement | null>(null);
function onFilesChosen(event: Event): void {
  const input = event.target as HTMLInputElement;
  const files = [...(input.files ?? [])];
  input.value = "";
  if (files.length) stage(files);
}

/**
 * Files pasted, dropped or chosen wait above the message box (images with a
 * preview) until Send, so a wrong screenshot can be removed first.
 */
interface StagedFile { key: number; file: File; url: string | null }
const MAX_STAGED_FILES = 10;
const staged = ref<StagedFile[]>([]);
let stagedSequence = 0;
const previewable = (file: File) => /^image\/(png|jpeg|gif|webp|bmp|avif)$/i.test(file.type);
function stage(files: readonly File[]): void {
  const room = MAX_STAGED_FILES - staged.value.length;
  const added = files.slice(0, Math.max(0, room)).map(file => ({
    key: ++stagedSequence,
    file,
    url: previewable(file) && typeof URL.createObjectURL === "function" ? URL.createObjectURL(file) : null,
  }));
  if (!added.length) return;
  staged.value = [...staged.value, ...added];
  void nextTick(() => draftInput.value?.focus());
}
function release(item: StagedFile): void {
  if (item.url) { try { URL.revokeObjectURL(item.url); } catch { /* already released */ } }
}
function unstage(key: number): void {
  const item = staged.value.find(entry => entry.key === key);
  if (item) release(item);
  staged.value = staged.value.filter(entry => entry.key !== key);
  draftInput.value?.focus();
}
function unstageAll(): void {
  for (const item of staged.value) release(item);
  staged.value = [];
}
onBeforeUnmount(unstageAll);
/** Send the waiting files first, then the text (a caption reads after its picture). */
async function submitAll(): Promise<void> {
  if (!canSendChat.value) return;
  const files = staged.value;
  if (files.length) {
    staged.value = [];
    const sending = sendFiles(files.map(item => item.file));
    for (const item of files) release(item);
    await sending;
  }
  if (messageDraft.value.trim()) await submitMessage();
}

/** A screenshot pasted into the message box waits above it with a preview. */
function onPaste(event: ClipboardEvent): void {
  const files = [...(event.clipboardData?.files ?? [])];
  if (!files.length || !canAttach.value) return;
  event.preventDefault();
  stage(files);
}

const dragActive = ref(false);
let dragDepth = 0;
const carriesFiles = (event: DragEvent) => Boolean(event.dataTransfer?.types.includes("Files"));
function onDragEnter(event: DragEvent): void {
  if (!carriesFiles(event) || !canAttach.value) return;
  dragDepth += 1;
  dragActive.value = true;
}
function onDragOver(event: DragEvent): void {
  if (!carriesFiles(event) || !canAttach.value) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
}
function onDragLeave(event: DragEvent): void {
  if (!carriesFiles(event)) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) dragActive.value = false;
}
function onDrop(event: DragEvent): void {
  if (!carriesFiles(event)) return;
  event.preventDefault();
  dragDepth = 0;
  dragActive.value = false;
  const files = [...(event.dataTransfer?.files ?? [])];
  if (files.length && canAttach.value) stage(files);
}

const composing = ref(false);
function onDraftKeydown(event: KeyboardEvent): void {
  const suggestions = mentionSuggestions.value;
  if (suggestions.length) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      mentionIndex.value = (mentionIndex.value + step + suggestions.length) % suggestions.length;
      return;
    }
    if ((event.key === "Enter" || event.key === "Tab") && !event.shiftKey && !composing.value && !event.isComposing) {
      event.preventDefault();
      applyMention(suggestions[mentionIndex.value] ?? suggestions[0]);
      return;
    }
    if (event.key === "Escape") { event.preventDefault(); mentionQuery.value = null; return; }
  }
  if (event.key === "Escape" && replyTo.value) { event.preventDefault(); cancelReply(); return; }
  if (event.key === "Escape" && staged.value.length) { event.preventDefault(); unstageAll(); return; }
  if (event.key !== "Enter") return;
  // Android IME and Safari can confirm a candidate with Enter; that is not Send.
  if (composing.value || event.isComposing || event.keyCode === 229) { event.preventDefault(); return; }
  // Shift+Enter is a new line; Enter alone sends (also inside a code block).
  if (event.shiftKey) return;
  event.preventDefault();
  if (canSendChat.value && (messageDraft.value.trim() || staged.value.length)) void submitAll();
}

/** Gateway events carry a translation code; older gateways only send Chinese text. */
function eventText(event: ServerEvent): string {
  if (!event.code) return event.message;
  const key = `event_${event.code}`;
  const params = Object.fromEntries(Object.entries(event.params ?? {}).map(([name, value]) => [name, value || props.t("someUser")]));
  const text = props.t(key, params);
  return text === key ? event.message : text;
}
</script>
