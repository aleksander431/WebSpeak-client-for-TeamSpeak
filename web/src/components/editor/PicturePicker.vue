<template>
  <div class="pp" role="dialog" aria-modal="true" :aria-label="t.pickerTitle" @keydown.esc.stop.prevent="emit('close')" @click.self="emit('close')">
    <div class="pp-card">
      <header class="pp-head">
        <h2>{{ t.pickerTitle }}</h2>
        <button ref="closeButton" type="button" class="pp-close" :aria-label="t.close" @click="emit('close')">×</button>
      </header>
      <nav class="pp-tabs" role="tablist">
        <button
          v-for="kind in kinds"
          :key="kind"
          type="button"
          role="tab"
          :aria-selected="tab === kind"
          :class="['pp-tab', { 'pp-tab-on': tab === kind }]"
          @click="tab = kind"
        >{{ t.kinds[kind] }} · {{ library(kind).length }}</button>
        <button type="button" role="tab" :aria-selected="tab === 'uploads'" :class="['pp-tab', { 'pp-tab-on': tab === 'uploads' }]" @click="tab = 'uploads'">
          {{ t.pickerUploads }} · {{ uploads.length }}
        </button>
        <label class="pp-upload">
          <input type="file" accept="image/webp,image/png,image/jpeg" :disabled="busy" @change="onFile" />
          {{ busy ? t.uploading : t.pickerUpload }}
        </label>
      </nav>
      <p v-if="problem" class="pp-problem" role="alert">{{ problem }}</p>
      <div v-if="tab !== 'uploads'" class="pp-filter">
        <div v-if="tab === 'map'" class="pp-sizes" role="radiogroup" :aria-label="t.mapSize">
          <button
            v-for="item in (['all', 'small', 'medium', 'large'] as const)"
            :key="item"
            type="button"
            role="radio"
            :aria-checked="mapSize === item"
            :class="['pp-size-btn', { 'pp-size-on': mapSize === item }]"
            @click="mapSize = item"
          >{{ t.mapSizes[item] }}</button>
        </div>
        <input v-model="query" class="pp-search" type="search" :placeholder="t.search" :aria-label="t.search" />
      </div>
      <div :class="['pp-grid', `pp-grid-${tab}`]">
        <template v-if="tab === 'uploads'">
          <button v-for="name in uploads" :key="name" type="button" class="pp-item" @click="emit('pick', { upload: name })">
            <img :src="`/api/editor-files/${name}`" alt="" loading="lazy" />
          </button>
        </template>
        <template v-else>
          <button
            v-for="item in shown"
            :key="item.id"
            type="button"
            :class="['pp-item', { 'pp-item-on': isCurrent(item.id) }]"
            :title="item.name"
            @click="emit('pick', { library: item.kind, id: item.id })"
          >
            <img :src="item.url" alt="" loading="lazy" />
            <span class="pp-name">{{ item.name }}<small v-if="item.size" class="pp-size">{{ item.size }}</small></span>
          </button>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { CATALOG_ITEMS, CATALOG_MAPS, CATALOG_MONSTERS, CATALOG_NPCS, CATALOG_SCENES, libraryUrl, type LibraryKind } from "../../../../src/shared/adventure-catalog.js";
import { BUILTIN_PICTURES, type DraftPicture } from "../../../../src/shared/adventure-draft.js";
import { HERO_PORTRAITS } from "../../../../src/shared/hero-builder.js";
import type { EditorText } from "../../editor/editor-text.js";

const props = defineProps<{
  t: EditorText;
  russian: boolean;
  kinds: LibraryKind[];
  uploads: string[];
  current?: DraftPicture;
  upload: (file: File) => Promise<string>;
}>();
const emit = defineEmits<{ pick: [picture: DraftPicture]; close: [] }>();

const tab = ref<LibraryKind | "uploads">(props.kinds[0] ?? "uploads");
const query = ref("");
const mapSize = ref<"all" | "small" | "medium" | "large">("all");
/** Small rooms up to 200 cells, medium up to 400, large beyond. */
function sizeClass(size: string | undefined): "small" | "medium" | "large" | "" {
  const match = /^(\d+)×(\d+)$/.exec(size ?? "");
  if (!match) return "";
  const cells = Number(match[1]) * Number(match[2]);
  return cells <= 200 ? "small" : cells <= 400 ? "medium" : "large";
}
const busy = ref(false);
const problem = ref("");
const closeButton = ref<HTMLButtonElement | null>(null);
onMounted(() => closeButton.value?.focus());

interface Entry { id: string; kind: LibraryKind; name: string; url: string; size?: string }

function library(kind: LibraryKind): Entry[] {
  const lang = props.russian ? 0 : 1;
  switch (kind) {
    case "map":
      return [
        ...CATALOG_MAPS.map(map => ({ id: map.id, kind, name: map.name[lang], url: libraryUrl("map", map.id), size: `${map.cols}×${map.rows}` })),
        ...BUILTIN_PICTURES.filter(item => item.kind === "map").map(item => ({ id: item.id, kind, name: item.name[lang], url: item.file, ...(item.cols ? { size: `${item.cols}×${item.rows}` } : {}) })),
      ];
    case "scene":
      return [
        ...CATALOG_SCENES.map(scene => ({ id: scene.id, kind, name: scene.name[lang], url: libraryUrl("scene", scene.id) })),
        ...BUILTIN_PICTURES.filter(item => item.kind === "scene").map(item => ({ id: item.id, kind, name: item.name[lang], url: item.file })),
      ];
    case "npc": return CATALOG_NPCS.map(npc => ({ id: npc.id, kind, name: npc.name, url: libraryUrl("npc", npc.id) }));
    case "monster": return CATALOG_MONSTERS.map(monster => ({ id: monster.id, kind, name: monster.name, url: libraryUrl("monster", monster.id) }));
    case "item": return CATALOG_ITEMS.map(item => ({ id: item.id, kind, name: item.name[lang], url: libraryUrl("item", item.id) }));
    case "portrait": return HERO_PORTRAITS.map(portrait => ({ id: portrait.id, kind, name: portrait.id, url: libraryUrl("portrait", portrait.id) }));
  }
}

const shown = computed(() => {
  if (tab.value === "uploads") return [];
  const needle = query.value.trim().toLowerCase();
  const all = library(tab.value);
  const sized = tab.value === "map" && mapSize.value !== "all" ? all.filter(item => sizeClass(item.size) === mapSize.value) : all;
  return needle ? sized.filter(item => item.name.toLowerCase().includes(needle) || item.id.includes(needle)) : sized;
});

function isCurrent(id: string): boolean {
  return Boolean(props.current && !("upload" in props.current) && props.current.id === id);
}

async function onFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file || busy.value) return;
  busy.value = true;
  problem.value = "";
  try {
    const name = await props.upload(file);
    emit("pick", { upload: name });
  } catch (error: unknown) {
    problem.value = error instanceof Error && error.message ? error.message : props.t.uploadFailed;
  } finally {
    busy.value = false;
  }
}
</script>

<style scoped>
.pp { position: fixed; inset: 0; z-index: 60; display: grid; place-items: center; padding: 20px; background: rgba(6, 7, 10, .7); }
.pp-card { display: flex; flex-direction: column; gap: 12px; width: min(980px, 100%); max-height: calc(100vh - 40px); max-height: calc(100dvh - 40px); min-height: 0; padding: 18px; border-radius: 16px; border: 1px solid var(--ed-line-2); background: var(--ed-card); box-shadow: 0 30px 80px rgba(0, 0, 0, .55); }
.pp-head { display: flex; align-items: center; gap: 12px; }
.pp-head h2 { flex: 1; margin: 0; font-family: var(--ed-serif); font-size: 24px; color: var(--ed-title); }
.pp-close { width: 36px; height: 36px; border-radius: 10px; border: 1px solid var(--ed-line-2); background: transparent; color: var(--ed-text); font-size: 20px; cursor: pointer; }
.pp-tabs { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.pp-tab { min-height: 34px; padding: 0 12px; border-radius: 999px; border: 1px solid var(--ed-line-2); background: transparent; color: var(--ed-muted); font: inherit; font-size: 13px; cursor: pointer; }
.pp-tab-on { border-color: var(--ed-gold); color: var(--ed-title); background: var(--ed-gold-soft); }
.pp-upload { position: relative; margin-left: auto; display: inline-flex; align-items: center; min-height: 34px; padding: 0 14px; border-radius: 10px; background: var(--ed-gold); color: #1a1408; font-weight: 600; font-size: 13px; cursor: pointer; }
.pp-upload input { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
.pp-problem { margin: 0; color: var(--ed-bad); }
.pp-filter { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.pp-filter .pp-search { flex: 1 1 200px; }
.pp-sizes { display: inline-flex; gap: 4px; padding: 3px; border-radius: 12px; background: var(--ed-raised); }
.pp-size-btn { min-height: 30px; padding: 0 12px; border-radius: 9px; border: 0; background: transparent; color: var(--ed-muted); font: inherit; font-size: 13px; cursor: pointer; }
.pp-size-on { background: var(--ed-gold); color: #1a1408; font-weight: 600; }
.pp-search { min-height: 36px; padding: 6px 12px; border-radius: 10px; border: 1px solid var(--ed-line-2); background: var(--ed-raised); color: var(--ed-text); font: inherit; }
.pp-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 10px; flex: 1 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 2px; }
.pp-grid-map, .pp-grid-scene { grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); }
.pp-item { display: flex; flex-direction: column; gap: 4px; padding: 6px; border-radius: 12px; border: 1px solid var(--ed-line); background: var(--ed-raised); color: var(--ed-text); font: inherit; cursor: pointer; text-align: left; }
.pp-item:hover, .pp-item:focus-visible { border-color: var(--ed-gold); outline: none; }
.pp-item-on { border-color: var(--ed-gold); box-shadow: 0 0 0 2px var(--ed-gold-soft); }
.pp-item img { width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: 8px; background: #0e0f12; }
.pp-grid-map .pp-item img, .pp-grid-scene .pp-item img { aspect-ratio: 3 / 2; }
.pp-grid-map .pp-item img { object-fit: contain; }
.pp-size { margin-left: 6px; padding: 1px 6px; border-radius: 6px; background: var(--ed-gold-soft); color: var(--ed-gold); font-size: 11px; font-variant-numeric: tabular-nums; }
.pp-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
</style>
