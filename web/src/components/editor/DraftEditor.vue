<template>
  <div class="de">
    <header class="de-top">
      <button type="button" class="de-link" @click="emit('back')">{{ t.back }}</button>
      <h1 class="de-title">{{ draft.title || t.newDraft }}</h1>
      <span :class="['de-save', `de-save-${saveState}`]" role="status">{{ saveState === "saving" ? t.saving : saveState === "failed" ? t.saveFailed : saveState === "saved" ? t.saved : "" }}</span>
    </header>

    <div class="de-body">
      <nav class="de-nav" :aria-label="t.title">
        <button
          v-for="item in SECTIONS"
          :key="item"
          type="button"
          :class="['de-nav-item', { 'de-nav-on': section === item }]"
          :aria-current="section === item ? 'page' : undefined"
          @click="section = item"
        >
          <span aria-hidden="true">{{ ICONS[item] }}</span>{{ t.sections[item] }}
          <small v-if="counts[item] !== undefined">{{ counts[item] }}</small>
        </button>
      </nav>

      <main class="de-main">
        <!-- Basics -->
        <section v-if="section === 'basics'" class="de-section">
          <p class="de-lead">{{ t.basicsLead }}</p>
          <label class="de-field"><span>{{ t.advTitle }}</span><input v-model="draft.title" class="de-input" maxlength="80" /></label>
          <label class="de-field"><span>{{ t.summary }}</span><textarea v-model="draft.summary" class="de-input" rows="3" maxlength="400"></textarea><small>{{ t.summaryHint }}</small></label>
          <div class="de-row">
            <label class="de-field"><span>{{ t.level }}</span><input v-model.number="draft.level" class="de-input" type="number" min="1" max="20" /></label>
            <label class="de-field de-grow"><span>{{ t.length }}</span><input v-model="draft.length" class="de-input" maxlength="60" :placeholder="t.lengthHint" /></label>
          </div>
        </section>

        <!-- Heroes -->
        <section v-else-if="section === 'heroes'" class="de-section">
          <p class="de-lead">{{ t.heroesLead }}</p>
          <h3>{{ t.builtinHeroes }}</h3>
          <div class="de-cards">
            <button
              v-for="hero in BUILTIN_HEROES"
              :key="hero.id"
              type="button"
              :class="['de-card', { 'de-card-on': hasBuiltinHero(hero.id) }]"
              :aria-pressed="hasBuiltinHero(hero.id)"
              @click="toggleBuiltinHero(hero.id)"
            >
              <img v-if="hero.portrait" :src="hero.portrait" alt="" />
              <span class="de-card-body"><strong>{{ hero.name }}</strong><small>{{ hero.race }} · {{ hero.cls }}</small></span>
              <span class="de-tick" aria-hidden="true">{{ hasBuiltinHero(hero.id) ? "✓" : "+" }}</span>
            </button>
          </div>
          <h3>{{ t.ownHeroes }}</h3>
          <div class="de-cards">
            <div v-for="hero in builtHeroes" :key="hero.id" class="de-card de-card-on">
              <img v-if="hero.sheet.portrait" :src="hero.sheet.portrait" alt="" />
              <span class="de-card-body"><strong>{{ hero.sheet.name }}</strong><small>{{ hero.sheet.race }} · {{ hero.sheet.cls }} · {{ hero.sheet.level }}</small></span>
              <span class="de-card-actions">
                <button type="button" class="de-link" @click="editHero(hero.id)">{{ t.editHero }}</button>
                <button type="button" class="de-link de-bad" @click="removeHero(hero.id)">{{ t.remove }}</button>
              </span>
            </div>
            <button type="button" class="de-card de-card-add" @click="editHero(null)">＋ {{ t.createHero }}</button>
          </div>
        </section>

        <!-- Monsters -->
        <section v-else-if="section === 'monsters'" class="de-section">
          <p class="de-lead">{{ t.monstersLead }}</p>
          <h3>{{ t.inAdventure }} · {{ draft.monsters.length }}</h3>
          <div class="de-list">
            <div v-for="(monster, index) in draft.monsters" :key="monster.id" class="de-monster">
              <div class="de-monster-row">
                <img v-if="monsterPortrait(monster)" :src="monsterPortrait(monster)" alt="" />
                <span v-else class="de-initial">{{ monsterSheet(monster)?.name.slice(0, 1) }}</span>
                <span class="de-card-body">
                  <strong>{{ monsterSheet(monster)?.name ?? monster.id }}</strong>
                  <small v-if="monsterSheet(monster)">{{ t.hp }} {{ monsterSheet(monster)!.maxHp }} · {{ t.ac }} {{ monsterSheet(monster)!.ac }} · {{ t.cr }} {{ monsterSheet(monster)!.cr }}</small>
                </span>
                <button v-if="monster.kind === 'custom'" type="button" class="de-link" @click="openMonster = openMonster === monster.id ? '' : monster.id">{{ openMonster === monster.id ? t.done : t.editHero }}</button>
                <button type="button" class="de-link de-bad" @click="removeMonster(index)">{{ t.remove }}</button>
              </div>
              <div v-if="monster.kind === 'custom' && openMonster === monster.id" class="de-monster-form">
                <div class="de-row">
                  <label class="de-field de-grow"><span>{{ t.monsterName }}</span><input v-model="monster.sheet.name" class="de-input" maxlength="60" /></label>
                  <label class="de-field"><span>{{ t.cr }}</span><input v-model="monster.sheet.cr" class="de-input de-short" maxlength="8" /></label>
                </div>
                <div class="de-row">
                  <label class="de-field"><span>{{ t.hp }}</span><input v-model.number="monster.sheet.maxHp" class="de-input de-short" type="number" min="1" max="999" /></label>
                  <label class="de-field"><span>{{ t.ac }}</span><input v-model.number="monster.sheet.ac" class="de-input de-short" type="number" min="1" max="30" /></label>
                  <label class="de-field"><span>{{ t.speed }}</span><input v-model.number="monster.sheet.speed" class="de-input de-short" type="number" min="0" max="200" step="5" /></label>
                  <label class="de-field"><span>{{ t.dex }}</span><input v-model.number="monster.sheet.dex" class="de-input de-short" type="number" min="1" max="30" /></label>
                </div>
                <span class="de-label">{{ t.attacks }}</span>
                <div v-for="(attack, a) in monster.sheet.attacks" :key="a" class="de-row de-attack">
                  <input v-model="attack.name" class="de-input de-grow" :placeholder="t.attackName" :aria-label="t.attackName" maxlength="60" />
                  <input :value="attack.bonus ?? ''" class="de-input de-short" type="number" :placeholder="t.bonus" :aria-label="t.bonus" @input="attack.bonus = numberOrNull(($event.target as HTMLInputElement).value)" />
                  <input v-model="attack.damage" class="de-input de-mid" :placeholder="t.damage" :aria-label="t.damage" maxlength="40" />
                  <input v-model="attack.note" class="de-input de-grow" :placeholder="t.note" :aria-label="t.note" maxlength="300" />
                  <button type="button" class="de-link de-bad" :aria-label="t.remove" @click="monster.sheet.attacks.splice(a, 1)">×</button>
                </div>
                <button v-if="monster.sheet.attacks.length < 8" type="button" class="de-btn de-btn-quiet" @click="monster.sheet.attacks.push({ name: '', bonus: 3, damage: '1d6+1', note: '' })">{{ t.addAttack }}</button>
                <label class="de-field"><span>{{ t.traits }}</span><textarea class="de-input" rows="3" :value="monster.sheet.traits.join('\n')" @input="monster.sheet.traits = ($event.target as HTMLTextAreaElement).value.split('\n').map(line => line.slice(0, 300)).filter(Boolean).slice(0, 30)"></textarea></label>
                <div class="de-row de-picture-row">
                  <img v-if="pictureUrl(monster.picture)" :src="pictureUrl(monster.picture)" alt="" class="de-thumb" />
                  <button type="button" class="de-btn" @click="pick(['monster', 'npc', 'portrait'], monster.picture, picture => { monster.picture = picture; })">{{ t.choosePicture }}</button>
                  <button v-if="monster.picture" type="button" class="de-link" @click="monster.picture = undefined">{{ t.noPicture }}</button>
                </div>
              </div>
            </div>
            <button type="button" class="de-btn" @click="addCustomMonster">＋ {{ t.customMonster }}</button>
          </div>
          <h3>{{ t.catalog }} · {{ catalogMonsters.length }}</h3>
          <div class="de-row de-filter">
            <div class="de-chips" role="radiogroup" :aria-label="t.catalog">
              <button
                v-for="item in (['all', 'monster', 'npc'] as const)"
                :key="item"
                type="button"
                role="radio"
                :aria-checked="catalogFilter === item"
                :class="['de-chip', { 'de-chip-on': catalogFilter === item }]"
                @click="catalogFilter = item"
              >{{ t.catalogFilter[item] }}</button>
            </div>
            <input v-model="monsterQuery" class="de-input de-grow" type="search" :placeholder="t.search" :aria-label="t.search" />
          </div>
          <div class="de-cards de-cards-small">
            <button
              v-for="monster in shownCatalog"
              :key="monster.id"
              type="button"
              :class="['de-card', { 'de-card-on': hasMonster(monster.id) }]"
              :disabled="hasMonster(monster.id)"
              @click="draft.monsters.push({ kind: 'catalog', id: monster.id })"
            >
              <img v-if="monster.portrait" :src="monster.portrait" alt="" loading="lazy" />
              <span class="de-card-body"><strong>{{ monster.name }}</strong><small>{{ t.cr }} {{ monster.cr }} · {{ t.hp }} {{ monster.maxHp }} · {{ t.ac }} {{ monster.ac }}</small></span>
              <span class="de-tick" aria-hidden="true">{{ hasMonster(monster.id) ? "✓" : "+" }}</span>
            </button>
          </div>
        </section>

        <!-- Scenes -->
        <section v-else-if="section === 'scenes'" class="de-section">
          <p class="de-lead">{{ t.scenesLead }}</p>
          <ol class="de-scenes">
            <li v-for="(scene, index) in draft.scenes" :key="scene.id" :class="['de-scene-tab', { 'de-scene-on': sceneId === scene.id }]">
              <button type="button" class="de-scene-pick" @click="sceneId = scene.id">
                <img v-if="scenePreview(scene)" :src="scenePreview(scene)" alt="" />
                <span><small>{{ index + 1 }} · {{ scene.map ? t.mapScene : t.storyScene }}</small><strong>{{ scene.title || "—" }}</strong></span>
              </button>
              <span class="de-scene-tools">
                <button type="button" class="de-icon" :disabled="index === 0" :aria-label="t.moveUp" @click="moveScene(index, -1)">↑</button>
                <button type="button" class="de-icon" :disabled="index === draft.scenes.length - 1" :aria-label="t.moveDown" @click="moveScene(index, 1)">↓</button>
                <button type="button" class="de-icon de-bad" :aria-label="t.remove" @click="removeScene(index)">×</button>
              </span>
            </li>
          </ol>
          <div class="de-row">
            <button type="button" class="de-btn" @click="addScene(false)">{{ t.addStory }}</button>
            <button type="button" class="de-btn" @click="addScene(true)">{{ t.addMap }}</button>
          </div>

          <div v-if="scene" class="de-scene-form">
            <label class="de-field"><span>{{ t.sceneTitle }}</span><input v-model="scene.title" class="de-input" maxlength="80" /></label>
            <template v-if="scene.map">
              <div class="de-row de-picture-row">
                <button type="button" class="de-btn" @click="pick(['map'], scene.map.picture, picture => setMapPicture(scene!, picture))">{{ t.choosePicture }}</button>
                <span class="de-label">{{ t.mapSize }}</span>
                <label class="de-field de-inline"><span>{{ t.cols }}</span><input v-model.number="scene.map.cols" class="de-input de-short" type="number" min="4" max="64" /></label>
                <label class="de-field de-inline"><span>{{ t.rows }}</span><input v-model.number="scene.map.rows" class="de-input de-short" type="number" min="4" max="64" /></label>
              </div>
              <MapPlacer
                :t="t"
                :image="pictureUrl(scene.map.picture) ?? ''"
                :cols="scene.map.cols"
                :rows="scene.map.rows"
                :spawn="scene.map.spawn"
                :encounter="scene.encounter ?? []"
                :reveal="scene.reveal ?? []"
                :monsters="placeable"
                @spawn="cells => { scene!.map!.spawn = cells; }"
                @encounter="entries => { scene!.encounter = entries; }"
                @reveal="rects => { scene!.reveal = rects; }"
              />
            </template>
            <div v-else class="de-row de-picture-row">
              <img v-if="pictureUrl(scene.art)" :src="pictureUrl(scene.art)" alt="" class="de-art" />
              <button type="button" class="de-btn" @click="pick(['scene'], scene.art, picture => { scene!.art = picture; })">{{ t.choosePicture }}</button>
            </div>
            <label class="de-field"><span>{{ t.intro }}</span><textarea v-model="scene.intro" class="de-input" rows="4" maxlength="2000"></textarea><small>{{ t.introHint }}</small></label>
            <label class="de-field"><span>{{ t.notes }}</span><textarea v-model="scene.notes" class="de-input" rows="5" maxlength="6000"></textarea><small>{{ t.notesHint }}</small></label>
            <label class="de-field">
              <span>{{ t.sceneMusic }}</span>
              <select v-model="scene.music" class="de-input">
                <option :value="undefined">{{ t.noMusic }}</option>
                <option v-for="track in draft.music" :key="track.id" :value="track.id">{{ track.title }}</option>
              </select>
            </label>
            <span class="de-label">{{ t.loot }}</span>
            <small class="de-hint">{{ t.lootHint }}</small>
            <div v-for="(item, i) in scene.loot ?? []" :key="i" class="de-row de-loot">
              <img v-if="lootPicture(item)" :src="lootPicture(item)" alt="" class="de-thumb" />
              <template v-if="item.catalogId"><strong class="de-grow">{{ catalogItemName(item.catalogId) }}</strong></template>
              <template v-else>
                <input v-model="item.name" class="de-input de-grow" :placeholder="t.itemName" :aria-label="t.itemName" maxlength="80" />
                <input v-model="item.text" class="de-input de-grow" :placeholder="t.itemText" :aria-label="t.itemText" maxlength="300" />
                <button type="button" class="de-link" @click="pick(['item'], item.picture, picture => { item.picture = picture; })">{{ t.picture }}</button>
              </template>
              <label class="de-field de-inline"><span>{{ t.qty }}</span><input v-model.number="item.qty" class="de-input de-short" type="number" min="1" max="999" /></label>
              <button type="button" class="de-link de-bad" :aria-label="t.remove" @click="scene.loot!.splice(i, 1)">×</button>
            </div>
            <div class="de-row">
              <button type="button" class="de-btn de-btn-quiet" :disabled="(scene.loot?.length ?? 0) >= 20" @click="pick(['item'], undefined, picture => addCatalogLoot(scene!, picture))">{{ t.addItem }}</button>
              <button type="button" class="de-btn de-btn-quiet" :disabled="(scene.loot?.length ?? 0) >= 20" @click="(scene.loot ??= []).push({ name: '', text: '', qty: 1 })">{{ t.customItem }}</button>
            </div>
          </div>
        </section>

        <!-- Music -->
        <section v-else-if="section === 'music'" class="de-section">
          <p class="de-lead">{{ t.musicLead }}</p>
          <div v-for="(track, index) in draft.music" :key="track.id" class="de-row de-track">
            <input v-model="track.title" class="de-input de-grow" :aria-label="t.trackTitle" maxlength="80" />
            <audio :src="trackUrl(track)" controls preload="none"></audio>
            <button type="button" class="de-link de-bad" @click="removeTrack(index)">{{ t.remove }}</button>
          </div>
          <h3>{{ t.builtinTracks }}</h3>
          <div class="de-row de-wrap">
            <button
              v-for="track in BUILTIN_TRACKS"
              :key="track.id"
              type="button"
              class="de-btn"
              :disabled="draft.music.some(item => 'builtin' in item && item.builtin === track.id) || draft.music.length >= 20"
              @click="draft.music.push({ id: freeTrackId(track.id), title: track.title[russian ? 0 : 1], builtin: track.id })"
            >＋ {{ track.title[russian ? 0 : 1] }}</button>
          </div>
          <label class="de-btn de-upload">
            <input type="file" accept="audio/ogg,audio/mpeg,audio/mp4,audio/webm,.ogg,.opus,.mp3,.m4a,.webm" :disabled="uploadingTrack" @change="onTrack" />
            {{ uploadingTrack ? t.uploading : t.uploadTrack }}
          </label>
          <p v-if="trackProblem" class="de-problem" role="alert">{{ trackProblem }}</p>
          <label class="de-field">
            <span>{{ t.combatMusic }}</span>
            <select v-model="draft.combatMusic" class="de-input">
              <option :value="undefined">{{ t.noMusic }}</option>
              <option v-for="track in draft.music" :key="track.id" :value="track.id">{{ track.title }}</option>
            </select>
            <small>{{ t.combatHint }}</small>
          </label>
        </section>

        <!-- Publish -->
        <section v-else class="de-section">
          <p class="de-lead">{{ t.publishLead }}</p>
          <p class="de-stats">{{ fill(t.stats, { scenes: draft.scenes.length, heroes: draft.heroes.length, monsters: draft.monsters.length, tracks: draft.music.length }) }}</p>
          <div :class="['de-check', problem ? 'de-check-bad' : 'de-check-ok']" role="status">
            <strong>{{ t.check }}:</strong> {{ problem ? problem.text : t.ready }}
            <button v-if="problem?.section" type="button" class="de-link" @click="section = problem.section">→ {{ t.sections[problem.section] }}</button>
          </div>
          <button type="button" class="de-btn de-btn-gold de-publish" :disabled="Boolean(problem) || publishing" @click="publish">
            {{ publishing ? t.publishing : summary.publishedId ? t.republish : t.publish }}
          </button>
          <p v-if="publishMessage" :class="publishOk ? 'de-ok' : 'de-problem'" role="status">{{ publishMessage }}</p>
        </section>
      </main>
    </div>

    <PicturePicker
      v-if="picker"
      :t="t"
      :russian="russian"
      :kinds="picker.kinds"
      :uploads="imageUploads"
      :current="picker.current"
      :upload="uploadImage"
      @pick="picture => { picker!.done(picture); picker = null; }"
      @close="picker = null"
    />
    <div v-if="heroEditor" class="de-builder">
      <HeroBuilder :x="dnd" :initial="heroEditor.choices" :can-play="false" :die-prefix="russian ? 'к' : 'd'" @cancel="heroEditor = null" @save="saveHero" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from "vue";
import HeroBuilder from "../web-client/HeroBuilder.vue";
import MapPlacer from "./MapPlacer.vue";
import PicturePicker from "./PicturePicker.vue";
import { CATALOG_ITEMS, CATALOG_MONSTERS, CATALOG_NPCS, libraryUrl, type LibraryKind } from "../../../../src/shared/adventure-catalog.js";
import {
  BUILTIN_TRACKS, DraftError, builtinHeroes, builtinMonsters, catalogMonster, draftAdventureId, draftToPackage, pictureUrl, suggestedGrid,
  type AdventureDraft, type DraftLoot, type DraftMonster, type DraftPicture, type DraftScene, type DraftTrack,
} from "../../../../src/shared/adventure-draft.js";
import { buildHero, type HeroChoices } from "../../../../src/shared/hero-builder.js";
import { dndText } from "../../game/dnd-text.js";
import type { EditorApi, EditorDraftSummary } from "../../editor/editor-api.js";
import { explainProblem, fill, type EditorText } from "../../editor/editor-text.js";
import { prepareUpload } from "../../editor/upload-image.js";

type Section = "basics" | "heroes" | "monsters" | "scenes" | "music" | "publish";
const SECTIONS: Section[] = ["basics", "heroes", "monsters", "scenes", "music", "publish"];
const ICONS: Record<Section, string> = { basics: "📜", heroes: "🛡️", monsters: "👹", scenes: "🗺️", music: "🎵", publish: "🚀" };

const props = defineProps<{
  t: EditorText;
  russian: boolean;
  api: EditorApi;
  id: string;
  initial: AdventureDraft;
  files: string[];
  summary: EditorDraftSummary;
}>();
const emit = defineEmits<{ back: [] }>();

const draft = reactive<AdventureDraft>(JSON.parse(JSON.stringify(props.initial)) as AdventureDraft);
const uploads = ref<string[]>([...props.files]);
const summary = ref<EditorDraftSummary>({ ...props.summary });
const section = ref<Section>("basics");
const dnd = computed(() => dndText(props.russian ? "ru" : "en"));
const BUILTIN_HEROES = builtinHeroes();

// ---- Saving ----------------------------------------------------------------------

const saveState = ref<"idle" | "saving" | "saved" | "failed">("idle");
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let saving: Promise<void> | null = null;
let dirty = false;

watch(draft, () => {
  dirty = true;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { void save(); }, 1200);
}, { deep: true });

async function save(): Promise<void> {
  if (saving) { await saving; if (!dirty) return; }
  dirty = false;
  saveState.value = "saving";
  saving = (async () => {
    try {
      summary.value = (await props.api.save(props.id, JSON.parse(JSON.stringify(draft)) as AdventureDraft)).summary;
      saveState.value = dirty ? "saving" : "saved";
    } catch {
      saveState.value = "failed";
      dirty = true;
    }
  })();
  await saving;
  saving = null;
}

function flush(): void {
  if (dirty) { clearTimeout(saveTimer); void save(); }
}
onBeforeUnmount(flush);
window.addEventListener("beforeunload", flush);
onBeforeUnmount(() => window.removeEventListener("beforeunload", flush));

// ---- Ids and counts --------------------------------------------------------------

function newId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}

const counts = computed<Partial<Record<Section, number>>>(() => ({
  heroes: draft.heroes.length, monsters: draft.monsters.length, scenes: draft.scenes.length, music: draft.music.length,
}));

// ---- Pictures ----------------------------------------------------------------------

const picker = ref<{ kinds: LibraryKind[]; current?: DraftPicture; done: (picture: DraftPicture) => void } | null>(null);
const imageUploads = computed(() => uploads.value.filter(name => /\.(webp|png|jpe?g)$/.test(name)));

function pick(kinds: LibraryKind[], current: DraftPicture | undefined, done: (picture: DraftPicture) => void): void {
  picker.value = { kinds, ...(current ? { current } : {}), done };
}

async function uploadImage(file: File): Promise<string> {
  const prepared = await prepareUpload(file);
  try {
    const result = await props.api.upload(props.id, prepared);
    uploads.value.push(result.file);
    return result.file;
  } catch (error: unknown) {
    const code = (error as { code?: string }).code ?? "";
    throw new Error(props.t.errors[code] ?? props.t.uploadFailed);
  }
}

// ---- Heroes ------------------------------------------------------------------------

function hasBuiltinHero(id: string): boolean {
  return draft.heroes.some(hero => hero.kind === "builtin" && hero.id === id);
}
function toggleBuiltinHero(id: string): void {
  const at = draft.heroes.findIndex(hero => hero.kind === "builtin" && hero.id === id);
  if (at >= 0) draft.heroes.splice(at, 1);
  else if (draft.heroes.length < 12) draft.heroes.push({ kind: "builtin", id });
}
const builtHeroes = computed(() => draft.heroes.flatMap(hero => {
  if (hero.kind !== "built") return [];
  try { return [{ id: hero.id, sheet: buildHero(hero.choices, hero.id) }]; } catch { return []; }
}));
const heroEditor = ref<{ id: string | null; choices: HeroChoices | null } | null>(null);
function editHero(id: string | null): void {
  const hero = id ? draft.heroes.find(item => item.kind === "built" && item.id === id) : undefined;
  heroEditor.value = { id, choices: hero?.kind === "built" ? hero.choices : null };
}
function saveHero(choices: HeroChoices): void {
  const editing = heroEditor.value;
  heroEditor.value = null;
  if (!editing) return;
  const hero = editing.id ? draft.heroes.find(item => item.kind === "built" && item.id === editing.id) : undefined;
  if (hero?.kind === "built") hero.choices = choices;
  else if (draft.heroes.length < 12) draft.heroes.push({ kind: "built", id: newId("pc"), choices });
}
function removeHero(id: string): void {
  const at = draft.heroes.findIndex(hero => hero.id === id);
  if (at >= 0) draft.heroes.splice(at, 1);
}

// ---- Monsters ------------------------------------------------------------------------

const catalogMonsters = computed(() => {
  const seen = new Set<string>();
  return [
    ...builtinMonsters().map(monster => ({ ...monster, npc: false })),
    ...CATALOG_MONSTERS.map(monster => ({ ...monster, portrait: libraryUrl("monster", monster.id), npc: false })),
    ...CATALOG_NPCS.map(npc => ({ ...npc, portrait: libraryUrl("npc", npc.id), npc: true })),
  ].filter(monster => !seen.has(monster.id) && seen.add(monster.id));
});
const monsterQuery = ref("");
const catalogFilter = ref<"all" | "monster" | "npc">("all");
const shownCatalog = computed(() => {
  const needle = monsterQuery.value.trim().toLowerCase();
  return catalogMonsters.value.filter(monster =>
    (catalogFilter.value === "all" || (catalogFilter.value === "npc") === monster.npc)
    && (!needle || monster.name.toLowerCase().includes(needle)));
});
const openMonster = ref("");
function hasMonster(id: string): boolean {
  return draft.monsters.some(monster => monster.id === id);
}
function monsterSheet(monster: DraftMonster): { name: string; maxHp: number; ac: number; cr: string } | undefined {
  return monster.kind === "catalog" ? catalogMonster(monster.id) : monster.sheet;
}
function monsterPortrait(monster: DraftMonster): string | undefined {
  return monster.kind === "catalog" ? catalogMonster(monster.id)?.portrait : pictureUrl(monster.picture);
}
function addCustomMonster(): void {
  const id = newId("m");
  draft.monsters.push({ kind: "custom", id, sheet: { name: props.russian ? "Новое существо" : "New creature", cr: "1/2", maxHp: 15, ac: 13, speed: 30, dex: 12, attacks: [{ name: props.russian ? "Удар" : "Strike", bonus: 4, damage: "1d6+2", note: "" }], traits: [] } });
  openMonster.value = id;
}
function removeMonster(index: number): void {
  const [removed] = draft.monsters.splice(index, 1);
  if (!removed) return;
  for (const scene of draft.scenes) {
    if (scene.encounter) scene.encounter = scene.encounter.filter(entry => entry.monsterId !== removed.id);
  }
}
const placeable = computed(() => draft.monsters.map(monster => ({ id: monster.id, name: monsterSheet(monster)?.name ?? monster.id, portrait: monsterPortrait(monster) })));
function numberOrNull(value: string): number | null {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.max(-10, Math.min(30, parsed)) : null;
}

// ---- Scenes ------------------------------------------------------------------------

const sceneId = ref(draft.scenes[0]?.id ?? "");
const scene = computed(() => draft.scenes.find(item => item.id === sceneId.value));
function addScene(map: boolean): void {
  if (draft.scenes.length >= 40) return;
  const id = newId("s");
  const title = `${props.russian ? "Сцена" : "Scene"} ${draft.scenes.length + 1}`;
  draft.scenes.push(map
    ? { id, title, map: { picture: { library: "map", id: "forest-road" }, cols: 24, rows: 16, spawn: [[2, 13], [3, 13], [2, 14], [3, 14]] }, encounter: [], reveal: [] }
    : { id, title, art: { library: "scene", id: "crossroads-inn" } });
  sceneId.value = id;
}
function moveScene(index: number, step: number): void {
  const [item] = draft.scenes.splice(index, 1);
  if (item) draft.scenes.splice(index + step, 0, item);
}
function removeScene(index: number): void {
  const [removed] = draft.scenes.splice(index, 1);
  if (removed?.id === sceneId.value) sceneId.value = draft.scenes[Math.max(0, index - 1)]?.id ?? "";
}
function scenePreview(item: DraftScene): string | undefined {
  return pictureUrl(item.map?.picture ?? item.art);
}
function setMapPicture(target: DraftScene, picture: DraftPicture): void {
  if (!target.map) return;
  target.map.picture = picture;
  const apply = (size?: { width: number; height: number }) => {
    const grid = suggestedGrid(picture, size);
    target.map!.cols = grid.cols;
    target.map!.rows = grid.rows;
    target.map!.spawn = target.map!.spawn.filter(([x, y]) => x < grid.cols && y < grid.rows);
    if (target.encounter) target.encounter = target.encounter.filter(entry => entry.x < grid.cols && entry.y < grid.rows);
    target.reveal = [];
  };
  if ("upload" in picture) {
    const image = new Image();
    image.onload = () => apply({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => apply();
    image.src = pictureUrl(picture)!;
  } else apply();
}
function catalogItemName(id: string): string {
  return CATALOG_ITEMS.find(item => item.id === id)?.name[props.russian ? 0 : 1] ?? id;
}
function lootPicture(item: DraftLoot): string | undefined {
  return pictureUrl(item.picture ?? (item.catalogId ? { library: "item", id: item.catalogId } : undefined));
}
function addCatalogLoot(target: DraftScene, picture: DraftPicture): void {
  const loot = (target.loot ??= []);
  if ("upload" in picture) loot.push({ name: "", text: "", picture, qty: 1 });
  else loot.push({ catalogId: picture.id, qty: 1 });
}

// ---- Music ------------------------------------------------------------------------

const uploadingTrack = ref(false);
const trackProblem = ref("");
function trackUrl(track: DraftTrack): string {
  return "builtin" in track ? BUILTIN_TRACKS.find(item => item.id === track.builtin)?.file ?? "" : `/api/editor-files/${track.upload}`;
}
function freeTrackId(base: string): string {
  let id = base;
  for (let n = 2; draft.music.some(track => track.id === id); n++) id = `${base}-${n}`;
  return id;
}
function removeTrack(index: number): void {
  const [removed] = draft.music.splice(index, 1);
  if (!removed) return;
  if (draft.combatMusic === removed.id) draft.combatMusic = undefined;
  for (const item of draft.scenes) if (item.music === removed.id) item.music = undefined;
}
async function onTrack(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file || uploadingTrack.value || draft.music.length >= 20) return;
  uploadingTrack.value = true;
  trackProblem.value = "";
  try {
    const result = await props.api.upload(props.id, file);
    uploads.value.push(result.file);
    draft.music.push({ id: freeTrackId("track"), title: file.name.replace(/\.[^.]+$/, "").slice(0, 80) || "Track", upload: result.file });
  } catch (error: unknown) {
    trackProblem.value = props.t.errors[(error as { code?: string }).code ?? ""] ?? props.t.uploadFailed;
  } finally {
    uploadingTrack.value = false;
  }
}

// ---- Publishing ------------------------------------------------------------------------

const problem = computed<{ text: string; section?: Section } | null>(() => {
  try {
    draftToPackage(JSON.parse(JSON.stringify(draft)) as AdventureDraft, draftAdventureId(props.id));
    return null;
  } catch (error: unknown) {
    const path = error instanceof DraftError ? error.path : "";
    const area = path.split(/[.[]/)[0] ?? "";
    const target: Section | undefined = area === "title" ? "basics" : area === "heroes" ? "heroes" : area === "monsters" ? "monsters"
      : area === "scenes" ? "scenes" : area === "combatMusic" ? "music" : undefined;
    const index = /^scenes\[(\d+)\]/.exec(path)?.[1];
    const where = index !== undefined ? `${props.t.sections.scenes} ${Number(index) + 1}: ` : "";
    return { text: where + explainProblem(props.t, error instanceof Error ? error.message : String(error)), ...(target ? { section: target } : {}) };
  }
});
const publishing = ref(false);
const publishMessage = ref("");
const publishOk = ref(false);
async function publish(): Promise<void> {
  if (publishing.value) return;
  publishing.value = true;
  publishMessage.value = "";
  try {
    clearTimeout(saveTimer);
    await save();
    const result = await props.api.publish(props.id);
    publishOk.value = true;
    publishMessage.value = fill(props.t.publishedOk, { title: result.adventure.title });
    summary.value = { ...summary.value, publishedId: result.adventure.id, publishedAt: new Date().toISOString() };
  } catch (error: unknown) {
    publishOk.value = false;
    const code = (error as { code?: string }).code ?? "";
    publishMessage.value = props.t.errors[code] ?? (error instanceof Error ? explainProblem(props.t, error.message) : String(error));
  } finally {
    publishing.value = false;
  }
}
</script>

<style scoped>
.de { display: flex; flex-direction: column; gap: 14px; min-height: 100%; }
.de-top { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
.de-title { flex: 1; margin: 0; font-family: var(--ed-serif); font-size: 30px; color: var(--ed-title); }
.de-save { font-size: 13px; color: var(--ed-muted); }
.de-save-failed { color: var(--ed-bad); }
.de-save-saved { color: var(--ed-good); }
.de-body { display: grid; grid-template-columns: 210px minmax(0, 1fr); gap: 18px; align-items: start; }
.de-nav { position: sticky; top: 12px; display: flex; flex-direction: column; gap: 4px; }
.de-nav-item { display: flex; align-items: center; gap: 10px; min-height: 42px; padding: 0 14px; border-radius: 12px; border: 1px solid transparent; background: transparent; color: var(--ed-text); font: inherit; font-size: 15px; text-align: left; cursor: pointer; }
.de-nav-item small { margin-left: auto; color: var(--ed-muted); font-size: 12px; }
.de-nav-item:hover { background: var(--ed-raised); }
.de-nav-on { border-color: var(--ed-gold); background: var(--ed-gold-soft); color: var(--ed-title); }
.de-main { min-width: 0; padding: 20px; border-radius: 18px; border: 1px solid var(--ed-line); background: var(--ed-card); }
.de-section { display: flex; flex-direction: column; gap: 14px; }
.de-section h3 { margin: 6px 0 0; font-size: 13px; letter-spacing: .08em; text-transform: uppercase; color: var(--ed-gold); }
.de-lead { margin: 0; color: var(--ed-muted); line-height: 1.5; }
.de-field { display: flex; flex-direction: column; gap: 5px; font-size: 13px; font-weight: 600; color: var(--ed-muted); }
.de-field small, .de-hint { font-weight: 400; color: var(--ed-muted); font-size: 12px; }
.de-inline { flex-direction: row; align-items: center; }
.de-label { font-size: 13px; font-weight: 600; color: var(--ed-muted); }
.de-input { min-height: 38px; padding: 7px 11px; border-radius: 10px; border: 1px solid var(--ed-line-2); background: var(--ed-raised); color: var(--ed-text); font: inherit; font-weight: 400; font-size: 14px; }
textarea.de-input { resize: vertical; line-height: 1.45; }
.de-short { width: 84px; }
.de-mid { width: 130px; }
.de-grow { flex: 1 1 160px; min-width: 0; }
.de-filter { align-items: center; }
.de-chips { display: inline-flex; gap: 4px; padding: 3px; border-radius: 12px; background: var(--ed-raised); }
.de-chip { min-height: 32px; padding: 0 12px; border-radius: 9px; border: 0; background: transparent; color: var(--ed-muted); font: inherit; font-size: 13px; cursor: pointer; }
.de-chip-on { background: var(--ed-gold); color: #1a1408; font-weight: 600; }
.de-row { display: flex; gap: 10px; align-items: flex-end; flex-wrap: wrap; }
.de-wrap { align-items: center; }
.de-picture-row { align-items: center; }
.de-btn { position: relative; display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 38px; padding: 0 14px; border-radius: 10px; border: 1px solid var(--ed-line-2); background: var(--ed-raised); color: var(--ed-text); font: inherit; font-size: 14px; cursor: pointer; }
.de-btn:disabled { opacity: .45; cursor: default; }
.de-btn-quiet { background: transparent; }
.de-btn-gold { border-color: var(--ed-gold); background: var(--ed-gold); color: #1a1408; font-weight: 700; }
.de-upload { align-self: flex-start; }
.de-upload input { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
.de-link { padding: 0; border: 0; background: none; color: var(--ed-gold); font: inherit; font-size: 13px; cursor: pointer; }
.de-bad { color: var(--ed-bad); }
.de-icon { width: 30px; height: 30px; border-radius: 8px; border: 1px solid var(--ed-line-2); background: transparent; color: var(--ed-text); cursor: pointer; }
.de-icon:disabled { opacity: .35; cursor: default; }
.de-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 10px; }
.de-cards-small { grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); }
.de-card { display: flex; align-items: center; gap: 10px; min-height: 64px; padding: 8px 10px; border-radius: 14px; border: 1px solid var(--ed-line); background: var(--ed-raised); color: var(--ed-text); font: inherit; text-align: left; cursor: pointer; }
.de-card:disabled { cursor: default; }
.de-card img, .de-initial { width: 48px; height: 48px; flex: none; border-radius: 50%; object-fit: cover; }
.de-initial { display: grid; place-items: center; background: #4a2c2c; font-weight: 700; }
.de-card-on { border-color: var(--ed-gold); background: var(--ed-gold-soft); }
.de-card-add { justify-content: center; border-style: dashed; color: var(--ed-gold); font-weight: 600; }
.de-card-body { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
.de-card-body strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.de-card-body small { color: var(--ed-muted); font-size: 12px; }
.de-card-actions { display: flex; flex-direction: column; gap: 4px; align-items: flex-end; }
.de-tick { width: 26px; height: 26px; display: grid; place-items: center; border-radius: 50%; border: 1px solid var(--ed-line-2); color: var(--ed-gold); font-weight: 700; }
.de-list { display: flex; flex-direction: column; gap: 8px; }
.de-monster { padding: 8px 10px; border-radius: 14px; border: 1px solid var(--ed-line); background: var(--ed-raised); }
.de-monster-row { display: flex; align-items: center; gap: 10px; }
.de-monster-row img { width: 44px; height: 44px; border-radius: 50%; object-fit: cover; }
.de-monster-form { display: flex; flex-direction: column; gap: 10px; margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--ed-line); }
.de-attack { align-items: center; }
.de-thumb { width: 44px; height: 44px; border-radius: 10px; object-fit: cover; }
.de-art { width: 260px; max-width: 100%; aspect-ratio: 16 / 9; object-fit: cover; border-radius: 12px; }
.de-scenes { display: flex; flex-direction: column; gap: 6px; margin: 0; padding: 0; list-style: none; }
.de-scene-tab { display: flex; align-items: center; gap: 8px; padding: 6px; border-radius: 14px; border: 1px solid var(--ed-line); background: var(--ed-raised); }
.de-scene-on { border-color: var(--ed-gold); }
.de-scene-pick { display: flex; align-items: center; gap: 12px; flex: 1; min-width: 0; padding: 0; border: 0; background: none; color: var(--ed-text); font: inherit; text-align: left; cursor: pointer; }
.de-scene-pick img { width: 84px; height: 52px; border-radius: 9px; object-fit: cover; }
.de-scene-pick span { display: flex; flex-direction: column; min-width: 0; }
.de-scene-pick small { color: var(--ed-muted); font-size: 12px; }
.de-scene-tools { display: flex; gap: 4px; }
.de-scene-form { display: flex; flex-direction: column; gap: 14px; margin-top: 6px; padding-top: 16px; border-top: 1px solid var(--ed-line); }
.de-loot { align-items: center; }
.de-track { align-items: center; }
.de-track audio { height: 34px; }
.de-stats { margin: 0; font-weight: 600; }
.de-check { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 12px 14px; border-radius: 12px; }
.de-check-ok { background: rgba(80, 170, 100, .14); color: var(--ed-good); }
.de-check-bad { background: rgba(210, 90, 80, .14); color: #f0b4ac; }
.de-publish { align-self: flex-start; min-height: 46px; padding: 0 26px; font-size: 16px; }
.de-ok { margin: 0; color: var(--ed-good); }
.de-problem { margin: 0; color: var(--ed-bad); }
.de-builder { position: fixed; inset: 0; z-index: 70; }
button:focus-visible, .de-input:focus-visible { outline: 2px solid var(--ed-gold); outline-offset: 2px; }
@media (max-width: 820px) {
  .de-body { grid-template-columns: 1fr; }
  .de-nav { position: static; flex-direction: row; flex-wrap: wrap; }
}
</style>
