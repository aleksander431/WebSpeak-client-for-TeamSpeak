import { computed, nextTick, onScopeDispose, reactive, ref, watch, type Ref } from "vue";
import type { ChannelInfo, ChannelMember, ChatMessage } from "./useVoiceWebSocket.js";
import { loadChatHistory, normalizeChatHistoryServerKey, saveChatHistoryMessage } from "../services/local-persistence.js";
import { ChatFileError, fetchChatHistory, fetchChatPins, pastedFileName, uploadChatFile } from "../services/chat-files.js";
import type { ChatPin } from "../../../src/shared/chat-pins.js";
import { chatAttachmentMessage, formatBytes, type ChatHistoryMessage, type ChatSessionAccess } from "../../../src/shared/chat-storage.js";
import { CHAT_MESSAGE_MAX_BYTES, chatMessageBytes, chatPlainText, chatReplyPrefix, parseChatMarkup } from "../../../src/shared/chat-markup.js";
import type { ChatReaction } from "../../../src/shared/chat-reactions.js";

export interface ChatUpload {
  key: number;
  name: string;
  progress: number;
  error: string;
}

/** Same message from local and server history (or the live session) within this window is one message. */
const HISTORY_MATCH_WINDOW_MS = 120_000;

export type WebClientChatTab = "channel" | "server" | "private" | "events";

interface PrivateConversation {
  id: number;
  key: string;
  name: string;
  lastMessage: number;
}

interface UseWebClientChatOptions {
  messages: ChatMessage[];
  members: ChannelMember[];
  currentChannel: Readonly<Ref<ChannelInfo | undefined>>;
  currentChannelName: Readonly<Ref<string>>;
  selectedChannelId: Ref<string>;
  clientId: Readonly<Ref<number>>;
  connected: Readonly<Ref<boolean>>;
  sessionEpoch: Readonly<Ref<number>>;
  serverKey: Readonly<Ref<string>>;
  isMobileViewport: Readonly<Ref<boolean>>;
  mobileSection: Ref<"channels" | "chat" | "voice" | "more">;
  closeMemberMenu: () => void;
  sendTextMessage: (text: string, targetId?: string) => Promise<void>;
  sendServerMessage: (text: string) => Promise<void>;
  sendPrivateMessage: (clientId: number, text: string, conversationId?: string, expectedKey?: string) => Promise<void>;
  notifyPrivateMessage: () => void;
  t: (key: string, variables?: Record<string, string | number>) => string;
  /** Upload and server-history access of the current session. */
  chatAccess?: Readonly<Ref<ChatSessionAccess | null>>;
  /** Our own TeamSpeak identity, to recognise our messages in server history. */
  self?: Readonly<Ref<{ uid: string; nickname: string }>>;
  /** Reactions by message reference (the session's live map; history seeds it). */
  reactions?: Map<string, ChatReaction[]>;
  reactToChat?: (ref: string, emoji: string, active: boolean) => Promise<void>;
  /** Someone wrote @our-nickname in a channel or server message. */
  notifyMention?: () => void;
  /** Pinned messages by conversation ("channel:<id>", "server:"); live updates arrive from the gateway. */
  pins?: Map<string, ChatPin[]>;
  pinChat?: (ref: string, active: boolean) => Promise<void>;
}

export function useWebClientChat({
  messages,
  members,
  currentChannel,
  currentChannelName,
  selectedChannelId,
  clientId,
  connected,
  sessionEpoch,
  serverKey,
  isMobileViewport,
  mobileSection,
  closeMemberMenu,
  sendTextMessage,
  sendServerMessage,
  sendPrivateMessage,
  notifyPrivateMessage,
  t,
  chatAccess,
  self,
  reactions,
  reactToChat,
  notifyMention,
  pins,
  pinChat,
}: UseWebClientChatOptions) {
  const tab = ref<WebClientChatTab>("channel");
  const panelOpen = ref(!isMobileViewport.value);
  const privateClientId = ref(0);
  const privateConversationKey = ref("");
  const messageDraft = ref("");
  const listElement = ref<HTMLElement | null>(null);
  const sending = ref(false);
  const sendError = ref("");
  const drafts = new Map<string, string>();
  const pending = new Map<string, object>();
  const errors = new Map<string, string>();
  let disposed = false;
  let followingLatest = true;
  let scrollGeneration = 0;
  let historyGeneration = 0;
  const persistedMessageIds = new Set<string>();
  const memberKey = (member: ChannelMember) => member.uid ? `uid:${member.uid}` : `client:${JSON.stringify([member.id, member.nickname])}`;
  const recipient = computed(() => members.find(member => member.id === privateClientId.value && memberKey(member) === privateConversationKey.value));
  const destination = computed(() => `${sessionEpoch.value}:${tab.value}:${tab.value === "private" ? privateConversationKey.value : tab.value === "channel" ? currentChannel.value?.id ?? selectedChannelId.value : ""}`);
  const canSend = computed(() => connected.value && !sending.value && tab.value !== "events" && (tab.value !== "private" || Boolean(recipient.value)));
  const status = computed(() => sendError.value ? t(sendError.value) : sending.value ? t("chatSending")
    : !connected.value ? t("chatNotConnected") : tab.value === "private" && !recipient.value ? t("chatTargetUnavailable") : "");
  const messageKey = (message: ChatMessage) => {
    if (message.scope !== "private") return `legacy:${message.id}`;
    if (message.conversationKey?.startsWith("uid:")) return message.conversationKey;
    if (message.senderUid && !message.isSelf) return `uid:${message.senderUid}`;
    const id = Number(message.conversationId) || message.senderId || 0;
    const name = message.conversationName || (message.isSelf ? "" : message.invokerName);
    return id ? `client:${JSON.stringify([id, name])}` : `legacy:${message.id}`;
  };

  const conversations = computed<PrivateConversation[]>(() => {
    const byConversation = new Map<string, PrivateConversation>();
    for (const message of messages) {
      if (message.scope !== "private" || !message.conversationId) continue;
      const id = Number(message.conversationId);
      if (!id) continue;
      const key = messageKey(message);
      const member = members.find(candidate => memberKey(candidate) === key);
      const existing = byConversation.get(key);
      byConversation.set(key, {
        id: member?.id ?? id, key,
        name: member?.nickname ?? message.conversationName ?? existing?.name ?? (message.isSelf ? t("privateMessage") : message.invokerName),
        lastMessage: Math.max(existing?.lastMessage ?? 0, message.timestamp),
      });
    }
    // A newly opened private chat has no message from which to derive a tab.
    // Keep the selected recipient visible so the first message can be sent and
    // the empty state still has a named conversation.
    if (tab.value === "private" && privateConversationKey.value && privateClientId.value) {
      const selected = recipient.value;
      const existing = byConversation.get(privateConversationKey.value);
      byConversation.set(privateConversationKey.value, {
        id: selected?.id ?? existing?.id ?? privateClientId.value,
        key: privateConversationKey.value,
        name: selected?.nickname ?? existing?.name ?? t("privateMessage"),
        lastMessage: existing?.lastMessage ?? 0,
      });
    }
    return [...byConversation.values()].sort((left, right) => right.lastMessage - left.lastMessage);
  });

  const replyTo = ref<ChatMessage | null>(null);
  const searchOpen = ref(false);
  const searchQuery = ref("");
  const searching = ref(false);
  /** Names that `@Name` can mention: everyone the session can see. */
  const mentionNames = computed(() => [...new Set(members.map(member => member.nickname).filter(Boolean))]);
  const selfName = computed(() => self?.value.nickname ?? "");
  const draftBytes = computed(() => chatMessageBytes(composeText(messageDraft.value)));
  /** Too long for one TeamSpeak message: sent as a text file instead, when uploads are allowed. */
  const draftTooLong = computed(() => draftBytes.value > CHAT_MESSAGE_MAX_BYTES);
  function composeText(draft: string): string {
    const reply = replyTo.value;
    return reply && draft.trim() ? `${chatReplyPrefix(reply.isSelf ? selfName.value || reply.invokerName : reply.invokerName, reply.message)}${draft}` : draft;
  }

  const conversationMessages = computed(() => {
    if (tab.value === "server") return messages.filter((message) => message.scope === "server");
    if (tab.value === "private") return messages.filter(message => message.scope === "private" && messageKey(message) === privateConversationKey.value);
    if (tab.value !== "channel") return [];
    const channelId = currentChannel.value?.id || selectedChannelId.value;
    return messages.filter((message) => message.scope === "channel"
      && (!message.targetId || message.targetId === "0" || (channelId ? message.targetId === channelId : false)));
  });
  const normalizedQuery = computed(() => searchOpen.value ? searchQuery.value.trim().toLocaleLowerCase() : "");
  const visibleMessages = computed(() => {
    const query = normalizedQuery.value;
    if (!query) return conversationMessages.value;
    return conversationMessages.value.filter(message => message.invokerName.toLocaleLowerCase().includes(query)
      || chatPlainText(message.message).toLocaleLowerCase().includes(query));
  });

  function startReply(message: ChatMessage): void {
    if (disposed || tab.value === "events") return;
    replyTo.value = message;
  }
  function cancelReply(): void { replyTo.value = null; }

  function reactionsOf(message: ChatMessage): ChatReaction[] {
    return message.ref ? reactions?.get(message.ref) ?? [] : [];
  }
  function toggleReaction(message: ChatMessage, emoji: string): void {
    if (!message.ref || !reactToChat || !connected.value) return;
    const mine = reactionsOf(message).some(reaction => reaction.emoji === emoji && reaction.mine);
    void reactToChat(message.ref, emoji, !mine).catch(() => undefined);
  }

  // ---- Pinned messages ----
  const pinsKey = computed(() => tab.value === "server" ? "server:" : tab.value === "channel" ? `channel:${currentChannel.value?.id ?? selectedChannelId.value}` : "");
  const currentPins = computed<ChatPin[]>(() => (pinsKey.value && pins?.get(pinsKey.value)) || []);
  const canPin = computed(() => Boolean(pinChat) && connected.value && (tab.value === "channel" || tab.value === "server"));
  const pinsOpen = ref(false);
  function isPinned(message: ChatMessage): boolean {
    return Boolean(message.ref) && currentPins.value.some(pin => pin.ref === message.ref);
  }
  async function togglePin(message: ChatMessage): Promise<void> {
    if (!message.ref || !pinChat || !canPin.value) return;
    try {
      await pinChat(message.ref, !isPinned(message));
    } catch (error) {
      const code = (error as { code?: string } | null)?.code;
      sendError.value = code === "PIN_LIMIT" ? "chatPinLimit" : "chatPinFailed";
    }
  }
  async function unpin(ref: string): Promise<void> {
    if (!pinChat) return;
    try { await pinChat(ref, false); } catch { sendError.value = "chatPinFailed"; }
  }
  let pinsController: AbortController | null = null;
  async function loadPins(): Promise<void> {
    const access = chatAccess?.value;
    if (!access || !pins || !connected.value) return;
    pinsController?.abort();
    const controller = new AbortController();
    pinsController = controller;
    try {
      const results = await Promise.all([fetchChatPins(access, "channel", controller.signal), fetchChatPins(access, "server", controller.signal)]);
      if (disposed || pinsController !== controller || chatAccess?.value?.token !== access.token) return;
      for (const result of results) if (result) pins.set(result.key, result.pins);
    } catch { /* pins are optional */ }
  }
  watch(() => chatAccess?.value?.token, token => { if (token) void loadPins(); });
  watch(() => currentChannel.value?.id, (id, previous) => { if (id && previous !== undefined && id !== previous) void loadPins(); });
  watch(pinsKey, () => { pinsOpen.value = false; });
  onScopeDispose(() => pinsController?.abort());

  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  let searchController: AbortController | null = null;
  function toggleSearch(): void {
    searchOpen.value = !searchOpen.value;
    if (!searchOpen.value) { searchQuery.value = ""; searchController?.abort(); searching.value = false; }
  }
  // Older messages are looked up on the gateway too and merged into the conversation.
  watch([normalizedQuery, tab], ([query, currentTab]) => {
    clearTimeout(searchTimer);
    searchController?.abort();
    searching.value = false;
    const access = chatAccess?.value;
    if (query.length < 2 || !access?.historyEnabled || (currentTab !== "channel" && currentTab !== "server")) return;
    searching.value = true;
    searchTimer = setTimeout(async () => {
      const controller = new AbortController();
      searchController = controller;
      try {
        const found = await fetchChatHistory(access, currentTab, controller.signal, query);
        if (!disposed && searchController === controller) mergeServerHistory(found);
      } catch { /* the local results stay */ }
      finally { if (searchController === controller) searching.value = false; }
    }, 300);
  });
  onScopeDispose(() => { clearTimeout(searchTimer); searchController?.abort(); });

  const tabLabel = computed(() => tab.value === "channel" ? t("textChannel") : tab.value === "server" ? t("serverChat") : tab.value === "private" ? t("privateMessage") : t("eventLog"));
  const title = computed(() => tab.value === "channel"
    ? t("channelChat", { channel: currentChannelName.value })
    : tab.value === "server"
      ? t("serverChat")
      : tab.value === "events"
        ? t("eventLog")
        : recipient.value?.nickname ?? conversations.value.find(conversation => conversation.key === privateConversationKey.value)?.name ?? t("privateMessage"));
  const placeholder = computed(() => tab.value === "private" ? t("privateMessagePlaceholder") : tab.value === "server" ? t("serverMessagePlaceholder") : t("sendMessagePlaceholder"));

  function scrollToEnd(): void {
    const list = listElement.value;
    if (!disposed && list && (!isMobileViewport.value || mobileSection.value === "chat")) {
      followingLatest = true;
      list.scrollTo({ top: list.scrollHeight, behavior: "auto" });
    }
  }

  function onScroll(): void {
    const list = listElement.value;
    if (list && list.clientHeight > 0) followingLatest = list.scrollHeight - list.scrollTop - list.clientHeight < 48;
  }

  function scrollIfFollowing(): void {
    if (!followingLatest) return;
    const generation = scrollGeneration;
    void nextTick(() => {
      if (generation === scrollGeneration && followingLatest) scrollToEnd();
    });
  }

  function openPrivateChat(targetClientId: number): void {
    const member = members.find(candidate => candidate.id === targetClientId);
    if (!member || targetClientId === clientId.value) return;
    const key = memberKey(member);
    openConversation({ id: targetClientId, key, name: member.nickname, lastMessage: 0 });
  }

  function openConversation(conversation: PrivateConversation): void {
    if (disposed) return;
    panelOpen.value = true;
    privateClientId.value = conversation.id;
    privateConversationKey.value = conversation.key;
    tab.value = "private";
    if (isMobileViewport.value) mobileSection.value = "chat";
    closeMemberMenu();
    followingLatest = true;
    scrollIfFollowing();
  }

  function togglePanel(): void {
    panelOpen.value = !panelOpen.value;
  }

  function sendToCurrentDestination(text: string): Promise<void> {
    if (tab.value === "channel") return sendTextMessage(text, currentChannel.value?.id ?? selectedChannelId.value);
    if (tab.value === "server") return sendServerMessage(text);
    return sendPrivateMessage(privateClientId.value, text, String(privateClientId.value), privateConversationKey.value);
  }

  const uploads = reactive<ChatUpload[]>([]);
  let uploadSequence = 0;
  const uploadControllers = new Set<AbortController>();
  const canAttach = computed(() => canSend.value && Boolean(chatAccess?.value && chatAccess.value.maxFileBytes > 0));
  const maxFileBytes = computed(() => chatAccess?.value?.maxFileBytes ?? 0);

  function uploadErrorText(error: unknown): string {
    const code = error instanceof ChatFileError ? error.code : "UPLOAD_FAILED";
    if (code === "FILE_TOO_LARGE") {
      const limit = error instanceof ChatFileError && error.maxFileBytes ? error.maxFileBytes : maxFileBytes.value;
      return limit ? t("chatFileTooLarge", { size: formatBytes(limit) }) : t("chatFileTooLargeProxy");
    }
    if (code === "CHAT_UPLOADS_DISABLED") return t("chatUploadsDisabled");
    if (code === "FILE_EMPTY") return t("chatFileEmpty");
    if (code === "CHAT_SESSION_REQUIRED") return t("chatNotConnected");
    if (code === "RATE_LIMITED") return t("chatUploadRateLimited");
    return t("chatUploadFailed");
  }

  function dismissUpload(key: number): void {
    const index = uploads.findIndex(upload => upload.key === key);
    if (index >= 0) uploads.splice(index, 1);
  }

  /**
   * Upload files and share each as a chat message to the open conversation.
   * The destination is captured first, so switching tabs mid-upload cannot
   * send the link somewhere else.
   */
  async function sendFiles(files: readonly File[]): Promise<void> {
    const access = chatAccess?.value;
    if (disposed || !files.length || tab.value === "events") return;
    if (!connected.value || !access) { sendError.value = "chatNotConnected"; return; }
    if (tab.value === "private" && !recipient.value) { sendError.value = "chatTargetUnavailable"; return; }
    const key = destination.value;
    const send = (text: string) => sendToCurrentDestination(text);
    const target = { tab: tab.value, channelId: currentChannel.value?.id ?? selectedChannelId.value, clientId: privateClientId.value, conversationKey: privateConversationKey.value };
    const sendCaptured = (text: string) => destination.value === key ? send(text)
      : target.tab === "channel" ? sendTextMessage(text, target.channelId)
        : target.tab === "server" ? sendServerMessage(text)
          : sendPrivateMessage(target.clientId, text, String(target.clientId), target.conversationKey);
    for (const file of files) {
      const name = pastedFileName(file);
      const upload: ChatUpload = reactive({ key: ++uploadSequence, name, progress: 0, error: "" });
      uploads.push(upload);
      const controller = new AbortController();
      uploadControllers.add(controller);
      try {
        const info = await uploadChatFile(file, name, access, fraction => { upload.progress = fraction; }, controller.signal);
        if (disposed || chatAccess?.value?.token !== access.token) return;
        await sendCaptured(chatAttachmentMessage(location.origin, info));
        dismissUpload(upload.key);
      } catch (error) {
        if (disposed) return;
        if (error instanceof ChatFileError && error.code === "UPLOAD_CANCELLED") dismissUpload(upload.key);
        else upload.error = error instanceof ChatFileError ? uploadErrorText(error) : t("chatSendFailed");
      } finally {
        uploadControllers.delete(controller);
      }
    }
  }

  function cancelUploads(): void {
    for (const controller of uploadControllers) controller.abort();
    uploadControllers.clear();
    uploads.splice(0, uploads.length);
  }

  async function submitMessage(): Promise<void> {
    if (disposed || sending.value || !messageDraft.value.trim() || tab.value === "events") return;
    if (!connected.value) { sendError.value = "chatNotConnected"; return; }
    if (tab.value === "private" && !recipient.value) { sendError.value = "chatTargetUnavailable"; return; }
    const draft = messageDraft.value;
    const text = composeText(draft);
    if (chatMessageBytes(text) > CHAT_MESSAGE_MAX_BYTES) {
      if (!canAttach.value) { sendError.value = "chatMessageTooLong"; return; }
      // A long paste (a log, a whole file) goes as a text attachment.
      messageDraft.value = "";
      replyTo.value = null;
      await sendFiles([new File([draft], longMessageFileName(draft), { type: "text/plain" })]);
      return;
    }
    const key = destination.value;
    const operation = {};
    pending.set(key, operation);
    errors.delete(key);
    const isCurrent = () => !disposed && pending.get(key) === operation;
    sending.value = true;
    sendError.value = "";
    try {
      await sendToCurrentDestination(text);
      if (isCurrent()) {
        if (destination.value === key && messageDraft.value === draft) { messageDraft.value = ""; replyTo.value = null; }
        else if (drafts.get(key) === draft) drafts.set(key, "");
      }
    } catch (error) {
      if (isCurrent()) {
        const code = (error as { code?: string } | null)?.code;
        const feedback = code === "CLIENT_NOT_FOUND" ? "chatTargetUnavailable" : code === "CHANNEL_CHANGED" ? "chatChannelChanged" : "chatSendFailed";
        errors.set(key, feedback);
        if (destination.value === key) sendError.value = feedback;
      }
    } finally {
      if (isCurrent()) {
        pending.delete(key);
        if (destination.value === key) sending.value = false;
      }
    }
  }

  watch(destination, (next, previous) => {
    scrollGeneration++;
    followingLatest = true;
    scrollIfFollowing();
    drafts.set(previous, messageDraft.value);
    messageDraft.value = drafts.get(next) ?? "";
    replyTo.value = null;
    sending.value = pending.has(next);
    sendError.value = errors.get(next) ?? "";
  }, { flush: "sync" });
  watch(isMobileViewport, (mobile) => {
    panelOpen.value = !mobile;
  }, { flush: "sync" });
  watch(sessionEpoch, () => {
    historyGeneration++;
    persistedMessageIds.clear();
    drafts.clear();
    pending.clear();
    errors.clear();
    privateClientId.value = 0;
    privateConversationKey.value = "";
    tab.value = "channel";
    panelOpen.value = !isMobileViewport.value;
    messageDraft.value = "";
    replyTo.value = null;
    searchOpen.value = false;
    searchQuery.value = "";
    drafts.clear();
    sending.value = false;
    sendError.value = "";
    cancelUploads();
  }, { flush: "sync" });
  onScopeDispose(() => { disposed = true; cancelUploads(); drafts.clear(); pending.clear(); errors.clear(); sending.value = false; });

  watch([connected, sessionEpoch, serverKey], async ([isConnected, _epoch, target]) => {
    const generation = ++historyGeneration;
    persistedMessageIds.clear();
    if (!isConnected || !target) return;
    const normalizedKey = normalizeChatHistoryServerKey(target);
    const history = await loadChatHistory(normalizedKey);
    if (disposed || generation !== historyGeneration || !connected.value || normalizeChatHistoryServerKey(serverKey.value) !== normalizedKey) return;
    const existingIds = new Set(messages.map(message => message.id));
    const additions = history.filter(message => !existingIds.has(message.id) && !alreadyShown(message));
    if (additions.length) messages.splice(0, messages.length, ...[...messages, ...additions].sort((left, right) => left.timestamp - right.timestamp));
    for (const message of messages) if (!message.isHistory) persistedMessageIds.add(message.id);
  }, { immediate: true });

  /** Is this history entry already shown (live, or from browser-local history)? */
  function alreadyShown(candidate: ChatMessage): boolean {
    return messages.some(message => message.scope === candidate.scope
      && (candidate.scope !== "channel" || (message.targetId ?? "") === (candidate.targetId ?? ""))
      && message.message === candidate.message
      && (message.isSelf ? candidate.isSelf : message.invokerName === candidate.invokerName)
      && Math.abs(message.timestamp - candidate.timestamp) < HISTORY_MATCH_WINDOW_MS);
  }

  function mergeServerHistory(entries: readonly ChatHistoryMessage[]): void {
    const me = self?.value;
    const additions: ChatMessage[] = [];
    for (const entry of entries) {
      const isSelf = Boolean(me && ((entry.senderUid && entry.senderUid === me.uid) || (!entry.senderUid && entry.senderName === me.nickname)));
      const candidate: ChatMessage = {
        id: `server-history-${entry.scope}-${entry.id}`, scope: entry.scope,
        ...(entry.scope === "channel" && entry.channelId ? { targetId: entry.channelId } : {}),
        ...(entry.senderUid ? { senderUid: entry.senderUid } : {}),
        invokerName: entry.senderName || "Unknown", message: entry.message, timestamp: entry.timestamp, isSelf, isHistory: true,
        ...(entry.ref ? { ref: entry.ref } : {}),
      };
      if (entry.ref && entry.reactions?.length && reactions && !reactions.has(entry.ref)) reactions.set(entry.ref, entry.reactions);
      if (entry.ref) {
        // A live message the gateway referenced later than our copy: adopt its reference.
        const shown = messages.find(message => !message.ref && message.scope === candidate.scope && message.message === candidate.message
          && Math.abs(message.timestamp - candidate.timestamp) < HISTORY_MATCH_WINDOW_MS && (message.isSelf ? isSelf : message.invokerName === candidate.invokerName));
        if (shown) shown.ref = entry.ref;
      }
      if (messages.some(message => message.id === candidate.id) || alreadyShown(candidate)) continue;
      additions.push(candidate);
    }
    if (additions.length) messages.splice(0, messages.length, ...[...messages, ...additions].sort((left, right) => left.timestamp - right.timestamp));
  }

  let serverHistoryGeneration = 0;
  let serverHistoryController: AbortController | null = null;
  async function loadServerHistory(scopes: ("channel" | "server")[]): Promise<void> {
    const access = chatAccess?.value;
    if (!access?.historyEnabled || !connected.value) return;
    serverHistoryController?.abort();
    const controller = new AbortController();
    serverHistoryController = controller;
    const generation = ++serverHistoryGeneration;
    try {
      for (const scope of scopes) {
        const entries = await fetchChatHistory(access, scope, controller.signal);
        if (disposed || generation !== serverHistoryGeneration || chatAccess?.value?.token !== access.token) return;
        mergeServerHistory(entries);
      }
    } catch { /* history is optional */ }
  }
  // The token arrives with each connection; the channel decides which history applies.
  watch(() => chatAccess?.value?.token, token => { if (token) void loadServerHistory(["channel", "server"]); });
  watch(() => currentChannel.value?.id, (id, previous) => { if (id && previous !== undefined && id !== previous) void loadServerHistory(["channel"]); });
  onScopeDispose(() => serverHistoryController?.abort());

  watch(() => messages.length, () => {
    if (!connected.value || !serverKey.value) return;
    const key = normalizeChatHistoryServerKey(serverKey.value);
    for (const message of messages) {
      if (message.isHistory || message.scope === "system" || persistedMessageIds.has(message.id)) continue;
      persistedMessageIds.add(message.id);
      void saveChatHistoryMessage(key, message);
    }
  }, { flush: "sync" });

  watch(() => visibleMessages.value.at(-1)?.id, () => {
    if (visibleMessages.value.at(-1)?.isSelf) followingLatest = true;
    scrollIfFollowing();
  });
  watch(mobileSection, (section) => { if (section === "chat") scrollIfFollowing(); });
  watch(() => messages.length, (length, previousLength) => {
    const latest = messages[length - 1];
    if (latest && length > previousLength && latest.scope === "private" && !latest.isSelf) notifyPrivateMessage();
    else if (latest && length > previousLength && !latest.isSelf && !latest.isHistory && (latest.scope === "channel" || latest.scope === "server")
      && selfName.value && parseChatMarkup(latest.message, { mentionNames: [selfName.value], selfName: selfName.value }).mentionsSelf) notifyMention?.();
  });

  return {
    tab,
    panelOpen,
    togglePanel,
    privateClientId,
    privateConversationKey,
    sending, sendError, canSend, status,
    messageDraft,
    listElement,
    conversations,
    visibleMessages,
    tabLabel,
    title,
    placeholder,
    openPrivateChat,
    openConversation,
    submitMessage,
    uploads,
    canAttach,
    maxFileBytes,
    sendFiles,
    dismissUpload,
    scrollToEnd,
    onScroll,
    scrollIfFollowing,
    replyTo, startReply, cancelReply,
    reactionsOf, toggleReaction, canReact: computed(() => Boolean(reactToChat) && connected.value),
    searchOpen, searchQuery, searching, toggleSearch,
    currentPins, canPin, pinsOpen, isPinned, togglePin, unpin,
    mentionNames, selfName, draftBytes, draftTooLong,
  };
}

/** A file name for a message too long to send: the code block's language decides the extension. */
function longMessageFileName(text: string): string {
  const language = /^```([A-Za-z0-9_+#.-]{1,24})/m.exec(text)?.[1]?.toLowerCase() ?? "";
  const extensions: Record<string, string> = { js: "js", javascript: "js", ts: "ts", typescript: "ts", py: "py", python: "py",
    json: "json", sh: "sh", bash: "sh", c: "c", cpp: "cpp", cs: "cs", csharp: "cs", java: "java", go: "go", rust: "rs", rs: "rs",
    sql: "sql", yaml: "yaml", yml: "yaml", html: "html", css: "css", xml: "xml", lua: "lua", php: "php", kotlin: "kt", log: "log", diff: "diff" };
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `message-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}.${extensions[language] ?? "txt"}`;
}
