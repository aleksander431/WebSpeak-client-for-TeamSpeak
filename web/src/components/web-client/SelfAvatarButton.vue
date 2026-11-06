<template>
  <button
    type="button"
    class="self-avatar-button"
    data-ws-part="voice.self-avatar"
    :data-ws-state="avatar ? 'image' : 'initial'"
    :style="style"
    :disabled="!canEdit"
    :aria-label="canEdit ? `${t('avatarChange')}: ${nickname}` : nickname"
    :title="canEdit ? `${nickname} · ${t('avatarChange')}` : nickname"
    @click="emit('edit')"
  >
    <span
      v-if="!avatar"
      class="self-avatar-initial"
      >{{ initial }}</span
    >
    <span
      v-if="canEdit"
      class="self-avatar-camera"
      aria-hidden="true"
      ><Icon
        name="camera"
        :size="18"
    /></span>
  </button>
</template>

<script setup lang="ts">
import { computed } from "vue";
import Icon from "../Icon.vue";

const props = defineProps<{
  nickname: string;
  avatar?: string;
  initial: string;
  /** The page's colour for the initial when there is no picture. */
  initialStyle: Record<string, string>;
  canEdit: boolean;
  t: (key: string) => string;
}>();

const emit = defineEmits<{ edit: [] }>();

const style = computed<Record<string, string>>(() => props.avatar
  ? { backgroundImage: `url("${props.avatar}")`, backgroundSize: "cover", backgroundPosition: "center" }
  : props.initialStyle);
</script>

<style scoped>
/* Fills whatever circle the skin gives it; the skin sizes its container. */
.self-avatar-button {
  position: relative;
  display: grid;
  place-items: center;
  width: 100%;
  height: 100%;
  min-width: 28px;
  min-height: 28px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  overflow: hidden;
  color: #fff;
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}
.self-avatar-button:disabled { cursor: default; }
.self-avatar-camera {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: #fff;
  background: rgb(0 0 0 / 52%);
  opacity: 0;
  transition: opacity .15s;
}
.self-avatar-button:hover .self-avatar-camera,
.self-avatar-button:focus-visible .self-avatar-camera {
  opacity: 1;
}
.self-avatar-button:has(.self-avatar-camera):hover .self-avatar-initial { opacity: 0; }
.self-avatar-button:focus-visible { outline: 2px solid var(--accent, #2f8f6f); outline-offset: 2px; }
</style>
