<template>
  <div v-if="room" class="pg-mafia" :class="`pg-phase-${room.phase}`" data-ws-part="voice.party.mafia">
    <!-- Where the game is: phase, time left, narration. -->
    <div class="pg-banner">
      <span class="pg-banner-icon" aria-hidden="true">{{ PHASE_ICON[room.phase] }}</span>
      <span class="pg-banner-text">
        <strong>{{ t(`phase_${room.phase}` as PartyTextKey, { round: room.round }) }}</strong>
        <small v-if="lastLine">{{ lastLine }}</small>
      </span>
      <span v-if="timeLeft !== null" class="pg-clock" :class="{ 'pg-clock-low': timeLeft < 10_000 }">{{ formatTime(timeLeft) }}</span>
      <button type="button" class="pg-icon-btn" :aria-pressed="narration" :aria-label="t('narration')" :title="t('narration')" @click="toggleNarration">
        <svg v-if="narration" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/></svg>
        <svg v-else viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z"/><path d="m16 10 4 4M20 10l-4 4"/></svg>
      </button>
      <button type="button" class="pg-icon-btn" :aria-expanded="voiceOpen" :aria-label="t('voice')" :title="t('voice')" data-ws-part="voice.party.mafia-voice" @click="voiceOpen = !voiceOpen">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg>
      </button>
    </div>
    <!-- The host's voice: any voice this computer has, at the speed you like. -->
    <div v-if="voiceOpen" class="pg-voice">
      <label class="pg-field"><span>{{ t("voice") }}</span>
        <select :value="voiceUri" @change="setVoice(($event.target as HTMLSelectElement).value)">
          <option value="">{{ t("voiceDefault") }}</option>
          <option v-for="item in voiceOptions" :key="item.voiceURI" :value="item.voiceURI">{{ item.name }}{{ item.lang ? ` (${item.lang})` : "" }}</option>
        </select>
      </label>
      <label class="pg-field"><span>{{ t("voiceRate") }}</span>
        <input type="range" min="0.6" max="1.4" step="0.05" :value="voiceRate" @input="setRate(Number(($event.target as HTMLInputElement).value))" />
        <span class="pg-note">{{ voiceRate.toFixed(2) }}×</span>
      </label>
      <button type="button" class="pg-btn pg-btn-small" @click="testVoice">{{ t("voiceTest") }}</button>
      <p v-if="!voiceOptions.length" class="pg-note">{{ t("voiceNone") }}</p>
    </div>

    <!-- Lobby -->
    <template v-if="room.phase === 'lobby'">
      <div class="pg-row">
        <button v-if="!room.you" type="button" class="pg-btn pg-btn-accent" data-ws-part="voice.party.mafia-join" @click="send({ type: 'mafiaJoin' })">{{ t("join") }}</button>
        <button v-else type="button" class="pg-btn" @click="send({ type: 'mafiaLeave' })">{{ t("leave") }}</button>
        <span class="pg-note">{{ room.youHost ? t("hostHint") : room.players.length ? t("waitingHost") : "" }}</span>
      </div>
      <fieldset class="pg-settings" :disabled="!room.youHost">
        <legend>{{ t("settings") }}</legend>
        <label class="pg-field"><span>{{ t("mafiaCount") }}</span>
          <select :value="room.settings.mafia" @change="setting('mafia', Number(($event.target as HTMLSelectElement).value))">
            <option :value="0">{{ t("auto", { count: autoMafia }) }}</option>
            <option v-for="count in 5" :key="count" :value="count">{{ count }}</option>
          </select>
        </label>
        <label class="pg-checkbox"><input type="checkbox" :checked="room.settings.doctor" @change="setting('doctor', ($event.target as HTMLInputElement).checked)" /> {{ t("doctor") }}</label>
        <label class="pg-checkbox"><input type="checkbox" :checked="room.settings.detective" @change="setting('detective', ($event.target as HTMLInputElement).checked)" /> {{ t("detective") }}</label>
        <label class="pg-checkbox" :title="t('roleHint_don')"><input type="checkbox" :checked="room.settings.don" @change="setting('don', ($event.target as HTMLInputElement).checked)" /> {{ t("don") }}</label>
        <label class="pg-checkbox" :title="t('roleHint_maniac')"><input type="checkbox" :checked="room.settings.maniac" @change="setting('maniac', ($event.target as HTMLInputElement).checked)" /> {{ t("maniac") }}</label>
        <label class="pg-checkbox" :title="t('roleHint_mistress')"><input type="checkbox" :checked="room.settings.mistress" @change="setting('mistress', ($event.target as HTMLInputElement).checked)" /> {{ t("mistress") }}</label>
        <label class="pg-checkbox"><input type="checkbox" :checked="room.settings.reveal" @change="setting('reveal', ($event.target as HTMLInputElement).checked)" /> {{ t("reveal") }}</label>
        <label class="pg-field"><span>{{ t("nightTime") }}</span>
          <select :value="room.settings.nightSeconds" @change="setting('nightSeconds', Number(($event.target as HTMLSelectElement).value))">
            <option v-for="value in MAFIA_NIGHT_SECONDS" :key="value" :value="value">{{ value ? t("seconds", { seconds: value }) : t("noLimit") }}</option>
          </select>
        </label>
        <label class="pg-field"><span>{{ t("dayTime") }}</span>
          <select :value="room.settings.daySeconds" @change="setting('daySeconds', Number(($event.target as HTMLSelectElement).value))">
            <option v-for="value in MAFIA_DAY_SECONDS" :key="value" :value="value">{{ value ? formatTime(value * 1000) : t("noLimit") }}</option>
          </select>
        </label>
        <label class="pg-field"><span>{{ t("voteTime") }}</span>
          <select :value="room.settings.voteSeconds" @change="setting('voteSeconds', Number(($event.target as HTMLSelectElement).value))">
            <option v-for="value in MAFIA_VOTE_SECONDS" :key="value" :value="value">{{ value ? t("seconds", { seconds: value }) : t("noLimit") }}</option>
          </select>
        </label>
      </fieldset>
      <div v-if="room.youHost" class="pg-row">
        <button type="button" class="pg-btn pg-btn-accent" data-ws-part="voice.party.mafia-start" :disabled="!!startProblem" @click="send({ type: 'mafiaStart' })">{{ t("startGame") }}</button>
        <span v-if="startProblem" class="pg-note">{{ startProblem }}</span>
      </div>
    </template>

    <!-- Your role, while playing -->
    <div v-if="me?.role && room.phase !== 'lobby'" class="pg-role" :class="`pg-role-${me.role}`">
      <span class="pg-role-icon" aria-hidden="true">{{ ROLE_ICON[me.role] }}</span>
      <span>
        <small>{{ t("yourRole") }}</small>
        <strong>{{ roleName(t, me.role) }}</strong>
        <span v-if="room.phase !== 'over'" class="pg-role-hint">{{ me.alive ? t(`roleHint_${me.role}` as PartyTextKey) : t("dead") }}</span>
        <span v-if="isMafiaSide(me.role) && teammates.length" class="pg-role-hint">{{ t("team", { names: teammates.join(", ") }) }}</span>
      </span>
    </div>
    <p v-else-if="room.phase !== 'lobby' && room.phase !== 'over'" class="pg-note">{{ t("spectating") }}</p>

    <!-- What to do now -->
    <div v-if="nightRole === 'don'" class="pg-segment" role="radiogroup">
      <button type="button" role="radio" :aria-checked="donMode === 'kill'" :class="{ 'pg-segment-on': donMode === 'kill' }" @click="donMode = 'kill'">🔪 {{ t("donKill") }}</button>
      <button type="button" role="radio" :aria-checked="donMode === 'check'" :class="{ 'pg-segment-on': donMode === 'check' }" @click="donMode = 'check'">🔎 {{ t("donSearch") }}<template v-if="room.secret.donCheck"> ✓</template></button>
    </div>
    <p v-if="prompt" class="pg-prompt" role="status">{{ prompt }}</p>
    <ul v-if="room.phase === 'night' && room.secret.picks?.length" class="pg-secret">
      <li>{{ t("teamPicks") }}</li>
      <li v-for="item in room.secret.picks" :key="item.from">{{ nameOf(item.from) }} → <strong>{{ nameOf(item.to) }}</strong></li>
      <li class="pg-note">{{ t("agreeHint") }}</li>
    </ul>
    <ul v-if="room.secret.checks?.length" class="pg-secret">
      <li v-for="check in room.secret.checks" :key="`${check.round}-${check.target}`" :class="check.mafia === null ? 'pg-note' : check.mafia ? 'pg-bad' : 'pg-good'">
        {{ check.mafia === null ? t("checkFailed", { name: nameOf(check.target) }) : t("checkResult", { name: nameOf(check.target), verdict: check.mafia ? t("isMafia") : t("notMafia") }) }}
      </li>
    </ul>
    <ul v-if="room.secret.donChecks?.length" class="pg-secret">
      <li v-for="check in room.secret.donChecks" :key="`${check.round}-${check.target}`" :class="check.detective === null ? 'pg-note' : check.detective ? 'pg-bad' : 'pg-good'">
        {{ check.detective === null ? t("checkFailed", { name: nameOf(check.target) }) : t("checkResult", { name: nameOf(check.target), verdict: check.detective ? t("isDetective") : t("notDetective") }) }}
      </li>
    </ul>

    <!-- The table -->
    <div class="pg-players" :aria-label="t('players', { count: room.players.length })">
      <div v-for="player in room.players" :key="player.id" class="pg-player-cell">
      <button
        type="button"
        class="pg-player"
        :class="{
          'pg-player-dead': !player.alive && room.phase !== 'lobby',
          'pg-player-you': player.you,
          'pg-player-chosen': chosenId === player.id,
          'pg-player-pickable': canPick(player),
          [`pg-role-${player.role}`]: !!player.role,
        }"
        :disabled="!canPick(player)"
        @click="pick(player)"
      >
        <span class="pg-player-top">
          <span class="pg-dot" :class="player.online ? 'pg-on' : 'pg-off'" :title="player.online ? '' : t('offline')" aria-hidden="true" />
          <strong>{{ player.name }}</strong>
          <span v-if="player.host" class="pg-tag">{{ t("host") }}</span>
          <span v-if="room.phase === 'vote' && voteCounts.get(player.id)" class="pg-votes">{{ voteCounts.get(player.id) }}</span>
        </span>
        <small>
          <template v-if="player.role">{{ ROLE_ICON[player.role] }} {{ roleName(t, player.role) }}</template>
          <template v-else-if="player.you">{{ t("you") }}</template>
          <template v-if="room.secret.lastHeal === player.id"> · {{ t("healedLastNight") }}</template>
          <template v-if="room.secret.lastVisit === player.id"> · {{ t("visitedLastNight") }}</template>
        </small>
        <span v-if="room.phase === 'vote' && player.vote" class="pg-voted">→ {{ player.vote === "skip" ? t("skipVote") : nameOf(player.vote) }}</span>
      </button>
      <button
        v-if="room.youHost && !player.you && (room.phase === 'lobby' || (!player.online && player.alive && room.phase !== 'over'))"
        type="button"
        class="pg-kick"
        :aria-label="`${t('kick')}: ${player.name}`"
        @click="send({ type: 'mafiaKick', player: player.id })"
      >{{ t("kick") }}</button>
      </div>
    </div>
    <div v-if="room.phase === 'vote' && me?.alive" class="pg-row">
      <button type="button" class="pg-btn" :class="{ 'pg-btn-accent': myVote === 'skip' }" @click="vote('skip')">{{ t("skipVote") }}<template v-if="voteCounts.get('skip')"> ({{ voteCounts.get("skip") }})</template></button>
    </div>

    <!-- The host's controls -->
    <div v-if="room.phase !== 'lobby'" class="pg-row">
      <template v-if="room.youHost">
        <button v-if="room.phase === 'night'" type="button" class="pg-btn" @click="advance">{{ t("endNight") }}</button>
        <button v-if="room.phase === 'day'" type="button" class="pg-btn pg-btn-accent" @click="advance">{{ t("toVote") }}</button>
        <button v-if="room.phase === 'vote'" type="button" class="pg-btn" @click="advance">{{ t("endVote") }}</button>
        <button v-if="room.phase === 'over'" type="button" class="pg-btn pg-btn-accent" @click="send({ type: 'mafiaReset' })">{{ t("newGame") }}</button>
        <button v-else type="button" class="pg-btn" :class="{ 'pg-btn-danger': endArmed }" @click="endGame">{{ t("endGame") }}</button>
      </template>
      <button v-else-if="me && hostAway" type="button" class="pg-btn" @click="send({ type: 'mafiaHost' })">{{ t("becomeHost") }}</button>
      <button v-if="room.phase === 'over' && !room.you" type="button" class="pg-btn pg-btn-accent" @click="send({ type: 'mafiaJoin' })">{{ t("join") }}</button>
    </div>

    <!-- The mafia's whisper -->
    <form v-if="isMafiaSide(me?.role) && room.phase !== 'lobby'" class="pg-chat" @submit.prevent="sendChat">
      <span class="pg-chat-title">{{ t("mafiaChat") }}</span>
      <ol v-if="room.chat.length" ref="chatEl">
        <li v-for="(message, index) in room.chat" :key="index"><strong>{{ nameOf(message.from) }}:</strong> {{ message.text }}</li>
      </ol>
      <div v-if="room.phase !== 'over'" class="pg-row">
        <input v-model="chatText" type="text" maxlength="300" :placeholder="t('chatPlaceholder')" />
        <button type="submit" class="pg-btn" :disabled="!chatText.trim()">{{ t("send") }}</button>
      </div>
    </form>

    <details v-if="room.log.length" class="pg-log" open>
      <summary>{{ t("log") }}</summary>
      <ol ref="logEl">
        <li v-for="(entry, index) in room.log" :key="index" :class="`pg-log-${entry.kind}`">{{ logLine(t, entry) }}</li>
      </ol>
    </details>
    <p v-if="room.spectators.length" class="pg-note">{{ t("spectators", { names: room.spectators.join(", ") }) }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { dealtMafia, isMafiaSide, MAFIA_DAY_SECONDS, MAFIA_MIN_PLAYERS, MAFIA_NIGHT_SECONDS, MAFIA_VOTE_SECONDS, mafiaCountFor, type MafiaClientMessage, type MafiaLogEntry, type MafiaPlayerView, type MafiaRole, type MafiaRoomView, type MafiaSettings } from "../../../../../src/shared/mafia.js";
import type { MafiaClient } from "../../../party/party-client.js";
import { logLine, roleName, type PartyTextKey, type PartyTranslate } from "../../../party/party-text.js";

const props = defineProps<{ client: MafiaClient; t: PartyTranslate; language: string }>();
const t = props.t;
const PHASE_ICON: Record<MafiaRoomView["phase"], string> = { lobby: "🎭", night: "🌙", day: "☀️", vote: "🗳️", over: "🏁" };
const ROLE_ICON: Record<MafiaRole, string> = { citizen: "🙂", mafia: "🔪", don: "🎩", doctor: "💉", detective: "🔎", maniac: "🪓", mistress: "💋" };
const NARRATION_KEY = "webspeak:mafia-narration";

const room = computed<MafiaRoomView | null>(() => props.client.state.room);
const me = computed<MafiaPlayerView | null>(() => room.value?.players.find(player => player.you) ?? null);
const teammates = computed(() => (room.value?.players ?? []).filter(player => !player.you && player.role === "mafia").map(player => player.name));
const nameOf = (id: string) => room.value?.players.find(player => player.id === id)?.name ?? "?";
const hostAway = computed(() => !(room.value?.players ?? []).some(player => player.host && player.online));
const autoMafia = computed(() => mafiaCountFor(Math.max(MAFIA_MIN_PLAYERS, room.value?.players.length ?? 0)));
const chatText = ref("");
const chatEl = ref<HTMLElement | null>(null);
const logEl = ref<HTMLElement | null>(null);
const endArmed = ref(false);
let endTimer: ReturnType<typeof setTimeout> | undefined;
const now = ref(performance.now());
const ticker = setInterval(() => { now.value = performance.now(); }, 250);

const timeLeft = computed(() => {
  const value = room.value;
  if (!value || value.endsIn === null) return null;
  return Math.max(0, value.endsIn - (now.value - props.client.state.receivedAt));
});
const formatTime = (ms: number) => {
  const seconds = Math.ceil(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};

const startProblem = computed(() => {
  const value = room.value;
  if (!value) return "";
  if (value.players.length < MAFIA_MIN_PLAYERS) return t("needPlayers", { count: MAFIA_MIN_PLAYERS });
  return dealtMafia(value.players.length, value.settings) === null ? t("badSettings") : "";
});

const myVote = computed(() => me.value?.vote ?? null);
const voteCounts = computed(() => {
  const counts = new Map<string, number>();
  for (const player of room.value?.players ?? []) if (player.alive && player.vote) counts.set(player.vote, (counts.get(player.vote) ?? 0) + 1);
  return counts;
});
/** Your own choice this phase: night action or vote. */
const chosenId = computed(() => {
  const value = room.value;
  if (value?.phase === "night") return nightRole.value === "don" && donMode.value === "check" ? value.secret.donCheck ?? null : value.acted;
  return value?.phase === "vote" ? myVote.value : null;
});
/** The don chooses twice a night: the mafia's victim, and whom to check for the detective. */
const donMode = ref<"kill" | "check">("kill");
watch(() => room.value?.round, () => { donMode.value = "kill"; });

const nightRole = computed(() => {
  const role = me.value?.alive ? me.value.role : null;
  return room.value?.phase === "night" && role && role !== "citizen" ? role : null;
});
function canPick(player: MafiaPlayerView): boolean {
  const value = room.value;
  if (!value || !player.alive || !me.value?.alive) return false;
  if (value.phase === "vote") return !player.you;
  if (value.phase !== "night" || !nightRole.value) return false;
  const role = nightRole.value;
  if (role === "don" && donMode.value === "check") return !isMafiaSide(player.role) && !value.secret.donCheck;
  if (isMafiaSide(role)) return !isMafiaSide(player.role);
  if (value.acted) return false;
  if (role === "doctor") return value.secret.lastHeal !== player.id;
  if (role === "mistress") return !player.you && value.secret.lastVisit !== player.id;
  return !player.you;
}
function pick(player: MafiaPlayerView): void {
  const value = room.value;
  if (!value || !canPick(player)) return;
  if (value.phase === "vote") vote(player.id);
  else send({ type: "mafiaAct", id: value.id, target: player.id, ...(nightRole.value === "don" && donMode.value === "check" ? { ability: "check" as const } : {}) });
}
function vote(target: string): void {
  if (room.value) send({ type: "mafiaVote", id: room.value.id, target });
}

const prompt = computed(() => {
  const value = room.value;
  if (!value) return "";
  if (value.phase === "over") return value.winner === "town" ? t("townWins") : value.winner === "maniac" ? t("maniacWins") : t("mafiaWins");
  if (value.phase === "night") {
    const role = nightRole.value;
    if (!role) return me.value?.alive ? t("sleep") : "";
    if (role === "don" && donMode.value === "check") return value.secret.donCheck ? t("donSearched", { name: nameOf(value.secret.donCheck) }) : t("nightDonSearch");
    if (value.acted && !isMafiaSide(role)) return t("picked", { name: nameOf(value.acted) });
    const ask: Record<MafiaRole, PartyTextKey> = { mafia: "nightKill", don: "nightKill", doctor: "nightHeal", detective: "nightCheck", maniac: "nightManiac", mistress: "nightVisit", citizen: "sleep" };
    return t(ask[role]);
  }
  if (value.phase === "day") return t("dayHint");
  if (value.phase === "vote" && me.value?.alive) return myVote.value ? `${t("yourVote")}: ${myVote.value === "skip" ? t("skipVote") : nameOf(myVote.value)}` : t("vote");
  return "";
});
/** What happened since the night fell (one morning may have two deaths), or the latest line. */
const lastLine = computed(() => {
  const entries = room.value?.log ?? [];
  if (room.value?.phase === "lobby" || !entries.length) return "";
  let start = entries.length - 1;
  while (start > 0 && entries[start]!.kind !== "night") start--;
  const recent = entries.slice(start).filter(entry => entry.kind !== "night");
  const shown = recent.length ? recent : entries.filter(entry => entry.kind !== "night").slice(-1);
  return shown.map(entry => logLine(t, entry)).join(" · ");
});

function setting<K extends keyof MafiaSettings>(key: K, value: MafiaSettings[K]): void {
  if (room.value) send({ type: "mafiaSettings", settings: { ...room.value.settings, [key]: value } });
}
function advance(): void {
  if (room.value) send({ type: "mafiaAdvance", id: room.value.id });
}
function endGame(): void {
  if (!endArmed.value) {
    endArmed.value = true;
    clearTimeout(endTimer);
    endTimer = setTimeout(() => { endArmed.value = false; }, 3000);
    return;
  }
  endArmed.value = false;
  send({ type: "mafiaReset" });
}
function sendChat(): void {
  const text = chatText.value.trim();
  if (!text || !room.value) return;
  send({ type: "mafiaChat", id: room.value.id, text });
  chatText.value = "";
}
function send(message: MafiaClientMessage): void {
  props.client.send(message);
}
watch(() => room.value?.chat.length, async () => { await nextTick(); chatEl.value?.scrollTo({ top: chatEl.value.scrollHeight }); });
watch(() => room.value?.log.length, async () => { await nextTick(); logEl.value?.scrollTo({ top: logEl.value.scrollHeight }); });

// The host's lines read aloud on this computer (each player hears their own copy).
const narration = ref((() => { try { return localStorage.getItem(NARRATION_KEY) !== "0"; } catch { return true; } })());
function toggleNarration(): void {
  narration.value = !narration.value;
  try { localStorage.setItem(NARRATION_KEY, narration.value ? "1" : "0"); } catch { /* per-browser convenience */ }
  if (!narration.value) window.speechSynthesis?.cancel();
}
const VOICE_KEY = "webspeak:mafia-voice";
const RATE_KEY = "webspeak:mafia-voice-rate";
const readSetting = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
const writeSetting = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* per-browser convenience */ } };
const voiceOpen = ref(false);
const voices = ref<SpeechSynthesisVoice[]>([]);
const voiceUri = ref(readSetting(VOICE_KEY) ?? "");
const storedRate = Number(readSetting(RATE_KEY));
const voiceRate = ref(storedRate >= 0.6 && storedRate <= 1.4 ? storedRate : 0.95);
/** The page's language first (Russian voices for a Russian page), then the rest. */
const voiceOptions = computed(() => {
  const prefix = props.language === "ru" ? "ru" : "en";
  return [...voices.value].sort((a, b) => Number(b.lang.toLowerCase().startsWith(prefix)) - Number(a.lang.toLowerCase().startsWith(prefix)) || a.name.localeCompare(b.name));
});
function loadVoices(): void {
  if (typeof window.speechSynthesis === "undefined") return;
  voices.value = window.speechSynthesis.getVoices();
}
loadVoices();
if (typeof window.speechSynthesis !== "undefined") window.speechSynthesis.addEventListener?.("voiceschanged", loadVoices);
function setVoice(uri: string): void {
  voiceUri.value = uri;
  writeSetting(VOICE_KEY, uri);
  testVoice();
}
function setRate(rate: number): void {
  voiceRate.value = rate;
  writeSetting(RATE_KEY, String(rate));
}
function speak(text: string): void {
  if (!text || typeof window.speechSynthesis === "undefined") return;
  const utterance = new SpeechSynthesisUtterance(text);
  const chosen = voices.value.find(item => item.voiceURI === voiceUri.value);
  if (chosen) { utterance.voice = chosen; utterance.lang = chosen.lang; } else utterance.lang = props.language === "ru" ? "ru-RU" : "en-US";
  utterance.rate = voiceRate.value;
  window.speechSynthesis.speak(utterance);
}
function testVoice(): void {
  window.speechSynthesis?.cancel();
  speak(t("say_night"));
}
function say(text: string): void {
  if (narration.value) speak(text);
}
function lineFor(previous: MafiaRoomView | null, next: MafiaRoomView): string {
  if (!previous || previous.id !== next.id && next.phase !== "night") return "";
  if (previous.phase === next.phase && previous.round === next.round) return "";
  const fresh: MafiaLogEntry[] = next.log.slice(previous.id === next.id ? previous.log.length : 0);
  const parts: string[] = [];
  for (const entry of fresh) {
    if (entry.kind === "killed") parts.push(t("say_day_killed", { name: entry.name }));
    if (entry.kind === "quiet") parts.push(t("say_day_quiet"));
    if (entry.kind === "executed") parts.push(t("say_executed", { name: entry.name }));
    if (entry.kind === "spared") parts.push(t("say_spared"));
    if (entry.kind === "win") parts.push(t(entry.side === "town" ? "say_town" : entry.side === "maniac" ? "say_maniac" : "say_mafia"));
  }
  if (next.phase === "night") parts.push(t("say_night"));
  if (next.phase === "vote") parts.push(t("say_vote"));
  return parts.join(" ");
}
let previousRoom: MafiaRoomView | null = null;
watch(room, next => {
  if (next) say(lineFor(previousRoom, next));
  previousRoom = next ? { ...next, log: [...next.log] } : null;
});

onBeforeUnmount(() => {
  clearInterval(ticker);
  clearTimeout(endTimer);
  window.speechSynthesis?.cancel();
  window.speechSynthesis?.removeEventListener?.("voiceschanged", loadVoices);
});
</script>
