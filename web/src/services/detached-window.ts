/**
 * A plain same-origin window that part of the page can be moved into (Vue
 * Teleport), so it keeps running on the page's own state and connection.
 * The page's stylesheets, theme attributes and colour variables are copied in.
 */

export interface DetachedWindowOptions {
  name: string;
  title: string;
  width: number;
  height: number;
  /** An element whose computed colour variables the window should inherit. */
  themeSource?: Element | null;
  /** Custom properties to carry over from `themeSource`. */
  variables?: readonly string[];
}

/** Must be called from a click: browsers only open windows on a user gesture. */
export function openDetachedWindow(options: DetachedWindowOptions, opener: Window = window): Window | null {
  const left = Math.max(0, Math.round(opener.screenX + (opener.outerWidth - options.width) / 2));
  const top = Math.max(0, Math.round(opener.screenY + (opener.outerHeight - options.height) / 2));
  let popup: Window | null = null;
  try {
    popup = opener.open("", options.name, `popup=yes,width=${options.width},height=${options.height},left=${left},top=${top}`);
  } catch {
    popup = null;
  }
  if (!popup) return null;
  try {
    prepareWindow(popup, opener, options);
  } catch {
    try { popup.close(); } catch { /* nothing to close */ }
    return null;
  }
  return popup;
}

function prepareWindow(popup: Window, opener: Window, options: DetachedWindowOptions): void {
  const doc = popup.document;
  const source = opener.document;
  // A window reused by name may still hold an earlier board.
  doc.head.replaceChildren();
  doc.body.replaceChildren();
  doc.title = options.title;
  const charset = doc.createElement("meta");
  charset.setAttribute("charset", "utf-8");
  doc.head.append(charset);

  // Stylesheets are copied as text: a <link> in a blank window does not reliably
  // load. A sheet that cannot be read (another origin) is linked instead.
  for (const sheet of [...source.styleSheets]) {
    let text = "";
    try {
      text = [...sheet.cssRules].map(rule => rule.cssText).join("\n");
    } catch {
      text = "";
    }
    if (text) {
      const style = doc.createElement("style");
      style.textContent = text;
      doc.head.append(style);
    } else if (sheet.href) {
      const link = doc.createElement("link");
      link.rel = "stylesheet";
      link.href = sheet.href;
      doc.head.append(link);
    }
  }

  // Theme switches live on <html> (data-theme, data-ws-route, classes, colour scheme).
  for (const attribute of [...source.documentElement.attributes]) {
    try { doc.documentElement.setAttribute(attribute.name, attribute.value); } catch { /* invalid in this document */ }
  }
  doc.documentElement.style.cssText = source.documentElement.style.cssText;
  doc.documentElement.style.colorScheme = opener.getComputedStyle(source.documentElement).colorScheme;

  const body = doc.body;
  body.style.margin = "0";
  body.style.minHeight = "100vh";
  body.style.background = opener.getComputedStyle(source.body).backgroundColor;
  const themeSource = options.themeSource ?? source.body;
  const computed = opener.getComputedStyle(themeSource);
  for (const name of options.variables ?? []) {
    const value = computed.getPropertyValue(name);
    if (value) body.style.setProperty(name, value);
  }
}
