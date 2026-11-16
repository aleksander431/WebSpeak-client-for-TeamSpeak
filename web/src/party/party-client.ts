import { reactive } from "vue";
import type { ChessClientMessage, ChessRoomView, ChessServerMessage } from "../../../src/shared/chess-room.js";
import type { MafiaClientMessage, MafiaRoomView, MafiaServerMessage } from "../../../src/shared/mafia.js";

export interface PartyTransport<Out, In> {
  isOpen(): boolean;
  send(message: Out): void;
  subscribe(listener: (message: In) => void): () => void;
}

/**
 * The page's view of one channel game (chess or mafia). The gateway owns the
 * state and sends every connected page its own view; this keeps the latest
 * one, when it arrived (for counting down clocks) and the last error.
 */
class PartyClient<Out extends { type: string }, In extends { type: string }, View> {
  readonly state = reactive({
    room: null as View | null,
    /** `performance.now()` when `room` arrived. */
    receivedAt: 0,
    error: "",
    /** Bumped with every error, so the same code shown twice still flashes. */
    errorAt: 0,
  });
  private readonly unsubscribe: () => void;

  constructor(
    private readonly transport: PartyTransport<Out, In>,
    private readonly prefix: string,
    private readonly clock: () => number = () => performance.now(),
  ) {
    this.unsubscribe = transport.subscribe(message => this.receive(message));
  }

  receive(message: In): void {
    if (message.type === `${this.prefix}Error`) {
      this.state.error = (message as unknown as { code: string }).code;
      this.state.errorAt = this.clock();
      return;
    }
    this.state.room = (message as unknown as { room: View }).room as never;
    this.state.receivedAt = this.clock();
  }

  /** After connecting (or reconnecting): ask for the channel's game. */
  setConnected(connected: boolean): void {
    if (!connected) { this.state.room = null; return; }
    if (this.transport.isOpen()) this.transport.send({ type: `${this.prefix}Open` } as Out);
  }

  send(message: Out): void {
    this.state.error = "";
    this.transport.send(message);
  }

  /** Milliseconds since the latest view arrived. */
  elapsed(): number {
    return this.clock() - this.state.receivedAt;
  }

  dispose(): void {
    this.unsubscribe();
  }
}

export class ChessClient extends PartyClient<ChessClientMessage, ChessServerMessage, ChessRoomView> {
  constructor(transport: PartyTransport<ChessClientMessage, ChessServerMessage>, clock?: () => number) { super(transport, "chess", clock); }
}

export class MafiaClient extends PartyClient<MafiaClientMessage, MafiaServerMessage, MafiaRoomView> {
  constructor(transport: PartyTransport<MafiaClientMessage, MafiaServerMessage>, clock?: () => number) { super(transport, "mafia", clock); }
}
