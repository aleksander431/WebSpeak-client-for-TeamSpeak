(async () => {
  const api = window.webspeakOffline;
  const strings = await api.strings();
  if (!strings) return;
  document.getElementById("title").textContent = strings.title;
  document.getElementById("body").textContent = strings.body;
  document.getElementById("retry").textContent = strings.retry;
  document.getElementById("change").textContent = strings.change;
  document.getElementById("retry").addEventListener("click", () => api.retry());
  document.getElementById("change").addEventListener("click", () => api.openSettings());
  // Try again on its own every 15 s, e.g. after the PC wakes up or the server restarts.
  setInterval(() => { if (navigator.onLine) api.retry(); }, 15000);
})();
