// Persistencia en disco. Estructura de la carpeta de datos:
//   library.json        grupos, metadatos de tableros, papelera y stickers propios
//   boards/<id>.json    contenido de cada tablero (hojas, elementos, hilos)
//   media/<hash>.<ext>  imágenes y archivos copiados al tablero (la app no depende de los originales)
//   media/thumbs/       miniaturas de las imágenes grandes para el lienzo (se pueden borrar: se regeneran)
//   backups/auto-*.zip  copias automáticas al abrir la app (solo los JSON, las 5 últimas)
// Un tablero suelto se comparte como .chinchero (zip con tablero.json y sus imágenes)
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { app, nativeImage, clipboard } = require("electron");
const { zipSync, unzipSync } = require("fflate");

const CONFIG = () => path.join(app.getPath("userData"), "config.json");

function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

// Escritura atómica: se escribe a un temporal y se renombra, así un corte de luz no deja un JSON a medias
function writeJSON(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, file);
}

const config = {
  get() { return readJSON(CONFIG(), {}); },
  set(patch) { writeJSON(CONFIG(), { ...this.get(), ...patch }); },
};

function dataDir() {
  return config.get().dataDir || process.env.CHINCHERO_DATA_DIR || path.join(app.getPath("documents"), "Chinchero");
}

// El desinstalador (build/installer.nsh) no lee JSON: la carpeta de datos le queda aparte, en UTF-16 (como la lee NSIS)
function rememberDataDir() {
  try { fs.writeFileSync(path.join(app.getPath("userData"), "carpeta-de-datos.txt"), Buffer.from(dataDir(), "utf16le")); } catch {}
}

const paths = {
  library: () => path.join(dataDir(), "library.json"),
  board: id => path.join(dataDir(), "boards", safeName(id) + ".json"),
  media: () => path.join(dataDir(), "media"),
  thumbs: () => path.join(dataDir(), "media", "thumbs"),
  backups: () => path.join(dataDir(), "backups"),
};

function safeName(s) {
  return String(s).replace(/[^a-zA-Z0-9_-]/g, "");
}

const DEFAULT_LIBRARY = () => ({
  version: 1,
  groups: [
    { id: "personal", name: "Personal", color: "#51cf66" },
    { id: "trabajo", name: "Trabajo", color: "#4dabf7" },
    { id: "ideas", name: "Ideas", color: "#e8590c" },
  ],
  boards: [],
  trash: [],
  stickers: [],
});

function getLibrary() {
  const lib = readOrRecover(paths.library(), "library.json", "la biblioteca de tableros");
  return lib || DEFAULT_LIBRARY();
}

function saveLibrary(lib) {
  writeJSON(paths.library(), lib);
}

function loadBoard(id) {
  const name = safeName(id);
  return readOrRecover(paths.board(id), `boards/${name}.json`, "un tablero");
}

function saveBoard(id, doc) {
  writeJSON(paths.board(id), doc);
}

function deleteBoard(id) {
  fs.rmSync(paths.board(id), { force: true });
}

// Copia un archivo a media/ con nombre por contenido (sha1): importar dos veces la misma imagen no duplica
function importPath(src) {
  const buf = fs.readFileSync(src);
  return storeBuffer(buf, path.extname(src));
}

function importBuffer(buf, ext) {
  return storeBuffer(Buffer.from(buf), ext);
}

function storeBuffer(buf, ext) {
  const cleanExt = ("." + String(ext || "").replace(/^\./, "")).toLowerCase().replace(/[^.a-z0-9]/g, "").slice(0, 6) || ".bin";
  const name = crypto.createHash("sha1").update(buf).digest("hex").slice(0, 20) + cleanExt;
  const dest = path.join(paths.media(), name);
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(paths.media(), { recursive: true });
    fs.writeFileSync(dest, buf);
  }
  // La miniatura se crea justo después de responder, para no retrasar la importación
  setImmediate(() => { try { thumbFile(name); } catch {} });
  return `chinchero-media://media/${name}`;
}

// Miniaturas: el lienzo pide chinchero-media://thumbs/<nombre> y recibe una copia de 1280 px como mucho por lado
// (decodificar 100 fotos de 12 MP hace que el zoom vaya a tirones). La original se usa en el visor y al abrirla.
// Se crean al importar y, para las imágenes de antes, la primera vez que se piden. PNG sigue en PNG (transparencia).
const THUMB_SIDE = 1280;
const small = new Set(); // imágenes que no necesitan miniatura (pequeñas o en un formato que nativeImage no lee)
function thumbFile(name) {
  name = path.basename(name);
  const src = path.join(paths.media(), name), png = /\.(png|bmp)$/i.test(name);
  if (!/\.(png|jpe?g|bmp)$/i.test(name) || small.has(name)) return src;
  const dest = path.join(paths.thumbs(), name.replace(/\.\w+$/, png ? ".png" : ".jpg"));
  if (fs.existsSync(dest)) return dest;
  const img = fs.existsSync(src) ? nativeImage.createFromPath(src) : null;
  const { width, height } = img?.getSize() || {};
  if (!img) return src;
  if (img.isEmpty() || Math.max(width, height) <= THUMB_SIDE) { small.add(name); return src; }
  const k = THUMB_SIDE / Math.max(width, height);
  const out = img.resize({ width: Math.round(width * k), height: Math.round(height * k), quality: "good" });
  fs.mkdirSync(paths.thumbs(), { recursive: true });
  fs.writeFileSync(dest + ".tmp", png ? out.toPNG() : out.toJPEG(85));
  fs.renameSync(dest + ".tmp", dest);
  return dest;
}

// Resuelve una URL chinchero-media:// a un archivo dentro de media/ (sin permitir salir de la carpeta)
function mediaFile(url) {
  const name = path.basename(decodeURIComponent(new URL(url).pathname));
  const file = path.join(paths.media(), name);
  return file.startsWith(paths.media()) ? file : null;
}

function dirStats() {
  let bytes = 0, images = 0;
  const walk = dir => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else {
        bytes += fs.statSync(p).size;
        if (/\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(e.name) && !p.startsWith(paths.thumbs())) images++;
      }
    }
  };
  walk(dataDir());
  return { bytes, images };
}

/* ---------- Liberar espacio ----------
   Un archivo de media/ está en uso si su URL aparece en library.json (stickers, papelera), en algún tablero
   (también los de la papelera, que conservan su archivo), en alguna copia de backups/ (restaurarla no debe dejar fotos rotas)
   o en el portapapeles (un elemento copiado con Ctrl+C se pega con su imagen). */
const USED_URL = /chinchero-media:\/\/media\/([a-zA-Z0-9][a-zA-Z0-9_.-]*)/g;
function usedMedia() {
  const used = new Set(), scan = buf => { for (const m of buf.toString("utf8").matchAll(USED_URL)) used.add(m[1]); };
  for (const buf of Object.values(dataFiles({ onlyJSON: true }))) scan(buf);
  try { scan(Buffer.from(clipboard.readText())); } catch {}
  let zips = [];
  try { zips = fs.readdirSync(paths.backups()).filter(n => n.endsWith(".zip")); } catch {}
  for (const n of zips) {
    try {
      const files = unzipSync(new Uint8Array(fs.readFileSync(path.join(paths.backups(), n))), { filter: f => f.name.endsWith(".json") });
      for (const data of Object.values(files)) scan(Buffer.from(data));
    } catch {}
  }
  return used;
}

// Archivos de media/ (y miniaturas en media/thumbs/) que nada usa, con su tamaño
function unusedMedia() {
  const used = usedMedia(), stem = n => n.replace(/\.\w+$/, ""), list = [];
  const ls = dir => { try { return fs.readdirSync(dir, { withFileTypes: true }).filter(e => e.isFile() && !e.name.endsWith(".tmp")); } catch { return []; } };
  const media = ls(paths.media()).map(e => e.name);
  for (const n of media) if (!used.has(n)) list.push(path.join(paths.media(), n));
  // La miniatura se llama como la imagen con .png o .jpg: se borra si ninguna imagen que queda tiene ese nombre
  const kept = new Set(media.filter(n => used.has(n)).map(stem));
  for (const e of ls(paths.thumbs())) if (!kept.has(stem(e.name))) list.push(path.join(paths.thumbs(), e.name));
  const files = list.map(file => ({ file, bytes: fs.statSync(file).size, thumb: file.startsWith(paths.thumbs()) }));
  return { count: files.filter(f => !f.thumb).length, bytes: files.reduce((s, f) => s + f.bytes, 0), files };
}

// Se vuelve a calcular al borrar (no se confía en una lista vieja): por si se añadió algo entre medio
function cleanMedia() {
  const { files } = unusedMedia();
  let count = 0, bytes = 0;
  for (const f of files) {
    try { fs.rmSync(f.file); bytes += f.bytes; if (!f.thumb) count++; } catch {}
  }
  small.clear();
  return { count, bytes };
}

/* ---------- Copias de seguridad (.zip) ---------- */

// Archivos de la carpeta de datos como { "ruta/relativa": bytes }. Sin backups/, miniaturas ni temporales.
function dataFiles({ onlyJSON = false } = {}) {
  const root = dataDir(), files = {};
  const walk = rel => {
    let entries = [];
    try { entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { if (r !== "backups" && r !== "media/thumbs" && !(onlyJSON && r === "media")) walk(r); }
      else if (!e.name.endsWith(".tmp") && !e.name.includes(".corrupto-") && (!onlyJSON || e.name.endsWith(".json"))) files[r] = fs.readFileSync(path.join(root, r));
    }
  };
  walk("");
  return files;
}

// Las imágenes ya vienen comprimidas: se guardan tal cual; los JSON sí se comprimen
function zipFiles(files) {
  const entries = {};
  for (const [r, buf] of Object.entries(files)) entries[r] = [new Uint8Array(buf), { level: r.endsWith(".json") ? 6 : 0 }];
  return Buffer.from(zipSync(entries));
}

function backupTo(file) {
  fs.writeFileSync(file, zipFiles(dataFiles()));
  return file;
}

// Copia automática al abrir: solo los JSON (las imágenes no cambian nunca, se guardan por contenido).
// No se copia si algún JSON está dañado ni si nada cambió desde la última.
const AUTO_KEEP = 5;
function autoBackup() {
  const files = dataFiles({ onlyJSON: true });
  if (!files["library.json"]) return null;
  for (const buf of Object.values(files)) { try { JSON.parse(buf.toString("utf8")); } catch { return null; } }
  const hash = crypto.createHash("sha1");
  for (const r of Object.keys(files).sort()) hash.update(r).update(files[r]);
  const sum = hash.digest("hex").slice(0, 10);
  const list = autoBackups();
  if (list[0]?.endsWith(`-${sum}.zip`)) return null;
  const stamp = new Date().toISOString().slice(0, 19).replace(/:/g, "-");
  fs.mkdirSync(paths.backups(), { recursive: true });
  const file = path.join(paths.backups(), `auto-${stamp}-${sum}.zip`);
  fs.writeFileSync(file, zipFiles(files));
  for (const old of [file, ...list].slice(AUTO_KEEP)) fs.rmSync(old, { force: true });
  return file;
}

// Copias automáticas, de la más nueva a la más vieja
function autoBackups() {
  let names = [];
  try { names = fs.readdirSync(paths.backups()); } catch {}
  return names.filter(n => /^auto-.*\.zip$/.test(n)).sort().reverse().map(n => path.join(paths.backups(), n));
}

// Lee un .zip y devuelve sus entradas válidas. Admite que todo venga dentro de una carpeta (p. ej. «Chinchero/»).
// Solo se aceptan library.json, boards/<id>.json y media/<archivo>: nada puede escribirse fuera de la carpeta de datos.
function readZip(buf) {
  const raw = unzipSync(new Uint8Array(buf));
  const lib = Object.keys(raw).find(r => r === "library.json" || r.endsWith("/library.json"));
  if (!lib) throw new Error("La copia no contiene library.json");
  const prefix = lib.slice(0, -"library.json".length), files = {};
  for (const [r, data] of Object.entries(raw)) {
    if (!r.startsWith(prefix)) continue;
    const rel = r.slice(prefix.length);
    if (rel === "library.json" || /^boards\/[a-zA-Z0-9_-]+\.json$/.test(rel) || /^media\/[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(rel)) files[rel] = data;
  }
  JSON.parse(Buffer.from(files["library.json"]).toString("utf8"));
  return files;
}

// Restaura una copia .zip: antes guarda el estado actual en backups/ por si hay que volver atrás.
// Los tableros se reemplazan; las imágenes se suman (las que ya existen son idénticas, el nombre es su hash).
function restoreFrom(file) {
  const files = readZip(fs.readFileSync(file));
  const current = dataFiles({ onlyJSON: true });
  if (current["library.json"]) {
    fs.mkdirSync(paths.backups(), { recursive: true });
    const stamp = new Date().toISOString().slice(0, 19).replace(/:/g, "-");
    fs.writeFileSync(path.join(paths.backups(), `antes-de-restaurar-${stamp}.zip`), zipFiles(current));
  }
  fs.rmSync(path.join(dataDir(), "boards"), { recursive: true, force: true });
  for (const [rel, data] of Object.entries(files)) {
    const dest = path.join(dataDir(), ...rel.split("/"));
    if (rel.startsWith("media/") && fs.existsSync(dest)) continue;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (rel.endsWith(".json")) writeJSON(dest, JSON.parse(Buffer.from(data).toString("utf8")));
    else fs.writeFileSync(dest, data);
  }
  return Object.keys(files).filter(r => r.startsWith("boards/")).length;
}

/* ---------- Compartir un tablero (.chinchero) ----------
   Un .chinchero es un zip con tablero.json ({ formato, version, board, group, doc })
   y media/<archivo> con las imágenes y archivos que usa el tablero. */
const MEDIA_NAME = "[a-zA-Z0-9][a-zA-Z0-9_.-]*";
const MEDIA_URL = new RegExp(`^chinchero-media://media/(${MEDIA_NAME})$`);

// Copia de un JSON con cada cadena pasada por fn
function mapStrings(v, fn) {
  if (typeof v === "string") return fn(v);
  if (Array.isArray(v)) return v.map(x => mapStrings(x, fn));
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, mapStrings(x, fn)]));
  return v;
}

function exportBoard(id, file) {
  const lib = getLibrary(), entry = lib.boards.find(b => b.id === id), doc = loadBoard(id);
  if (!entry || !doc) throw new Error("No se encontró el tablero");
  const { id: _id, group, fav, ...board } = entry;
  const pkg = { formato: "chinchero-tablero", version: 1, board, group: lib.groups.find(g => g.id === group)?.name || "", doc };
  const files = { "tablero.json": Buffer.from(JSON.stringify(pkg)) };
  mapStrings(pkg, s => {
    const name = MEDIA_URL.exec(s)?.[1], src = name && path.join(paths.media(), name);
    if (name && !files[`media/${name}`] && fs.existsSync(src)) files[`media/${name}`] = fs.readFileSync(src);
    return s;
  });
  fs.writeFileSync(file, zipFiles(files));
  return file;
}

// Lee un .chinchero: copia sus imágenes a media/ (renombradas por contenido) y devuelve { board, group, doc } con las URLs nuevas.
// No toca la biblioteca: la pantalla le da un id nuevo y lo añade.
function importBoardFile(file) {
  let raw;
  try { raw = unzipSync(new Uint8Array(fs.readFileSync(file))); } catch { throw new Error("el archivo no es un tablero de Chinchero"); }
  const main = Object.keys(raw).find(r => r === "tablero.json" || r.endsWith("/tablero.json"));
  let pkg = null;
  try { pkg = main && JSON.parse(Buffer.from(raw[main]).toString("utf8")); } catch {}
  if (pkg?.formato !== "chinchero-tablero" || !Array.isArray(pkg.doc?.sheets)) throw new Error("el archivo no es un tablero de Chinchero");
  const prefix = main.slice(0, -"tablero.json".length), urls = {}, re = new RegExp(`^media/(${MEDIA_NAME})$`);
  for (const [r, data] of Object.entries(raw)) {
    const name = r.startsWith(prefix) && re.exec(r.slice(prefix.length))?.[1];
    if (name) urls[`chinchero-media://media/${name}`] = storeBuffer(Buffer.from(data), path.extname(name));
  }
  const swap = s => urls[s] || s;
  return { board: mapStrings(pkg.board || {}, swap), group: String(pkg.group || ""), doc: mapStrings(pkg.doc, swap) };
}

/* ---------- Recuperación de archivos dañados ---------- */

// Avisos pendientes para la interfaz («Recuperamos … desde la copia del …»)
const recovered = [];
function takeRecovered() { return recovered.splice(0); }

// Si el archivo existe pero no se puede leer, se aparta (.corrupto-<fecha>) y se recupera de la copia automática más nueva que lo tenga
function readOrRecover(file, rel, label) {
  let text;
  try { text = fs.readFileSync(file, "utf8"); } catch { return null; }
  try { return JSON.parse(text); } catch {}
  const stamp = new Date().toISOString().slice(0, 19).replace(/:/g, "-");
  try { fs.renameSync(file, `${file}.corrupto-${stamp}`); } catch {}
  for (const zip of autoBackups()) {
    try {
      const entry = unzipSync(new Uint8Array(fs.readFileSync(zip)), { filter: f => f.name === rel })[rel];
      if (!entry) continue;
      const data = JSON.parse(Buffer.from(entry).toString("utf8"));
      writeJSON(file, data);
      const when = fs.statSync(zip).mtime;
      recovered.push({ ok: true, label, when: when.getTime() });
      return data;
    } catch {}
  }
  recovered.push({ ok: false, label });
  return null;
}

module.exports = {
  config, dataDir, rememberDataDir, getLibrary, saveLibrary, loadBoard, saveBoard, deleteBoard,
  importPath, importBuffer, mediaFile, thumbFile, dirStats, unusedMedia, cleanMedia, backupTo, autoBackup, restoreFrom, takeRecovered,
  exportBoard, importBoardFile,
};
