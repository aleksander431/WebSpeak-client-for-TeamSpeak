<template>
  <div class="mp">
    <div class="mp-tools">
      <div class="mp-modes" role="radiogroup">
        <button
          v-for="item in (['spawn', 'monster', 'reveal'] as const)"
          :key="item"
          type="button"
          role="radio"
          :aria-checked="mode === item"
          :class="['mp-mode', { 'mp-mode-on': mode === item }]"
          @click="mode = item"
        >{{ item === "spawn" ? "🧭" : item === "monster" ? "👹" : "☀️" }} {{ t.mapModes[item] }}</button>
      </div>
      <template v-if="mode === 'monster'">
        <label v-if="monsters.length" class="mp-field">
          {{ t.placeMonster }}
          <select v-model="monsterId" class="mp-select">
            <option v-for="monster in monsters" :key="monster.id" :value="monster.id">{{ monster.name }}</option>
          </select>
        </label>
        <label v-if="monsters.length" class="mp-check"><input v-model="hideNew" type="checkbox" /> {{ t.hidden }}</label>
        <span v-else class="mp-hint">{{ t.noMonstersYet }}</span>
      </template>
    </div>
    <p class="mp-hint">{{ t.mapHint[mode] }}</p>
    <div class="mp-stage" :style="{ aspectRatio: `${cols} / ${rows}` }">
      <img :src="image" alt="" draggable="false" />
      <div
        ref="overlay"
        class="mp-overlay"
        :style="{ gridTemplateColumns: `repeat(${cols}, 1fr)`, gridTemplateRows: `repeat(${rows}, 1fr)` }"
        @pointerdown="onDown"
        @pointermove="onMove"
        @pointerup="onUp"
        @pointercancel="drag = null"
      >
        <div
          v-for="rect in reveal"
          :key="rect.join(',')"
          class="mp-reveal"
          :style="{ gridColumn: `${rect[0] + 1} / span ${rect[2]}`, gridRow: `${rect[1] + 1} / span ${rect[3]}` }"
        ></div>
        <div
          v-if="drag"
          class="mp-reveal mp-reveal-draft"
          :style="{ gridColumn: `${dragRect[0] + 1} / span ${dragRect[2]}`, gridRow: `${dragRect[1] + 1} / span ${dragRect[3]}` }"
        ></div>
        <div
          v-for="(cell, index) in spawn"
          :key="`s${index}`"
          class="mp-spawn"
          :style="{ gridColumn: cell[0] + 1, gridRow: cell[1] + 1 }"
        >{{ index + 1 }}</div>
        <div
          v-for="(entry, index) in encounter"
          :key="`m${index}`"
          :class="['mp-monster', { 'mp-monster-hidden': entry.hidden }]"
          :style="{ gridColumn: entry.x + 1, gridRow: entry.y + 1 }"
          :title="nameOf(entry.monsterId)"
        >
          <img v-if="portraitOf(entry.monsterId)" :src="portraitOf(entry.monsterId)" alt="" />
          <span v-else>{{ nameOf(entry.monsterId).slice(0, 1) }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { EditorText } from "../../editor/editor-text.js";

type Cell = [number, number];
type Rect = [number, number, number, number];
interface Placed { monsterId: string; x: number; y: number; hidden?: boolean }

const props = defineProps<{
  t: EditorText;
  image: string;
  cols: number;
  rows: number;
  spawn: Cell[];
  encounter: Placed[];
  reveal: Rect[];
  monsters: Array<{ id: string; name: string; portrait?: string }>;
}>();
const emit = defineEmits<{ spawn: [cells: Cell[]]; encounter: [entries: Placed[]]; reveal: [rects: Rect[]] }>();

const mode = ref<"spawn" | "monster" | "reveal">("spawn");
const monsterId = ref(props.monsters[0]?.id ?? "");
const hideNew = ref(true);
const overlay = ref<HTMLElement | null>(null);
const drag = ref<{ from: Cell; to: Cell } | null>(null);
watch(() => props.monsters, list => { if (!list.some(item => item.id === monsterId.value)) monsterId.value = list[0]?.id ?? ""; });

const dragRect = computed<Rect>(() => drag.value ? rectOf(drag.value.from, drag.value.to) : [0, 0, 1, 1]);

function cellAt(event: PointerEvent): Cell | null {
  const box = overlay.value?.getBoundingClientRect();
  if (!box) return null;
  const x = Math.floor(((event.clientX - box.left) / box.width) * props.cols);
  const y = Math.floor(((event.clientY - box.top) / box.height) * props.rows);
  if (x < 0 || y < 0 || x >= props.cols || y >= props.rows) return null;
  return [x, y];
}

function rectOf(a: Cell, b: Cell): Rect {
  const x = Math.min(a[0], b[0]);
  const y = Math.min(a[1], b[1]);
  return [x, y, Math.abs(a[0] - b[0]) + 1, Math.abs(a[1] - b[1]) + 1];
}

function inside(rect: Rect, [x, y]: Cell): boolean {
  return x >= rect[0] && y >= rect[1] && x < rect[0] + rect[2] && y < rect[1] + rect[3];
}

function onDown(event: PointerEvent): void {
  const cell = cellAt(event);
  if (!cell) return;
  if (mode.value === "spawn") {
    const at = props.spawn.findIndex(item => item[0] === cell[0] && item[1] === cell[1]);
    if (at >= 0) emit("spawn", props.spawn.filter((_, index) => index !== at));
    else if (props.spawn.length < 12) emit("spawn", [...props.spawn, cell]);
    return;
  }
  if (mode.value === "monster") {
    const at = props.encounter.findIndex(item => item.x === cell[0] && item.y === cell[1]);
    if (at >= 0) emit("encounter", props.encounter.filter((_, index) => index !== at));
    else if (monsterId.value && props.encounter.length < 40) {
      emit("encounter", [...props.encounter, { monsterId: monsterId.value, x: cell[0], y: cell[1], ...(hideNew.value ? { hidden: true } : {}) }]);
    }
    return;
  }
  const hit = props.reveal.findIndex(rect => inside(rect, cell));
  if (hit >= 0) {
    emit("reveal", props.reveal.filter((_, index) => index !== hit));
    return;
  }
  drag.value = { from: cell, to: cell };
  (event.target as Element).setPointerCapture?.(event.pointerId);
}

function onMove(event: PointerEvent): void {
  if (!drag.value) return;
  const cell = cellAt(event);
  if (cell) drag.value = { ...drag.value, to: cell };
}

function onUp(): void {
  if (!drag.value) return;
  const rect = dragRect.value;
  drag.value = null;
  if (props.reveal.length < 40) emit("reveal", [...props.reveal, rect]);
}

function nameOf(id: string): string {
  return props.monsters.find(item => item.id === id)?.name ?? id;
}
function portraitOf(id: string): string | undefined {
  return props.monsters.find(item => item.id === id)?.portrait;
}
</script>

<style scoped>
.mp { display: flex; flex-direction: column; gap: 8px; }
.mp-tools { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
.mp-modes { display: inline-flex; gap: 4px; padding: 3px; border-radius: 12px; background: var(--ed-raised); }
.mp-mode { min-height: 32px; padding: 0 12px; border-radius: 9px; border: 0; background: transparent; color: var(--ed-muted); font: inherit; font-size: 13px; cursor: pointer; }
.mp-mode-on { background: var(--ed-gold); color: #1a1408; font-weight: 600; }
.mp-field { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; color: var(--ed-muted); }
.mp-select { min-height: 32px; padding: 0 8px; border-radius: 8px; border: 1px solid var(--ed-line-2); background: var(--ed-raised); color: var(--ed-text); font: inherit; }
.mp-check { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; }
.mp-hint { margin: 0; color: var(--ed-muted); font-size: 12.5px; }
.mp-stage { position: relative; width: 100%; max-height: 70vh; border-radius: 12px; overflow: hidden; border: 1px solid var(--ed-line-2); background: #0b0c0f; }
.mp-stage > img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: fill; user-select: none; }
.mp-overlay {
  position: absolute; inset: 0; display: grid; cursor: crosshair; touch-action: none;
  background-image: linear-gradient(to right, rgba(255, 255, 255, .12) 1px, transparent 1px), linear-gradient(to bottom, rgba(255, 255, 255, .12) 1px, transparent 1px);
  background-size: calc(100% / v-bind(cols)) calc(100% / v-bind(rows));
}
.mp-reveal { background: rgba(255, 214, 120, .22); outline: 2px dashed rgba(255, 214, 120, .8); outline-offset: -2px; pointer-events: none; }
.mp-reveal-draft { background: rgba(255, 214, 120, .35); }
.mp-spawn { display: grid; place-items: center; margin: 12%; border-radius: 50%; background: rgba(110, 200, 120, .85); color: #0b1a0d; font-weight: 700; font-size: 11px; pointer-events: none; box-shadow: 0 0 0 2px #fff; }
.mp-monster { display: grid; place-items: center; margin: 8%; border-radius: 50%; overflow: hidden; background: #4a2c2c; box-shadow: 0 0 0 2px #d0564a; pointer-events: none; font-weight: 700; }
.mp-monster img { width: 100%; height: 100%; object-fit: cover; }
.mp-monster-hidden { opacity: .55; box-shadow: 0 0 0 2px #d0564a, 0 0 0 4px rgba(0, 0, 0, .6); }
.mp-mode:focus-visible, .mp-select:focus-visible { outline: 2px solid var(--ed-gold); outline-offset: 2px; }
</style>
