<template>
  <div
    class="modal-backdrop avatar-dialog-backdrop"
    data-ws-part="voice.avatar.backdrop"
    @click.self="close"
  >
    <section
      ref="dialog"
      class="avatar-dialog"
      data-ws-part="voice.avatar.dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="avatar-dialog-title"
      tabindex="-1"
      @keydown.esc.prevent="close"
      @click.stop
    >
      <button
        type="button"
        class="avatar-dialog-close"
        data-ws-part="voice.avatar.close"
        :aria-label="t('close')"
        :title="t('close')"
        @click="close"
        ><Icon
          name="close"
          :size="19"
      /></button>
      <h2
        id="avatar-dialog-title"
        data-ws-part="voice.avatar.title"
        >{{ t("avatarTitle") }}</h2
      >
      <p
        class="avatar-dialog-lead"
        data-ws-part="voice.avatar.lead"
        >{{ t("avatarLead") }}</p
      >
      <div
        :class="['avatar-dialog-drop', { dragging }]"
        data-ws-part="voice.avatar.drop"
        @dragenter.prevent="dragging = true"
        @dragover.prevent="dragging = true"
        @dragleave.prevent="dragging = false"
        @drop.prevent="onDrop"
      >
        <div
          class="avatar-dialog-preview"
          data-ws-part="voice.avatar.preview"
          :style="previewStyle"
          >{{ shownAvatar ? "" : initial }}</div
        >
        <div class="avatar-dialog-pick">
          <button
            type="button"
            class="avatar-dialog-choose"
            data-ws-part="voice.avatar.choose"
            :disabled="busy"
            @click="fileInput?.click()"
            ><Icon
              name="image"
              :size="16"
            /><span>{{ t("avatarChoose") }}</span></button
          >
          <span class="avatar-dialog-drop-hint">{{ t("avatarDrop") }}</span>
        </div>
        <input
          ref="fileInput"
          class="avatar-dialog-file"
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp,image/bmp,image/avif"
          tabindex="-1"
          aria-hidden="true"
          @change="onFileChange"
        />
      </div>
      <p
        class="avatar-dialog-hint"
        data-ws-part="voice.avatar.hint"
        >{{ t("avatarHint") }}</p
      >
      <div
        v-if="error"
        class="avatar-dialog-error"
        data-ws-part="voice.avatar.error"
        role="alert"
        ><Icon
          name="info"
          :size="15"
        /><span>{{ error }}</span></div
      >
      <div
        class="avatar-dialog-actions"
        data-ws-part="voice.avatar.actions"
      >
        <button
          v-if="currentAvatar && !prepared"
          type="button"
          class="avatar-dialog-remove"
          data-ws-part="voice.avatar.remove"
          :disabled="busy"
          @click="onRemove"
          ><Icon
            name="trash"
            :size="15"
          /><span>{{ t("avatarRemove") }}</span></button
        >
        <span class="avatar-dialog-spacer"></span>
        <button
          type="button"
          class="avatar-dialog-cancel"
          data-ws-part="voice.avatar.cancel"
          :disabled="busy"
          @click="close"
          >{{ t("avatarCancel") }}</button
        >
        <button
          type="button"
          class="avatar-dialog-save"
          data-ws-part="voice.avatar.save"
          :disabled="busy || !prepared"
          @click="onSave"
          ><span
            v-if="busy"
            class="avatar-dialog-spinner"
            aria-hidden="true"
          ></span
          ><span>{{ t("avatarSave") }}</span></button
        >
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from "vue";
import Icon from "../Icon.vue";
import { AvatarPrepareError, prepareAvatar, type PreparedAvatar } from "../../services/avatar-image.js";

const props = defineProps<{
  nickname: string;
  currentAvatar?: string;
  initial: string;
  /** The page's avatar colours for the initial, so the preview matches the member cards. */
  initialStyle: Record<string, string>;
  save: (base64: string) => Promise<void>;
  remove: () => Promise<void>;
  t: (key: string) => string;
}>();

const emit = defineEmits<{ close: []; saved: [removed: boolean] }>();

const dialog = ref<HTMLElement | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);
const prepared = ref<PreparedAvatar | null>(null);
const busy = ref(false);
const dragging = ref(false);
const error = ref("");
let pickGeneration = 0;

const shownAvatar = computed(() => prepared.value?.dataUrl ?? props.currentAvatar ?? "");
const previewStyle = computed<Record<string, string>>(() => shownAvatar.value
  ? { backgroundImage: `url("${shownAvatar.value}")`, backgroundSize: "cover", backgroundPosition: "center" }
  : props.initialStyle);

const ERROR_KEYS: Record<string, string> = {
  AVATAR_NOT_IMAGE: "avatarErrorNotImage",
  AVATAR_SOURCE_TOO_LARGE: "avatarErrorSourceTooLarge",
  AVATAR_DECODE_FAILED: "avatarErrorDecode",
  AVATAR_TOO_LARGE: "avatarErrorTooLarge",
  INVALID_AVATAR: "avatarErrorDecode",
  AVATAR_NOT_ALLOWED: "avatarErrorNotAllowed",
  FLOOD_PROTECTION: "avatarErrorFlood",
};

function errorText(reason: unknown): string {
  const code = reason instanceof AvatarPrepareError ? reason.code
    : reason && typeof reason === "object" && "code" in reason ? String((reason as { code: unknown }).code) : "";
  return props.t(ERROR_KEYS[code] ?? "avatarErrorFailed");
}

async function usePicture(file: File | undefined): Promise<void> {
  if (!file || busy.value) return;
  const generation = ++pickGeneration;
  error.value = "";
  try {
    const result = await prepareAvatar(file);
    if (generation === pickGeneration) prepared.value = result;
  } catch (reason: unknown) {
    if (generation === pickGeneration) { prepared.value = null; error.value = errorText(reason); }
  }
}

function onFileChange(event: Event): void {
  const input = event.target as HTMLInputElement;
  void usePicture(input.files?.[0]);
  input.value = "";
}

function onDrop(event: DragEvent): void {
  dragging.value = false;
  void usePicture(event.dataTransfer?.files?.[0]);
}

async function onSave(): Promise<void> {
  const picture = prepared.value;
  if (!picture || busy.value) return;
  busy.value = true;
  error.value = "";
  try {
    await props.save(picture.base64);
    emit("saved", false);
    emit("close");
  } catch (reason: unknown) {
    error.value = errorText(reason);
  } finally {
    busy.value = false;
  }
}

async function onRemove(): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  try {
    await props.remove();
    emit("saved", true);
    emit("close");
  } catch (reason: unknown) {
    error.value = errorText(reason);
  } finally {
    busy.value = false;
  }
}

function close(): void {
  if (!busy.value) emit("close");
}

onMounted(() => { void nextTick(() => dialog.value?.focus()); });
</script>

<style scoped>
.avatar-dialog-backdrop {
  position: fixed;
  inset: 0;
  z-index: 70;
  display: grid;
  place-items: center;
  padding: 16px;
  background: rgb(4 8 8 / 58%);
}
.avatar-dialog {
  position: relative;
  width: min(420px, 100%);
  max-height: calc(100dvh - 32px);
  overflow: auto;
  padding: 24px;
  border: 1px solid var(--skin-avatar-border, var(--border, #dfe5e2));
  border-radius: 16px;
  color: var(--skin-avatar-text, var(--text-primary, #1d2421));
  background: var(--skin-avatar-surface, var(--surface-1, #ffffff));
  box-shadow: 0 24px 60px rgb(0 0 0 / 28%);
  outline: none;
}
.avatar-dialog h2 {
  margin: 0 32px 6px 0;
  font-size: 19px;
}
.avatar-dialog-lead,
.avatar-dialog-hint {
  margin: 0;
  color: var(--skin-avatar-text-secondary, var(--text-secondary, #4c5753));
  font-size: 13px;
  line-height: 1.45;
}
.avatar-dialog-hint {
  margin-top: 10px;
  color: var(--skin-avatar-muted, var(--text-muted, #6b7672));
  font-size: 12px;
}
.avatar-dialog-close {
  position: absolute;
  top: 14px;
  right: 14px;
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border: 0;
  border-radius: 8px;
  color: var(--skin-avatar-muted, var(--text-muted, #6b7672));
  background: transparent;
  cursor: pointer;
}
.avatar-dialog-close:hover { color: var(--skin-avatar-text, var(--text-primary, #1d2421)); background: var(--skin-avatar-surface-2, var(--surface-2, #f3f6f5)); }
.avatar-dialog-drop {
  display: flex;
  align-items: center;
  gap: 18px;
  margin-top: 18px;
  padding: 16px;
  border: 1.5px dashed var(--skin-avatar-border, var(--border, #dfe5e2));
  border-radius: 14px;
  background: var(--skin-avatar-surface-2, var(--surface-2, #f3f6f5));
  transition: border-color .15s, background-color .15s;
}
.avatar-dialog-drop.dragging {
  border-color: var(--skin-avatar-accent, var(--accent, #2f8f6f));
  background: color-mix(in srgb, var(--skin-avatar-accent, var(--accent, #2f8f6f)) 10%, var(--skin-avatar-surface-2, var(--surface-2, #f3f6f5)));
}
.avatar-dialog-preview {
  flex: none;
  display: grid;
  place-items: center;
  width: 96px;
  height: 96px;
  border-radius: 50%;
  font-size: 36px;
  font-weight: 700;
  box-shadow: 0 0 0 3px var(--skin-avatar-surface, var(--surface-1, #ffffff)), 0 0 0 4px var(--skin-avatar-border, var(--border, #dfe5e2));
}
.avatar-dialog-pick {
  display: grid;
  gap: 6px;
  min-width: 0;
}
.avatar-dialog-drop-hint {
  color: var(--skin-avatar-muted, var(--text-muted, #6b7672));
  font-size: 12px;
}
.avatar-dialog-file { display: none; }
.avatar-dialog button:not(.avatar-dialog-close) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  min-height: 36px;
  padding: 0 14px;
  border: 1px solid var(--skin-avatar-border, var(--border, #dfe5e2));
  border-radius: 10px;
  color: var(--skin-avatar-text, var(--text-primary, #1d2421));
  background: var(--skin-avatar-surface, var(--surface-1, #ffffff));
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.avatar-dialog button:disabled { opacity: .55; cursor: default; }
.avatar-dialog button.avatar-dialog-save:not(.avatar-dialog-close) {
  border-color: var(--skin-avatar-accent, var(--accent, #2f8f6f));
  color: #fff;
  background: var(--skin-avatar-accent, var(--accent, #2f8f6f));
}
.avatar-dialog button.avatar-dialog-remove:not(.avatar-dialog-close) { color: var(--skin-avatar-danger, var(--danger, #d64545)); }
.avatar-dialog-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-top: 18px;
}
.avatar-dialog-spacer { flex: 1; }
.avatar-dialog-error {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-top: 12px;
  padding: 9px 11px;
  border-radius: 10px;
  color: var(--skin-avatar-danger, var(--danger, #d64545));
  background: color-mix(in srgb, var(--skin-avatar-danger, var(--danger, #d64545)) 10%, transparent);
  font-size: 13px;
  line-height: 1.4;
}
.avatar-dialog-error :deep(svg) { flex: none; margin-top: 1px; }
.avatar-dialog-spinner {
  width: 14px;
  height: 14px;
  border: 2px solid rgb(255 255 255 / 40%);
  border-top-color: #fff;
  border-radius: 50%;
  animation: avatar-dialog-spin .8s linear infinite;
}
@keyframes avatar-dialog-spin { to { transform: rotate(360deg); } }
@media (max-width: 480px) {
  .avatar-dialog { padding: 20px 16px; }
  .avatar-dialog-drop { flex-direction: column; text-align: center; }
  .avatar-dialog-pick { justify-items: center; }
  .avatar-dialog-spacer { display: none; }
  .avatar-dialog-actions > button { flex: 1 1 auto; }
}
</style>
