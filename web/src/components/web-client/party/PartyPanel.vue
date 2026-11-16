<template>
  <section
    v-if="opened"
    ref="windowEl"
    :class="['pg-window', `pg-${size}`, { 'pg-dragged': placed }]"
    :style="placed ? { left: `${placed.left}px`, top: `${placed.top}px` } : undefined"
    data-ws-part="voice.party"
    role="dialog"
    :aria-label="pt('title')"
  >
    <header class="pg-head" @pointerdown="dragStart">
      <div class="pg-tabs" role="tablist">
        <button type="button" role="tab" :aria-selected="tab === 'chess'" :class="{ 'pg-tab-on': tab === 'chess' }" data-ws-part="voice.party.tab-chess" @click="setTab('chess')">
          ♟ {{ pt("tabChess") }}<span v-if="chessLive" class="pg-live" aria-hidden="true" />
        </button>
        <button type="button" role="tab" :aria-selected="tab === 'mafia'" :class="{ 'pg-tab-on': tab === 'mafia' }" data-ws-part="voice.party.tab-mafia" @click="setTab('mafia')">
          🎭 {{ pt("tabMafia") }}<span v-if="mafiaLive" class="pg-live" aria-hidden="true" />
        </button>
      </div>
      <button v-if="tab === 'chess'" type="button" class="pg-icon-btn" :aria-label="size === 'large' ? pt('minimize') : pt('expand')" :title="size === 'large' ? pt('minimize') : pt('expand')" @click="toggleSize">
        <svg viewBox="0 0 24 24" aria-hidden="true"><template v-if="size === 'large'"><path d="M9 4v5H4M15 20v-5h5"/></template><template v-else><path d="M4 9V4h5M20 15v5h-5"/></template></svg>
      </button>
      <button type="button" class="pg-icon-btn" :aria-label="pt('close')" :title="pt('close')" data-ws-part="voice.party.close" @click="close"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button>
    </header>
    <div class="pg-body">
      <ChessView v-if="tab === 'chess'" :client="chess" :t="pt" :thinking="botThinking" />
      <MafiaView v-else :client="mafia" :t="pt" :language="language" />
      <p v-if="errorText" class="pg-error" role="alert">{{ errorText }}</p>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import type { ChessClient, MafiaClient } from "../../../party/party-client.js";
import { partyError, partyText } from "../../../party/party-text.js";
import { ChessEngine } from "../../../party/chess-engine.js";
import { playChessSound, soundForSan } from "../../../party/chess-sounds.js";
import { findMove, gameEnd, legalMoves, parseFen, squareIndex, type ChessColor } from "../../../../../src/shared/chess.js";
import ChessView from "./ChessView.vue";
import MafiaView from "./MafiaView.vue";

const props = defineProps<{ chess: ChessClient; mafia: MafiaClient; language: string }>();

type Tab = "chess" | "mafia";
const TAB_KEY = "webspeak:party-tab";
const SIZE_KEY = "webspeak:party-size";
const read = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
const write = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* per-browser convenience only */ } };

const pt = computed(() => partyText(props.language));
const opened = ref(false);
const tab = ref<Tab>(read(TAB_KEY) === "mafia" ? "mafia" : "chess");
const size = ref<"small" | "large">(read(SIZE_KEY) === "large" ? "large" : "small");
const placed = ref<{ left: number; top: number } | null>(null);
const windowEl = ref<HTMLElement | null>(null);

const chessLive = computed(() => props.chess.state.room?.phase === "playing");
const mafiaLive = computed(() => {
  const room = props.mafia.state.room;
  return !!room && (room.phase === "night" || room.phase === "day" || room.phase === "vote" || (room.phase === "lobby" && room.players.length > 0));
});
/** Something is going on in the channel: the entry button shows it. */
const live = computed(() => chessLive.value || mafiaLive.value);

const errorText = ref("");
let errorTimer: ReturnType<typeof setTimeout> | undefined;
function showError(code: string): void {
  if (!code) return;
  errorText.value = partyError(pt.value, code);
  clearTimeout(errorTimer);
  errorTimer = setTimeout(() => { errorText.value = ""; }, 4000);
}
watch(() => props.chess.state.errorAt, () => { if (tab.value === "chess") showError(props.chess.state.error); });
watch(() => props.mafia.state.errorAt, () => { if (tab.value === "mafia") showError(props.mafia.state.error); });

function setTab(value: Tab): void {
  tab.value = value;
  errorText.value = "";
  write(TAB_KEY, value);
}
/** Opens the window, on a given game or the last one used. */
function open(which?: Tab): void {
  if (which) setTab(which);
  opened.value = true;
}
function close(): void {
  opened.value = false;
}
defineExpose({ open, close, live });

// A game you play in brings the window up when it starts.
watch(() => [props.mafia.state.room?.id, props.mafia.state.room?.phase] as const, ([, phase], [, before]) => {
  if (before === "lobby" && phase === "night" && props.mafia.state.room?.you) open("mafia");
});
watch(() => [props.chess.state.room?.id, props.chess.state.room?.phase] as const, ([, phase], [, before]) => {
  if (before !== "playing" && phase === "playing" && props.chess.state.room?.you) open("chess");
});

// Board sounds for players and for whoever has the board open.
watch(() => [props.chess.state.room?.id, props.chess.state.room?.moves.length, props.chess.state.room?.phase] as const, ([id, length, phase], [beforeId, beforeLength, beforePhase]) => {
  const room = props.chess.state.room;
  if (!room || (!room.you && !(opened.value && tab.value === "chess"))) return;
  if (id === beforeId && (length ?? 0) > (beforeLength ?? 0)) {
    const san = room.moves[room.moves.length - 1]!.san;
    playChessSound(phase === "over" && beforePhase === "playing" ? "end" : soundForSan(san));
  } else if (id === beforeId && phase === "over" && beforePhase === "playing") playChessSound("end");
});

// The computer opponent: this page plays its moves when it owns the seat.
let engine: ChessEngine | null = null;
const botThinking = ref<ChessColor | null>(null);
let thinkingFor = "";
watch(() => [props.chess.state.room?.fen, props.chess.state.room?.phase, props.chess.state.room?.id] as const, async () => {
  const room = props.chess.state.room;
  const position = room ? parseFen(room.fen) : null;
  const seat = room && position ? (position.turn === "w" ? room.white : room.black) : null;
  if (!room || !position || room.phase !== "playing" || !seat?.bot?.mine) {
    botThinking.value = null;
    if (room && !room.white?.bot?.mine && !room.black?.bot?.mine) { engine?.dispose(); engine = null; }
    return;
  }
  const key = `${room.id}|${room.fen}`;
  if (thinkingFor === key || gameEnd(position, [])) return;
  thinkingFor = key;
  botThinking.value = position.turn;
  engine ??= new ChessEngine();
  const started = performance.now();
  let move = await engine.bestMove(room.fen, seat.bot.level).catch(() => null);
  // A legal move whatever happens (an engine that fails to load still lets the game go on).
  if (!move || !findMove(position, squareIndex(move.from), squareIndex(move.to), move.promotion)) {
    const any = legalMoves(position)[0];
    move = any ? { from: "abcdefgh"[any.from & 7]! + ((any.from >> 3) + 1), to: "abcdefgh"[any.to & 7]! + ((any.to >> 3) + 1), ...(any.promotion ? { promotion: any.promotion } : {}) } : null;
  }
  // A beat before answering, so the computer does not look like it moves with you.
  const wait = 450 - (performance.now() - started);
  if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
  const now = props.chess.state.room;
  if (!move || !now || `${now.id}|${now.fen}` !== key || now.phase !== "playing") return;
  botThinking.value = null;
  props.chess.send({ type: "chessMove", id: now.id, from: move.from, to: move.to, ...(move.promotion ? { promotion: move.promotion } : {}) });
}, { immediate: true });

function toggleSize(): void {
  size.value = size.value === "large" ? "small" : "large";
  write(SIZE_KEY, size.value);
  requestAnimationFrame(clampPlaced);
}

let drag: { id: number; dx: number; dy: number } | null = null;
function dragStart(event: PointerEvent): void {
  if (event.button !== 0 || (event.target as HTMLElement).closest("button") || window.innerWidth <= 740) return;
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
    top: Math.max(0, Math.min(window.innerHeight - 48, placed.value.top)),
  };
}
window.addEventListener("resize", clampPlaced);
onBeforeUnmount(() => {
  engine?.dispose();
  clearTimeout(errorTimer);
  window.removeEventListener("resize", clampPlaced);
  window.removeEventListener("pointermove", dragMove);
});
</script>

<style>
.pg-window {
  --pg-bg: #111317;
  --pg-raised: #1c1f25;
  --pg-line: #2c3038;
  --pg-text: #eceae6;
  --pg-muted: #a3a6ad;
  --pg-accent: #e2504c;
  --pg-good: #5fbf7f;
  --pg-light: #ecd9b9;
  --pg-dark: #ae8a68;
  position: fixed; left: 50%; top: 84px; translate: -50% 0; z-index: 57;
  display: flex; flex-direction: column;
  width: min(460px, calc(100vw - 24px)); max-height: calc(100dvh - 100px);
  border-radius: 14px; border: 1px solid var(--pg-line); background: var(--pg-bg); color: var(--pg-text);
  box-shadow: 0 24px 60px rgba(0, 0, 0, .5); overflow: hidden;
  font-family: Inter, system-ui, sans-serif; font-size: 13px;
  animation: pg-in .2s ease-out;
}
.pg-large { width: min(720px, calc(100vw - 24px)); }
.pg-dragged { translate: none; }
.pg-head { display: flex; align-items: center; gap: 2px; padding: 6px; border-bottom: 1px solid var(--pg-line); cursor: grab; touch-action: none; user-select: none; }
.pg-tabs { display: flex; flex: 1 1 auto; gap: 4px; }
.pg-tabs button { position: relative; min-height: 32px; padding: 0 12px; border: 0; border-radius: 9px; background: transparent; color: var(--pg-muted); font: inherit; font-weight: 600; cursor: pointer; }
.pg-tabs button:hover { color: var(--pg-text); }
.pg-tabs .pg-tab-on { background: var(--pg-raised); color: var(--pg-text); }
.pg-live { position: absolute; top: 6px; right: 4px; width: 7px; height: 7px; border-radius: 50%; background: var(--pg-accent); }
.pg-body { position: relative; display: grid; gap: 10px; padding: 12px; overflow-y: auto; overscroll-behavior: contain; }
.pg-btn { display: inline-flex; align-items: center; justify-content: center; min-height: 32px; padding: 0 12px; border-radius: 9px; border: 1px solid var(--pg-line); background: var(--pg-raised); color: var(--pg-text); font: inherit; font-weight: 600; cursor: pointer; white-space: nowrap; }
.pg-btn:hover:not(:disabled) { border-color: #444a55; }
.pg-btn:disabled { opacity: .5; cursor: default; }
.pg-btn-small { min-height: 26px; padding: 0 9px; font-size: 12px; }
.pg-btn-accent { border-color: var(--pg-accent); background: var(--pg-accent); color: #fff; }
.pg-btn-danger { border-color: #ff8a80; color: #ffb4b0; }
.pg-icon-btn { display: grid; place-items: center; flex: 0 0 auto; width: 30px; height: 30px; padding: 0; border: 0; border-radius: 8px; background: transparent; color: var(--pg-muted); cursor: pointer; }
.pg-icon-btn:hover { background: var(--pg-raised); color: var(--pg-text); }
.pg-icon-btn svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
.pg-btn:focus-visible, .pg-icon-btn:focus-visible, .pg-tabs button:focus-visible, .pg-player:focus-visible { outline: 2px solid var(--pg-accent); outline-offset: 2px; }
.pg-note { margin: 0; color: var(--pg-muted); font-size: 12px; }
.pg-note-strong { color: var(--pg-text); font-weight: 600; }
.pg-row, .pg-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.pg-field { display: inline-flex; align-items: center; gap: 6px; color: var(--pg-muted); font-size: 12px; }
.pg-field select, .pg-chat input { min-height: 30px; padding: 0 8px; border-radius: 8px; border: 1px solid var(--pg-line); background: var(--pg-raised); color: var(--pg-text); font: inherit; }
.pg-checkbox { display: inline-flex; align-items: center; gap: 6px; }
.pg-error { position: sticky; bottom: 0; margin: 0; padding: 8px 10px; border-radius: 8px; background: #3a1715; color: #ffb4b0; }
.pg-dot { flex: 0 0 8px; width: 8px; height: 8px; border-radius: 50%; background: transparent; }
.pg-on { background: var(--pg-good); }
.pg-off { background: #5b5f68; }
.pg-clock { flex: 0 0 auto; min-width: 58px; padding: 4px 8px; border-radius: 7px; background: var(--pg-raised); font-size: 15px; font-weight: 700; font-variant-numeric: tabular-nums; text-align: center; }
.pg-clock-run { background: #f2efe9; color: #111; }
.pg-clock-low.pg-clock-run, .pg-clock-low { color: #ffb4b0; }
.pg-clock-low.pg-clock-run { background: #5a1d1a; }

/* Chess */
.pg-chess { display: grid; gap: 8px; }
.pg-seat { display: flex; align-items: center; gap: 8px; min-height: 36px; padding: 2px 4px; border-radius: 9px; }
.pg-seat-turn { background: rgba(255, 255, 255, .05); }
.pg-seat-name { display: grid; flex: 1 1 auto; min-width: 0; }
.pg-seat-name strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pg-seat-name small { color: var(--pg-muted); font-size: 11px; }
.pg-captured { display: flex; flex-wrap: wrap; max-width: 40%; }
.pg-captured img { width: 16px; height: 16px; margin-right: -4px; }
.pg-board-wrap { position: relative; }
.pg-board { position: relative; display: grid; grid-template-columns: repeat(8, 1fr); width: 100%; aspect-ratio: 1; border-radius: 6px; overflow: hidden; touch-action: none; user-select: none; box-shadow: 0 0 0 1px var(--pg-line); }
.pg-sq { position: relative; }
.pg-light { background: var(--pg-light); }
.pg-dark { background: var(--pg-dark); }
.pg-last.pg-light { background: #f3e58c; }
.pg-last.pg-dark { background: #cdb354; }
.pg-sel { box-shadow: inset 0 0 0 3px rgba(20, 85, 30, .75); }
.pg-check { background: radial-gradient(circle, #ff4b3e 0%, #e0302a 35%, rgba(224, 48, 42, 0) 75%) !important; }
.pg-piece { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
.pg-board-active .pg-sq { cursor: pointer; }
.pg-target { position: absolute; left: 50%; top: 50%; width: 28%; height: 28%; translate: -50% -50%; border-radius: 50%; background: rgba(20, 85, 30, .45); pointer-events: none; }
.pg-target-take { position: absolute; inset: 4%; border-radius: 50%; box-shadow: inset 0 0 0 4px rgba(20, 85, 30, .55); pointer-events: none; }
.pg-coord { position: absolute; font-size: 10px; font-weight: 700; line-height: 1; pointer-events: none; }
.pg-light .pg-coord { color: var(--pg-dark); }
.pg-dark .pg-coord { color: var(--pg-light); }
.pg-coord-file { right: 3px; bottom: 2px; }
.pg-coord-rank { left: 3px; top: 3px; }
.pg-ghost { position: absolute; z-index: 3; width: 12.5%; height: 12.5%; translate: -50% -50%; pointer-events: none; filter: drop-shadow(0 6px 8px rgba(0, 0, 0, .4)); }
.pg-promote, .pg-result { position: absolute; inset: 0; z-index: 4; display: grid; place-content: center; justify-items: center; gap: 10px; background: rgba(10, 11, 14, .72); text-align: center; }
.pg-promote > div { display: flex; gap: 6px; }
.pg-promote button:not(.pg-btn) { width: 64px; height: 64px; padding: 4px; border: 1px solid var(--pg-line); border-radius: 10px; background: var(--pg-light); cursor: pointer; }
.pg-promote button img { width: 100%; height: 100%; }
.pg-result { background: rgba(10, 11, 14, .35); pointer-events: none; }
.pg-result-card { display: grid; gap: 4px; padding: 14px 22px; border-radius: 12px; border: 1px solid var(--pg-line); background: rgba(17, 19, 23, .94); box-shadow: 0 12px 30px rgba(0, 0, 0, .45); }
.pg-result strong { font-size: 22px; }
.pg-result small { color: var(--pg-muted); font-size: 13px; }
.pg-status { min-height: 18px; margin: 0; font-weight: 600; }
.pg-board-past { box-shadow: 0 0 0 2px #5a7ab0; }
.pg-replay { display: flex; align-items: center; gap: 2px; }
.pg-replay-text { flex: 1 1 auto; min-width: 0; padding: 0 6px; overflow: hidden; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.pg-replay .pg-btn { margin-right: 4px; }
.pg-icon-btn:disabled { opacity: .35; cursor: default; background: transparent; }
.pg-claim { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 10px; border-radius: 10px; border: 1px solid #5a4a22; background: #2a2414; }
.pg-actions-end { display: flex; margin-left: auto; }
.pg-bot-pick { display: inline-flex; gap: 6px; }
.pg-bot-pick select { min-height: 32px; padding: 0 6px; border-radius: 8px; border: 1px solid var(--pg-line); background: var(--pg-raised); color: var(--pg-text); font: inherit; }
.pg-moves li button { padding: 1px 4px; border: 0; border-radius: 5px; background: transparent; color: var(--pg-text); font: inherit; text-align: left; cursor: pointer; }
.pg-moves li button:hover { background: var(--pg-raised); }
.pg-moves .pg-move-on { background: #33496e; }
.pg-pgn { margin-top: 6px; }
.pg-moves summary, .pg-log summary { color: var(--pg-muted); font-size: 12px; cursor: pointer; }
.pg-moves ol { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 2px 10px; max-height: 108px; margin: 6px 0 0; padding: 0; overflow-y: auto; list-style: none; font-variant-numeric: tabular-nums; }
.pg-moves li { display: grid; grid-template-columns: 28px 1fr 1fr; }
.pg-moves li span:first-child { color: var(--pg-muted); }

/* Mafia */
.pg-mafia { display: grid; gap: 10px; }
.pg-banner { display: flex; align-items: center; gap: 10px; padding: 10px; border-radius: 12px; background: var(--pg-raised); }
.pg-phase-night .pg-banner { background: linear-gradient(135deg, #141a3a, #22163a); }
.pg-phase-day .pg-banner, .pg-phase-vote .pg-banner { background: linear-gradient(135deg, #3a2a10, #3a1f14); }
.pg-banner-icon { font-size: 24px; }
.pg-banner-text { display: grid; flex: 1 1 auto; min-width: 0; }
.pg-banner-text strong { font-size: 15px; }
.pg-banner-text small { color: var(--pg-muted); }
.pg-settings { display: flex; flex-wrap: wrap; gap: 10px 16px; margin: 0; padding: 10px 12px; border: 1px solid var(--pg-line); border-radius: 10px; }
.pg-settings legend { padding: 0 4px; color: var(--pg-muted); font-size: 12px; }
.pg-settings:disabled { opacity: .75; }
.pg-role { display: flex; gap: 12px; align-items: center; padding: 10px 12px; border-radius: 12px; border: 1px solid var(--pg-line); background: var(--pg-raised); }
.pg-role > span:last-child { display: grid; gap: 2px; }
.pg-role small { color: var(--pg-muted); font-size: 11px; }
.pg-role strong { font-size: 16px; }
.pg-role-icon { font-size: 30px; }
.pg-role-hint { color: var(--pg-muted); font-size: 12px; }
.pg-role.pg-role-mafia { border-color: #7a2a27; background: #2a1514; }
.pg-role.pg-role-doctor { border-color: #2a6b47; }
.pg-role.pg-role-detective { border-color: #2a4f7a; }
.pg-prompt { margin: 0; font-size: 14px; font-weight: 700; }
.pg-secret { display: grid; gap: 2px; margin: 0; padding: 8px 10px; border-radius: 10px; background: rgba(255, 255, 255, .04); list-style: none; font-size: 12px; }
.pg-good { color: var(--pg-good); }
.pg-bad { color: #ff8a80; font-weight: 700; }
.pg-players { display: grid; grid-template-columns: repeat(auto-fill, minmax(128px, 1fr)); gap: 8px; }
.pg-player-cell { position: relative; display: grid; }
.pg-player { position: relative; display: grid; gap: 2px; min-height: 54px; padding: 8px 10px; border: 1px solid var(--pg-line); border-radius: 10px; background: var(--pg-raised); color: var(--pg-text); font: inherit; text-align: left; cursor: default; }
.pg-player-top { display: flex; align-items: center; gap: 6px; min-width: 0; }
.pg-player-top strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pg-player small { color: var(--pg-muted); font-size: 11px; }
.pg-player-pickable { cursor: pointer; }
.pg-player-pickable:hover { border-color: #5a606c; }
.pg-player-you { border-color: #4a5060; }
.pg-player-chosen { border-color: var(--pg-accent); box-shadow: 0 0 0 1px var(--pg-accent); }
.pg-player-dead { opacity: .5; }
.pg-player-dead strong { text-decoration: line-through; }
.pg-player:disabled { opacity: 1; }
.pg-player-dead:disabled { opacity: .5; }
.pg-player.pg-role-mafia small { color: #ff8a80; }
.pg-tag { padding: 0 5px; border-radius: 5px; background: rgba(255, 255, 255, .08); color: var(--pg-muted); font-size: 10px; }
.pg-votes { margin-left: auto; min-width: 20px; padding: 1px 6px; border-radius: 10px; background: var(--pg-accent); color: #fff; font-weight: 700; text-align: center; }
.pg-voted { color: var(--pg-muted); font-size: 11px; }
.pg-kick { position: absolute; right: 6px; bottom: 6px; padding: 0 6px; border: 1px solid var(--pg-line); border-radius: 6px; background: var(--pg-bg); color: var(--pg-muted); font: inherit; font-size: 10px; line-height: 18px; cursor: pointer; }
.pg-kick:hover { color: #ffb4b0; border-color: #7a2a27; }
.pg-voice { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 14px; padding: 10px 12px; border-radius: 10px; border: 1px solid var(--pg-line); }
.pg-voice select { max-width: 260px; min-height: 30px; padding: 0 8px; border-radius: 8px; border: 1px solid var(--pg-line); background: var(--pg-raised); color: var(--pg-text); font: inherit; }
.pg-voice input[type="range"] { width: 110px; accent-color: var(--pg-accent); }
.pg-segment { display: inline-flex; justify-self: start; padding: 3px; border-radius: 10px; background: var(--pg-raised); }
.pg-segment button { min-height: 28px; padding: 0 12px; border: 0; border-radius: 8px; background: transparent; color: var(--pg-muted); font: inherit; font-weight: 600; cursor: pointer; }
.pg-segment .pg-segment-on { background: var(--pg-accent); color: #fff; }
.pg-role.pg-role-don { border-color: #7a2a27; background: #2a1514; }
.pg-role.pg-role-maniac { border-color: #6b4a1f; background: #251a10; }
.pg-role.pg-role-mistress { border-color: #7a2a5a; background: #26121f; }
.pg-player.pg-role-don small { color: #ff8a80; }
.pg-chat { display: grid; gap: 6px; padding: 8px 10px; border-radius: 10px; border: 1px solid #5a2422; background: #1d1212; }
.pg-chat-title { color: #ff8a80; font-size: 12px; font-weight: 600; }
.pg-chat ol, .pg-log ol { display: grid; gap: 2px; max-height: 120px; margin: 0; padding: 0; overflow-y: auto; list-style: none; }
.pg-chat input { flex: 1 1 auto; min-width: 0; }
.pg-log ol { margin-top: 6px; font-size: 12px; }
.pg-log-killed, .pg-log-executed, .pg-log-left { color: #ffb4b0; }
.pg-log-win { color: var(--pg-good); font-weight: 700; }
.pg-log-night { color: var(--pg-muted); }

@keyframes pg-in { from { opacity: 0; transform: translateY(8px); } }
@media (prefers-reduced-motion: reduce) { .pg-window { animation: none; } }
@media (max-width: 740px) {
  .pg-window, .pg-large { right: 8px; left: 8px; top: calc(56px + env(safe-area-inset-top)); width: auto; max-height: calc(100dvh - 140px - env(safe-area-inset-top)); translate: none; }
  .pg-dragged { left: 8px !important; top: calc(56px + env(safe-area-inset-top)) !important; }
  .pg-head { cursor: default; }
}
</style>
