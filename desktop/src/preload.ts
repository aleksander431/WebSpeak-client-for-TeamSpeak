import { contextBridge, ipcRenderer } from "electron";

/*
 * Preload of the main window. The WebSpeak page gets a small bridge to
 * report its state and open the desktop settings; actions in the other
 * direction run through window.__webspeakDesktopAction, which the shell
 * calls with a user gesture.
 */
const isFile = location.protocol === "file:";

if (isFile) {
  // First-start page asking for the server address.
  contextBridge.exposeInMainWorld("webspeakSetup", {
    strings: () => ipcRenderer.invoke("setup:strings"),
    check: (url: string) => ipcRenderer.invoke("setup:check", url),
    save: (url: string) => ipcRenderer.invoke("setup:save", url),
  });
  // The offline page shown when the server cannot be reached.
  contextBridge.exposeInMainWorld("webspeakOffline", {
    strings: () => ipcRenderer.invoke("offline:strings"),
    retry: () => ipcRenderer.send("offline:retry"),
    openSettings: () => ipcRenderer.send("webspeak:open-settings"),
  });
} else {
  contextBridge.exposeInMainWorld("webspeakDesktop", {
    platform: "windows",
    reportState: (state: unknown) => ipcRenderer.send("webspeak:state", state),
    openSettings: () => ipcRenderer.send("webspeak:open-settings"),
  });
}
