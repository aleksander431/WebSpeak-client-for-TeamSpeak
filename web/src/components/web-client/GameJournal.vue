<template>
  <aside class="gj" data-ws-part="voice.game.journal" role="dialog" :aria-label="t.title" @keydown.esc.stop.prevent="emit('close')">
    <header class="gj-head">
      <h2 class="gj-title">📖 {{ t.title }}</h2>
      <button ref="closeButton" type="button" class="gj-close" :aria-label="closeLabel" @click="emit('close')">×</button>
    </header>
    <p class="gj-lead">{{ t.lead }}</p>

    <form v-if="canWrite" class="gj-form" @submit.prevent="submit">
      <div class="gj-kinds" role="radiogroup" :aria-label="t.title">
        <label v-for="kind in JOURNAL_KINDS" :key="kind" :class="['gj-kind', { 'gj-kind-on': draftKind === kind }]">
          <input v-model="draftKind" type="radio" name="gj-kind" :value="kind" />
          <span aria-hidden="true">{{ t.icons[kind] }}</span>{{ t.kinds[kind] }}
        </label>
      </div>
      <textarea
        ref="input"
        v-model="draft"
        class="gj-input"
        rows="3"
        :maxlength="MAX_JOURNAL_TEXT"
        :placeholder="t.placeholder"
        :aria-label="t.placeholder"
        @keydown.enter.ctrl.prevent="submit"
        @keydown.enter.meta.prevent="submit"
      ></textarea>
      <div class="gj-actions">
        <span class="gj-count">{{ draft.length }}/{{ MAX_JOURNAL_TEXT }}</span>
        <button v-if="editingId" type="button" class="gj-btn" @click="cancelEdit">{{ t.cancel }}</button>
        <button type="submit" class="gj-btn gj-btn-gold" :disabled="!draft.trim()">{{ editingId ? t.save : t.add }}</button>
      </div>
    </form>
    <p v-else class="gj-muted gj-small">{{ t.spectator }}</p>

    <nav v-if="entries.length" class="gj-filter" :aria-label="t.title">
      <button type="button" :class="['gj-chip', { 'gj-chip-on': filter === null }]" @click="filter = null">{{ t.all }} · {{ entries.length }}</button>
      <button
        v-for="kind in usedKinds"
        :key="kind"
        type="button"
        :class="['gj-chip', { 'gj-chip-on': filter === kind }]"
        @click="filter = kind"
      >{{ t.icons[kind] }} {{ t.kinds[kind] }} · {{ countOf(kind) }}</button>
    </nav>

    <ol class="gj-list">
      <li v-if="!entries.length" class="gj-empty">{{ t.empty }}</li>
      <li v-for="entry in shown" :key="entry.id" :class="['gj-entry', `gj-entry-${entry.kind}`, { 'gj-entry-editing': editingId === entry.id }]">
        <span class="gj-entry-icon" :title="t.kinds[entry.kind]" aria-hidden="true">{{ t.icons[entry.kind] }}</span>
        <div class="gj-entry-body">
          <p class="gj-entry-text">{{ entry.text }}</p>
          <span class="gj-meta">{{ t.kinds[entry.kind] }} · {{ entry.by }} · {{ when(entry.at) }}</span>
        </div>
        <span v-if="entry.editable" class="gj-entry-tools">
          <button type="button" class="gj-link" @click="startEdit(entry)">{{ t.edit }}</button>
          <button type="button" class="gj-link gj-link-bad" @click="emit('remove', entry.id)">{{ t.remove }}</button>
        </span>
      </li>
    </ol>
  </aside>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from "vue";
import { JOURNAL_KINDS, MAX_JOURNAL_TEXT, type JournalEntryView, type JournalKind } from "../../../../src/shared/tabletop.js";
import type { LearnText } from "../../game/learn-text.js";

const props = defineProps<{
  t: LearnText["journal"];
  entries: JournalEntryView[];
  canWrite: boolean;
  closeLabel: string;
  russian: boolean;
}>();
const emit = defineEmits<{ close: []; add: [kind: JournalKind, text: string]; edit: [id: string, kind: JournalKind, text: string]; remove: [id: string] }>();

const draft = ref("");
const draftKind = ref<JournalKind>("note");
const editingId = ref<string | null>(null);
const filter = ref<JournalKind | null>(null);
const input = ref<HTMLTextAreaElement | null>(null);
const closeButton = ref<HTMLButtonElement | null>(null);

onMounted(() => (input.value ?? closeButton.value)?.focus());

const usedKinds = computed(() => JOURNAL_KINDS.filter(kind => props.entries.some(entry => entry.kind === kind)));
const shown = computed(() => (filter.value ? props.entries.filter(entry => entry.kind === filter.value) : props.entries));
const countOf = (kind: JournalKind) => props.entries.filter(entry => entry.kind === kind).length;

function submit(): void {
  const text = draft.value.trim();
  if (!text) return;
  if (editingId.value) emit("edit", editingId.value, draftKind.value, text);
  else emit("add", draftKind.value, text);
  draft.value = "";
  editingId.value = null;
}
function startEdit(entry: JournalEntryView): void {
  editingId.value = entry.id;
  draft.value = entry.text;
  draftKind.value = entry.kind;
  void nextTick(() => input.value?.focus());
}
function cancelEdit(): void {
  editingId.value = null;
  draft.value = "";
}
function when(at: number): string {
  const date = new Date(at);
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  return date.toLocaleString(props.russian ? "ru-RU" : "en-GB", sameDay ? { hour: "2-digit", minute: "2-digit" } : { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
</script>

<style scoped>
.gj {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  z-index: 22;
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: min(460px, 100%);
  padding: 16px 18px;
  border-left: 1px solid var(--gm-gold, #d9b46c);
  background: linear-gradient(180deg, #1f1b14, var(--gm-card, #1a1b20) 160px);
  box-shadow: -24px 0 60px rgba(0, 0, 0, .45);
  color: var(--gm-text, #e8e6e1);
}
.gj-head { display: flex; align-items: center; gap: 10px; }
.gj-title { flex: 1 1 auto; margin: 0; font-family: "Cormorant Garamond", Georgia, serif; font-size: 26px; color: #f1e6cf; letter-spacing: 0; text-transform: none; }
.gj-close { width: 36px; height: 36px; border-radius: 10px; border: 1px solid var(--gm-line-2, #3a3c44); background: transparent; color: var(--gm-text, #e8e6e1); font-size: 20px; cursor: pointer; }
.gj-lead { margin: 0; color: var(--gm-muted, #a9a6a0); font-size: 13px; line-height: 1.45; }
.gj-form { display: flex; flex-direction: column; gap: 8px; padding: 12px; border-radius: 14px; border: 1px solid var(--gm-line-2, #3a3c44); background: var(--gm-raised, #23252b); }
.gj-kinds { display: flex; flex-wrap: wrap; gap: 4px; }
.gj-kind { position: relative; display: inline-flex; align-items: center; gap: 5px; min-height: 30px; padding: 0 10px; border-radius: 999px; border: 1px solid var(--gm-line-2, #3a3c44); color: var(--gm-muted, #a9a6a0); font-size: 12px; cursor: pointer; }
.gj-kind input { position: absolute; opacity: 0; pointer-events: none; }
.gj-kind-on { border-color: var(--gm-gold, #d9b46c); background: var(--gm-gold-soft, #3a3020); color: #f1e6cf; }
.gj-kind:focus-within { outline: 2px solid var(--gm-gold, #d9b46c); outline-offset: 2px; }
.gj-input { min-height: 72px; padding: 8px 10px; border-radius: 10px; border: 1px solid var(--gm-line-2, #3a3c44); background: var(--gm-card, #1a1b20); color: var(--gm-text, #e8e6e1); font: inherit; font-size: 14px; resize: vertical; }
.gj-actions { display: flex; align-items: center; justify-content: flex-end; gap: 8px; }
.gj-count { margin-right: auto; color: var(--gm-muted, #a9a6a0); font-size: 11px; font-variant-numeric: tabular-nums; }
.gj-btn { min-height: 34px; padding: 0 14px; border-radius: 10px; border: 1px solid var(--gm-line-2, #3a3c44); background: transparent; color: var(--gm-text, #e8e6e1); font: inherit; font-size: 13px; cursor: pointer; }
.gj-btn:disabled { opacity: .45; cursor: default; }
.gj-btn-gold { border-color: var(--gm-gold, #d9b46c); background: var(--gm-gold, #d9b46c); color: #1a1408; font-weight: 600; }
.gj-filter { display: flex; flex-wrap: wrap; gap: 4px; }
.gj-chip { min-height: 28px; padding: 0 10px; border-radius: 999px; border: 1px solid var(--gm-line, #2a2c33); background: transparent; color: var(--gm-muted, #a9a6a0); font: inherit; font-size: 12px; cursor: pointer; }
.gj-chip-on { border-color: var(--gm-gold, #d9b46c); color: #f1e6cf; }
.gj-list { flex: 1 1 auto; min-height: 0; overflow: auto; display: flex; flex-direction: column; gap: 6px; margin: 0; padding: 0 4px 0 0; list-style: none; }
.gj-empty { padding: 14px; border-radius: 12px; border: 1px dashed var(--gm-line-2, #3a3c44); color: var(--gm-muted, #a9a6a0); font-size: 13px; line-height: 1.45; }
.gj-entry { display: grid; grid-template-columns: auto 1fr; gap: 4px 10px; padding: 10px 12px; border-radius: 12px; border: 1px solid transparent; border-left: 3px solid var(--gm-line-2, #3a3c44); background: var(--gm-raised, #23252b); }
.gj-entry-quest { border-left-color: var(--gm-gold, #d9b46c); }
.gj-entry-person { border-left-color: #8fb4e0; }
.gj-entry-place { border-left-color: #8fd18f; }
.gj-entry-clue { border-left-color: #c79be0; }
.gj-entry-editing { border-color: var(--gm-gold, #d9b46c); }
.gj-entry-icon { font-size: 18px; line-height: 1.3; }
.gj-entry-body { min-width: 0; }
.gj-entry-text { margin: 0; font-size: 14px; line-height: 1.45; white-space: pre-wrap; overflow-wrap: anywhere; }
.gj-meta { color: var(--gm-muted, #a9a6a0); font-size: 11px; }
.gj-entry-tools { grid-column: 2; display: flex; gap: 12px; }
.gj-link { padding: 0; border: 0; background: none; color: var(--gm-gold, #d9b46c); font: inherit; font-size: 12px; cursor: pointer; }
.gj-link-bad { color: var(--gm-bad, #e08a8a); }
.gj-muted { color: var(--gm-muted, #a9a6a0); }
.gj-small { margin: 0; font-size: 12px; }
button:focus-visible, .gj-input:focus-visible { outline: 2px solid var(--gm-gold, #d9b46c); outline-offset: 2px; }
</style>
