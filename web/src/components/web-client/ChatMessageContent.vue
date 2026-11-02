<template>
  <template
    v-for="(part, index) in parts"
    :key="index"
  >
    <template v-if="part.kind === 'text'">{{ part.text }}</template>
    <template v-else-if="part.attachment && part.image && !failed.has(index)">
      <a
        class="chat-attachment-image"
        data-ws-part="voice.chat.attachment-image"
        :href="part.href"
        target="_blank"
        rel="noopener noreferrer"
        :title="part.text"
        ><img
          :src="part.href"
          :alt="part.text"
          loading="lazy"
          decoding="async"
          @load="emit('mediaLoaded')"
          @error="markFailed(index)"
      /></a>
    </template>
    <span
      v-else-if="part.attachment && failed.has(index)"
      class="chat-attachment-file chat-attachment-missing"
      data-ws-part="voice.chat.attachment-missing"
      ><Icon
        name="paperclip"
        :size="16"
      /><span
        ><strong>{{ part.text }}</strong
        ><small>{{ t("chatFileRemoved") }}</small></span
      ></span
    >
    <a
      v-else-if="part.attachment"
      class="chat-attachment-file"
      data-ws-part="voice.chat.attachment-file"
      :href="part.href"
      target="_blank"
      rel="noopener noreferrer"
      ><Icon
        name="download"
        :size="16"
      /><span
        ><strong>{{ part.text }}</strong
        ><small>{{ t("chatFileDownload") }}</small></span
      ></a
    >
    <a
      v-else
      class="chat-link"
      :href="part.href"
      target="_blank"
      rel="noopener noreferrer nofollow"
      >{{ part.text }}</a
    >
  </template>
</template>

<script setup lang="ts">
import { computed, reactive } from "vue";
import Icon from "../Icon.vue";
import { looksLikeImageName, parseChatAttachmentUrl, parseChatMessage } from "../../../../src/shared/chat-storage.js";

const props = defineProps<{
  message: string;
  t: (key: string) => string;
}>();
const emit = defineEmits<{ mediaLoaded: [] }>();

const origin = typeof location === "undefined" ? "" : location.origin;
const parts = computed(() => parseChatMessage(props.message).map(part => {
  if (part.kind === "text") return { ...part, attachment: false, image: false };
  const attachment = Boolean(origin && parseChatAttachmentUrl(part.href, origin));
  return { ...part, attachment, image: attachment && looksLikeImageName(part.text) };
}));
/** Attachments that no longer load (rotated out to free space). */
const failed = reactive(new Set<number>());
function markFailed(index: number): void { failed.add(index); }
</script>
