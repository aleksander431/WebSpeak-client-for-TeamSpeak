<template>
  <div
    class="whisper-strip"
    data-ws-part="voice.whisper-strip"
  >
    <div class="whisper-strip-copy"
      ><strong
        ><Icon
          name="users"
          :size="15"
        />
        {{ t("whisperTargets") }}</strong
      ><span>{{ targets.map((member) => member.nickname).join("、") }}</span></div
    >
    <button
      type="button"
      class="text-button"
      @click="emit('clear')"
      >{{ t("clearWhisperTargets") }}</button
    >
    <button
      type="button"
      class="whisper-ptt-button"
      :class="{ active: whisperPttActive || active }"
      :aria-pressed="whisperPttActive || active"
      @pointerdown.prevent="onWhisperPttDown"
      @pointerup.prevent="onWhisperPttUp"
      @pointercancel.prevent="onWhisperPttUp"
      @lostpointercapture="onWhisperPttUp"
      @keydown="onWhisperPttKeyDown"
      @keyup="onWhisperPttKeyUp"
      @blur="stopLocalWhisperTalk"
      ><Icon
        name="mic"
        :size="18"
      />
      {{ whisperPttActive || active ? t("releaseWhisper") : t("whisperHoldToTalk") }}</button
    >
  </div>
</template>

<script setup lang="ts">
import { onMounted, onBeforeUnmount, watch } from "vue";
import Icon from "../Icon.vue";
import type { useWebClientAudioControls } from "../../composables/useWebClientAudioControls.js";

const props = defineProps<{
  targets: ReadonlyArray<{ nickname: string }>;
  active: boolean;
  enabled: boolean;
  controls: Pick<ReturnType<typeof useWebClientAudioControls>, "whisperPttActive" | "onWhisperPttDown" | "onWhisperPttUp" | "onWhisperPttKeyDown" | "onWhisperPttKeyUp" | "stopWhisperTalk" | "stopLocalWhisperTalk">;
  t: (key: string) => string;
}>();
const { whisperPttActive, onWhisperPttDown, onWhisperPttUp, onWhisperPttKeyDown, onWhisperPttKeyUp, stopWhisperTalk, stopLocalWhisperTalk } = props.controls;
const emit = defineEmits<{ clear: [] }>();
function onVisibilityChange() { if (document.hidden) stopLocalWhisperTalk(); }
watch(() => props.enabled, enabled => { if (!enabled) stopLocalWhisperTalk(); }, { flush: "sync" });
onMounted(() => {
  window.addEventListener("blur", stopLocalWhisperTalk);
  document.addEventListener("visibilitychange", onVisibilityChange);
});
onBeforeUnmount(() => {
  stopWhisperTalk();
  window.removeEventListener("blur", stopLocalWhisperTalk);
  document.removeEventListener("visibilitychange", onVisibilityChange);
});
</script>
