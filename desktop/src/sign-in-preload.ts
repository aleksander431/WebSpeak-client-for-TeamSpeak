import { webFrame } from "electron";

/*
 * The YouTube sign-in window presents itself as Firefox (Google refuses
 * sign-in in "embedded browsers", and a Chromium-based window is recognised
 * by more than its user agent). Before the page's own scripts run, the page
 * world loses what only Chromium has: user-agent client hints, `window.chrome`
 * and Google's vendor string. The preload itself exposes nothing to the page.
 */
void webFrame.executeJavaScript(`(() => {
  try { Object.defineProperty(Navigator.prototype, "userAgentData", { get: () => undefined, configurable: true }); } catch {}
  try { Object.defineProperty(Navigator.prototype, "vendor", { get: () => "", configurable: true }); } catch {}
  try { delete window.chrome; } catch {}
})();`);
