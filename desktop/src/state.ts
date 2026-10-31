/** State the web client reports to the desktop shell for the tray. */
export interface WebClientState {
  connected: boolean;
  micMuted: boolean;
  soundMuted: boolean;
  streaming: boolean;
}

export function parseWebClientState(value: unknown): WebClientState | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  const keys = ["connected", "micMuted", "soundMuted", "streaming"] as const;
  if (!keys.every((key) => typeof input[key] === "boolean")) return null;
  return { connected: input.connected as boolean, micMuted: input.micMuted as boolean, soundMuted: input.soundMuted as boolean, streaming: input.streaming as boolean };
}
