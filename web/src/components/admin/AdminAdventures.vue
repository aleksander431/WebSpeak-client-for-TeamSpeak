<template>
  <section class="page-content operations-page adventures-page" data-admin-scope="webspeak">
    <div class="page-heading"
      ><div
        ><h2>{{ tr("adventuresTitle") }}</h2
        ><p>{{ tr("adventuresLead") }}</p></div
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

    <article class="operation-card adventures-upload"
      ><label class="primary-button adventures-upload-button"
        ><input
          ref="fileInput"
          type="file"
          accept=".zip,application/zip"
          :disabled="uploading"
          @change="onFile"
        /><span
          v-if="uploading"
          class="spinner small"
        ></span
        >{{ uploading ? tr("adventuresUploading") : tr("adventuresUpload") }}</label
      ><p class="field-help">{{ tr("adventuresLimit", { size: formatBytes(limitBytes) }) }} {{ tr("adventuresProxyNote") }}</p
      ><p
        v-if="notice"
        class="adventures-notice"
        role="status"
        >{{ notice }}</p
      ><p
        v-if="problem.text"
        class="adventures-problem"
        role="alert"
        >{{ problem.text }}</p
      ></article
    >

    <article class="operation-card adventures-list"
      ><p
        v-if="!items.length"
        class="field-help"
        >{{ tr("adventuresEmpty") }}</p
      ><div
        v-for="item in items"
        :key="item.id"
        class="adventures-item"
        ><div
          ><strong>{{ item.title }}</strong
          ><small class="adventures-id">{{ item.id }}</small
          ><p>{{ item.summary }}</p
          ><small>{{ tr("adventuresStats", { scenes: item.scenes, heroes: item.heroes, tracks: item.tracks, size: formatBytes(item.bytes) }) }}</small></div
        ><button
          class="secondary-button danger"
          type="button"
          @click="remove(item.id)"
          >{{ armed === item.id ? tr("adventuresRemoveConfirm") : tr("adventuresRemove") }}</button
        ></div
      ></article
    >
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import Icon from "../Icon.vue";
import { formatBytes } from "../../../../src/shared/chat-storage.js";
import type { AdminAdventuresModel } from "../../composables/useAdminAdventures.js";
import type { useAdminI18n } from "../../composables/useAdminI18n.js";

const props = defineProps<{
  model: AdminAdventuresModel;
  i18n: Pick<ReturnType<typeof useAdminI18n>, "tr">;
}>();
const { items, limitBytes, loading, uploading, notice, armed, problem, load, upload, remove } = props.model;
const { tr } = props.i18n;
const fileInput = ref<HTMLInputElement | null>(null);

function onFile(event: Event): void {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (file) void upload(file);
}

onMounted(() => { void load(); });
</script>

<style scoped>
.adventures-upload { display: flex; flex-direction: column; align-items: flex-start; gap: 10px; }
.adventures-upload-button { position: relative; display: inline-flex; align-items: center; gap: 8px; cursor: pointer; }
.adventures-upload-button input { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
.adventures-notice { margin: 0; color: var(--success, #2f9e5b); }
.adventures-problem { margin: 0; color: var(--danger, #d14343); white-space: pre-wrap; overflow-wrap: anywhere; }
.adventures-list { display: flex; flex-direction: column; gap: 12px; }
.adventures-item { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding-bottom: 12px; border-bottom: 1px solid var(--border, rgba(127, 127, 127, 0.25)); }
.adventures-item:last-child { border-bottom: 0; padding-bottom: 0; }
.adventures-item > div { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.adventures-item p { margin: 0; }
.adventures-id { opacity: .7; font-family: ui-monospace, monospace; }
@media (max-width: 640px) {
  .adventures-item { flex-direction: column; }
}
</style>
