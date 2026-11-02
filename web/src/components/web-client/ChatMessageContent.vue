<template>
  <template
    v-for="(block, index) in markup.blocks"
    :key="index"
  >
    <blockquote
      v-if="block.kind === 'quote'"
      class="chat-reply-quote"
      data-ws-part="voice.chat.reply-quote"
      ><strong v-if="block.author">{{ block.author }}</strong
      ><span>{{ block.text }}</span></blockquote
    >
    <ChatCodeBlock
      v-else-if="block.kind === 'code'"
      :code="block.code"
      :language="block.language"
      :t="t"
      @rendered="emit('mediaLoaded')"
    />
    <p
      v-else
      class="chat-paragraph"
      ><ChatInlineContent
        :inlines="block.inlines"
        :t="t"
        @media-loaded="emit('mediaLoaded')"
    /></p>
  </template>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { parseChatMarkup } from "../../../../src/shared/chat-markup.js";
import ChatCodeBlock from "./ChatCodeBlock.vue";
import ChatInlineContent from "./ChatInlineContent.vue";

const props = defineProps<{
  message: string;
  t: (key: string) => string;
  /** Nicknames `@Name` can mention. */
  mentionNames?: readonly string[];
  selfName?: string;
}>();
const emit = defineEmits<{ mediaLoaded: [] }>();

const markup = computed(() => parseChatMarkup(props.message, { mentionNames: props.mentionNames, selfName: props.selfName }));
</script>
