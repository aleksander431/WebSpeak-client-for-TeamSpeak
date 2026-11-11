<template>
  <div class="hb" data-ws-part="voice.game.builder" role="dialog" aria-modal="true" :aria-label="t.title" @keydown.esc.stop.prevent="emit('cancel')">
    <div class="hb-frame">
      <header class="hb-head">
        <h2 class="hb-title">{{ editing ? t.editTitle : t.title }}</h2>
        <ol class="hb-steps">
          <li v-for="(label, index) in t.steps" :key="label">
            <button
              type="button"
              :class="['hb-step', { 'hb-step-on': step === index, 'hb-step-done': index < step }]"
              :disabled="index > furthest"
              :aria-current="step === index ? 'step' : undefined"
              @click="step = index"
            ><span class="hb-step-num">{{ index + 1 }}</span>{{ label }}</button>
          </li>
        </ol>
      </header>

      <div class="hb-body">
        <section ref="stepPane" class="hb-pane" :aria-label="t.steps[step]">
          <!-- 1. Race -->
          <template v-if="step === 0">
            <div class="hb-grid">
              <button v-for="item in RACES" :key="item.id" type="button" :class="['hb-card', { 'hb-card-on': draft.race === item.id }]" :aria-pressed="draft.race === item.id" @click="pickRace(item.id)">
                <strong class="hb-card-name">{{ item.name }}</strong>
                <span class="hb-card-meta">{{ bonusLine(item.bonuses) }} · {{ x.speed }} {{ item.speed }}</span>
                <span class="hb-card-blurb">{{ item.blurb }}</span>
              </button>
            </div>
            <div v-if="draft.race === 'dragonborn'" class="hb-block">
              <h3>{{ t.ancestry }}</h3>
              <div class="hb-chips">
                <button v-for="item in DRAGON_ANCESTRIES" :key="item.id" type="button" :class="['hb-chip', { 'hb-chip-on': draft.ancestry === item.id }]" :aria-pressed="draft.ancestry === item.id" @click="draft.ancestry = item.id">
                  {{ item.name }} <span class="hb-dim">· {{ item.damage }}</span>
                </button>
              </div>
            </div>
          </template>

          <!-- 2. Class -->
          <template v-else-if="step === 1">
            <div class="hb-grid">
              <button v-for="item in CLASSES" :key="item.id" type="button" :class="['hb-card', { 'hb-card-on': draft.cls === item.id }]" :aria-pressed="draft.cls === item.id" @click="pickClass(item.id)">
                <strong class="hb-card-name">{{ item.name }}</strong>
                <span class="hb-card-meta">{{ t.hitDie }} {{ diePrefix }}{{ item.hitDie }} · {{ item.primary.slice(0, 2).map(a => x.abilityShort[a]).join(", ") }}</span>
                <span class="hb-card-blurb">{{ item.blurb }}</span>
              </button>
            </div>
            <div v-if="draft.cls === 'fighter'" class="hb-block">
              <h3>{{ t.fightingStyle }}</h3>
              <div class="hb-chips">
                <button type="button" :class="['hb-chip', { 'hb-chip-on': draft.fightingStyle === 'defense' }]" :aria-pressed="draft.fightingStyle === 'defense'" @click="draft.fightingStyle = 'defense'">{{ t.styleDefense }}</button>
                <button type="button" :class="['hb-chip', { 'hb-chip-on': draft.fightingStyle === 'archery' }]" :aria-pressed="draft.fightingStyle === 'archery'" @click="draft.fightingStyle = 'archery'">{{ t.styleArchery }}</button>
              </div>
            </div>
          </template>

          <!-- 3. Abilities -->
          <template v-else-if="step === 2">
            <div class="hb-row">
              <div class="hb-seg" role="radiogroup" :aria-label="t.method">
                <button type="button" role="radio" :aria-checked="draft.method === 'array'" :class="['hb-seg-btn', { 'hb-seg-on': draft.method === 'array' }]" @click="setMethod('array')">{{ t.methodArray }}</button>
                <button type="button" role="radio" :aria-checked="draft.method === 'pointbuy'" :class="['hb-seg-btn', { 'hb-seg-on': draft.method === 'pointbuy' }]" @click="setMethod('pointbuy')">{{ t.methodPointBuy }}</button>
              </div>
              <button v-if="draft.cls" type="button" class="hb-btn hb-btn-quiet" @click="useSuggested">{{ t.suggested }}</button>
              <span v-if="draft.method === 'pointbuy'" :class="['hb-points', { 'hb-bad': pointsLeft < 0 }]">{{ t.pointsLeft }}: <strong>{{ pointsLeft }}</strong></span>
            </div>
            <p v-if="draft.method === 'array'" class="hb-dim hb-small">{{ t.arrayHint }}</p>
            <table class="hb-abilities">
              <thead><tr><th></th><th>{{ t.base }}</th><th>{{ t.racial }}</th><th>{{ t.total }}</th><th></th></tr></thead>
              <tbody>
                <tr v-for="ability in ABILITIES" :key="ability" :class="{ 'hb-primary': classInfo?.primary.slice(0, 2).includes(ability) }">
                  <th scope="row">{{ x.abilityName[ability] }}</th>
                  <td>
                    <button v-if="draft.method === 'array'" type="button" :class="['hb-score', { 'hb-score-on': swapFrom === ability }]" :aria-pressed="swapFrom === ability" :aria-label="`${x.abilityName[ability]} ${draft.abilities[ability]}`" @click="swap(ability)">{{ draft.abilities[ability] }}</button>
                    <span v-else class="hb-stepper">
                      <button type="button" class="hb-mini" :disabled="draft.abilities[ability] <= 8" :aria-label="`${x.abilityName[ability]} −1`" @click="bump(ability, -1)">−</button>
                      <strong>{{ draft.abilities[ability] }}</strong>
                      <button type="button" class="hb-mini" :disabled="!canRaise(ability)" :aria-label="`${x.abilityName[ability]} +1`" @click="bump(ability, 1)">+</button>
                    </span>
                  </td>
                  <td class="hb-dim">{{ racialBonus(ability) ? `+${racialBonus(ability)}` : "—" }}</td>
                  <td><strong>{{ totals[ability] }}</strong></td>
                  <td class="hb-mod">{{ formatModifier(abilityModifier(totals[ability])) }}</td>
                </tr>
              </tbody>
            </table>
            <div v-if="draft.race === 'half-elf'" class="hb-block">
              <h3>{{ t.halfElfAbilities }}</h3>
              <div class="hb-chips">
                <button v-for="ability in HALF_ELF_ABILITIES" :key="ability" type="button" :class="['hb-chip', { 'hb-chip-on': draft.bonusAbilities.includes(ability) }]" :aria-pressed="draft.bonusAbilities.includes(ability)" :disabled="!draft.bonusAbilities.includes(ability) && draft.bonusAbilities.length >= 2" @click="toggle(draft.bonusAbilities, ability, 2)">{{ x.abilityName[ability] }}</button>
              </div>
            </div>
          </template>

          <!-- 4. Skills -->
          <template v-else-if="step === 3">
            <div v-if="raceSkills.length" class="hb-block">
              <h3>{{ t.raceSkills }}</h3>
              <div class="hb-chips"><span v-for="skill in raceSkills" :key="skill" class="hb-chip hb-chip-fixed">{{ x.skillName[skill] }}</span></div>
            </div>
            <div class="hb-block">
              <h3>{{ t.classSkills }} <span class="hb-count">{{ draft.classSkills.length }}/{{ classInfo?.skillCount ?? 0 }}</span></h3>
              <div class="hb-chips">
                <button v-for="skill in classSkillOptions" :key="skill" type="button" :class="['hb-chip', { 'hb-chip-on': draft.classSkills.includes(skill) }]" :aria-pressed="draft.classSkills.includes(skill)" :disabled="!draft.classSkills.includes(skill) && (draft.classSkills.length >= (classInfo?.skillCount ?? 0) || takenElsewhere(skill, 'class'))" @click="toggle(draft.classSkills, skill, classInfo?.skillCount ?? 0)">
                  {{ x.skillName[skill] }} <span class="hb-dim">{{ x.abilityShort[SKILLS[skill]] }}</span>
                </button>
              </div>
            </div>
            <div class="hb-block">
              <h3>{{ t.backgroundSkills }} <span class="hb-count">{{ draft.backgroundSkills.length }}/2</span></h3>
              <div class="hb-chips">
                <button v-for="skill in SKILL_IDS" :key="skill" type="button" :class="['hb-chip', { 'hb-chip-on': draft.backgroundSkills.includes(skill) }]" :aria-pressed="draft.backgroundSkills.includes(skill)" :disabled="!draft.backgroundSkills.includes(skill) && (draft.backgroundSkills.length >= 2 || takenElsewhere(skill, 'background'))" @click="toggle(draft.backgroundSkills, skill, 2)">
                  {{ x.skillName[skill] }} <span class="hb-dim">{{ x.abilityShort[SKILLS[skill]] }}</span>
                </button>
              </div>
            </div>
            <div v-if="draft.race === 'half-elf'" class="hb-block">
              <h3>{{ t.halfElfSkills }} <span class="hb-count">{{ draft.bonusSkills.length }}/2</span></h3>
              <div class="hb-chips">
                <button v-for="skill in SKILL_IDS" :key="skill" type="button" :class="['hb-chip', { 'hb-chip-on': draft.bonusSkills.includes(skill) }]" :aria-pressed="draft.bonusSkills.includes(skill)" :disabled="!draft.bonusSkills.includes(skill) && (draft.bonusSkills.length >= 2 || takenElsewhere(skill, 'bonus'))" @click="toggle(draft.bonusSkills, skill, 2)">
                  {{ x.skillName[skill] }}
                </button>
              </div>
            </div>
            <div v-if="draft.cls === 'rogue'" class="hb-block">
              <h3>{{ t.expertise }} <span class="hb-count">{{ draft.expertise.length }}/2</span></h3>
              <div class="hb-chips">
                <button v-for="skill in proficientSkills" :key="skill" type="button" :class="['hb-chip', { 'hb-chip-on': draft.expertise.includes(skill) }]" :aria-pressed="draft.expertise.includes(skill)" :disabled="!draft.expertise.includes(skill) && draft.expertise.length >= 2" @click="toggle(draft.expertise, skill, 2)">
                  {{ x.skillName[skill] }}
                </button>
              </div>
            </div>
          </template>

          <!-- 5. Looks -->
          <template v-else>
            <label class="hb-field">
              <span>{{ t.name }}</span>
              <input ref="nameInput" v-model="draft.name" class="hb-input" maxlength="40" :placeholder="t.namePlaceholder" autocomplete="off" />
            </label>
            <div class="hb-block">
              <h3>{{ t.portrait }}</h3>
              <div class="hb-portraits">
                <button v-for="item in portraitOrder" :key="item.id" type="button" :class="['hb-portrait', { 'hb-portrait-on': draft.portrait === item.id }]" :aria-pressed="draft.portrait === item.id" :aria-label="item.id" @click="draft.portrait = item.id">
                  <img :src="heroPortraitUrl(item.id)" alt="" loading="lazy" />
                </button>
                <button type="button" :class="['hb-portrait', 'hb-portrait-none', { 'hb-portrait-on': !draft.portrait }]" :aria-pressed="!draft.portrait" @click="draft.portrait = ''">{{ t.portraitNone }}</button>
              </div>
            </div>
            <label class="hb-field">
              <span>{{ t.story }}</span>
              <textarea v-model="draft.story" class="hb-input hb-textarea" maxlength="600" rows="3" :placeholder="t.storyPlaceholder"></textarea>
            </label>
          </template>
        </section>

        <aside class="hb-sheet" :aria-label="t.preview">
          <div class="hb-sheet-head">
            <img v-if="preview?.portrait" class="hb-avatar" :src="preview.portrait" alt="" />
            <span v-else class="hb-avatar hb-avatar-empty">{{ (draft.name.trim() || "?").slice(0, 1).toUpperCase() }}</span>
            <span class="hb-sheet-title">
              <strong class="hb-sheet-name">{{ draft.name.trim() || t.namePlaceholder }}</strong>
              <span class="hb-dim">{{ [raceInfo?.name, classInfo?.name, t.level1].filter(Boolean).join(" · ") }}</span>
            </span>
          </div>
          <template v-if="preview">
            <div class="hb-vitals">
              <span><small>{{ x.hp }}</small><strong>{{ preview.maxHp }}</strong></span>
              <span><small>{{ x.ac }}</small><strong>{{ preview.ac }}</strong></span>
              <span><small>{{ x.speed }}</small><strong>{{ preview.speed }}</strong></span>
            </div>
            <div class="hb-stats">
              <span v-for="ability in ABILITIES" :key="ability" :class="{ 'hb-save': preview.saves.includes(ability) }" :title="preview.saves.includes(ability) ? t.saves : undefined">
                <small>{{ x.abilityShort[ability] }}</small>
                <strong>{{ formatModifier(abilityModifier(preview.abilities[ability])) }}</strong>
                <em>{{ preview.abilities[ability] }}</em>
              </span>
            </div>
            <div class="hb-sheet-block">
              <h4>{{ t.skills }}</h4>
              <p class="hb-skill-list">
                <span v-for="skill in preview.skills" :key="skill">{{ x.skillName[skill] }} <strong>{{ formatModifier(skillBonus(preview, skill)) }}</strong><template v-if="preview.expertise?.includes(skill)"> ★</template></span>
              </p>
            </div>
            <div class="hb-sheet-block">
              <h4>{{ t.attacks }}</h4>
              <ul class="hb-list">
                <li v-for="attack in preview.attacks" :key="attack.name">
                  <strong>{{ attack.name }}</strong>
                  <span>{{ attack.bonus === null ? "" : `${formatModifier(attack.bonus)} · ` }}{{ dice(attack.damage) }}</span>
                  <small class="hb-dim">{{ attack.note }}</small>
                </li>
              </ul>
            </div>
            <div class="hb-sheet-block">
              <h4>{{ t.features }}</h4>
              <ul class="hb-list hb-list-plain"><li v-for="feature in preview.features" :key="feature">{{ feature }}</li></ul>
            </div>
            <div v-if="preview.spells?.length" class="hb-sheet-block">
              <h4>{{ t.spells }}</h4>
              <ul class="hb-list hb-list-plain"><li v-for="spell in preview.spells" :key="spell">{{ spell }}</li></ul>
            </div>
            <div class="hb-sheet-block">
              <h4>{{ t.equipment }}</h4>
              <p class="hb-small">{{ preview.equipment.join(", ") }}</p>
            </div>
          </template>
        </aside>
      </div>

      <footer class="hb-foot">
        <p v-if="error" class="hb-error" role="alert">{{ error }}</p>
        <button type="button" class="hb-btn hb-btn-quiet" @click="emit('cancel')">{{ t.cancel }}</button>
        <span class="hb-spacer"></span>
        <button v-if="step > 0" type="button" class="hb-btn" @click="step -= 1">{{ t.back }}</button>
        <button v-if="step < LAST_STEP" type="button" class="hb-btn hb-btn-gold" :disabled="!stepValid[step]" @click="goNext">{{ t.next }}</button>
        <template v-else>
          <button type="button" class="hb-btn" :disabled="!allValid" @click="finish(false)">{{ t.saveOnly }}</button>
          <button v-if="canPlay" type="button" class="hb-btn hb-btn-gold" :disabled="!allValid" @click="finish(true)">{{ t.save }}</button>
        </template>
      </footer>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from "vue";
import {
  CLASSES, DRAGON_ANCESTRIES, HERO_PORTRAITS, HeroChoiceError, POINT_BUY_BUDGET, RACES, STANDARD_ARRAY,
  buildHero, findClass, findRace, finalAbilities, heroPortraitUrl, pointBuyCost, suggestedAbilities, validateHeroChoices,
  type AbilityMethod, type ClassId, type DragonAncestry, type HeroChoices, type RaceId,
} from "../../../../src/shared/hero-builder.js";
import { ABILITIES, SKILLS, SKILL_IDS, abilityModifier, formatModifier, skillBonus, type Ability, type HeroSheet, type Skill } from "../../../../src/shared/tabletop.js";
import type { DndText } from "../../game/dnd-text.js";

const props = defineProps<{ x: DndText; initial?: HeroChoices | null; canPlay: boolean; diePrefix: string }>();
const emit = defineEmits<{ cancel: []; save: [choices: HeroChoices, play: boolean] }>();

const t = computed(() => props.x.builder);
const LAST_STEP = 4;
const HALF_ELF_ABILITIES = ABILITIES.filter(ability => ability !== "cha");
const editing = Boolean(props.initial);

interface Draft {
  name: string;
  race: RaceId | "";
  cls: ClassId | "";
  method: AbilityMethod;
  abilities: Record<Ability, number>;
  classSkills: Skill[];
  backgroundSkills: Skill[];
  bonusAbilities: Ability[];
  bonusSkills: Skill[];
  expertise: Skill[];
  fightingStyle: "defense" | "archery" | "";
  ancestry: DragonAncestry | "";
  portrait: string;
  story: string;
}

const start = props.initial;
const draft = reactive<Draft>({
  name: start?.name ?? "",
  race: start?.race ?? "",
  cls: start?.cls ?? "",
  method: start?.method ?? "array",
  abilities: start ? { ...start.abilities } : { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 },
  classSkills: [...(start?.classSkills ?? [])],
  backgroundSkills: [...(start?.backgroundSkills ?? [])],
  bonusAbilities: [...(start?.bonusAbilities ?? [])],
  bonusSkills: [...(start?.bonusSkills ?? [])],
  expertise: [...(start?.expertise ?? [])],
  fightingStyle: start?.fightingStyle ?? "",
  ancestry: start?.ancestry ?? "",
  portrait: start?.portrait ?? "",
  story: start?.story ?? "",
});
const step = ref(0);
const furthest = ref(start ? LAST_STEP : 0);
const abilitiesTouched = ref(Boolean(start));
const swapFrom = ref<Ability | null>(null);
const error = ref("");
const nameInput = ref<HTMLInputElement | null>(null);
const stepPane = ref<HTMLElement | null>(null);

const raceInfo = computed(() => findRace(draft.race));
const classInfo = computed(() => findClass(draft.cls));
const raceSkills = computed<Skill[]>(() => raceInfo.value?.skills ?? []);
const classSkillOptions = computed<Skill[]>(() => classInfo.value?.skillList.length ? classInfo.value.skillList : SKILL_IDS);
const totals = computed(() => finalAbilities({ race: (draft.race || "human") as RaceId, abilities: draft.abilities, bonusAbilities: draft.bonusAbilities }));
const pointsLeft = computed(() => POINT_BUY_BUDGET - pointBuyCost(draft.abilities));
const proficientSkills = computed<Skill[]>(() => [...raceSkills.value, ...draft.classSkills, ...draft.backgroundSkills, ...(draft.race === "half-elf" ? draft.bonusSkills : [])]);

function racialBonus(ability: Ability): number {
  const base = raceInfo.value?.bonuses[ability] ?? 0;
  return base + (draft.race === "half-elf" && draft.bonusAbilities.includes(ability) ? 1 : 0);
}
function bonusLine(bonuses: Partial<Record<Ability, number>>): string {
  const entries = ABILITIES.filter(ability => bonuses[ability]);
  if (entries.length === 6) return `+1 ${props.x.abilityShort.str}…${props.x.abilityShort.cha}`;
  return entries.map(ability => `+${bonuses[ability]} ${props.x.abilityShort[ability]}`).join(" ");
}
const dice = (expression: string) => expression.replace(/d/g, props.diePrefix);

/** Choices as the gateway will see them (only the fields that apply). */
const choices = computed<HeroChoices | null>(() => {
  if (!draft.race || !draft.cls) return null;
  const result: HeroChoices = {
    name: draft.name.trim(), race: draft.race, cls: draft.cls, method: draft.method, abilities: { ...draft.abilities },
    classSkills: [...draft.classSkills], backgroundSkills: [...draft.backgroundSkills],
  };
  if (draft.race === "half-elf") { result.bonusAbilities = [...draft.bonusAbilities]; result.bonusSkills = [...draft.bonusSkills]; }
  if (draft.cls === "rogue") result.expertise = [...draft.expertise];
  if (draft.cls === "fighter" && draft.fightingStyle) result.fightingStyle = draft.fightingStyle;
  if (draft.race === "dragonborn" && draft.ancestry) result.ancestry = draft.ancestry;
  if (draft.portrait) result.portrait = draft.portrait;
  if (draft.story.trim()) result.story = draft.story.trim();
  // Editing a hero keeps what it earned: level, experience, improvements and belongings.
  if (start) {
    if (start.level && start.level > 1) result.level = start.level;
    if (start.xp) result.xp = start.xp;
    if (start.asi) result.asi = [...start.asi];
    if (start.inventory) result.inventory = start.inventory.map(item => ({ ...item }));
    if (start.coins) result.coins = { ...start.coins };
    if (draft.cls === "bard" && start.cls === "bard" && start.expertise?.length) result.expertise = [...start.expertise];
  }
  return result;
});

/** The live sheet: built with the same code the gateway runs. */
const preview = computed<HeroSheet | null>(() => {
  if (!choices.value) return null;
  try {
    return buildHero({ ...choices.value, ancestry: choices.value.ancestry ?? (draft.race === "dragonborn" ? "red" : undefined), fightingStyle: choices.value.fightingStyle ?? (draft.cls === "fighter" ? "defense" : undefined) }, "preview", heroPortraitUrl);
  } catch {
    return null;
  }
});

const stepValid = computed(() => [
  Boolean(draft.race) && (draft.race !== "dragonborn" || Boolean(draft.ancestry)),
  Boolean(draft.cls) && (draft.cls !== "fighter" || Boolean(draft.fightingStyle)),
  (draft.method === "array" || pointsLeft.value >= 0) && (draft.race !== "half-elf" || draft.bonusAbilities.length === 2),
  draft.classSkills.length === (classInfo.value?.skillCount ?? -1) && draft.backgroundSkills.length === 2
    && (draft.race !== "half-elf" || draft.bonusSkills.length === 2) && (draft.cls !== "rogue" || draft.expertise.length === 2),
  Boolean(draft.name.trim()),
]);
const allValid = computed(() => stepValid.value.every(Boolean));

const portraitOrder = computed(() => {
  const own = HERO_PORTRAITS.filter(item => item.race === draft.race);
  return [...own, ...HERO_PORTRAITS.filter(item => item.race !== draft.race)];
});

function pickRace(id: RaceId): void {
  if (draft.race === id) return;
  draft.race = id;
  if (id !== "dragonborn") draft.ancestry = "";
  if (id !== "half-elf") { draft.bonusAbilities = []; draft.bonusSkills = []; }
  const granted = findRace(id)?.skills ?? [];
  draft.classSkills = draft.classSkills.filter(skill => !granted.includes(skill));
  draft.backgroundSkills = draft.backgroundSkills.filter(skill => !granted.includes(skill));
  pruneExpertise();
  const current = HERO_PORTRAITS.find(item => item.id === draft.portrait);
  if (!current || current.race !== id) draft.portrait = HERO_PORTRAITS.find(item => item.race === id)?.id ?? "";
}
function pickClass(id: ClassId): void {
  if (draft.cls === id) return;
  draft.cls = id;
  const info = findClass(id)!;
  draft.classSkills = draft.classSkills.filter(skill => !info.skillList.length || info.skillList.includes(skill)).slice(0, info.skillCount);
  if (id !== "fighter") draft.fightingStyle = "";
  if (id !== "rogue") draft.expertise = [];
  if (!abilitiesTouched.value) draft.abilities = draft.method === "array" ? suggestedAbilities(id) : { str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8 };
}
function setMethod(method: AbilityMethod): void {
  if (draft.method === method) return;
  draft.method = method;
  swapFrom.value = null;
  draft.abilities = method === "array"
    ? (draft.cls ? suggestedAbilities(draft.cls) : { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 })
    : { str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8 };
}
function useSuggested(): void {
  if (!draft.cls) return;
  if (draft.method !== "array") draft.method = "array";
  draft.abilities = suggestedAbilities(draft.cls);
  abilitiesTouched.value = true;
}
function swap(ability: Ability): void {
  if (!swapFrom.value) { swapFrom.value = ability; return; }
  const from = swapFrom.value;
  swapFrom.value = null;
  if (from === ability) return;
  [draft.abilities[from], draft.abilities[ability]] = [draft.abilities[ability], draft.abilities[from]];
  abilitiesTouched.value = true;
}
function canRaise(ability: Ability): boolean {
  if (draft.abilities[ability] >= 15) return false;
  return pointBuyCost({ ...draft.abilities, [ability]: draft.abilities[ability] + 1 }) <= POINT_BUY_BUDGET;
}
function bump(ability: Ability, delta: number): void {
  draft.abilities[ability] = Math.min(15, Math.max(8, draft.abilities[ability] + delta));
  abilitiesTouched.value = true;
}
function toggle<T>(list: T[], item: T, limit: number): void {
  const index = list.indexOf(item);
  if (index >= 0) list.splice(index, 1);
  else if (list.length < limit) list.push(item);
  pruneExpertise();
}
function pruneExpertise(): void {
  const owned = new Set(proficientSkills.value);
  draft.expertise = draft.expertise.filter(skill => owned.has(skill));
}
/** A skill already given by another source (the rules allow each once). */
function takenElsewhere(skill: Skill, source: "class" | "background" | "bonus"): boolean {
  if (raceSkills.value.includes(skill)) return true;
  if (source !== "class" && draft.classSkills.includes(skill)) return true;
  if (source !== "background" && draft.backgroundSkills.includes(skill)) return true;
  return source !== "bonus" && draft.race === "half-elf" && draft.bonusSkills.includes(skill);
}

function goNext(): void {
  if (!stepValid.value[step.value]) return;
  step.value += 1;
  furthest.value = Math.max(furthest.value, step.value);
}
watch(step, value => {
  error.value = "";
  void nextTick(() => {
    stepPane.value?.scrollTo?.({ top: 0 });
    if (value === LAST_STEP) nameInput.value?.focus();
  });
});
watch(() => [draft.race, draft.cls], () => { if (!editing) furthest.value = Math.min(furthest.value, step.value + 1); });

function finish(play: boolean): void {
  if (!choices.value) return;
  try {
    const valid = validateHeroChoices(choices.value);
    emit("save", valid, play);
  } catch (caught: unknown) {
    error.value = caught instanceof HeroChoiceError ? props.x.errors[caught.code] ?? props.x.errorFallback : props.x.errorFallback;
  }
}

// The array method keeps the six scores a permutation of the standard array.
if (draft.method === "array" && [...ABILITIES.map(a => draft.abilities[a])].sort((a, b) => b - a).join() !== STANDARD_ARRAY.join()) {
  draft.abilities = { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 };
}
</script>

<style scoped>
.hb {
  position: absolute;
  inset: 0;
  z-index: 20;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(8, 9, 12, .72);
  backdrop-filter: blur(3px);
}
.hb-frame {
  display: flex;
  flex-direction: column;
  width: min(1180px, 100%);
  height: min(820px, 100%);
  border-radius: 18px;
  border: 1px solid var(--gm-line-2, #3a3c44);
  background: var(--gm-bg, #141519);
  box-shadow: 0 30px 80px rgba(0, 0, 0, .5);
  overflow: hidden;
}
.hb-head { display: flex; flex-wrap: wrap; align-items: center; gap: 14px 24px; padding: 16px 22px; border-bottom: 1px solid var(--gm-line, #2a2c33); background: var(--gm-card, #1a1b20); }
.hb-title { margin: 0; font-family: "Cormorant Garamond", Georgia, serif; font-size: 28px; font-weight: 700; color: #f1e6cf; }
.hb-steps { display: flex; flex-wrap: wrap; gap: 6px; margin: 0; padding: 0; list-style: none; }
.hb-step { display: inline-flex; align-items: center; gap: 8px; min-height: 34px; padding: 0 12px 0 6px; border-radius: 999px; border: 1px solid var(--gm-line-2, #3a3c44); background: transparent; color: var(--gm-muted, #a9a6a0); font: inherit; cursor: pointer; }
.hb-step:disabled { opacity: .45; cursor: default; }
.hb-step-num { display: grid; place-items: center; width: 22px; height: 22px; border-radius: 50%; background: var(--gm-raised, #23252b); font-size: 12px; font-weight: 700; }
.hb-step-done { color: var(--gm-text, #e8e6e1); }
.hb-step-done .hb-step-num { background: var(--gm-gold-soft, #3a3020); color: var(--gm-gold, #d9b46c); }
.hb-step-on { border-color: var(--gm-gold, #d9b46c); color: var(--gm-gold, #d9b46c); }
.hb-step-on .hb-step-num { background: var(--gm-gold, #d9b46c); color: #1a1408; }

.hb-body { display: grid; grid-template-columns: minmax(0, 1fr) 340px; flex: 1 1 auto; min-height: 0; }
.hb-pane { display: flex; flex-direction: column; gap: 16px; padding: 20px 22px; overflow: auto; }
.hb-sheet { display: flex; flex-direction: column; gap: 12px; padding: 18px; border-left: 1px solid var(--gm-line, #2a2c33); background: var(--gm-card, #1a1b20); overflow: auto; }

.hb-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 10px; }
.hb-card { display: flex; flex-direction: column; gap: 4px; padding: 12px 14px; border-radius: 12px; border: 1px solid var(--gm-line, #2a2c33); background: var(--gm-raised, #23252b); color: var(--gm-text, #e8e6e1); font: inherit; text-align: left; cursor: pointer; }
.hb-card:hover { border-color: var(--gm-line-2, #3a3c44); }
.hb-card-on { border-color: var(--gm-gold, #d9b46c); background: #221f18; box-shadow: inset 0 0 0 1px var(--gm-gold, #d9b46c); }
.hb-card-name { font-family: "Cormorant Garamond", Georgia, serif; font-size: 20px; color: #f1e6cf; }
.hb-card-meta { font-size: 12px; color: var(--gm-gold, #d9b46c); }
.hb-card-blurb { font-size: 13px; line-height: 1.4; color: #c9c6bf; }

.hb-block { display: flex; flex-direction: column; gap: 8px; }
.hb-block h3 { margin: 0; font-size: 13px; font-weight: 600; letter-spacing: .02em; color: var(--gm-text, #e8e6e1); }
.hb-count { margin-left: 6px; color: var(--gm-gold, #d9b46c); font-weight: 700; }
.hb-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.hb-chip { min-height: 32px; padding: 0 12px; border-radius: 999px; border: 1px solid var(--gm-line-2, #3a3c44); background: transparent; color: var(--gm-text, #e8e6e1); font: inherit; font-size: 13px; cursor: pointer; }
.hb-chip:disabled { opacity: .35; cursor: default; }
.hb-chip-on { border-color: var(--gm-gold, #d9b46c); background: var(--gm-gold-soft, #3a3020); color: #f1e6cf; }
.hb-chip-fixed { display: inline-flex; align-items: center; border-style: dashed; color: var(--gm-gold, #d9b46c); cursor: default; }

.hb-row { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
.hb-seg { display: inline-flex; padding: 3px; border-radius: 10px; background: var(--gm-raised, #23252b); }
.hb-seg-btn { min-height: 32px; padding: 0 14px; border: 0; border-radius: 8px; background: transparent; color: var(--gm-muted, #a9a6a0); font: inherit; cursor: pointer; }
.hb-seg-on { background: var(--gm-gold, #d9b46c); color: #1a1408; font-weight: 600; }
.hb-points { margin-left: auto; color: var(--gm-muted, #a9a6a0); }
.hb-points strong { color: var(--gm-gold, #d9b46c); font-size: 18px; }
.hb-bad, .hb-bad strong { color: var(--gm-bad, #e08a8a); }
.hb-abilities { width: 100%; max-width: 560px; border-collapse: collapse; }
.hb-abilities th, .hb-abilities td { padding: 6px 8px; text-align: center; border-bottom: 1px solid var(--gm-line, #2a2c33); }
.hb-abilities thead th { font-size: 11px; font-weight: 500; text-transform: uppercase; letter-spacing: .06em; color: var(--gm-muted, #a9a6a0); }
.hb-abilities tbody th { text-align: left; font-weight: 500; }
.hb-primary tbody th, .hb-primary th { color: var(--gm-gold, #d9b46c); }
.hb-score { min-width: 52px; min-height: 36px; border-radius: 8px; border: 1px solid var(--gm-line-2, #3a3c44); background: var(--gm-raised, #23252b); color: var(--gm-text, #e8e6e1); font: inherit; font-weight: 700; cursor: pointer; }
.hb-score-on { border-color: var(--gm-gold, #d9b46c); background: var(--gm-gold-soft, #3a3020); color: var(--gm-gold, #d9b46c); }
.hb-stepper { display: inline-flex; align-items: center; gap: 10px; }
.hb-stepper strong { min-width: 22px; }
.hb-mini { width: 30px; height: 30px; border-radius: 8px; border: 1px solid var(--gm-line-2, #3a3c44); background: transparent; color: var(--gm-text, #e8e6e1); font: inherit; cursor: pointer; }
.hb-mini:disabled { opacity: .35; cursor: default; }
.hb-mod { font-weight: 700; color: var(--gm-gold, #d9b46c); }

.hb-field { display: flex; flex-direction: column; gap: 6px; font-size: 13px; font-weight: 600; }
.hb-input { min-height: 40px; padding: 8px 12px; border-radius: 10px; border: 1px solid var(--gm-line-2, #3a3c44); background: var(--gm-raised, #23252b); color: var(--gm-text, #e8e6e1); font: inherit; font-weight: 400; }
.hb-input:focus { outline: 2px solid var(--gm-gold, #d9b46c); outline-offset: 1px; }
.hb-textarea { resize: vertical; min-height: 72px; }
.hb-portraits { display: grid; grid-template-columns: repeat(auto-fill, minmax(84px, 1fr)); gap: 8px; }
.hb-portrait { aspect-ratio: 1; padding: 0; border-radius: 12px; border: 2px solid transparent; background: var(--gm-raised, #23252b); overflow: hidden; cursor: pointer; }
.hb-portrait img { display: block; width: 100%; height: 100%; object-fit: cover; }
.hb-portrait-on { border-color: var(--gm-gold, #d9b46c); box-shadow: 0 0 0 3px var(--gm-gold-soft, #3a3020); }
.hb-portrait-none { color: var(--gm-muted, #a9a6a0); font: inherit; font-size: 12px; border: 1px dashed var(--gm-line-2, #3a3c44); }

.hb-sheet-head { display: flex; gap: 12px; align-items: center; }
.hb-avatar { width: 64px; height: 64px; flex: none; border-radius: 50%; object-fit: cover; border: 2px solid var(--gm-gold, #d9b46c); }
.hb-avatar-empty { display: grid; place-items: center; background: var(--gm-raised, #23252b); color: var(--gm-gold, #d9b46c); font-family: "Cormorant Garamond", Georgia, serif; font-size: 28px; font-weight: 700; }
.hb-sheet-title { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.hb-sheet-name { font-family: "Cormorant Garamond", Georgia, serif; font-size: 22px; color: #f1e6cf; overflow-wrap: anywhere; }
.hb-vitals { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
.hb-vitals span, .hb-stats span { display: flex; flex-direction: column; align-items: center; gap: 1px; padding: 6px 4px; border-radius: 10px; background: var(--gm-raised, #23252b); }
.hb-vitals small, .hb-stats small { font-size: 10px; letter-spacing: .06em; text-transform: uppercase; color: var(--gm-muted, #a9a6a0); }
.hb-vitals strong { font-size: 20px; }
.hb-stats { display: grid; grid-template-columns: repeat(6, 1fr); gap: 4px; }
.hb-stats strong { font-size: 16px; }
.hb-stats em { font-size: 11px; font-style: normal; color: var(--gm-muted, #a9a6a0); }
.hb-save { box-shadow: inset 0 0 0 1px var(--gm-gold, #d9b46c); }
.hb-sheet-block h4 { margin: 0 0 4px; font-size: 11px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--gm-gold, #d9b46c); }
.hb-skill-list { display: flex; flex-wrap: wrap; gap: 4px 12px; margin: 0; font-size: 13px; }
.hb-list { display: flex; flex-direction: column; gap: 6px; margin: 0; padding: 0; list-style: none; font-size: 13px; }
.hb-list li { display: flex; flex-direction: column; gap: 1px; }
.hb-list-plain li { display: list-item; margin-left: 16px; list-style: disc; color: #c9c6bf; line-height: 1.35; }

.hb-foot { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 12px 22px; border-top: 1px solid var(--gm-line, #2a2c33); background: var(--gm-card, #1a1b20); }
.hb-spacer { flex: 1 1 auto; }
.hb-error { flex-basis: 100%; margin: 0; color: var(--gm-bad, #e08a8a); }
.hb-btn { min-height: 40px; padding: 0 16px; border-radius: 10px; border: 1px solid var(--gm-line-2, #3a3c44); background: transparent; color: var(--gm-text, #e8e6e1); font: inherit; cursor: pointer; }
.hb-btn:disabled { opacity: .45; cursor: default; }
.hb-btn-gold { border-color: var(--gm-gold, #d9b46c); background: var(--gm-gold, #d9b46c); color: #1a1408; font-weight: 600; }
.hb-btn-gold:hover:not(:disabled) { background: #e8c77f; }
.hb-btn-quiet { border-color: transparent; color: var(--gm-muted, #a9a6a0); }
.hb-dim { color: var(--gm-muted, #a9a6a0); }
.hb-small { margin: 0; font-size: 12px; line-height: 1.4; }
button:focus-visible { outline: 2px solid var(--gm-gold, #d9b46c); outline-offset: 2px; }

@media (max-width: 900px) {
  .hb { padding: 0; }
  .hb-frame { border-radius: 0; height: 100%; }
  .hb-body { grid-template-columns: 1fr; overflow: auto; }
  .hb-pane { overflow: visible; }
  .hb-sheet { border-left: 0; border-top: 1px solid var(--gm-line, #2a2c33); overflow: visible; }
}
</style>
