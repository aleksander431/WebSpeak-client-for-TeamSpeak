import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("webspeakOverlay", {
  ready: () => ipcRenderer.send("overlay:ready"),
  reportSize: (width: number, height: number) => ipcRenderer.send("overlay:size", width, height),
  onSettings: (listener: (value: unknown) => void) => { ipcRenderer.on("overlay:settings", (_event, value) => listener(value)); },
  onRoster: (listener: (value: unknown) => void) => { ipcRenderer.on("overlay:roster", (_event, value) => listener(value)); },
  onSpeaking: (listener: (value: unknown) => void) => { ipcRenderer.on("overlay:speaking", (_event, value) => listener(value)); },
});
