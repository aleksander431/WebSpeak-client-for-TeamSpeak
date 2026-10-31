(async () => {
  const api = window.webspeakSettings;
  let snapshot = await api.get();
  if (!snapshot) return;
  const strings = snapshot.strings;
  const t = (key, variables = {}) => (strings[key] || key).replace(/\{(\w+)\}/g, (_, name) => variables[name] ?? "");
  document.title = t("settingsTitle");
  for (const element of document.querySelectorAll("[data-t]")) element.textContent = t(element.dataset.t);

  const $ = (id) => document.getElementById(id);
  const actions = [["mic", "hotkeyMic"], ["sound", "hotkeySound"], ["stream", "hotkeyStream"]];
  const draft = { hotkeys: { ...snapshot.settings.hotkeys } };
  let listening = null;

  // --- accelerators -------------------------------------------------------
  const CODE_KEYS = {
    Space: "Space", Tab: "Tab", Backspace: "Backspace", Delete: "Delete", Insert: "Insert", Enter: "Enter", NumpadEnter: "Enter",
    ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right", Home: "Home", End: "End", PageUp: "PageUp", PageDown: "PageDown",
    Backquote: "`", Minus: "-", Equal: "=", BracketLeft: "[", BracketRight: "]", Backslash: "\\", Semicolon: ";", Quote: "'", Comma: ",", Period: ".", Slash: "/",
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
  function acceleratorFrom(event) {
    const key = keyFromCode(event.code);
    if (!key) return null;
    const parts = [];
    if (event.ctrlKey) parts.push("CommandOrControl");
    if (event.altKey) parts.push("Alt");
    if (event.shiftKey) parts.push("Shift");
    if (event.metaKey) parts.push("Super");
    parts.push(key);
    return parts.join("+");
  }
  function isValid(accelerator) {
    if (!accelerator) return true;
    const parts = accelerator.split("+");
    const key = parts[parts.length - 1];
    return parts.length > 1 || /^(F\d+|Media|Volume)/.test(key);
  }
  const label = (accelerator) => accelerator.replace(/CommandOrControl/g, "Ctrl").replace(/Super/g, "Win").replace(/\+/g, " + ");

  // --- hotkey rows --------------------------------------------------------
  const rows = {};
  for (const [action, key] of actions) {
    const row = document.createElement("div");
    row.className = "hotkey";
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
    const accelerator = acceleratorFrom(event);
    if (!accelerator) return; // a modifier on its own: keep waiting
    const action = listening;
    draft.hotkeys[action] = accelerator;
    stopListening();
  }, true);
  window.addEventListener("blur", () => stopListening());

  function duplicateOf(action) {
    const value = draft.hotkeys[action].toLowerCase();
    return value && actions.some(([other]) => other !== action && draft.hotkeys[other].toLowerCase() === value);
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
      status.textContent = state === "taken" ? t("hotkeyTaken") : state === "invalid" ? t("hotkeyInvalid") : state === "duplicate" ? t("hotkeyDuplicate") : "";
      status.hidden = !status.textContent;
    }
    $("save").disabled = actions.some(([action]) => !isValid(draft.hotkeys[action]) || duplicateOf(action));
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
  function fill() {
    const settings = snapshot.settings;
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
    });
    if (!result) return;
    if (result.error === "serverInvalid") { $("serverError").hidden = false; $("serverUrl").focus(); return; }
    snapshot = { ...result, strings };
    Object.assign(draft.hotkeys, snapshot.settings.hotkeys);
    fill();
    const note = $("savedNote");
    note.hidden = false;
    setTimeout(() => { note.hidden = true; }, 2000);
  });
  fill();
})();
