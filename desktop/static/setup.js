(async () => {
  const api = window.webspeakSetup;
  const strings = await api.strings();
  if (!strings) return;
  const $ = (id) => document.getElementById(id);
  $("title").textContent = strings.title;
  $("body").textContent = strings.body;
  $("hint").textContent = strings.hint;
  $("url").placeholder = strings.placeholder;
  $("url").value = strings.value || "";
  $("next").textContent = strings.next;
  let unreachableUrl = null;
  const status = (text, error = false) => { $("status").textContent = text; $("status").className = error ? "status error" : "status"; };
  $("url").addEventListener("input", () => { unreachableUrl = null; $("next").textContent = strings.next; status(""); });
  $("form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const value = $("url").value.trim();
    if (!value) { $("url").focus(); return; }
    // A second press after a failed check saves the address as typed.
    if (unreachableUrl && unreachableUrl === value) { await api.save(value); return; }
    $("next").disabled = true;
    status(strings.checking);
    const result = await api.check(value);
    $("next").disabled = false;
    if (result.reason === "invalid") { status(strings.invalid, true); $("url").focus(); return; }
    if (result.ok) { status(""); await api.save(result.url); return; }
    unreachableUrl = value;
    status(strings.unreachable, true);
    $("next").textContent = strings.anyway;
  });
  $("url").focus();
})();
