<template>
  <div class="hl" data-ws-part="voice.game.level-up" role="dialog" aria-modal="true" :aria-label="title" @keydown.esc.stop.prevent="emit('cancel')" @click.self="emit('cancel')">
    <form class="hl-card" @submit.prevent="confirm">
      <span class="hl-kicker">{{ x.progress.levelUp }}</span>
      <h2 class="hl-title">{{ title }}</h2>
      <div class="hl-stats">
        <span><small>{{ x.hp }}</small><b>{{ before.maxHp }} → {{ after.maxHp }}</b></span>
        <span><small>{{ x.progress.proficiency }}</small><b>+{{ proficiencyBonus(before.level) }} → +{{ proficiencyBonus(after.level) }}</b></span>
        <span><small>{{ x.care.hitDice }}</small><b>{{ before.level }} → {{ after.level }}</b></span>
      </div>
      <ul class="hl-list">
        <li v-for="line in gained" :key="line">{{ line }}</li>
      </ul>

      <fieldset v-if="needsAsi" class="hl-pick">
        <legend>{{ x.progress.asiPick }} <b>{{ asi.length }}/2</b></legend>
        <div class="hl-chips">
          <span v-for="ability in ABILITIES" :key="ability" class="hl-asi">
            <span>{{ x.abilityName[ability] }} <small>{{ scores[ability] }}</small></span>
            <button type="button" class="hl-mini" :disabled="!count(ability)" :aria-label="`${x.abilityName[ability]} −1`" @click="dropAsi(ability)">−</button>
            <b>+{{ count(ability) }}</b>
            <button type="button" class="hl-mini" :disabled="asi.length >= 2 || scores[ability] + count(ability) >= 20" :aria-label="`${x.abilityName[ability]} +1`" @click="asi.push(ability)">+</button>
          </span>
        </div>
      </fieldset>

      <fieldset v-if="needsExpertise" class="hl-pick">
        <legend>{{ x.builder.expertise }} <b>{{ expertise.length }}/2</b></legend>
        <div class="hl-chips">
          <button
            v-for="skill in before.skills"
            :key="skill"
            type="button"
            :class="['hl-chip', { 'hl-chip-on': expertise.includes(skill) }]"
            :aria-pressed="expertise.includes(skill)"
            :disabled="!expertise.includes(skill) && expertise.length >= 2"
            @click="toggleExpertise(skill)"
          >{{ x.skillName[skill] }}</button>
        </div>
      </fieldset>

      <div class="hl-actions">
        <button ref="cancelButton" type="button" class="hl-btn" @click="emit('cancel')">{{ x.cancel }}</button>
        <button type="submit" class="hl-btn hl-btn-gold" :disabled="!ready">{{ x.progress.levelUpGo }}</button>
      </div>
    </form>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { LEVEL_FEATURES, buildHero, finalAbilities, heroPortraitUrl, type HeroChoices } from "../../../../src/shared/hero-builder.js";
import { ABILITIES, proficiencyBonus, type Ability, type Skill } from "../../../../src/shared/tabletop.js";
import { dndText, type DndText } from "../../game/dnd-text.js";
import { enLine } from "../../game/en-terms.js";

const props = defineProps<{ x: DndText; choices: HeroChoices }>();
const w = (text: string) => (props.x === dndText("ru") ? text : enLine(text));
const emit = defineEmits<{ cancel: []; confirm: [choices: HeroChoices] }>();

const level = (props.choices.level ?? 1) + 1;
const needsAsi = level === 4;
const needsExpertise = level === 3 && props.choices.cls === "bard";
const asi = ref<Ability[]>([]);
const expertise = ref<Skill[]>([]);
const cancelButton = ref<HTMLButtonElement | null>(null);
onMounted(() => cancelButton.value?.focus());

const before = computed(() => buildHero(props.choices, "before", heroPortraitUrl));
const scores = computed(() => finalAbilities({ ...props.choices, level: level - 1 }));
const next = computed<HeroChoices>(() => ({
  ...props.choices,
  level,
  ...(needsAsi ? { asi: [...asi.value] } : {}),
  ...(needsExpertise ? { expertise: [...expertise.value] } : {}),
}));
const ready = computed(() => (!needsAsi || asi.value.length === 2) && (!needsExpertise || expertise.value.length === 2));
/** The sheet after the level (improvements as picked so far). */
const after = computed(() => buildHero({ ...next.value, ...(needsAsi && asi.value.length < 2 ? { asi: [] } : {}) }, "after", heroPortraitUrl));
const title = computed(() => `${props.choices.name}: ${level} ${props.x.levelShort}`);
const gained = computed(() => {
  const lines = (LEVEL_FEATURES[props.choices.cls][level] ?? []).map(w);
  const was = new Map((before.value.resources ?? []).map(item => [item.id, item.max]));
  for (const resource of after.value.resources ?? []) {
    const old = was.get(resource.id) ?? 0;
    if (resource.max > old) lines.push(`${w(resource.name)}: ${old} → ${resource.max}`);
  }
  for (const [index, attack] of after.value.attacks.entries()) {
    const old = before.value.attacks[index];
    if (old && old.damage !== attack.damage) lines.push(`${w(attack.name)}: ${old.damage} → ${attack.damage}`);
  }
  return lines;
});

const count = (ability: Ability) => asi.value.filter(item => item === ability).length;
function dropAsi(ability: Ability): void {
  const index = asi.value.lastIndexOf(ability);
  if (index >= 0) asi.value.splice(index, 1);
}
function toggleExpertise(skill: Skill): void {
  const index = expertise.value.indexOf(skill);
  if (index >= 0) expertise.value.splice(index, 1);
  else if (expertise.value.length < 2) expertise.value.push(skill);
}
function confirm(): void {
  if (ready.value) emit("confirm", next.value);
}
</script>

<style scoped>
.hl { position: absolute; inset: 0; z-index: 25; display: grid; place-items: center; padding: 24px; background: rgba(8, 9, 12, .65); }
.hl-card { display: flex; flex-direction: column; gap: 12px; width: min(520px, 100%); max-height: 100%; overflow: auto; padding: 22px; border-radius: 18px; border: 1px solid var(--gm-gold, #d9b46c); background: radial-gradient(120% 80% at 50% 0%, #2a2416, var(--gm-card, #1a1b20) 60%); box-shadow: 0 0 40px rgba(217, 180, 108, .2), 0 24px 60px rgba(0, 0, 0, .5); }
.hl-kicker { font-size: 11px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; color: var(--gm-gold, #d9b46c); }
.hl-title { margin: 0; font-family: "Cormorant Garamond", Georgia, serif; font-size: 30px; color: #f1e6cf; }
.hl-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
.hl-stats span { display: flex; flex-direction: column; align-items: center; padding: 8px; border-radius: 10px; background: var(--gm-raised, #23252b); }
.hl-stats small { font-size: 10px; letter-spacing: .06em; text-transform: uppercase; color: var(--gm-muted, #a9a6a0); }
.hl-stats b { font-size: 16px; }
.hl-list { display: flex; flex-direction: column; gap: 4px; margin: 0; padding: 0 0 0 18px; color: #e9dcc0; line-height: 1.4; }
.hl-pick { display: flex; flex-direction: column; gap: 8px; margin: 0; padding: 10px; border-radius: 12px; border: 1px solid var(--gm-line-2, #3a3c44); }
.hl-pick legend { padding: 0 6px; font-size: 13px; font-weight: 600; }
.hl-pick legend b { color: var(--gm-gold, #d9b46c); }
.hl-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.hl-asi { display: inline-flex; align-items: center; gap: 6px; padding: 4px 6px 4px 10px; border-radius: 10px; background: var(--gm-raised, #23252b); font-size: 13px; }
.hl-asi small { color: var(--gm-muted, #a9a6a0); }
.hl-asi b { min-width: 22px; text-align: center; color: var(--gm-gold, #d9b46c); }
.hl-mini { width: 26px; height: 26px; border-radius: 7px; border: 1px solid var(--gm-line-2, #3a3c44); background: transparent; color: var(--gm-text, #e8e6e1); font: inherit; cursor: pointer; }
.hl-mini:disabled { opacity: .35; cursor: default; }
.hl-chip { min-height: 30px; padding: 0 12px; border-radius: 999px; border: 1px solid var(--gm-line-2, #3a3c44); background: transparent; color: var(--gm-text, #e8e6e1); font: inherit; font-size: 13px; cursor: pointer; }
.hl-chip:disabled { opacity: .4; cursor: default; }
.hl-chip-on { border-color: var(--gm-gold, #d9b46c); background: var(--gm-gold-soft, #3a3020); }
.hl-actions { display: flex; justify-content: flex-end; gap: 8px; }
.hl-btn { min-height: 40px; padding: 0 16px; border-radius: 10px; border: 1px solid var(--gm-line-2, #3a3c44); background: transparent; color: var(--gm-text, #e8e6e1); font: inherit; cursor: pointer; }
.hl-btn:disabled { opacity: .45; cursor: default; }
.hl-btn-gold { border-color: var(--gm-gold, #d9b46c); background: var(--gm-gold, #d9b46c); color: #1a1408; font-weight: 600; }
button:focus-visible { outline: 2px solid var(--gm-gold, #d9b46c); outline-offset: 2px; }
</style>
