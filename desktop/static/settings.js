(async () => {
  const api = window.webspeakSettings;
  let snapshot = await api.get();
  if (!snapshot) return;
  const strings = snapshot.strings;
  const t = (key, variables = {}) => (strings[key] || key).replace(/\{(\w+)\}/g, (_, name) => variables[name] ?? "");
  document.title = t("settingsTitle");
  for (const element of document.querySelectorAll("[data-t]")) element.textContent = t(element.dataset.t);

  const $ = (id) => document.getElementById(id);
  for (const element of document.querySelectorAll("[data-placeholder]")) element.placeholder = t(element.dataset.placeholder);
  $("brandVersion").textContent = t("version", { version: snapshot.version });

  // --- pages and search ---------------------------------------------------
  const PAGE_KEY = "webspeak:settings-page";
  const navButtons = [...document.querySelectorAll("nav button[data-page]")];
  const sections = [...document.querySelectorAll(".pages > section[data-page]")];
  const pageLabel = (page) => navButtons.find((button) => button.dataset.page === page)?.querySelector("span")?.textContent || "";
  let page = (() => { try { return localStorage.getItem(PAGE_KEY) || ""; } catch { return ""; } })();
  if (!navButtons.some((button) => button.dataset.page === page)) page = navButtons[0].dataset.page;
  const fold = (text) => text.toLocaleLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ");
  function showPage(next) {
    page = next;
    try { localStorage.setItem(PAGE_KEY, page); } catch { /* per session only */ }
    if ($("search").value) { $("search").value = ""; }
    render();
    $("form").querySelector(".pages").scrollTop = 0;
  }
  function render() {
    const query = fold($("search").value.trim());
    const nav = $("nav");
    nav.classList.toggle("searching", Boolean(query));
    $("form").classList.toggle("searching-results", Boolean(query));
    const counts = new Map();
    let total = 0;
    for (const section of sections) {
      const items = [...section.querySelectorAll("[data-item]")];
      for (const item of items) item.classList.remove("search-hidden", "match");
      for (const child of section.children) child.classList.remove("search-hidden");
      if (!query) { section.classList.toggle("search-hidden", section.dataset.page !== page); continue; }
      const titleMatch = fold(section.querySelector("h2")?.textContent || "").includes(query) || fold(pageLabel(section.dataset.page)).includes(query);
      let found = 0;
      for (const item of items) {
        const text = fold(`${item.textContent} ${item.dataset.keywords || ""}`);
        const match = text.includes(query);
        item.classList.toggle("match", match);
        item.classList.toggle("search-hidden", !match && !titleMatch);
        if (match) found += 1;
      }
      // Hints and other text without a setting of their own stay with a matching title only.
      if (!titleMatch) for (const child of section.children) if (child.tagName !== "H2" && !child.matches("[data-item]") && !child.querySelector("[data-item]")) child.classList.add("search-hidden");
      const visible = titleMatch || found > 0;
      section.classList.toggle("search-hidden", !visible);
      const hits = titleMatch ? Math.max(found, 1) : found;
      if (visible) { counts.set(section.dataset.page, (counts.get(section.dataset.page) || 0) + hits); total += hits; }
    }
    for (const button of navButtons) {
      const count = counts.get(button.dataset.page) || 0;
      button.classList.toggle("match", count > 0);
      button.querySelector(".count").textContent = count ? String(count) : "";
      if (query) button.removeAttribute("aria-current");
      else if (button.dataset.page === page) { button.setAttribute("aria-current", "page"); button.scrollIntoView({ block: "nearest", inline: "nearest" }); }
      else button.removeAttribute("aria-current");
    }
    $("pageTitle").textContent = query ? t("searchResults") : pageLabel(page);
    $("searchEmpty").hidden = !query || total > 0;
  }
  for (const button of navButtons) button.addEventListener("click", () => showPage(button.dataset.page));
  $("search").addEventListener("input", render);
  $("search").addEventListener("keydown", (event) => {
    if (event.key === "Escape" && $("search").value) { event.preventDefault(); event.stopPropagation(); $("search").value = ""; render(); }
    if (event.key === "Enter") event.preventDefault();
  });
  document.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f" && !listening) { event.preventDefault(); $("search").focus(); $("search").select(); }
  });
  const actions = [["mic", "hotkeyMic"], ["sound", "hotkeySound"], ["stream", "hotkeyStream"]];
  const draft = { hotkeys: { ...snapshot.settings.hotkeys }, pushToTalk: snapshot.settings.pushToTalk || "", whisper: snapshot.settings.whisper || "" };
  // Keys that act while held: push-to-talk and whisper. Field in the draft and settings, plus strings.
  const HOLDS = {
    ptt: { field: "pushToTalk", container: "ptt", name: "pttKey", active: "pttActive", taken: "pttTaken", unsupported: "pttUnsupported" },
    whisper: { field: "whisper", container: "whisperHotkey", name: "whisperKey", active: "whisperActive", taken: "pttTaken", unsupported: "pttUnsupported" },
  };
  const isHold = (slot) => Object.prototype.hasOwnProperty.call(HOLDS, slot);
  let listening = null;

  // --- accelerators -------------------------------------------------------
  const CODE_KEYS = {
    Space: "Space", Tab: "Tab", Backspace: "Backspace", Delete: "Delete", Insert: "Insert", Enter: "Enter", NumpadEnter: "Enter",
    ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right", Home: "Home", End: "End", PageUp: "PageUp", PageDown: "PageDown",
    Backquote: "`", Minus: "-", Equal: "=", BracketLeft: "[", BracketRight: "]", Backslash: "\\", Semicolon: ";", Quote: "'", Comma: ",", Period: ".", Slash: "/",
    CapsLock: "Capslock", NumLock: "Numlock", ScrollLock: "Scrolllock", PrintScreen: "PrintScreen", Pause: "Pause",
    NumpadDecimal: "numdec", NumpadAdd: "numadd", NumpadSubtract: "numsub", NumpadMultiply: "nummult", NumpadDivide: "numdiv",
    MediaPlayPause: "MediaPlayPause", MediaTrackNext: "MediaNextTrack", MediaTrackPrevious: "MediaPreviousTrack", MediaStop: "MediaStop",
    AudioVolumeUp: "VolumeUp", AudioVolumeDown: "VolumeDown", AudioVolumeMute: "VolumeMute",
  };
  function keyFromCode(code) {
    if (/^Key[A-Z]$/.test(code)) return code.slice(3);
    if (/^Digit[0-9]$/.test(code)) return code.slice(5);
    if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code;
    if (/^Numpad[0-9]$/.test(code)) return `num${code.slice(6)}`;
    return CODE_KEYS[code] || null;
  }
  function modifiersOf(event) {
    const parts = [];
    if (event.ctrlKey) parts.push("CommandOrControl");
    if (event.altKey) parts.push("Alt");
    if (event.shiftKey) parts.push("Shift");
    if (event.metaKey) parts.push("Super");
    return parts;
  }
  function acceleratorFrom(event) {
    const key = keyFromCode(event.code);
    if (!key) return null;
    return [...modifiersOf(event), key].join("+");
  }
  // Same rule as the main process: typing keys need a modifier, other keys may stand alone.
  const TYPING_KEYS = /^(?:[A-Z0-9]|Space|Tab|Backspace|Delete|Enter|Up|Down|Left|Right|Home|End|[`\-=[\]\\;',./])$/;
  function isValid(accelerator) {
    if (!accelerator) return true;
    const parts = accelerator.split("+");
    return parts.length > 1 || !TYPING_KEYS.test(parts[parts.length - 1]);
  }
  const MODIFIER_CODES = /^(Control|Shift|Alt|Meta|OS)(Left|Right)?$/;
  const NAMES = { Mouse3: t("mouseMiddle"), Mouse4: t("mouseBack"), Mouse5: t("mouseForward"), numdec: "Num .", numadd: "Num +", numsub: "Num −", nummult: "Num *", numdiv: "Num /", Capslock: "Caps Lock", Numlock: "Num Lock", Scrolllock: "Scroll Lock", PrintScreen: "Print Screen", PageUp: "Page Up", PageDown: "Page Down" };
  const label = (accelerator) => accelerator.split("+").map((part) => part === "CommandOrControl" ? "Ctrl" : part === "Super" ? "Win"
    : /^num[0-9]$/.test(part) ? `Num ${part.slice(3)}` : NAMES[part] || part).join(" + ");

  // --- hotkey rows --------------------------------------------------------
  const rows = {};
  for (const [action, key] of actions) {
    const row = document.createElement("div");
    row.className = "hotkey";
    row.dataset.item = "";
    const name = document.createElement("span");
    name.textContent = t(key);
    const capture = document.createElement("button");
    capture.type = "button";
    capture.className = "capture";
    const clear = document.createElement("button");
    clear.type = "button";
    clear.className = "button";
    clear.textContent = t("hotkeyClear");
    const status = document.createElement("p");
    status.className = "status hint";
    row.append(name, capture, clear, status);
    $("hotkeys").append(row);
    rows[action] = { capture, status };
    capture.addEventListener("click", () => startListening(action));
    clear.addEventListener("click", () => { stopListening(); draft.hotkeys[action] = ""; renderHotkeys(); });
  }
  // Held keys: one key held down. They are not taken from other programs, so
  // any key works on its own, including letters and Ctrl/Alt/Shift.
  for (const [slot, hold] of Object.entries(HOLDS)) {
    const row = document.createElement("div");
    row.className = "hotkey";
    row.dataset.item = "";
    const name = document.createElement("span");
    name.textContent = t(hold.name);
    const capture = document.createElement("button");
    capture.type = "button";
    capture.className = "capture";
    const clear = document.createElement("button");
    clear.type = "button";
    clear.className = "button";
    clear.textContent = t("hotkeyClear");
    const status = document.createElement("p");
    status.className = "status hint";
    row.append(name, capture, clear, status);
    $(hold.container).append(row);
    rows[slot] = { capture, status };
    capture.addEventListener("click", () => startListening(slot));
    clear.addEventListener("click", () => { stopListening(); draft[hold.field] = ""; renderHotkeys(); });
  }
  const PTT_MODIFIERS = { ControlLeft: "Ctrl", ControlRight: "Ctrl", AltLeft: "Alt", AltRight: "Alt", ShiftLeft: "Shift", ShiftRight: "Shift" };
  const PTT_UNSUPPORTED = /^(?:Media|Volume)/;
  function setHoldKey(slot, value) {
    draft[HOLDS[slot].field] = value;
    stopListening();
  }

  function startListening(action) {
    stopListening();
    listening = action;
    api.capture(true);
    renderHotkeys();
  }
  function stopListening() {
    if (!listening) return;
    listening = null;
    api.capture(false);
    renderHotkeys();
  }
  document.addEventListener("keydown", (event) => {
    if (!listening) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Escape" && !event.ctrlKey && !event.altKey && !event.shiftKey) { stopListening(); return; }
    if (isHold(listening)) {
      const key = PTT_MODIFIERS[event.code] || keyFromCode(event.code);
      if (key && !PTT_UNSUPPORTED.test(key)) setHoldKey(listening, key);
      else if (!MODIFIER_CODES.test(event.code)) {
        rows[listening].status.className = "status hint invalid";
        rows[listening].status.textContent = t("hotkeyUnsupported");
        rows[listening].status.hidden = false;
      }
      return;
    }
    const accelerator = acceleratorFrom(event);
    if (!accelerator) {
      // A modifier on its own: keep waiting. Any other unknown key: say so.
      if (!MODIFIER_CODES.test(event.code)) {
        const { status } = rows[listening];
        status.className = "status hint invalid";
        status.textContent = t("hotkeyUnsupported");
        status.hidden = false;
      }
      return;
    }
    const action = listening;
    draft.hotkeys[action] = accelerator;
    stopListening();
  }, true);
  window.addEventListener("blur", () => stopListening());
  // Mouse side buttons (back/forward) can be hotkeys too.
  document.addEventListener("mousedown", (event) => {
    if (isHold(listening) && (event.button === 1 || event.button === 3 || event.button === 4)) {
      event.preventDefault();
      event.stopPropagation();
      setHoldKey(listening, event.button === 1 ? "Mouse3" : event.button === 3 ? "Mouse4" : "Mouse5");
      return;
    }
    if (!listening || (event.button !== 3 && event.button !== 4)) return;
    event.preventDefault();
    event.stopPropagation();
    const action = listening;
    draft.hotkeys[action] = [...modifiersOf(event), event.button === 3 ? "Mouse4" : "Mouse5"].join("+");
    stopListening();
  }, true);
  // Side buttons would otherwise navigate this page back or forward.
  document.addEventListener("mouseup", (event) => { if (event.button === 3 || event.button === 4) event.preventDefault(); }, true);
  api.onHotkeyStatus((status) => { snapshot.hotkeyStatus = status; renderHotkeys(); });

  function duplicateOf(action) {
    const valueOf = (slot) => (isHold(slot) ? draft[HOLDS[slot].field] : draft.hotkeys[slot]).toLowerCase();
    const value = valueOf(action);
    if (!value) return false;
    return [...actions.map(([other]) => other), ...Object.keys(HOLDS)].some((other) => other !== action && valueOf(other) === value);
  }
  function renderHotkeys() {
    for (const [action] of actions) {
      const { capture, status } = rows[action];
      const value = draft.hotkeys[action];
      capture.classList.toggle("listening", listening === action);
      capture.classList.toggle("empty", !value && listening !== action);
      capture.textContent = listening === action ? t("hotkeyPress") : value ? label(value) : t("hotkeyNone");
      const saved = snapshot.settings.hotkeys[action] === value;
      const state = !isValid(value) ? "invalid" : duplicateOf(action) ? "duplicate" : saved ? snapshot.hotkeyStatus[action] : "";
      status.className = `status hint ${state}`;
      status.textContent = state === "taken" ? t("hotkeyTaken") : state === "invalid" ? t("hotkeyInvalid") : state === "duplicate" ? t("hotkeyDuplicate") : state === "unsupported" ? t("hotkeyUnsupported") : "";
      status.hidden = !status.textContent;
    }
    for (const [slot, hold] of Object.entries(HOLDS)) {
      const { capture, status } = rows[slot];
      const value = draft[hold.field];
      capture.classList.toggle("listening", listening === slot);
      capture.classList.toggle("empty", !value && listening !== slot);
      capture.textContent = listening === slot ? t("pttPress") : value ? label(value) : t("hotkeyNone");
      const saved = (snapshot.settings[hold.field] || "") === value;
      const state = duplicateOf(slot) ? "duplicate" : saved && value ? snapshot.hotkeyStatus[slot] : "";
      status.className = `status hint ${state}`;
      status.textContent = state === "taken" ? t(hold.taken) : state === "invalid" ? t("hotkeyInvalid") : state === "duplicate" ? t("hotkeyDuplicate")
        : state === "unsupported" ? t(hold.unsupported) : state === "active" ? t(hold.active) : "";
      status.hidden = !status.textContent;
    }
    $("save").disabled = actions.some(([action]) => !isValid(draft.hotkeys[action]) || duplicateOf(action)) || Object.keys(HOLDS).some((slot) => duplicateOf(slot));
  }

  // --- updates ------------------------------------------------------------
  let updateState = snapshot.updateState;
  function renderUpdates() {
    $("version").textContent = t("version", { version: snapshot.version });
    const button = $("updateButton");
    const status = $("updateStatus");
    if (updateState.status === "ready") {
      status.textContent = t("updateReadyBody", { version: updateState.version || "" });
      button.textContent = t("installUpdate", { version: updateState.version || "" });
      button.disabled = false;
    } else {
      status.textContent = updateState.status === "checking" ? t("updateChecking")
        : updateState.status === "downloading" ? t("updateDownloading", { version: updateState.version || "" })
        : updateState.status === "current" ? t("upToDateTitle")
        : updateState.status === "error" ? t("updateErrorTitle") : "";
      button.textContent = t("checkUpdates");
      button.disabled = !snapshot.packaged || updateState.status === "checking" || updateState.status === "downloading";
    }
  }
  $("updateButton").addEventListener("click", () => (updateState.status === "ready" ? api.installUpdate() : api.checkUpdates()));
  api.onUpdateState((state) => { updateState = state; renderUpdates(); });

  // --- form ---------------------------------------------------------------
  // --- overlay ------------------------------------------------------------
  function renderOverlayValues() {
    $("overlayScaleValue").textContent = `${$("overlayScale").value}%`;
    $("overlayOpacityValue").textContent = `${$("overlayOpacity").value}%`;
    $("overlayOptions").disabled = !$("overlayEnabled").checked;
    $("overlayAppsField").hidden = $("overlayShowWhen").value !== "games";
  }
  function fillOverlay(overlay) {
    $("overlayEnabled").checked = overlay.enabled;
    $("overlayCorner").value = overlay.corner;
    $("overlayMode").value = overlay.mode;
    $("overlayScale").value = String(overlay.scale);
    $("overlayOpacity").value = String(overlay.opacity);
    $("overlayOffsetX").value = String(overlay.offsetX);
    $("overlayOffsetY").value = String(overlay.offsetY);
    $("overlayShowSelf").checked = overlay.showSelf;
    $("overlayShowChannel").checked = overlay.showChannel;
    $("overlayShowWhen").value = overlay.showWhen || "games";
    $("overlayApps").value = (overlay.apps || []).join("\n");
    renderOverlayValues();
  }
  function overlayDraft() {
    const number = (id) => { const value = Number($(id).value); return Number.isFinite(value) ? value : 0; };
    return {
      enabled: $("overlayEnabled").checked, corner: $("overlayCorner").value, mode: $("overlayMode").value,
      scale: number("overlayScale"), opacity: number("overlayOpacity"), offsetX: number("overlayOffsetX"), offsetY: number("overlayOffsetY"),
      showSelf: $("overlayShowSelf").checked, showChannel: $("overlayShowChannel").checked,
      showWhen: $("overlayShowWhen").value,
      apps: $("overlayApps").value.split(/[\n,;]+/).map((app) => app.trim()).filter(Boolean),
    };
  }
  for (const id of ["overlayEnabled", "overlayScale", "overlayOpacity", "overlayShowWhen"]) $(id).addEventListener("input", renderOverlayValues);
  // The tray can turn the overlay on or off while this window is open.
  api.onChanged?.((next) => { if (next) { snapshot = { ...next, strings }; $("overlayEnabled").checked = next.settings.overlay.enabled; renderOverlayValues(); } });

  function fill() {
    const settings = snapshot.settings;
    fillOverlay(settings.overlay);
    $("serverUrl").value = settings.serverUrl;
    for (const id of ["launchAtLogin", "startHidden", "closeToTray", "hotkeySounds"]) $(id).checked = settings[id];
    $("streamHotkeySource").value = settings.streamHotkeySource;
    $("startHidden").disabled = !settings.launchAtLogin;
    renderHotkeys();
    renderUpdates();
  }
  $("launchAtLogin").addEventListener("change", () => { $("startHidden").disabled = !$("launchAtLogin").checked; });
  $("close").addEventListener("click", () => window.close());
  $("form").addEventListener("submit", async (event) => {
    event.preventDefault();
    stopListening();
    $("serverError").hidden = true;
    const result = await api.save({
      serverUrl: $("serverUrl").value,
      launchAtLogin: $("launchAtLogin").checked,
      startHidden: $("startHidden").checked,
      closeToTray: $("closeToTray").checked,
      hotkeySounds: $("hotkeySounds").checked,
      streamHotkeySource: $("streamHotkeySource").value,
      hotkeys: draft.hotkeys,
      pushToTalk: draft.pushToTalk,
      whisper: draft.whisper,
      overlay: overlayDraft(),
    });
    if (!result) return;
    if (result.error === "serverInvalid") { showPage("general"); $("serverError").hidden = false; $("serverUrl").focus(); return; }
    snapshot = { ...result, strings };
    Object.assign(draft.hotkeys, snapshot.settings.hotkeys);
    draft.pushToTalk = snapshot.settings.pushToTalk || "";
    draft.whisper = snapshot.settings.whisper || "";
    fill();
    const note = $("savedNote");
    note.hidden = false;
    setTimeout(() => { note.hidden = true; }, 2000);
  });
  fill();
  render();
})();
