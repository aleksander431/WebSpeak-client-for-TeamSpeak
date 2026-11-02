<template>
  <figure
    class="chat-code-block"
    data-ws-part="voice.chat.code-block"
    ><figcaption class="chat-code-header"
      ><span class="chat-code-language">{{ label }}</span
      ><button
        type="button"
        class="chat-code-copy"
        data-ws-part="voice.chat.code-copy"
        :data-ws-state="copied ? 'copied' : 'idle'"
        :title="t('chatCopyCode')"
        :aria-label="t('chatCopyCode')"
        @click="copy"
        ><Icon
          :name="copied ? 'check' : 'copy'"
          :size="13"
        /><span>{{ copied ? t("chatCopied") : t("chatCopyCode") }}</span></button
      ></figcaption
    ><pre
      class="chat-code"
      tabindex="0"
      ><code
        v-if="highlighted"
        class="hljs"
        v-html="highlighted.html"
      ></code
      ><code v-else>{{ code }}</code></pre
    ></figure
  >
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import Icon from "../Icon.vue";
import { highlightCode } from "../../services/code-highlight.js";

const props = defineProps<{ code: string; language: string; t: (key: string) => string }>();
const emit = defineEmits<{ rendered: [] }>();

const highlighted = ref<{ html: string; language: string } | null>(null);
let generation = 0;
watch(() => [props.code, props.language] as const, async ([code, language]) => {
  const current = ++generation;
  highlighted.value = null;
  const result = await highlightCode(code, language);
  if (current !== generation) return;
  highlighted.value = result;
  if (result) emit("rendered");
}, { immediate: true });
onBeforeUnmount(() => { generation += 1; });

const label = computed(() => props.language || highlighted.value?.language || props.t("chatCode"));

const copied = ref(false);
let copiedTimer: ReturnType<typeof setTimeout> | undefined;
async function copy(): Promise<void> {
  try {
    await navigator.clipboard.writeText(props.code);
  } catch {
    // Older browsers and non-secure origins: select the text for a manual copy.
    const range = document.createRange();
    const node = document.activeElement?.closest(".chat-code-block")?.querySelector("pre");
    if (!node) return;
    range.selectNodeContents(node);
    const selection = getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    return;
  }
  copied.value = true;
  clearTimeout(copiedTimer);
  copiedTimer = setTimeout(() => { copied.value = false; }, 1500);
}
onBeforeUnmount(() => clearTimeout(copiedTimer));
</script>
