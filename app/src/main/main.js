const { app, BrowserWindow, ipcMain, protocol, net, shell, dialog, clipboard, nativeImage, nativeTheme, session } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { pathToFileURL } = require("url");
const store = require("./store");
const updater = require("./updater");
const ai = require("./ai");
const ollamaSetup = require("./ollama-setup");
const i18n = require("./i18n");
const { t } = i18n;

const RENDERER = path.join(__dirname, "..", "renderer");
// Las pantallas se sirven con un esquema propio (no file://): así file:// no necesita privilegios extra para leer el asar
const RENDERER_URL = "chinchero://app/";
const screen = (name, query) => RENDERER_URL + name + (query ? "?" + new URLSearchParams(query) : "");
let win = null, started = false;

// Desarrollo y pruebas: perfil aislado (no toca la instalación real del usuario)
if (process.env.CHINCHERO_USER_DATA) app.setPath("userData", process.env.CHINCHERO_USER_DATA);
// Idioma elegido en Ajustes (las pantallas lo confirman al cargar con app:lang)
i18n.set(store.config.get().lang);

// Imágenes y archivos guardados en la carpeta de datos se sirven con un esquema propio (nunca file:// arbitrario)
protocol.registerSchemesAsPrivileged([
  { scheme: "chinchero", privileges: { standard: true, secure: true, supportFetchAPI: true } },
  { scheme: "chinchero-media", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

// Archivos .chinchero abiertos con doble clic (al iniciar o con la app ya abierta): la pantalla de tableros los importa
const opened = [];
function queueOpen(argv) {
  const files = argv.slice(1).filter(a => /\.chinchero$/i.test(a) && fs.existsSync(a));
  opened.push(...files);
  return files.length > 0;
}
queueOpen(process.argv);

if (!app.requestSingleInstanceLock()) app.quit();
app.on("second-instance", (e, argv) => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
  if (queueOpen(argv)) win.loadURL(screen("01-tableros.html", { abrir: "1" }));
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
    if (!url.startsWith(RENDERER_URL)) {
      e.preventDefault();
      if (/^https?:/i.test(url)) shell.openExternal(url);
    }
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });

  if (opened.length) return win.loadURL(screen("01-tableros.html", { abrir: "1" }));
  win.loadURL(screen(cfg.firstRunDone ? "01-tableros.html" : "00-bienvenida.html"));
}

app.whenReady().then(async () => {
  store.rememberDataDir();
  // La app no usa cámara, micrófono, notificaciones ni nada que pida permiso: se niega todo
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => cb(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  // chinchero://app/<pantalla o recurso>: solo archivos dentro de renderer/; la raíz es una página vacía (la usa la migración)
  protocol.handle("chinchero", req => {
    const u = new URL(req.url);
    const rel = decodeURIComponent(u.pathname).replace(/^\/+/, "");
    if (u.host === "app" && !rel) return new Response(`<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'"><title>Chinchero</title>`, { headers: { "content-type": "text/html; charset=utf-8" } });
    const file = path.join(RENDERER, rel);
    return u.host === "app" && file.startsWith(RENDERER + path.sep) && fs.existsSync(file)
      ? net.fetch(pathToFileURL(file).toString())
      : new Response("Not found", { status: 404 }); // i18n-ok: respuesta HTTP
  });
  protocol.handle("chinchero-media", req => {
    const u = new URL(req.url);
    const file = u.host === "thumbs" ? store.thumbFile(decodeURIComponent(u.pathname)) : store.mediaFile(req.url);
    return file && fs.existsSync(file)
      ? net.fetch(pathToFileURL(file).toString())
      : new Response("Not found", { status: 404 }); // i18n-ok: respuesta HTTP
  });
  try { store.autoBackup(); } catch (e) { console.error("Copia automática:", e); } // i18n-ok: registro, no se ve
  createWindow();
  started = true;
  updater.init(() => win);
});

// Solo cuenta la ventana principal: las ocultas (migración, PDF) se cierran antes de que exista
app.on("window-all-closed", () => { if (started) app.quit(); });

/* ---------- IPC ----------
   Lecturas síncronas (la app las necesita al cargar cada pantalla y son JSON pequeños);
   escrituras y operaciones con archivos, asíncronas.
   Cada canal solo responde a las pantallas propias de la ventana principal y comprueba el tipo de sus argumentos. */
const fromApp = e => !!win && e.sender === win.webContents && !!e.senderFrame?.url.startsWith(RENDERER_URL);
const MAX_BYTES = 1024 ** 3; // 1 GB: lo más grande que se acepta importar o exportar de una vez
const none = () => true;
const is = {
  id: v => typeof v === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(v),
  str: (v, max = 500) => typeof v === "string" && v.length <= max,
  num: (v, min = 0, max = 1e6) => Number.isFinite(v) && v >= min && v <= max,
  obj: v => !!v && typeof v === "object" && !Array.isArray(v),
  bytes: v => v instanceof Uint8Array && v.length > 0 && v.length <= MAX_BYTES,
  file: v => typeof v === "string" && v.length < 4000 && path.isAbsolute(v) && !!fs.statSync(v, { throwIfNoEntry: false })?.isFile(),
  rect: r => is.obj(r) && is.num(r.x, -1e4, 1e5) && is.num(r.y, -1e4, 1e5) && is.num(r.width, 1, 1e5) && is.num(r.height, 1, 1e5),
};
function rejected(channel, e) {
  console.warn(`IPC rechazado: ${channel} desde ${e.senderFrame?.url || "?"}`); // i18n-ok: registro
  return new Error(`Invalid request (${channel})`);
}
function handle(channel, check, fn) {
  ipcMain.handle(channel, (e, ...args) => {
    if (!fromApp(e) || !check(...args)) throw rejected(channel, e);
    return fn(e, ...args);
  });
}
function onSync(channel, check, fn) {
  ipcMain.on(channel, (e, ...args) => {
    if (fromApp(e) && check(...args)) return fn(e, ...args);
    rejected(channel, e);
    e.returnValue = null;
  });
}

onSync("lib:get", none, e => { e.returnValue = store.getLibrary(); });
onSync("board:load", is.id, (e, id) => { e.returnValue = store.loadBoard(id); });
onSync("data:recovered", none, e => { e.returnValue = store.takeRecovered(); });
handle("app:lang", l => i18n.LANGS.includes(l), (e, l) => {
  i18n.set(l);
  if (store.config.get().lang !== l) store.config.set({ lang: l });
});
onSync("app:info", none, e => {
  e.returnValue = { version: app.getVersion(), dataDir: store.dataDir(), packaged: app.isPackaged, firstRun: !store.config.get().firstRunDone };
});

handle("lib:save", lib => is.obj(lib) && Array.isArray(lib.groups) && Array.isArray(lib.boards), (e, lib) => store.saveLibrary(lib));
handle("board:save", (id, doc) => is.id(id) && is.obj(doc) && Array.isArray(doc.sheets), (e, id, doc) => store.saveBoard(id, doc));
handle("board:delete", is.id, (e, id) => store.deleteBoard(id));
handle("media:importPath", is.file, (e, p) => store.importPath(p));
handle("media:importBuffer", (buf, ext) => is.bytes(buf) && is.str(ext, 20), (e, buf, ext) => store.importBuffer(buf, ext));
handle("app:firstRunDone", none, () => store.config.set({ firstRunDone: true }));
handle("data:stats", none, () => store.dirStats());
handle("data:unused", none, () => { const { count, bytes } = store.unusedMedia(); return { count, bytes }; });
handle("data:clean", none, () => store.cleanMedia());
handle("data:open", none, () => shell.openPath(store.dataDir()));

handle("data:choose", mode => mode === "new" || mode === "existing", async (e, mode) => {
  const r = await dialog.showOpenDialog(win, {
    title: t(mode === "existing" ? "main.dialogos.carpetaExistente" : "main.dialogos.carpetaNueva"),
    properties: ["openDirectory", "createDirectory"],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  let dir = r.filePaths[0];
  // Si eligen la carpeta que contiene "Chinchero", se usa esa subcarpeta
  if (mode === "existing" && !fs.existsSync(path.join(dir, "library.json")) && fs.existsSync(path.join(dir, "Chinchero", "library.json"))) dir = path.join(dir, "Chinchero");
  if (mode === "new") dir = path.join(dir, "Chinchero");
  store.config.set({ dataDir: dir });
  store.rememberDataDir();
  return dir;
});

handle("data:backup", none, async () => {
  const file = await savePath(t("main.dialogos.dondeCopia"), `${t("main.dialogos.archivoCopia")}-${new Date().toISOString().slice(0, 10)}`, "zip", t("main.dialogos.filtroCopia"), "documents");
  if (!file) return null;
  store.backupTo(file);
  if (!process.env.CHINCHERO_EXPORT_DIR) shell.showItemInFolder(file);
  return file;
});

// Restaurar: devuelve cuántos tableros trae la copia, o { error } si el archivo no sirve
handle("data:restore", none, async () => {
  let file = process.env.CHINCHERO_RESTORE_FILE;
  if (!file) {
    const r = await dialog.showOpenDialog(win, { title: t("main.dialogos.elegirCopia"), filters: [{ name: t("main.dialogos.filtroCopia"), extensions: ["zip"] }], properties: ["openFile"] });
    if (r.canceled || !r.filePaths[0]) return null;
    file = r.filePaths[0];
  }
  try { return { boards: store.restoreFrom(file) }; } catch (e) { return { error: e.message }; }
});

// Compartir un tablero: exportar a .chinchero e importar (del diálogo, de un archivo arrastrado o abierto con doble clic)
handle("board:export", (id, name) => is.id(id) && is.str(name), async (e, id, name) => {
  const file = await savePath(t("main.dialogos.exportarTablero"), name, "chinchero", t("main.dialogos.filtroTablero"), "documents");
  if (!file) return null;
  store.exportBoard(id, file);
  return file;
});
handle("board:import", file => file == null || (is.file(file) && /\.chinchero$/i.test(file)), async (e, file) => {
  file ||= process.env.CHINCHERO_IMPORT_FILE;
  if (!file) {
    const r = await dialog.showOpenDialog(win, { title: t("main.dialogos.importarTablero"), filters: [{ name: t("main.dialogos.filtroTablero"), extensions: ["chinchero"] }], properties: ["openFile"] });
    if (r.canceled || !r.filePaths[0]) return null;
    file = r.filePaths[0];
  }
  try { return store.importBoardFile(file); } catch (err) { return { error: err.message }; }
});
onSync("board:opened", none, e => { e.returnValue = opened.splice(0); });

handle("open:external", url => is.str(url, 4000), (e, url) => {
  if (/^https?:\/\//i.test(url)) return shell.openExternal(url);
});
const RISKY = /\.(exe|com|scr|pif|bat|cmd|msi|msp|ps1|psm1|vbs|vbe|js|jse|wsf|wsh|hta|lnk|url|reg|cpl|jar|appx|msix|appinstaller|application|gadget|inf|scf|chm)$/i;
handle("open:media", url => is.str(url) && url.startsWith("chinchero-media://"), (e, url) => {
  const file = store.mediaFile(url);
  if (!file) return "Not found"; // i18n-ok: no se muestra
  // Un ejecutable adjunto (p. ej. dentro de un .chinchero ajeno) no se lanza: se muestra en su carpeta
  if (RISKY.test(file)) return shell.showItemInFolder(file);
  return shell.openPath(file);
});

// Captura un rectángulo de la ventana (px CSS); el editor la usa por partes para armar la hoja entera
handle("capture:rect", is.rect, async (e, rect) => (await win.webContents.capturePage(roundRect(rect))).toPNG());
// Mientras el editor recorre la hoja por partes, una ventana hija sin marco tapa el contenido con una imagen
// fija de cómo se veía, así no se ve el lienzo moverse. capturePage lee la página, no lo que hay encima
let cover = null;
handle("capture:cover", v => typeof v === "boolean", async (e, on) => {
  if (cover) { cover.destroy(); cover = null; }
  if (!on) return true;
  const shot = (await win.webContents.capturePage()).toDataURL();
  const b = win.getContentBounds();
  cover = new BrowserWindow({
    parent: win, ...b, frame: false, resizable: false, movable: false, minimizable: false, maximizable: false,
    focusable: false, skipTaskbar: true, show: false, webPreferences: { sandbox: true, contextIsolation: true, javascript: false },
  });
  cover.webContents.on("will-navigate", ev => ev.preventDefault());
  await cover.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(`<!doctype html><style>html,body{margin:0;height:100%;overflow:hidden;background:url(${shot}) 0 0/100% 100%}b{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);font:600 14px "Segoe UI",sans-serif;color:#fff;background:rgba(20,20,20,.85);padding:10px 18px;border-radius:99px}</style><b>${t("main.exportando")}</b>`));
  cover.showInactive();
  return true;
});

// Pregunta dónde guardar (en pruebas, CHINCHERO_EXPORT_DIR guarda directo sin diálogo)
async function savePath(title, name, ext, filter, folder) {
  const base = `${String(name).replace(/[\\/:*?"<>|]/g, "-")}.${ext}`;
  if (process.env.CHINCHERO_EXPORT_DIR) return path.join(process.env.CHINCHERO_EXPORT_DIR, base);
  const r = await dialog.showSaveDialog(win, { title, defaultPath: path.join(app.getPath(folder), base), filters: [{ name: filter, extensions: [ext] }] });
  return r.canceled || !r.filePath ? null : r.filePath;
}

handle("export:png", (png, name) => is.bytes(png) && is.str(name), async (e, png, name) => {
  const file = await savePath(t("main.dialogos.exportarPng"), name, "png", t("main.dialogos.filtroPng"), "pictures");
  if (!file) return null;
  fs.writeFileSync(file, Buffer.from(png));
  return file;
});
handle("copy:png", is.bytes, (e, png) => {
  clipboard.writeImage(nativeImage.createFromBuffer(Buffer.from(png)));
  return true;
});

// PDF: una página por hoja, del tamaño de su contenido. Se arma una página oculta con las imágenes y se imprime
const PDF_MAX = 19200; // 200 pulgadas, el máximo de una página PDF, en px CSS
handle("export:pdf", (pages, name) => Array.isArray(pages) && pages.length > 0 && pages.length <= 1000 && pages.every(p => is.obj(p) && is.bytes(p.png) && is.num(p.w) && is.num(p.h)) && is.str(name), async (e, pages, name) => {
  const file = await savePath(t("main.dialogos.exportarPdf"), name, "pdf", t("main.dialogos.filtroPdf"), "documents");
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

// Asistente con IA (ver ai.js): la clave nunca vuelve a la pantalla
const AI_PROVIDERS = ["ollama", "gemini"];
onSync("ai:status", none, e => { e.returnValue = ai.status(); });
handle("ai:config", p => is.obj(p) && Object.keys(p).every(k => ["enabled", "provider", "model"].includes(k))
  && (p.enabled === undefined || typeof p.enabled === "boolean") && (p.provider === undefined || AI_PROVIDERS.includes(p.provider))
  && (p.model === undefined || (is.str(p.model, 100) && /^[\w.:/-]*$/.test(p.model))), (e, p) => ai.setConfig(p));
handle("ai:setKey", k => k === null || is.str(k, 100), (e, k) => ai.setKey(k && k.trim()));
handle("ai:detectKey", none, () => ai.detectKey());
handle("ai:saveClipboardKey", none, () => ai.saveClipboardKey());
handle("ai:ignoreClipboardKey", none, () => ai.ignoreClipboardKey());
handle("ai:models", p => AI_PROVIDERS.includes(p), (e, p) => ai.models(p));
handle("ai:chat", r => is.obj(r) && is.str(r.board, 200000) && Array.isArray(r.messages) && r.messages.length > 0 && r.messages.length <= 40
  && r.messages.every(m => is.obj(m) && (m.role === "user" || m.role === "assistant") && is.str(m.text, 8000)), (e, r) => ai.chat(r));
handle("ai:test", none, () => ai.test());
// Instalación guiada de Ollama (ver ollama-setup.js): el progreso vuelve por "ai:progress"
const progressTo = e => p => { if (!e.sender.isDestroyed()) e.sender.send("ai:progress", p); };
handle("ai:ollamaState", none, () => ollamaSetup.state());
handle("ai:ollamaStart", none, () => ollamaSetup.start());
handle("ai:ollamaInstall", none, e => ollamaSetup.install(progressTo(e)));
handle("ai:ollamaPull", m => is.str(m, 100) && /^[\w.:/-]+$/.test(m), (e, m) => ollamaSetup.pull(m, progressTo(e)));
handle("ai:ollamaRemove", none, () => ollamaSetup.remove());
handle("ai:cancel", none, () => ollamaSetup.cancel());

handle("update:check", none, () => updater.check(true));
handle("update:install", none, () => updater.install());

function roundRect(r) {
  return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
}
