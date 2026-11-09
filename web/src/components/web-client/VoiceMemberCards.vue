<template>
  <TransitionGroup
    v-if="currentMembers.length"
    name="ws-voice-member"
    tag="div"
    appear
    class="voice-grid"
    data-ws-part="voice.members"
  >
    <article
      v-for="member in currentMembers"
      :key="member.id"
      :class="['voice-card', { speaking: isSpeaking(member), self: member.isSelf }]"
      data-ws-part="voice.member"
      :data-ws-state="member.isSelf ? 'self' : isSpeaking(member) ? 'speaking' : 'connected'"
      :data-ws-member-id="member.id"
      :data-ws-speaking="isSpeaking(member) ? 'true' : 'false'"
      :data-ws-self="member.isSelf ? 'true' : 'false'"
      @contextmenu="handleMemberContextMenu(member, $event)"
    >
      <button
        v-if="!member.isSelf && (isMobileViewport || showMemberActions)"
        type="button"
        class="voice-member-action"
        data-ws-part="voice.member.action-trigger"
        :data-ws-member-actions="showMemberActions ? 'enabled' : undefined"
        :aria-label="t('moreMemberOptions')"
        :title="t('moreMemberOptions')"
        @click.stop="emit('memberActions', member, $event)"
        ><Icon
          name="more"
          :size="17"
      /></button>
      <div
        :class="[
          'voice-avatar-wrap',
          { 'screen-share-avatar-wrap': screenShareStreamForMember(member), 'camera-avatar-wrap': cameraFor(member) },
        ]"
        data-ws-part="voice.member.avatar-wrap"
      >
        <div
          :class="['voice-avatar', { speaking: isSpeaking(member) }]"
          data-ws-part="voice.member.avatar"
          :style="avatarStyle(member.nickname, member.isSelf, member.avatar)"
          >{{ member.avatar ? "" : avatarInitial(member.nickname)
          }}<button
            v-if="member.isSelf && editAvatar"
            type="button"
            class="voice-avatar-edit"
            data-ws-part="voice.member.avatar-edit"
            :aria-label="t('avatarChange')"
            :title="t('avatarChange')"
            @click.stop="emit('editAvatar')"
            ><Icon
              name="camera"
              :size="18" /></button
        ></div>
        <video
          v-if="cameraFor(member)"
          :ref="(element) => bindCamera(element, member)"
          :class="['member-camera', { mirrored: member.isSelf }]"
          data-ws-part="voice.member.camera"
          muted
          autoplay
          playsinline
          disablepictureinpicture
          role="button"
          tabindex="0"
          :aria-label="t('cameraEnlarge')"
          :title="t('cameraEnlarge')"
          @click.stop="toggleCameraFullscreen"
          @keydown.enter.prevent="toggleCameraFullscreen"
          @keydown.space.prevent="toggleCameraFullscreen"
        ></video>
        <video
          v-else-if="member.isSelf && selfPreviewStream && selfPreviewVisible"
          :ref="bindSelfPreview"
          class="screen-share-self-preview"
          data-ws-part="voice.member.self-preview"
          muted
          autoplay
          playsinline
          disablepictureinpicture
          :aria-label="t('screenSharePreview')"
        ></video>
        <span
          v-if="member.inputMuted"
          class="voice-muted-indicator"
          data-ws-part="voice.member.mic-status"
          data-ws-state="muted"
          role="img"
          :aria-label="t('inputMuted')"
          :title="t('inputMuted')"
          ><Icon name="mic-off" :size="14" /></span
        >
        <span
          v-if="screenShareStreamForMember(member)"
          class="screen-share-live-indicator"
          data-ws-part="voice.member.live-indicator"
          ><span
            class="screen-share-wave"
            aria-hidden="true"
            ><i
              v-for="bar in screenShareIndicatorBars"
              :key="bar"
              :style="{ height: `${bar}px` }"
            ></i></span
          ><span>{{ t("sharingScreen") }}</span
          ><span
            v-if="viewerCountFor(member) !== null"
            class="screen-share-viewer-count"
            data-ws-part="voice.member.viewers"
            :title="viewerTitleFor(member)"
            :aria-label="viewerTitleFor(member)"
            ><Icon
              name="eye"
              :size="12"
            />{{ viewerCountFor(member) }}</span
          ></span
        >
        <button
          v-if="screenShareStatusEnabled && member.isSelf && screenShareActive && selfPreviewStream"
          type="button"
          class="screen-share-stop-button screen-share-preview-toggle"
          data-ws-part="voice.member.preview-toggle"
          :aria-pressed="selfPreviewVisible"
          :aria-label="selfPreviewVisible ? t('screenSharePreviewHide') : t('screenSharePreviewShow')"
          :title="selfPreviewVisible ? t('screenSharePreviewHide') : t('screenSharePreviewShow')"
          @click.stop="toggleSelfPreview"
          ><Icon
            :name="selfPreviewVisible ? 'eye-off' : 'eye'"
            :size="13"
        /></button>
        <button
          v-if="screenShareStatusEnabled && member.isSelf && screenShareActive"
          type="button"
          class="screen-share-stop-button screen-share-live-settings-button"
          data-ws-part="voice.member.share-settings"
          :aria-label="t('screenShareSettings')"
          :aria-expanded="screenShareSettingsOpen"
          :title="t('screenShareSettings')"
          @click.stop="toggleScreenShareSettings"
          ><Icon
            name="settings"
            :size="13"
        /></button>
        <button
          v-if="screenShareStatusEnabled && member.isSelf && (screenShareActive || screenShareStarting)"
          type="button"
          class="screen-share-stop-button"
          data-ws-part="voice.member.stop-share"
          :aria-label="t('stopScreenShare')"
          :title="t('stopScreenShare')"
          @click.stop="emit('stopShare')"
          ><Icon
            name="close"
            :size="14"
        /></button>
      </div>
      <strong data-ws-part="voice.member.name">{{
        member.isSelf ? t("you") : member.nickname
      }}</strong
      ><span data-ws-part="voice.member.status">{{
        isSpeaking(member) ? t("speaking") : member.isSelf ? t("connectedYou") : t("connected")
      }}</span>
      <div
        v-if="screenShareStreamForMember(member) || (member.isSelf && (screenShareStatusEnabled || cameraEnabled))"
        class="screen-share-card-actions"
        data-ws-part="voice.member.share-actions"
      >
        <template v-if="member.isSelf && !screenShareActive && !screenShareStarting">
          <div class="screen-share-start-actions">
            <button
              type="button"
              class="screen-share-card-button"
              @click.stop="startScreenShareWithSettings"
              ><Icon
                name="monitor"
                :size="13"
              />
              {{ t("startScreenShare") }}</button
            >
            <button
              type="button"
              class="screen-share-settings-button"
              :aria-label="t('screenShareSettings')"
              :aria-expanded="screenShareSettingsOpen"
              :title="t('screenShareSettings')"
              @click.stop="toggleScreenShareSettings"
              ><Icon
                name="settings"
                :size="13"
            /></button>
            <button
              v-if="cameraEnabled"
              type="button"
              :class="['screen-share-settings-button', 'camera-toggle-button', { active: cameraOn }]"
              data-ws-part="voice.member.camera-toggle"
              :data-ws-state="cameraOn ? 'active' : 'idle'"
              :aria-pressed="cameraOn"
              :aria-label="cameraOn ? t('cameraStop') : t('cameraStart')"
              :title="cameraOn ? t('cameraStop') : t('cameraStart')"
              @click.stop="camera?.toggleCamera()"
              ><Icon
                :name="cameraOn ? 'video-off' : 'video'"
                :size="13"
            /></button>
          </div>
        </template>
        <button
          v-else-if="member.isSelf && cameraEnabled"
          type="button"
          :class="['screen-share-settings-button', 'camera-toggle-button', { active: cameraOn }]"
          data-ws-part="voice.member.camera-toggle"
          :data-ws-state="cameraOn ? 'active' : 'idle'"
          :aria-pressed="cameraOn"
          :aria-label="cameraOn ? t('cameraStop') : t('cameraStart')"
          :title="cameraOn ? t('cameraStop') : t('cameraStart')"
          @click.stop="camera?.toggleCamera()"
          ><Icon
            :name="cameraOn ? 'video-off' : 'video'"
            :size="13"
        /></button>
        <button
          v-else-if="!member.isSelf"
          type="button"
          :class="[
            'screen-share-card-button',
            {
              viewing: isWatchingMember(member),
            },
          ]"
          :data-ws-state="isWatchingMember(member) ? 'viewing' : 'idle'"
          @click.stop="toggleScreenShareForMember(member)"
          ><Icon
            name="monitor"
            :size="13"
          />
          {{ isWatchingMember(member) ? t("watching") : t("watchScreenShare") }}</button
        >
      </div>
    </article>
  </TransitionGroup>
  <div
    v-else
    class="voice-empty"
    data-ws-part="voice.members.empty"
    ><span class="empty-icon"
      ><Icon
        name="users"
        :size="20" /></span
    ><strong>{{ t("waitingForMembers") }}</strong
    ><span>{{ t("prepareMicrophone") }}</span></div
  >
</template>

<script setup lang="ts">
import Icon from "../Icon.vue";
import { computed, ref } from "vue";
import type { ChannelMember, useVoiceWebSocket } from "../../composables/useVoiceWebSocket.js";
import type { useWebClientScreenShare } from "../../composables/useWebClientScreenShare.js";
const props = withDefaults(defineProps<{
  currentMembers: ChannelMember[]; isMobileViewport: boolean; showMemberActions?: boolean;
  showScreenShare?: boolean;
  sharing?: Pick<ReturnType<typeof useVoiceWebSocket>, "screenShareActive" | "screenShareStarting" | "screenShareViewingStreamId"> & Partial<Pick<ReturnType<typeof useVoiceWebSocket>, "screenShareViewedStreamIds" | "screenSharePreviewStream">> & Pick<ReturnType<typeof useWebClientScreenShare>, "settingsOpen">;
  controls?: Pick<ReturnType<typeof useWebClientScreenShare>, "streamForMember" | "toggleForMember" | "startWithSettings">;
  isSpeaking: (member: ChannelMember) => boolean;
  avatarStyle: (name: string, isSelf?: boolean, avatar?: string) => Record<string, string>;
  avatarInitial: (name: string) => string; t: (key: string) => string;
  /** Show the "change avatar" button on one's own card. */
  editAvatar?: boolean;
  /** Cameras: pictures by TeamSpeak client id and one's own toggle. */
  camera?: Pick<ReturnType<typeof useVoiceWebSocket>, "cameraActive" | "cameraStarting" | "cameraMedia" | "cameraSupported"> & { toggleCamera: () => void };
}>(), { showScreenShare: true, editAvatar: false });
// Phones toggle the camera from the room's control bar; the card stays uncluttered.
const cameraEnabled = computed(() => Boolean(props.camera?.cameraSupported) && !props.isMobileViewport);
const cameraOn = computed(() => Boolean(props.camera && (props.camera.cameraActive.value || props.camera.cameraStarting.value)));
const cameraFor = (member: ChannelMember): MediaStream | null => props.camera?.cameraMedia.value.get(member.id) ?? null;
function bindCamera(element: unknown, member: ChannelMember): void {
  if (!(element instanceof HTMLVideoElement)) return;
  const stream = cameraFor(member);
  if (element.srcObject !== stream) element.srcObject = stream;
  if (stream && element.paused) void element.play().catch(() => { /* muted autoplay may still be refused */ });
}
/** A camera opens full screen on click, and closes the same way. */
function toggleCameraFullscreen(event: Event): void {
  const video = event.currentTarget;
  if (!(video instanceof HTMLVideoElement)) return;
  if (document.fullscreenElement === video) void document.exitFullscreen().catch(() => {});
  else void video.requestFullscreen?.().catch(() => {});
}
const screenShareControlsEnabled = computed(() => props.showScreenShare !== false && Boolean(props.controls));
const screenShareStatusEnabled = computed(() => screenShareControlsEnabled.value && Boolean(props.sharing));
const screenShareActive = computed(() => screenShareStatusEnabled.value && Boolean(props.sharing?.screenShareActive.value));
const screenShareStarting = computed(() => screenShareStatusEnabled.value && Boolean(props.sharing?.screenShareStarting.value));
const screenShareViewingStreamId = computed(() => screenShareStatusEnabled.value ? props.sharing?.screenShareViewingStreamId.value ?? null : null);
const screenShareSettingsOpen = computed(() => screenShareStatusEnabled.value && Boolean(props.sharing?.settingsOpen.value));
/** Is this member's stream one of those being watched (not only the big one)? */
const isWatchingMember = (member: ChannelMember): boolean => {
  const streamId = screenShareStreamForMember(member)?.streamId;
  if (!streamId || !screenShareStatusEnabled.value) return false;
  const watched = props.sharing?.screenShareViewedStreamIds?.value;
  return watched ? watched.includes(streamId) : screenShareViewingStreamId.value === streamId;
};
const screenShareStreamForMember = (member: ChannelMember) => screenShareControlsEnabled.value ? props.controls?.streamForMember(member) ?? null : null;
const toggleScreenShareForMember = (member: ChannelMember) => { if (screenShareControlsEnabled.value) props.controls?.toggleForMember(member); };
const startScreenShareWithSettings = () => { if (screenShareStatusEnabled.value) void props.controls?.startWithSettings(); };
function toggleScreenShareSettings() {
  if (!screenShareStatusEnabled.value || !props.sharing) return;
  props.sharing.settingsOpen.value = !props.sharing.settingsOpen.value;
}
/** The sharer's own picture on their card; hidden on request (remembered per browser). */
const SELF_PREVIEW_KEY = "webspeak:screen-share-self-preview";
const selfPreviewVisible = ref((() => { try { return localStorage.getItem(SELF_PREVIEW_KEY) !== "off"; } catch { return true; } })());
const selfPreviewStream = computed(() => screenShareActive.value ? props.sharing?.screenSharePreviewStream?.value ?? null : null);
function toggleSelfPreview(): void {
  selfPreviewVisible.value = !selfPreviewVisible.value;
  try { localStorage.setItem(SELF_PREVIEW_KEY, selfPreviewVisible.value ? "on" : "off"); } catch { /* per-session only */ }
}
function bindSelfPreview(element: unknown): void {
  if (!(element instanceof HTMLVideoElement)) return;
  const stream = selfPreviewStream.value;
  if (element.srcObject !== stream) element.srcObject = stream;
  if (stream && element.paused) void element.play().catch(() => { /* muted autoplay may still be refused */ });
}
/** How many watch a member's stream (null when not known). */
function viewerCountFor(member: ChannelMember): number | null {
  const stream = screenShareStreamForMember(member);
  if (!stream) return null;
  const count = typeof stream.viewerCount === "number" ? stream.viewerCount : stream.viewers?.length;
  return typeof count === "number" ? Math.max(0, count) : null;
}
function viewerTitleFor(member: ChannelMember): string {
  const stream = screenShareStreamForMember(member);
  const names = (stream?.viewers ?? []).map(viewer => viewer.nickname).filter(Boolean);
  const count = viewerCountFor(member) ?? 0;
  if (!count) return props.t("screenShareNoViewers");
  return names.length ? `${props.t("screenShareViewers")}: ${names.join(", ")}` : props.t("screenShareViewers");
}
const emit = defineEmits<{ memberActions: [member: ChannelMember, event: MouseEvent]; stopShare: []; editAvatar: [] }>();
const screenShareIndicatorBars = [5, 10, 7, 12, 8, 10];

function handleMemberContextMenu(member: ChannelMember, event: MouseEvent): void {
  if (!props.showMemberActions || member.isSelf) return;
  event.preventDefault();
  event.stopPropagation();
  emit("memberActions", member, event);
}
</script>

<style scoped>
/* One's own avatar: a camera over it on hover opens the avatar dialog. */
/* Inside the avatar circle, so it follows each theme's avatar size. */
.voice-avatar:has(> .voice-avatar-edit) {
  position: relative;
}
.voice-avatar-edit {
  position: absolute;
  z-index: 3;
  inset: 0;
  display: grid;
  place-items: center;
  width: 100%;
  height: 100%;
  padding: 0;
  border: 0;
  border-radius: 50%;
  color: #fff;
  background: rgb(0 0 0 / 52%);
  opacity: 0;
  cursor: pointer;
  transition: opacity .15s;
}
/* The camera replaces the initial while it shows. */
.voice-avatar:has(> .voice-avatar-edit):hover {
  color: transparent !important;
  text-shadow: none !important;
}
.voice-avatar:hover > .voice-avatar-edit,
.voice-avatar-edit:focus-visible {
  opacity: 1;
}
@media (hover: none) {
  /* Touch screens: a small badge in the corner instead of a hover overlay. */
  .voice-avatar-edit {
    top: auto;
    left: auto;
    right: -4px;
    bottom: -4px;
    width: 26px;
    height: 26px;
    opacity: 1;
    border: 2px solid var(--surface-1, #fff);
    background: var(--accent, #2f8f6f);
  }
  .voice-avatar-edit :deep(svg) { width: 13px; height: 13px; }
}
/* A camera replaces the avatar like the sharer's own preview; one's own is mirrored. */
.voice-avatar-wrap:has(> .member-camera) {
  width: 100%;
  aspect-ratio: 16 / 9;
}
.voice-avatar-wrap:has(> .member-camera) > .voice-avatar {
  visibility: hidden;
}
.member-camera {
  position: absolute;
  z-index: 1;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: inherit;
  background: #000;
  cursor: zoom-in;
}
.member-camera.mirrored {
  transform: scaleX(-1);
}
.member-camera:fullscreen {
  object-fit: contain;
  border-radius: 0;
  cursor: zoom-out;
}
.camera-toggle-button.active {
  color: #fff;
  border-color: var(--accent, #2f8f6f);
  background: var(--accent, #2f8f6f);
}
/* The sharer's own picture replaces the avatar, under the badges and buttons. */
.voice-avatar-wrap:has(> .screen-share-self-preview) {
  width: 100%;
  aspect-ratio: 16 / 9;
}
.voice-avatar-wrap:has(> .screen-share-self-preview) > .voice-avatar {
  visibility: hidden;
}
.screen-share-self-preview {
  position: absolute;
  z-index: 1;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
  border-radius: inherit;
  background: #000;
  pointer-events: none;
}
.screen-share-stop-button.screen-share-preview-toggle {
  top: -5px;
  right: -5px;
  bottom: auto;
  left: auto;
  color: var(--text-muted, #8b8f98);
}
.screen-share-stop-button.screen-share-preview-toggle:hover {
  color: #fff;
  border-color: var(--accent, #2f8f6f);
  background: var(--accent, #2f8f6f);
}
.screen-share-viewer-count {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  margin-left: 6px;
  padding-left: 7px;
  border-left: 1px solid currentColor;
  font-variant-numeric: tabular-nums;
  pointer-events: auto;
  cursor: default;
}
.screen-share-viewer-count :deep(svg) { flex: none; }
.voice-muted-indicator {
  position: absolute;
  z-index: 4;
  top: 8px;
  right: 8px;
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border: 1px solid #ffffff18;
  border-radius: 5px;
  color: #f0f0f2;
  background: #17181bd9;
  pointer-events: none;
}

.voice-card:has(.voice-member-action) .voice-muted-indicator {
  right: 50px;
}
</style>
