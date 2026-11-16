<template>
  <div v-if="room" class="pg-chess" data-ws-part="voice.party.chess">
    <template v-for="side in seatOrder" :key="side.place">
      <!-- A seat: the far one above the board, the near one (yours when seated) below. -->
      <div v-if="side.place === 'board'" class="pg-board-wrap">
        <div
          ref="boardEl"
          class="pg-board"
          :class="{ 'pg-board-active': myTurn, 'pg-board-past': viewing !== null }"
          role="grid"
          :aria-label="t('tabChess')"
          @pointerdown="onPointerDown"
          @pointermove="onPointerMove"
          @pointerup="onPointerUp"
          @pointercancel="cancelDrag"
          @contextmenu.prevent="clearSelection"
        >
          <div
            v-for="cell in cells"
            :key="cell.square"
            class="pg-sq"
            :class="[cell.light ? 'pg-light' : 'pg-dark', {
              'pg-last': lastSquares.has(cell.square),
              'pg-sel': selected === cell.square,
              'pg-check': checkSquare === cell.square,
            }]"
            :data-square="cell.square"
          >
            <img v-if="cell.piece && dragFrom !== cell.square" class="pg-piece" :src="pieceUrl(cell.piece)" :alt="cell.piece" draggable="false" />
            <span v-if="targets.has(cell.square)" :class="cell.piece ? 'pg-target-take' : 'pg-target'" aria-hidden="true" />
            <span v-if="cell.fileLabel" class="pg-coord pg-coord-file">{{ cell.fileLabel }}</span>
            <span v-if="cell.rankLabel" class="pg-coord pg-coord-rank">{{ cell.rankLabel }}</span>
          </div>
          <img v-if="dragPiece && dragPoint" class="pg-ghost" :src="pieceUrl(dragPiece)" alt="" :style="{ left: `${dragPoint.x}px`, top: `${dragPoint.y}px` }" />
          <div v-if="promotion" class="pg-promote" role="dialog" :aria-label="t('promote')">
            <span>{{ t("promote") }}</span>
            <div>
              <button v-for="kind in (['q', 'r', 'b', 'n'] as const)" :key="kind" type="button" @click="finishPromotion(kind)">
                <img :src="pieceUrl(room.you === 'b' ? kind : kind.toUpperCase())" :alt="kind" />
              </button>
            </div>
            <button type="button" class="pg-btn pg-btn-small" @click="promotion = null">{{ t("decline") }}</button>
          </div>
          <div v-if="room.phase === 'over' && room.result && viewing === null" class="pg-result" role="status">
            <div class="pg-result-card">
              <strong>{{ room.result.winner === "w" ? t("winWhite") : room.result.winner === "b" ? t("winBlack") : t("draw") }}</strong>
              <small>{{ t(`reason_${room.result.reason}` as PartyTextKey) }}</small>
            </div>
          </div>
        </div>
      </div>
      <div v-else class="pg-seat" :class="{ 'pg-seat-turn': turnOf(side.color) }">
        <span class="pg-dot" :class="seatOf(side.color) ? (seatOf(side.color)!.online ? 'pg-on' : 'pg-off') : ''" aria-hidden="true" />
        <span class="pg-seat-name">
          <strong>
            <template v-if="seatOf(side.color)?.bot">🤖 {{ t("computer") }}</template>
            <template v-else>{{ seatOf(side.color)?.name ?? t("freeSeat") }}</template>
            <template v-if="room.you === side.color"> ({{ t("you") }})</template>
          </strong>
          <small>
            {{ sideName(side.color) }}
            <template v-if="seatOf(side.color)?.bot"> · {{ t("level", { level: seatOf(side.color)!.bot!.level }) }}<template v-if="thinking === side.color"> · {{ t("thinking") }}</template></template>
            <template v-if="seatOf(side.color) && !seatOf(side.color)!.online"> · {{ t("away") }}<template v-if="room.phase === 'playing'"> {{ formatAway(awayFor(side.color)) }}</template></template>
          </small>
        </span>
        <span class="pg-captured" aria-hidden="true"><img v-for="(piece, index) in captured[side.color === 'w' ? 'b' : 'w']" :key="index" :src="pieceUrl(piece)" alt="" /></span>
        <span v-if="times" class="pg-clock" :class="{ 'pg-clock-run': room.running === side.color, 'pg-clock-low': clockLeft(side.color) < 20_000 }">{{ clockText(side.color) }}</span>
        <button v-if="canSit(side.color)" type="button" class="pg-btn pg-btn-small" @click="send({ type: 'chessSit', color: side.color })">{{ t("sit") }}</button>
      </div>
    </template>

    <!-- Looking back through the game. -->
    <div class="pg-replay">
      <button type="button" class="pg-icon-btn" :aria-label="t('first')" :title="t('first')" :disabled="shownPly === 0" @click="go(0)"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5v14M18 6l-7 6 7 6"/></svg></button>
      <button type="button" class="pg-icon-btn" :aria-label="t('previous')" :title="`${t('previous')} (←)`" :disabled="shownPly === 0" @click="go(shownPly - 1)"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 6-6 6 6 6"/></svg></button>
      <span class="pg-replay-text">{{ viewing === null ? status : t("viewingMove", { move: moveLabel(shownPly) }) }}</span>
      <button v-if="viewing !== null" type="button" class="pg-btn pg-btn-small pg-btn-accent" @click="viewing = null">{{ t("backToGame") }}</button>
      <button type="button" class="pg-icon-btn" :aria-label="t('next')" :title="`${t('next')} (→)`" :disabled="viewing === null" @click="go(shownPly + 1)"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg></button>
      <button type="button" class="pg-icon-btn" :aria-label="t('last')" :title="t('last')" :disabled="viewing === null" @click="viewing = null"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 5v14M6 6l7 6-7 6"/></svg></button>
    </div>

    <!-- Someone walked away. -->
    <div v-if="claimable !== null" class="pg-claim" role="status">
      <span>{{ claimable <= 0 ? t("opponentGone") : t("opponentLeft", { time: formatAway(CHESS_ABANDON_MS - claimable) }) }}</span>
      <button type="button" class="pg-btn pg-btn-small pg-btn-accent" :disabled="claimable > 0" @click="send({ type: 'chessClaim', id: room.id })">{{ claimable > 0 ? t("claimIn", { seconds: Math.ceil(claimable / 1000) }) : t("claimWin") }}</button>
    </div>
    <p v-if="abandoned" class="pg-note pg-note-strong">{{ t("boardFree") }}</p>

    <div class="pg-actions">
      <template v-if="room.phase !== 'playing'">
        <label v-if="room.you" class="pg-field">
          <span>{{ t("clock") }}</span>
          <select :value="clockValue" @change="setClock(($event.target as HTMLSelectElement).value)">
            <option value="0+0">{{ t("noClock") }}</option>
            <option v-for="option in CLOCK_OPTIONS" :key="option" :value="option">{{ clockLabel(option) }}</option>
          </select>
        </label>
        <span v-else-if="room.clock" class="pg-note">{{ t("clock") }}: {{ clockLabel(`${room.clock.minutes}+${room.clock.increment}`) }}</span>
        <button v-if="room.phase === 'waiting' && room.you && room.white && room.black" type="button" class="pg-btn pg-btn-accent" data-ws-part="voice.party.chess-start" @click="send({ type: 'chessStart' })">{{ t("start") }}</button>
        <button v-if="room.phase === 'over' && room.you" type="button" class="pg-btn pg-btn-accent" :disabled="room.rematch.includes(room.you)" @click="send({ type: 'chessRematch', id: room.id })">{{ t("rematch") }}</button>
        <span v-if="canAddBot" class="pg-bot-pick">
          <select v-model.number="botLevel" :aria-label="t('level', { level: '' })">
            <option v-for="level in CHESS_BOT_LEVELS" :key="level" :value="level">{{ t("level", { level }) }}</option>
          </select>
          <button type="button" class="pg-btn" data-ws-part="voice.party.chess-bot" @click="addBot">🤖 {{ opponentIsMyBot ? t("botChange") : t("playComputer") }}</button>
        </span>
        <button v-if="room.you" type="button" class="pg-btn" @click="send({ type: 'chessStand' })">{{ t("stand") }}</button>
      </template>
      <template v-else-if="room.you">
        <template v-if="room.drawOffer && room.drawOffer !== room.you">
          <span class="pg-note pg-note-strong">{{ t("drawOfferedToYou") }}</span>
          <button type="button" class="pg-btn pg-btn-accent" @click="send({ type: 'chessDraw', id: room.id, action: 'accept' })">{{ t("accept") }}</button>
          <button type="button" class="pg-btn" @click="send({ type: 'chessDraw', id: room.id, action: 'decline' })">{{ t("decline") }}</button>
        </template>
        <button v-else-if="!opponentIsBot" type="button" class="pg-btn" :disabled="room.drawOffer === room.you" @click="send({ type: 'chessDraw', id: room.id, action: 'offer' })">{{ room.drawOffer === room.you ? t("drawOffered") : t("offerDraw") }}</button>
        <button type="button" class="pg-btn" :class="{ 'pg-btn-danger': resignArmed }" @click="resign">{{ resignArmed ? t("resignConfirm") : t("resign") }}</button>
      </template>
      <span class="pg-actions-end">
        <button type="button" class="pg-icon-btn" :aria-pressed="soundOn" :aria-label="t('sounds')" :title="t('sounds')" @click="toggleSound">
          <svg v-if="soundOn" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z"/><path d="M15.5 9a4 4 0 0 1 0 6"/></svg>
          <svg v-else viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z"/><path d="m16 10 4 4M20 10l-4 4"/></svg>
        </button>
        <button type="button" class="pg-icon-btn" :aria-label="t('flip')" :title="t('flip')" @click="flipped = !flipped"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4v14M4 15l3 3 3-3M17 20V6M14 9l3-3 3 3"/></svg></button>
      </span>
    </div>
    <p v-if="room.phase === 'over' && room.you && room.rematch.length && !opponentIsBot" class="pg-note">{{ room.rematch.includes(room.you) ? t("rematchAsked") : t("rematchOffered") }}</p>

    <details class="pg-moves" :open="moveRows.length > 0">
      <summary>{{ t("moves") }}</summary>
      <ol v-if="moveRows.length" ref="movesEl">
        <li v-for="row in moveRows" :key="row.number">
          <span>{{ row.number }}.</span>
          <button type="button" :class="{ 'pg-move-on': shownPly === row.number * 2 - 1 }" @click="go(row.number * 2 - 1)">{{ row.white }}</button>
          <button v-if="row.black" type="button" :class="{ 'pg-move-on': shownPly === row.number * 2 }" @click="go(row.number * 2)">{{ row.black }}</button>
        </li>
      </ol>
      <p v-else class="pg-note">{{ t("noMoves") }}</p>
      <div v-if="moveRows.length" class="pg-row pg-pgn">
        <button type="button" class="pg-btn pg-btn-small" @click="copyPgn">{{ copied ? t("copied") : t("copyPgn") }}</button>
        <button type="button" class="pg-btn pg-btn-small" @click="downloadPgn">{{ t("downloadPgn") }}</button>
      </div>
    </details>
    <p v-if="room.spectators.length" class="pg-note">{{ t("spectators", { names: room.spectators.join(", ") }) }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { applyMove, capturedPieces, colorOf, findMove, inCheck, legalMoves, parseFen, squareIndex, type ChessColor, type ChessMove, type ChessPosition, type Promotion } from "../../../../../src/shared/chess.js";
import { CHESS_ABANDON_MS, CHESS_BOT_LEVELS, type ChessClientMessage, type ChessRoomView, type ChessSeatView } from "../../../../../src/shared/chess-room.js";
import type { ChessClient } from "../../../party/party-client.js";
import { replay, toPgn } from "../../../party/chess-pgn.js";
import { chessSoundOn, setChessSoundOn } from "../../../party/chess-sounds.js";
import type { PartyTextKey, PartyTranslate } from "../../../party/party-text.js";

const props = defineProps<{ client: ChessClient; t: PartyTranslate; thinking?: ChessColor | null }>();
const t = props.t;
const CLOCK_OPTIONS = ["1+0", "3+0", "3+2", "5+0", "5+3", "10+0", "10+5", "15+10", "30+0"];
const BOT_LEVEL_KEY = "webspeak:chess-bot-level";

const room = computed<ChessRoomView | null>(() => props.client.state.room);
const flipped = ref(false);
const selected = ref<number | null>(null);
const pending = ref<{ id: string; move: ChessMove } | null>(null);
const promotion = ref<{ from: number; to: number } | null>(null);
const resignArmed = ref(false);
const boardEl = ref<HTMLElement[] | HTMLElement | null>(null);
const movesEl = ref<HTMLElement | null>(null);
const now = ref(performance.now());
const ticker = setInterval(() => { now.value = performance.now(); }, 200);
let resignTimer: ReturnType<typeof setTimeout> | undefined;
const board = () => (Array.isArray(boardEl.value) ? boardEl.value[0] : boardEl.value) ?? null;

/** null: the live game; a number: looking at the position after that many moves. */
const viewing = ref<number | null>(null);
const history = computed(() => replay(room.value?.moves ?? []));
const shownPly = computed(() => viewing.value ?? (room.value?.moves.length ?? 0));
function go(ply: number): void {
  const total = room.value?.moves.length ?? 0;
  const target = Math.max(0, Math.min(total, ply));
  viewing.value = target >= total ? null : target;
  selected.value = null;
}
const moveLabel = (ply: number) => (ply === 0 ? t("startPosition") : `${Math.ceil(ply / 2)}${ply % 2 ? "." : "…"} ${room.value?.moves[ply - 1]?.san ?? ""}`);
function onKey(event: KeyboardEvent): void {
  const target = event.target as HTMLElement | null;
  if (target?.closest("input, textarea, select, [contenteditable]") || !board()?.isConnected) return;
  if (event.key === "ArrowLeft") { go(shownPly.value - 1); event.preventDefault(); }
  if (event.key === "ArrowRight") { go(shownPly.value + 1); event.preventDefault(); }
}
window.addEventListener("keydown", onKey);

/** The server's position, with this player's own move shown at once while it travels. */
const serverPosition = computed<ChessPosition | null>(() => room.value ? parseFen(room.value.fen) : null);
const livePosition = computed<ChessPosition | null>(() => {
  const base = serverPosition.value;
  if (!base) return null;
  return pending.value && pending.value.id === room.value?.id ? applyMove(base, pending.value.move) : base;
});
const position = computed<ChessPosition | null>(() => (viewing.value === null ? livePosition.value : history.value[viewing.value] ?? livePosition.value));
watch(() => [room.value?.fen, room.value?.id, props.client.state.errorAt], () => { pending.value = null; });
watch(() => room.value?.id, () => { viewing.value = null; });
// A new game turns the board to your side.
watch(() => [room.value?.id, room.value?.you], () => { flipped.value = room.value?.you === "b"; selected.value = null; promotion.value = null; }, { immediate: true });

const seatOrder = computed(() => {
  const top: ChessColor = flipped.value ? "w" : "b";
  const bottom: ChessColor = flipped.value ? "b" : "w";
  return [{ place: "top", color: top }, { place: "board", color: top }, { place: "bottom", color: bottom }] as const;
});
const myTurn = computed(() => viewing.value === null && room.value?.phase === "playing" && !pending.value && room.value.you !== null && position.value?.turn === room.value.you);
const legal = computed<ChessMove[]>(() => (myTurn.value && position.value ? legalMoves(position.value) : []));
const targets = computed(() => new Set(selected.value === null ? [] : legal.value.filter(move => move.from === selected.value).map(move => move.to)));
const lastSquares = computed(() => {
  if (viewing.value === null && pending.value) return new Set([pending.value.move.from, pending.value.move.to]);
  const last = room.value?.moves[shownPly.value - 1];
  return new Set(last ? [squareIndex(last.from), squareIndex(last.to)] : []);
});
const checkSquare = computed(() => {
  const value = position.value;
  if (!value || !inCheck(value)) return -1;
  return value.board.indexOf(value.turn === "w" ? "K" : "k");
});
const captured = computed(() => (position.value ? capturedPieces(position.value) : { w: [], b: [] }));

const cells = computed(() => {
  const value = position.value;
  const result: Array<{ square: number; piece: string; light: boolean; fileLabel: string; rankLabel: string }> = [];
  for (let row = 0; row < 8; row++) {
    for (let column = 0; column < 8; column++) {
      const rank = flipped.value ? row : 7 - row;
      const file = flipped.value ? 7 - column : column;
      const square = rank * 8 + file;
      result.push({
        square, piece: value?.board[square] ?? "", light: (rank + file) % 2 === 1,
        fileLabel: row === 7 ? "abcdefgh"[file]! : "", rankLabel: column === 0 ? String(rank + 1) : "",
      });
    }
  }
  return result;
});

const moveRows = computed(() => {
  const moves = room.value?.moves ?? [];
  const rows: Array<{ number: number; white: string; black: string }> = [];
  for (let i = 0; i < moves.length; i += 2) rows.push({ number: i / 2 + 1, white: moves[i]!.san, black: moves[i + 1]?.san ?? "" });
  return rows;
});
watch(() => room.value?.moves.length, async () => { await nextTick(); movesEl.value?.scrollTo({ top: movesEl.value.scrollHeight }); });

const times = computed(() => room.value?.times ?? null);
function clockLeft(color: ChessColor): number {
  const value = room.value;
  if (!value?.times) return 0;
  const left = value.times[color] - (value.running === color ? now.value - props.client.state.receivedAt : 0);
  return Math.max(0, left);
}
function clockText(color: ChessColor): string {
  const ms = clockLeft(color);
  const total = Math.ceil(ms / 1000);
  if (ms < 10_000 && room.value?.running === color) return `${Math.floor(ms / 1000)}.${Math.floor((ms % 1000) / 100)}`;
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
const clockValue = computed(() => (room.value?.clock ? `${room.value.clock.minutes}+${room.value.clock.increment}` : "0+0"));
const clockLabel = (value: string) => {
  const [minutes, increment] = value.split("+").map(Number);
  return increment ? `${t("minutes", { minutes: minutes! })} ${t("plus", { seconds: increment })}` : t("minutes", { minutes: minutes! });
};
function setClock(value: string): void {
  const [minutes, increment] = value.split("+").map(Number);
  send({ type: "chessClock", minutes: minutes!, increment: increment! });
}

const seatOf = (color: ChessColor): ChessSeatView | null => (color === "w" ? room.value?.white : room.value?.black) ?? null;
const sideName = (color: ChessColor) => (color === "w" ? t("white") : t("black"));
const turnOf = (color: ChessColor) => room.value?.phase === "playing" && livePosition.value?.turn === color;
/** How long a seat's player has been away, counting on from the latest view. */
function awayFor(color: ChessColor): number {
  const away = seatOf(color)?.away;
  return away === null || away === undefined ? 0 : away + (now.value - props.client.state.receivedAt);
}
const formatAway = (ms: number) => {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};
/** Both players of a running game have left: the board is free for whoever is here. */
const abandoned = computed(() => room.value?.phase === "playing" && !room.value.you && !!room.value.white && !room.value.black?.online && !room.value.white.online);
function canSit(color: ChessColor): boolean {
  const value = room.value;
  if (!value || value.you === color) return false;
  if (value.phase === "playing") return abandoned.value;
  const seat = seatOf(color);
  return !seat || !seat.online;
}
/** Milliseconds left before you may claim the game against a player who left; null when nobody left. */
const claimable = computed(() => {
  const value = room.value;
  if (!value || value.phase !== "playing" || !value.you) return null;
  const opponent = value.you === "w" ? "b" : "w";
  const seat = seatOf(opponent);
  if (!seat || seat.online) return null;
  return Math.max(0, CHESS_ABANDON_MS - awayFor(opponent));
});

const opponentIsBot = computed(() => {
  const value = room.value;
  return !!value?.you && !!seatOf(value.you === "w" ? "b" : "w")?.bot;
});
const opponentIsMyBot = computed(() => {
  const value = room.value;
  return !!value?.you && !!seatOf(value.you === "w" ? "b" : "w")?.bot?.mine;
});
const canAddBot = computed(() => {
  const value = room.value;
  if (!value?.you) return false;
  const seat = seatOf(value.you === "w" ? "b" : "w");
  return !seat || !seat.online || !!seat.bot?.mine;
});
const storedLevel = (() => { try { return Number(localStorage.getItem(BOT_LEVEL_KEY)); } catch { return 0; } })();
const botLevel = ref((CHESS_BOT_LEVELS as readonly number[]).includes(storedLevel) ? storedLevel : 3);
function addBot(): void {
  try { localStorage.setItem(BOT_LEVEL_KEY, String(botLevel.value)); } catch { /* per-browser convenience */ }
  send({ type: "chessBot", level: botLevel.value });
}

const status = computed(() => {
  const value = room.value;
  if (!value) return "";
  if (value.phase === "waiting") return value.white && value.black ? t("waitStart") : t("waitOpponent");
  if (value.phase === "over") return t("gameOver");
  const turn = livePosition.value?.turn;
  const check = checkSquare.value >= 0 ? `${t("check")} ` : "";
  if (value.you) return check + (turn === value.you ? t("yourMove") : t("theirMove"));
  return check + t("turnOf", { side: turn === "w" ? t("white") : t("black") });
});

const soundOn = ref(chessSoundOn());
function toggleSound(): void {
  soundOn.value = !soundOn.value;
  setChessSoundOn(soundOn.value);
}

const copied = ref(false);
async function copyPgn(): Promise<void> {
  if (!room.value) return;
  try {
    await navigator.clipboard.writeText(toPgn(room.value));
    copied.value = true;
    setTimeout(() => { copied.value = false; }, 2000);
  } catch {
    downloadPgn();
  }
}
function downloadPgn(): void {
  if (!room.value) return;
  const url = URL.createObjectURL(new Blob([toPgn(room.value)], { type: "application/x-chess-pgn" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `webspeak-${new Date().toISOString().slice(0, 10)}.pgn`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function send(message: ChessClientMessage): void {
  props.client.send(message);
}

function resign(): void {
  const value = room.value;
  if (!value) return;
  if (!resignArmed.value) {
    resignArmed.value = true;
    clearTimeout(resignTimer);
    resignTimer = setTimeout(() => { resignArmed.value = false; }, 3000);
    return;
  }
  resignArmed.value = false;
  send({ type: "chessResign", id: value.id });
}

function tryMove(from: number, to: number): boolean {
  if (!myTurn.value) return false;
  const candidates = legal.value.filter(move => move.from === from && move.to === to);
  if (!candidates.length) return false;
  if (candidates[0]!.promotion) { promotion.value = { from, to }; selected.value = null; return true; }
  commit(candidates[0]!);
  return true;
}
function finishPromotion(kind: Promotion): void {
  const choice = promotion.value;
  promotion.value = null;
  if (!choice || !position.value) return;
  const move = findMove(position.value, choice.from, choice.to, kind);
  if (move) commit(move);
}
function commit(move: ChessMove): void {
  const value = room.value!;
  selected.value = null;
  pending.value = { id: value.id, move };
  const name = (square: number) => `${"abcdefgh"[square & 7]}${(square >> 3) + 1}`;
  send({ type: "chessMove", id: value.id, from: name(move.from), to: name(move.to), ...(move.promotion ? { promotion: move.promotion } : {}) });
}
function clearSelection(): void {
  selected.value = null;
  cancelDrag();
}

// Click to pick and click to drop, or drag the piece.
const dragFrom = ref<number | null>(null);
const dragPiece = ref("");
const dragPoint = ref<{ x: number; y: number } | null>(null);
let dragStart: { x: number; y: number; id: number } | null = null;
let selectedBefore: number | null = null;

function squareAt(event: PointerEvent): number | null {
  const element = board();
  if (!element) return null;
  const box = element.getBoundingClientRect();
  const column = Math.floor(((event.clientX - box.left) / box.width) * 8);
  const row = Math.floor(((event.clientY - box.top) / box.height) * 8);
  if (column < 0 || column > 7 || row < 0 || row > 7) return null;
  const rank = flipped.value ? row : 7 - row;
  const file = flipped.value ? 7 - column : column;
  return rank * 8 + file;
}
function onPointerDown(event: PointerEvent): void {
  if (event.button !== 0 || promotion.value) return;
  // A click on a past position goes back to the game.
  if (viewing.value !== null) { viewing.value = null; return; }
  const square = squareAt(event);
  if (square === null) return;
  const piece = position.value?.board[square] ?? "";
  if (selected.value !== null && targets.value.has(square)) { tryMove(selected.value, square); return; }
  if (myTurn.value && piece && colorOf(piece) === room.value?.you && legal.value.some(move => move.from === square)) {
    selectedBefore = selected.value;
    selected.value = square;
    dragStart = { x: event.clientX, y: event.clientY, id: event.pointerId };
    board()?.setPointerCapture(event.pointerId);
    return;
  }
  selected.value = null;
}
function onPointerMove(event: PointerEvent): void {
  if (!dragStart || event.pointerId !== dragStart.id || selected.value === null) return;
  if (dragFrom.value === null && Math.hypot(event.clientX - dragStart.x, event.clientY - dragStart.y) < 6) return;
  const box = board()!.getBoundingClientRect();
  dragFrom.value = selected.value;
  dragPiece.value = position.value?.board[selected.value] ?? "";
  dragPoint.value = { x: event.clientX - box.left, y: event.clientY - box.top };
}
function onPointerUp(event: PointerEvent): void {
  if (!dragStart || event.pointerId !== dragStart.id) return;
  const from = dragFrom.value;
  const square = squareAt(event);
  dragStart = null;
  if (from !== null) {
    cancelDrag();
    if (square !== null && square !== from && !tryMove(from, square)) selected.value = null;
    return;
  }
  // A click on the piece that was already picked puts it down again.
  if (selectedBefore === square) selected.value = null;
  selectedBefore = null;
}
function cancelDrag(): void {
  dragFrom.value = null;
  dragPiece.value = "";
  dragPoint.value = null;
}

const pieceUrl = (piece: string) => `/chess/cburnett/${colorOf(piece)}${piece.toUpperCase()}.svg`;

onBeforeUnmount(() => { clearInterval(ticker); clearTimeout(resignTimer); window.removeEventListener("keydown", onKey); });
</script>
