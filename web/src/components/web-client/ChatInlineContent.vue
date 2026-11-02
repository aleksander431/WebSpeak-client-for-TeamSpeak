<template>
  <template
    v-for="(inline, index) in inlines"
    :key="index"
  >
    <template v-if="inline.kind === 'text'">{{ inline.text }}</template>
    <code
      v-else-if="inline.kind === 'code'"
      class="chat-inline-code"
      >{{ inline.text }}</code
    >
    <strong v-else-if="inline.kind === 'strong'"><ChatInlineContent :inlines="inline.children" :t="t" @media-loaded="emit('mediaLoaded')" /></strong>
    <em v-else-if="inline.kind === 'em'"><ChatInlineContent :inlines="inline.children" :t="t" @media-loaded="emit('mediaLoaded')" /></em>
    <s v-else-if="inline.kind === 'strike'"><ChatInlineContent :inlines="inline.children" :t="t" @media-loaded="emit('mediaLoaded')" /></s>
    <u v-else-if="inline.kind === 'underline'"><ChatInlineContent :inlines="inline.children" :t="t" @media-loaded="emit('mediaLoaded')" /></u>
    <span
      v-else-if="inline.kind === 'mention'"
      :class="['chat-mention', { self: inline.self }]"
      data-ws-part="voice.chat.mention"
      :data-ws-state="inline.self ? 'self' : 'other'"
      >@{{ inline.name }}</span
    >
    <ChatLink
      v-else-if="inline.kind === 'link'"
      :href="inline.href"
      :text="inline.text"
      :t="t"
      @media-loaded="emit('mediaLoaded')"
    />
  </template>
</template>

<script setup lang="ts">
import type { ChatInline } from "../../../../src/shared/chat-markup.js";
import ChatLink from "./ChatLink.vue";

defineProps<{ inlines: readonly ChatInline[]; t: (key: string) => string }>();
const emit = defineEmits<{ mediaLoaded: [] }>();
</script>
