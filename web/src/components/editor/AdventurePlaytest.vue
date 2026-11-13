<template>
  <GamePanel
    v-if="run"
    :key="`${generation}-${view}`"
    :client="run.clients[view]"
    :channel-name="t.playtestTitle"
    :language="russian ? 'ru' : 'en'"
    @close="emit('close')"
  >
    <template #actions>
      <div class="pt-switch" role="radiogroup" :aria-label="t.playtestTitle">
        <button
          v-for="role in ROLES"
          :key="role"
          type="button"
          role="radio"
          :aria-checked="view === role"
          :class="['pt-role', { 'pt-role-on': view === role }]"
          @click="view = role"
        >{{ role === "gm" ? t.playtestGm : t.playtestPlayer }}</button>
      </div>
      <button type="button" class="pt-restart" @click="restart">{{ t.playtestRestart }}</button>
    </template>
  </GamePanel>
  <div v-else class="pt-failed" role="alertdialog" aria-modal="true">
    <div class="pt-failed-card">
      <p>{{ problem }}</p>
      <button type="button" class="pt-restart" @click="emit('close')">OK</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, ref, shallowRef } from "vue";
import GamePanel from "../web-client/GamePanel.vue";
import type { AdventureDraft } from "../../../../src/shared/adventure-draft.js";
import { explainProblem, fill, type EditorText } from "../../editor/editor-text.js";
import { startPlaytest, type Playtest, type PlaytestRole } from "../../editor/playtest.js";

const ROLES: PlaytestRole[] = ["gm", "player"];

const props = defineProps<{ t: EditorText; russian: boolean; draftId: string; draft: () => AdventureDraft }>();
const emit = defineEmits<{ close: [] }>();

const run = shallowRef<Playtest | null>(null);
const problem = ref("");
const view = ref<PlaytestRole>("gm");
const generation = ref(0);

/** Starts over from the draft as it is now, so edits made meanwhile are picked up. */
function restart(): void {
  run.value?.dispose();
  run.value = null;
  try {
    run.value = startPlaytest(props.draft(), props.draftId, { gm: props.t.playtestGm, player: props.t.playtestPlayer });
    generation.value++;
  } catch (error: unknown) {
    problem.value = fill(props.t.playtestFailed, { problem: explainProblem(props.t, error instanceof Error ? error.message : String(error)) });
  }
}

restart();
onBeforeUnmount(() => run.value?.dispose());
</script>

<style scoped>
.pt-switch { display: inline-flex; gap: 2px; padding: 3px; border-radius: 10px; border: 1px solid #3a3c44; background: #141519; }
.pt-role, .pt-restart { min-height: 30px; padding: 0 12px; border-radius: 8px; border: 0; background: transparent; color: #a9a6a0; font: inherit; font-size: 13px; cursor: pointer; }
.pt-role-on { background: #d9b46c; color: #1a1408; font-weight: 600; }
.pt-restart { border: 1px solid #3a3c44; color: #e8e6e1; }
.pt-restart:hover, .pt-role:not(.pt-role-on):hover { color: #e8e6e1; }
.pt-failed { position: fixed; inset: 0; z-index: 60; display: grid; place-items: center; padding: 20px; background: rgba(6, 7, 10, .7); }
.pt-failed-card { display: grid; gap: 14px; max-width: 460px; padding: 20px; border-radius: 14px; border: 1px solid #3a3c44; background: #1a1b20; color: #e8e6e1; }
.pt-failed-card button { justify-self: end; }
</style>
