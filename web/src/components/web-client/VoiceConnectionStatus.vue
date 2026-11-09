<template>
  <section
    v-if="!connected"
    class="voice-connection-status"
    data-ws-part="voice.connection-status"
    :data-ws-state="recovery ? 'recovering' : connecting ? 'connecting' : error ? 'failed' : 'disconnected'"
  >
    <p role="status" aria-live="polite" data-ws-part="voice.connection-status.message">
      {{ recovery || (connecting ? t('connecting') : error || t('voiceHealthDisconnected')) }}
    </p>
    <label data-ws-part="voice.connection-status.nickname">
      <span>{{ t('nickname') }}</span>
      <input
        :value="nickname"
        :disabled="connecting"
        maxlength="30"
        autocomplete="nickname"
        data-ws-part="voice.connection-status.nickname.input"
        @input="$emit('update:nickname', ($event.target as HTMLInputElement).value)"
      />
    </label>
    <button
      type="button"
      :disabled="!canConnect || connecting"
      data-ws-part="voice.connection-status.reconnect"
      @click="$emit('connect')"
    ><Icon v-if="connecting" name="refresh" :size="16" />{{ t('reconnectNow') }}</button>
    <ServerPreviewPanel
      v-if="previewChannels && !connecting"
      class="voice-connection-status-preview"
      :channels="previewChannels"
      selected=""
      :t="t"
      @select="path => $emit('pickChannel', path)"
    />
  </section>
</template>

<script setup lang="ts">
import Icon from "../Icon.vue";
import ServerPreviewPanel from "./ServerPreviewPanel.vue";
import type { ServerPreviewChannel } from "../../../../src/shared/server-preview.js";

defineProps<{
  connected: boolean;
  connecting: boolean;
  nickname: string;
  error: string;
  canConnect: boolean;
  /** Automatic rejoin in progress: what it is doing; the button then retries at once. */
  recovery?: string;
  /** Who is on the server (approved browsers only); a click rejoins straight into that channel. */
  previewChannels?: readonly ServerPreviewChannel[] | null;
  t: (key: string, variables?: Record<string, string | number>) => string;
}>();
defineEmits<{ connect: []; 'update:nickname': [value: string]; pickChannel: [path: string] }>();
</script>

<style scoped>
.voice-connection-status-preview {
  margin-top: 10px;
  text-align: left;
}
</style>
