import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("webspeakSystemAudio", {
  onChunk: (listener: (chunk: Uint8Array) => void) => {
    ipcRenderer.on("system-audio:chunk", (_event, chunk: Uint8Array) => listener(chunk));
  },
  ready: () => ipcRenderer.send("system-audio:ready"),
});
