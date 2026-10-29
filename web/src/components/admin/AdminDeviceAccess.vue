<template>
  <section class="page-content operations-page device-access-page" data-admin-scope="webspeak">
    <div class="page-heading"
      ><div
        ><h2>{{ tr("deviceAccessTitle") }}</h2
        ><p>{{ tr("deviceAccessLead") }}</p></div
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

    <article class="operation-card device-access-setting"
      ><label
        :key="settingRevision"
        class="choice toggle-choice"
        :class="{ selected: access.required }"
        ><input
          type="checkbox"
          :checked="access.required"
          :disabled="savingSetting || !access.loaded"
          @change="toggleRequired"
        /><span
          ><strong>{{ tr("deviceApprovalToggle") }}</strong
          ><small>{{ tr("deviceApprovalToggleLead") }}</small></span
        ></label
      ><p
        v-if="access.loaded && !access.required"
        class="device-access-hint"
        ><Icon
          name="info"
          :size="15"
        />{{ tr("deviceApprovalOffHint") }}</p
      ></article
    >

    <article
      v-for="group in groups"
      :key="group.status"
      class="operation-card"
      :data-device-group="group.status"
      ><header
        ><div
          ><h3>{{ group.title }}</h3
          ><p>{{ group.lead }}</p></div
        ><strong>{{ group.devices.length }}</strong></header
      ><div
        v-if="group.devices.length"
        class="invite-list"
        ><div
          v-for="device in group.devices"
          :key="device.id"
          class="invite-row device-row"
          ><div
            ><strong>{{ device.nickname || tr("deviceUnnamed") }}</strong
            ><small :title="device.userAgent">{{ describeDevice(device) }}</small
            ><small>{{ tr(device.status === "pending" ? "deviceRequestedAt" : "deviceLastSeenAt", { date: formatDate(device.status === "pending" ? device.createdAt : device.lastSeenAt) }) }}</small></div
          ><div class="invite-row-meta"
            ><template v-if="device.status === 'pending'"
              ><button
                class="primary-button device-approve"
                type="button"
                :disabled="busyDevices.has(device.id)"
                @click="decide(device, 'approve')"
                >{{ tr("deviceApprove") }}</button
              ><button
                class="text-danger"
                type="button"
                :disabled="busyDevices.has(device.id)"
                @click="decide(device, 'deny')"
                >{{ tr("deviceDeny") }}</button
              ></template
            ><template v-else-if="device.status === 'approved'"
              ><span class="state-pill">{{ tr("deviceApproved") }}</span
              ><button
                class="text-danger"
                type="button"
                :disabled="busyDevices.has(device.id)"
                @click="decide(device, 'deny')"
                >{{ tr("deviceRevoke") }}</button
              ></template
            ><template v-else
              ><span class="state-pill revoked">{{ tr("deviceDenied") }}</span
              ><button
                class="secondary-button device-small-button"
                type="button"
                :disabled="busyDevices.has(device.id)"
                @click="decide(device, 'approve')"
                >{{ tr("deviceApprove") }}</button
              ><button
                class="text-danger"
                type="button"
                :disabled="busyDevices.has(device.id)"
                @click="decide(device, 'forget')"
                >{{ tr("deviceForget") }}</button
              ></template
            ></div
          ></div
        ></div
      ><div
        v-else
        class="operation-empty"
        ><Icon
          :name="group.status === 'pending' ? 'check' : 'users'"
          :size="22"
        /><span>{{ group.empty }}</span></div
      ></article
    >
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import Icon from "../Icon.vue";
import type { DeviceAccessDevice } from "../../../../src/shared/admin-responses.js";
import type { AdminDeviceAccessModel } from "../../composables/useAdminDeviceAccess.js";
import type { useAdminI18n } from "../../composables/useAdminI18n.js";

const props = defineProps<{
  model: AdminDeviceAccessModel;
  i18n: Pick<ReturnType<typeof useAdminI18n>, "tr" | "formatDate">;
}>();
const { access, loading, savingSetting, busyDevices, load, setRequired, decide } = props.model;
const { tr, formatDate } = props.i18n;
const settingRevision = ref(0);

const groups = computed(() => [
  { status: "pending", title: tr("devicePendingTitle"), lead: tr("devicePendingLead"), empty: tr("devicePendingEmpty"), devices: access.devices.filter((device) => device.status === "pending") },
  { status: "approved", title: tr("deviceApprovedTitle"), lead: tr("deviceApprovedLead"), empty: tr("deviceApprovedEmpty"), devices: access.devices.filter((device) => device.status === "approved") },
  { status: "denied", title: tr("deviceDeniedTitle"), lead: tr("deviceDeniedLead"), empty: tr("deviceDeniedEmpty"), devices: access.devices.filter((device) => device.status === "denied") },
] as const);

async function toggleRequired(event: Event) {
  const requested = (event.target as HTMLInputElement).checked;
  await setRequired(requested);
  // If saving failed, remount the switch so it shows the real setting again.
  if (access.required !== requested) settingRevision.value += 1;
}

function describeDevice(device: DeviceAccessDevice): string {
  return [device.clientIp, browserSummary(device.userAgent)].filter(Boolean).join(" · ");
}

function browserSummary(userAgent: string): string {
  if (!userAgent) return "";
  const browser = /Edg\//.test(userAgent) ? "Edge"
    : /OPR\/|Opera/.test(userAgent) ? "Opera"
      : /YaBrowser\//.test(userAgent) ? "Yandex Browser"
        : /Firefox\//.test(userAgent) ? "Firefox"
          : /Chrome\//.test(userAgent) ? "Chrome"
            : /Safari\//.test(userAgent) ? "Safari"
              : "";
  const system = /Android/.test(userAgent) ? "Android"
    : /iPhone|iPad|iPod/.test(userAgent) ? "iOS"
      : /Windows/.test(userAgent) ? "Windows"
        : /Mac OS X|Macintosh/.test(userAgent) ? "macOS"
          : /Linux/.test(userAgent) ? "Linux"
            : "";
  const summary = [browser, system].filter(Boolean).join(", ");
  return summary || userAgent.slice(0, 60);
}
</script>

<style scoped>
.device-access-setting {
  display: grid;
  gap: 10px;
}

.device-access-hint {
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 0;
  color: #8a6537;
  font-size: 12px;
}

.device-row > div:first-child small + small {
  margin-top: 1px;
}

.device-approve,
.device-small-button {
  min-height: 30px;
  padding: 0 12px;
  font-size: 12px;
}

:global(html[data-ws-route="admin"][data-theme="dark"] .device-access-hint) {
  color: #e4c48f;
}
</style>
