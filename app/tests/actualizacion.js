// Actualización: la conexión del asistente (config.json y la clave cifrada con safeStorage, cuya llave está en
// «Local State») tiene que sobrevivir al pasar de la última versión publicada a la nueva.
// Una actualización real no la toca: el instalador nuevo corre el desinstalador viejo con --updated, que solo borra
// %APPDATA%\Chinchero con deleteAppDataOnUninstall (aquí en false) o --delete-app-data. Lo que puede romperse es que la
// versión nueva no entienda lo que guardó la vieja, y eso es lo que se prueba, sin instalar nada en el equipo:
//   1. Se baja el instalador de la última release (o CHINCHERO_VIEJA=0.5.0) y se extrae con el 7-Zip de electron-builder.
//   2. La versión vieja guarda la configuración y la clave en un perfil aislado (tests/out/actualizacion/perfil).
//   3. La nueva abre ese perfil y tiene que leer la clave y usarla contra un Gemini simulado.
// La nueva es el código fuente con el Electron de desarrollo, o la empaquetada con CHINCHERO_EXE
// (npm run dist:dir → dist/win-unpacked/Chinchero.exe), que además prueba el cambio de versión de Electron.
// Necesita internet la primera vez (después usa el instalador guardado en tests/out/actualizacion).
const { spawnSync } = require("child_process");
const puppeteer = require("puppeteer-core");
const http = require("http");
const fs = require("fs");
const path = require("path");

const APP = path.join(__dirname, "..");
const OUT = path.join(__dirname, "out", "actualizacion");
const PERFIL = path.join(OUT, "perfil");
const REPO = "MaxLezano/Chinchero";

const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = [];
const ok = (n, c, x = "") => log.push(`${c ? "PASS" : "FAIL"} ${n}${x ? " — " + x : ""}`);

// Electron lanzado por la prueba: se cierra con todo su árbol al salir, aunque algo falle
const { vivos, lanzar, matar } = require("./procesos");

// La clave falsa se arma por partes para que los escáneres de secretos no la tomen por una real
const AI_KEY = ["AIza", "Actualizacion_0123456789abcdefghijk"].join("");
const AI_CFG = { enabled: true, provider: "gemini", model: "gemini-flash-latest" };

async function bajar(url, file) {
  const r = await fetch(url, { headers: { "User-Agent": "chinchero-tests" } });
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
}

// 7za.exe que electron-builder deja en su caché al compilar (npm run dist lo baja la primera vez)
function sieteZip() {
  const cache = path.join(process.env.LOCALAPPDATA, "electron-builder", "Cache");
  const buscar = d => fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap(f =>
    f.isDirectory() ? buscar(path.join(d, f.name)) : f.name === "7za.exe" ? [path.join(d, f.name)] : []) : [];
  const exe = buscar(cache)[0];
  if (!exe) throw new Error("No está 7za.exe en la caché de electron-builder: corre «npm run dist:dir» una vez");
  return exe;
}

async function versionVieja() {
  let v = process.env.CHINCHERO_VIEJA;
  if (!v) {
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { "User-Agent": "chinchero-tests" } });
    v = (await r.json()).tag_name.replace(/^v/, "");
  }
  const dir = path.join(OUT, "v" + v), exe = path.join(dir, "Chinchero.exe");
  if (!fs.existsSync(exe)) {
    const setup = path.join(OUT, `Chinchero-Setup-${v}.exe`);
    if (!fs.existsSync(setup)) await bajar(`https://github.com/${REPO}/releases/download/v${v}/Chinchero-Setup-${v}.exe`, setup);
    const r = spawnSync(sieteZip(), ["x", "-y", "-o" + dir, setup], { stdio: "ignore" });
    if (r.status !== 0 || !fs.existsSync(exe)) throw new Error("No se pudo extraer " + setup);
  }
  return { v, exe };
}

// LOCALAPPDATA aislado: si la vieja encuentra una versión más nueva, la baja ahí y no se instala porque se cierra con taskkill
const ENV = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== "ELECTRON_RUN_AS_NODE")),
  CHINCHERO_USER_DATA: path.join(PERFIL, "user"), CHINCHERO_DATA_DIR: path.join(PERFIL, "data"), LOCALAPPDATA: path.join(PERFIL, "localappdata") };

async function abrir(exe, args, env) {
  const proc = lanzar(exe, [...args, "--remote-debugging-port=9334"], { env, stdio: "ignore" });
  let browser, page;
  for (let i = 0; i < 40 && !browser; i++) {
    await sleep(500);
    try { browser = await puppeteer.connect({ browserURL: "http://127.0.0.1:9334", defaultViewport: null }); } catch (e) {}
  }
  for (let i = 0; i < 20 && browser && !page; i++) { page = (await browser.pages()).find(p => p.url().startsWith("chinchero:")); if (!page) await sleep(300); }
  if (!page) throw new Error("No abrió " + exe);
  page.on("pageerror", e => log.push("PAGEERROR " + e.message));
  return { proc, browser, page };
}

// Se cierra la ventana como lo haría el usuario: Chromium escribe «Local State» (con la llave de safeStorage) con
// demora y al salir, así que matar el proceso enseguida la perdería. Solo se mata si no se cerró solo.
async function cerrar({ proc, browser, page }) {
  await page.evaluate(() => window.close()).catch(() => {});
  for (let i = 0; i < 40 && vivos.has(proc); i++) await sleep(250);
  await browser.disconnect().catch(() => {});
  if (vivos.has(proc)) { log.push("FAIL la app no se cerró sola"); matar(proc); }
}

// Gemini simulado: anota la clave con la que llega cada pedido
function gemini(claves) {
  const srv = http.createServer((req, res) => {
    claves.push(req.headers["x-goog-api-key"]);
    req.resume();
    req.on("end", () => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ respuesta: "ok", acciones: [] }) }] } }] }));
    });
  });
  return new Promise(r => srv.listen(0, "127.0.0.1", () => r(srv)));
}

(async () => {
  fs.rmSync(PERFIL, { recursive: true, force: true });
  fs.mkdirSync(PERFIL, { recursive: true });

  const yml = fs.readFileSync(path.join(APP, "electron-builder.yml"), "utf8");
  ok("el desinstalador no borra %APPDATA%\\Chinchero (deleteAppDataOnUninstall: false)", /^\s*deleteAppDataOnUninstall:\s*false\s*$/m.test(yml));

  const vieja = await versionVieja();
  let app = await abrir(vieja.exe, [], ENV);
  const antes = await app.page.evaluate(async (cfg, key) => {
    await window.chinchero.ai.config(cfg);
    const guardada = await window.chinchero.ai.setKey(key);
    return { guardada, st: window.chinchero.ai.status() };
  }, AI_CFG, AI_KEY);
  await cerrar(app);
  ok(`la ${vieja.v} guarda la clave cifrada`, antes.guardada && antes.st.hasKey && !fs.readFileSync(path.join(PERFIL, "user", "config.json"), "utf8").includes(AI_KEY), JSON.stringify(antes.st));

  const claves = [], srv = await gemini(claves);
  const nueva = process.env.CHINCHERO_EXE || path.join(APP, "node_modules/electron/dist/electron.exe");
  app = await abrir(nueva, process.env.CHINCHERO_EXE ? [] : [APP], { ...ENV, CHINCHERO_GEMINI_URL: `http://127.0.0.1:${srv.address().port}` });
  const despues = await app.page.evaluate(async () => ({ st: window.chinchero.ai.status(), prueba: await window.chinchero.ai.test() }));
  await cerrar(app);
  srv.close();

  const etiqueta = `${vieja.v} → ${require("../package.json").version} (${process.env.CHINCHERO_EXE ? "empaquetada" : "código fuente"})`;
  ok(`${etiqueta}: la configuración del asistente sigue igual`, Object.entries(AI_CFG).every(([k, v]) => despues.st[k] === v), JSON.stringify(despues.st));
  ok(`${etiqueta}: la clave se lee con la llave que guardó la versión anterior`, despues.st.hasKey && despues.st.keyHint === "…" + AI_KEY.slice(-4));
  ok(`${etiqueta}: «Probar» funciona con la clave conservada`, despues.prueba.ok === true && claves.length > 0 && claves.every(k => k === AI_KEY), JSON.stringify(despues.prueba));

  fs.writeFileSync(path.join(OUT, "log.txt"), log.join("\n"));
  if (log.some(l => /^FAIL|PAGEERROR/.test(l))) process.exitCode = 1;
  console.log(log.join("\n"));
})().catch(e => { console.error(e); process.exit(1); });
