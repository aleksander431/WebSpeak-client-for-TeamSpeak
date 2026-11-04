<template>
  <a
    v-if="attachment && image && !failed"
    class="chat-attachment-image"
    data-ws-part="voice.chat.attachment-image"
    :href="href"
    target="_blank"
    rel="noopener noreferrer"
    :title="text"
    @click="openViewer"
    ><img
      :src="href"
      :alt="text"
      loading="lazy"
      decoding="async"
      @load="emit('mediaLoaded')"
      @error="failed = true"
  /></a>
  <span
    v-else-if="attachment && failed"
    class="chat-attachment-file chat-attachment-missing"
    data-ws-part="voice.chat.attachment-missing"
    ><Icon
      name="paperclip"
      :size="16"
    /><span
      ><strong>{{ text }}</strong
      ><small>{{ t("chatFileRemoved") }}</small></span
    ></span
  >
  <a
    v-else-if="attachment"
    class="chat-attachment-file"
    data-ws-part="voice.chat.attachment-file"
    :href="href"
    target="_blank"
    rel="noopener noreferrer"
    ><Icon
      name="download"
      :size="16"
    /><span
      ><strong>{{ text }}</strong
      ><small>{{ t("chatFileDownload") }}</small></span
    ></a
  >
  <a
    v-else
    class="chat-link"
    :href="href"
    target="_blank"
    rel="noopener noreferrer nofollow"
    >{{ text }}</a
  >
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import Icon from "../Icon.vue";
import { looksLikeImageName, parseChatAttachmentUrl } from "../../../../src/shared/chat-storage.js";
import { chatImagesAround, openImageViewer } from "../../services/image-viewer.js";

const props = defineProps<{ href: string; text: string; t: (key: string) => string }>();
const emit = defineEmits<{ mediaLoaded: [] }>();
const origin = typeof location === "undefined" ? "" : location.origin;
const attachment = computed(() => Boolean(origin && parseChatAttachmentUrl(props.href, origin)));
const image = computed(() => attachment.value && looksLikeImageName(props.text));
/** The attachment no longer loads (rotated out to free space). */
const failed = ref(false);

/** Open the picture in the page's viewer; Ctrl/Cmd/Shift-click still opens a new tab. */
function openViewer(event: MouseEvent): void {
  if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  const link = event.currentTarget as HTMLAnchorElement;
  openImageViewer({ src: link.href, name: props.text }, chatImagesAround(link));
}
</script>
