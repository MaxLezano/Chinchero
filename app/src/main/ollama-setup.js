// Instalación guiada de Ollama: la app baja el instalador oficial, comprueba su firma, lo ejecuta en silencio
// (se instala para el usuario, sin permisos de administrador) y descarga un modelo con /api/pull.
// Solo hay una tarea a la vez; el progreso se envía a la pantalla que la pidió.
const { app, net } = require("electron");
const { execFile, spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");

const OLLAMA = process.env.CHINCHERO_OLLAMA_URL || "http://127.0.0.1:11434";
const SETUP_URL = process.env.CHINCHERO_OLLAMA_SETUP_URL || "https://ollama.com/download/OllamaSetup.exe";
const DIR = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "Programs", "Ollama");
const SERVER_EXE = path.join(DIR, "ollama.exe");
const SETUP_FILE = path.join(os.tmpdir(), "Chinchero-OllamaSetup.exe");
// La app de escritorio de Ollama abre su propia ventana (cuenta, chat) y se pone en el inicio de Windows
const STARTUP_LNK = path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "Microsoft", "Windows", "Start Menu", "Programs", "Startup", "Ollama.lnk");
// Modelos descargados, registros y configuración de Ollama
const HOME_DIRS = [path.join(os.homedir(), ".ollama"), path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "Ollama")];
// Marca de que Ollama lo instaló Chinchero: el desinstalador de Chinchero (build/installer.nsh) solo quita Ollama si existe
const MARK = () => path.join(app.getPath("userData"), "ollama-de-chinchero");

let job = null; // { kind, ctrl, child }

const alive = () => net.fetch(OLLAMA + "/api/tags", { signal: AbortSignal.timeout(3000) }).then(r => r.ok, () => false);

async function state() {
  return { running: await alive(), installed: fs.existsSync(SERVER_EXE), busy: job?.kind || null };
}

// Arranca solo el servidor de Ollama, oculto (sin la ventana de su app), y espera a que su API responda.
// Sigue en marcha al cerrar Chinchero; sin pedidos ocupa poca memoria y libera el modelo a los pocos minutos.
async function start(ms = 30000) {
  if (await alive()) return true;
  if (!fs.existsSync(SERVER_EXE)) return false;
  spawn(SERVER_EXE, ["serve"], { detached: true, stdio: "ignore", windowsHide: true }).unref();
  for (const end = Date.now() + ms; Date.now() < end;) {
    if (job?.ctrl.signal.aborted) return false;
    await new Promise(r => setTimeout(r, 1000));
    if (await alive()) return true;
  }
  return false;
}

// Firma Authenticode válida y emitida a Ollama: así no se ejecuta nada que no sea el instalador oficial
function signedByOllama(file) {
  return new Promise(resolve => {
    const ps = "$s = Get-AuthenticodeSignature -LiteralPath $env:CH_FILE; if ($s.Status -eq 'Valid') { $s.SignerCertificate.Subject }";
    execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], { env: { ...process.env, CH_FILE: file }, windowsHide: true, timeout: 60000 },
      (err, out) => resolve(!err && /Ollama/i.test(String(out))));
  });
}

async function download(ctrl, progress) {
  const res = await net.fetch(SETUP_URL, { signal: ctrl.signal });
  if (!res.ok) throw new Error(String(res.status));
  const total = Number(res.headers.get("content-length")) || 0;
  const out = fs.createWriteStream(SETUP_FILE);
  let done = 0, last = 0;
  try {
    for await (const chunk of res.body) {
      if (!out.write(chunk)) await new Promise(r => out.once("drain", r));
      done += chunk.length;
      if (Date.now() - last > 250) { last = Date.now(); progress({ step: "download", done, total }); }
    }
  } finally {
    await new Promise(r => out.end(r));
  }
  progress({ step: "download", done, total: total || done });
}

function runSetup() {
  return new Promise((resolve, reject) => {
    const child = execFile(SETUP_FILE, ["/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART", "/SP-"], { windowsHide: true },
      err => err ? reject(new Error("setup")) : resolve());
    job.child = child;
  });
}

const errCode = e => e?.name === "AbortError" || job?.ctrl.signal.aborted ? "cancel"
  : e?.name === "TimeoutError" ? "timeout" : /^(\d{3}|unsigned|setup|start|offline)$/.test(e?.message) ? e.message : "offline";

async function run(kind, progress, fn) {
  if (job) return { error: "busy" };
  job = { kind, ctrl: new AbortController() };
  try { return await fn(job.ctrl); }
  catch (e) { return { error: errCode(e) }; }
  finally { job = null; }
}

// El instalador abre la app de Ollama al terminar (también en silencio): se cierra, con su servidor, y se quita
// del inicio de Windows. Chinchero arranca el servidor oculto cuando hace falta (ver start).
const kill = name => new Promise(r => execFile("taskkill", ["/im", name, "/f", "/t"], { windowsHide: true }, () => r()));
const quietApp = () => kill("ollama app.exe").then(() => fs.promises.rm(STARTUP_LNK, { force: true }).catch(() => {}));

const install = progress => run("install", progress, async ctrl => {
  if (await alive()) return { ok: true };
  if (!fs.existsSync(SERVER_EXE)) {
    try {
      await download(ctrl, progress);
      progress({ step: "verify" });
      if (ctrl.signal.aborted) throw new Error("cancel");
      if (!(await signedByOllama(SETUP_FILE))) throw new Error("unsigned");
      // Desde aquí no se cancela: cortar un instalador a medias deja Ollama roto
      progress({ step: "install" });
      await runSetup();
      // La app tarda un momento en abrirse tras el instalador: se espera antes de cerrarla
      await new Promise(r => setTimeout(r, 3000));
      await quietApp();
      fs.writeFileSync(MARK(), "");
    } finally {
      fs.rm(SETUP_FILE, { force: true }, () => {});
    }
  }
  progress({ step: "start" });
  if (!(await start(60000))) throw new Error("start");
  return { ok: true };
});

// Descarga un modelo; si se cancela, Ollama conserva lo bajado y la próxima vez sigue desde ahí
const pull = (model, progress) => run("pull", progress, async ctrl => {
  let res;
  try {
    res = await net.fetch(OLLAMA + "/api/pull", { method: "POST", signal: ctrl.signal, headers: { "content-type": "application/json" }, body: JSON.stringify({ model, stream: true }) });
  } catch (e) { if (ctrl.signal.aborted) throw e; throw new Error("offline"); }
  if (!res.ok) throw new Error(String(res.status));
  const dec = new TextDecoder();
  let buf = "", last = 0, ok = false;
  for await (const chunk of res.body) {
    buf += dec.decode(chunk, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      let m; try { m = JSON.parse(line); } catch { continue; }
      if (m.error) return { error: /not found|file does not exist/i.test(m.error) ? "404" : "fail" };
      if (m.status === "success") ok = true;
      if (m.total && (Date.now() - last > 250 || m.completed === m.total)) { last = Date.now(); progress({ step: "pull", done: m.completed || 0, total: m.total }); }
    }
  }
  return ok ? { ok: true } : { error: "fail" };
});

// El instalador ya en marcha no se corta (ver install); la descarga y el modelo sí
function cancel() {
  if (!job || job.child) return false;
  job.ctrl.abort();
  return true;
}

// Quita Ollama de la PC: lo cierra, ejecuta su desinstalador oficial en silencio y borra los modelos, sus registros y
// el acceso del inicio de Windows. Las carpetas de Ollama solo se tocan si estaba instalado en la carpeta de siempre.
// Solo se cierran los procesos que corren desde esa carpeta (no otro Ollama con el mismo nombre)
const killIn = dir => new Promise(r => execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
  "Get-Process | ? { $_.Path -and $_.Path.StartsWith($env:CH_DIR, 'OrdinalIgnoreCase') } | Stop-Process -Force"],
{ env: { ...process.env, CH_DIR: dir + path.sep }, windowsHide: true, timeout: 30000 }, () => r()));

// El desinstalador de Ollama deja su carpeta en el PATH del usuario: se quita esa entrada y nada más
const cleanPath = () => new Promise(r => execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
  "$k = Get-Item HKCU:\\Environment; $p = $k.GetValue('Path', '', 'DoNotExpandEnvironmentNames'); " +
  "$n = ($p -split ';' | ? { $_ -notmatch '\\\\Programs\\\\Ollama\\\\?$' }) -join ';'; " +
  "if ($n -ne $p) { Set-ItemProperty HKCU:\\Environment -Name Path -Value $n -Type ($k.GetValueKind('Path')) }"],
{ windowsHide: true, timeout: 30000 }, () => r()));

const remove = () => run("remove", () => {}, async () => {
  const uninstaller = path.join(DIR, "unins000.exe");
  if (!fs.existsSync(DIR)) return { ok: true };
  await killIn(DIR);
  if (fs.existsSync(uninstaller)) {
    await new Promise(resolve => execFile(uninstaller, ["/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART"], { windowsHide: true }, () => resolve()));
    // El desinstalador de Inno Setup se copia a una carpeta temporal y sigue desde ahí: se espera a que termine
    for (const end = Date.now() + 120000; fs.existsSync(uninstaller) && Date.now() < end;) await new Promise(r => setTimeout(r, 1000));
  }
  for (const d of [DIR, ...HOME_DIRS]) await fs.promises.rm(d, { recursive: true, force: true }).catch(() => {});
  await fs.promises.rm(STARTUP_LNK, { force: true }).catch(() => {});
  await fs.promises.rm(MARK(), { force: true }).catch(() => {});
  if (fs.existsSync(DIR)) throw new Error("setup");
  await cleanPath();
  return { ok: true };
});

module.exports = { state, start, install, pull, cancel, remove };
