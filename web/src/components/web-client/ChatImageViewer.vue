<template>
  <Teleport to="body">
    <div
      v-if="imageViewer.open && current"
      ref="root"
      class="ws-image-viewer"
      data-ws-part="voice.chat.image-viewer"
      role="dialog"
      aria-modal="true"
      :aria-label="t('imageViewer')"
    >
      <div
        ref="stage"
        class="ws-image-viewer-stage"
        data-ws-part="voice.chat.image-viewer.stage"
        :class="{ dragging: pointers.size > 0, zoomed: zoomed }"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointercancel="onPointerUp"
        @wheel.prevent="onWheel"
        @dblclick="onDoubleClick"
      >
        <img
          :key="current.src"
          class="ws-image-viewer-image"
          :class="{ ready: natural.width > 0 }"
          :src="current.src"
          :alt="current.name"
          draggable="false"
          :style="imageStyle"
          @load="onImageLoad"
        />
      </div>

      <div
        class="ws-image-viewer-toolbar"
        data-ws-part="voice.chat.image-viewer.toolbar"
        ><button
          type="button"
          :aria-label="t('imageZoomOut')"
          :title="t('imageZoomOut')"
          :disabled="view.scale <= fitScale + 0.001"
          @click="zoomBy(1 / 1.5)"
          ><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M8 11h6M16.5 16.5 21 21" /></svg></button
        ><button
          type="button"
          class="ws-image-viewer-percent"
          :title="t('imageFit')"
          @click="resetView"
          >{{ Math.round(view.scale * 100) }}%</button
        ><button
          type="button"
          :aria-label="t('imageZoomIn')"
          :title="t('imageZoomIn')"
          :disabled="view.scale >= IMAGE_VIEWER_MAX_SCALE - 0.001"
          @click="zoomBy(1.5)"
          ><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M8 11h6M11 8v6M16.5 16.5 21 21" /></svg></button
        ><a
          :href="current.src"
          target="_blank"
          rel="noopener noreferrer"
          :aria-label="t('imageOpenOriginal')"
          :title="t('imageOpenOriginal')"
          ><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></svg></a
        ><button
          ref="closeButton"
          type="button"
          :aria-label="t('close')"
          :title="t('close')"
          @click="close"
          ><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg></button
      ></div>

      <template v-if="imageViewer.images.length > 1">
        <button
          type="button"
          class="ws-image-viewer-step previous"
          data-ws-part="voice.chat.image-viewer.previous"
          :aria-label="t('imagePrevious')"
          :title="t('imagePrevious')"
          @click="step(-1)"
          ><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg></button
        >
        <button
          type="button"
          class="ws-image-viewer-step next"
          data-ws-part="voice.chat.image-viewer.next"
          :aria-label="t('imageNext')"
          :title="t('imageNext')"
          @click="step(1)"
          ><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7" /></svg></button
        >
      </template>

      <div
        class="ws-image-viewer-caption"
        data-ws-part="voice.chat.image-viewer.caption"
        ><span>{{ current.name }}</span
        ><small v-if="imageViewer.images.length > 1">{{ imageViewer.index + 1 }} / {{ imageViewer.images.length }}</small></div
      >
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from "vue";
import {
  IMAGE_VIEWER_MAX_SCALE, clampPan, closeImageViewer, imageViewer, stepImageViewer, zoomAround, type ZoomView,
} from "../../services/image-viewer.js";

defineProps<{ t: (key: string) => string }>();

const root = ref<HTMLElement | null>(null);
const stage = ref<HTMLElement | null>(null);
const closeButton = ref<HTMLButtonElement | null>(null);
const natural = reactive({ width: 0, height: 0 });
const stageSize = reactive({ width: 0, height: 0 });
/** The whole stage, for keeping a zoomed image on screen. */
const fullSize = reactive({ width: 0, height: 0 });
let lastTap = 0;
/** When a touch double tap last toggled the zoom; the browser may add its own dblclick. */
let lastTouchToggle = -Infinity;
const view = reactive<ZoomView>({ scale: 1, x: 0, y: 0 });
const pointers = reactive(new Map<number, { x: number; y: number }>());
let gesture: { view: ZoomView; distance: number; midX: number; midY: number; startX: number; startY: number; moved: boolean; onImage: boolean } | null = null;
let opener: HTMLElement | null = null;

const current = computed(() => imageViewer.images[imageViewer.index] ?? null);
/** Whole image visible, never enlarged past its own pixels. */
const fitScale = computed(() => natural.width && stageSize.width
  ? Math.min(1, stageSize.width / natural.width, stageSize.height / natural.height)
  : 1);
const zoomed = computed(() => view.scale > fitScale.value + 0.001);
const imageStyle = computed(() => natural.width
  ? { width: `${natural.width}px`, height: `${natural.height}px`, transform: `translate(-50%, -50%) translate(${view.x}px, ${view.y}px) scale(${view.scale})` }
  : {});

function measureStage(): void {
  const rect = stage.value?.getBoundingClientRect();
  if (!rect) return;
  fullSize.width = rect.width;
  fullSize.height = rect.height;
  // Leave room for the toolbar, the arrows and the caption.
  // Phones hide the arrows (swipe instead), so the picture may use the full width.
  const narrow = rect.width <= 600;
  stageSize.width = Math.max(1, rect.width - (narrow ? 16 : imageViewer.images.length > 1 ? 136 : 32));
  stageSize.height = Math.max(1, rect.height - (narrow ? 140 : 132));
}

function applyView(next: ZoomView): void {
  const clamped = clampPan(next, natural.width, natural.height, fullSize.width, fullSize.height);
  view.scale = clamped.scale;
  view.x = clamped.x;
  view.y = clamped.y;
}

function resetView(): void {
  measureStage();
  view.scale = fitScale.value;
  view.x = 0;
  view.y = 0;
}

function onImageLoad(event: Event): void {
  const image = event.target as HTMLImageElement;
  natural.width = image.naturalWidth;
  natural.height = image.naturalHeight;
  resetView();
}

/** Cursor position relative to the stage centre. */
function centred(clientX: number, clientY: number): { x: number; y: number } {
  const rect = stage.value?.getBoundingClientRect();
  return rect ? { x: clientX - rect.left - rect.width / 2, y: clientY - rect.top - rect.height / 2 } : { x: 0, y: 0 };
}

function zoomBy(factor: number, at = { x: 0, y: 0 }): void {
  if (!natural.width) return;
  applyView(zoomAround(view, view.scale * factor, at.x, at.y, fitScale.value));
}

function onWheel(event: WheelEvent): void {
  // Trackpad pinches arrive as ctrl+wheel with small deltas; mouse wheels as larger steps.
  const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
  zoomBy(Math.exp(-delta * (event.ctrlKey ? 0.01 : 0.0015)), centred(event.clientX, event.clientY));
}

function onDoubleClick(event: MouseEvent): void {
  if (performance.now() - lastTouchToggle < 600) return;
  toggleZoom(event.clientX, event.clientY);
}

function toggleZoom(clientX: number, clientY: number): void {
  if (zoomed.value) { resetView(); return; }
  // Show the real pixels, or at least two and a half times the fitted size for small images.
  zoomBy(Math.max(1, fitScale.value * 2.5) / view.scale, centred(clientX, clientY));
}

function onPointerDown(event: PointerEvent): void {
  if (event.pointerType === "mouse" && event.button !== 0) return;
  try { stage.value?.setPointerCapture(event.pointerId); } catch { /* still track it */ }
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  startGesture(event.target === event.currentTarget ? false : true);
}

function startGesture(onImage: boolean): void {
  const points = [...pointers.values()];
  const mid = points.reduce((sum, point) => ({ x: sum.x + point.x / points.length, y: sum.y + point.y / points.length }), { x: 0, y: 0 });
  const distance = points.length > 1 ? Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y) : 0;
  gesture = { view: { ...view }, distance, midX: mid.x, midY: mid.y, startX: mid.x, startY: mid.y, moved: gesture?.moved ?? false, onImage: gesture?.onImage ?? onImage };
}

function onPointerMove(event: PointerEvent): void {
  if (!pointers.has(event.pointerId) || !gesture) return;
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  const points = [...pointers.values()];
  const mid = points.reduce((sum, point) => ({ x: sum.x + point.x / points.length, y: sum.y + point.y / points.length }), { x: 0, y: 0 });
  if (Math.hypot(mid.x - gesture.startX, mid.y - gesture.startY) > 6) gesture.moved = true;
  if (points.length > 1 && gesture.distance > 0) {
    // Pinch: scale about the starting midpoint, then follow the fingers.
    const distance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
    const anchor = centred(gesture.midX, gesture.midY);
    const scaled = zoomAround(gesture.view, gesture.view.scale * distance / gesture.distance, anchor.x, anchor.y, fitScale.value);
    applyView({ scale: scaled.scale, x: scaled.x + mid.x - gesture.midX, y: scaled.y + mid.y - gesture.midY });
    gesture.moved = true;
    return;
  }
  if (zoomed.value) applyView({ scale: view.scale, x: gesture.view.x + mid.x - gesture.midX, y: gesture.view.y + mid.y - gesture.midY });
}

function onPointerUp(event: PointerEvent): void {
  if (!pointers.has(event.pointerId)) return;
  const last = pointers.get(event.pointerId)!;
  pointers.delete(event.pointerId);
  try { stage.value?.releasePointerCapture(event.pointerId); } catch { /* already released */ }
  if (!gesture) return;
  if (pointers.size) { startGesture(gesture.onImage); return; }
  const finished = gesture;
  gesture = null;
  const dx = last.x - finished.startX;
  const dy = last.y - finished.startY;
  // A swipe on an unzoomed image changes the picture.
  if (!zoomed.value && imageViewer.images.length > 1 && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) { step(dx < 0 ? 1 : -1); return; }
  if (finished.moved || event.type !== "pointerup") return;
  // A plain click beside the image closes the viewer.
  if (!finished.onImage) { close(); return; }
  // Touch has no dblclick here (touch-action: none): detect the double tap.
  if (event.pointerType === "touch") {
    const now = performance.now();
    if (now - lastTap < 320) { lastTap = 0; lastTouchToggle = now; toggleZoom(last.x, last.y); } else lastTap = now;
  }
}

function step(delta: number): void {
  stepImageViewer(delta);
}

function close(): void {
  closeImageViewer();
}

function onKeydown(event: KeyboardEvent): void {
  if (!imageViewer.open || event.altKey || event.ctrlKey || event.metaKey) return;
  // Keys typed while the viewer is open belong to it, not to the chat behind it.
  event.stopPropagation();
  if (event.key === "Escape") { event.preventDefault(); close(); }
  else if (event.key === "ArrowLeft") { event.preventDefault(); step(-1); }
  else if (event.key === "ArrowRight") { event.preventDefault(); step(1); }
  else if (event.key === "+" || event.key === "=") { event.preventDefault(); zoomBy(1.5); }
  else if (event.key === "-") { event.preventDefault(); zoomBy(1 / 1.5); }
  else if (event.key === "0") { event.preventDefault(); resetView(); }
  else if (event.key === "Tab") trapFocus(event);
}

function trapFocus(event: KeyboardEvent): void {
  const focusable = [...(root.value?.querySelectorAll<HTMLElement>("button:not(:disabled), a[href]") ?? [])];
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}

function onResize(): void {
  const wasFitted = !zoomed.value;
  measureStage();
  if (wasFitted) resetView();
  else applyView({ ...view });
}

watch(() => current.value?.src, () => {
  natural.width = 0;
  natural.height = 0;
  view.scale = 1;
  view.x = 0;
  view.y = 0;
  pointers.clear();
  gesture = null;
});

watch(() => imageViewer.open, async (open) => {
  if (open) {
    opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    window.addEventListener("resize", onResize);
    // On the window: a click on the picture moves focus to the page body.
    window.addEventListener("keydown", onKeydown, true);
    await nextTick();
    measureStage();
    closeButton.value?.focus({ preventScroll: true });
  } else {
    window.removeEventListener("resize", onResize);
    window.removeEventListener("keydown", onKeydown, true);
    pointers.clear();
    gesture = null;
    opener?.focus({ preventScroll: true });
    opener = null;
  }
}, { immediate: true });

onBeforeUnmount(() => {
  window.removeEventListener("resize", onResize);
  window.removeEventListener("keydown", onKeydown, true);
  if (imageViewer.open) closeImageViewer();
});
</script>

<style scoped>
.ws-image-viewer {
  position: fixed;
  inset: 0;
  z-index: 1000;
  overflow: hidden;
  color: #f2f4f5;
  background: rgba(8, 9, 11, .92);
  font-family: inherit;
  animation: ws-image-viewer-in .14s ease-out;
}

.ws-image-viewer-stage {
  position: absolute;
  inset: 0;
  overflow: hidden;
  cursor: zoom-out;
  touch-action: none;
  user-select: none;
}

.ws-image-viewer-image {
  position: absolute;
  top: 50%;
  left: 50%;
  max-width: none;
  opacity: 0;
  cursor: zoom-in;
  transform-origin: center;
  will-change: transform;
  image-rendering: auto;
  -webkit-user-drag: none;
}

.ws-image-viewer-image.ready { opacity: 1; transition: opacity .12s ease; }
.ws-image-viewer-stage.zoomed .ws-image-viewer-image { cursor: grab; }
.ws-image-viewer-stage.zoomed.dragging .ws-image-viewer-image { cursor: grabbing; }

.ws-image-viewer-toolbar {
  position: absolute;
  top: 14px;
  right: 14px;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px;
  border: 1px solid rgba(255, 255, 255, .1);
  border-radius: 12px;
  background: rgba(24, 26, 30, .82);
  backdrop-filter: blur(8px);
}

.ws-image-viewer-toolbar > button,
.ws-image-viewer-toolbar > a,
.ws-image-viewer-step {
  display: inline-grid;
  place-items: center;
  width: 38px;
  height: 38px;
  padding: 0;
  border: 0;
  border-radius: 9px;
  color: inherit;
  background: transparent;
  cursor: pointer;
}

.ws-image-viewer-toolbar > button:hover:not(:disabled),
.ws-image-viewer-toolbar > a:hover,
.ws-image-viewer-step:hover { background: rgba(255, 255, 255, .12); }
.ws-image-viewer-toolbar > button:focus-visible,
.ws-image-viewer-toolbar > a:focus-visible,
.ws-image-viewer-step:focus-visible { outline: 2px solid #9fd4ff; outline-offset: 1px; }
.ws-image-viewer-toolbar > button:disabled { opacity: .35; cursor: default; }

.ws-image-viewer-toolbar .ws-image-viewer-percent {
  width: auto;
  min-width: 54px;
  padding: 0 6px;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}

.ws-image-viewer svg {
  width: 20px;
  height: 20px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.ws-image-viewer-step {
  position: absolute;
  top: 50%;
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: rgba(24, 26, 30, .7);
  transform: translateY(-50%);
}

.ws-image-viewer-step.previous { left: 14px; }
.ws-image-viewer-step.next { right: 14px; }
.ws-image-viewer-step svg { width: 24px; height: 24px; }

.ws-image-viewer-caption {
  position: absolute;
  right: 80px;
  bottom: 16px;
  left: 80px;
  display: flex;
  justify-content: center;
  align-items: baseline;
  gap: 10px;
  min-width: 0;
  pointer-events: none;
  font-size: 13px;
}

.ws-image-viewer-caption span {
  overflow: hidden;
  max-width: 100%;
  padding: 5px 10px;
  border-radius: 8px;
  background: rgba(24, 26, 30, .7);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ws-image-viewer-caption small { color: #b9bec6; font-variant-numeric: tabular-nums; }

@media (max-width: 600px) {
  .ws-image-viewer-toolbar { top: max(10px, env(safe-area-inset-top)); right: 10px; }
  .ws-image-viewer-toolbar > button,
  .ws-image-viewer-toolbar > a { width: 40px; height: 40px; }
  .ws-image-viewer-step { display: none; }
  .ws-image-viewer-caption { right: 16px; left: 16px; bottom: max(14px, env(safe-area-inset-bottom)); }
}

@keyframes ws-image-viewer-in { from { opacity: 0; } to { opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .ws-image-viewer { animation: none; } }
</style>
