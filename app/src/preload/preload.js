// Puente entre las pantallas (renderer) y el proceso principal. Expone solo operaciones concretas, nunca Node completo.
const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("chinchero", {
  getLibrary: () => ipcRenderer.sendSync("lib:get"),
  saveLibrary: lib => ipcRenderer.invoke("lib:save", lib),
  loadBoard: id => ipcRenderer.sendSync("board:load", id),
  saveBoard: (id, doc) => ipcRenderer.invoke("board:save", id, doc),
  deleteBoard: id => ipcRenderer.invoke("board:delete", id),
  info: () => ipcRenderer.sendSync("app:info"),
  takeRecovered: () => ipcRenderer.sendSync("data:recovered"),
  firstRunDone: () => ipcRenderer.invoke("app:firstRunDone"),

  // Archivos arrastrados o elegidos tienen ruta en disco; los pegados del portapapeles no, y se envían como bytes
  importFile: async file => {
    const p = webUtils.getPathForFile(file);
    if (p) return ipcRenderer.invoke("media:importPath", p);
    const ext = (file.name.split(".").pop() || file.type.split("/").pop() || "bin");
    return ipcRenderer.invoke("media:importBuffer", new Uint8Array(await file.arrayBuffer()), ext);
  },

  // Tablero compartido: un File arrastrado, la ruta de uno abierto con doble clic, o nada (la app pregunta cuál)
  exportBoard: (id, name) => ipcRenderer.invoke("board:export", id, name),
  importBoard: f => ipcRenderer.invoke("board:import", typeof f === "string" ? f : f ? webUtils.getPathForFile(f) : null),
  takeOpened: () => ipcRenderer.sendSync("board:opened"),

  dataStats:() => ipcRenderer.invoke("data:stats"),
  unusedMedia: () => ipcRenderer.invoke("data:unused"),
  cleanMedia: () => ipcRenderer.invoke("data:clean"),
  openDataDir: () => ipcRenderer.invoke("data:open"),
  chooseDataDir: mode => ipcRenderer.invoke("data:choose", mode),
  backup: () => ipcRenderer.invoke("data:backup"),
  restoreBackup: () => ipcRenderer.invoke("data:restore"),
  openExternal: url => ipcRenderer.invoke("open:external", url),
  openMedia: url => ipcRenderer.invoke("open:media", url),
  capture: rect => ipcRenderer.invoke("capture:rect", rect),
  coverWindow: on => ipcRenderer.invoke("capture:cover", on),
  exportPng: (png, name) => ipcRenderer.invoke("export:png", png, name),
  copyPng: png => ipcRenderer.invoke("copy:png", png),
  exportPdf: (pages, name) => ipcRenderer.invoke("export:pdf", pages, name),
  checkUpdates: () => ipcRenderer.invoke("update:check"),
  installUpdate: () => ipcRenderer.invoke("update:install"),
  onUpdate: cb => ipcRenderer.on("update", (e, payload) => cb(payload)),

  // Asistente con IA: la clave se guarda o se toma del portapapeles en el proceso principal; aquí solo llega una pista
  ai: {
    status: () => ipcRenderer.sendSync("ai:status"),
    config: patch => ipcRenderer.invoke("ai:config", patch),
    setKey: key => ipcRenderer.invoke("ai:setKey", key),
    detectKey: () => ipcRenderer.invoke("ai:detectKey"),
    saveClipboardKey: () => ipcRenderer.invoke("ai:saveClipboardKey"),
    ignoreClipboardKey: () => ipcRenderer.invoke("ai:ignoreClipboardKey"),
    models: provider => ipcRenderer.invoke("ai:models", provider),
    chat: req => ipcRenderer.invoke("ai:chat", req),
    test: () => ipcRenderer.invoke("ai:test"),
    ollamaState: () => ipcRenderer.invoke("ai:ollamaState"),
    ollamaStart: () => ipcRenderer.invoke("ai:ollamaStart"),
    ollamaInstall: () => ipcRenderer.invoke("ai:ollamaInstall"),
    ollamaPull: model => ipcRenderer.invoke("ai:ollamaPull", model),
    cancel: () => ipcRenderer.invoke("ai:cancel"),
    onProgress: cb => ipcRenderer.on("ai:progress", (e, p) => cb(p)),
  },
});
