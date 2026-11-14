<template>
  <!-- Someone else's video: an offer that does not get in the way. -->
  <div
    v-if="room && !client.state.watching && dismissed !== room.id"
    class="wt-offer"
    data-ws-part="voice.watch.offer"
    role="status"
  >
    <span class="wt-offer-icon" aria-hidden="true">▶</span>
    <span class="wt-offer-text">
      <strong>{{ room.title || t("watchUntitled") }}</strong>
      <small>{{ t("watchFrom", { name: room.startedBy }) }}<template v-if="room.viewers.length"> · {{ t("watchViewers", { count: room.viewers.length }) }}</template><template v-if="room.queue.length"> · {{ t("watchQueueCount", { count: room.queue.length }) }}</template></small>
    </span>
    <button type="button" class="wt-btn wt-btn-accent" @click="client.setWatching(true)">{{ t("watchJoin") }}</button>
    <button type="button" class="wt-icon-btn" :aria-label="t('watchHide')" :title="t('watchHide')" @click="dismissed = room.id"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button>
  </div>

  <!-- The player window. -->
  <section
    v-if="room && client.state.watching"
    ref="windowEl"
    :class="['wt-window', `wt-${size}`, { 'wt-full': fullscreen, 'wt-dragged': placed }]"
    :style="placed && !fullscreen ? { left: `${placed.left}px`, top: `${placed.top}px` } : undefined"
    data-ws-part="voice.watch"
    :aria-label="t('watchTitle')"
  >
    <header class="wt-head" @pointerdown="dragStart">
      <span class="wt-title">
        <strong :title="room.title || room.media.url">{{ room.title || t("watchUntitled") }}</strong>
        <small :title="room.viewers.join(', ')">{{ t("watchFrom", { name: room.startedBy }) }} · {{ t("watchViewers", { count: room.viewers.length }) }}</small>
      </span>
      <button v-if="room.media.kind === 'youtube'" type="button" class="wt-icon-btn" :aria-label="t('watchSignIn')" :title="t('watchSignIn')" data-ws-part="voice.watch.sign-in" @click="signIn"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8.5" r="3.5"/><path d="M5 19.5a7 7 0 0 1 14 0"/></svg></button>
      <button type="button" class="wt-icon-btn" :aria-label="t('watchOther')" :title="t('watchOther')" @click="startOpen = true"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></button>
      <button v-if="!fullscreen" type="button" class="wt-icon-btn" :aria-label="t('watchSize')" :title="t('watchSize')" @click="toggleSize"><template v-if="size === 'large'"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5.5" width="17" height="13" rx="1.5"/><path d="M12.5 10.5h5v5h-5z"/></svg></template><template v-else><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5.5" width="17" height="13" rx="1.5"/><path d="M13 14.5h4.5V11"/></svg></template></button>
      <button type="button" class="wt-icon-btn" :aria-label="t('watchFullscreen')" :title="t('watchFullscreen')" @click="toggleFullscreen"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/></svg></button>
      <button type="button" class="wt-icon-btn" :aria-label="t('watchClose')" :title="t('watchClose')" @click="client.setWatching(false)"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button>
    </header>
    <div class="wt-stage" data-ws-part="voice.watch.player">
      <div ref="host" class="wt-host"></div>
      <!-- Clicks on the picture go through the shared controls, not the embed's own. -->
      <button type="button" class="wt-veil" :aria-label="room.playing ? t('watchPause') : t('watchPlay')" @click="togglePlay" @dblclick.prevent="toggleFullscreen"></button>
      <button v-if="blocked" type="button" class="wt-blocked" @click="unblock">▶ {{ t("watchBlocked") }}</button>
      <p v-if="toast" class="wt-toast" role="status">{{ toast }}</p>
      <p v-if="problem" class="wt-problem" role="alert">{{ problem }}</p>
      <!-- YouTube's own "sign in" screen sits under the veil, so the way to sign in is ours. -->
      <div v-if="signInHint && room.media.kind === 'youtube'" class="wt-signin" role="status">
        <span>{{ t("watchSignInHint") }}</span>
        <button type="button" class="wt-btn wt-btn-accent" @click="signIn">{{ t("watchSignIn") }}</button>
        <button type="button" class="wt-icon-btn" :aria-label="t('watchHide')" :title="t('watchHide')" @click="signInHint = false"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button>
      </div>
    </div>
    <div class="wt-controls" data-ws-part="voice.watch.controls">
      <button type="button" class="wt-icon-btn wt-play" :aria-label="room.playing ? t('watchPause') : t('watchPlay')" :title="room.playing ? t('watchPause') : t('watchPlay')" @click="togglePlay"><template v-if="room.playing"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor" stroke="none"/></svg></template><template v-else><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15l12-7.5z" fill="currentColor" stroke="none"/></svg></template></button>
      <button type="button" class="wt-icon-btn" :aria-label="t('watchBack')" :title="t('watchBack')" @click="skip(-10)"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12a8 8 0 1 0 2.3-5.6M4 4v4h4"/><text x="12" y="15.5" text-anchor="middle" font-size="7.5" fill="currentColor" stroke="none" font-weight="700">10</text></svg></button>
      <button type="button" class="wt-icon-btn" :aria-label="t('watchForward')" :title="t('watchForward')" @click="skip(10)"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.3-5.6M20 4v4h-4"/><text x="12" y="15.5" text-anchor="middle" font-size="7.5" fill="currentColor" stroke="none" font-weight="700">10</text></svg></button>
      <span class="wt-time">{{ clock(shown) }}</span>
      <input
        class="wt-seek"
        type="range"
        min="0"
        :max="Math.max(1, length)"
        step="1"
        :value="Math.min(shown, length || shown)"
        :disabled="!length"
        :aria-label="t('watchTitle')"
        @input="scrub = Number(($event.target as HTMLInputElement).value)"
        @change="seekTo(Number(($event.target as HTMLInputElement).value))"
      />
      <span class="wt-time">{{ length ? clock(length) : "--:--" }}</span>
      <button type="button" class="wt-icon-btn" :aria-label="t('watchMute')" :title="t('watchMute')" :aria-pressed="muted" @click="setMuted(!muted)"><template v-if="muted || volume === 0"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z"/><path d="m16 9.5 5 5m0-5-5 5"/></svg></template><template v-else><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/></svg></template></button>
      <button v-if="room.queue.length" type="button" class="wt-icon-btn" :aria-label="t('watchNext')" :title="t('watchNext')" @click="client.next()"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5.5v13l9-6.5z" fill="currentColor" stroke="none"/><path d="M17.5 5.5v13" stroke-width="2.4"/></svg></button>
      <input class="wt-volume" type="range" min="0" max="100" :value="Math.round(volume * 100)" :aria-label="t('watchVolume')" :title="t('watchVolume')" @input="setVolume(Number(($event.target as HTMLInputElement).value) / 100)" />
      <button type="button" :class="['wt-btn', 'wt-stop', { 'wt-armed': stopArmed }]" @click="stopForAll">{{ stopArmed ? t("watchStopConfirm") : t("watchStop") }}</button>
    </div>
    <div v-if="room.queue.length && !fullscreen" class="wt-queue" data-ws-part="voice.watch.queue">
      <button type="button" class="wt-queue-toggle" :aria-expanded="queueOpen" @click="queueOpen = !queueOpen">
        <span>{{ t("watchQueue") }} · {{ room.queue.length }}</span>
        <svg :class="{ 'wt-flip': queueOpen }" viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5"/></svg>
      </button>
      <ol v-if="queueOpen" class="wt-queue-list">
        <li v-for="(item, index) in room.queue" :key="item.key" class="wt-queue-item">
          <b>{{ index + 1 }}</b>
          <img v-if="item.media.kind === 'youtube'" class="wt-thumb" :src="`https://i.ytimg.com/vi/${item.media.id}/mqdefault.jpg`" alt="" loading="lazy" referrerpolicy="no-referrer" @error="($event.target as HTMLImageElement).style.visibility = 'hidden'" />
          <span v-else class="wt-thumb wt-thumb-file" aria-hidden="true">🎞</span>
          <span class="wt-queue-text"><strong :title="item.media.url">{{ queueLabel(item) }}</strong><small>{{ t("watchAddedBy", { name: item.addedBy }) }}</small></span>
          <button type="button" class="wt-icon-btn" :aria-label="t('watchQueueRemove')" :title="t('watchQueueRemove')" @click="client.removeQueued(item.key)"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button>
        </li>
      </ol>
    </div>
  </section>

  <!-- Starting a video. -->
  <div v-if="startOpen" class="wt-dialog-backdrop" @click.self="startOpen = false" @keydown.esc="startOpen = false">
    <form class="wt-dialog" data-ws-part="voice.watch.start" role="dialog" aria-modal="true" :aria-label="t('watchTitle')" @submit.prevent="submit('queue')">
      <h2>▶ {{ t("watchTitle") }}</h2>
      <label>
        <span>{{ t("watchUrlLabel") }}</span>
        <input ref="urlInput" v-model="url" type="url" inputmode="url" autocomplete="off" :placeholder="t('watchUrlPlaceholder')" maxlength="2000" />
      </label>
      <p class="wt-hint">{{ t("watchStartHint") }}</p>
      <p v-if="formProblem" class="wt-form-problem" role="alert">{{ formProblem }}</p>
      <div class="wt-dialog-actions">
        <button type="button" class="wt-btn" @click="startOpen = false">{{ t("cancel") }}</button>
        <template v-if="room">
          <button type="button" class="wt-btn" :disabled="!url.trim()" @click="submit('now')">{{ t("watchPlayNow") }}</button>
          <button type="submit" class="wt-btn wt-btn-accent" :disabled="!url.trim()">{{ t("watchQueueAdd") }}</button>
        </template>
        <button v-else type="submit" class="wt-btn wt-btn-accent" :disabled="!url.trim()">{{ t("watchStart") }}</button>
      </div>
    </form>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import { parseWatchUrl, type WatchQueueItem, type WatchRoomView } from "../../../../src/shared/watch-together.js";
import type { WatchClient } from "../../watch/watch-client.js";
import { createMediaPlayer, type MediaPlayer } from "../../watch/media-player.js";

const props = defineProps<{ client: WatchClient; t: (key: string, variables?: Record<string, string | number>) => string; selfName: string }>();

const VOLUME_KEY = "webspeak:watch-volume";
const SIZE_KEY = "webspeak:watch-size";
const read = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
const write = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* per-browser convenience only */ } };

const room = computed<WatchRoomView | null>(() => props.client.state.room);
const dismissed = ref("");
const startOpen = ref(false);
const url = ref("");
const formProblem = ref("");
const urlInput = ref<HTMLInputElement | null>(null);
const host = ref<HTMLElement | null>(null);
const windowEl = ref<HTMLElement | null>(null);
const player = shallowRef<MediaPlayer | null>(null);
const blocked = ref(false);
const signInHint = ref(false);
let blockedTimes = 0;
let stalledTicks = 0;
const problem = ref("");
const toast = ref("");
const shown = ref(0);
const scrub = ref<number | null>(null);
const size = ref<"small" | "large">(read(SIZE_KEY) === "large" ? "large" : "small");
const fullscreen = ref(false);
const placed = ref<{ left: number; top: number } | null>(null);
const stopArmed = ref(false);
const storedVolume = Number(read(VOLUME_KEY));
const volume = ref(Number.isFinite(storedVolume) && read(VOLUME_KEY) !== null ? Math.min(1, Math.max(0, storedVolume)) : 0.8);
const muted = ref(false);

const length = computed(() => room.value?.duration || player.value?.duration() || 0);

function errorText(code: string): string {
  if (code === "WATCH_BAD_URL") return props.t("watchErrorBadUrl");
  if (code === "WATCH_VIDEO_UNAVAILABLE") return props.t("watchErrorUnavailable");
  if (code === "WATCH_EMBED_FORBIDDEN") return props.t("watchErrorEmbed");
  if (code === "WATCH_YOUTUBE_UNAVAILABLE") return props.t("watchErrorYoutube");
  if (code === "WATCH_QUEUE_FULL") return props.t("watchErrorQueueFull");
  return props.t("watchErrorGeneric", { code });
}

/** Opens the player for the channel's video, or the form to start one. */
function open(): void {
  if (room.value) {
    props.client.setWatching(true);
    dismissed.value = "";
  } else {
    startOpen.value = true;
  }
}
defineExpose({ open });

watch(startOpen, async value => {
  if (!value) return;
  url.value = "";
  formProblem.value = "";
  props.client.clearError();
  await nextTick();
  urlInput.value?.focus();
});

/** Queue by default while something plays; "now" replaces the current video. */
function submit(mode: "queue" | "now" = "queue"): void {
  const value = url.value.trim();
  if (!parseWatchUrl(value)) {
    formProblem.value = props.t("watchErrorBadUrl");
    return;
  }
  if (room.value && mode === "queue") {
    props.client.queue(value);
    queueOpen.value = true;
  } else props.client.start(value);
  startOpen.value = false;
}

const queueOpen = ref(true);
function queueLabel(item: WatchQueueItem): string {
  if (item.media.kind === "youtube") return `YouTube · ${item.media.id}`;
  try {
    const link = new URL(item.media.url);
    const name = decodeURIComponent(link.pathname.split("/").pop() ?? "");
    return /\.[a-z0-9]{2,4}$/i.test(name) ? name : props.t("watchFile");
  } catch {
    return props.t("watchFile");
  }
}

watch(() => props.client.state.error, code => {
  if (!code || code === "RATE_LIMITED") return;
  if (code === "WATCH_BAD_URL") { startOpen.value = true; formProblem.value = errorText(code); return; }
  problem.value = errorText(code);
});

// ---- The player follows the shared state ----

let generation = 0;
async function mount(): Promise<void> {
  const current = room.value;
  const element = host.value;
  const mine = ++generation;
  player.value?.destroy();
  player.value = null;
  // Boxes of earlier players go too (theirs are emptied by destroy()).
  if (host.value) for (const old of [...host.value.children]) old.remove();
  blocked.value = false;
  problem.value = "";
  signInHint.value = false;
  blockedTimes = 0;
  stalledTicks = 0;
  if (!current || !props.client.state.watching || !element) return;
  // Each player gets its own box, so a late, retired one cannot clear its successor's.
  const slot = document.createElement("div");
  slot.className = "wt-slot";
  element.append(slot);
  try {
    const created = await createMediaPlayer(slot, current.media, props.client.expectedPosition(), {
      onMeta: (title, duration) => props.client.meta(title, duration),
      // Refused again after a click: not autoplay but YouTube wanting a sign-in.
      onBlocked: () => { blocked.value = true; if (++blockedTimes > 1) signInHint.value = true; },
      onError: code => { problem.value = errorText(code); },
      onEnded: () => props.client.ended(current.id),
    });
    if (mine !== generation) { created.destroy(); slot.remove(); return; }
    created.setVolume(volume.value, muted.value);
    player.value = created;
    sync(true);
  } catch (error: unknown) {
    slot.remove();
    if (mine === generation) problem.value = errorText(error instanceof Error ? error.message : "WATCH_YOUTUBE_UNAVAILABLE");
  }
}

watch(() => [room.value?.id, props.client.state.watching] as const, async () => {
  await nextTick();
  void mount();
}, { flush: "post" });

/** Plays or pauses and jumps when the picture drifted away from the shared clock. */
function sync(tight = false): void {
  const current = room.value;
  const media = player.value;
  if (!current || !media || blocked.value) return;
  const expected = props.client.expectedPosition();
  const drift = Math.abs(media.currentTime() - expected);
  if (current.playing) {
    if (!media.buffering() && drift > (tight ? 0.8 : 2)) media.seek(expected);
    if (!media.playing()) media.play();
  } else {
    if (media.playing()) media.pause();
    if (drift > 0.4) media.seek(expected);
  }
}
watch(() => props.client.state.revision, () => sync(true));

const ticker = setInterval(() => {
  if (!room.value || !props.client.state.watching) return;
  shown.value = scrub.value ?? (player.value?.currentTime() || props.client.expectedPosition());
}, 250);
const syncer = setInterval(() => {
  if (!props.client.state.watching) return;
  sync();
  // A YouTube video that should play but has not started for about 8 s.
  const media = player.value;
  if (room.value?.playing && room.value.media.kind === "youtube" && media && !media.playing()) {
    if (++stalledTicks >= 4) signInHint.value = true;
  } else stalledTicks = 0;
}, 2000);

const YOUTUBE_SIGN_IN = "https://accounts.google.com/ServiceLogin?service=youtube&continue=https%3A%2F%2Fwww.youtube.com%2F";
/**
 * Signs in to YouTube: the desktop app opens its own sign-in window (sharing its
 * cookies) and tells the page when it is done; a browser opens a tab, and the
 * player is rebuilt when the page gets the focus back.
 */
function signIn(): void {
  signInHint.value = false;
  const opened = window.open(YOUTUBE_SIGN_IN, "_blank");
  if ((window as { webspeakDesktop?: unknown }).webspeakDesktop) return;
  if (opened === null && !document.hasFocus()) return;
  window.addEventListener("focus", () => setTimeout(() => void mount(), 300), { once: true });
}
function onSignedIn(): void { void mount(); }
window.addEventListener("webspeak:youtube-signed-in", onSignedIn);

function unblock(): void {
  blocked.value = false;
  player.value?.play();
  setTimeout(() => sync(true), 300);
}

// ---- What this person does ----

function position(): number {
  return player.value?.currentTime() ?? props.client.expectedPosition();
}
function togglePlay(): void {
  if (!room.value) return;
  if (blocked.value) { unblock(); return; }
  props.client.control(room.value.playing ? "pause" : "play", position());
}
function seekTo(seconds: number): void {
  scrub.value = null;
  props.client.control("seek", Math.max(0, length.value ? Math.min(seconds, length.value - 1) : seconds));
}
function skip(seconds: number): void {
  seekTo(position() + seconds);
}
function setVolume(value: number): void {
  volume.value = value;
  if (value > 0) muted.value = false;
  write(VOLUME_KEY, String(value));
  player.value?.setVolume(volume.value, muted.value);
}
function setMuted(value: boolean): void {
  muted.value = value;
  player.value?.setVolume(volume.value, muted.value);
}
let stopTimer: ReturnType<typeof setTimeout> | undefined;
function stopForAll(): void {
  if (!stopArmed.value) {
    stopArmed.value = true;
    clearTimeout(stopTimer);
    stopTimer = setTimeout(() => { stopArmed.value = false; }, 4000);
    return;
  }
  stopArmed.value = false;
  props.client.stop();
}

// Who did what, for a moment over the picture.
let toastTimer: ReturnType<typeof setTimeout> | undefined;
watch(() => room.value && `${room.value.id}|${room.value.last.at}|${room.value.last.action}`, (value, before) => {
  const current = room.value;
  if (!value || !before || !current || current.last.by === props.selfName) return;
  const name = current.last.by;
  const action = current.last.action;
  toast.value = action === "pause" ? props.t("watchDidPause", { name }) : action === "play" ? props.t("watchDidPlay", { name })
    : action === "seek" ? props.t("watchDidSeek", { name, time: clock(current.position) }) : props.t("watchDidStart", { name });
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.value = ""; }, 3000);
});

// Someone else adding to the queue gets a short line too.
watch(() => room.value?.queue.length ?? 0, (count, before) => {
  const current = room.value;
  const added = current?.queue[count - 1];
  if (!current || count <= before || !added || added.addedBy === props.selfName) return;
  toast.value = props.t("watchDidQueue", { name: added.addedBy });
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.value = ""; }, 3000);
});

function clock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor(total / 60) % 60;
  const s = String(total % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

// ---- The window ----

function toggleSize(): void {
  size.value = size.value === "large" ? "small" : "large";
  write(SIZE_KEY, size.value);
  nextTick(clampPlaced);
}
async function toggleFullscreen(): Promise<void> {
  const element = windowEl.value;
  if (!element) return;
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await element.requestFullscreen();
  } catch { /* the browser refused; the window stays as it is */ }
}
function onFullscreen(): void {
  fullscreen.value = Boolean(document.fullscreenElement && document.fullscreenElement === windowEl.value);
}
document.addEventListener("fullscreenchange", onFullscreen);

let drag: { id: number; dx: number; dy: number } | null = null;
function dragStart(event: PointerEvent): void {
  if (fullscreen.value || event.button !== 0 || (event.target as HTMLElement).closest("button")) return;
  const box = windowEl.value?.getBoundingClientRect();
  if (!box) return;
  drag = { id: event.pointerId, dx: event.clientX - box.left, dy: event.clientY - box.top };
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  window.addEventListener("pointermove", dragMove);
  window.addEventListener("pointerup", dragEnd, { once: true });
}
function dragMove(event: PointerEvent): void {
  if (!drag || event.pointerId !== drag.id) return;
  placed.value = { left: event.clientX - drag.dx, top: event.clientY - drag.dy };
  clampPlaced();
}
function dragEnd(): void {
  drag = null;
  window.removeEventListener("pointermove", dragMove);
}
function clampPlaced(): void {
  const box = windowEl.value?.getBoundingClientRect();
  if (!placed.value || !box) return;
  placed.value = {
    left: Math.max(0, Math.min(window.innerWidth - box.width, placed.value.left)),
    top: Math.max(0, Math.min(window.innerHeight - box.height, placed.value.top)),
  };
}
window.addEventListener("resize", clampPlaced);

onBeforeUnmount(() => {
  window.removeEventListener("webspeak:youtube-signed-in", onSignedIn);
  generation++;
  player.value?.destroy();
  clearInterval(ticker);
  clearInterval(syncer);
  clearTimeout(stopTimer);
  clearTimeout(toastTimer);
  document.removeEventListener("fullscreenchange", onFullscreen);
  window.removeEventListener("resize", clampPlaced);
  window.removeEventListener("pointermove", dragMove);
});
</script>

<style scoped>
.wt-window, .wt-offer, .wt-dialog {
  --wt-bg: #111317;
  --wt-raised: #1c1f25;
  --wt-line: #2c3038;
  --wt-text: #eceae6;
  --wt-muted: #a3a6ad;
  --wt-accent: #e2504c;
  color: var(--wt-text);
  font-family: Inter, system-ui, sans-serif;
  font-size: 13px;
}
.wt-btn { display: inline-flex; align-items: center; justify-content: center; min-height: 32px; padding: 0 12px; border-radius: 9px; border: 1px solid var(--wt-line); background: var(--wt-raised); color: var(--wt-text); font: inherit; font-weight: 600; cursor: pointer; white-space: nowrap; }
.wt-btn:hover { border-color: #444a55; }
.wt-btn-accent { border-color: var(--wt-accent); background: var(--wt-accent); color: #fff; }
.wt-btn:disabled { opacity: .5; cursor: default; }
.wt-icon-btn { display: grid; place-items: center; flex: 0 0 auto; width: 30px; height: 30px; padding: 0; border: 0; border-radius: 8px; background: transparent; color: var(--wt-muted); font: inherit; font-size: 15px; cursor: pointer; }
.wt-icon-btn svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
.wt-icon-btn:hover, .wt-icon-btn:focus-visible { color: var(--wt-text); background: var(--wt-raised); outline: none; }

.wt-offer { position: fixed; right: 20px; top: 84px; z-index: 58; display: flex; align-items: center; gap: 10px; max-width: min(460px, calc(100vw - 24px)); padding: 8px 8px 8px 12px; border-radius: 14px; border: 1px solid var(--wt-line); background: var(--wt-bg); box-shadow: 0 18px 44px rgba(0, 0, 0, .45); animation: wt-in .2s ease-out; }
.wt-offer-icon { display: grid; place-items: center; flex: 0 0 32px; height: 32px; border-radius: 50%; background: var(--wt-accent); color: #fff; font-size: 13px; }
.wt-offer-text { display: grid; min-width: 0; flex: 1 1 auto; }
.wt-offer-text strong, .wt-title strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wt-offer-text small, .wt-title small { overflow: hidden; color: var(--wt-muted); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }

/* Top centre by default: over the voice stage, clear of side panels such as KAAK's chat. */
.wt-window { position: fixed; left: 50%; top: 84px; translate: -50% 0; z-index: 58; display: flex; flex-direction: column; width: min(440px, calc(100vw - 24px)); border-radius: 14px; border: 1px solid var(--wt-line); background: var(--wt-bg); box-shadow: 0 24px 60px rgba(0, 0, 0, .5); overflow: hidden; animation: wt-in .2s ease-out; }
.wt-large { width: min(820px, calc(100vw - 24px)); }
.wt-dragged { translate: none; }
.wt-full { inset: 0; translate: none; width: 100%; height: 100%; border-radius: 0; border: 0; }
.wt-head { display: flex; align-items: center; gap: 2px; padding: 6px 6px 6px 12px; border-bottom: 1px solid var(--wt-line); cursor: grab; touch-action: none; user-select: none; }
.wt-full .wt-head { cursor: default; }
.wt-title { display: grid; flex: 1 1 auto; min-width: 0; margin-right: 6px; }
.wt-stage { position: relative; aspect-ratio: 16 / 9; background: #000; }
.wt-full .wt-stage { flex: 1 1 auto; aspect-ratio: auto; min-height: 0; }
.wt-host, .wt-host :deep(.wt-slot), .wt-host :deep(iframe), .wt-host :deep(video) { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; background: #000; }
.wt-veil { position: absolute; inset: 0; z-index: 1; padding: 0; border: 0; background: transparent; cursor: pointer; }
.wt-blocked { position: absolute; inset: 0; z-index: 2; display: grid; place-items: center; padding: 16px; border: 0; background: rgba(0, 0, 0, .6); color: #fff; font: inherit; font-size: 15px; font-weight: 600; cursor: pointer; }
.wt-toast, .wt-problem { position: absolute; left: 10px; z-index: 3; max-width: calc(100% - 20px); margin: 0; padding: 6px 10px; border-radius: 8px; background: rgba(0, 0, 0, .72); pointer-events: none; }
.wt-toast { top: 10px; }
.wt-problem { bottom: 10px; color: #ffb4b0; }
.wt-signin { position: absolute; left: 10px; right: 10px; bottom: 10px; z-index: 4; display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 10px; background: rgba(0, 0, 0, .82); color: #fff; font-size: 13px; }
.wt-signin span { flex: 1; min-width: 0; }
.wt-controls { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 6px; padding: 6px 8px; }
.wt-play { color: var(--wt-text); }
.wt-time { flex: 0 0 auto; color: var(--wt-muted); font-size: 12px; font-variant-numeric: tabular-nums; }
.wt-seek { flex: 1 1 120px; min-width: 80px; accent-color: var(--wt-accent); }
/* In the small window the seek bar gets its own row above the buttons. */
.wt-small:not(.wt-full) .wt-seek { order: -1; flex-basis: 100%; margin: 2px 4px 0; }
.wt-small:not(.wt-full) .wt-volume { width: 64px; flex-basis: 64px; }
.wt-volume { flex: 0 1 80px; width: 80px; accent-color: var(--wt-accent); }
.wt-stop { min-height: 28px; margin-left: auto; padding: 0 10px; font-size: 12px; font-weight: 500; color: var(--wt-muted); }
.wt-armed { border-color: var(--wt-accent); color: #ffb4b0; }

.wt-queue { border-top: 1px solid var(--wt-line); }
.wt-queue-toggle { display: flex; align-items: center; justify-content: space-between; width: 100%; padding: 6px 12px; border: 0; background: transparent; color: var(--wt-muted); font: inherit; font-size: 12px; font-weight: 600; cursor: pointer; }
.wt-queue-toggle svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2; transition: transform .15s; }
.wt-queue-toggle .wt-flip { transform: rotate(180deg); }
.wt-queue-list { display: grid; gap: 2px; max-height: 190px; margin: 0; padding: 0 6px 6px; overflow-y: auto; list-style: none; }
.wt-queue-item { display: flex; align-items: center; gap: 8px; padding: 4px 4px 4px 6px; border-radius: 8px; }
.wt-queue-item:hover { background: var(--wt-raised); }
.wt-queue-item b { flex: 0 0 14px; color: var(--wt-muted); font-size: 11px; text-align: right; }
.wt-thumb { flex: 0 0 64px; width: 64px; height: 36px; border-radius: 5px; object-fit: cover; background: #000; }
.wt-thumb-file { display: grid; place-items: center; font-size: 16px; }
.wt-queue-text { display: grid; flex: 1 1 auto; min-width: 0; }
.wt-queue-text strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
.wt-queue-text small { color: var(--wt-muted); font-size: 11px; }
.wt-dialog-backdrop { position: fixed; inset: 0; z-index: 70; display: grid; place-items: center; padding: 16px; background: rgba(5, 6, 8, .6); }
.wt-dialog { display: grid; gap: 12px; width: min(520px, 100%); padding: 20px; border-radius: 16px; border: 1px solid var(--wt-line); background: var(--wt-bg); box-shadow: 0 30px 80px rgba(0, 0, 0, .55); }
.wt-dialog h2 { margin: 0; font-size: 18px; }
.wt-dialog label { display: grid; gap: 6px; color: var(--wt-muted); font-size: 12px; }
.wt-dialog input { min-height: 40px; padding: 0 12px; border-radius: 10px; border: 1px solid var(--wt-line); background: var(--wt-raised); color: var(--wt-text); font: inherit; font-size: 14px; }
.wt-dialog input:focus { outline: 2px solid var(--wt-accent); outline-offset: -1px; }
.wt-hint { margin: 0; color: var(--wt-muted); line-height: 1.45; }
.wt-form-problem { margin: 0; color: #ffb4b0; }
.wt-dialog-actions { display: flex; justify-content: flex-end; gap: 8px; }

@keyframes wt-in { from { opacity: 0; transform: translateY(8px); } }
@media (prefers-reduced-motion: reduce) { .wt-window, .wt-offer { animation: none; } }
@media (max-width: 740px) {
  /* Phones keep their controls at the bottom, so the video sits at the top. */
  .wt-window:not(.wt-full), .wt-offer { right: 8px; left: 8px; top: calc(56px + env(safe-area-inset-top)); width: auto; max-width: none; translate: none; }
  .wt-dragged:not(.wt-full) { left: 8px !important; top: calc(56px + env(safe-area-inset-top)) !important; }
  .wt-volume { display: none; }
}
</style>
