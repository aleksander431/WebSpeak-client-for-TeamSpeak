/*
 * Stockfish in a Web Worker (the lite single-threaded WebAssembly build under
 * /chess/engine/, loaded only when someone plays the computer). The page that
 * owns a computer seat asks it for a move whenever it is the computer's turn.
 */

const ENGINE = "/chess/engine/stockfish-18-lite-single";

/** Strength per board level 1–8: the engine's skill, search depth and thinking time. */
export const ENGINE_LEVELS: Record<number, { skill: number; depth: number; movetime: number }> = {
  1: { skill: 0, depth: 1, movetime: 60 },
  2: { skill: 3, depth: 2, movetime: 100 },
  3: { skill: 6, depth: 4, movetime: 200 },
  4: { skill: 9, depth: 6, movetime: 300 },
  5: { skill: 12, depth: 8, movetime: 500 },
  6: { skill: 15, depth: 12, movetime: 800 },
  7: { skill: 18, depth: 16, movetime: 1200 },
  8: { skill: 20, depth: 22, movetime: 2000 },
};

export interface EngineMove { from: string; to: string; promotion?: "q" | "r" | "b" | "n" }

/** Reads a UCI `bestmove e7e8q` line. */
export function parseBestMove(line: string): EngineMove | null {
  const match = /^bestmove ([a-h][1-8])([a-h][1-8])([qrbn])?/.exec(line.trim());
  if (!match) return null;
  return { from: match[1]!, to: match[2]!, ...(match[3] ? { promotion: match[3] as EngineMove["promotion"] } : {}) };
}

export class ChessEngine {
  private worker: Worker | null = null;
  private ready: Promise<void> | null = null;
  private waiting: ((line: string) => void) | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  private start(): Promise<void> {
    if (this.ready) return this.ready;
    const worker = new Worker(`${ENGINE}.js#${encodeURIComponent(`${ENGINE}.wasm`)}`);
    this.worker = worker;
    worker.onmessage = event => this.waiting?.(String(event.data));
    this.ready = this.until("uciok", "uci").then(() => this.until("readyok", "isready")).then(() => undefined);
    return this.ready;
  }

  private until(prefix: string, command: string): Promise<string> {
    return new Promise(resolve => {
      this.waiting = line => {
        if (!line.startsWith(prefix)) return;
        this.waiting = null;
        resolve(line);
      };
      this.worker!.postMessage(command);
    });
  }

  /** The engine's move in a FEN position at a board level; one search at a time. */
  bestMove(fen: string, level: number): Promise<EngineMove | null> {
    const run = async () => {
      await this.start();
      const strength = ENGINE_LEVELS[level] ?? ENGINE_LEVELS[4]!;
      this.worker!.postMessage(`setoption name Skill Level value ${strength.skill}`);
      this.worker!.postMessage(`position fen ${fen}`);
      const line = await this.until("bestmove", `go depth ${strength.depth} movetime ${strength.movetime}`);
      return parseBestMove(line);
    };
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => undefined);
    return result;
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    this.ready = null;
    this.waiting = null;
  }
}
