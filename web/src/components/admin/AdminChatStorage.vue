<template>
  <section class="page-content operations-page chat-storage-page" data-admin-scope="webspeak">
    <div class="page-heading"
      ><div
        ><h2>{{ tr("chatStorageTitle") }}</h2
        ><p>{{ tr("chatStorageLead") }}</p></div
      ><button
        class="secondary-button"
        type="button"
        :disabled="loading"
        @click="load"
        ><span
          v-if="loading"
          class="spinner small"
        ></span
        ><Icon
          v-else
          name="refresh"
          :size="17"
        />{{ tr("refresh") }}</button
      ></div
    >

    <article class="operation-card chat-storage-usage"
      ><header
        ><div
          ><h3>{{ tr("chatStorageUsage", { used: formatBytes(usage.usedBytes), quota: formatBytes(saved.quotaBytes) }) }}</h3
          ><p
            >{{ tr("chatStorageFiles", { count: usage.fileCount, size: formatBytes(usage.fileBytes) }) }} ·
            {{ tr("chatStorageMessages", { count: usage.messageCount, size: formatBytes(usage.messageBytes) }) }}</p
          ></div
        ><strong>{{ percent }}%</strong></header
      ><div
        class="chat-storage-meter"
        role="meter"
        :aria-valuenow="percent"
        aria-valuemin="0"
        aria-valuemax="100"
        :aria-label="tr('chatStorageTitle')"
        ><span :style="{ width: `${percent}%` }"></span></div
    ></article>

    <article class="operation-card chat-storage-settings"
      ><label class="chat-storage-field"
        ><span>{{ tr("chatStorageMaxFile") }}</span
        ><input
          v-model.number="form.maxFileMb"
          type="number"
          inputmode="decimal"
          min="0"
          step="1"
          :disabled="!loaded"
        /><small class="field-help">{{ tr("chatStorageMaxFileHint") }}</small></label
      ><label class="chat-storage-field"
        ><span>{{ tr("chatStorageQuota") }}</span
        ><input
          v-model.number="form.quotaGb"
          type="number"
          inputmode="decimal"
          min="0"
          step="1"
          :disabled="!loaded"
        /><small class="field-help">{{ tr("chatStorageQuotaHint") }}</small></label
      ><label
        class="choice toggle-choice"
        :class="{ selected: form.historyEnabled }"
        ><input
          v-model="form.historyEnabled"
          type="checkbox"
          :disabled="!loaded"
        /><span
          ><strong>{{ tr("chatStorageHistory") }}</strong
          ><small>{{ tr("chatStorageHistoryHint") }}</small></span
        ></label
      ><p class="chat-storage-note"
        ><Icon
          name="info"
          :size="15"
        />{{ tr("chatStorageProxyNote") }}</p
      ><div class="chat-storage-actions"
        ><button
          class="primary-button"
          type="button"
          :disabled="saving || !loaded"
          @click="save"
          >{{ saving ? tr("saving") : tr("chatStorageSave") }}</button
        ><button
          class="secondary-button danger"
          type="button"
          :disabled="clearing || !loaded"
          @click="clear"
          >{{ clearArmed ? tr("chatStorageClearConfirm") : tr("chatStorageClear") }}</button
        ><span
          v-if="notice"
          class="chat-storage-notice"
          role="status"
          >{{ notice }}</span
        ></div
      ></article
    >
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted } from "vue";
import Icon from "../Icon.vue";
import { formatBytes } from "../../../../src/shared/chat-storage.js";
import type { AdminChatStorageModel } from "../../composables/useAdminChatStorage.js";
import type { useAdminI18n } from "../../composables/useAdminI18n.js";

const props = defineProps<{
  model: AdminChatStorageModel;
  i18n: Pick<ReturnType<typeof useAdminI18n>, "tr">;
}>();
const { form, usage, saved, loading, saving, clearing, clearArmed, notice, loaded, load, save, clear } = props.model;
const { tr } = props.i18n;
const percent = computed(() => saved.quotaBytes > 0 ? Math.min(100, Math.round(usage.usedBytes / saved.quotaBytes * 100)) : 0);
onMounted(() => { void load(); });
</script>

<style scoped>
.chat-storage-settings {
  display: grid;
  gap: 16px;
}

.chat-storage-field {
  display: grid;
  gap: 6px;
  max-width: 360px;
}

.chat-storage-field span {
  font-weight: 650;
  font-size: 13px;
}

.chat-storage-meter {
  height: 10px;
  overflow: hidden;
  background: color-mix(in srgb, currentColor 10%, transparent);
  border-radius: 999px;
}

.chat-storage-meter span {
  display: block;
  height: 100%;
  background: #0f8f86;
  border-radius: inherit;
  transition: width .2s ease;
}

.chat-storage-note {
  display: flex;
  align-items: flex-start;
  gap: 7px;
  margin: 0;
  color: #8a6537;
  font-size: 12px;
  line-height: 1.45;
}

.chat-storage-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}

.chat-storage-notice {
  color: #0f8f86;
  font-size: 13px;
}

:global(html[data-ws-route="admin"][data-theme="dark"] .chat-storage-note) {
  color: #e4c48f;
}
</style>
