import { randomInt } from "node:crypto";
import { chatCommandLanguage, MAX_TIMERS, parseChatCommand, runChatCommand, timerStoppedMessage } from "../shared/chat-commands.js";

/*
 * One session's chat commands. The gateway rolls the dice and the session's
 * own TeamSpeak client sends the result, so everyone (native clients too)
 * sees the same message. Timers belong to the session and end with it.
 */

export type ChatPlace = { scope: "channel" } | { scope: "server" } | { scope: "private"; clientId: number };

export interface ChatCommandRunnerOptions {
  /** Sends a message from the session's client: the channel it is in now, the server, or the private recipient. */
  send(place: ChatPlace, message: string): Promise<{ channelId?: string; ref?: string } | void>;
  /** A timer rang: tell the owner's own page, which does not get its own messages back from TeamSpeak. */
  notifyOwner(place: ChatPlace, message: string, sent: { channelId?: string; ref?: string } | void): void;
  rollDie?: (sides: number) => number;
  now?: () => number;
  setTimer?: (callback: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
}

export type ChatCommandResult = { message: string } | { error: string } | null;

export class ChatCommandRunner {
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private closed = false;

  constructor(private readonly options: ChatCommandRunnerOptions) {}

  /**
   * The text to send instead of `message`, an error code, or null when the
   * message is not a gateway command (it is then sent as written).
   */
  run(message: string, place: ChatPlace, language: unknown, tzOffset: unknown): ChatCommandResult {
    const command = parseChatCommand(message);
    if (!command || command.name === "help") return null;
    if (command.name === null) return { error: "CHAT_COMMAND_UNKNOWN" };
    const lang = chatCommandLanguage(language);
    const now = this.options.now?.() ?? Date.now();
    const tz = typeof tzOffset === "number" && Number.isFinite(tzOffset) && Math.abs(tzOffset) <= 840 ? tzOffset : 0;
    const outcome = runChatCommand(command.name, command.args, { language: lang, now, tzOffset: tz, rollDie: this.options.rollDie ?? (sides => randomInt(1, sides + 1)) });
    switch (outcome.kind) {
      case "error":
        return { error: outcome.code };
      case "message":
        return { message: outcome.message };
      case "timerStop": {
        if (!this.timers.size) return { error: "CHAT_COMMAND_TIMER_NONE" };
        const count = this.timers.size;
        this.stopAll();
        return { message: timerStoppedMessage(count, lang) };
      }
      case "timer": {
        if (place.scope === "private") return { error: "CHAT_COMMAND_TIMER_PRIVATE" };
        if (this.timers.size >= MAX_TIMERS) return { error: "CHAT_COMMAND_TIMER_LIMIT" };
        const set = this.options.setTimer ?? setTimeout;
        const timer = set(() => {
          this.timers.delete(timer);
          if (this.closed) return;
          this.options.send(place, outcome.doneMessage)
            .then(sent => { if (!this.closed) this.options.notifyOwner(place, outcome.doneMessage, sent); })
            .catch(() => undefined);
        }, outcome.delayMs);
        (timer as { unref?: () => void }).unref?.();
        this.timers.add(timer);
        return { message: outcome.message };
      }
    }
  }

  activeTimers(): number {
    return this.timers.size;
  }

  close(): void {
    this.closed = true;
    this.stopAll();
  }

  private stopAll(): void {
    const clear = this.options.clearTimer ?? clearTimeout;
    for (const timer of this.timers) clear(timer);
    this.timers.clear();
  }
}
