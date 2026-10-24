const { app, BrowserWindow, ipcMain, protocol, net, shell, dialog, clipboard, nativeTheme } = require("electron");
const path = require("path");
const fs = require("fs");
const { pathToFileURL } = require("url");
const store = require("./store");
const updater = require("./updater");

const RENDERER = path.join(__dirname, "..", "renderer");
let win = null;

// Desarrollo y pruebas: perfil aislado (no toca la instalación real del usuario)
if (process.env.CHINCHERO_USER_DATA) app.setPath("userData", process.env.CHINCHERO_USER_DATA);

// Imágenes y archivos guardados en la carpeta de datos se sirven con un esquema propio (nunca file:// arbitrario)
protocol.registerSchemesAsPrivileged([
  { scheme: "chinchero-media", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

if (!app.requestSingleInstanceLock()) app.quit();
app.on("second-instance", () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
});

function createWindow() {
  const cfg = store.config.get();
  const bounds = cfg.bounds || { width: 1440, height: 900 };
  win = new BrowserWindow({
    ...bounds,
    minWidth: 1000,
    minHeight: 640,
    show: false,
    title: "Chinchero",
    icon: path.join(__dirname, "..", "..", "build", "icon.png"),
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#121316" : "#f3f1ec",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "..", "preload", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  win.setMenuBarVisibility(false);
  if (cfg.maximized) win.maximize();
  win.once("ready-to-show", () => win.show());

  win.on("close", () => {
    store.config.set({ bounds: win.getNormalBounds(), maximized: win.isMaximized() });
  });
  win.on("closed", () => { win = null; });

  // Solo se navega entre las pantallas propias; los enlaces web se abren en el navegador
  win.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith(pathToFileURL(RENDERER).toString())) {
      e.preventDefault();
      if (/^https?:/i.test(url)) shell.openExternal(url);
    }
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });

  const start = cfg.firstRunDone ? "01-tableros.html" : "00-bienvenida.html";
  win.loadFile(path.join(RENDERER, start));
}

app.whenReady().then(() => {
  protocol.handle("chinchero-media", req => {
    const file = store.mediaFile(req.url);
    return file && fs.existsSync(file)
      ? net.fetch(pathToFileURL(file).toString())
      : new Response("No encontrado", { status: 404 });
  });
  createWindow();
  updater.init(() => win);
});

app.on("window-all-closed", () => app.quit());

/* ---------- IPC ----------
   Lecturas síncronas (la app las necesita al cargar cada pantalla y son JSON pequeños);
   escrituras y operaciones con archivos, asíncronas. */
ipcMain.on("lib:get", e => { e.returnValue = store.getLibrary(); });
ipcMain.on("board:load", (e, id) => { e.returnValue = store.loadBoard(id); });
ipcMain.on("app:info", e => {
  e.returnValue = { version: app.getVersion(), dataDir: store.dataDir(), packaged: app.isPackaged, firstRun: !store.config.get().firstRunDone };
});

ipcMain.handle("lib:save", (e, lib) => store.saveLibrary(lib));
ipcMain.handle("board:save", (e, id, doc) => store.saveBoard(id, doc));
ipcMain.handle("board:delete", (e, id) => store.deleteBoard(id));
ipcMain.handle("media:importPath", (e, p) => store.importPath(p));
ipcMain.handle("media:importBuffer", (e, buf, ext) => store.importBuffer(buf, ext));
ipcMain.handle("app:firstRunDone", () => store.config.set({ firstRunDone: true }));
ipcMain.handle("data:stats", () => store.dirStats());
ipcMain.handle("data:open", () => shell.openPath(store.dataDir()));

ipcMain.handle("data:choose", async (e, mode) => {
  const r = await dialog.showOpenDialog(win, {
    title: mode === "existing" ? "Elige la carpeta de datos de Chinchero" : "Elige dónde guardar tus tableros",
    properties: ["openDirectory", "createDirectory"],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  let dir = r.filePaths[0];
  // Si eligen la carpeta que contiene "Chinchero", se usa esa subcarpeta
  if (mode === "existing" && !fs.existsSync(path.join(dir, "library.json")) && fs.existsSync(path.join(dir, "Chinchero", "library.json"))) dir = path.join(dir, "Chinchero");
  if (mode === "new") dir = path.join(dir, "Chinchero");
  store.config.set({ dataDir: dir });
  return dir;
});

ipcMain.handle("data:backup", async () => {
  const r = await dialog.showOpenDialog(win, { title: "¿Dónde guardo la copia de seguridad?", properties: ["openDirectory", "createDirectory"] });
  if (r.canceled || !r.filePaths[0]) return null;
  const dest = store.backupTo(r.filePaths[0]);
  shell.showItemInFolder(dest);
  return dest;
});

ipcMain.handle("open:external", (e, url) => {
  if (/^https?:\/\//i.test(url)) return shell.openExternal(url);
});
ipcMain.handle("open:media", (e, url) => {
  const file = store.mediaFile(url);
  return file ? shell.openPath(file) : "No encontrado";
});

// Exporta el área visible del tablero (rect en píxeles CSS de la ventana)
ipcMain.handle("export:png", async (e, rect, name) => {
  const img = await win.webContents.capturePage(roundRect(rect));
  const r = await dialog.showSaveDialog(win, {
    title: "Exportar como imagen",
    defaultPath: path.join(app.getPath("pictures"), `${name.replace(/[\\/:*?"<>|]/g, "-")}.png`),
    filters: [{ name: "Imagen PNG", extensions: ["png"] }],
  });
  if (r.canceled || !r.filePath) return null;
  fs.writeFileSync(r.filePath, img.toPNG());
  return r.filePath;
});
ipcMain.handle("copy:png", async (e, rect) => {
  clipboard.writeImage(await win.webContents.capturePage(roundRect(rect)));
  return true;
});

ipcMain.handle("update:check", () => updater.check(true));
ipcMain.handle("update:install", () => updater.install());

function roundRect(r) {
  return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
}
