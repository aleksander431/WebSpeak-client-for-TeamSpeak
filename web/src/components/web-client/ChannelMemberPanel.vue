<template>
  <aside
    :class="['member-panel', { 'mobile-section-visible': mobileVisible }]"
    data-ws-part="voice.member-panel"
  >
    <div
      class="member-panel-heading"
      data-ws-part="voice.member-panel.heading"
      ><div
        ><h2>{{ t("people") }}</h2></div
      ><button
        type="button"
        class="status-button"
        :class="{ active: away }"
        @click="toggleAway"
        ><span class="status-dot"></span>{{ away ? t("away") : t("available") }}</button
      ></div
    >
    <div
      class="member-search"
      data-ws-part="voice.member-panel.search"
      ><Icon
        name="search"
        :size="15" /><input
        v-model="memberQuery"
        :placeholder="t('searchMembers')"
        :aria-label="t('searchMembers')"
    /></div>
    <div
      class="member-tree"
      data-ws-part="voice.member-panel.channels"
    >
      <section
        v-for="channelItem in filteredMemberChannels"
        :key="channelItem.id"
        :class="[
          'member-channel-group',
          {
            current: currentChannelId === channelItem.id,
            'drag-over': dragOverChannelId === channelItem.id,
          },
        ]"
        data-ws-part="voice.channel-group"
        :data-ws-state="
          currentChannelId === channelItem.id
            ? 'current'
            : dragOverChannelId === channelItem.id
              ? 'drag-over'
              : 'idle'
        "
        :data-member-channel-id="channelItem.id"
        :style="{ marginLeft: `${channelItem.depth * 10}px` }"
        @dragover="onChannelDragOver(channelItem, $event)"
        @dragleave="onChannelDragLeave(channelItem, $event)"
        @drop="onChannelDrop(channelItem, $event)"
        @pointermove="onMemberPointerMove($event)"
        @pointerup="onMemberPointerUp($event)"
        @pointercancel="onMemberPointerCancel($event)"
      >
        <button
          class="member-channel-heading"
          data-ws-part="voice.channel-group.heading"
          :data-spacer="getChannelSpacer(channelItem) ? 'true' : undefined"
          :data-ws-state="channelItem.id === currentChannelId ? 'current' : 'idle'"
          :title="t('switchChannel')"
          @click="emit('selectChannel', channelItem)"
        >
          <Icon
            v-if="!getChannelSpacer(channelItem)"
            :name="channelItem.passwordProtected ? 'lock' : 'speaker'"
            :size="16"
          />
          <ChannelSpacer v-if="getChannelSpacer(channelItem)" :spacer="getChannelSpacer(channelItem)!" />
          <span v-else>{{ channelItem.name }}</span>
          <small v-if="!getChannelSpacer(channelItem)">{{ channelItem.members.length }}</small>
        </button>
        <div
          v-if="channelItem.members.length"
          class="member-list"
          data-ws-part="voice.channel-group.members"
        >
          <div
            v-for="member in channelItem.members"
            :key="`${channelItem.id}-${member.id}`"
            :class="['member-row', { dragging: draggedMember?.id === member.id }]"
            data-ws-part="voice.member-row"
            :data-ws-state="
              draggedMember?.id === member.id
                ? 'dragging'
                : isSpeaking(member)
                  ? 'speaking'
                  : 'connected'
            "
            :draggable="!member.isSelf"
            @dragstart="onMemberDragStart(member, $event)"
            @dragend="onMemberDragEnd"
            @pointerdown="onMemberPointerDown(member, $event)"
            @pointermove="onMemberPointerMove($event)"
            @pointerup="onMemberPointerUp($event)"
            @pointercancel="onMemberPointerCancel($event)"
            @contextmenu.prevent="openMemberMenu(member, $event)"
          >
            <div
              :class="['member-avatar', { speaking: isSpeaking(member) }]"
              data-ws-part="voice.member-row.avatar"
              :style="avatarStyle(member.nickname, member.isSelf, member.avatar)"
              >{{ member.avatar ? "" : avatarInitial(member.nickname)
              }}<span class="member-presence"></span
            ></div>
            <div
              class="member-copy"
              data-ws-part="voice.member-row.copy"
              ><strong>{{ memberDisplayName(member) }}</strong
              ><span>{{ t(memberPresenceKey(member, isSpeaking(member))) }}</span></div
            >
            <div
              class="member-flags"
              data-ws-part="voice.member-row.flags"
              :aria-label="t('memberStates')"
              ><button
                v-if="isScreenSharing?.(member) && toggleScreenShare && !member.isSelf"
                type="button"
                class="member-screen-share"
                data-ws-part="voice.member-row.screen-share"
                :data-ws-state="isWatchingScreenShare?.(member) ? 'viewing' : 'idle'"
                :aria-pressed="isWatchingScreenShare?.(member) ? 'true' : 'false'"
                :title="isWatchingScreenShare?.(member) ? t('watching') : t('watchScreenShare')"
                :aria-label="isWatchingScreenShare?.(member) ? t('watching') : t('watchScreenShare')"
                draggable="false"
                @click.stop="toggleScreenShare(member)"
                @dblclick.stop
                ><Icon
                  name="monitor"
                  :size="12" /></button
              ><span
                v-else-if="isScreenSharing?.(member)"
                class="member-screen-share"
                data-ws-part="voice.member-row.screen-share"
                :title="t('sharingScreen')"
                :aria-label="t('sharingScreen')"
                ><Icon
                  name="monitor"
                  :size="12" /></span
              ><span
                v-if="member.away"
                :title="t('away')"
                :aria-label="t('away')"
                ><Icon
                  name="clock"
                  :size="13" /></span
              ><span
                v-if="member.inputMuted"
                :title="t('inputMuted')"
                :aria-label="t('inputMuted')"
                ><Icon
                  name="mic-off"
                  :size="13" /></span
              ><span
                v-if="member.outputMuted"
                :title="t('outputMuted')"
                :aria-label="t('outputMuted')"
                ><Icon
                  name="volume-off"
                  :size="13" /></span
              ><span
                v-if="member.channelCommander"
                :title="t('channelCommander')"
                :aria-label="t('channelCommander')"
                ><Icon
                  name="shield"
                  :size="13" /></span
            ></div>
            <div
              class="member-volume"
              data-ws-part="voice.member-row.volume"
              ><Icon
                :name="(volumes[member.id] ?? 1) === 0 ? 'volume-off' : 'volume'"
                :size="14" /><input
                type="range"
                min="0"
                max="400"
                :value="(volumes[member.id] ?? 1) * 100"
                :style="rangeStyle((volumes[member.id] ?? 1) / 4, 1)"
                :aria-label="t('memberVolume')"
                @input="emit('volumeInput', member.id, $event)"
            /></div>
            <button
              v-if="isMobileViewport && !member.isSelf"
              type="button"
              class="member-action-button"
              :aria-label="t('moreMemberOptions')"
              @click.stop="openMemberActions(member, $event)"
              ><Icon
                name="more"
                :size="18"
            /></button>
          </div>
        </div>
        <div
          v-else-if="!getChannelSpacer(channelItem)"
          class="channel-no-members"
          >{{ t("noMembersInChannel") }}</div
        >
      </section>
    </div>
    <div
      v-if="!filteredMemberChannels.length"
      class="member-empty"
      >{{ t("noMatchingMembers") }}</div
    >
    <slot />
  </aside>
</template>

<script setup lang="ts">
import type { CSSProperties } from "vue";
import Icon from "../Icon.vue";
import ChannelSpacer from "./ChannelSpacer.vue";
import { getChannelSpacer } from "../../../../src/shared/channel-spacer.js";
import { memberPresenceKey } from "../../services/member-presence.js";
import type { TreeChannel } from "../../composables/useWebClientChannels.js";
import type { ChannelMember } from "../../composables/useVoiceWebSocket.js";
import type { useWebClientMembers } from "../../composables/useWebClientMembers.js";

type MemberPanelModel = Pick<ReturnType<typeof useWebClientMembers>,
  | "away"
  | "draggedMember"
  | "dragOverChannelId"
  | "toggleAway"
  | "isSpeaking"
  | "memberDisplayName"
  | "openMemberMenu"
  | "openMemberActions"
  | "onMemberDragStart"
  | "onMemberDragEnd"
  | "onMemberPointerDown"
  | "onMemberPointerMove"
  | "onMemberPointerUp"
  | "onMemberPointerCancel"
  | "onChannelDragOver"
  | "onChannelDragLeave"
  | "onChannelDrop"
>;
const memberQuery = defineModel<string>("query", { required: true });
const props = defineProps<{
  model: MemberPanelModel;
  filteredMemberChannels: readonly TreeChannel[];
  currentChannelId?: string;
  mobileVisible: boolean;
  isMobileViewport: boolean;
  volumes: Record<number, number>;
  avatarStyle: (name: string, isSelf?: boolean, avatar?: string) => CSSProperties;
  avatarInitial: (name: string) => string;
  rangeStyle: (value: number, max: number) => CSSProperties;
  t: (key: string, variables?: Record<string, string | number>) => string;
  /** Screen shares: a green badge on the row; one click starts or stops watching. */
  isScreenSharing?: (member: ChannelMember) => boolean;
  isWatchingScreenShare?: (member: ChannelMember) => boolean;
  toggleScreenShare?: (member: ChannelMember) => void;
}>();
const emit = defineEmits<{
  selectChannel: [channel: TreeChannel];
  volumeInput: [clientId: number, event: Event];
}>();

// The page retains the controller and slot content across mobile view changes.
const {
  away,
  draggedMember,
  dragOverChannelId,
  toggleAway,
  isSpeaking,
  memberDisplayName,
  openMemberMenu,
  openMemberActions,
  onMemberDragStart,
  onMemberDragEnd,
  onMemberPointerDown,
  onMemberPointerMove,
  onMemberPointerUp,
  onMemberPointerCancel,
  onChannelDragOver,
  onChannelDragLeave,
  onChannelDrop,
} = props.model;
</script>

<style scoped>
.member-screen-share {
  display: inline-grid;
  box-sizing: border-box;
  width: 18px;
  height: 18px;
  flex: 0 0 18px;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 5px;
  color: #fff;
  background: #72c800;
  line-height: 0;
}
button.member-screen-share {
  cursor: pointer;
  transition: filter .15s ease, box-shadow .15s ease;
}
button.member-screen-share:hover {
  filter: brightness(1.12);
  box-shadow: 0 0 0 2px color-mix(in srgb, #72c800 35%, transparent);
}
button.member-screen-share:focus-visible {
  outline: 2px solid #72c800;
  outline-offset: 2px;
}
button.member-screen-share[data-ws-state="viewing"] {
  color: #4f9400;
  background: transparent;
  box-shadow: inset 0 0 0 1.5px #72c800;
}
</style>
