<template>
  <div
    class="screen-share-gallery"
    data-ws-part="voice.screen-gallery"
    :data-layout="several ? layout : 'single'"
    :data-count="views.length"
  >
    <div
      v-if="several"
      class="screen-share-gallery-bar"
      data-ws-part="voice.screen-gallery.bar"
      ><span class="screen-share-gallery-title"
        ><Icon
          name="monitor"
          :size="14" />
        {{ t("screenShareWatchingCount") }} · {{ views.length }}</span
      ><span
        class="screen-share-gallery-layouts"
        role="group"
        :aria-label="t('screenShareLayout')"
        ><button
          type="button"
          data-ws-part="voice.screen-gallery.layout-focus"
          :class="{ active: layout === 'focus' }"
          :aria-pressed="layout === 'focus'"
          :title="t('screenShareLayoutFocus')"
          @click="setLayout('focus')"
          ><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="11" rx="2" /><rect x="3" y="17.5" width="5" height="3" rx="1" /><rect x="9.5" y="17.5" width="5" height="3" rx="1" /><rect x="16" y="17.5" width="5" height="3" rx="1" /></svg
          ><span>{{ t("screenShareLayoutFocus") }}</span></button
        ><button
          type="button"
          data-ws-part="voice.screen-gallery.layout-grid"
          :class="{ active: layout === 'grid' }"
          :aria-pressed="layout === 'grid'"
          :title="t('screenShareLayoutGrid')"
          @click="setLayout('grid')"
          ><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="8" height="7" rx="1.5" /><rect x="13" y="4" width="8" height="7" rx="1.5" /><rect x="3" y="13" width="8" height="7" rx="1.5" /><rect x="13" y="13" width="8" height="7" rx="1.5" /></svg
          ><span>{{ t("screenShareLayoutGrid") }}</span></button
        ></span
      ></div
    >
    <div class="screen-share-gallery-items">
      <ScreenSharePlayer
        :model="model"
        :screen-share-remote-stream="remoteStream"
        :screen-share-remote-volume="remoteVolume"
        :screen-share-error="error"
        :leave-screen-share="() => leave()"
        :avatar-initial="avatarInitial"
        :t="t"
      />
      <div
        v-if="others.length"
        class="screen-share-tiles"
        data-ws-part="voice.screen-gallery.tiles"
      >
        <div
          v-for="view in others"
          :key="view.streamId"
          class="screen-share-tile"
          data-ws-part="voice.screen-gallery.tile"
          role="button"
          tabindex="0"
          :aria-label="`${t('screenShareShowLarge')}: ${ownerOf(view.streamId)}`"
          :title="t('screenShareShowLarge')"
          @click="focus(view.streamId)"
          @keydown.enter.prevent="focus(view.streamId)"
          @keydown.space.prevent="focus(view.streamId)"
        >
          <video
            v-if="view.media"
            :ref="(element) => bindVideo(element, view.streamId, view.media)"
            class="screen-share-tile-video"
            autoplay
            playsinline
            :muted="!audible.has(view.streamId)"
          ></video>
          <span
            v-else
            class="screen-share-tile-placeholder"
            ><Icon
              name="monitor"
              :size="20"
          /></span>
          <span class="screen-share-tile-name">{{ ownerOf(view.streamId) }}</span>
          <span class="screen-share-tile-actions"
            ><button
              v-if="streamHasAudio(view.streamId)"
              type="button"
              data-ws-part="voice.screen-gallery.tile-audio"
              :aria-pressed="audible.has(view.streamId)"
              :aria-label="audible.has(view.streamId) ? t('screenShareTileMute') : t('screenShareTileUnmute')"
              :title="audible.has(view.streamId) ? t('screenShareTileMute') : t('screenShareTileUnmute')"
              @click.stop="toggleAudio(view.streamId)"
              @keydown.stop
              ><Icon
                :name="audible.has(view.streamId) ? 'volume' : 'volume-off'"
                :size="15" /></button
            ><button
              type="button"
              data-ws-part="voice.screen-gallery.tile-close"
              :aria-label="t('screenShareExit')"
              :title="t('screenShareExit')"
              @click.stop="leave(view.streamId)"
              @keydown.stop
              ><Icon
                name="close"
                :size="15" /></button
          ></span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import Icon from "../Icon.vue";
import ScreenSharePlayer from "./ScreenSharePlayer.vue";
import type { useWebClientScreenShare } from "../../composables/useWebClientScreenShare.js";
import type { ScreenShareView } from "../../voice/screen-share.js";
import type { ScreenShareStream } from "../../composables/useVoiceWebSocket.js";

export type ScreenShareGalleryLayout = "focus" | "grid";

const LAYOUT_KEY = "webspeak:screen-share-layout";

const props = defineProps<{
  model: Pick<ReturnType<typeof useWebClientScreenShare>, "fullscreen" | "viewers" | "viewerCount" | "ownerName" | "errorText" | "setPlayerElement" | "setVideoElement" | "viewerStyle" | "setVolume" | "toggleFullscreen">;
  views: readonly ScreenShareView[];
  focusedStreamId: string;
  streams: readonly ScreenShareStream[];
  remoteStream: MediaStream | null;
  remoteVolume: number;
  error: string;
  leave: (streamId?: string) => void;
  focus: (streamId: string) => void;
  avatarInitial: (name: string) => string;
  t: (key: string) => string;
}>();

function readLayout(): ScreenShareGalleryLayout {
  try { return localStorage.getItem(LAYOUT_KEY) === "grid" ? "grid" : "focus"; } catch { return "focus"; }
}

const layout = ref<ScreenShareGalleryLayout>(readLayout());
const several = computed(() => props.views.length > 1);
/** The streams beside the big player, in the order they were opened. */
const others = computed(() => props.views.filter(view => view.streamId !== props.focusedStreamId));
/** Small streams are silent until their speaker button is pressed, so games do not talk over each other. */
const audible = reactive(new Set<string>());
const videos = new Map<string, HTMLVideoElement>();

function setLayout(next: ScreenShareGalleryLayout): void {
  layout.value = next;
  try { localStorage.setItem(LAYOUT_KEY, next); } catch { /* remembered for this page only */ }
}

function ownerOf(streamId: string): string {
  return props.streams.find(stream => stream.streamId === streamId)?.ownerNickname ?? props.t("screenShare");
}

function streamHasAudio(streamId: string): boolean {
  return props.streams.find(stream => stream.streamId === streamId)?.audio !== false;
}

function bindVideo(element: unknown, streamId: string, media: MediaStream | null): void {
  if (!(element instanceof HTMLVideoElement)) {
    videos.delete(streamId);
    return;
  }
  videos.set(streamId, element);
  if (element.srcObject !== media) element.srcObject = media;
  element.volume = Math.max(0, Math.min(1, props.remoteVolume));
  if (media) void element.play().catch(() => undefined);
}

function toggleAudio(streamId: string): void {
  if (audible.has(streamId)) audible.delete(streamId);
  else audible.add(streamId);
}

// The big player has its own volume; small ones follow it when unmuted.
watch(() => props.remoteVolume, (volume) => {
  for (const video of videos.values()) video.volume = Math.max(0, Math.min(1, volume));
});
// Forget closed streams' audio choice.
watch(() => props.views.map(view => view.streamId), (ids) => {
  for (const id of [...audible]) if (!ids.includes(id)) audible.delete(id);
});
</script>
