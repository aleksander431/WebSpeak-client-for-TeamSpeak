<template>
  <section
    class="wb-panel"
    data-ws-part="voice.whiteboard"
    role="dialog"
    aria-modal="true"
    :aria-label="t('whiteboard')"
  >
    <header class="wb-top" data-ws-part="voice.whiteboard.header">
      <div class="wb-title">
        <span class="wb-kicker">{{ t("whiteboard") }}</span>
        <strong>{{ channelName }}</strong>
      </div>
      <div class="wb-peers" :aria-label="t('whiteboardPeers')">
        <span
          v-for="peer in peers"
          :key="peer.peerId"
          class="wb-peer"
          :style="{ background: peer.color }"
          :title="peer.peerId === selfId ? `${peer.nickname} (${t('you')})` : peer.nickname"
          >{{ initial(peer.nickname) }}</span
        >
      </div>
      <div class="wb-actions">
        <button type="button" class="wb-icon-button" :disabled="!canUndo" :title="`${t('whiteboardUndo')} (Ctrl+Z)`" :aria-label="t('whiteboardUndo')" @click="undo">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 14 4 9l5-5" /><path d="M4 9h11a5 5 0 0 1 0 10h-3" /></svg>
        </button>
        <button type="button" class="wb-icon-button" :disabled="!canRedo" :title="`${t('whiteboardRedo')} (Ctrl+Y)`" :aria-label="t('whiteboardRedo')" @click="redo">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 14 5-5-5-5" /><path d="M20 9H9a5 5 0 0 0 0 10h3" /></svg>
        </button>
        <button type="button" class="wb-icon-button" :title="t('whiteboardExport')" :aria-label="t('whiteboardExport')" @click="exportPng">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m0 0 4-4m-4 4-4-4M4 19v2h16v-2" /></svg>
        </button>
        <button type="button" class="wb-icon-button danger" :disabled="!elementCount" :title="t('whiteboardClear')" :aria-label="t('whiteboardClear')" @click="confirm = { kind: 'clear' }">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></svg>
        </button>
        <button type="button" class="wb-icon-button" :title="t('close')" :aria-label="t('close')" data-ws-part="voice.whiteboard.close" @click="emit('close')">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
        </button>
      </div>
    </header>

    <div class="wb-body">
      <nav class="wb-tools" data-ws-part="voice.whiteboard.tools" :aria-label="t('whiteboardTools')">
        <button
          v-for="item in tools"
          :key="item.id"
          type="button"
          :class="['wb-tool', { active: tool === item.id }]"
          :title="`${t(item.label)} (${item.key.toUpperCase()})`"
          :aria-label="t(item.label)"
          :aria-pressed="tool === item.id"
          @click="setTool(item.id)"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" v-html="item.icon"></svg>
        </button>
        <span class="wb-tool-separator"></span>
        <button type="button" class="wb-tool" :title="t('whiteboardImage')" :aria-label="t('whiteboardImage')" @click="fileInput?.click()">
          <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="2" /><path d="m21 16-5-5-9 9" /></svg>
        </button>
        <input ref="fileInput" type="file" accept="image/*" hidden @change="onFilePicked" />
      </nav>

      <div
        ref="stage"
        class="wb-stage"
        data-ws-part="voice.whiteboard.canvas"
        @dragover.prevent
        @drop.prevent="onDrop"
      >
        <canvas
          ref="canvas"
          :class="['wb-canvas', `tool-${effectiveTool}`, { panning: interaction.kind === 'pan' }]"
          @pointerdown="onPointerDown"
          @pointermove="onPointerMove"
          @pointerup="onPointerUp"
          @pointercancel="onPointerCancel"
          @pointerleave="onPointerLeave"
          @mousedown.prevent
          @dblclick="onDoubleClick"
          @wheel.prevent="onWheel"
          @contextmenu.prevent
        ></canvas>
        <textarea
          v-if="textEditor"
          ref="textArea"
          v-model="textEditor.value"
          class="wb-text-editor"
          :style="textEditorStyle"
          spellcheck="false"
          @keydown.stop="onTextKeydown"
          @blur="commitText"
        ></textarea>

        <div class="wb-style" data-ws-part="voice.whiteboard.style">
          <button
            v-for="swatch in palette"
            :key="swatch"
            type="button"
            :class="['wb-swatch', { active: color === swatch }]"
            :style="{ background: swatch }"
            :aria-label="swatch"
            :title="swatch"
            @click="setColor(swatch)"
          ></button>
          <label class="wb-swatch wb-custom-color" :title="t('whiteboardCustomColor')">
            <input type="color" :value="color" :aria-label="t('whiteboardCustomColor')" @input="setColor(($event.target as HTMLInputElement).value)" />
          </label>
          <span class="wb-style-separator"></span>
          <button
            v-for="width in widths"
            :key="width"
            type="button"
            :class="['wb-width', { active: strokeWidth === width }]"
            :title="`${t('whiteboardWidth')}: ${width}`"
            :aria-label="`${t('whiteboardWidth')}: ${width}`"
            @click="setWidth(width)"
          ><i :style="{ width: `${Math.min(18, width + 2)}px`, height: `${Math.min(18, width + 2)}px` }"></i></button>
          <span class="wb-style-separator"></span>
          <button
            type="button"
            :class="['wb-fill', { active: filled }]"
            :title="t('whiteboardFill')"
            :aria-label="t('whiteboardFill')"
            :aria-pressed="filled"
            @click="toggleFill"
          ><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="2" :fill="filled ? color : 'none'" /></svg></button>
          <select class="wb-font" :value="fontSize" :title="t('whiteboardFontSize')" :aria-label="t('whiteboardFontSize')" @change="setFontSize(Number(($event.target as HTMLSelectElement).value))">
            <option v-for="size in fontSizes" :key="size" :value="size">{{ size }}px</option>
          </select>
        </div>

        <div class="wb-zoom" data-ws-part="voice.whiteboard.zoom">
          <button type="button" :aria-label="t('whiteboardZoomOut')" :title="t('whiteboardZoomOut')" @click="zoomBy(1 / 1.25)">−</button>
          <button type="button" class="wb-zoom-value" :title="t('whiteboardZoomReset')" @click="resetView">{{ Math.round(view.zoom * 100) }}%</button>
          <button type="button" :aria-label="t('whiteboardZoomIn')" :title="t('whiteboardZoomIn')" @click="zoomBy(1.25)">+</button>
        </div>

        <div v-if="!ready" class="wb-status">{{ t(connected ? "whiteboardLoading" : "whiteboardOffline") }}</div>
        <div v-if="hint" class="wb-hint" role="status">{{ hint }}</div>

        <div v-if="confirm" class="wb-confirm" role="alertdialog" :aria-label="confirmText">
          <p>{{ confirmText }}</p>
          <div>
            <button type="button" class="danger" @click="runConfirm">{{ t(confirm.kind === "clear" ? "whiteboardClearConfirm" : "whiteboardDeleteSheetConfirm") }}</button>
            <button type="button" @click="confirm = null">{{ t("cancel") }}</button>
          </div>
        </div>
      </div>
    </div>

    <footer class="wb-sheets" data-ws-part="voice.whiteboard.sheets">
      <div class="wb-sheet-list" role="tablist" :aria-label="t('whiteboardSheets')">
        <div
          v-for="(sheet, index) in sheets"
          :key="sheet.id"
          :class="['wb-sheet', { active: sheet.id === sheetId }]"
          role="tab"
          :aria-selected="sheet.id === sheetId"
        >
          <input
            v-if="renaming === sheet.id"
            ref="renameInput"
            v-model="renameValue"
            class="wb-sheet-rename"
            :maxlength="maxSheetName"
            @keydown.enter.prevent="commitRename"
            @keydown.esc.prevent="renaming = ''"
            @keydown.stop
            @blur="commitRename"
          />
          <button
            v-else
            type="button"
            class="wb-sheet-name"
            :title="t('whiteboardRenameHint')"
            @click="client.selectSheet(sheet.id)"
            @dblclick="startRename(sheet.id, sheetLabel(sheet, index))"
          >{{ sheetLabel(sheet, index) }}</button>
          <button
            v-if="sheet.id === sheetId"
            type="button"
            class="wb-sheet-edit"
            :title="t('whiteboardRenameSheet')"
            :aria-label="t('whiteboardRenameSheet')"
            @click="startRename(sheet.id, sheetLabel(sheet, index))"
          ><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z" /></svg></button>
          <button
            v-if="sheets.length > 1"
            type="button"
            class="wb-sheet-delete"
            :title="t('whiteboardDeleteSheet')"
            :aria-label="t('whiteboardDeleteSheet')"
            @click="confirm = { kind: 'sheet', sheetId: sheet.id, label: sheetLabel(sheet, index) }"
          ><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17" /></svg></button>
        </div>
      </div>
      <button type="button" class="wb-sheet-add" :disabled="!ready || sheets.length >= maxSheets" :title="t('whiteboardNewSheet')" @click="client.createSheet('')">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
        <span>{{ t("whiteboardNewSheet") }}</span>
      </button>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from "vue";
import { WHITEBOARD_LIMITS, type WhiteboardElement, type WhiteboardSheet } from "../../../../src/shared/whiteboard.js";
import { newWhiteboardId, sortByZ, type WhiteboardClient } from "../../whiteboard/whiteboard-client.js";
import {
  boundsIntersect,
  drawElement,
  elementBounds,
  hitTest,
  measureText,
  normalizeBounds,
  round,
  scaleElement,
  translateElement,
  unionBounds,
  WhiteboardImageCache,
  WHITEBOARD_FONT,
  TEXT_LINE_HEIGHT,
  type Bounds,
} from "../../whiteboard/whiteboard-render.js";
import { prepareWhiteboardImage } from "../../whiteboard/whiteboard-image.js";

const props = defineProps<{
  client: WhiteboardClient;
  channelName: string;
  connected: boolean;
  t: (key: string, variables?: Record<string, string | number>) => string;
}>();
const emit = defineEmits<{ close: [] }>();
const t = props.t;

type Tool = "select" | "pen" | "line" | "arrow" | "rect" | "ellipse" | "text" | "eraser" | "hand";
const tools: { id: Tool; key: string; label: string; icon: string }[] = [
  { id: "select", key: "v", label: "whiteboardToolSelect", icon: '<path d="M5 3l14 8-6 1.5L10 19z"/>' },
  { id: "hand", key: "h", label: "whiteboardToolHand", icon: '<path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V11m0-6.5a1.5 1.5 0 0 1 3 0V11m0-5a1.5 1.5 0 0 1 3 0v6m0-3a1.5 1.5 0 0 1 3 0v4a8 8 0 0 1-8 8h-1a7 7 0 0 1-5.6-2.8L3.6 14a1.5 1.5 0 0 1 2.4-1.8L8 15"/>' },
  { id: "pen", key: "p", label: "whiteboardToolPen", icon: '<path d="M4 20c4-1 6-3 8-6l6-9 2 2-9 6c-3 2-5 4-6 8z"/>' },
  { id: "line", key: "l", label: "whiteboardToolLine", icon: '<path d="M5 19 19 5"/>' },
  { id: "arrow", key: "a", label: "whiteboardToolArrow", icon: '<path d="M5 19 19 5M10 5h9v9"/>' },
  { id: "rect", key: "r", label: "whiteboardToolRect", icon: '<rect x="4" y="6" width="16" height="12" rx="1"/>' },
  { id: "ellipse", key: "o", label: "whiteboardToolEllipse", icon: '<ellipse cx="12" cy="12" rx="9" ry="7"/>' },
  { id: "text", key: "t", label: "whiteboardToolText", icon: '<path d="M5 6V4h14v2M12 4v16M9 20h6"/>' },
  { id: "eraser", key: "e", label: "whiteboardToolEraser", icon: '<path d="M8 20h12M4.5 15.5l9-9a2 2 0 0 1 2.8 0l2.2 2.2a2 2 0 0 1 0 2.8L11 19H8z"/>' },
];
const palette = ["#1f2328", "#e5484d", "#f76b15", "#ffb224", "#30a46c", "#0090ff", "#8e4ec6", "#ffffff"];
const widths = [2, 4, 8, 16];
const fontSizes = [14, 20, 28, 40, 64];
const maxSheets = WHITEBOARD_LIMITS.maxSheetsPerBoard;
const maxSheetName = WHITEBOARD_LIMITS.maxSheetNameLength;

const PREFS_KEY = "webspeak:whiteboard";
function loadPrefs(): { color?: string; width?: number; filled?: boolean; fontSize?: number } {
  try { return JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") ?? {}; } catch { return {}; }
}
const prefs = loadPrefs();
const tool = ref<Tool>("pen");
const color = ref(typeof prefs.color === "string" && /^#[0-9a-f]{6}$/i.test(prefs.color) ? prefs.color.toLowerCase() : "#1f2328");
const strokeWidth = ref(widths.includes(prefs.width ?? 0) ? prefs.width! : 4);
const filled = ref(prefs.filled === true);
const fontSize = ref(fontSizes.includes(prefs.fontSize ?? 0) ? prefs.fontSize! : 28);
watch([color, strokeWidth, filled, fontSize], () => {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify({ color: color.value, width: strokeWidth.value, filled: filled.value, fontSize: fontSize.value })); } catch { /* private mode */ }
});

const canvas = ref<HTMLCanvasElement | null>(null);
const stage = ref<HTMLDivElement | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);
const textArea = ref<HTMLTextAreaElement | null>(null);
const renameInput = ref<HTMLInputElement[] | HTMLInputElement | null>(null);

// Board state mirrored from the client; `version` drives reactivity.
const version = ref(props.client.version);
const unsubscribe = props.client.subscribe(() => {
  version.value = props.client.version;
  // Drop selections of elements that are gone.
  const elements = props.client.elements;
  if ([...selection.value].some((id) => !elements.has(id))) selection.value = new Set([...selection.value].filter((id) => elements.has(id)));
  requestDraw();
});
function live<T>(read: () => T) {
  return computed(() => { void version.value; return read(); });
}
const ready = live(() => props.client.ready);
const sheets = live(() => props.client.sheets);
const sheetId = live(() => props.client.sheetId);
const peers = live(() => props.client.peers);
const selfId = live(() => props.client.self?.peerId ?? "");
const canUndo = live(() => props.client.canUndo);
const canRedo = live(() => props.client.canRedo);
const elementCount = live(() => props.client.elements.size);

const selection = shallowRef(new Set<string>());
const view = reactive({ x: 0, y: 0, zoom: 1 });
const hint = ref("");
let hintTimer: ReturnType<typeof setTimeout> | null = null;
const confirm = ref<null | { kind: "clear" } | { kind: "sheet"; sheetId: string; label: string }>(null);
const renaming = ref("");
const renameValue = ref("");

type Handle = "nw" | "ne" | "sw" | "se";
type Interaction =
  | { kind: "none" }
  | { kind: "pan"; pointerId: number; startX: number; startY: number; viewX: number; viewY: number }
  | { kind: "draw"; pointerId: number; element: WhiteboardElement; startX: number; startY: number }
  | { kind: "move"; pointerId: number; startX: number; startY: number; originals: WhiteboardElement[]; moved: boolean; duplicate: boolean }
  | { kind: "resize"; pointerId: number; handle: Handle; from: Bounds; originals: WhiteboardElement[]; current: WhiteboardElement[] }
  | { kind: "marquee"; pointerId: number; startX: number; startY: number; x: number; y: number; additive: boolean }
  | { kind: "erase"; pointerId: number; ids: Set<string>; lastX: number; lastY: number };
const interaction = shallowRef<Interaction>({ kind: "none" });
let movePreview: WhiteboardElement[] = [];
const textEditor = ref<null | { x: number; y: number; id: string | null; value: string; color: string; fontSize: number; z: number }>(null);
const spaceHeld = ref(false);
const effectiveTool = computed<Tool>(() => (spaceHeld.value ? "hand" : tool.value));
let lastPointer: { x: number; y: number } | null = null;
const touches = new Map<number, { x: number; y: number }>();
let pinch: { distance: number; zoom: number; worldX: number; worldY: number } | null = null;

const images = new WhiteboardImageCache(() => requestDraw());

function initial(name: string) { return (name.trim()[0] ?? "?").toUpperCase(); }
function sheetLabel(sheet: WhiteboardSheet, index: number) { return sheet.name || t("whiteboardSheetN", { n: index + 1 }); }
function showHint(text: string) {
  hint.value = text;
  if (hintTimer) clearTimeout(hintTimer);
  hintTimer = setTimeout(() => { hint.value = ""; }, 3500);
}

const errorKeys: Record<string, string> = {
  WHITEBOARD_SHEET_FULL: "whiteboardErrorFull",
  WHITEBOARD_SHEET_LIMIT: "whiteboardErrorSheetLimit",
  WHITEBOARD_LAST_SHEET: "whiteboardErrorLastSheet",
  WHITEBOARD_NO_CHANNEL: "whiteboardErrorNoChannel",
  WHITEBOARD_RATE_LIMITED: "whiteboardErrorRate",
  WHITEBOARD_IMAGE_TOO_LARGE: "whiteboardErrorImage",
  WHITEBOARD_IMAGE_UNREADABLE: "whiteboardErrorImage",
};
watch(live(() => props.client.lastError), (code) => {
  if (!code) return;
  showHint(t(errorKeys[code] ?? "whiteboardErrorGeneric"));
  props.client.clearError();
});
watch(sheetId, () => { selection.value = new Set(); cancelInteraction(); textEditor.value = null; });

const confirmText = computed(() => {
  const value = confirm.value;
  if (!value) return "";
  return value.kind === "clear" ? t("whiteboardClearQuestion") : t("whiteboardDeleteSheetQuestion", { name: value.label });
});
function runConfirm() {
  const value = confirm.value;
  confirm.value = null;
  if (!value) return;
  if (value.kind === "clear") { props.client.clear(); selection.value = new Set(); }
  else props.client.deleteSheet(value.sheetId);
}

// ------------------------------------------------------------ coordinates

function toWorld(clientX: number, clientY: number) {
  const rect = canvas.value!.getBoundingClientRect();
  return { x: (clientX - rect.left - view.x) / view.zoom, y: (clientY - rect.top - view.y) / view.zoom };
}
function toScreen(x: number, y: number) { return { x: x * view.zoom + view.x, y: y * view.zoom + view.y }; }
function viewCenter() {
  const rect = canvas.value?.getBoundingClientRect();
  return rect ? toWorld(rect.left + rect.width / 2, rect.top + rect.height / 2) : { x: 0, y: 0 };
}
function zoomAt(screenX: number, screenY: number, zoom: number) {
  const next = Math.min(8, Math.max(0.1, zoom));
  const worldX = (screenX - view.x) / view.zoom, worldY = (screenY - view.y) / view.zoom;
  view.zoom = next;
  view.x = screenX - worldX * next;
  view.y = screenY - worldY * next;
  requestDraw();
}
function zoomBy(factor: number) {
  const rect = canvas.value?.getBoundingClientRect();
  if (rect) zoomAt(rect.width / 2, rect.height / 2, view.zoom * factor);
}
function resetView() {
  const bounds = unionBounds([...props.client.elements.values()].map(elementBounds));
  const rect = canvas.value?.getBoundingClientRect();
  view.zoom = 1;
  if (bounds && rect) {
    const fit = Math.min(1, (rect.width - 80) / Math.max(1, bounds.w), (rect.height - 80) / Math.max(1, bounds.h));
    view.zoom = Math.max(0.1, fit);
    view.x = rect.width / 2 - (bounds.x + bounds.w / 2) * view.zoom;
    view.y = rect.height / 2 - (bounds.y + bounds.h / 2) * view.zoom;
  } else { view.x = 0; view.y = 0; }
  requestDraw();
}

// ------------------------------------------------------------- selection

function selectedElements(): WhiteboardElement[] {
  const elements = props.client.elements;
  return sortByZ([...selection.value].map((id) => elements.get(id)).filter((element): element is WhiteboardElement => Boolean(element)));
}
function selectionBounds(list = selectedElements()): Bounds | null {
  return unionBounds(list.map(elementBounds));
}
function topmostAt(x: number, y: number): WhiteboardElement | null {
  const tolerance = 6 / view.zoom;
  const list = sortByZ(props.client.elements.values());
  for (let index = list.length - 1; index >= 0; index--) if (hitTest(list[index]!, x, y, tolerance)) return list[index]!;
  return null;
}
function handleAt(x: number, y: number): Handle | null {
  if (selection.value.size === 0) return null;
  const bounds = selectionBounds();
  if (!bounds) return null;
  const pad = 6 / view.zoom, size = 9 / view.zoom;
  const corners: [Handle, number, number][] = [["nw", bounds.x - pad, bounds.y - pad], ["ne", bounds.x + bounds.w + pad, bounds.y - pad], ["sw", bounds.x - pad, bounds.y + bounds.h + pad], ["se", bounds.x + bounds.w + pad, bounds.y + bounds.h + pad]];
  for (const [handle, hx, hy] of corners) if (Math.abs(x - hx) <= size && Math.abs(y - hy) <= size) return handle;
  return null;
}

// ------------------------------------------------------------------ tools

function setTool(next: Tool) {
  commitText();
  tool.value = next;
  if (next !== "select") selection.value = new Set();
  requestDraw();
}
function restyleSelection(patch: (element: WhiteboardElement) => WhiteboardElement | null) {
  const changed = selectedElements().map(patch).filter((element): element is WhiteboardElement => Boolean(element));
  if (changed.length) props.client.upsert(changed);
}
function setColor(value: string) {
  color.value = value.toLowerCase();
  if (textEditor.value) textEditor.value.color = color.value;
  restyleSelection((element) => ({ ...element, stroke: color.value, ...(element.fill ? { fill: color.value } : {}) }));
}
function setWidth(value: number) {
  strokeWidth.value = value;
  restyleSelection((element) => (element.type === "text" || element.type === "image" ? null : { ...element, strokeWidth: value }));
}
function toggleFill() {
  filled.value = !filled.value;
  restyleSelection((element) => (element.type === "rect" || element.type === "ellipse" ? { ...element, fill: filled.value ? element.stroke : null } : null));
}
function setFontSize(value: number) {
  fontSize.value = value;
  if (textEditor.value) textEditor.value.fontSize = value;
  const context = canvas.value?.getContext("2d");
  restyleSelection((element) => {
    if (element.type !== "text" || !context) return null;
    const size = measureText(context, element.text ?? "", value);
    return { ...element, fontSize: value, w: size.w, h: size.h };
  });
}

function baseElement(type: WhiteboardElement["type"], x: number, y: number): WhiteboardElement {
  return { id: newWhiteboardId(), type, x: round(x), y: round(y), w: 0, h: 0, z: props.client.nextZ(), stroke: color.value, strokeWidth: strokeWidth.value };
}

// ---------------------------------------------------------------- pointer

function onPointerDown(event: PointerEvent) {
  if (!ready.value || confirm.value) return;
  const target = event.currentTarget as HTMLCanvasElement;
  if (event.pointerType === "touch") {
    touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (touches.size === 2) {
      // Second finger: switch to pinch zoom and drop whatever the first started.
      cancelInteraction();
      const [a, b] = [...touches.values()];
      const rect = target.getBoundingClientRect();
      const midX = (a!.x + b!.x) / 2 - rect.left, midY = (a!.y + b!.y) / 2 - rect.top;
      pinch = { distance: Math.hypot(a!.x - b!.x, a!.y - b!.y), zoom: view.zoom, worldX: (midX - view.x) / view.zoom, worldY: (midY - view.y) / view.zoom };
      return;
    }
    if (touches.size > 2) return;
  }
  if (textEditor.value) { commitText(); if (tool.value === "text") return; }
  const world = toWorld(event.clientX, event.clientY);
  const rect = target.getBoundingClientRect();
  const panRequested = event.button === 1 || event.button === 2 || effectiveTool.value === "hand";
  if (event.button !== 0 && !panRequested) return;
  target.setPointerCapture(event.pointerId);
  if (panRequested) {
    interaction.value = { kind: "pan", pointerId: event.pointerId, startX: event.clientX - rect.left, startY: event.clientY - rect.top, viewX: view.x, viewY: view.y };
    return;
  }
  switch (tool.value) {
    case "select": {
      const handle = handleAt(world.x, world.y);
      if (handle) {
        const originals = selectedElements();
        interaction.value = { kind: "resize", pointerId: event.pointerId, handle, from: selectionBounds(originals)!, originals, current: originals };
        return;
      }
      const hit = topmostAt(world.x, world.y);
      if (hit) {
        if (event.shiftKey) {
          const next = new Set(selection.value);
          if (next.has(hit.id)) next.delete(hit.id); else next.add(hit.id);
          selection.value = next;
          if (!next.has(hit.id)) { requestDraw(); return; }
        } else if (!selection.value.has(hit.id)) selection.value = new Set([hit.id]);
        interaction.value = { kind: "move", pointerId: event.pointerId, startX: world.x, startY: world.y, originals: selectedElements(), moved: false, duplicate: event.altKey };
      } else {
        if (!event.shiftKey) selection.value = new Set();
        interaction.value = { kind: "marquee", pointerId: event.pointerId, startX: world.x, startY: world.y, x: world.x, y: world.y, additive: event.shiftKey };
      }
      requestDraw();
      return;
    }
    case "pen": {
      const element = { ...baseElement("pen", world.x, world.y), points: [0, 0] };
      interaction.value = { kind: "draw", pointerId: event.pointerId, element, startX: world.x, startY: world.y };
      return;
    }
    case "line":
    case "arrow":
    case "rect":
    case "ellipse": {
      const element = baseElement(tool.value, world.x, world.y);
      if ((tool.value === "rect" || tool.value === "ellipse") && filled.value) element.fill = color.value;
      interaction.value = { kind: "draw", pointerId: event.pointerId, element, startX: world.x, startY: world.y };
      return;
    }
    case "text": {
      const hit = topmostAt(world.x, world.y);
      if (hit?.type === "text") editText(hit);
      else openTextEditor(world.x, world.y);
      return;
    }
    case "eraser": {
      const ids = new Set<string>();
      const hit = topmostAt(world.x, world.y);
      if (hit) ids.add(hit.id);
      interaction.value = { kind: "erase", pointerId: event.pointerId, ids, lastX: world.x, lastY: world.y };
      requestDraw();
      return;
    }
  }
}

function onPointerMove(event: PointerEvent) {
  const world = toWorld(event.clientX, event.clientY);
  lastPointer = world;
  if (ready.value) props.client.sendCursor(world.x, world.y);
  if (event.pointerType === "touch" && touches.has(event.pointerId)) {
    touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pinch && touches.size === 2) {
      const [a, b] = [...touches.values()];
      const rect = canvas.value!.getBoundingClientRect();
      const midX = (a!.x + b!.x) / 2 - rect.left, midY = (a!.y + b!.y) / 2 - rect.top;
      const zoom = Math.min(8, Math.max(0.1, pinch.zoom * Math.hypot(a!.x - b!.x, a!.y - b!.y) / Math.max(1, pinch.distance)));
      view.zoom = zoom;
      view.x = midX - pinch.worldX * zoom;
      view.y = midY - pinch.worldY * zoom;
      requestDraw();
      return;
    }
  }
  const current = interaction.value;
  if (current.kind === "none" || ("pointerId" in current && current.pointerId !== event.pointerId)) {
    if (tool.value === "select" && canvas.value) canvas.value.style.cursor = handleAt(world.x, world.y) ? "nwse-resize" : topmostAt(world.x, world.y) ? "move" : "";
    else if (canvas.value) canvas.value.style.cursor = "";
    requestDraw();
    return;
  }
  switch (current.kind) {
    case "pan": {
      const rect = canvas.value!.getBoundingClientRect();
      view.x = current.viewX + (event.clientX - rect.left - current.startX);
      view.y = current.viewY + (event.clientY - rect.top - current.startY);
      break;
    }
    case "draw": {
      const element = current.element;
      if (element.type === "pen") {
        const points = element.points!;
        const px = world.x - element.x, py = world.y - element.y;
        const lastX = points[points.length - 2]!, lastY = points[points.length - 1]!;
        if (Math.hypot(px - lastX, py - lastY) * view.zoom >= 1.5 && points.length < WHITEBOARD_LIMITS.maxPenPoints - 2) {
          points.push(round(px), round(py));
        }
      } else {
        let w = world.x - current.startX, h = world.y - current.startY;
        if (event.shiftKey) {
          if (element.type === "line" || element.type === "arrow") {
            const angle = Math.round(Math.atan2(h, w) / (Math.PI / 4)) * (Math.PI / 4);
            const length = Math.hypot(w, h);
            w = Math.cos(angle) * length; h = Math.sin(angle) * length;
          } else {
            const side = Math.max(Math.abs(w), Math.abs(h));
            w = Math.sign(w || 1) * side; h = Math.sign(h || 1) * side;
          }
        }
        if (element.type === "rect" || element.type === "ellipse") {
          const bounds = normalizeBounds(current.startX, current.startY, w, h);
          Object.assign(element, { x: round(bounds.x), y: round(bounds.y), w: round(bounds.w), h: round(bounds.h) });
        } else Object.assign(element, { w: round(w), h: round(h) });
      }
      props.client.sendPreview([element]);
      break;
    }
    case "move": {
      const dx = world.x - current.startX, dy = world.y - current.startY;
      if (!current.moved && Math.hypot(dx, dy) * view.zoom < 3) return;
      current.moved = true;
      if (current.duplicate && movePreview.length === 0) {
        // Alt+drag duplicates: the copies move, the originals stay.
        let z = props.client.nextZ();
        current.originals = current.originals.map((element) => ({ ...element, id: newWhiteboardId(), z: z++ }));
        selection.value = new Set(current.originals.map((element) => element.id));
      }
      movePreview = current.originals.map((element) => translateElement(element, dx, dy));
      props.client.sendPreview(movePreview);
      break;
    }
    case "resize": {
      const from = current.from;
      let left = from.x, top = from.y, right = from.x + from.w, bottom = from.y + from.h;
      if (current.handle.includes("w")) left = world.x; else right = world.x;
      if (current.handle.includes("n")) top = world.y; else bottom = world.y;
      if (event.shiftKey && from.w > 0 && from.h > 0) {
        // Keep the aspect ratio.
        const scale = Math.max(Math.abs(right - left) / from.w, Math.abs(bottom - top) / from.h);
        if (current.handle.includes("w")) left = right - from.w * scale; else right = left + from.w * scale;
        if (current.handle.includes("n")) top = bottom - from.h * scale; else bottom = top + from.h * scale;
      }
      const to = normalizeBounds(left, top, right - left, bottom - top);
      if (to.w < 2 || to.h < 2) return;
      current.current = current.originals.map((element) => scaleElement(element, from, to));
      props.client.sendPreview(current.current);
      break;
    }
    case "marquee":
      current.x = world.x; current.y = world.y;
      break;
    case "erase": {
      // Sample along the stroke so fast swipes do not skip elements.
      const steps = Math.max(1, Math.ceil(Math.hypot(world.x - current.lastX, world.y - current.lastY) * view.zoom / 4));
      for (let step = 1; step <= steps; step++) {
        const x = current.lastX + ((world.x - current.lastX) * step) / steps, y = current.lastY + ((world.y - current.lastY) * step) / steps;
        const tolerance = 8 / view.zoom;
        for (const element of props.client.elements.values()) if (!current.ids.has(element.id) && hitTest(element, x, y, tolerance)) current.ids.add(element.id);
      }
      current.lastX = world.x; current.lastY = world.y;
      break;
    }
  }
  requestDraw();
}

function onPointerUp(event: PointerEvent) {
  touches.delete(event.pointerId);
  if (touches.size < 2) pinch = null;
  const current = interaction.value;
  if (current.kind === "none" || current.pointerId !== event.pointerId) return;
  interaction.value = { kind: "none" };
  switch (current.kind) {
    case "draw": {
      const element = current.element;
      props.client.sendPreview([]);
      const bounds = elementBounds(element);
      const tiny = Math.max(bounds.w, bounds.h) * view.zoom < 3;
      if (element.type === "pen") props.client.upsert([element]);
      else if (!tiny) props.client.upsert([element]);
      break;
    }
    case "move":
      props.client.sendPreview([]);
      if (current.moved && movePreview.length) props.client.upsert(movePreview);
      movePreview = [];
      break;
    case "resize":
      props.client.sendPreview([]);
      if (current.current !== current.originals) props.client.upsert(current.current);
      break;
    case "marquee": {
      const box = normalizeBounds(current.startX, current.startY, current.x - current.startX, current.y - current.startY);
      if (box.w * view.zoom > 2 || box.h * view.zoom > 2) {
        const next = current.additive ? new Set(selection.value) : new Set<string>();
        for (const element of props.client.elements.values()) {
          const bounds = elementBounds(element);
          // Fully inside the box, like most drawing tools.
          if (boundsIntersect(box, bounds) && bounds.x >= box.x && bounds.y >= box.y && bounds.x + bounds.w <= box.x + box.w && bounds.y + bounds.h <= box.y + box.h) next.add(element.id);
        }
        selection.value = next;
      }
      break;
    }
    case "erase":
      if (current.ids.size) props.client.remove([...current.ids]);
      break;
  }
  requestDraw();
}

function cancelInteraction() {
  const current = interaction.value;
  if (current.kind === "draw" || current.kind === "move" || current.kind === "resize") props.client.sendPreview([]);
  interaction.value = { kind: "none" };
  movePreview = [];
  requestDraw();
}
function onPointerCancel(event: PointerEvent) {
  touches.delete(event.pointerId);
  if (touches.size < 2) pinch = null;
  if (interaction.value.kind !== "none" && "pointerId" in interaction.value && interaction.value.pointerId === event.pointerId) cancelInteraction();
}
function onPointerLeave() {
  if (interaction.value.kind === "none") props.client.sendCursor(null, null);
}

function onDoubleClick(event: MouseEvent) {
  if (tool.value !== "select") return;
  const world = toWorld(event.clientX, event.clientY);
  const hit = topmostAt(world.x, world.y);
  if (hit?.type === "text") editText(hit);
  else if (!hit) openTextEditor(world.x, world.y);
}

function onWheel(event: WheelEvent) {
  const rect = canvas.value!.getBoundingClientRect();
  if (event.ctrlKey || event.metaKey) {
    zoomAt(event.clientX - rect.left, event.clientY - rect.top, view.zoom * Math.exp(-event.deltaY * (event.deltaMode === 1 ? 0.05 : 0.0025)));
    return;
  }
  const scale = event.deltaMode === 1 ? 16 : 1;
  view.x -= (event.shiftKey ? event.deltaY : event.deltaX) * scale;
  view.y -= (event.shiftKey ? 0 : event.deltaY) * scale;
  requestDraw();
}

// ------------------------------------------------------------------ text

function openTextEditor(x: number, y: number) {
  textEditor.value = { x: round(x), y: round(y - fontSize.value * 0.6), id: null, value: "", color: color.value, fontSize: fontSize.value, z: props.client.nextZ() };
  void nextTick(() => textArea.value?.focus());
}
function editText(element: WhiteboardElement) {
  textEditor.value = { x: element.x, y: element.y, id: element.id, value: element.text ?? "", color: element.stroke, fontSize: element.fontSize ?? 20, z: element.z };
  selection.value = new Set();
  void nextTick(() => { textArea.value?.focus(); textArea.value?.select(); });
  requestDraw();
}
function commitText() {
  const editor = textEditor.value;
  if (!editor) return;
  textEditor.value = null;
  const text = editor.value.replace(/\s+$/, "").slice(0, WHITEBOARD_LIMITS.maxTextLength);
  const existing = editor.id ? props.client.elements.get(editor.id) : undefined;
  if (!text.trim()) {
    if (existing) props.client.remove([existing.id]);
    requestDraw();
    return;
  }
  const context = canvas.value?.getContext("2d");
  const size = context ? measureText(context, text, editor.fontSize) : { w: text.length * editor.fontSize * 0.6, h: editor.fontSize * TEXT_LINE_HEIGHT };
  const element: WhiteboardElement = {
    ...(existing ?? {}),
    id: existing?.id ?? newWhiteboardId(),
    type: "text", x: editor.x, y: editor.y, w: size.w, h: size.h, z: editor.z,
    stroke: editor.color, strokeWidth: existing?.strokeWidth ?? 1, text, fontSize: editor.fontSize,
  };
  if (!existing || existing.text !== element.text || existing.stroke !== element.stroke || existing.fontSize !== element.fontSize) props.client.upsert([element]);
  requestDraw();
}
function onTextKeydown(event: KeyboardEvent) {
  if (event.key === "Escape" || (event.key === "Enter" && (event.ctrlKey || event.metaKey))) {
    event.preventDefault();
    textArea.value?.blur();
  }
}
const textEditorStyle = computed(() => {
  const editor = textEditor.value;
  if (!editor) return {};
  const screen = toScreen(editor.x, editor.y);
  const size = editor.fontSize * view.zoom;
  const lines = Math.max(1, editor.value.split("\n").length);
  return {
    left: `${screen.x}px`, top: `${screen.y}px`,
    font: `${size}px ${WHITEBOARD_FONT}`, lineHeight: String(TEXT_LINE_HEIGHT), color: editor.color,
    height: `${Math.ceil(lines * size * TEXT_LINE_HEIGHT) + 4}px`,
    minWidth: `${Math.max(40, size * 2)}px`,
  };
});

// ------------------------------------------------------- clipboard & files

const CLIPBOARD_MARKER = "webspeak-whiteboard";

function isEditable(target: EventTarget | null) {
  const element = target as HTMLElement | null;
  return Boolean(element && (element.tagName === "INPUT" || element.tagName === "TEXTAREA" || element.tagName === "SELECT" || element.isContentEditable));
}

function onCopy(event: ClipboardEvent, cut = false) {
  if (isEditable(event.target) || !selection.value.size) return;
  const elements = selectedElements();
  event.clipboardData?.setData("text/plain", JSON.stringify({ [CLIPBOARD_MARKER]: 1, elements }));
  event.preventDefault();
  if (cut) { props.client.remove(elements.map((element) => element.id)); selection.value = new Set(); }
}
const onCut = (event: ClipboardEvent) => onCopy(event, true);

function pasteElements(source: WhiteboardElement[], at?: { x: number; y: number }) {
  const bounds = unionBounds(source.map(elementBounds));
  if (!bounds) return;
  const target = at ?? { x: bounds.x + bounds.w / 2 + 20, y: bounds.y + bounds.h / 2 + 20 };
  const dx = target.x - (bounds.x + bounds.w / 2), dy = target.y - (bounds.y + bounds.h / 2);
  let z = props.client.nextZ();
  const copies = sortByZ(source).map((element) => ({ ...translateElement(element, dx, dy), id: newWhiteboardId(), z: z++ }));
  props.client.upsert(copies);
  tool.value = "select";
  selection.value = new Set(copies.map((element) => element.id));
}

async function addImage(blob: Blob, at?: { x: number; y: number }) {
  if (!ready.value) return;
  showHint(t("whiteboardImageProcessing"));
  try {
    const image = await prepareWhiteboardImage(blob);
    const rect = canvas.value?.getBoundingClientRect();
    // Fit into about 60% of the visible area at the current zoom.
    const maxW = rect ? (rect.width * 0.6) / view.zoom : image.width;
    const maxH = rect ? (rect.height * 0.6) / view.zoom : image.height;
    const scale = Math.min(1, maxW / image.width, maxH / image.height);
    const w = round(image.width * scale), h = round(image.height * scale);
    const center = at ?? lastPointer ?? viewCenter();
    const element: WhiteboardElement = { ...baseElement("image", center.x - w / 2, center.y - h / 2), w, h, stroke: "#000000", strokeWidth: 1, src: image.src };
    props.client.upsert([element]);
    hint.value = "";
    tool.value = "select";
    selection.value = new Set([element.id]);
  } catch (error) {
    showHint(t(errorKeys[error instanceof Error ? error.message : ""] ?? "whiteboardErrorImage"));
  }
}

function onPaste(event: ClipboardEvent) {
  if (isEditable(event.target) || !ready.value || confirm.value) return;
  const data = event.clipboardData;
  if (!data) return;
  const file = [...data.files].find((item) => item.type.startsWith("image/"))
    ?? [...data.items].find((item) => item.kind === "file" && item.type.startsWith("image/"))?.getAsFile();
  if (file) { event.preventDefault(); void addImage(file); return; }
  const text = data.getData("text/plain");
  if (!text) return;
  event.preventDefault();
  try {
    const parsed = JSON.parse(text) as { elements?: unknown };
    if (parsed && typeof parsed === "object" && CLIPBOARD_MARKER in parsed && Array.isArray(parsed.elements)) {
      const elements = parsed.elements.filter((item): item is WhiteboardElement => Boolean(item && typeof item === "object" && "type" in item));
      if (elements.length) pasteElements(elements, lastPointer ?? undefined);
      return;
    }
  } catch { /* plain text */ }
  const center = lastPointer ?? viewCenter();
  const context = canvas.value?.getContext("2d");
  const value = text.slice(0, WHITEBOARD_LIMITS.maxTextLength);
  const size = context ? measureText(context, value, fontSize.value) : { w: 100, h: fontSize.value };
  props.client.upsert([{ ...baseElement("text", center.x, center.y), w: size.w, h: size.h, strokeWidth: 1, text: value, fontSize: fontSize.value }]);
}

function onFilePicked(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (file) void addImage(file, viewCenter());
}
function onDrop(event: DragEvent) {
  const file = [...(event.dataTransfer?.files ?? [])].find((item) => item.type.startsWith("image/"));
  if (file) void addImage(file, toWorld(event.clientX, event.clientY));
}

// --------------------------------------------------------------- keyboard

function undo() { commitText(); cancelInteraction(); props.client.undo(); }
function redo() { commitText(); cancelInteraction(); props.client.redo(); }

function onKeydown(event: KeyboardEvent) {
  if (isEditable(event.target) || confirm.value) {
    if (confirm.value && event.key === "Escape") confirm.value = null;
    return;
  }
  const mod = event.ctrlKey || event.metaKey;
  const key = event.key.toLowerCase();
  if (mod && key === "z") { event.preventDefault(); if (event.shiftKey) redo(); else undo(); return; }
  if (mod && key === "y") { event.preventDefault(); redo(); return; }
  if (mod && key === "a") { event.preventDefault(); tool.value = "select"; selection.value = new Set(props.client.elements.keys()); requestDraw(); return; }
  if (mod && key === "d") { event.preventDefault(); if (selection.value.size) pasteElements(selectedElements()); return; }
  if (mod) return;
  if ((event.key === "Delete" || event.key === "Backspace") && selection.value.size) {
    event.preventDefault();
    props.client.remove([...selection.value]);
    selection.value = new Set();
    return;
  }
  if (event.key === "Escape") { cancelInteraction(); selection.value = new Set(); requestDraw(); return; }
  if (event.key === " " && !event.repeat) { spaceHeld.value = true; event.preventDefault(); return; }
  if (event.key.startsWith("Arrow") && selection.value.size) {
    event.preventDefault();
    const step = event.shiftKey ? 10 : 1;
    const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
    const dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
    props.client.upsert(selectedElements().map((element) => translateElement(element, dx, dy)));
    return;
  }
  const match = tools.find((item) => item.key === key);
  if (match && !event.altKey) { event.preventDefault(); setTool(match.id); }
}
function onKeyup(event: KeyboardEvent) {
  if (event.key === " ") spaceHeld.value = false;
}

// ---------------------------------------------------------------- sheets

function startRename(id: string, label: string) {
  if (id !== sheetId.value) props.client.selectSheet(id);
  renaming.value = id;
  renameValue.value = label;
  void nextTick(() => {
    const input = Array.isArray(renameInput.value) ? renameInput.value[0] : renameInput.value;
    input?.focus();
    input?.select();
  });
}
function commitRename() {
  const id = renaming.value;
  if (!id) return;
  renaming.value = "";
  const index = sheets.value.findIndex((sheet) => sheet.id === id);
  const sheet = sheets.value[index];
  if (!sheet) return;
  const name = renameValue.value.trim();
  // Typing the default label back keeps the sheet unnamed.
  const next = name === t("whiteboardSheetN", { n: index + 1 }) ? "" : name;
  if (next !== sheet.name) props.client.renameSheet(id, next);
}

// ---------------------------------------------------------------- drawing

let frame = 0;
function requestDraw() {
  if (frame || typeof requestAnimationFrame === "undefined") return;
  frame = requestAnimationFrame(() => { frame = 0; draw(); });
}

function drawList(): WhiteboardElement[] {
  const list = props.client.drawList();
  const current = interaction.value;
  const replace = new Map<string, WhiteboardElement>();
  if (current.kind === "move" && movePreview.length) for (const element of movePreview) replace.set(element.id, element);
  if (current.kind === "resize") for (const element of current.current) replace.set(element.id, element);
  const hidden = new Set<string>();
  if (textEditor.value?.id) hidden.add(textEditor.value.id);
  const result = list.filter((element) => !hidden.has(element.id)).map((element) => replace.get(element.id) ?? element);
  for (const element of replace.values()) if (!list.some((item) => item.id === element.id)) result.push(element);
  if (current.kind === "draw") result.push(current.element);
  return sortByZ(result);
}

function draw() {
  const element = canvas.value;
  const host = stage.value;
  if (!element || !host) return;
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  const width = host.clientWidth, height = host.clientHeight;
  if (element.width !== Math.round(width * dpr) || element.height !== Math.round(height * dpr)) {
    element.width = Math.round(width * dpr);
    element.height = Math.round(height * dpr);
    element.style.width = `${width}px`;
    element.style.height = `${height}px`;
  }
  const context = element.getContext("2d");
  if (!context) return;
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  drawGrid(context, width, height);

  context.save();
  context.translate(view.x, view.y);
  context.scale(view.zoom, view.zoom);
  const current = interaction.value;
  const erasing = current.kind === "erase" ? current.ids : null;
  const sources = new Set<string>();
  for (const item of drawList()) {
    if (item.src) sources.add(item.src);
    if (erasing?.has(item.id)) context.globalAlpha = 0.25;
    drawElement(context, item, images);
    context.globalAlpha = 1;
  }
  images.retain(sources);

  // Selection outline and resize handles.
  const selected = current.kind === "resize" ? current.current : current.kind === "move" && movePreview.length ? movePreview : selectedElements();
  if (selected.length && tool.value === "select") {
    context.lineWidth = 1 / view.zoom;
    context.strokeStyle = "#0090ff";
    context.setLineDash([4 / view.zoom, 3 / view.zoom]);
    for (const item of selected) {
      const b = elementBounds(item);
      context.strokeRect(b.x - 3 / view.zoom, b.y - 3 / view.zoom, b.w + 6 / view.zoom, b.h + 6 / view.zoom);
    }
    context.setLineDash([]);
    const bounds = selectionBounds(selected)!;
    const pad = 6 / view.zoom, size = 8 / view.zoom;
    if (selected.length > 1) context.strokeRect(bounds.x - pad, bounds.y - pad, bounds.w + pad * 2, bounds.h + pad * 2);
    context.fillStyle = "#ffffff";
    for (const [hx, hy] of [[bounds.x - pad, bounds.y - pad], [bounds.x + bounds.w + pad, bounds.y - pad], [bounds.x - pad, bounds.y + bounds.h + pad], [bounds.x + bounds.w + pad, bounds.y + bounds.h + pad]] as const) {
      context.fillRect(hx - size / 2, hy - size / 2, size, size);
      context.strokeRect(hx - size / 2, hy - size / 2, size, size);
    }
  }
  if (current.kind === "marquee") {
    const box = normalizeBounds(current.startX, current.startY, current.x - current.startX, current.y - current.startY);
    context.fillStyle = "rgba(0, 144, 255, 0.08)";
    context.strokeStyle = "#0090ff";
    context.lineWidth = 1 / view.zoom;
    context.fillRect(box.x, box.y, box.w, box.h);
    context.strokeRect(box.x, box.y, box.w, box.h);
  }
  context.restore();

  // Other people's cursors, in screen space so they keep their size.
  for (const cursor of props.client.cursors()) {
    const point = toScreen(cursor.x, cursor.y);
    if (point.x < -20 || point.y < -20 || point.x > width + 20 || point.y > height + 20) continue;
    context.save();
    context.translate(point.x, point.y);
    context.fillStyle = cursor.peer.color;
    context.strokeStyle = "#ffffff";
    context.lineWidth = 1.5;
    context.beginPath();
    context.moveTo(0, 0); context.lineTo(0, 16); context.lineTo(4.5, 12); context.lineTo(8, 19); context.lineTo(10.5, 18); context.lineTo(7, 11); context.lineTo(12.5, 11);
    context.closePath();
    context.fill(); context.stroke();
    context.font = `600 11px ${WHITEBOARD_FONT}`;
    const label = cursor.peer.nickname;
    const labelWidth = context.measureText(label).width + 10;
    context.fillRect(12, 18, labelWidth, 18);
    context.fillStyle = "#ffffff";
    context.textBaseline = "middle";
    context.fillText(label, 17, 27.5);
    context.restore();
  }
}

function drawGrid(context: CanvasRenderingContext2D, width: number, height: number) {
  let spacing = 24 * view.zoom;
  while (spacing < 12) spacing *= 2;
  const offsetX = ((view.x % spacing) + spacing) % spacing, offsetY = ((view.y % spacing) + spacing) % spacing;
  context.fillStyle = "#d9dde3";
  for (let x = offsetX; x < width; x += spacing) for (let y = offsetY; y < height; y += spacing) context.fillRect(x - 0.75, y - 0.75, 1.5, 1.5);
}

// ----------------------------------------------------------------- export

function exportPng() {
  const list = props.client.drawList();
  const bounds = unionBounds(list.map((element) => {
    const b = elementBounds(element);
    const pad = element.strokeWidth;
    return { x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 };
  }));
  if (!bounds) { showHint(t("whiteboardExportEmpty")); return; }
  const margin = 32;
  const scale = Math.min(2, 8192 / (bounds.w + margin * 2), 8192 / (bounds.h + margin * 2));
  const output = document.createElement("canvas");
  output.width = Math.ceil((bounds.w + margin * 2) * scale);
  output.height = Math.ceil((bounds.h + margin * 2) * scale);
  const context = output.getContext("2d")!;
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, output.width, output.height);
  context.scale(scale, scale);
  context.translate(margin - bounds.x, margin - bounds.y);
  for (const element of list) drawElement(context, element, images);
  const index = sheets.value.findIndex((sheet) => sheet.id === sheetId.value);
  const label = index >= 0 ? sheetLabel(sheets.value[index]!, index) : "whiteboard";
  output.toBlob((blob) => {
    if (!blob) return;
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${label.replace(/[\\/:*?"<>|]+/g, "_")}.png`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
  }, "image/png");
}

// -------------------------------------------------------------- lifecycle

let resizeObserver: ResizeObserver | null = null;
let ticker: ReturnType<typeof setInterval> | null = null;
let centered = false;
watch(ready, (value) => {
  if (value && !centered) { centered = true; void nextTick(resetView); }
});
onMounted(() => {
  window.addEventListener("keydown", onKeydown);
  window.addEventListener("keyup", onKeyup);
  document.addEventListener("paste", onPaste);
  document.addEventListener("copy", onCopy);
  document.addEventListener("cut", onCut);
  if (typeof ResizeObserver !== "undefined" && stage.value) {
    resizeObserver = new ResizeObserver(() => requestDraw());
    resizeObserver.observe(stage.value);
  }
  // Stale cursors and previews fade out even when nothing else changes.
  ticker = setInterval(() => requestDraw(), 1000);
  if (ready.value) { centered = true; void nextTick(resetView); }
  requestDraw();
});
onBeforeUnmount(() => {
  commitText();
  cancelInteraction();
  props.client.sendCursor(null, null);
  unsubscribe();
  window.removeEventListener("keydown", onKeydown);
  window.removeEventListener("keyup", onKeyup);
  document.removeEventListener("paste", onPaste);
  document.removeEventListener("copy", onCopy);
  document.removeEventListener("cut", onCut);
  resizeObserver?.disconnect();
  if (ticker) clearInterval(ticker);
  if (frame) cancelAnimationFrame(frame);
  if (hintTimer) clearTimeout(hintTimer);
});
watch(() => [view.x, view.y, view.zoom, textEditor.value?.value, textEditor.value?.color, textEditor.value?.fontSize], () => requestDraw());
</script>

<style scoped>
.wb-panel {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  color: var(--text-primary);
  background: var(--surface-1, #fff);
}
.wb-panel svg {
  width: 18px;
  height: 18px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.wb-top {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 52px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
}
.wb-title {
  display: grid;
  min-width: 0;
  flex: 0 1 auto;
}
.wb-title strong {
  overflow: hidden;
  font-size: 15px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wb-kicker {
  color: var(--text-muted);
  font-size: 10px;
  letter-spacing: .08em;
  text-transform: uppercase;
}
.wb-peers {
  display: flex;
  flex: 1 1 auto;
  justify-content: flex-end;
  min-width: 0;
  overflow: hidden;
}
.wb-peer {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  width: 28px;
  height: 28px;
  margin-left: -6px;
  color: #fff;
  border: 2px solid var(--surface-1, #fff);
  border-radius: 50%;
  font-size: 12px;
  font-weight: 700;
}
.wb-actions {
  display: flex;
  gap: 4px;
}
.wb-icon-button,
.wb-tool,
.wb-zoom button,
.wb-sheet-add,
.wb-confirm button {
  display: grid;
  place-items: center;
  min-width: 34px;
  height: 34px;
  padding: 0 6px;
  color: var(--text-primary);
  border: 1px solid transparent;
  border-radius: 9px;
  background: transparent;
  cursor: pointer;
  font: inherit;
}
.wb-icon-button:hover:not(:disabled),
.wb-tool:hover,
.wb-zoom button:hover,
.wb-sheet-add:hover:not(:disabled) {
  background: var(--surface-2);
}
.wb-icon-button:disabled,
.wb-sheet-add:disabled {
  cursor: default;
  opacity: .38;
}
.wb-icon-button.danger:hover:not(:disabled) {
  color: var(--danger, #e5484d);
}
.wb-body {
  position: relative;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  min-height: 0;
}
.wb-tools {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 6px;
  overflow-y: auto;
  border-right: 1px solid var(--border);
}
.wb-tool.active {
  color: var(--accent);
  border-color: color-mix(in srgb, var(--accent) 35%, var(--border));
  background: color-mix(in srgb, var(--accent) 12%, transparent);
}
.wb-tool-separator,
.wb-style-separator {
  flex: 0 0 auto;
  background: var(--border);
}
.wb-tool-separator {
  height: 1px;
  margin: 4px 2px;
}
.wb-style-separator {
  width: 1px;
  height: 22px;
  margin: 0 2px;
}
.wb-stage {
  position: relative;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: #fff;
}
.wb-canvas {
  position: absolute;
  inset: 0;
  display: block;
  touch-action: none;
  cursor: crosshair;
}
.wb-canvas.tool-select { cursor: default; }
.wb-canvas.tool-hand { cursor: grab; }
.wb-canvas.panning { cursor: grabbing; }
.wb-canvas.tool-text { cursor: text; }
.wb-text-editor {
  position: absolute;
  z-index: 2;
  margin: 0;
  padding: 0;
  overflow: hidden;
  border: 1px dashed #0090ff;
  outline: none;
  background: rgba(255, 255, 255, .85);
  resize: none;
  white-space: pre;
  field-sizing: content;
}
.wb-style {
  position: absolute;
  top: 10px;
  left: 50%;
  z-index: 3;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 5px;
  max-width: calc(100% - 20px);
  padding: 6px 8px;
  color: #1f2328;
  border: 1px solid #dfe3e8;
  border-radius: 12px;
  background: rgba(255, 255, 255, .96);
  box-shadow: 0 6px 22px rgba(15, 23, 42, .12);
  transform: translateX(-50%);
}
.wb-swatch {
  position: relative;
  width: 22px;
  height: 22px;
  padding: 0;
  border: 1px solid rgba(15, 23, 42, .2);
  border-radius: 50%;
  cursor: pointer;
}
.wb-swatch.active {
  outline: 2px solid #0090ff;
  outline-offset: 2px;
}
.wb-custom-color {
  overflow: hidden;
  background: conic-gradient(#e5484d, #ffb224, #30a46c, #0090ff, #8e4ec6, #e5484d);
}
.wb-custom-color input {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  cursor: pointer;
}
.wb-width,
.wb-fill {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  padding: 0;
  color: #1f2328;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  cursor: pointer;
}
.wb-width i {
  display: block;
  border-radius: 50%;
  background: #1f2328;
}
.wb-width.active,
.wb-fill.active {
  border-color: #0090ff;
  background: rgba(0, 144, 255, .1);
}
.wb-fill svg {
  width: 18px;
  height: 18px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
}
.wb-font {
  height: 28px;
  color: #1f2328;
  border: 1px solid #dfe3e8;
  border-radius: 8px;
  background: #fff;
  font: inherit;
  font-size: 12px;
}
.wb-zoom {
  position: absolute;
  right: 10px;
  bottom: 10px;
  z-index: 3;
  display: flex;
  gap: 2px;
  padding: 3px;
  color: #1f2328;
  border: 1px solid #dfe3e8;
  border-radius: 10px;
  background: rgba(255, 255, 255, .96);
}
.wb-zoom button {
  min-width: 30px;
  height: 28px;
  color: #1f2328;
  font-size: 15px;
}
.wb-zoom .wb-zoom-value {
  min-width: 52px;
  font-size: 12px;
}
.wb-zoom button:hover {
  background: #eef1f4;
}
.wb-status,
.wb-hint {
  position: absolute;
  left: 50%;
  z-index: 3;
  padding: 7px 12px;
  color: #fff;
  border-radius: 999px;
  background: rgba(31, 35, 40, .86);
  font-size: 12px;
  transform: translateX(-50%);
  pointer-events: none;
}
.wb-status { top: 50%; }
.wb-hint { bottom: 16px; }
.wb-confirm {
  position: absolute;
  top: 50%;
  left: 50%;
  z-index: 4;
  width: min(320px, calc(100% - 32px));
  padding: 16px;
  color: var(--text-primary);
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--surface-1, #fff);
  box-shadow: 0 20px 60px rgba(15, 23, 42, .25);
  transform: translate(-50%, -50%);
}
.wb-confirm p {
  margin: 0 0 14px;
  font-size: 14px;
  line-height: 1.4;
}
.wb-confirm div {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.wb-confirm button {
  border-color: var(--border);
}
.wb-confirm button.danger {
  color: #fff;
  border-color: var(--danger, #e5484d);
  background: var(--danger, #e5484d);
}
.wb-sheets {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 44px;
  padding: 5px 10px;
  border-top: 1px solid var(--border);
}
.wb-sheet-list {
  display: flex;
  flex: 1 1 auto;
  gap: 4px;
  min-width: 0;
  overflow-x: auto;
}
.wb-sheet {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  max-width: 220px;
  border: 1px solid var(--border);
  border-radius: 9px;
  background: var(--surface-2);
}
.wb-sheet.active {
  color: var(--accent);
  border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
  background: color-mix(in srgb, var(--accent) 12%, var(--surface-1, #fff));
}
.wb-sheet-name {
  min-width: 0;
  max-width: 160px;
  height: 30px;
  padding: 0 10px;
  overflow: hidden;
  color: inherit;
  border: 0;
  background: transparent;
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wb-sheet-rename {
  width: 140px;
  height: 28px;
  margin: 1px 4px;
  padding: 0 6px;
  color: var(--text-primary);
  border: 1px solid var(--accent);
  border-radius: 6px;
  background: var(--surface-1, #fff);
  font: inherit;
  font-size: 12px;
}
.wb-sheet-edit,
.wb-sheet-delete {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  margin-right: 3px;
  padding: 0;
  color: var(--text-muted);
  border: 0;
  border-radius: 6px;
  background: transparent;
  cursor: pointer;
}
.wb-sheet-edit svg,
.wb-sheet-delete svg {
  width: 14px;
  height: 14px;
}
.wb-sheet-delete:hover {
  color: var(--danger, #e5484d);
}
.wb-sheet-add {
  display: flex;
  flex: 0 0 auto;
  gap: 5px;
  border-color: var(--border);
  font-size: 12px;
}
@media (max-width: 640px) {
  .wb-top { gap: 6px; padding: 6px 8px; }
  .wb-body { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr); }
  .wb-tools { flex-direction: row; padding: 4px 6px; overflow-x: auto; border-right: 0; border-bottom: 1px solid var(--border); }
  .wb-tool-separator { width: 1px; height: auto; margin: 2px 4px; }
  .wb-style { top: auto; bottom: 52px; flex-wrap: nowrap; justify-content: flex-start; overflow-x: auto; }
  .wb-swatch, .wb-width, .wb-fill, .wb-font { flex: 0 0 auto; }
  .wb-sheet-add span { display: none; }
}
</style>
