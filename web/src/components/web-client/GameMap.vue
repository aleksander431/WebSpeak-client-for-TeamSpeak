<template>
  <div
    ref="viewport"
    :class="['gmap', `gmap-tool-${role === 'gm' ? tool : 'move'}`, { 'gmap-placing': placing, 'gmap-panning': pan }]"
    data-ws-part="voice.game.map"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp"
    @wheel.prevent="onWheel"
    @dblclick="onDoubleClick"
    @contextmenu.prevent
  >
    <div class="gmap-world" :style="worldStyle">
      <img class="gmap-img" :src="sceneMap.image" alt="" draggable="false" />
      <svg class="gmap-grid" :viewBox="`0 0 ${width} ${height}`" aria-hidden="true">
        <defs>
          <pattern id="gmap-cell" :width="CELL" :height="CELL" patternUnits="userSpaceOnUse">
            <path :d="`M ${CELL} 0 L 0 0 0 ${CELL}`" />
          </pattern>
        </defs>
        <rect :width="width" :height="height" fill="url(#gmap-cell)" />
      </svg>
      <canvas ref="fogCanvas" :class="['gmap-fog', { 'gmap-fog-gm': role === 'gm' }]" :style="fogStyle" aria-hidden="true"></canvas>

      <div v-if="hoverCell && (placing || (role === 'gm' && tool !== 'move'))" class="gmap-hover" :style="hoverStyle"></div>

      <svg v-if="drag && drag.moved" class="gmap-path" :viewBox="`0 0 ${width} ${height}`" aria-hidden="true">
        <line :x1="(drag.fromX + 0.5) * CELL" :y1="(drag.fromY + 0.5) * CELL" :x2="(dragCell.x + 0.5) * CELL" :y2="(dragCell.y + 0.5) * CELL" />
      </svg>

      <button
        v-for="token in map.tokens"
        :key="token.id"
        type="button"
        :class="tokenClass(token)"
        :style="tokenStyle(token)"
        :title="tokenTitle(token)"
        :aria-label="tokenTitle(token)"
        :aria-pressed="selectedId === token.id"
        data-token
        @pointerdown.stop="onTokenDown($event, token)"
      >
        <img v-if="portraitOf(token)" :src="portraitOf(token)" alt="" draggable="false" />
        <span v-else class="gmap-token-initial">{{ initial(token.name) }}</span>
        <span v-if="barOf(token) !== null" class="gmap-token-bar"><span :style="{ width: `${barOf(token)}%` }"></span></span>
        <span v-if="token.condition === 'down' || barOf(token) === 0" class="gmap-token-x" aria-hidden="true">✕</span>
        <span class="gmap-token-name">{{ token.name }}</span>
      </button>

      <div v-if="drag && drag.moved" class="gmap-distance" :style="distanceStyle">{{ dragFeet }} {{ x.feet }}</div>

      <div v-for="ping in pings" :key="ping.id" :class="['gmap-ping', { 'gmap-ping-gm': ping.gm }]" :style="{ left: `${ping.x * CELL}px`, top: `${ping.y * CELL}px` }">
        <span></span><span></span><b>{{ ping.by }}</b>
      </div>
    </div>

    <div class="gmap-tools" @pointerdown.stop @dblclick.stop>
      <template v-if="role === 'gm'">
        <div class="gmap-seg" role="radiogroup" :aria-label="x.brush">
          <button v-for="item in tools" :key="item.id" type="button" role="radio" :aria-checked="tool === item.id" :class="{ on: tool === item.id }" @click="setTool(item.id)">{{ item.label }}</button>
        </div>
        <div v-if="tool !== 'move'" class="gmap-seg" role="radiogroup" :aria-label="x.brush">
          <button v-for="size in [1, 2, 3]" :key="size" type="button" role="radio" :aria-checked="brush === size" :class="{ on: brush === size }" :title="`${x.brush} ${size}`" @click="brush = size">
            <i :style="{ width: `${4 + size * 4}px`, height: `${4 + size * 4}px` }"></i>
          </button>
        </div>
        <button type="button" class="gmap-btn" @click="client.fogAll(true)">{{ x.revealAll }}</button>
        <button type="button" class="gmap-btn" @click="client.fogAll(false)">{{ x.hideAll }}</button>
      </template>
      <div class="gmap-seg">
        <button type="button" :aria-label="x.zoomOut" :title="x.zoomOut" @click="zoomBy(1 / 1.25)">−</button>
        <button type="button" :aria-label="x.fit" :title="x.fit" @click="fit()">⤢</button>
        <button type="button" :aria-label="x.zoomIn" :title="x.zoomIn" @click="zoomBy(1.25)">+</button>
      </div>
    </div>

    <p class="gmap-hint" @pointerdown.stop>{{ placing ? x.placeHint : x.mapHelp }}</p>

    <div v-if="selected" class="gmap-card" @pointerdown.stop @dblclick.stop>
      <div class="gmap-card-head">
        <img v-if="portraitOf(selected)" :src="portraitOf(selected)" alt="" />
        <span>
          <strong>{{ selected.name }}</strong>
          <span class="gmap-muted">
            <template v-if="selectedMonster && role === 'gm'">{{ x.cr }} {{ selectedMonster.cr }} · {{ x.ac }} {{ selectedMonster.ac }} · {{ selectedMonster.speed }} {{ x.feet }}</template>
            <template v-else-if="selectedHero">{{ selectedHero.cls }} · {{ x.ac }} {{ selectedHero.ac }}</template>
            <template v-if="selected.condition"> · {{ selected.condition === 'down' ? x.down : x.bloodied }}</template>
          </span>
        </span>
        <button type="button" class="gmap-close" :aria-label="x.close" @click="selectedId = null">×</button>
      </div>
      <template v-if="role === 'gm' && selected.kind === 'monster'">
        <div class="gmap-hp">
          <span class="gmap-muted">{{ x.hp }}</span>
          <button type="button" :aria-label="x.hpMinus" @click="client.setTokenHp(selected.id, (selected.hp ?? 0) - 1)">−</button>
          <input type="number" min="0" :max="selected.maxHp" :value="selected.hp" :aria-label="x.hp" @change="onHpInput" />
          <span class="gmap-muted">/ {{ selected.maxHp }}</span>
          <button type="button" :aria-label="x.hpPlus" @click="client.setTokenHp(selected.id, (selected.hp ?? 0) + 1)">+</button>
        </div>
        <ul v-if="selectedMonster" class="gmap-attacks">
          <li v-for="(attack, index) in selectedMonster.attacks" :key="attack.name">
            <strong>{{ attack.name }}</strong>
            <button v-if="attack.bonus !== null" type="button" class="gmap-chip gmap-chip-gold" :title="x.attackShort" @click="client.roll({ type: 'monsterAttack', tokenId: selected.id, index })">{{ signed(attack.bonus) }}</button>
            <button type="button" class="gmap-chip" :title="x.damageShort" @click="client.roll({ type: 'monsterDamage', tokenId: selected.id, index })">{{ attack.damage }}</button>
            <small class="gmap-muted">{{ attack.note }}</small>
          </li>
        </ul>
        <p v-if="selectedMonster" class="gmap-muted gmap-small">{{ selectedMonster.traits.join(" · ") }}</p>
        <div class="gmap-row">
          <button type="button" class="gmap-btn" @click="client.hideToken(selected.id, !selected.hidden)">{{ selected.hidden ? x.showToPlayers : x.hideFromPlayers }}</button>
          <button type="button" class="gmap-btn gmap-btn-bad" @click="removeSelected">{{ x.remove }}</button>
        </div>
      </template>
      <p v-else-if="selected.kind === 'hero' && heroHp(selected)" class="gmap-muted">{{ x.hp }} {{ heroHp(selected)!.hp }}/{{ heroHp(selected)!.max }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { formatModifier, type AdventureSummary, type MapView, type SceneMap, type SeatView, type TableRole, type TokenView } from "../../../../src/shared/tabletop.js";
import type { GameClient } from "../../game/game-client.js";
import type { DndText } from "../../game/dnd-text.js";

const props = defineProps<{
  client: GameClient;
  map: MapView;
  sceneMap: SceneMap;
  adventure: AdventureSummary | null;
  role: TableRole;
  youKey: string;
  seats: SeatView[];
  x: DndText;
  placing: string | null;
  /** The selected token: also the target of attacks. */
  selectedId: string | null;
  /** Whose turn it is in combat. */
  activeTokenId?: string | null;
}>();
const emit = defineEmits<{ "update:placing": [string | null]; "update:selectedId": [string | null] }>();

/** World pixels per cell; the map pictures are drawn at this scale. */
const CELL = 64;
/** Fog canvas pixels per cell (soft edges come from a blur on top). */
const FOG_SUB = 8;

const viewport = ref<HTMLDivElement | null>(null);
const fogCanvas = ref<HTMLCanvasElement | null>(null);
const width = computed(() => props.map.cols * CELL);
const height = computed(() => props.map.rows * CELL);

// ---- View: pan and zoom ----------------------------------------------------

const view = reactive({ zoom: 1, x: 0, y: 0 });
const worldStyle = computed(() => ({
  width: `${width.value}px`,
  height: `${height.value}px`,
  transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`,
  // Labels keep their screen size whatever the zoom.
  "--gmap-inv": String(1 / view.zoom),
}));
let fitZoom = 1;

function fit(): void {
  const element = viewport.value;
  if (!element) return;
  const { clientWidth, clientHeight } = element;
  if (!clientWidth || !clientHeight) return;
  fitZoom = Math.min(clientWidth / width.value, clientHeight / height.value);
  view.zoom = fitZoom;
  view.x = (clientWidth - width.value * fitZoom) / 2;
  view.y = (clientHeight - height.value * fitZoom) / 2;
}

/** Players start close to what they can see (plus a margin), not at a mostly black map. */
function fitRevealed(): void {
  const element = viewport.value;
  if (!element) return;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let cell = 0; cell < props.map.fog.length; cell++) {
    if (props.map.fog[cell] !== "1") continue;
    const x = cell % props.map.cols;
    const y = Math.floor(cell / props.map.cols);
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  fit();
  if (!Number.isFinite(minX)) return;
  const margin = 3;
  const boxW = (Math.min(props.map.cols, maxX + 1 + margin) - Math.max(0, minX - margin)) * CELL;
  const boxH = (Math.min(props.map.rows, maxY + 1 + margin) - Math.max(0, minY - margin)) * CELL;
  const zoom = Math.min(fitZoom * 1.8, Math.max(fitZoom, Math.min(element.clientWidth / boxW, element.clientHeight / boxH)));
  const centerX = ((minX + maxX + 1) / 2) * CELL;
  const centerY = ((minY + maxY + 1) / 2) * CELL;
  view.zoom = zoom;
  view.x = element.clientWidth / 2 - centerX * zoom;
  view.y = element.clientHeight / 2 - centerY * zoom;
}

function initialFit(): void {
  if (props.role === "gm") fit();
  else fitRevealed();
}

function zoomAt(factor: number, screenX: number, screenY: number): void {
  const next = Math.max(fitZoom * 0.6, Math.min(4, view.zoom * factor));
  const worldX = (screenX - view.x) / view.zoom;
  const worldY = (screenY - view.y) / view.zoom;
  view.zoom = next;
  view.x = screenX - worldX * next;
  view.y = screenY - worldY * next;
}

function zoomBy(factor: number): void {
  const element = viewport.value;
  if (element) zoomAt(factor, element.clientWidth / 2, element.clientHeight / 2);
}

function onWheel(event: WheelEvent): void {
  const rect = viewport.value!.getBoundingClientRect();
  zoomAt(Math.exp(-event.deltaY * 0.0015), event.clientX - rect.left, event.clientY - rect.top);
}

function toWorld(event: { clientX: number; clientY: number }): { x: number; y: number } {
  const rect = viewport.value!.getBoundingClientRect();
  return { x: (event.clientX - rect.left - view.x) / view.zoom, y: (event.clientY - rect.top - view.y) / view.zoom };
}

function toCell(point: { x: number; y: number }): { x: number; y: number } | null {
  const x = Math.floor(point.x / CELL);
  const y = Math.floor(point.y / CELL);
  return x >= 0 && y >= 0 && x < props.map.cols && y < props.map.rows ? { x, y } : null;
}

let resizeObserver: ResizeObserver | undefined;
onMounted(() => {
  initialFit();
  drawFog();
  let first = true;
  resizeObserver = new ResizeObserver(() => {
    if (first) { first = false; return; }
    initialFit();
  });
  if (viewport.value) resizeObserver.observe(viewport.value);
  // Capture phase: Esc that cancels a placement or selection must not also close the game panel.
  window.addEventListener("keydown", onKey, true);
});
onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  window.removeEventListener("keydown", onKey, true);
  flushPaint();
  pingTimers.forEach(clearTimeout);
});
watch(() => props.sceneMap.image, () => nextTick(initialFit));

function onKey(event: KeyboardEvent): void {
  if (event.key === "Escape" && (props.placing || selectedId.value)) {
    event.preventDefault();
    emit("update:placing", null);
    selectedId.value = null;
  }
}

// ---- Fog -------------------------------------------------------------------

/** Brush strokes not yet confirmed by the gateway: cell → revealed. */
const pendingFog = reactive(new Map<number, boolean>());
const fogStyle = computed(() => ({
  left: `${-CELL}px`,
  top: `${-CELL}px`,
  width: `${width.value + CELL * 2}px`,
  height: `${height.value + CELL * 2}px`,
}));

function revealed(cell: number): boolean {
  return pendingFog.get(cell) ?? props.map.fog[cell] === "1";
}

function drawFog(): void {
  const canvas = fogCanvas.value;
  if (!canvas) return;
  const cols = props.map.cols + 2;
  const rows = props.map.rows + 2;
  if (canvas.width !== cols * FOG_SUB) canvas.width = cols * FOG_SUB;
  if (canvas.height !== rows * FOG_SUB) canvas.height = rows * FOG_SUB;
  const context = canvas.getContext("2d");
  if (!context) return;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = props.role === "gm" ? "rgba(6, 8, 18, 0.62)" : "#08090b";
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const inside = x > 0 && y > 0 && x <= props.map.cols && y <= props.map.rows;
      if (inside && revealed((y - 1) * props.map.cols + (x - 1))) continue;
      context.fillRect(x * FOG_SUB, y * FOG_SUB, FOG_SUB, FOG_SUB);
    }
  }
}

watch(() => props.map.fog, fog => {
  for (const [cell, value] of pendingFog) if ((fog[cell] === "1") === value) pendingFog.delete(cell);
  drawFog();
});
watch(() => [props.role, props.map.cols, props.map.rows], drawFog);

// ---- Tools -----------------------------------------------------------------

type Tool = "move" | "reveal" | "hide";
const tool = ref<Tool>("move");
const brush = ref(1);
const tools = computed(() => [
  { id: "move" as const, label: props.x.toolMove },
  { id: "reveal" as const, label: props.x.toolReveal },
  { id: "hide" as const, label: props.x.toolHide },
]);
function setTool(next: Tool): void {
  tool.value = next;
  if (next !== "move") emit("update:placing", null);
}
watch(() => props.placing, placing => { if (placing) tool.value = "move"; });

const hoverCell = ref<{ x: number; y: number } | null>(null);
const hoverStyle = computed(() => {
  const cell = hoverCell.value!;
  const size = props.placing ? 0 : brush.value - 1;
  return {
    left: `${(cell.x - size) * CELL}px`,
    top: `${(cell.y - size) * CELL}px`,
    width: `${(size * 2 + 1) * CELL}px`,
    height: `${(size * 2 + 1) * CELL}px`,
  };
});

let paintTimer: ReturnType<typeof setTimeout> | undefined;
const paintQueue = new Set<number>();
let paintReveal = true;

function paintAt(point: { x: number; y: number }): void {
  const center = toCell(point);
  if (!center) return;
  const radius = brush.value - 1;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const x = center.x + dx;
      const y = center.y + dy;
      if (x < 0 || y < 0 || x >= props.map.cols || y >= props.map.rows) continue;
      const cell = y * props.map.cols + x;
      if (revealed(cell) === paintReveal) continue;
      pendingFog.set(cell, paintReveal);
      paintQueue.add(cell);
    }
  }
  drawFog();
  if (!paintTimer) paintTimer = setTimeout(flushPaint, 150);
}

function flushPaint(): void {
  clearTimeout(paintTimer);
  paintTimer = undefined;
  if (!paintQueue.size) return;
  props.client.fog([...paintQueue], paintReveal);
  paintQueue.clear();
}

// ---- Pointer: pan, paint, place, drag -------------------------------------

const pan = ref<{ pointerId: number; startX: number; startY: number; viewX: number; viewY: number } | null>(null);
const painting = ref<number | null>(null);
const drag = ref<{ pointerId: number; id: string; fromX: number; fromY: number; worldX: number; worldY: number; offsetX: number; offsetY: number; moved: boolean } | null>(null);
const dragCell = computed(() => {
  const current = drag.value;
  if (!current) return { x: 0, y: 0 };
  return {
    x: Math.max(0, Math.min(props.map.cols - 1, Math.floor((current.worldX - current.offsetX + CELL / 2) / CELL))),
    y: Math.max(0, Math.min(props.map.rows - 1, Math.floor((current.worldY - current.offsetY + CELL / 2) / CELL))),
  };
});
/** 5e default: every square, diagonal or not, is 5 feet. */
const dragFeet = computed(() => drag.value ? Math.max(Math.abs(dragCell.value.x - drag.value.fromX), Math.abs(dragCell.value.y - drag.value.fromY)) * 5 : 0);
const distanceStyle = computed(() => ({ left: `${(dragCell.value.x + 0.5) * CELL}px`, top: `${dragCell.value.y * CELL - 10}px` }));

function onPointerDown(event: PointerEvent): void {
  if ((event.target as HTMLElement).closest(".gmap-tools, .gmap-card, .gmap-hint")) return;
  const point = toWorld(event);
  const primary = event.button === 0;
  if (primary && props.placing) {
    const cell = toCell(point);
    if (cell) props.client.addToken(props.placing, cell.x, cell.y);
    return;
  }
  if (primary && props.role === "gm" && tool.value !== "move") {
    painting.value = event.pointerId;
    paintReveal = tool.value === "reveal";
    viewport.value!.setPointerCapture(event.pointerId);
    paintAt(point);
    return;
  }
  if (primary) selectedId.value = null;
  pan.value = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, viewX: view.x, viewY: view.y };
  viewport.value!.setPointerCapture(event.pointerId);
}

function onTokenDown(event: PointerEvent, token: TokenView): void {
  if (event.button !== 0) {
    onPointerDown(event);
    return;
  }
  if (props.role === "gm" && tool.value !== "move") {
    onPointerDown(event);
    return;
  }
  if (!canMove(token)) {
    selectedId.value = token.id;
    return;
  }
  const point = toWorld(event);
  drag.value = {
    pointerId: event.pointerId, id: token.id, fromX: token.x, fromY: token.y,
    worldX: point.x, worldY: point.y, offsetX: point.x - token.x * CELL, offsetY: point.y - token.y * CELL, moved: false,
  };
  viewport.value!.setPointerCapture(event.pointerId);
}

function onPointerMove(event: PointerEvent): void {
  const point = toWorld(event);
  hoverCell.value = toCell(point);
  if (drag.value?.pointerId === event.pointerId) {
    drag.value.worldX = point.x;
    drag.value.worldY = point.y;
    if (Math.hypot(point.x - drag.value.offsetX - drag.value.fromX * CELL, point.y - drag.value.offsetY - drag.value.fromY * CELL) > 6) drag.value.moved = true;
    return;
  }
  if (painting.value === event.pointerId) {
    paintAt(point);
    return;
  }
  if (pan.value?.pointerId === event.pointerId) {
    view.x = pan.value.viewX + event.clientX - pan.value.startX;
    view.y = pan.value.viewY + event.clientY - pan.value.startY;
  }
}

function onPointerUp(event: PointerEvent): void {
  if (drag.value?.pointerId === event.pointerId) {
    const current = drag.value;
    const target = dragCell.value;
    drag.value = null;
    if (!current.moved) selectedId.value = current.id;
    else if (target.x !== current.fromX || target.y !== current.fromY) props.client.moveToken(current.id, target.x, target.y);
  }
  if (painting.value === event.pointerId) {
    painting.value = null;
    flushPaint();
  }
  if (pan.value?.pointerId === event.pointerId) pan.value = null;
}

function onDoubleClick(event: MouseEvent): void {
  if ((event.target as HTMLElement).closest(".gmap-tools, .gmap-card, .gmap-hint")) return;
  if (props.role === "spectator" || props.placing) return;
  const point = toWorld(event);
  if (point.x < 0 || point.y < 0 || point.x > width.value || point.y > height.value) return;
  props.client.ping(point.x / CELL, point.y / CELL);
}

// ---- Tokens ----------------------------------------------------------------

const selectedId = computed<string | null>({
  get: () => props.selectedId,
  set: value => emit("update:selectedId", value),
});
const selected = computed(() => props.map.tokens.find(token => token.id === selectedId.value) ?? null);
const selectedMonster = computed(() => selected.value?.kind === "monster" ? props.adventure?.monsters.find(monster => monster.id === selected.value?.monsterId) : undefined);
const selectedHero = computed(() => selected.value?.kind === "hero" ? props.adventure?.heroes.find(hero => hero.id === selected.value?.heroId) : undefined);

function canMove(token: TokenView): boolean {
  return props.role === "gm" || (props.role === "player" && token.kind === "hero" && token.seatKey === props.youKey);
}

function portraitOf(token: TokenView): string | undefined {
  return token.kind === "hero" ? props.adventure?.heroes.find(hero => hero.id === token.heroId)?.portrait : props.adventure?.monsters.find(monster => monster.id === token.monsterId)?.portrait;
}

function heroHp(token: TokenView): { hp: number; max: number } | null {
  const seat = props.seats.find(candidate => candidate.key === token.seatKey);
  const hero = props.adventure?.heroes.find(hero => hero.id === token.heroId);
  return seat && hero && seat.hp !== null ? { hp: seat.hp, max: hero.maxHp } : null;
}

/** Health bar percentage, or null when this viewer should not see one. */
function barOf(token: TokenView): number | null {
  if (token.kind === "hero") {
    const hp = heroHp(token);
    return hp ? Math.max(0, Math.min(100, (hp.hp / hp.max) * 100)) : null;
  }
  if (token.hp === undefined || !token.maxHp) return null;
  return Math.max(0, Math.min(100, (token.hp / token.maxHp) * 100));
}

function tokenClass(token: TokenView): unknown[] {
  const bar = barOf(token);
  return ["gmap-token", `gmap-token-${token.kind}`, {
    "gmap-token-mine": token.seatKey === props.youKey,
    "gmap-token-hidden": token.hidden,
    "gmap-token-selected": selectedId.value === token.id,
    "gmap-token-active": props.activeTokenId === token.id,
    "gmap-token-dragging": drag.value?.id === token.id && drag.value.moved,
    "gmap-token-bloodied": token.condition === "bloodied" || (bar !== null && bar > 0 && bar <= 50),
    "gmap-token-down": token.condition === "down" || bar === 0,
    "gmap-token-movable": canMove(token),
  }];
}

function tokenStyle(token: TokenView): Record<string, string> {
  const current = drag.value;
  if (current?.id === token.id && current.moved) {
    return { left: `${current.worldX - current.offsetX}px`, top: `${current.worldY - current.offsetY}px` };
  }
  return { left: `${token.x * CELL}px`, top: `${token.y * CELL}px` };
}

function tokenTitle(token: TokenView): string {
  const parts = [token.name];
  if (token.seatKey === props.youKey) parts.push(props.x.you);
  if (token.condition) parts.push(token.condition === "down" ? props.x.down : props.x.bloodied);
  if (token.hidden) parts.push(props.x.hiddenFromPlayers);
  return parts.join(" · ");
}

function onHpInput(event: Event): void {
  const value = Number((event.target as HTMLInputElement).value);
  if (selected.value && Number.isFinite(value)) props.client.setTokenHp(selected.value.id, value);
}

function removeSelected(): void {
  if (!selected.value) return;
  props.client.removeToken(selected.value.id);
  selectedId.value = null;
}

const initial = (name: string) => [...name.trim()][0]?.toUpperCase() ?? "?";
const signed = (value: number) => formatModifier(value);

// ---- Pings -----------------------------------------------------------------

const pings = ref<Array<{ id: number; by: string; x: number; y: number; gm: boolean }>>([]);
const pingTimers = new Set<ReturnType<typeof setTimeout>>();
watch(() => props.client.lastPing.value, ping => {
  if (!ping) return;
  pings.value = [...pings.value.slice(-5), ping];
  const timer = setTimeout(() => {
    pingTimers.delete(timer);
    pings.value = pings.value.filter(item => item.id !== ping.id);
  }, 2600);
  pingTimers.add(timer);
});
</script>

<style scoped>
.gmap {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  border-radius: 14px;
  border: 1px solid var(--gm-line, #2a2c33);
  background: #08090b;
  touch-action: none;
  user-select: none;
  cursor: grab;
}
.gmap-panning { cursor: grabbing; }
.gmap-tool-reveal, .gmap-tool-hide, .gmap-placing { cursor: crosshair; }
.gmap-world { position: absolute; left: 0; top: 0; transform-origin: 0 0; }
.gmap-img { position: absolute; inset: 0; width: 100%; height: 100%; display: block; pointer-events: none; }
.gmap-grid { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
.gmap-grid path { fill: none; stroke: rgba(255, 246, 224, 0.16); stroke-width: 1.2; }
.gmap-fog { position: absolute; pointer-events: none; image-rendering: auto; filter: blur(14px); }
.gmap-fog-gm { filter: blur(6px); }
.gmap-hover { position: absolute; pointer-events: none; border: 2px solid rgba(217, 180, 108, 0.9); border-radius: 6px; background: rgba(217, 180, 108, 0.12); box-sizing: border-box; }
.gmap-path { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
.gmap-path line { stroke: #f3dcae; stroke-width: 4; stroke-dasharray: 10 8; stroke-linecap: round; }
.gmap-distance { position: absolute; transform: translate(-50%, -100%) scale(var(--gmap-inv, 1)); transform-origin: 50% 100%; padding: 4px 10px; border-radius: 999px; background: #1a1408; border: 1px solid #d9b46c; color: #f3dcae; font-size: 20px; font-weight: 700; pointer-events: none; white-space: nowrap; }

.gmap-token {
  position: absolute;
  width: 64px;
  height: 64px;
  padding: 5px;
  border: 0;
  background: none;
  cursor: pointer;
  transition: left .18s ease, top .18s ease;
}
.gmap-token-dragging { transition: none; z-index: 3; }
.gmap-token-movable { cursor: grab; }
.gmap-token img, .gmap-token-initial {
  display: grid;
  place-items: center;
  width: 54px;
  height: 54px;
  border-radius: 50%;
  object-fit: cover;
  box-sizing: border-box;
  border: 3px solid #d9b46c;
  box-shadow: 0 3px 10px rgba(0, 0, 0, 0.7);
  background: #2c4a3a;
  color: #fff;
  font-size: 22px;
  font-weight: 700;
}
.gmap-token-monster img, .gmap-token-monster .gmap-token-initial { border-color: #b84a3e; background: #4a2020; }
.gmap-token-mine img, .gmap-token-mine .gmap-token-initial { border-color: #f3dcae; box-shadow: 0 0 0 3px rgba(243, 220, 174, 0.35), 0 3px 10px rgba(0, 0, 0, 0.7); }
.gmap-token-selected img, .gmap-token-selected .gmap-token-initial { box-shadow: 0 0 0 4px #fff6e0, 0 3px 12px rgba(0, 0, 0, 0.8); }
.gmap-token-active img, .gmap-token-active .gmap-token-initial { box-shadow: 0 0 0 3px #f3dcae, 0 0 22px 6px rgba(243, 220, 174, 0.75); animation: gmap-turn 1.6s ease-in-out infinite; }
@keyframes gmap-turn { 50% { box-shadow: 0 0 0 3px #f3dcae, 0 0 10px 2px rgba(243, 220, 174, 0.4); } }
.gmap-token-hidden { opacity: .55; }
.gmap-token-hidden img, .gmap-token-hidden .gmap-token-initial { border-style: dashed; }
.gmap-token-bloodied img { filter: sepia(.4) saturate(1.6) hue-rotate(-20deg); }
.gmap-token-down img, .gmap-token-down .gmap-token-initial { filter: grayscale(1) brightness(.6); }
.gmap-token-bar { position: absolute; left: 10px; right: 10px; bottom: 2px; height: 5px; border-radius: 3px; background: rgba(0, 0, 0, 0.7); overflow: hidden; }
.gmap-token-bar span { display: block; height: 100%; background: #8fd18f; }
.gmap-token-bloodied .gmap-token-bar span { background: #e8c77f; }
.gmap-token-monster .gmap-token-bar span { background: #e08a8a; }
.gmap-token-x { position: absolute; inset: 0; display: grid; place-items: center; color: #e08a8a; font-size: 34px; font-weight: 800; text-shadow: 0 2px 6px #000; pointer-events: none; }
.gmap-token-name {
  position: absolute;
  left: 50%;
  bottom: 100%;
  transform: translateX(-50%) scale(var(--gmap-inv, 1));
  transform-origin: 50% 100%;
  padding: 2px 8px;
  border-radius: 6px;
  background: rgba(10, 11, 13, 0.85);
  color: #f1e6cf;
  font-size: 13px;
  white-space: nowrap;
  opacity: 0;
  pointer-events: none;
  transition: opacity .12s ease;
}
.gmap-token:hover .gmap-token-name, .gmap-token-selected .gmap-token-name, .gmap-token-dragging .gmap-token-name { opacity: 1; }

.gmap-ping { position: absolute; width: 0; height: 0; pointer-events: none; z-index: 4; }
.gmap-ping span { position: absolute; left: -48px; top: -48px; width: 96px; height: 96px; box-sizing: border-box; border-radius: 50%; border: calc(4px * var(--gmap-inv, 1)) solid #8fd1ff; box-shadow: 0 0 calc(12px * var(--gmap-inv, 1)) #8fd1ff; animation: gmap-ping 1.3s ease-out 2 both; }
.gmap-ping span + span { animation-delay: .35s; }
.gmap-ping-gm span { border-color: #f3dcae; box-shadow: 0 0 calc(12px * var(--gmap-inv, 1)) #f3dcae; }
.gmap-ping b { position: absolute; left: 0; top: 52px; transform: translateX(-50%) scale(var(--gmap-inv, 1)); transform-origin: 50% 0; padding: 2px 8px; border-radius: 6px; background: rgba(10, 11, 13, 0.85); color: #fff; font-size: 14px; white-space: nowrap; }
@keyframes gmap-ping { from { transform: scale(.2); opacity: 1; } to { transform: scale(1.6); opacity: 0; } }

.gmap-tools { position: absolute; top: 10px; right: 10px; display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 6px; max-width: calc(100% - 20px); cursor: default; }
.gmap-seg { display: flex; border-radius: 10px; overflow: hidden; border: 1px solid #3a3c44; background: rgba(20, 21, 25, 0.92); }
.gmap-seg button { min-width: 36px; min-height: 34px; padding: 0 10px; border: 0; background: transparent; color: #e8e6e1; font: inherit; font-size: 13px; cursor: pointer; display: grid; place-items: center; }
.gmap-seg button + button { border-left: 1px solid #3a3c44; }
.gmap-seg button.on { background: #3a3020; color: #f3dcae; }
.gmap-seg button:hover:not(.on) { background: #23252b; }
.gmap-seg i { display: block; border-radius: 3px; background: currentColor; }
.gmap-btn { min-height: 34px; padding: 0 12px; border-radius: 10px; border: 1px solid #3a3c44; background: rgba(20, 21, 25, 0.92); color: #e8e6e1; font: inherit; font-size: 13px; cursor: pointer; }
.gmap-btn:hover { background: #23252b; }
.gmap-btn-bad { color: #e08a8a; }
.gmap-hint { position: absolute; left: 10px; bottom: 8px; margin: 0; padding: 4px 10px; border-radius: 8px; background: rgba(10, 11, 13, 0.7); color: #a9a6a0; font-size: 12px; max-width: calc(100% - 20px); cursor: default; }

.gmap-card {
  position: absolute;
  left: 10px;
  bottom: 40px;
  width: min(320px, calc(100% - 20px));
  max-height: calc(100% - 100px);
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border-radius: 12px;
  background: rgba(20, 21, 25, 0.96);
  border: 1px solid #3a3c44;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
  cursor: default;
  user-select: text;
}
.gmap-card-head { display: flex; gap: 10px; align-items: center; }
.gmap-card-head img { width: 48px; height: 48px; border-radius: 10px; object-fit: cover; }
.gmap-card-head > span { flex: 1; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.gmap-close { align-self: flex-start; min-width: 32px; min-height: 32px; border: 0; background: none; color: #a9a6a0; font-size: 20px; cursor: pointer; }
.gmap-muted { color: #a9a6a0; }
.gmap-small { margin: 0; font-size: 12px; line-height: 1.4; }
.gmap-hp { display: flex; align-items: center; gap: 6px; }
.gmap-hp button { width: 32px; height: 32px; border-radius: 8px; border: 1px solid #3a3c44; background: transparent; color: #e8e6e1; font-size: 16px; cursor: pointer; }
.gmap-hp input { width: 56px; min-height: 32px; border-radius: 8px; border: 1px solid #3a3c44; background: #23252b; color: #e8e6e1; font: inherit; text-align: center; }
.gmap-attacks { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 6px; }
.gmap-attacks li { display: flex; flex-wrap: wrap; gap: 2px 8px; padding: 6px 8px; border-radius: 8px; background: #23252b; font-size: 13px; }
.gmap-attacks small { width: 100%; }
.gmap-attacks li { align-items: center; }
.gmap-chip { min-height: 28px; padding: 0 8px; border-radius: 6px; border: 1px solid #3a3c44; background: transparent; color: #e8e6e1; font: inherit; font-size: 12px; cursor: pointer; }
.gmap-chip:hover { border-color: #d9b46c; }
.gmap-chip-gold { color: #d9b46c; font-weight: 600; }
.gmap-row { display: flex; flex-wrap: wrap; gap: 6px; }
@media (prefers-reduced-motion: reduce) {
  .gmap-token { transition: none; }
  .gmap-token-active img, .gmap-token-active .gmap-token-initial { animation: none; }
  .gmap-ping span { animation: none; opacity: .8; }
}
</style>
