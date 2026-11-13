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

    <article
      v-if="backup.available"
      class="operation-card dnd-backup"
      ><h3>{{ tr("dndBackupTitle") }}</h3
      ><p class="field-help">{{ tr("dndBackupLead") }}</p
      ><div class="dnd-backup-actions"
        ><a
          class="primary-button"
          href="/api/admin/dnd-backup"
          download
          >{{ tr("dndBackupDownload") }}</a
        ><label class="secondary-button adventures-upload-button"
          ><input
            type="file"
            accept=".zip,application/zip"
            :disabled="restoring"
            @change="onRestoreFile"
          /><span
            v-if="restoring"
            class="spinner small"
          ></span
          >{{ restoring ? tr("dndBackupRestoring") : tr("dndBackupRestore") }}</label
        ><small>{{ tr("dndBackupSize", { files: backup.files, size: formatBytes(backup.bytes) }) }}</small></div
      ><p class="field-help">{{ tr("dndBackupRestoreLimit", { size: formatBytes(backup.limitBytes) }) }} {{ tr("adventuresProxyNote") }}</p
      ><p
        v-if="backupNotice"
        class="adventures-notice"
        role="status"
        >{{ backupNotice }}</p
      ><div
        v-else-if="backup.pending"
        class="dnd-backup-pending"
        role="status"
        ><span>{{ tr("dndBackupPending", { date: backup.pending.createdAt ? new Date(backup.pending.createdAt).toLocaleString() : "—" }) }}</span
        ><button
          class="secondary-button small"
          type="button"
          @click="cancelRestore"
          >{{ tr("dndBackupCancel") }}</button
        ></div
      ><p
        v-if="backupProblem"
        class="adventures-problem"
        role="alert"
        >{{ backupProblem }}</p
      ></article
    >

    <article class="operation-card editor-links"
      ><h3>{{ tr("editorTitle") }}</h3
      ><p class="field-help">{{ tr("editorLead") }}</p
      ><form
        class="editor-create"
        @submit.prevent="createLink"
        ><input
          v-model="linkLabel"
          class="text-input"
          maxlength="60"
          :placeholder="tr('editorLabelPlaceholder')"
          :aria-label="tr('editorLabelPlaceholder')"
        /><button
          class="primary-button"
          type="submit"
          :disabled="!linkLabel.trim()"
          >{{ tr("editorCreate") }}</button
        ></form
      ><p
        v-if="!links.length"
        class="field-help"
        >{{ tr("editorEmpty") }}</p
      ><div
        v-for="link in links"
        :key="link.id"
        class="editor-link"
        ><div class="editor-link-head"
          ><strong>{{ link.label }}</strong
          ><span
            v-if="link.devices.some(device => device.status === 'pending')"
            class="editor-badge"
            >{{ tr("editorPending") }}</span
          ><button
            class="secondary-button danger editor-remove"
            type="button"
            @click="removeLink(link.id)"
            >{{ linkArmed === link.id ? tr("editorRemoveLinkConfirm") : tr("editorRemoveLink") }}</button
          ></div
        ><div class="editor-url"
          ><code>{{ linkUrl(link) }}</code
          ><button
            class="secondary-button"
            type="button"
            @click="copyLink(link)"
            >{{ copied === link.id ? tr("editorCopied") : tr("editorCopy") }}</button
          ></div
        ><p
          v-if="!link.devices.length"
          class="field-help"
          >{{ tr("editorNoDevices") }}</p
        ><ul
          v-else
          class="editor-devices"
          ><li
            v-for="device in link.devices"
            :key="device.id"
            :class="['editor-device', `editor-device-${device.status}`]"
            ><span class="editor-device-name">{{ device.name }}</span
            ><small>{{ device.status === "pending" ? tr("editorPending") : device.status === "approved" ? tr("editorApproved") : tr("editorDenied") }} · {{ new Date(device.requestedAt).toLocaleString() }}</small
            ><span class="editor-device-actions"
              ><button
                v-if="device.status !== 'approved'"
                class="primary-button small"
                type="button"
                @click="decide(link.id, device.id, 'approved')"
                >{{ tr("editorApprove") }}</button
              ><button
                v-if="device.status === 'pending'"
                class="secondary-button small"
                type="button"
                @click="decide(link.id, device.id, 'denied')"
                >{{ tr("editorDeny") }}</button
              ><button
                v-if="device.status !== 'pending'"
                class="secondary-button small"
                type="button"
                @click="decide(link.id, device.id, 'remove')"
                >{{ tr("editorRemoveDevice") }}</button
              ></span
            ></li
          ></ul
        ><p
          v-if="link.drafts.length"
          class="editor-drafts"
          ><strong>{{ tr("editorDrafts") }}:</strong
          ><span
            v-for="draft in link.drafts"
            :key="draft.id"
            class="editor-draft"
            >{{ draft.title }}<em v-if="draft.publishedId"> · {{ tr("editorPublished") }}</em></span
          ></p
        ></div
      ></article
    >
  </section>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import Icon from "../Icon.vue";
import { formatBytes } from "../../../../src/shared/chat-storage.js";
import type { AdminAdventuresModel } from "../../composables/useAdminAdventures.js";
import type { useAdminI18n } from "../../composables/useAdminI18n.js";

const props = defineProps<{
  model: AdminAdventuresModel;
  i18n: Pick<ReturnType<typeof useAdminI18n>, "tr">;
}>();
const {
  items, limitBytes, loading, uploading, notice, armed, problem, load, upload, remove,
  links, linkLabel, linkArmed, copied, loadLinks, createLink, removeLink, decide, linkUrl, copyLink,
  backup, restoring, backupNotice, backupProblem, loadBackup, restoreBackup, cancelRestore,
} = props.model;
const { tr } = props.i18n;
const fileInput = ref<HTMLInputElement | null>(null);

function onFile(event: Event): void {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (file) void upload(file);
}

function onRestoreFile(event: Event): void {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (file) void restoreBackup(file);
}

onMounted(() => { void load(); void loadLinks(); void loadBackup(); });
// New applications should show up without a manual refresh.
const linkTimer = setInterval(() => { void loadLinks(); }, 15000);
onBeforeUnmount(() => clearInterval(linkTimer));
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
.dnd-backup { display: flex; flex-direction: column; gap: 10px; }
.dnd-backup h3 { margin: 0; }
.dnd-backup .adventures-notice { font-size: 14px; }
.dnd-backup-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
.dnd-backup-actions a { text-decoration: none; }
.dnd-backup-actions small { opacity: .75; }
.dnd-backup-pending { display: flex; font-size: 14px; flex-wrap: wrap; align-items: center; gap: 10px; padding: 8px 12px; border-radius: 10px; background: var(--warning-soft, rgba(230, 160, 40, 0.18)); }
.editor-links { display: flex; flex-direction: column; gap: 12px; }
.editor-links h3 { margin: 0; }
.editor-create { display: flex; gap: 8px; flex-wrap: wrap; }
.editor-create .text-input { flex: 1 1 240px; min-width: 0; }
.editor-link { display: flex; flex-direction: column; gap: 8px; padding: 12px 0; border-top: 1px solid var(--border, rgba(127, 127, 127, 0.25)); }
.editor-link-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.editor-link-head .editor-remove { margin-left: auto; }
.editor-badge { padding: 2px 8px; border-radius: 999px; background: var(--warning-soft, rgba(230, 160, 40, 0.18)); color: var(--warning, #b7791f); font-size: 12px; font-weight: 600; }
.editor-url { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.editor-url code { flex: 1 1 260px; min-width: 0; padding: 6px 8px; border-radius: 8px; background: var(--surface-2, rgba(127, 127, 127, 0.1)); overflow-wrap: anywhere; font-size: 12px; }
.editor-devices { display: flex; flex-direction: column; gap: 6px; margin: 0; padding: 0; list-style: none; }
.editor-device { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 6px 10px; border-radius: 10px; background: var(--surface-2, rgba(127, 127, 127, 0.08)); }
.editor-device-pending { outline: 1px solid var(--warning, #b7791f); }
.editor-device-name { font-weight: 600; }
.editor-device small { opacity: .75; }
.editor-device-actions { display: flex; gap: 6px; margin-left: auto; }
.editor-drafts { display: flex; flex-wrap: wrap; gap: 4px 10px; margin: 0; font-size: 13px; }
.editor-draft em { color: var(--success, #2f9e5b); font-style: normal; }
@media (max-width: 640px) {
  .adventures-item { flex-direction: column; }
  .editor-device-actions { margin-left: 0; }
}
</style>
