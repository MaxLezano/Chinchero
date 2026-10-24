// Persistencia en disco. Estructura de la carpeta de datos:
//   library.json        grupos, metadatos de tableros, papelera y stickers propios
//   boards/<id>.json    contenido de cada tablero (hojas, elementos, hilos)
//   media/<hash>.<ext>  imágenes y archivos copiados al tablero (la app no depende de los originales)
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { app } = require("electron");

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

const paths = {
  library: () => path.join(dataDir(), "library.json"),
  board: id => path.join(dataDir(), "boards", safeName(id) + ".json"),
  media: () => path.join(dataDir(), "media"),
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
  const lib = readJSON(paths.library(), null);
  return lib || DEFAULT_LIBRARY();
}

function saveLibrary(lib) {
  writeJSON(paths.library(), lib);
}

function loadBoard(id) {
  return readJSON(paths.board(id), null);
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
  return `chinchero-media://media/${name}`;
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
        if (/\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(e.name)) images++;
      }
    }
  };
  walk(dataDir());
  return { bytes, images };
}

function backupTo(destDir) {
  const stamp = new Date().toISOString().slice(0, 10);
  const dest = path.join(destDir, `Chinchero-copia-${stamp}`);
  fs.cpSync(dataDir(), dest, { recursive: true });
  return dest;
}

module.exports = {
  config, dataDir, getLibrary, saveLibrary, loadBoard, saveBoard, deleteBoard,
  importPath, importBuffer, mediaFile, dirStats, backupTo,
};
