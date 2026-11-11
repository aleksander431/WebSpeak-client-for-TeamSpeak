<template>
  <div class="gs" data-ws-part="voice.game.save-attack" role="dialog" aria-modal="true" :aria-label="title" @keydown.esc.stop.prevent="emit('cancel')" @click.self="emit('cancel')">
    <form class="gs-card" @submit.prevent="confirm">
      <h2 class="gs-title">{{ title }}</h2>
      <p class="gs-rule">{{ rule }} · {{ x.damageShort }} <b>{{ damage }}</b></p>
      <div class="gs-quick">
        <span>{{ x.care.saveTargets }}</span>
        <button type="button" class="gs-link" @click="pick('monster')">{{ x.care.allFoes }}</button>
        <button type="button" class="gs-link" @click="pick('hero')">{{ x.care.allHeroes }}</button>
      </div>
      <div class="gs-list">
        <label v-for="token in tokens" :key="token.id" :class="['gs-item', `gs-${token.kind}`, { 'gs-on': chosen.includes(token.id) }]">
          <input v-model="chosen" type="checkbox" :value="token.id" />
          <img v-if="portraitOf(token)" :src="portraitOf(token)" alt="" />
          <span v-else class="gs-initial">{{ token.name.slice(0, 1) }}</span>
          <span class="gs-name">{{ token.name }}</span>
        </label>
      </div>
      <p v-if="!chosen.length" class="gs-hint">{{ x.care.nobody }}</p>
      <div class="gs-actions">
        <button ref="cancelButton" type="button" class="gs-btn" @click="emit('cancel')">{{ x.cancel }}</button>
        <button type="submit" class="gs-btn gs-btn-gold" :disabled="!chosen.length">{{ x.care.saveGo }}</button>
      </div>
    </form>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import type { TokenView } from "../../../../src/shared/tabletop.js";
import type { DndText } from "../../game/dnd-text.js";

const props = defineProps<{
  x: DndText;
  title: string;
  rule: string;
  damage: string;
  /** Who may be aimed at (what this viewer sees on the map). */
  tokens: TokenView[];
  preselected: string[];
  portraitOf: (token: TokenView) => string | undefined;
}>();
const emit = defineEmits<{ cancel: []; confirm: [targets: string[]] }>();

const chosen = ref<string[]>(props.preselected.filter(id => props.tokens.some(token => token.id === id)));
const cancelButton = ref<HTMLButtonElement | null>(null);
onMounted(() => cancelButton.value?.focus());

function pick(kind: "hero" | "monster"): void {
  chosen.value = props.tokens.filter(token => token.kind === kind).map(token => token.id);
}
function confirm(): void {
  if (chosen.value.length) emit("confirm", [...chosen.value]);
}
</script>

<style scoped>
.gs { position: absolute; inset: 0; z-index: 25; display: grid; place-items: center; padding: 24px; background: rgba(8, 9, 12, .6); }
.gs-card { display: flex; flex-direction: column; gap: 12px; width: min(460px, 100%); max-height: 100%; padding: 18px; border-radius: 16px; border: 1px solid var(--gm-line-2, #3a3c44); background: var(--gm-card, #1a1b20); box-shadow: 0 24px 60px rgba(0, 0, 0, .5); }
.gs-title { margin: 0; font-family: "Cormorant Garamond", Georgia, serif; font-size: 24px; color: #f1e6cf; }
.gs-rule { margin: 0; color: var(--gm-muted, #a9a6a0); }
.gs-rule b { color: var(--gm-text, #e8e6e1); }
.gs-quick { display: flex; align-items: center; gap: 12px; font-size: 13px; font-weight: 600; }
.gs-link { padding: 0; border: 0; background: none; color: var(--gm-gold, #d9b46c); font: inherit; font-weight: 500; cursor: pointer; text-decoration: underline; text-underline-offset: 3px; }
.gs-list { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; overflow: auto; }
.gs-item { display: flex; align-items: center; gap: 8px; min-height: 40px; padding: 4px 8px; border-radius: 10px; border: 1px solid var(--gm-line, #2a2c33); background: var(--gm-raised, #23252b); cursor: pointer; }
.gs-item input { accent-color: var(--gm-gold, #d9b46c); }
.gs-item img, .gs-initial { width: 28px; height: 28px; flex: none; border-radius: 50%; object-fit: cover; }
.gs-initial { display: grid; place-items: center; background: #2c3a4a; font-weight: 600; }
.gs-monster .gs-initial { background: #4a2c2c; }
.gs-monster img { box-shadow: 0 0 0 2px #b84a3e; }
.gs-hero img { box-shadow: 0 0 0 2px var(--gm-gold, #d9b46c); }
.gs-on { border-color: var(--gm-gold, #d9b46c); background: #221f18; }
.gs-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
.gs-hint { margin: 0; font-size: 12px; color: var(--gm-muted, #a9a6a0); }
.gs-actions { display: flex; justify-content: flex-end; gap: 8px; }
.gs-btn { min-height: 40px; padding: 0 16px; border-radius: 10px; border: 1px solid var(--gm-line-2, #3a3c44); background: transparent; color: var(--gm-text, #e8e6e1); font: inherit; cursor: pointer; }
.gs-btn:disabled { opacity: .45; cursor: default; }
.gs-btn-gold { border-color: #b84a3e; background: #b84a3e; color: #fff; font-weight: 600; }
.gs-btn-gold:hover:not(:disabled) { background: #c95a4e; }
button:focus-visible, .gs-item:focus-within { outline: 2px solid var(--gm-gold, #d9b46c); outline-offset: 2px; }
</style>
