const { app, BrowserWindow, ipcMain, protocol, net, shell, dialog, clipboard, nativeImage, nativeTheme } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
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
  try { store.autoBackup(); } catch (e) { console.error("Copia automática:", e); }
  createWindow();
  updater.init(() => win);
});

app.on("window-all-closed", () => app.quit());

/* ---------- IPC ----------
   Lecturas síncronas (la app las necesita al cargar cada pantalla y son JSON pequeños);
   escrituras y operaciones con archivos, asíncronas. */
ipcMain.on("lib:get", e => { e.returnValue = store.getLibrary(); });
ipcMain.on("board:load", (e, id) => { e.returnValue = store.loadBoard(id); });
ipcMain.on("data:recovered", e => { e.returnValue = store.takeRecovered(); });
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
  const file = await savePath("¿Dónde guardo la copia de seguridad?", `Chinchero-copia-${new Date().toISOString().slice(0, 10)}`, "zip", "Copia de Chinchero (.zip)", "documents");
  if (!file) return null;
  store.backupTo(file);
  if (!process.env.CHINCHERO_EXPORT_DIR) shell.showItemInFolder(file);
  return file;
});

// Restaurar: devuelve cuántos tableros trae la copia, o { error } si el archivo no sirve
ipcMain.handle("data:restore", async () => {
  let file = process.env.CHINCHERO_RESTORE_FILE;
  if (!file) {
    const r = await dialog.showOpenDialog(win, { title: "Elige la copia de seguridad (.zip)", filters: [{ name: "Copia de Chinchero (.zip)", extensions: ["zip"] }], properties: ["openFile"] });
    if (r.canceled || !r.filePaths[0]) return null;
    file = r.filePaths[0];
  }
  try { return { boards: store.restoreFrom(file) }; } catch (e) { return { error: e.message }; }
});

ipcMain.handle("open:external", (e, url) => {
  if (/^https?:\/\//i.test(url)) return shell.openExternal(url);
});
ipcMain.handle("open:media", (e, url) => {
  const file = store.mediaFile(url);
  return file ? shell.openPath(file) : "No encontrado";
});

// Captura un rectángulo de la ventana (px CSS); el editor la usa por partes para armar la hoja entera
ipcMain.handle("capture:rect", async (e, rect) => (await win.webContents.capturePage(roundRect(rect))).toPNG());

// Pregunta dónde guardar (en pruebas, CHINCHERO_EXPORT_DIR guarda directo sin diálogo)
async function savePath(title, name, ext, filter, folder) {
  const base = `${String(name).replace(/[\\/:*?"<>|]/g, "-")}.${ext}`;
  if (process.env.CHINCHERO_EXPORT_DIR) return path.join(process.env.CHINCHERO_EXPORT_DIR, base);
  const r = await dialog.showSaveDialog(win, { title, defaultPath: path.join(app.getPath(folder), base), filters: [{ name: filter, extensions: [ext] }] });
  return r.canceled || !r.filePath ? null : r.filePath;
}

ipcMain.handle("export:png", async (e, png, name) => {
  const file = await savePath("Exportar como imagen", name, "png", "Imagen PNG", "pictures");
  if (!file) return null;
  fs.writeFileSync(file, Buffer.from(png));
  return file;
});
ipcMain.handle("copy:png", (e, png) => {
  clipboard.writeImage(nativeImage.createFromBuffer(Buffer.from(png)));
  return true;
});

// PDF: una página por hoja, del tamaño de su contenido. Se arma una página oculta con las imágenes y se imprime
const PDF_MAX = 19200; // 200 pulgadas, el máximo de una página PDF, en px CSS
ipcMain.handle("export:pdf", async (e, pages, name) => {
  const file = await savePath("Exportar como PDF", name, "pdf", "Documento PDF", "documents");
  if (!file) return null;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "chinchero-pdf-"));
  const pdfWin = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true } });
  try {
    let css = "@page{margin:0}html,body{margin:0}img{display:block}";
    const imgs = pages.map((p, i) => {
      fs.writeFileSync(path.join(tmp, `p${i}.png`), Buffer.from(p.png));
      const k = Math.min(1, PDF_MAX / p.w, PDF_MAX / p.h), w = Math.floor(p.w * k), h = Math.floor(p.h * k);
      css += `@page p${i}{size:${w}px ${h}px}.p${i}{page:p${i};width:${w}px;height:${h}px}`;
      return `<img class="p${i}" src="p${i}.png">`;
    });
    fs.writeFileSync(path.join(tmp, "index.html"), `<!doctype html><meta charset="utf-8"><style>${css}</style>${imgs.join("")}`);
    await pdfWin.loadFile(path.join(tmp, "index.html"));
    const pdf = await pdfWin.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true, margins: { top: 0, bottom: 0, left: 0, right: 0 } });
    fs.writeFileSync(file, pdf);
    return file;
  } finally {
    pdfWin.destroy();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

ipcMain.handle("update:check", () => updater.check(true));
ipcMain.handle("update:install", () => updater.install());

function roundRect(r) {
  return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
}
