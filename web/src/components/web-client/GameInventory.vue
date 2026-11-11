<template>
  <div class="gi" data-ws-part="voice.game.inventory">
    <div class="gi-coins" role="group" :aria-label="x.progress.coins">
      <label v-for="coin in COINS" :key="coin.id" :class="['gi-coin', `gi-coin-${coin.id}`]">
        <span class="gi-coin-dot" aria-hidden="true"></span>
        <input type="number" min="0" max="9999999" :value="coins[coin.id]" :disabled="!editable" :aria-label="x.progress[coin.id]" @change="setCoin(coin.id, $event)" />
        <small>{{ x.progress[coin.id] }}</small>
      </label>
    </div>
    <ul class="gi-list">
      <li v-for="(item, index) in items" :key="`${index}-${item.name}`" class="gi-item">
        <span class="gi-name">
          <strong>{{ item.name }}</strong>
          <small v-if="item.note">{{ item.note }}</small>
        </span>
        <span class="gi-qty">
          <button v-if="editable" type="button" class="gi-mini" :aria-label="`${item.name} −1`" @click="changeQty(index, -1)">−</button>
          <b>×{{ item.qty }}</b>
          <button v-if="editable" type="button" class="gi-mini" :aria-label="`${item.name} +1`" @click="changeQty(index, 1)">+</button>
        </span>
      </li>
      <li v-if="!items.length" class="gi-empty">{{ x.progress.emptyBag }}</li>
    </ul>
    <form v-if="editable" class="gi-add" @submit.prevent="add">
      <input v-model="draftName" class="gi-input gi-grow" maxlength="80" :placeholder="x.progress.itemName" :aria-label="x.progress.itemName" />
      <input v-model.number="draftQty" class="gi-input gi-n" type="number" min="1" max="9999" :aria-label="x.progress.qty" />
      <input v-model="draftNote" class="gi-input gi-grow" maxlength="160" :placeholder="x.progress.itemNote" :aria-label="x.progress.itemNote" />
      <button type="submit" class="gi-btn" :disabled="!draftName.trim() || items.length >= 60">{{ x.progress.addItem }}</button>
    </form>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import type { Coins, InventoryItem } from "../../../../src/shared/hero-builder.js";
import type { DndText } from "../../game/dnd-text.js";

const props = defineProps<{ x: DndText; items: InventoryItem[]; coins: Coins; editable: boolean }>();
const emit = defineEmits<{ change: [items: InventoryItem[], coins: Coins] }>();

const COINS = [{ id: "gp" }, { id: "sp" }, { id: "cp" }] as const;
const draftName = ref("");
const draftQty = ref(1);
const draftNote = ref("");

function setCoin(id: keyof Coins, event: Event): void {
  const value = Math.max(0, Math.min(9_999_999, Math.floor(Number((event.target as HTMLInputElement).value) || 0)));
  emit("change", props.items, { ...props.coins, [id]: value });
}
/** Down to zero removes the line. */
function changeQty(index: number, delta: number): void {
  const items = props.items.map(item => ({ ...item }));
  const item = items[index]!;
  item.qty = Math.min(9999, item.qty + delta);
  emit("change", item.qty > 0 ? items : items.filter((_, at) => at !== index), props.coins);
}
function add(): void {
  const name = draftName.value.trim();
  if (!name) return;
  const note = draftNote.value.trim();
  const qty = Math.max(1, Math.min(9999, Math.floor(draftQty.value) || 1));
  emit("change", [...props.items, { name, qty, ...(note ? { note } : {}) }], props.coins);
  draftName.value = "";
  draftNote.value = "";
  draftQty.value = 1;
}
</script>

<style scoped>
.gi { display: flex; flex-direction: column; gap: 10px; }
.gi-coins { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
.gi-coin { display: flex; align-items: center; gap: 6px; padding: 4px 8px; border-radius: 10px; background: var(--gm-raised, #23252b); }
.gi-coin-dot { width: 12px; height: 12px; flex: none; border-radius: 50%; background: #d9b46c; box-shadow: inset 0 -2px 0 rgba(0, 0, 0, .3); }
.gi-coin-sp .gi-coin-dot { background: #c9ccd2; }
.gi-coin-cp .gi-coin-dot { background: #c17a4a; }
.gi-coin input { width: 100%; min-width: 0; padding: 4px 0; border: 0; background: transparent; color: var(--gm-text, #e8e6e1); font: inherit; font-weight: 700; }
.gi-coin input:focus { outline: none; }
.gi-coin:focus-within { box-shadow: 0 0 0 2px var(--gm-gold, #d9b46c); }
.gi-coin small { color: var(--gm-muted, #a9a6a0); font-size: 11px; }
.gi-list { display: flex; flex-direction: column; gap: 4px; margin: 0; padding: 0; list-style: none; }
.gi-item { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 8px; background: var(--gm-raised, #23252b); }
.gi-name { display: flex; flex-direction: column; flex: 1 1 auto; min-width: 0; font-size: 13px; line-height: 1.3; }
.gi-name small { color: var(--gm-muted, #a9a6a0); }
.gi-qty { display: inline-flex; align-items: center; gap: 4px; }
.gi-qty b { min-width: 34px; text-align: center; font-size: 13px; }
.gi-mini { width: 24px; height: 24px; border-radius: 6px; border: 1px solid var(--gm-line-2, #3a3c44); background: transparent; color: var(--gm-text, #e8e6e1); font: inherit; cursor: pointer; }
.gi-empty { color: var(--gm-muted, #a9a6a0); font-size: 13px; }
.gi-add { display: flex; flex-wrap: wrap; gap: 6px; }
.gi-input { min-height: 32px; padding: 4px 8px; border-radius: 8px; border: 1px solid var(--gm-line-2, #3a3c44); background: var(--gm-raised, #23252b); color: var(--gm-text, #e8e6e1); font: inherit; font-size: 13px; }
.gi-grow { flex: 1 1 120px; min-width: 0; }
.gi-n { width: 60px; }
.gi-btn { min-height: 32px; padding: 0 12px; border-radius: 8px; border: 1px solid var(--gm-gold, #d9b46c); background: transparent; color: var(--gm-gold, #d9b46c); font: inherit; font-size: 13px; cursor: pointer; }
.gi-btn:disabled { opacity: .45; cursor: default; }
button:focus-visible, .gi-input:focus-visible { outline: 2px solid var(--gm-gold, #d9b46c); outline-offset: 1px; }
</style>
