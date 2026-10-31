import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("webspeakPicker", {
  load: () => ipcRenderer.invoke("picker:sources"),
  choose: (id: string | null, audio: boolean) => ipcRenderer.send("picker:choose", id, audio),
});
