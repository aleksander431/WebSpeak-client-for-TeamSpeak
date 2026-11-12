<template>
  <aside class="gh" data-ws-part="voice.game.help" role="dialog" :aria-label="help.title" @keydown.esc.stop.prevent="emit('close')">
    <header class="gh-head">
      <h2 class="gh-title">📜 {{ help.title }}</h2>
      <button ref="closeButton" type="button" class="gh-close" :aria-label="x.close" @click="emit('close')">×</button>
    </header>
    <input v-model="query" class="gh-search" type="search" :placeholder="help.search" :aria-label="help.search" />
    <nav v-if="!query.trim()" class="gh-tabs" :aria-label="help.title">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        type="button"
        :class="['gh-tab', { 'gh-tab-on': current === tab.id, 'gh-tab-now': tab.id === 'now' }]"
        :aria-current="current === tab.id ? 'page' : undefined"
        @click="current = tab.id"
      ><span aria-hidden="true">{{ tab.icon }}</span>{{ tab.title }}</button>
    </nav>

    <div ref="body" class="gh-body">
      <!-- Search across every section -->
      <template v-if="query.trim()">
        <p v-if="!found.length" class="gh-muted">{{ help.nothing }}</p>
        <section v-for="hit in found" :key="hit.id" class="gh-hit">
          <button type="button" class="gh-hit-title" @click="openFromSearch(hit.id)">{{ hit.icon }} {{ hit.title }} →</button>
          <template v-for="(block, index) in hit.blocks" :key="index">
            <HelpBlockView :block="block" />
          </template>
        </section>
      </template>

      <!-- What is happening now -->
      <template v-else-if="current === 'now'">
        <div class="gh-now">
          <p v-for="(line, index) in nowLines" :key="index" :class="{ 'gh-now-first': index === 0 }">{{ line }}</p>
        </div>
        <div v-if="nowLinks.length" class="gh-links">
          <span class="gh-muted">{{ help.more }}:</span>
          <button v-for="link in nowLinks" :key="link.id" type="button" class="gh-chip" @click="current = link.id">{{ link.icon }} {{ link.title }}</button>
        </div>
      </template>

      <!-- Conditions -->
      <template v-else-if="current === 'conditions'">
        <p class="gh-muted">{{ help.conditionsLead }}</p>
        <dl class="gh-conditions">
          <template v-for="id in CONDITIONS" :key="id">
            <dt><span aria-hidden="true">{{ CONDITION_ICON[id] }}</span> {{ x.conditionName[id] }}</dt>
            <dd>{{ x.conditionRule[id] }}</dd>
          </template>
        </dl>
        <h3>🥱 {{ help.exhaustionTitle }}</h3>
        <ol class="gh-list">
          <li v-for="level in 6" :key="level">{{ x.care.exhaustionLevels[level] }}</li>
        </ol>
      </template>

      <!-- Fixed sections -->
      <template v-else-if="section">
        <template v-for="(block, index) in section.blocks" :key="index">
          <HelpBlockView :block="block" />
        </template>
        <template v-if="section.id === 'basics'">
          <h3>{{ help.skillsTitle }}</h3>
          <table class="gh-table">
            <tbody>
              <tr v-for="skill in SKILL_IDS" :key="skill">
                <th scope="row">{{ x.skillName[skill] }} <small>{{ x.abilityShort[SKILLS[skill]] }}</small></th>
                <td>{{ help.skills[skill] }}</td>
              </tr>
            </tbody>
          </table>
        </template>
      </template>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed, defineComponent, h, nextTick, onMounted, ref, watch, type PropType } from "vue";
import { CONDITIONS, SKILLS, SKILL_IDS, type HeroSheet, type SeatView, type TableRole, type TableView } from "../../../../src/shared/tabletop.js";
import { CONDITION_ICON } from "../../game/conditions.js";
import type { DndText } from "../../game/dnd-text.js";
import type { HelpBlock, HelpId, HelpSection, HelpText } from "../../game/help-content.js";

const props = defineProps<{
  x: DndText;
  help: HelpText;
  table: TableView | null;
  role: TableRole;
  mySeat: SeatView | null;
  myHero: HeroSheet | null;
  /** The section to show first (a "?" next to something opens its topic). */
  start: HelpId;
  /** Own hero that could level up. */
  canLevelUp: boolean;
}>();
const emit = defineEmits<{ close: [] }>();

/** One block of help text: heading, paragraph, list, table or tip. */
const HelpBlockView = defineComponent({
  props: { block: { type: Object as PropType<HelpBlock>, required: true } },
  setup(blockProps) {
    return () => {
      const block = blockProps.block;
      const nodes = [];
      if (block.h) nodes.push(h("h3", block.h));
      if (block.p) nodes.push(h("p", block.p));
      if (block.tip) nodes.push(h("p", { class: "gh-tip" }, block.tip));
      if (block.list) nodes.push(h("ul", { class: "gh-list" }, block.list.map(item => h("li", item))));
      if (block.table) {
        const [head, ...rows] = block.table;
        nodes.push(h("table", { class: "gh-table" }, [
          h("thead", [h("tr", head!.map(cell => h("th", { scope: "col" }, cell)))]),
          h("tbody", rows.map(row => h("tr", row.map((cell, index) => (index === 0 ? h("th", { scope: "row" }, cell) : h("td", cell)))))),
        ]));
      }
      return nodes;
    };
  },
});

const query = ref("");
const current = ref<HelpId>(props.start);
watch(() => props.start, value => { current.value = value; query.value = ""; });
const body = ref<HTMLElement | null>(null);
const closeButton = ref<HTMLButtonElement | null>(null);
onMounted(() => closeButton.value?.focus());
watch(current, () => { void nextTick(() => body.value?.scrollTo?.({ top: 0 })); });

const sections = computed(() => props.help.sections.filter(item => !item.gmOnly || props.role === "gm"));
const tabs = computed(() => [
  { id: "now" as HelpId, icon: "📍", title: props.help.nowTitle },
  ...sections.value.slice(0, 3).map(item => ({ id: item.id as HelpId, icon: item.icon, title: item.title })),
  { id: "conditions" as HelpId, icon: "🤢", title: props.help.conditionsTitle },
  ...sections.value.slice(3).map(item => ({ id: item.id as HelpId, icon: item.icon, title: item.title })),
]);
const section = computed<HelpSection | undefined>(() => sections.value.find(item => item.id === current.value));
const linkOf = (id: HelpId) => tabs.value.find(tab => tab.id === id);

/** Every block whose text holds the query, by section (conditions included). */
const found = computed(() => {
  const needle = query.value.trim().toLowerCase();
  if (!needle) return [];
  const hits: Array<{ id: HelpId; icon: string; title: string; blocks: HelpBlock[] }> = [];
  const text = (block: HelpBlock) => [block.h, block.p, block.tip, ...(block.list ?? []), ...(block.table?.flat() ?? [])].join(" ").toLowerCase();
  for (const item of sections.value) {
    const blocks = item.blocks.filter(block => text(block).includes(needle));
    if (item.id === "basics") {
      const skills = SKILL_IDS.filter(skill => `${props.x.skillName[skill]} ${props.help.skills[skill]}`.toLowerCase().includes(needle));
      if (skills.length) blocks.push({ table: [[props.help.skillsTitle, ""], ...skills.map(skill => [props.x.skillName[skill], props.help.skills[skill]])] });
    }
    if (blocks.length) hits.push({ id: item.id, icon: item.icon, title: item.title, blocks });
  }
  const conditions = CONDITIONS.filter(id => `${props.x.conditionName[id]} ${props.x.conditionRule[id]}`.toLowerCase().includes(needle));
  if (conditions.length) {
    hits.push({ id: "conditions", icon: "🤢", title: props.help.conditionsTitle, blocks: conditions.map(id => ({ h: `${CONDITION_ICON[id]} ${props.x.conditionName[id]}`, p: props.x.conditionRule[id] })) });
  }
  return hits;
});
function openFromSearch(id: HelpId): void {
  query.value = "";
  current.value = id;
}

/** The situation in a few sentences, most urgent first. */
const nowLines = computed<string[]>(() => {
  const now = props.help.now;
  const table = props.table;
  if (!table || props.role === "spectator") return now.spectator;
  const seat = props.mySeat;
  if (table.phase === "lobby") {
    if (props.role === "gm") return now.lobbyGm;
    if (!seat?.heroId) return now.lobbyNoHero;
    return seat.ready ? now.lobbyReady : now.lobbyNotReady;
  }
  const combat = table.combat;
  if (props.role === "gm") {
    const lines = combat ? [...now.gmCombat] : [...now.gmPlay];
    if (table.checks.length) lines.push(...now.gmChecks);
    return lines;
  }
  const lines: string[] = [];
  if (seat?.dying) lines.push(...(seat.dying.state === "dead" ? now.dead : seat.dying.state === "stable" ? now.stable : now.dying));
  const check = table.checks.find(item => seat && item.targets.includes(seat.key) && !item.done.includes(seat.key));
  if (check) lines.push(...now.checkForYou(check.label));
  if (combat) {
    const mine = combat.order.find(item => item.kind === "hero" && item.seatKey === seat?.key);
    if (combat.phase === "initiative") lines.push(...(mine && mine.initiative === null ? now.initiativeRoll : now.initiativeWait));
    else {
      const active = combat.order.find(item => item.id === combat.activeId);
      if (active && active.kind === "hero" && active.seatKey === seat?.key) lines.push(...now.yourTurn(props.myHero?.speed ?? 30));
      else lines.push(...now.otherTurn(active?.name ?? "?"));
    }
  } else if (!lines.length) {
    lines.push(...(table.map ? now.explore : now.story));
  }
  if (props.canLevelUp && !combat) lines.push(...now.levelUp);
  return lines;
});
/** Sections worth reading for the situation. */
const nowLinks = computed(() => {
  const table = props.table;
  const ids: HelpId[] = [];
  if (table?.phase === "playing" && table.combat) ids.push("turn", "combat");
  else if (props.mySeat?.dying) ids.push("combat");
  else ids.push("basics", "table");
  if (props.role === "gm") ids.unshift("gm");
  if (props.mySeat?.conditions?.length) ids.push("conditions");
  return ids.map(linkOf).filter((item): item is NonNullable<typeof item> => Boolean(item));
});
</script>

<style scoped>
.gh {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  z-index: 22;
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: min(480px, 100%);
  padding: 16px 18px;
  border-left: 1px solid var(--gm-gold, #d9b46c);
  background: linear-gradient(180deg, #1f1b14, var(--gm-card, #1a1b20) 160px);
  box-shadow: -24px 0 60px rgba(0, 0, 0, .45);
  color: var(--gm-text, #e8e6e1);
}
.gh-head { display: flex; align-items: center; gap: 10px; }
.gh-title { flex: 1 1 auto; margin: 0; font-family: "Cormorant Garamond", Georgia, serif; font-size: 26px; color: #f1e6cf; }
.gh-close { width: 36px; height: 36px; border-radius: 10px; border: 1px solid var(--gm-line-2, #3a3c44); background: transparent; color: var(--gm-text, #e8e6e1); font-size: 20px; cursor: pointer; }
.gh-search { min-height: 38px; padding: 6px 12px; border-radius: 10px; border: 1px solid var(--gm-line-2, #3a3c44); background: var(--gm-raised, #23252b); color: var(--gm-text, #e8e6e1); font: inherit; }
.gh-tabs { display: flex; flex-wrap: wrap; gap: 4px; }
.gh-tab { display: inline-flex; align-items: center; gap: 5px; min-height: 30px; padding: 0 10px; border-radius: 999px; border: 1px solid var(--gm-line-2, #3a3c44); background: transparent; color: var(--gm-muted, #a9a6a0); font: inherit; font-size: 12px; cursor: pointer; }
.gh-tab:hover { color: var(--gm-text, #e8e6e1); }
.gh-tab-on { border-color: var(--gm-gold, #d9b46c); background: var(--gm-gold-soft, #3a3020); color: #f1e6cf; }
.gh-tab-now:not(.gh-tab-on) { color: var(--gm-gold, #d9b46c); }
.gh-body { flex: 1 1 auto; min-height: 0; overflow: auto; padding-right: 4px; line-height: 1.5; font-size: 14px; }
.gh-body :deep(h3), .gh-body h3 { margin: 16px 0 6px; font-size: 13px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: var(--gm-gold, #d9b46c); }
.gh-body :deep(p) { margin: 6px 0; }
.gh-body :deep(.gh-tip) { margin: 10px 0; padding: 10px 12px; border-left: 3px solid var(--gm-gold, #d9b46c); border-radius: 0 10px 10px 0; background: rgba(217, 180, 108, .1); color: #f1e6cf; }
.gh-body :deep(.gh-list) { margin: 6px 0; padding-left: 20px; }
.gh-body :deep(.gh-list li) { margin: 3px 0; }
.gh-body :deep(.gh-table) { width: 100%; margin: 6px 0; border-collapse: collapse; font-size: 13px; }
.gh-body :deep(.gh-table th), .gh-body :deep(.gh-table td) { padding: 5px 8px; border-bottom: 1px solid var(--gm-line, #2a2c33); text-align: left; vertical-align: top; }
.gh-body :deep(.gh-table thead th) { font-size: 11px; letter-spacing: .05em; text-transform: uppercase; color: var(--gm-muted, #a9a6a0); }
.gh-body :deep(.gh-table tbody th) { font-weight: 600; white-space: nowrap; }
.gh-body :deep(.gh-table small) { color: var(--gm-muted, #a9a6a0); font-weight: 400; }
.gh-now { display: flex; flex-direction: column; gap: 6px; padding: 12px 14px; border-radius: 14px; border: 1px solid var(--gm-gold, #d9b46c); background: rgba(217, 180, 108, .08); }
.gh-now p { margin: 0; }
.gh-now-first { font-size: 16px; font-weight: 600; color: #f1e6cf; }
.gh-links { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 12px; }
.gh-chip { min-height: 30px; padding: 0 12px; border-radius: 999px; border: 1px solid var(--gm-line-2, #3a3c44); background: var(--gm-raised, #23252b); color: var(--gm-text, #e8e6e1); font: inherit; font-size: 13px; cursor: pointer; }
.gh-chip:hover { border-color: var(--gm-gold, #d9b46c); }
.gh-muted { color: var(--gm-muted, #a9a6a0); }
.gh-conditions { display: grid; grid-template-columns: max-content 1fr; gap: 6px 12px; margin: 8px 0; }
.gh-conditions dt { font-weight: 600; white-space: nowrap; }
.gh-conditions dd { margin: 0; color: #d8d4cc; }
.gh-hit { margin-bottom: 14px; padding-bottom: 8px; border-bottom: 1px solid var(--gm-line, #2a2c33); }
.gh-hit-title { padding: 0; border: 0; background: none; color: var(--gm-gold, #d9b46c); font: inherit; font-weight: 700; cursor: pointer; }
button:focus-visible, .gh-search:focus-visible { outline: 2px solid var(--gm-gold, #d9b46c); outline-offset: 2px; }
</style>
