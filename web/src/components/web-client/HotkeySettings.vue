<template>
  <section
    class="settings-section hotkey-settings"
    data-ws-part="voice.audio-settings.hotkeys"
    ><h3
      ><Icon
        name="settings"
        :size="20"
      />
      {{ t("hotkeysTitle") }}</h3
    ><p class="hotkey-lead">{{ t("hotkeysLead") }}</p
    ><ul class="hotkey-list"
      ><li
        v-for="action in actions"
        :key="action"
        class="hotkey-row"
        ><span class="hotkey-label">{{ t(labels[action]) }}</span
        ><button
          type="button"
          class="hotkey-key"
          :class="{ recording: recording === action, empty: !bindings[action] }"
          :aria-label="`${t(labels[action])}: ${bindings[action] ? formatBinding(bindings[action], isMac) : t('hotkeyNone')}`"
          @click="recording === action ? hotkeys.stopRecording() : hotkeys.startRecording(action)"
          >{{ recording === action ? t("hotkeyPress") : bindings[action] ? formatBinding(bindings[action], isMac) : t("hotkeyNone") }}</button
        ></li
      ></ul
    ><p
      v-if="recording"
      class="hotkey-hint"
      role="status"
      >{{ t(recordingHint || "hotkeyRecordingHint") }}</p
    ><button
      type="button"
      class="text-button hotkey-reset"
      @click="hotkeys.resetDefaults"
      >{{ t("hotkeysReset") }}</button
    ><label
      v-if="hotkeys.mediaKeySupported"
      class="hotkey-media"
      ><input
        type="checkbox"
        :checked="mediaKeyEnabled"
        @change="hotkeys.setMediaKeyEnabled(($event.target as HTMLInputElement).checked)"
      /><span
        ><strong>{{ t("hotkeyMediaKey") }}</strong
        ><small>{{ t("hotkeyMediaKeyHint") }}</small></span
      ></label
    ></section
  >
</template>

<script setup lang="ts">
import Icon from "../Icon.vue";
import { HOTKEY_ACTIONS, formatBinding, type HotkeyAction } from "../../services/hotkeys.js";
import type { WebClientHotkeys } from "../../composables/useWebClientHotkeys.js";

const props = defineProps<{ hotkeys: WebClientHotkeys; t: (key: string) => string }>();
const { bindings, recording, recordingHint, mediaKeyEnabled } = props.hotkeys;
const actions = HOTKEY_ACTIONS;
const labels: Record<HotkeyAction, string> = {
  toggleMicrophone: "hotkeyToggleMicrophone",
  toggleDeafen: "hotkeyToggleDeafen",
  toggleScreenShare: "hotkeyToggleScreenShare",
};
const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform ?? "");
</script>

<style scoped>
.hotkey-lead,
.hotkey-hint {
  margin: 0 0 10px;
  color: var(--text-muted);
  font-size: 11px;
  line-height: 1.45;
}

.hotkey-list {
  display: grid;
  gap: 8px;
  margin: 0 0 8px;
  padding: 0;
  list-style: none;
}

.hotkey-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-width: 0;
}

.hotkey-label {
  min-width: 0;
  color: var(--text-primary);
  font-size: 12px;
  overflow-wrap: anywhere;
}

.hotkey-key {
  flex: none;
  min-width: 132px;
  min-height: 32px;
  padding: 0 10px;
  color: var(--text-primary);
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface-2);
  font: 600 11px/1 ui-monospace, SFMono-Regular, Consolas, monospace;
  cursor: pointer;
}

.hotkey-key.empty {
  color: var(--text-muted);
  font-family: inherit;
  font-weight: 500;
}

.hotkey-key.recording {
  color: var(--accent);
  border-color: var(--accent);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 22%, transparent);
}

.hotkey-reset {
  font-size: 11px;
}

.hotkey-media {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--border);
  cursor: pointer;
}

.hotkey-media input {
  flex: none;
  width: 15px;
  height: 15px;
  margin: 1px 0 0;
  accent-color: var(--accent);
}

.hotkey-media span {
  display: grid;
  gap: 3px;
}

.hotkey-media strong {
  color: var(--text-primary);
  font-size: 12px;
}

.hotkey-media small {
  color: var(--text-muted);
  font-size: 10px;
  line-height: 1.45;
}

@media (max-width: 420px) {
  .hotkey-row {
    flex-wrap: wrap;
  }

  .hotkey-key {
    width: 100%;
  }
}
</style>
