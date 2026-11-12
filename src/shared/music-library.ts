/*
 * The game's music library: loopable instrumental tracks generated with
 * ACE-Step 1.5 XL Turbo on the owner's ComfyUI, loudness-normalised to
 * −20 LUFS and joined end-to-start with a 4 s cross-fade so they loop without
 * a gap. Authors add them to adventures in the editor, and the game master can
 * play any of them at any table as `lib-<id>` (the adventure's own tracks come
 * first). Browser-safe.
 */

export type MusicGroup = "place" | "mood" | "battle";

export interface LibraryTrack {
  id: string;
  title: [string, string];
  group: MusicGroup;
  file: string;
}

export const MUSIC_GROUPS: Record<MusicGroup, [string, string]> = {
  place: ["Места", "Places"],
  mood: ["Настроение", "Mood"],
  battle: ["Бой и погоня", "Battle and chase"],
};

const solgard = (id: string, title: [string, string], group: MusicGroup): LibraryTrack =>
  ({ id, title, group, file: `/dnd/solgard-bell/music-${id}.ogg` });
const track = (id: string, title: [string, string], group: MusicGroup): LibraryTrack =>
  ({ id, title, group, file: `/dnd/music/${id}.ogg` });

export const MUSIC_LIBRARY: LibraryTrack[] = [
  solgard("tavern", ["Таверна", "Tavern"], "place"),
  solgard("road", ["Дорога", "Road"], "place"),
  track("forest", ["Лес", "Forest"], "place"),
  track("night-woods", ["Ночной лес", "Night woods"], "place"),
  track("city", ["Город", "Town"], "place"),
  track("castle", ["Королевский замок", "Royal castle"], "place"),
  track("sea", ["Море", "Sea voyage"], "place"),
  track("desert", ["Пустыня", "Desert"], "place"),
  track("snow", ["Снежные горы", "Snowy peaks"], "place"),
  track("cave", ["Пещера", "Cave"], "place"),
  solgard("catacombs", ["Подземелье", "Dungeon"], "place"),
  track("swamp", ["Болото", "Swamp"], "place"),
  track("dwarven-halls", ["Чертоги дворфов", "Dwarven halls"], "place"),
  track("elven-city", ["Эльфийский город", "Elven city"], "place"),
  track("fey-glade", ["Волшебная роща", "Fey glade"], "place"),
  track("temple", ["Храм", "Temple"], "place"),
  track("dragon-lair", ["Логово дракона", "Dragon's lair"], "place"),
  track("mystery", ["Тайна", "Mystery"], "mood"),
  track("stealth", ["Скрытность", "Stealth"], "mood"),
  track("haunted", ["Призраки", "Haunted"], "mood"),
  solgard("ritual", ["Ритуал", "Ritual"], "mood"),
  track("sorrow", ["Утрата", "Sorrow"], "mood"),
  track("campfire", ["Привал у костра", "Campfire"], "mood"),
  track("festival", ["Праздник", "Festival"], "mood"),
  solgard("finale", ["Рассвет", "Dawn"], "mood"),
  track("skirmish", ["Стычка", "Skirmish"], "battle"),
  solgard("battle", ["Бой", "Battle"], "battle"),
  track("chase", ["Погоня", "Chase"], "battle"),
  track("boss", ["Битва с боссом", "Boss battle"], "battle"),
  track("victory", ["Победа", "Victory"], "battle"),
];

export const LIBRARY_TRACK_PREFIX = "lib-";

/** A library track by its table id (`lib-forest`), or undefined. */
export function libraryTrack(trackId: string | null | undefined): LibraryTrack | undefined {
  if (!trackId?.startsWith(LIBRARY_TRACK_PREFIX)) return undefined;
  const id = trackId.slice(LIBRARY_TRACK_PREFIX.length);
  return MUSIC_LIBRARY.find(item => item.id === id);
}
