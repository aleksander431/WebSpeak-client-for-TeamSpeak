<template>
  <div v-if="room" class="pg-chess" data-ws-part="voice.party.chess">
    <!-- The far seat (the opponent from where you sit). -->
    <div class="pg-seat" :class="{ 'pg-seat-turn': turnOf(top) }">
      <span class="pg-dot" :class="seatOf(top) ? (seatOf(top)!.online ? 'pg-on' : 'pg-off') : ''" aria-hidden="true" />
      <span class="pg-seat-name">
        <strong>{{ seatOf(top)?.name ?? t("freeSeat") }}</strong>
        <small>{{ sideName(top) }}<template v-if="seatOf(top) && !seatOf(top)!.online"> · {{ t("away") }}</template></small>
      </span>
      <span class="pg-captured" aria-hidden="true"><img v-for="(piece, index) in captured[top === 'w' ? 'b' : 'w']" :key="index" :src="pieceUrl(piece)" alt="" /></span>
      <span v-if="times" class="pg-clock" :class="{ 'pg-clock-run': room.running === top, 'pg-clock-low': clockLeft(top) < 20_000 }">{{ clockText(top) }}</span>
      <button v-if="canSit(top)" type="button" class="pg-btn pg-btn-small" @click="send({ type: 'chessSit', color: top })">{{ t("sit") }}</button>
    </div>

    <div class="pg-board-wrap">
      <div
        ref="boardEl"
        class="pg-board"
        :class="{ 'pg-board-active': myTurn }"
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
        <!-- Promotion: which piece the pawn becomes. -->
        <div v-if="promotion" class="pg-promote" role="dialog" :aria-label="t('promote')">
          <span>{{ t("promote") }}</span>
          <div>
            <button v-for="kind in (['q', 'r', 'b', 'n'] as const)" :key="kind" type="button" @click="finishPromotion(kind)">
              <img :src="pieceUrl(room.you === 'b' ? kind : kind.toUpperCase())" :alt="kind" />
            </button>
          </div>
          <button type="button" class="pg-btn pg-btn-small" @click="promotion = null">{{ t("decline") }}</button>
        </div>
        <!-- The end of the game. -->
        <div v-if="room.phase === 'over' && room.result" class="pg-result" role="status">
          <div class="pg-result-card">
            <strong>{{ room.result.winner === "w" ? t("winWhite") : room.result.winner === "b" ? t("winBlack") : t("draw") }}</strong>
            <small>{{ t(`reason_${room.result.reason}` as PartyTextKey) }}</small>
          </div>
        </div>
      </div>
    </div>

    <!-- The near seat (yours when seated). -->
    <div class="pg-seat" :class="{ 'pg-seat-turn': turnOf(bottom) }">
      <span class="pg-dot" :class="seatOf(bottom) ? (seatOf(bottom)!.online ? 'pg-on' : 'pg-off') : ''" aria-hidden="true" />
      <span class="pg-seat-name">
        <strong>{{ seatOf(bottom)?.name ?? t("freeSeat") }}<template v-if="room.you === bottom"> ({{ t("you") }})</template></strong>
        <small>{{ sideName(bottom) }}<template v-if="seatOf(bottom) && !seatOf(bottom)!.online"> · {{ t("away") }}</template></small>
      </span>
      <span class="pg-captured" aria-hidden="true"><img v-for="(piece, index) in captured[bottom === 'w' ? 'b' : 'w']" :key="index" :src="pieceUrl(piece)" alt="" /></span>
      <span v-if="times" class="pg-clock" :class="{ 'pg-clock-run': room.running === bottom, 'pg-clock-low': clockLeft(bottom) < 20_000 }">{{ clockText(bottom) }}</span>
      <button v-if="canSit(bottom)" type="button" class="pg-btn pg-btn-small" @click="send({ type: 'chessSit', color: bottom })">{{ t("sit") }}</button>
    </div>

    <p class="pg-status" role="status">{{ status }}</p>

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
        <button v-if="room.you" type="button" class="pg-btn" @click="send({ type: 'chessStand' })">{{ t("stand") }}</button>
      </template>
      <template v-else-if="room.you">
        <template v-if="room.drawOffer && room.drawOffer !== room.you">
          <span class="pg-note pg-note-strong">{{ t("drawOfferedToYou") }}</span>
          <button type="button" class="pg-btn pg-btn-accent" @click="send({ type: 'chessDraw', id: room.id, action: 'accept' })">{{ t("accept") }}</button>
          <button type="button" class="pg-btn" @click="send({ type: 'chessDraw', id: room.id, action: 'decline' })">{{ t("decline") }}</button>
        </template>
        <button v-else type="button" class="pg-btn" :disabled="room.drawOffer === room.you" @click="send({ type: 'chessDraw', id: room.id, action: 'offer' })">{{ room.drawOffer === room.you ? t("drawOffered") : t("offerDraw") }}</button>
        <button type="button" class="pg-btn" :class="{ 'pg-btn-danger': resignArmed }" @click="resign">{{ resignArmed ? t("resignConfirm") : t("resign") }}</button>
      </template>
      <button type="button" class="pg-icon-btn" :aria-label="t('flip')" :title="t('flip')" @click="flipped = !flipped"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4v14M4 15l3 3 3-3M17 20V6M14 9l3-3 3 3"/></svg></button>
    </div>
    <p v-if="room.phase === 'over' && room.you && room.rematch.length" class="pg-note">{{ room.rematch.includes(room.you) ? t("rematchAsked") : t("rematchOffered") }}</p>

    <details class="pg-moves" :open="moveRows.length > 0">
      <summary>{{ t("moves") }}</summary>
      <ol v-if="moveRows.length" ref="movesEl">
        <li v-for="row in moveRows" :key="row.number"><span>{{ row.number }}.</span><span>{{ row.white }}</span><span>{{ row.black }}</span></li>
      </ol>
      <p v-else class="pg-note">{{ t("noMoves") }}</p>
    </details>
    <p v-if="room.spectators.length" class="pg-note">{{ t("spectators", { names: room.spectators.join(", ") }) }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { applyMove, capturedPieces, colorOf, findMove, inCheck, legalMoves, parseFen, squareIndex, type ChessColor, type ChessMove, type ChessPosition, type Promotion } from "../../../../../src/shared/chess.js";
import type { ChessClientMessage, ChessRoomView, ChessSeatView } from "../../../../../src/shared/chess-room.js";
import type { ChessClient } from "../../../party/party-client.js";
import type { PartyTextKey, PartyTranslate } from "../../../party/party-text.js";

const props = defineProps<{ client: ChessClient; t: PartyTranslate }>();
const t = props.t;
const CLOCK_OPTIONS = ["1+0", "3+0", "3+2", "5+0", "5+3", "10+0", "10+5", "15+10", "30+0"];

const room = computed<ChessRoomView | null>(() => props.client.state.room);
const flipped = ref(false);
const selected = ref<number | null>(null);
const pending = ref<{ id: string; move: ChessMove } | null>(null);
const promotion = ref<{ from: number; to: number } | null>(null);
const resignArmed = ref(false);
const boardEl = ref<HTMLElement | null>(null);
const movesEl = ref<HTMLElement | null>(null);
const now = ref(performance.now());
const ticker = setInterval(() => { now.value = performance.now(); }, 200);
let resignTimer: ReturnType<typeof setTimeout> | undefined;

/** The server's position, with this player's own move shown at once while it travels. */
const serverPosition = computed<ChessPosition | null>(() => room.value ? parseFen(room.value.fen) : null);
const position = computed<ChessPosition | null>(() => {
  const base = serverPosition.value;
  if (!base) return null;
  return pending.value && pending.value.id === room.value?.id ? applyMove(base, pending.value.move) : base;
});
watch(() => [room.value?.fen, room.value?.id, props.client.state.errorAt], () => { pending.value = null; });
// A new game turns the board to your side.
watch(() => [room.value?.id, room.value?.you], () => { flipped.value = room.value?.you === "b"; selected.value = null; promotion.value = null; }, { immediate: true });

const bottom = computed<ChessColor>(() => (flipped.value ? "b" : "w"));
const top = computed<ChessColor>(() => (flipped.value ? "w" : "b"));
const myTurn = computed(() => room.value?.phase === "playing" && !pending.value && room.value.you !== null && position.value?.turn === room.value.you);
const legal = computed<ChessMove[]>(() => (myTurn.value && position.value ? legalMoves(position.value) : []));
const targets = computed(() => new Set(selected.value === null ? [] : legal.value.filter(move => move.from === selected.value).map(move => move.to)));
const lastSquares = computed(() => {
  const moves = room.value?.moves ?? [];
  const last = pending.value ? null : moves[moves.length - 1];
  if (pending.value) return new Set([pending.value.move.from, pending.value.move.to]);
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
const turnOf = (color: ChessColor) => room.value?.phase === "playing" && position.value?.turn === color;
function canSit(color: ChessColor): boolean {
  const value = room.value;
  if (!value || value.phase === "playing" || value.you === color) return false;
  const seat = seatOf(color);
  return !seat || !seat.online;
}

const status = computed(() => {
  const value = room.value;
  if (!value) return "";
  if (value.phase === "waiting") return value.white && value.black ? t("waitStart") : t("waitOpponent");
  if (value.phase === "over") return "";
  const turn = position.value?.turn;
  const check = checkSquare.value >= 0 ? `${t("check")} ` : "";
  if (value.you) return check + (turn === value.you ? t("yourMove") : t("theirMove"));
  return check + t("turnOf", { side: turn === "w" ? t("white") : t("black") });
});

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
  const value = room.value;
  const current = position.value;
  if (!value || !current || !myTurn.value) return false;
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
  const board = boardEl.value;
  if (!board) return null;
  const box = board.getBoundingClientRect();
  const column = Math.floor(((event.clientX - box.left) / box.width) * 8);
  const row = Math.floor(((event.clientY - box.top) / box.height) * 8);
  if (column < 0 || column > 7 || row < 0 || row > 7) return null;
  const rank = flipped.value ? row : 7 - row;
  const file = flipped.value ? 7 - column : column;
  return rank * 8 + file;
}
function onPointerDown(event: PointerEvent): void {
  if (event.button !== 0 || promotion.value) return;
  const square = squareAt(event);
  if (square === null) return;
  const piece = position.value?.board[square] ?? "";
  if (selected.value !== null && targets.value.has(square)) { tryMove(selected.value, square); return; }
  if (myTurn.value && piece && colorOf(piece) === room.value?.you && legal.value.some(move => move.from === square)) {
    selectedBefore = selected.value;
    selected.value = square;
    dragStart = { x: event.clientX, y: event.clientY, id: event.pointerId };
    boardEl.value?.setPointerCapture(event.pointerId);
    return;
  }
  selected.value = null;
}
function onPointerMove(event: PointerEvent): void {
  if (!dragStart || event.pointerId !== dragStart.id || selected.value === null) return;
  if (dragFrom.value === null && Math.hypot(event.clientX - dragStart.x, event.clientY - dragStart.y) < 6) return;
  const box = boardEl.value!.getBoundingClientRect();
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

onBeforeUnmount(() => { clearInterval(ticker); clearTimeout(resignTimer); });
</script>
