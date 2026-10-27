// Instalación guiada de Ollama: la app baja el instalador oficial, comprueba su firma, lo ejecuta en silencio
// (se instala para el usuario, sin permisos de administrador) y descarga un modelo con /api/pull.
// Solo hay una tarea a la vez; el progreso se envía a la pantalla que la pidió.
const { net } = require("electron");
const { execFile, spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");

const OLLAMA = process.env.CHINCHERO_OLLAMA_URL || "http://127.0.0.1:11434";
const SETUP_URL = process.env.CHINCHERO_OLLAMA_SETUP_URL || "https://ollama.com/download/OllamaSetup.exe";
const APP_EXE = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "Programs", "Ollama", "ollama app.exe");
const SETUP_FILE = path.join(os.tmpdir(), "Chinchero-OllamaSetup.exe");

let job = null; // { kind, ctrl, child }

const alive = () => net.fetch(OLLAMA + "/api/tags", { signal: AbortSignal.timeout(3000) }).then(r => r.ok, () => false);

async function state() {
  return { running: await alive(), installed: fs.existsSync(APP_EXE), busy: job?.kind || null };
}

// Abre la app de Ollama (queda en la bandeja) y espera a que su API responda
async function start(ms = 30000) {
  if (await alive()) return true;
  if (!fs.existsSync(APP_EXE)) return false;
  spawn(APP_EXE, [], { detached: true, stdio: "ignore" }).unref();
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

const install = progress => run("install", progress, async ctrl => {
  if (await alive()) return { ok: true };
  if (!fs.existsSync(APP_EXE)) {
    try {
      await download(ctrl, progress);
      progress({ step: "verify" });
      if (ctrl.signal.aborted) throw new Error("cancel");
      if (!(await signedByOllama(SETUP_FILE))) throw new Error("unsigned");
      // Desde aquí no se cancela: cortar un instalador a medias deja Ollama roto
      progress({ step: "install" });
      await runSetup();
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

module.exports = { state, start, install, pull, cancel };
