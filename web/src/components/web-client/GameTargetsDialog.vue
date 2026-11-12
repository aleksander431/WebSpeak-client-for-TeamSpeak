<template>
  <div class="gt" role="dialog" aria-modal="true" :aria-label="title" @keydown.esc.stop.prevent="emit('cancel')" @click.self="emit('cancel')">
    <form class="gt-card" @submit.prevent="confirm">
      <h2 class="gt-title">{{ title }}</h2>
      <p v-if="subtitle" class="gt-sub">{{ subtitle }}</p>
      <slot />
      <template v-if="withTargets">
        <div class="gt-quick">
          <span>{{ x.care.saveTargets }}</span>
          <button type="button" class="gt-link" @click="pick('monster')">{{ x.care.allFoes }}</button>
          <button type="button" class="gt-link" @click="pick('hero')">{{ x.care.allHeroes }}</button>
        </div>
        <div class="gt-list">
          <label v-for="token in tokens" :key="token.id" :class="['gt-item', `gt-${token.kind}`, { 'gt-on': chosen.includes(token.id) }]">
            <input v-model="chosen" type="checkbox" :value="token.id" />
            <img v-if="portraitOf(token)" :src="portraitOf(token)" alt="" />
            <span v-else class="gt-initial">{{ token.name.slice(0, 1) }}</span>
            <span class="gt-name">{{ token.name }}</span>
          </label>
          <p v-if="!tokens.length" class="gt-sub">{{ x.improv.noTokens }}</p>
        </div>
      </template>
      <div class="gt-actions">
        <button ref="cancelButton" type="button" class="gt-btn" @click="emit('cancel')">{{ x.cancel }}</button>
        <button type="submit" :class="['gt-btn', danger ? 'gt-btn-war' : 'gt-btn-gold']" :disabled="(withTargets && !chosen.length) || !valid">{{ confirmLabel }}</button>
      </div>
    </form>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import type { TokenView } from "../../../../src/shared/tabletop.js";
import type { DndText } from "../../game/dnd-text.js";

/** A dialog over the panel: optional extra fields (slot) and, usually, a pick of map tokens. The caller sets its `data-ws-part`. */
const props = withDefaults(defineProps<{
  x: DndText;
  title: string;
  subtitle?: string;
  confirmLabel: string;
  tokens?: TokenView[];
  preselected?: string[];
  portraitOf?: (token: TokenView) => string | undefined;
  withTargets?: boolean;
  danger?: boolean;
  /** The slot's fields are complete. */
  valid?: boolean;
}>(), { subtitle: "", tokens: () => [], preselected: () => [], portraitOf: () => undefined, withTargets: true, danger: false, valid: true });
const emit = defineEmits<{ cancel: []; confirm: [targets: string[]] }>();

const chosen = ref<string[]>(props.preselected.filter(id => props.tokens.some(token => token.id === id)));
const cancelButton = ref<HTMLButtonElement | null>(null);
onMounted(() => cancelButton.value?.focus());

function pick(kind: "hero" | "monster"): void {
  chosen.value = props.tokens.filter(token => token.kind === kind).map(token => token.id);
}
function confirm(): void {
  if ((props.withTargets && !chosen.value.length) || !props.valid) return;
  emit("confirm", [...chosen.value]);
}
</script>

<style scoped>
.gt { position: absolute; inset: 0; z-index: 25; display: grid; place-items: center; padding: 24px; background: rgba(8, 9, 12, .6); }
.gt-card { display: flex; flex-direction: column; gap: 12px; width: min(500px, 100%); max-height: 100%; overflow: auto; padding: 18px; border-radius: 16px; border: 1px solid var(--gm-line-2, #3a3c44); background: var(--gm-card, #1a1b20); box-shadow: 0 24px 60px rgba(0, 0, 0, .5); }
.gt-title { margin: 0; font-family: "Cormorant Garamond", Georgia, serif; font-size: 24px; color: #f1e6cf; }
.gt-sub { margin: 0; color: var(--gm-muted, #a9a6a0); font-size: 13px; }
.gt-quick { display: flex; align-items: center; gap: 12px; font-size: 13px; font-weight: 600; }
.gt-link { padding: 0; border: 0; background: none; color: var(--gm-gold, #d9b46c); font: inherit; font-weight: 500; cursor: pointer; text-decoration: underline; text-underline-offset: 3px; }
.gt-list { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.gt-item { display: flex; align-items: center; gap: 8px; min-height: 40px; padding: 4px 8px; border-radius: 10px; border: 1px solid var(--gm-line, #2a2c33); background: var(--gm-raised, #23252b); cursor: pointer; }
.gt-item input { accent-color: var(--gm-gold, #d9b46c); }
.gt-item img, .gt-initial { width: 28px; height: 28px; flex: none; border-radius: 50%; object-fit: cover; }
.gt-initial { display: grid; place-items: center; background: #2c3a4a; font-weight: 600; }
.gt-monster .gt-initial { background: #4a2c2c; }
.gt-monster img { box-shadow: 0 0 0 2px #b84a3e; }
.gt-hero img { box-shadow: 0 0 0 2px var(--gm-gold, #d9b46c); }
.gt-on { border-color: var(--gm-gold, #d9b46c); background: #221f18; }
.gt-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
.gt-actions { display: flex; justify-content: flex-end; gap: 8px; }
.gt-btn { min-height: 40px; padding: 0 16px; border-radius: 10px; border: 1px solid var(--gm-line-2, #3a3c44); background: transparent; color: var(--gm-text, #e8e6e1); font: inherit; cursor: pointer; }
.gt-btn:disabled { opacity: .45; cursor: default; }
.gt-btn-gold { border-color: var(--gm-gold, #d9b46c); background: var(--gm-gold, #d9b46c); color: #1a1408; font-weight: 600; }
.gt-btn-war { border-color: #b84a3e; background: #b84a3e; color: #fff; font-weight: 600; }
/* Fields the slot brings. */
.gt-card :deep(.gt-fields) { display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 8px; }
.gt-card :deep(.gt-field) { display: flex; flex-direction: column; gap: 4px; font-size: 12px; font-weight: 600; color: var(--gm-muted, #a9a6a0); }
.gt-card :deep(.gt-wide) { grid-column: 1 / -1; }
.gt-card :deep(.gt-input) { min-height: 36px; padding: 6px 10px; border-radius: 8px; border: 1px solid var(--gm-line-2, #3a3c44); background: var(--gm-raised, #23252b); color: var(--gm-text, #e8e6e1); font: inherit; font-weight: 400; font-size: 14px; }
.gt-card :deep(.gt-check) { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--gm-text, #e8e6e1); }
.gt-card :deep(.gt-check input) { accent-color: var(--gm-gold, #d9b46c); }
.gt-card :deep(.gt-seg) { display: inline-flex; gap: 4px; padding: 3px; border-radius: 10px; background: var(--gm-raised, #23252b); }
.gt-card :deep(.gt-seg label) { display: inline-flex; align-items: center; min-height: 32px; padding: 0 12px; border-radius: 8px; cursor: pointer; font-size: 13px; color: var(--gm-muted, #a9a6a0); }
.gt-card :deep(.gt-seg input) { position: absolute; opacity: 0; pointer-events: none; }
.gt-card :deep(.gt-seg label:has(input:checked)) { background: var(--gm-gold, #d9b46c); color: #1a1408; font-weight: 600; }
.gt-card :deep(.gt-seg label:focus-within) { outline: 2px solid var(--gm-gold, #d9b46c); }
button:focus-visible, .gt-item:focus-within, .gt-card :deep(.gt-input:focus-visible) { outline: 2px solid var(--gm-gold, #d9b46c); outline-offset: 2px; }
</style>
