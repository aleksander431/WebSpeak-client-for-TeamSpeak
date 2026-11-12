<template>
  <div class="ed-page" :data-ed-theme="theme">
    <div class="ed-wrap">
      <p v-if="state === 'loading'" class="ed-muted">{{ t.loading }}</p>

      <section v-else-if="state === 'unknown'" class="ed-box">
        <h1>{{ t.title }}</h1>
        <p>{{ t.unknownLink }}</p>
      </section>

      <section v-else-if="state === 'none'" class="ed-box">
        <p class="ed-kicker">{{ label }}</p>
        <h1>{{ t.askTitle }}</h1>
        <p class="ed-muted">{{ t.askLead }}</p>
        <form class="ed-ask" @submit.prevent="ask">
          <label><span>{{ t.yourName }}</span><input v-model="name" class="ed-input" maxlength="40" required /></label>
          <button type="submit" class="ed-btn ed-gold" :disabled="busy || !name.trim()">{{ t.ask }}</button>
        </form>
        <p v-if="problem" class="ed-bad" role="alert">{{ problem }}</p>
      </section>

      <section v-else-if="state === 'pending'" class="ed-box">
        <p class="ed-kicker">{{ label }}</p>
        <h1>{{ t.pendingTitle }}</h1>
        <p class="ed-muted">{{ t.pendingLead }}</p>
        <div class="ed-spinner" aria-hidden="true"></div>
      </section>

      <section v-else-if="state === 'denied'" class="ed-box">
        <h1>{{ t.deniedTitle }}</h1>
        <p class="ed-muted">{{ t.deniedLead }}</p>
      </section>

      <DraftEditor
        v-else-if="state === 'editing' && opened"
        :key="opened.id"
        :t="t"
        :russian="russian"
        :api="api"
        :id="opened.id"
        :initial="opened.draft"
        :files="opened.files"
        :summary="opened.summary"
        @back="closeDraft"
      />

      <section v-else class="ed-list">
        <header class="ed-head">
          <div>
            <p class="ed-kicker">{{ label }}</p>
            <h1>{{ t.drafts }}</h1>
          </div>
          <form class="ed-new" @submit.prevent="create">
            <input v-model="newTitle" class="ed-input" :placeholder="t.newDraftTitle" :aria-label="t.newDraftTitle" maxlength="80" />
            <button type="submit" class="ed-btn ed-gold" :disabled="busy">＋ {{ t.create }}</button>
          </form>
        </header>
        <p v-if="problem" class="ed-bad" role="alert">{{ problem }}</p>
        <p v-if="!drafts.length" class="ed-empty">{{ t.noDrafts }}</p>
        <ul class="ed-drafts">
          <li v-for="item in drafts" :key="item.id" class="ed-draft">
            <button type="button" class="ed-draft-open" @click="openDraft(item.id)">
              <strong>{{ item.title }}</strong>
              <small>{{ t.updated }} {{ when(item.updatedAt) }}<template v-if="item.publishedAt"> · {{ t.published }} {{ when(item.publishedAt) }}</template></small>
            </button>
            <button type="button" class="ed-btn" @click="openDraft(item.id)">{{ t.open }}</button>
            <button type="button" :class="['ed-btn', 'ed-btn-bad', { 'ed-armed': armed === item.id }]" @click="remove(item.id)">
              {{ armed === item.id ? t.removeConfirm : t.remove }}
            </button>
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import DraftEditor from "../components/editor/DraftEditor.vue";
import type { AdventureDraft } from "../../../src/shared/adventure-draft.js";
import { createEditorApi, type EditorDraftSummary } from "../editor/editor-api.js";
import { editorText } from "../editor/editor-text.js";
import { getStoredTheme, isDarkTheme } from "../services/theme.js";

const route = useRoute();
const token = String(route.params.token ?? "");
const api = createEditorApi(token);
function storedLanguage(): string {
  try { return localStorage.getItem("webspeak:language") ?? ""; } catch { return ""; }
}
const language = storedLanguage() || navigator.language || "";
const russian = /^ru\b/i.test(language);
const t = editorText(russian);
const theme = ref<"dark" | "light">(isDarkTheme(getStoredTheme()) ? "dark" : "light");

type State = "loading" | "unknown" | "none" | "pending" | "denied" | "list" | "editing";
const state = ref<State>("loading");
const label = ref("");
const name = ref("");
const busy = ref(false);
const problem = ref("");
const drafts = ref<EditorDraftSummary[]>([]);
const newTitle = ref("");
const armed = ref("");
const opened = ref<{ id: string; draft: AdventureDraft; files: string[]; summary: EditorDraftSummary } | null>(null);
let poll: ReturnType<typeof setInterval> | undefined;

function errorText(error: unknown): string {
  const code = (error as { code?: string }).code ?? "";
  return t.errors[code] ?? (error instanceof Error ? error.message : String(error));
}

async function refresh(): Promise<void> {
  try {
    const status = await api.status();
    label.value = status.label;
    if (status.status === "approved") {
      stopPoll();
      if (state.value !== "editing") {
        await loadDrafts();
        state.value = "list";
      }
      return;
    }
    state.value = status.status;
    if (status.status === "pending") startPoll();
    else stopPoll();
  } catch (error: unknown) {
    const status = (error as { status?: number }).status;
    if (status === 404) { state.value = "unknown"; stopPoll(); }
    else if (state.value === "loading") { problem.value = errorText(error); state.value = "unknown"; }
  }
}

function startPoll(): void {
  if (!poll) poll = setInterval(() => { void refresh(); }, 5000);
}
function stopPoll(): void {
  clearInterval(poll);
  poll = undefined;
}

async function ask(): Promise<void> {
  busy.value = true;
  problem.value = "";
  try {
    const result = await api.request(name.value.trim());
    state.value = result.status === "approved" ? "list" : result.status;
    if (result.status === "approved") await loadDrafts();
    if (result.status === "pending") startPoll();
  } catch (error: unknown) {
    problem.value = errorText(error);
  } finally {
    busy.value = false;
  }
}

async function loadDrafts(): Promise<void> {
  drafts.value = (await api.drafts()).drafts.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

async function create(): Promise<void> {
  busy.value = true;
  problem.value = "";
  try {
    const result = await api.createDraft(newTitle.value.trim() || t.newDraft);
    newTitle.value = "";
    await openDraft(result.id);
  } catch (error: unknown) {
    problem.value = errorText(error);
  } finally {
    busy.value = false;
  }
}

async function openDraft(id: string): Promise<void> {
  problem.value = "";
  try {
    const result = await api.draft(id);
    opened.value = { id, draft: result.draft, files: result.files, summary: result.summary };
    state.value = "editing";
    history.replaceState(history.state, "", `#${id}`);
  } catch (error: unknown) {
    problem.value = errorText(error);
  }
}

async function closeDraft(): Promise<void> {
  opened.value = null;
  state.value = "list";
  history.replaceState(history.state, "", location.pathname);
  try { await loadDrafts(); } catch (error: unknown) { problem.value = errorText(error); }
}

let disarm: ReturnType<typeof setTimeout> | undefined;
async function remove(id: string): Promise<void> {
  if (armed.value !== id) {
    armed.value = id;
    clearTimeout(disarm);
    disarm = setTimeout(() => { armed.value = ""; }, 3000);
    return;
  }
  armed.value = "";
  try {
    await api.remove(id);
    drafts.value = drafts.value.filter(item => item.id !== id);
  } catch (error: unknown) {
    problem.value = errorText(error);
  }
}

const formatter = computed(() => new Intl.DateTimeFormat(russian ? "ru" : "en", { dateStyle: "medium", timeStyle: "short" }));
function when(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : formatter.value.format(date);
}

onMounted(async () => {
  document.title = t.title;
  await refresh();
  const hash = location.hash.slice(1);
  if (state.value === "list" && /^[a-z0-9-]{4,40}$/.test(hash)) await openDraft(hash);
});
onBeforeUnmount(() => { stopPoll(); clearTimeout(disarm); });
</script>

<style>
html[data-ws-route="editor"], html[data-ws-route="editor"] body { min-height: 100%; margin: 0; background: #121318; }
html[data-ws-route="editor"][data-theme="light"], html[data-ws-route="editor"][data-theme="light"] body { background: #f4efe4; }
</style>

<style scoped>
.ed-page {
  --ed-bg: #121318; --ed-card: #1a1c23; --ed-raised: #22252e; --ed-line: rgba(255, 255, 255, .08); --ed-line-2: rgba(255, 255, 255, .16);
  --ed-text: #e9e5dc; --ed-muted: #a39d90; --ed-title: #f3e3bd; --ed-gold: #d9a94c; --ed-gold-soft: rgba(217, 169, 76, .14);
  --ed-bad: #ef7d70; --ed-good: #79c98a; --ed-serif: "Cormorant Garamond", "Georgia", serif;
  min-height: 100vh; background: var(--ed-bg); color: var(--ed-text); font-family: "Inter", system-ui, sans-serif; font-size: 14px;
}
.ed-page[data-ed-theme="light"] {
  --ed-bg: #f4efe4; --ed-card: #fffdf8; --ed-raised: #f7f2e7; --ed-line: rgba(60, 40, 10, .1); --ed-line-2: rgba(60, 40, 10, .2);
  --ed-text: #2b261d; --ed-muted: #6f6656; --ed-title: #4a3510; --ed-gold: #a8731a; --ed-gold-soft: rgba(168, 115, 26, .12);
  --ed-bad: #b4372a; --ed-good: #2f7d43;
}
.ed-wrap { max-width: 1240px; margin: 0 auto; padding: 28px 24px 60px; }
.ed-box { max-width: 560px; margin: 10vh auto 0; padding: 30px; border-radius: 20px; border: 1px solid var(--ed-line); background: var(--ed-card); }
h1 { margin: 0 0 10px; font-family: var(--ed-serif); font-size: 34px; color: var(--ed-title); }
.ed-kicker { margin: 0 0 4px; font-size: 12px; letter-spacing: .1em; text-transform: uppercase; color: var(--ed-gold); }
.ed-muted { color: var(--ed-muted); line-height: 1.55; }
.ed-bad { color: var(--ed-bad); }
.ed-ask { display: flex; gap: 10px; align-items: flex-end; flex-wrap: wrap; margin-top: 16px; }
.ed-ask label { display: flex; flex-direction: column; gap: 5px; flex: 1 1 220px; font-size: 13px; font-weight: 600; color: var(--ed-muted); }
.ed-input { min-height: 40px; padding: 7px 12px; border-radius: 10px; border: 1px solid var(--ed-line-2); background: var(--ed-raised); color: var(--ed-text); font: inherit; }
.ed-btn { min-height: 40px; padding: 0 16px; border-radius: 10px; border: 1px solid var(--ed-line-2); background: var(--ed-raised); color: var(--ed-text); font: inherit; cursor: pointer; }
.ed-btn:disabled { opacity: .5; cursor: default; }
.ed-gold { border-color: var(--ed-gold); background: var(--ed-gold); color: #1a1408; font-weight: 700; }
.ed-btn-bad { color: var(--ed-bad); }
.ed-armed { border-color: var(--ed-bad); background: var(--ed-bad); color: #fff; }
.ed-spinner { width: 34px; height: 34px; margin-top: 18px; border-radius: 50%; border: 3px solid var(--ed-line-2); border-top-color: var(--ed-gold); animation: ed-spin 1s linear infinite; }
@keyframes ed-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .ed-spinner { animation: none; } }
.ed-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin-bottom: 18px; }
.ed-new { display: flex; gap: 8px; }
.ed-new .ed-input { width: 280px; }
.ed-empty { padding: 40px; border-radius: 16px; border: 1px dashed var(--ed-line-2); text-align: center; color: var(--ed-muted); }
.ed-drafts { display: flex; flex-direction: column; gap: 8px; margin: 0; padding: 0; list-style: none; }
.ed-draft { display: flex; align-items: center; gap: 10px; padding: 12px 14px; border-radius: 14px; border: 1px solid var(--ed-line); background: var(--ed-card); }
.ed-draft-open { display: flex; flex-direction: column; gap: 3px; flex: 1; min-width: 0; padding: 0; border: 0; background: none; color: var(--ed-text); font: inherit; text-align: left; cursor: pointer; }
.ed-draft-open strong { font-size: 16px; color: var(--ed-title); }
.ed-draft-open small { color: var(--ed-muted); }
button:focus-visible, .ed-input:focus-visible { outline: 2px solid var(--ed-gold); outline-offset: 2px; }
</style>
