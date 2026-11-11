import { reactive, shallowRef } from "vue";
import type { CheckSource, GameClientMessage, GameServerMessage, RollMode, RollSource, RollView, TableRole, TableView } from "../../../src/shared/tabletop.js";

export interface GameTransport {
  isOpen(): boolean;
  send(message: GameClientMessage): void;
  subscribe(listener: (message: GameServerMessage) => void): () => void;
}

/**
 * The page's view of its channel's game table. The gateway owns the state and
 * sends this browser its own view after every change; this only forwards
 * intentions and remembers the last roll to animate.
 */
export class GameClient {
  readonly state = reactive({
    open: false,
    table: null as TableView | null,
    error: "",
  });
  /** The newest roll, for the dice animation; replaced (not mutated) per roll. */
  readonly lastRoll = shallowRef<RollView | null>(null);
  /** The newest ping on the map (a fresh object per ping). */
  readonly lastPing = shallowRef<{ id: number; by: string; x: number; y: number; gm: boolean } | null>(null);
  private pingCount = 0;
  private readonly unsubscribe: () => void;

  constructor(private readonly transport: GameTransport) {
    this.unsubscribe = transport.subscribe(message => this.receive(message));
  }

  receive(message: GameServerMessage): void {
    if (message.type === "gameState") {
      if (!this.state.open) return;
      this.state.table = message.table;
      return;
    }
    if (message.type === "gameRolled") {
      if (this.state.open) this.lastRoll.value = message.roll;
      return;
    }
    if (message.type === "gamePinged") {
      if (this.state.open) this.lastPing.value = { id: ++this.pingCount, by: message.by, x: message.x, y: message.y, gm: message.gm };
      return;
    }
    this.state.error = message.code;
  }

  open(): void {
    this.state.open = true;
    this.state.error = "";
    if (this.transport.isOpen()) this.transport.send({ type: "gameOpen" });
  }

  close(): void {
    if (this.state.open && this.transport.isOpen()) this.transport.send({ type: "gameClose" });
    this.state.open = false;
    this.state.table = null;
    this.lastRoll.value = null;
    this.lastPing.value = null;
  }

  /** After a reconnect the gateway forgot the subscription: open again. */
  setConnected(connected: boolean): void {
    if (connected && this.state.open) this.transport.send({ type: "gameOpen" });
  }

  clearError(): void {
    this.state.error = "";
  }

  seat(role: TableRole): void { this.send({ type: "gameSeat", role }); }
  ready(ready: boolean): void { this.send({ type: "gameReady", ready }); }
  adventure(adventureId: string): void { this.send({ type: "gameAdventure", adventureId }); }
  hero(heroId: string | null): void { this.send({ type: "gameHero", heroId }); }
  start(): void { this.send({ type: "gameStart" }); }
  end(): void { this.send({ type: "gameEnd" }); }
  roll(source: RollSource, mode: RollMode = "normal", hidden = false, checkId?: string, targetId?: string): void {
    this.send({ type: "gameRoll", source, mode, hidden, ...(checkId ? { checkId } : {}), ...(targetId ? { targetId } : {}) });
  }
  combatStart(): void { this.send({ type: "gameCombatStart" }); }
  combatEnd(): void { this.send({ type: "gameCombatEnd" }); }
  combatNext(): void { this.send({ type: "gameCombatNext" }); }
  combatPrev(): void { this.send({ type: "gameCombatPrev" }); }
  combatRollAll(): void { this.send({ type: "gameCombatRollAll" }); }
  apply(rollId: string, half: boolean): void { this.send({ type: "gameApply", rollId, half }); }
  setHp(key: string, hp: number): void { this.send({ type: "gameHp", key, hp: Math.round(hp) }); }
  requestCheck(source: CheckSource, dc: number, mode: RollMode, targets: string[]): void {
    this.send({ type: "gameCheck", source, dc, mode, targets });
  }
  cancelCheck(checkId: string): void { this.send({ type: "gameCheckCancel", checkId }); }
  scene(index: number): void { this.send({ type: "gameScene", index }); }
  addToken(monsterId: string, x: number, y: number): void { this.send({ type: "gameTokenAdd", monsterId, x, y }); }
  moveToken(id: string, x: number, y: number): void { this.send({ type: "gameTokenMove", id, x, y }); }
  removeToken(id: string): void { this.send({ type: "gameTokenRemove", id }); }
  setTokenHp(id: string, hp: number): void { this.send({ type: "gameTokenHp", id, hp: Math.max(0, Math.round(hp)) }); }
  hideToken(id: string, hidden: boolean): void { this.send({ type: "gameTokenHide", id, hidden }); }
  fog(cells: number[], reveal: boolean): void { if (cells.length) this.send({ type: "gameFog", cells, reveal }); }
  fogAll(reveal: boolean): void { this.send({ type: "gameFogAll", reveal }); }
  ping(x: number, y: number): void { this.send({ type: "gamePing", x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 }); }

  dispose(): void {
    this.close();
    this.unsubscribe();
  }

  private send(message: GameClientMessage): void {
    this.state.error = "";
    if (this.transport.isOpen()) this.transport.send(message);
  }
}
