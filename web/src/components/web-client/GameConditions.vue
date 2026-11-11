<template>
  <div class="gc" data-ws-part="voice.game.conditions">
    <ul v-if="conditions.length || exhaustion" :class="['gc-list', { 'gc-compact': compact }]">
      <li v-for="id in conditions" :key="id">
        <button v-if="editable && !compact" type="button" class="gc-chip" :title="`${x.conditionRule[id]} — ${x.care.restore}`" @click="emit('toggle', id, false)">
          <span aria-hidden="true">{{ CONDITION_ICON[id] }}</span>{{ x.conditionName[id] }}<span class="gc-x" aria-hidden="true">×</span>
        </button>
        <span v-else class="gc-chip gc-chip-static" :title="`${x.conditionName[id]}: ${x.conditionRule[id]}`">
          <span aria-hidden="true">{{ CONDITION_ICON[id] }}</span><template v-if="!compact">{{ x.conditionName[id] }}</template>
          <span v-if="compact" class="gc-sr">{{ x.conditionName[id] }}</span>
        </span>
      </li>
      <li v-if="exhaustion">
        <span class="gc-chip gc-chip-static gc-chip-bad" :title="`${x.care.exhaustion} ${exhaustion}: ${x.care.exhaustionLevels[exhaustion]}`">
          <span aria-hidden="true">🥱</span>{{ compact ? exhaustion : `${x.care.exhaustion} ${exhaustion}` }}
        </span>
      </li>
    </ul>
    <div v-if="editable" class="gc-add">
      <button ref="opener" type="button" class="gc-add-btn" :aria-expanded="open" @click="open = !open">+ {{ x.care.addCondition }}</button>
      <div v-if="open" class="gc-pop" role="dialog" :aria-label="x.care.conditions" @keydown.esc.stop.prevent="close">
        <div class="gc-grid">
          <button
            v-for="id in CONDITIONS"
            :key="id"
            type="button"
            :class="['gc-opt', { 'gc-opt-on': conditions.includes(id) }]"
            :aria-pressed="conditions.includes(id)"
            :title="x.conditionRule[id]"
            @click="emit('toggle', id, !conditions.includes(id))"
          ><span aria-hidden="true">{{ CONDITION_ICON[id] }}</span>{{ x.conditionName[id] }}</button>
        </div>
        <div v-if="withExhaustion" class="gc-exh">
          <span>🥱 {{ x.care.exhaustion }}</span>
          <button type="button" class="gc-mini" :disabled="!exhaustion" :aria-label="`${x.care.exhaustion} −1`" @click="emit('exhaustion', (exhaustion ?? 0) - 1)">−</button>
          <strong>{{ exhaustion ?? 0 }}</strong>
          <button type="button" class="gc-mini" :disabled="(exhaustion ?? 0) >= 6" :aria-label="`${x.care.exhaustion} +1`" @click="emit('exhaustion', (exhaustion ?? 0) + 1)">+</button>
          <small>{{ x.care.exhaustionLevels[exhaustion ?? 0] }}</small>
        </div>
        <button type="button" class="gc-done" @click="close">{{ x.close }}</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { CONDITIONS, type ConditionId } from "../../../../src/shared/tabletop.js";
import { CONDITION_ICON } from "../../game/conditions.js";
import type { DndText } from "../../game/dnd-text.js";

withDefaults(defineProps<{
  x: DndText;
  conditions: readonly ConditionId[];
  exhaustion?: number;
  editable?: boolean;
  /** Icons only (party rows, map cards). */
  compact?: boolean;
  /** Offer the exhaustion stepper (heroes only). */
  withExhaustion?: boolean;
}>(), { exhaustion: 0, editable: false, compact: false, withExhaustion: false });
const emit = defineEmits<{ toggle: [id: ConditionId, active: boolean]; exhaustion: [level: number] }>();

const open = ref(false);
const opener = ref<HTMLButtonElement | null>(null);
function close(): void {
  open.value = false;
  opener.value?.focus();
}
</script>

<style scoped>
.gc { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; position: relative; }
.gc-list { display: flex; flex-wrap: wrap; gap: 4px; margin: 0; padding: 0; list-style: none; }
.gc-chip { display: inline-flex; align-items: center; gap: 4px; min-height: 26px; padding: 0 8px; border-radius: 999px; border: 1px solid var(--gm-line-2, #3a3c44); background: var(--gm-raised, #23252b); color: var(--gm-text, #e8e6e1); font: inherit; font-size: 12px; cursor: pointer; }
.gc-chip:hover .gc-x { color: var(--gm-bad, #e08a8a); }
.gc-chip-static { cursor: help; }
.gc-chip-bad { border-color: #6b3a3a; }
.gc-x { color: var(--gm-muted, #a9a6a0); }
.gc-compact .gc-chip { min-height: 22px; padding: 0 5px; font-size: 12px; }
.gc-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.gc-add { position: relative; }
.gc-add-btn { min-height: 26px; padding: 0 10px; border-radius: 999px; border: 1px dashed var(--gm-line-2, #3a3c44); background: transparent; color: var(--gm-muted, #a9a6a0); font: inherit; font-size: 12px; cursor: pointer; }
.gc-add-btn:hover, .gc-add-btn[aria-expanded="true"] { border-color: var(--gm-gold, #d9b46c); color: var(--gm-gold, #d9b46c); }
.gc-pop { position: absolute; z-index: 30; top: calc(100% + 6px); left: 0; display: flex; flex-direction: column; gap: 10px; width: 320px; padding: 12px; border-radius: 12px; border: 1px solid var(--gm-line-2, #3a3c44); background: var(--gm-card, #1a1b20); box-shadow: 0 16px 40px rgba(0, 0, 0, .5); }
.gc-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; }
.gc-opt { display: flex; align-items: center; gap: 6px; min-height: 30px; padding: 0 8px; border-radius: 8px; border: 1px solid transparent; background: var(--gm-raised, #23252b); color: var(--gm-text, #e8e6e1); font: inherit; font-size: 12px; text-align: left; cursor: pointer; }
.gc-opt:hover { border-color: var(--gm-line-2, #3a3c44); }
.gc-opt-on { border-color: var(--gm-gold, #d9b46c); background: var(--gm-gold-soft, #3a3020); }
.gc-exh { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; font-size: 13px; }
.gc-exh small { flex-basis: 100%; color: var(--gm-muted, #a9a6a0); }
.gc-mini { width: 28px; height: 28px; border-radius: 8px; border: 1px solid var(--gm-line-2, #3a3c44); background: transparent; color: var(--gm-text, #e8e6e1); font: inherit; cursor: pointer; }
.gc-mini:disabled { opacity: .35; cursor: default; }
.gc-done { align-self: flex-end; min-height: 30px; padding: 0 12px; border-radius: 8px; border: 1px solid var(--gm-line-2, #3a3c44); background: transparent; color: var(--gm-text, #e8e6e1); font: inherit; cursor: pointer; }
button:focus-visible { outline: 2px solid var(--gm-gold, #d9b46c); outline-offset: 2px; }
</style>
