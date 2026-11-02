(() => {
  const api = window.webspeakOverlay;
  const overlay = document.getElementById("overlay");
  const list = document.getElementById("list");
  const channel = document.getElementById("channel");
  let settings = { corner: "top-left", scale: 100, opacity: 90, mode: "channel", showSelf: true, showChannel: true };
  let roster = { connected: false, channel: "", members: [] };
  let speaking = new Set();
  const rows = new Map();
  /** Widest row in CSS pixels at 100%: matches .member max-width plus padding. */
  const WIDTH = 270;
  const MUTED_ICON = '<svg class="muted-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M4 4l16 16M9 9v3a3 3 0 0 0 5 2.2M15 9.3V5a3 3 0 0 0-5.7-1.3M19 11a7 7 0 0 1-1.3 4M5 11a7 7 0 0 0 11.2 5.6M12 18v3"/></svg>';

  function colorOf(name) {
    let hash = 0;
    for (const char of name) hash = (hash * 31 + char.codePointAt(0)) | 0;
    return `hsl(${Math.abs(hash) % 360} 45% 42%)`;
  }

  function row(member) {
    let entry = rows.get(member.id);
    if (!entry) {
      const item = document.createElement("li");
      item.className = "member";
      const avatar = document.createElement("span");
      avatar.className = "avatar";
      const name = document.createElement("span");
      name.className = "name";
      const muted = document.createElement("span");
      muted.innerHTML = MUTED_ICON;
      item.append(avatar, name, muted);
      entry = { item, avatar, name, muted, key: "" };
      rows.set(member.id, entry);
    }
    const key = JSON.stringify([member.name, member.avatar || "", member.muted]);
    if (entry.key !== key) {
      entry.key = key;
      entry.name.textContent = member.name;
      entry.avatar.style.setProperty("--color", colorOf(member.name));
      if (member.avatar) { entry.avatar.style.backgroundImage = `url("${member.avatar}")`; entry.avatar.textContent = ""; }
      else { entry.avatar.style.backgroundImage = ""; entry.avatar.textContent = Array.from(member.name.trim())[0]?.toUpperCase() || "?"; }
      entry.muted.hidden = !member.muted;
    }
    entry.item.classList.toggle("speaking", speaking.has(member.id));
    return entry.item;
  }

  function render() {
    overlay.style.setProperty("--scale", String(settings.scale / 100));
    overlay.style.setProperty("--opacity", String(settings.opacity / 100));
    overlay.classList.toggle("right", settings.corner.endsWith("right"));
    document.body.classList.toggle("right", settings.corner.endsWith("right"));
    overlay.classList.toggle("no-channel", !settings.showChannel);
    const members = roster.connected ? roster.members.filter((member) => (settings.showSelf || !member.self)
      && (settings.mode === "channel" || speaking.has(member.id))) : [];
    channel.textContent = roster.channel;
    const items = members.map(row);
    for (const [id, entry] of rows) if (!members.some((member) => member.id === id)) { entry.item.remove(); rows.delete(id); }
    list.replaceChildren(...items);
    overlay.hidden = members.length === 0;
    report();
  }

  let lastSize = "";
  function report() {
    requestAnimationFrame(() => {
      // A fixed width (the widest a row may be) keeps names from wrapping while
      // the window is resized; only the height follows the content.
      const width = overlay.hidden ? 0 : Math.ceil(WIDTH * settings.scale / 100) + 8;
      const height = overlay.hidden ? 0 : Math.ceil(overlay.getBoundingClientRect().height);
      const size = `${width}x${height}`;
      if (size === lastSize) return;
      lastSize = size;
      api.reportSize(width, height);
    });
  }

  api.onSettings((value) => { settings = { ...settings, ...value }; render(); });
  api.onRoster((value) => { roster = value || roster; render(); });
  api.onSpeaking((value) => { speaking = new Set(Array.isArray(value) ? value : []); render(); });
  api.ready();
})();
