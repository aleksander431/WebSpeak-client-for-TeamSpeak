import type { OverlaySettings } from "./settings.js";

/*
 * What the web page tells the overlay. The roster (who is in the channel)
 * changes rarely and may carry avatars; who is talking changes many times a
 * second and is sent on its own, as bare ids.
 */

export interface OverlayMember {
  id: number;
  name: string;
  /** Microphone or sound muted. */
  muted: boolean;
  self: boolean;
  /** Sharing a screen or window right now. */
  streaming?: boolean;
  /** data:image URL, when TeamSpeak has an avatar for the member. */
  avatar?: string;
}

export interface OverlayRoster {
  connected: boolean;
  channel: string;
  members: OverlayMember[];
}

export const EMPTY_ROSTER: OverlayRoster = Object.freeze({ connected: false, channel: "", members: [] }) as OverlayRoster;

const MAX_MEMBERS = 64;
const MAX_AVATAR_LENGTH = 200_000;
const clientId = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 65535;

export function parseOverlayRoster(value: unknown): OverlayRoster | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  if (typeof input.connected !== "boolean" || !Array.isArray(input.members)) return null;
  const members: OverlayMember[] = [];
  for (const item of input.members.slice(0, MAX_MEMBERS)) {
    if (!item || typeof item !== "object") continue;
    const member = item as Record<string, unknown>;
    if (!clientId(member.id) || typeof member.name !== "string") continue;
    const avatar = typeof member.avatar === "string" && member.avatar.length <= MAX_AVATAR_LENGTH
      && /^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(member.avatar) ? member.avatar : undefined;
    members.push({ id: member.id, name: member.name.slice(0, 64), muted: member.muted === true, self: member.self === true, ...(member.streaming === true ? { streaming: true } : {}), ...(avatar ? { avatar } : {}) });
  }
  return { connected: input.connected, channel: typeof input.channel === "string" ? input.channel.slice(0, 128) : "", members };
}

export function parseOverlaySpeaking(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null;
  return [...new Set(value.filter(clientId))].slice(0, MAX_MEMBERS);
}

/**
 * Where the overlay goes on a screen: its corner or the middle of a side, inset by the offsets
 * from the edges it touches (along a centred axis the offset shifts it right or down), kept on the screen.
 */
export function overlayBounds(display: { x: number; y: number; width: number; height: number }, settings: Pick<OverlaySettings, "corner" | "offsetX" | "offsetY">, width: number, height: number) {
  const w = Math.min(width, display.width);
  const h = Math.min(height, display.height);
  const [vertical, horizontal] = settings.corner.split("-");
  const x = horizontal === "left" ? display.x + settings.offsetX
    : horizontal === "right" ? display.x + display.width - settings.offsetX - w
      : display.x + (display.width - w) / 2 + settings.offsetX;
  const y = vertical === "top" ? display.y + settings.offsetY
    : vertical === "bottom" ? display.y + display.height - settings.offsetY - h
      : display.y + (display.height - h) / 2 + settings.offsetY;
  return {
    x: Math.round(Math.max(display.x, Math.min(display.x + display.width - w, x))),
    y: Math.round(Math.max(display.y, Math.min(display.y + display.height - h, y))),
    width: Math.round(w),
    height: Math.round(h),
  };
}

/** The active window, as the native helper reports it; null while unknown. */
export interface ForegroundWindow {
  fullscreen: boolean;
  /** Program file name, lower case ("" when unknown). */
  exe: string;
}

/** Full-screen browsers and video players are not games. */
export const OVERLAY_NOT_GAMES: ReadonlySet<string> = new Set([
  "chrome.exe", "msedge.exe", "firefox.exe", "opera.exe", "opera_gx.exe", "brave.exe", "vivaldi.exe", "browser.exe", "yandex.exe",
  "iexplore.exe", "arc.exe", "thorium.exe", "librewolf.exe", "waterfox.exe",
  "vlc.exe", "mpc-hc.exe", "mpc-hc64.exe", "mpc-be.exe", "mpc-be64.exe", "potplayermini.exe", "potplayermini64.exe", "mpv.exe",
  "wmplayer.exe", "video.ui.exe", "microsoft.media.player.exe", "applicationframehost.exe", "powerpnt.exe", "explorer.exe",
  "webspeak.exe",
]);

/**
 * Whether the overlay should be visible now. Without foreground information
 * (no helper, not Windows) it shows, as before the setting existed.
 */
export function overlayWanted(settings: Pick<OverlaySettings, "enabled" | "showWhen" | "apps">, foreground: ForegroundWindow | null): boolean {
  if (!settings.enabled) return false;
  if (settings.showWhen === "always" || !foreground) return true;
  if (foreground.exe && settings.apps.includes(foreground.exe)) return true;
  return foreground.fullscreen && !OVERLAY_NOT_GAMES.has(foreground.exe);
}
