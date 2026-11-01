import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("webspeakSettings", {
  get: () => ipcRenderer.invoke("settings:get"),
  save: (patch: unknown) => ipcRenderer.invoke("settings:save", patch),
  capture: (capturing: boolean) => ipcRenderer.send("settings:capture", capturing),
  checkUpdates: () => ipcRenderer.send("settings:check-updates"),
  installUpdate: () => ipcRenderer.send("settings:install-update"),
  onHotkeyStatus: (listener: (status: unknown) => void) => {
    ipcRenderer.on("settings:hotkey-status", (_event, status) => listener(status));
  },
  onUpdateState: (listener: (state: unknown) => void) => {
    ipcRenderer.on("settings:update-state", (_event, state) => listener(state));
  },
});
