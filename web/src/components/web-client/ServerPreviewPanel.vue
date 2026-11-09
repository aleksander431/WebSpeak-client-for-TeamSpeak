<template>
  <section
    class="server-preview"
    data-ws-part="home.server-preview"
    :data-ws-state="online ? 'occupied' : 'empty'"
    :aria-label="t('serverPreviewTitle')"
    ><header class="server-preview-head"
      ><span class="server-preview-title">{{ t("serverPreviewTitle") }}</span
      ><span
        class="server-preview-count"
        data-ws-part="home.server-preview.count"
        ><i aria-hidden="true"></i>{{ t("serverPreviewOnline", { count: online }) }}</span
      ></header
    ><p
      v-if="!online"
      class="server-preview-empty"
      >{{ t("serverPreviewEmpty") }}</p
    ><ul
      v-if="rows.length"
      class="server-preview-list"
      data-ws-part="home.server-preview.list"
      ><li
        v-for="row in rows"
        :key="row.channel.id"
        :style="{ '--depth': showAll ? row.depth : 0 }"
        ><button
          type="button"
          class="server-preview-channel"
          data-ws-part="home.server-preview.channel"
          :data-ws-state="row.path === selected ? 'selected' : row.channel.members.length ? 'occupied' : 'empty'"
          :aria-pressed="row.path === selected"
          :title="row.channel.passwordProtected ? t('serverPreviewPasswordChannel') : t('serverPreviewJoinChannel')"
          @click="emit('select', row.path === selected ? '' : row.path)"
          ><Icon
            :name="row.channel.passwordProtected ? 'lock' : 'hash'"
            :size="13" /><span class="server-preview-channel-name">{{ showAll ? row.channel.name : row.path }}</span
          ><small v-if="row.channel.members.length">{{ row.channel.members.length }}</small
          ><Icon
            v-if="row.path === selected"
            name="check"
            :size="13" /></button
        ><ul
          v-if="row.channel.members.length"
          class="server-preview-members"
          ><li
            v-for="(member, index) in row.channel.members"
            :key="index"
            :data-ws-state="member.away ? 'away' : 'present'"
            :title="member.nickname"
            ><span
              class="server-preview-initial"
              aria-hidden="true"
              >{{ initial(member.nickname) }}</span
            ><span class="server-preview-nick">{{ member.nickname }}</span
            ><Icon
              v-if="member.outputMuted"
              name="volume-off"
              :size="11"
              :aria-label="t('serverPreviewSoundOff')" /><Icon
              v-else-if="member.inputMuted"
              name="mic-off"
              :size="11"
              :aria-label="t('serverPreviewMicOff')" /><Icon
              v-if="member.away"
              name="moon"
              :size="11"
              :aria-label="t('away')" /></li
        ></ul
      ></li
    ></ul
    ><button
      v-if="hiddenCount > 0 || showAll"
      type="button"
      class="server-preview-toggle"
      data-ws-part="home.server-preview.toggle"
      :aria-expanded="showAll"
      @click="showAll = !showAll"
      ><Icon
        :name="showAll ? 'chevron-down' : 'chevron-right'"
        :size="13" />{{ showAll ? t("serverPreviewOccupiedOnly") : t("serverPreviewAllChannels", { count: total }) }}</button
  ></section>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import Icon from "../Icon.vue";
import { getChannelSpacer } from "../../../../src/shared/channel-spacer.js";
import { orderServerPreview, serverPreviewChannelPath, type ServerPreviewChannel } from "../../../../src/shared/server-preview.js";

const props = defineProps<{
  channels: readonly ServerPreviewChannel[];
  /** The join form's channel field, to mark the chosen channel. */
  selected: string;
  t: (key: string, variables?: Record<string, string | number>) => string;
}>();
const emit = defineEmits<{ select: [path: string] }>();

const showAll = ref(false);
const ordered = computed(() => orderServerPreview(props.channels)
  // Spacers are decoration in TeamSpeak's own tree, not places to join.
  .filter(row => !getChannelSpacer(row.channel))
  .map(row => ({ ...row, path: serverPreviewChannelPath(props.channels, row.channel.id) })));
const rows = computed(() => showAll.value ? ordered.value : ordered.value.filter(row => row.channel.members.length));
const online = computed(() => props.channels.reduce((sum, channel) => sum + channel.members.length, 0));
const total = computed(() => ordered.value.length);
const hiddenCount = computed(() => total.value - ordered.value.filter(row => row.channel.members.length).length);
const initial = (name: string) => Array.from(name.trim())[0]?.toUpperCase() ?? "?";
</script>

<style scoped>
.server-preview {
  --preview-accent: var(--skin-server-preview-accent, #12a28f);
  display: grid;
  gap: 6px;
  margin-top: 4px;
  padding: 10px 10px 8px;
  border: 1px solid color-mix(in srgb, currentColor 13%, transparent);
  border-radius: 10px;
  background: color-mix(in srgb, currentColor 3%, transparent);
  font-size: 12px;
}
.server-preview-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 0 2px;
}
.server-preview-title {
  opacity: .7;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: .06em;
  text-transform: uppercase;
}
.server-preview-count {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  opacity: .8;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
.server-preview-count i {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--preview-accent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--preview-accent) 22%, transparent);
}
.server-preview[data-ws-state="empty"] .server-preview-count i {
  background: color-mix(in srgb, currentColor 35%, transparent);
  box-shadow: none;
}
.server-preview-empty {
  margin: 0;
  padding: 2px 2px 0;
  opacity: .6;
  font-size: 11.5px;
}
.server-preview-list {
  display: grid;
  gap: 2px;
  max-height: 220px;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  list-style: none;
  scrollbar-width: thin;
}
.server-preview-list > li {
  padding-left: calc(var(--depth, 0) * 12px);
}
.server-preview-channel {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  min-height: 28px;
  padding: 3px 8px;
  color: inherit;
  border: 0;
  border-radius: 7px;
  background: transparent;
  font: inherit;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
}
.server-preview-channel:hover {
  background: color-mix(in srgb, currentColor 7%, transparent);
}
.server-preview-channel:focus-visible {
  outline: 2px solid var(--preview-accent);
  outline-offset: -2px;
}
.server-preview-channel > :deep(svg) {
  flex: none;
  opacity: .55;
}
.server-preview-channel[data-ws-state="empty"] {
  opacity: .62;
  font-weight: 500;
}
.server-preview-channel[data-ws-state="selected"] {
  color: var(--preview-accent);
  background: color-mix(in srgb, var(--preview-accent) 13%, transparent);
}
.server-preview-channel[data-ws-state="selected"] > :deep(svg) {
  opacity: 1;
}
.server-preview-channel-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.server-preview-channel small {
  padding: 1px 6px;
  border-radius: 99px;
  background: color-mix(in srgb, currentColor 9%, transparent);
  font-size: 10.5px;
  font-variant-numeric: tabular-nums;
}
.server-preview-members {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 6px;
  margin: 1px 0 5px;
  padding: 0 0 0 28px;
  list-style: none;
}
.server-preview-members li {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  max-width: 100%;
  padding: 2px 8px 2px 2px;
  border-radius: 99px;
  background: color-mix(in srgb, currentColor 6%, transparent);
  font-size: 11.5px;
}
.server-preview-members li[data-ws-state="away"] {
  opacity: .6;
}
.server-preview-members li > :deep(svg) {
  flex: none;
  opacity: .6;
}
.server-preview-initial {
  display: grid;
  flex: none;
  place-items: center;
  width: 18px;
  height: 18px;
  color: #fff;
  border-radius: 50%;
  background: var(--preview-accent);
  font-size: 10px;
  font-weight: 700;
}
.server-preview-nick {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.server-preview-toggle {
  display: inline-flex;
  align-items: center;
  justify-self: start;
  gap: 4px;
  padding: 2px 4px;
  color: var(--preview-accent);
  border: 0;
  background: none;
  font: inherit;
  font-size: 11.5px;
  font-weight: 600;
  cursor: pointer;
}
.server-preview-toggle:hover {
  text-decoration: underline;
}
</style>
