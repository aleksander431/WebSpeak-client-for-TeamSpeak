<template>
  <div class="gr" data-ws-part="voice.game.resources">
    <div v-for="resource in hero.resources ?? []" :key="resource.id" class="gr-row">
      <span class="gr-name" :data-tip="tips?.resource">
        <strong>{{ resource.name }}</strong>
        <small>{{ resource.recharge === 'short' ? x.care.short : x.care.long }}</small>
      </span>
      <span v-if="resource.max <= 8" class="gr-pips" role="group" :aria-label="`${resource.name}: ${left(resource)} / ${resource.max}`">
        <button
          v-for="n in resource.max"
          :key="n"
          type="button"
          :class="['gr-pip', { 'gr-pip-on': n <= left(resource) }]"
          :disabled="!editable"
          :aria-label="n <= left(resource) ? `${x.care.spend}: ${resource.name}` : `${x.care.restore}: ${resource.name}`"
          @click="emit('use', resource.id, n <= left(resource) ? spent(resource) + 1 : spent(resource) - 1)"
        ></button>
      </span>
      <span v-else class="gr-count">
        <button type="button" class="gr-mini" :disabled="!editable || !left(resource)" :aria-label="`${x.care.spend}: ${resource.name}`" @click="emit('use', resource.id, spent(resource) + 1)">−</button>
        <strong>{{ left(resource) }}<small>/{{ resource.max }}</small></strong>
        <button type="button" class="gr-mini" :disabled="!editable || !spent(resource)" :aria-label="`${x.care.restore}: ${resource.name}`" @click="emit('use', resource.id, spent(resource) - 1)">+</button>
      </span>
    </div>
    <div class="gr-row gr-dice">
      <span class="gr-name" :data-tip="tips?.hitDice">
        <strong>{{ x.care.hitDice }}</strong>
        <small>{{ seat.hitDice ?? hero.level }}/{{ hero.level }} · {{ diePrefix }}{{ hero.hitDie ?? 8 }}</small>
      </span>
      <button v-if="editable" type="button" class="gr-btn" :disabled="!(seat.hitDice ?? hero.level) || inCombat || !seat.hp" :title="x.care.hitDieHint" @click="emit('hitDie')">{{ x.care.spendHitDie }}</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { HeroResource, HeroSheet, SeatView } from "../../../../src/shared/tabletop.js";
import type { DndText } from "../../game/dnd-text.js";

const props = defineProps<{ x: DndText; hero: HeroSheet; seat: SeatView; editable: boolean; inCombat: boolean; diePrefix: string; tips?: { resource: string; hitDice: string } }>();
const emit = defineEmits<{ use: [resourceId: string, used: number]; hitDie: [] }>();

const spent = (resource: HeroResource) => Math.min(resource.max, props.seat.used?.[resource.id] ?? 0);
const left = (resource: HeroResource) => resource.max - spent(resource);
</script>

<style scoped>
.gr { display: flex; flex-direction: column; gap: 8px; }
.gr-row { display: flex; align-items: center; gap: 10px; min-height: 32px; }
.gr-name { display: flex; flex-direction: column; gap: 1px; flex: 1 1 auto; min-width: 0; line-height: 1.25; }
.gr-name small { font-size: 11px; color: var(--gm-muted, #a9a6a0); }
.gr-pips { display: flex; flex-wrap: wrap; gap: 5px; justify-content: flex-end; }
.gr-pip { width: 18px; height: 18px; padding: 0; border-radius: 50%; border: 2px solid var(--gm-gold, #d9b46c); background: transparent; cursor: pointer; }
.gr-pip-on { background: var(--gm-gold, #d9b46c); box-shadow: 0 0 8px rgba(217, 180, 108, .35); }
.gr-pip:disabled { cursor: default; }
.gr-count { display: inline-flex; align-items: center; gap: 8px; }
.gr-count small { color: var(--gm-muted, #a9a6a0); }
.gr-mini { width: 28px; height: 28px; border-radius: 8px; border: 1px solid var(--gm-line-2, #3a3c44); background: transparent; color: var(--gm-text, #e8e6e1); font: inherit; cursor: pointer; }
.gr-mini:disabled { opacity: .35; cursor: default; }
.gr-dice { padding-top: 8px; border-top: 1px solid var(--gm-line, #2a2c33); }
.gr-btn { min-height: 32px; padding: 0 12px; border-radius: 8px; border: 1px solid var(--gm-line-2, #3a3c44); background: transparent; color: var(--gm-text, #e8e6e1); font: inherit; font-size: 13px; cursor: pointer; }
.gr-btn:hover:not(:disabled) { border-color: var(--gm-gold, #d9b46c); color: var(--gm-gold, #d9b46c); }
.gr-btn:disabled { opacity: .45; cursor: default; }
button:focus-visible { outline: 2px solid var(--gm-gold, #d9b46c); outline-offset: 2px; }
</style>
