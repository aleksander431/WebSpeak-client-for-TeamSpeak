/*
 * Signing in to YouTube inside the app. The embedded player of "watch
 * together" sometimes asks to sign in ("confirm you're not a bot"); its
 * button would open the normal browser, whose cookies the app never sees.
 * Instead the sign-in opens in an app window that shares the app's cookies,
 * and once it lands back on YouTube the window closes and the players reload.
 */

const SIGN_IN_HOSTS = new Set(["accounts.google.com", "accounts.youtube.com"]);
const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com"]);

function parse(url: string): URL | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" ? parsed : null;
  } catch {
    return null;
  }
}

/** A link that starts a Google or YouTube sign-in. */
export function isSignInUrl(url: string): boolean {
  const parsed = parse(url);
  if (!parsed) return false;
  if (SIGN_IN_HOSTS.has(parsed.hostname)) return true;
  return YOUTUBE_HOSTS.has(parsed.hostname) && /^\/(signin|login)\b/i.test(parsed.pathname);
}

/** Pages the sign-in window may move through: Google's sign-in and its checks, and YouTube. */
export function staysInSignIn(url: string): boolean {
  const parsed = parse(url);
  if (!parsed) return false;
  const host = parsed.hostname;
  return host === "google.com" || host.endsWith(".google.com") || host.endsWith(".youtube.com") || host === "youtube.com"
    || host.endsWith(".gstatic.com") || /^(www\.)?google\.[a-z.]{2,6}$/.test(host);
}

/** Back on YouTube after signing in: the window has done its job. */
export function signInFinished(url: string): boolean {
  const parsed = parse(url);
  return !!parsed && YOUTUBE_HOSTS.has(parsed.hostname) && !/^\/(signin|login)\b/i.test(parsed.pathname);
}

/** An embedded YouTube player frame that should reload after signing in. */
export function isYouTubePlayerFrame(url: string): boolean {
  const parsed = parse(url);
  return !!parsed && (YOUTUBE_HOSTS.has(parsed.hostname) || parsed.hostname === "www.youtube-nocookie.com") && parsed.pathname.startsWith("/embed/");
}

/** Google refuses sign-in in "embedded browsers", so the window presents itself as the Chrome it is built on. */
export function plainChromeUserAgent(platform: NodeJS.Platform, chromeVersion: string): string {
  const major = chromeVersion.split(".")[0] || "120";
  const system = platform === "win32" ? "Windows NT 10.0; Win64; x64"
    : platform === "darwin" ? "Macintosh; Intel Mac OS X 10_15_7"
    : "X11; Linux x86_64";
  return `Mozilla/5.0 (${system}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
}

export const YOUTUBE_SIGN_IN_URL = "https://accounts.google.com/ServiceLogin?service=youtube&continue=https%3A%2F%2Fwww.youtube.com%2F";
