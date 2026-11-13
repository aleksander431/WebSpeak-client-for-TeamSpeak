import type { ClientCommandPayloads, ClientCommandType } from "../../../src/shared/client-commands.js";

interface CommandOptions {
  socket(): WebSocket | null;
  generation(): number;
}

/** What a completed command may report back (a sent chat message's reaction reference). */
export interface CommandResult {
  chatRef?: string;
  /** What the gateway sent instead of the typed text (a slash command's result). */
  sentMessage?: string;
}

interface PendingCommand {
  isCurrent(): boolean;
  finish(error?: unknown, result?: CommandResult): void;
}

// Every outcome goes through the same finish operation, including a synchronous
// send error. Neither stale replies nor queued deadlines can finish a successor.
export function createVoiceCommands(options: CommandOptions) {
  const pending = new Map<string, PendingCommand>();
  let sequence = 0;

  function send<K extends ClientCommandType>(type: K, payload: ClientCommandPayloads[K]): void {
    const socket = options.socket();
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type, payload }));
  }

  function sendAndWait<K extends ClientCommandType>(type: K, payload: ClientCommandPayloads[K], timeoutMs = 8_000): Promise<void> {
    return sendForResult(type, payload, timeoutMs).then(() => undefined);
  }

  function sendForResult<K extends ClientCommandType>(type: K, payload: ClientCommandPayloads[K], timeoutMs = 8_000): Promise<CommandResult> {
    const socket = options.socket();
    if (!socket || socket.readyState !== WebSocket.OPEN) return Promise.reject(new Error("语音连接尚未就绪"));
    const generation = options.generation();
    const requestId = `command-${Date.now().toString(36)}-${(sequence++).toString(36)}`;
    return new Promise<CommandResult>((resolve, reject) => {
      let settled = false;
      const finish = (error?: unknown, result: CommandResult = {}): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        pending.delete(requestId);
        if (error !== undefined) reject(error);
        else resolve(result);
      };
      const timer = setTimeout(() => finish(new Error("操作超时，请稍后重试")), timeoutMs);
      pending.set(requestId, {
        isCurrent: () => options.socket() === socket && options.generation() === generation,
        finish,
      });
      try { socket.send(JSON.stringify({ type, payload, requestId })); }
      catch (error) { finish(error instanceof Error ? error : new Error(String(error))); }
    });
  }

  return {
    send, sendAndWait, sendForResult,
    settle(requestId: string, error?: Error, result?: CommandResult): void {
      const command = pending.get(requestId);
      if (command) command.finish(command.isCurrent() ? error : new Error("语音连接已关闭"), result);
    },
    clear(error: Error): void {
      for (const command of pending.values()) command.finish(error);
    },
  };
}
