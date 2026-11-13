import { TabletopCoordinator } from "../../../src/server/tabletop-coordinator.js";
import { parseAdventurePackage } from "../../../src/shared/adventure-package.js";
import { draftAdventureId, draftToPackage, type AdventureDraft } from "../../../src/shared/adventure-draft.js";
import { BUILT_IN_ADVENTURES } from "../../../src/shared/tabletop-adventures.js";
import type { AdventureSummary, GameClientMessage, GameServerMessage } from "../../../src/shared/tabletop.js";
import { GameClient, type GameTransport } from "../game/game-client.js";

/*
 * A test run of a draft in the editor, without publishing or a voice channel:
 * the gateway's own table logic runs in this page with one game master and one
 * player, both played by the author. Nothing leaves the browser; pictures and
 * music load from the same places the published adventure would use.
 */

export type PlaytestRole = "gm" | "player";

export interface Playtest {
  adventure: AdventureSummary;
  clients: Record<PlaytestRole, GameClient>;
  dispose(): void;
}

const TABLE_KEY = "playtest#1";

/** The draft as the gateway would load it after publishing; throws on the same problems publishing would. */
export function playtestAdventure(draft: AdventureDraft, draftId: string): AdventureSummary {
  const id = draftAdventureId(draftId);
  const pack = draftToPackage(draft, id);
  return parseAdventurePackage(pack.manifest, file => {
    const source = pack.files.get(file);
    if (!source) return null;
    return "static" in source ? source.static : `/api/editor-files/${source.upload}`;
  }, {
    heroes: BUILT_IN_ADVENTURES.flatMap(adventure => adventure.heroes),
    monsters: BUILT_IN_ADVENTURES.flatMap(adventure => adventure.monsters),
  });
}

export function startPlaytest(draft: AdventureDraft, draftId: string, names: Record<PlaytestRole, string>): Playtest {
  const adventure = playtestAdventure(draft, draftId);
  const listeners = new Map<string, (message: GameServerMessage) => void>();
  let disposed = false;
  // Delivery is asynchronous both ways, as over a socket, so a message never
  // reenters the coordinator or a client while it is still handling another.
  const coordinator = new TabletopCoordinator({
    adventures: () => [adventure],
    isCustomAdventure: () => true,
    send: (entryId, message) => queueMicrotask(() => { if (!disposed) listeners.get(entryId)?.(message); }),
  });
  const transport = (role: PlaytestRole): GameTransport => ({
    isOpen: () => !disposed,
    send: (message: GameClientMessage) => queueMicrotask(() => {
      if (!disposed) coordinator.handleMessage({ entryId: role, nickname: names[role], seatKey: `playtest:${role}`, tableKey: TABLE_KEY }, message);
    }),
    subscribe: listener => {
      listeners.set(role, listener);
      return () => listeners.delete(role);
    },
  });
  const clients = { gm: new GameClient(transport("gm")), player: new GameClient(transport("player")) };
  clients.gm.open();
  clients.player.open();
  clients.gm.seat("gm");
  clients.gm.adventure(adventure.id);
  clients.player.seat("player");
  clients.player.hero(adventure.heroes[0]!.id);
  clients.player.ready(true);
  clients.gm.start();
  return {
    adventure,
    clients,
    dispose() {
      if (disposed) return;
      clients.gm.dispose();
      clients.player.dispose();
      disposed = true;
      listeners.clear();
    },
  };
}
