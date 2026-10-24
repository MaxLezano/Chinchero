// Puente entre las pantallas (renderer) y el proceso principal. Expone solo operaciones concretas, nunca Node completo.
const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("chinchero", {
  getLibrary: () => ipcRenderer.sendSync("lib:get"),
  saveLibrary: lib => ipcRenderer.invoke("lib:save", lib),
  loadBoard: id => ipcRenderer.sendSync("board:load", id),
  saveBoard: (id, doc) => ipcRenderer.invoke("board:save", id, doc),
  deleteBoard: id => ipcRenderer.invoke("board:delete", id),
  info: () => ipcRenderer.sendSync("app:info"),
  firstRunDone: () => ipcRenderer.invoke("app:firstRunDone"),

  // Archivos arrastrados o elegidos tienen ruta en disco; los pegados del portapapeles no, y se envían como bytes
  importFile: async file => {
    const p = webUtils.getPathForFile(file);
    if (p) return ipcRenderer.invoke("media:importPath", p);
    const ext = (file.name.split(".").pop() || file.type.split("/").pop() || "bin");
    return ipcRenderer.invoke("media:importBuffer", new Uint8Array(await file.arrayBuffer()), ext);
  },

  dataStats: () => ipcRenderer.invoke("data:stats"),
  openDataDir: () => ipcRenderer.invoke("data:open"),
  chooseDataDir: mode => ipcRenderer.invoke("data:choose", mode),
  backup: () => ipcRenderer.invoke("data:backup"),
  openExternal: url => ipcRenderer.invoke("open:external", url),
  openMedia: url => ipcRenderer.invoke("open:media", url),
  exportPng: (rect, name) => ipcRenderer.invoke("export:png", rect, name),
  copyPng: rect => ipcRenderer.invoke("copy:png", rect),
  checkUpdates: () => ipcRenderer.invoke("update:check"),
  installUpdate: () => ipcRenderer.invoke("update:install"),
  onUpdate: cb => ipcRenderer.on("update", (e, payload) => cb(payload)),
});
