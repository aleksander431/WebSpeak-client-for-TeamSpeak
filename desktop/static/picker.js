(async () => {
  const api = window.webspeakPicker;
  const data = await api.load();
  if (!data) return;
  const { strings, sources } = data;
  document.getElementById("audio").checked = data.audio === true;
  document.title = strings.title;
  document.getElementById("title").textContent = strings.title;
  document.getElementById("tab-screen").textContent = strings.screens;
  document.getElementById("tab-window").textContent = strings.windows;
  document.getElementById("audio-label").textContent = strings.audio;
  document.getElementById("cancel").textContent = strings.cancel;
  const share = document.getElementById("share");
  share.textContent = strings.share;
  const grid = document.getElementById("grid");
  let kind = "screen";
  let selected = null;

  function render() {
    for (const tab of document.querySelectorAll("[role=tab]")) tab.setAttribute("aria-selected", String(tab.dataset.kind === kind));
    grid.replaceChildren();
    for (const source of sources.filter((item) => item.kind === kind)) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "source";
      button.setAttribute("role", "option");
      button.setAttribute("aria-selected", String(source.id === selected));
      const thumb = document.createElement("div");
      thumb.className = "thumb";
      if (source.thumbnail) { const image = document.createElement("img"); image.src = source.thumbnail; image.alt = ""; thumb.append(image); }
      const name = document.createElement("div");
      name.className = "name";
      if (source.icon) { const icon = document.createElement("img"); icon.src = source.icon; icon.alt = ""; name.append(icon); }
      const label = document.createElement("span");
      label.textContent = source.name;
      label.title = source.name;
      name.append(label);
      button.append(thumb, name);
      button.addEventListener("click", () => { selected = source.id; share.disabled = false; render(); });
      button.addEventListener("dblclick", () => api.choose(source.id, document.getElementById("audio").checked));
      grid.append(button);
    }
  }
  for (const tab of document.querySelectorAll("[role=tab]")) tab.addEventListener("click", () => { kind = tab.dataset.kind; render(); });
  share.addEventListener("click", () => { if (selected) api.choose(selected, document.getElementById("audio").checked); });
  document.getElementById("cancel").addEventListener("click", () => api.choose(null, false));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") api.choose(null, false);
    if (event.key === "Enter" && selected) api.choose(selected, document.getElementById("audio").checked);
  });
  // With one screen there is nothing to choose between on that tab.
  const screens = sources.filter((item) => item.kind === "screen");
  if (screens.length === 1) { selected = screens[0].id; share.disabled = false; }
  render();
  share.focus();
})();
