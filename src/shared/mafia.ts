/*
 * Mafia in the voice channel (`mafia*` frames). The gateway is the host: it
 * deals the roles in secret, collects the night's choices, announces the
 * morning, counts the votes and decides who won. People talk in the channel;
 * the table only carries what must stay secret or be counted fairly.
 */

export type MafiaRole = "citizen" | "mafia" | "don" | "doctor" | "detective" | "maniac" | "mistress";
export type MafiaPhase = "lobby" | "night" | "day" | "vote" | "over";
export type MafiaSide = "town" | "mafia" | "maniac";

/** The don is one of the mafia: he votes on the victim with them and also looks for the detective. */
export const isMafiaSide = (role: MafiaRole | null | undefined): boolean => role === "mafia" || role === "don";

export const MAFIA_MIN_PLAYERS = 4;
export const MAFIA_MAX_PLAYERS = 16;
export const MAFIA_NIGHT_SECONDS = [0, 30, 60, 90, 120] as const;
export const MAFIA_DAY_SECONDS = [0, 60, 120, 180, 300] as const;
export const MAFIA_VOTE_SECONDS = [0, 30, 60, 90] as const;
export const MAFIA_CHAT_MAX_LENGTH = 300;
export const MAFIA_CHAT_KEEP = 50;

export interface MafiaSettings {
  /** 0 picks the number from the player count (`mafiaCountFor`). */
  mafia: number;
  doctor: boolean;
  detective: boolean;
  /** One of the mafia is the don. */
  don: boolean;
  /** A maniac who kills alone and wins alone. */
  maniac: boolean;
  /** A mistress whose night visit cancels that player's own night action. */
  mistress: boolean;
  /** Show the role of everyone who dies. */
  reveal: boolean;
  nightSeconds: number;
  daySeconds: number;
  voteSeconds: number;
}

export const DEFAULT_MAFIA_SETTINGS: MafiaSettings = { mafia: 0, doctor: true, detective: true, don: false, maniac: false, mistress: false, reveal: true, nightSeconds: 60, daySeconds: 180, voteSeconds: 60 };

/** About a third of the table, at least one. */
export const mafiaCountFor = (players: number): number => Math.max(1, Math.floor(players / 3));

/** How many mafia a game with these settings deals, or null when the table cannot be dealt. */
export function dealtMafia(players: number, settings: MafiaSettings): number | null {
  if (players < MAFIA_MIN_PLAYERS || players > MAFIA_MAX_PLAYERS) return null;
  const mafia = settings.mafia || mafiaCountFor(players);
  const special = Number(settings.doctor) + Number(settings.detective) + Number(settings.maniac) + Number(settings.mistress);
  // The town must outnumber the mafia at the start, or the game is over before it begins.
  if (mafia < 1 || mafia * 2 >= players || mafia + special > players) return null;
  return mafia;
}

export type MafiaLogEntry =
  | { kind: "start"; players: number; mafia: number }
  | { kind: "night"; round: number }
  | { kind: "killed"; round: number; name: string; role: MafiaRole | null }
  | { kind: "quiet"; round: number }
  | { kind: "executed"; round: number; name: string; role: MafiaRole | null; votes: number }
  | { kind: "spared"; round: number }
  | { kind: "left"; name: string; role: MafiaRole | null }
  | { kind: "win"; side: MafiaSide };

export interface MafiaPlayerView {
  id: string;
  name: string;
  online: boolean;
  alive: boolean;
  /** Known to this viewer: their own, teammates, the revealed dead, or everyone once the game is over. */
  role: MafiaRole | null;
  you: boolean;
  host: boolean;
  /** Open voting: whom this player votes for ("skip" to vote for nobody). */
  vote: string | null;
}

export interface MafiaRoomView {
  id: string;
  phase: MafiaPhase;
  round: number;
  /** Milliseconds left in this phase at the moment of sending, or null without a time limit. */
  endsIn: number | null;
  settings: MafiaSettings;
  players: MafiaPlayerView[];
  /** Your player id, or null for an onlooker. */
  you: string | null;
  youHost: boolean;
  /** Your own night choice this night (target id), once made. */
  acted: string | null;
  /** What only you know at night. */
  secret: {
    /** Mafia: each teammate's current pick. */
    picks?: Array<{ from: string; to: string }>;
    /** Doctor: whom you healed last night (you cannot heal them twice in a row). */
    lastHeal?: string | null;
    /** Detective: what your checks found (each night's answer comes in the morning; a visited detective learns nothing). */
    checks?: Array<{ round: number; target: string; mafia: boolean | null }>;
    /** Don: whom you checked for the detective. */
    donChecks?: Array<{ round: number; target: string; detective: boolean | null }>;
    /** Don: your search for the detective tonight, once chosen. */
    donCheck?: string | null;
    /** Mistress: whom you visited last night (not the same one twice in a row). */
    lastVisit?: string | null;
  };
  /** The mafia's own text chat (mafia only). */
  chat: Array<{ from: string; text: string; at: number }>;
  log: MafiaLogEntry[];
  winner: MafiaSide | null;
  spectators: string[];
}

export type MafiaClientMessage =
  | { type: "mafiaOpen" }
  | { type: "mafiaClose" }
  | { type: "mafiaJoin" }
  | { type: "mafiaLeave" }
  | { type: "mafiaSettings"; settings: MafiaSettings }
  | { type: "mafiaKick"; player: string }
  | { type: "mafiaStart" }
  | { type: "mafiaAct"; id: string; target: string; ability?: "check" }
  | { type: "mafiaVote"; id: string; target: string }
  | { type: "mafiaAdvance"; id: string }
  | { type: "mafiaChat"; id: string; text: string }
  | { type: "mafiaHost" }
  | { type: "mafiaReset" };

export type MafiaServerMessage =
  | { type: "mafiaState"; room: MafiaRoomView }
  | { type: "mafiaError"; code: string };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const shortId = (value: unknown): string | null => typeof value === "string" && /^[A-Za-z0-9_-]{1,32}$/.test(value) ? value : null;
const pick = <T extends readonly number[]>(value: unknown, allowed: T): number | null => (allowed as readonly unknown[]).includes(value) ? value as number : null;

export function parseMafiaSettings(value: unknown): MafiaSettings | null {
  if (!isRecord(value)) return null;
  const mafia = value.mafia;
  const nightSeconds = pick(value.nightSeconds, MAFIA_NIGHT_SECONDS);
  const daySeconds = pick(value.daySeconds, MAFIA_DAY_SECONDS);
  const voteSeconds = pick(value.voteSeconds, MAFIA_VOTE_SECONDS);
  const optional = (flag: unknown) => flag === undefined ? false : typeof flag === "boolean" ? flag : null;
  const don = optional(value.don);
  const maniac = optional(value.maniac);
  const mistress = optional(value.mistress);
  if (typeof mafia !== "number" || !Number.isInteger(mafia) || mafia < 0 || mafia > 5 || typeof value.doctor !== "boolean" || typeof value.detective !== "boolean"
    || typeof value.reveal !== "boolean" || nightSeconds === null || daySeconds === null || voteSeconds === null || don === null || maniac === null || mistress === null) return null;
  return { mafia, doctor: value.doctor, detective: value.detective, don, maniac, mistress, reveal: value.reveal, nightSeconds, daySeconds, voteSeconds };
}

/** A decoded frame as a mafia message, an error for a malformed mafia frame, or null for any other frame. */
export function parseMafiaClientMessage(value: unknown): MafiaClientMessage | { error: { code: string } } | null {
  if (!isRecord(value) || typeof value.type !== "string" || !value.type.startsWith("mafia")) return null;
  const invalid = { error: { code: "INVALID_MAFIA_MESSAGE" } };
  switch (value.type) {
    case "mafiaOpen": case "mafiaClose": case "mafiaJoin": case "mafiaLeave": case "mafiaStart": case "mafiaHost": case "mafiaReset":
      return { type: value.type };
    case "mafiaSettings": {
      const settings = parseMafiaSettings(value.settings);
      return settings ? { type: "mafiaSettings", settings } : invalid;
    }
    case "mafiaKick": {
      const player = shortId(value.player);
      return player ? { type: "mafiaKick", player } : invalid;
    }
    case "mafiaAct": {
      const id = shortId(value.id);
      const target = shortId(value.target);
      if (!id || !target || (value.ability !== undefined && value.ability !== "check")) return invalid;
      return { type: "mafiaAct", id, target, ...(value.ability === "check" ? { ability: "check" as const } : {}) };
    }
    case "mafiaVote": {
      const id = shortId(value.id);
      const target = shortId(value.target);
      return id && target ? { type: value.type, id, target } : invalid;
    }
    case "mafiaAdvance": {
      const id = shortId(value.id);
      return id ? { type: "mafiaAdvance", id } : invalid;
    }
    case "mafiaChat": {
      const id = shortId(value.id);
      if (!id || typeof value.text !== "string") return invalid;
      const text = value.text.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, MAFIA_CHAT_MAX_LENGTH);
      return text ? { type: "mafiaChat", id, text } : invalid;
    }
    default:
      return invalid;
  }
}

const ROLES = new Set<MafiaRole>(["citizen", "mafia", "don", "doctor", "detective", "maniac", "mistress"]);
const role = (value: unknown): MafiaRole | null => ROLES.has(value as MafiaRole) ? value as MafiaRole : null;

/** The browser's check of what the gateway sends. */
export function parseMafiaServerMessage(value: unknown): MafiaServerMessage | null {
  if (!isRecord(value)) return null;
  if (value.type === "mafiaError") return typeof value.code === "string" ? { type: "mafiaError", code: value.code } : null;
  if (value.type !== "mafiaState" || !isRecord(value.room)) return null;
  const room = value.room;
  const settings = parseMafiaSettings(room.settings);
  if (typeof room.id !== "string" || !["lobby", "night", "day", "vote", "over"].includes(String(room.phase)) || typeof room.round !== "number"
    || !settings || !Array.isArray(room.players) || !Array.isArray(room.log) || !Array.isArray(room.chat) || !Array.isArray(room.spectators)) return null;
  const players: MafiaPlayerView[] = [];
  for (const item of room.players) {
    if (!isRecord(item) || typeof item.id !== "string" || typeof item.name !== "string") return null;
    players.push({
      id: item.id, name: item.name, online: item.online === true, alive: item.alive === true, role: role(item.role),
      you: item.you === true, host: item.host === true, vote: typeof item.vote === "string" ? item.vote : null,
    });
  }
  const secret = isRecord(room.secret) ? room.secret : {};
  return {
    type: "mafiaState",
    room: {
      id: room.id, phase: room.phase as MafiaPhase, round: room.round, endsIn: typeof room.endsIn === "number" ? room.endsIn : null, settings, players,
      you: typeof room.you === "string" ? room.you : null, youHost: room.youHost === true, acted: typeof room.acted === "string" ? room.acted : null,
      secret: {
        ...(Array.isArray(secret.picks) ? { picks: secret.picks.filter((p): p is { from: string; to: string } => isRecord(p) && typeof p.from === "string" && typeof p.to === "string") } : {}),
        ...("lastHeal" in secret ? { lastHeal: typeof secret.lastHeal === "string" ? secret.lastHeal : null } : {}),
        ...(Array.isArray(secret.checks) ? { checks: secret.checks.filter((c): c is { round: number; target: string; mafia: boolean | null } => isRecord(c) && typeof c.round === "number" && typeof c.target === "string" && (typeof c.mafia === "boolean" || c.mafia === null)) } : {}),
        ...(Array.isArray(secret.donChecks) ? { donChecks: secret.donChecks.filter((c): c is { round: number; target: string; detective: boolean | null } => isRecord(c) && typeof c.round === "number" && typeof c.target === "string" && (typeof c.detective === "boolean" || c.detective === null)) } : {}),
        ...("donCheck" in secret ? { donCheck: typeof secret.donCheck === "string" ? secret.donCheck : null } : {}),
        ...("lastVisit" in secret ? { lastVisit: typeof secret.lastVisit === "string" ? secret.lastVisit : null } : {}),
      },
      chat: room.chat.filter((m): m is { from: string; text: string; at: number } => isRecord(m) && typeof m.from === "string" && typeof m.text === "string" && typeof m.at === "number"),
      log: room.log.filter((entry): entry is MafiaLogEntry => isRecord(entry) && typeof entry.kind === "string"),
      winner: room.winner === "town" || room.winner === "mafia" || room.winner === "maniac" ? room.winner : null,
      spectators: room.spectators.filter((name): name is string => typeof name === "string"),
    },
  };
}
