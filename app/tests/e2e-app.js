// Prueba de punta a punta de la app Electron real: primer inicio, crear tablero, guardar en disco, reabrir.
// Perfil y datos aislados en tests/out. Uso: node tests/e2e-app.js
const { spawn } = require("child_process");
const puppeteer = require("puppeteer-core");
const fs = require("fs");
const path = require("path");
const { unzipSync } = require("fflate");

const APP = path.join(__dirname, "..");
const TMP = path.join(__dirname, "out", "app-profile");
const SHOTS = path.join(__dirname, "out", "app");
fs.rmSync(TMP, { recursive: true, force: true });
fs.rmSync(SHOTS, { recursive: true, force: true });
fs.mkdirSync(SHOTS, { recursive: true });
const DATA = path.join(TMP, "data");
const EXPORT = path.join(TMP, "export");
const RESTORE = path.join(TMP, "restaurar.zip");
fs.mkdirSync(EXPORT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = [];
const ok = (n, c, x = "") => log.push(`${c ? "PASS" : "FAIL"} ${n}${x ? " — " + x : ""}`);

async function launch() {
  const proc = spawn(path.join(APP, "node_modules/electron/dist/electron.exe"), [APP, "--remote-debugging-port=9333"], {
    env: { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== "ELECTRON_RUN_AS_NODE")), CHINCHERO_USER_DATA: path.join(TMP, "user"), CHINCHERO_DATA_DIR: DATA, CHINCHERO_EXPORT_DIR: EXPORT, CHINCHERO_RESTORE_FILE: RESTORE },
    stdio: "ignore",
  });
  let browser;
  for (let i = 0; i < 40 && !browser; i++) {
    await sleep(500);
    try { browser = await puppeteer.connect({ browserURL: "http://127.0.0.1:9333", defaultViewport: null }); } catch (e) {}
  }
  let page;
  for (let i = 0; i < 20 && !page; i++) { page = (await browser.pages()).find(p => p.url().startsWith("file:")); if (!page) await sleep(300); }
  page.on("pageerror", e => log.push("PAGEERROR " + e.message));
  page.on("console", m => { if (m.type() === "error") log.push("console.error " + m.text()); });
  return { proc, browser, page };
}

delete process.env.ELECTRON_RUN_AS_NODE;
(async () => {
  // 1) Primer inicio → Bienvenida
  let { proc, browser, page } = await launch();
  await sleep(1200);
  ok("primer inicio abre la bienvenida", page.url().includes("00-bienvenida"), page.url());
  ok("API nativa disponible", await page.evaluate(() => !!window.chinchero && Store.native));
  await page.screenshot({ path: `${SHOTS}/a0-welcome.png` });
  for (let i = 0; i < 3; i++) { await page.click("#next"); await sleep(250); }
  await page.evaluate(() => { document.getElementById("wantTours").checked = false; });
  await Promise.all([page.waitForNavigation(), page.click("#next")]);
  await sleep(1500);
  ok("crea el tablero y abre el editor", page.url().includes("02-tablero.html?board="), page.url());

  // 2) Crear una nota y escribir → se guarda en disco
  await page.keyboard.press("n"); await page.mouse.click(700, 400); await sleep(300);
  await page.keyboard.type("Nota guardada en disco"); await page.mouse.click(1100, 650); await sleep(1000);
  const boardId = new URL(page.url()).searchParams.get("board");
  const file = path.join(DATA, "boards", boardId + ".json");
  const saved = fs.existsSync(file) && fs.readFileSync(file, "utf8").includes("Nota guardada en disco");
  ok("la nota se guarda en boards/<id>.json", saved, file);
  const lib = JSON.parse(fs.readFileSync(path.join(DATA, "library.json"), "utf8"));
  ok("library.json tiene el tablero y el de ejemplo", lib.boards.length === 2, lib.boards.map(b => b.name).join(", "));

  // 3) Pegar una imagen del portapapeles → se copia a media/
  await page.evaluate(async () => {
    const c = document.createElement("canvas"); c.width = 120; c.height = 80;
    const g = c.getContext("2d"); g.fillStyle = "#e8590c"; g.fillRect(0, 0, 120, 80);
    const blob = await new Promise(r => c.toBlob(r, "image/png"));
    const dt = new DataTransfer(); dt.items.add(new File([blob], "captura.png", { type: "image/png" }));
    document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true }));
  });
  await sleep(1500);
  const media = fs.existsSync(path.join(DATA, "media")) ? fs.readdirSync(path.join(DATA, "media")) : [];
  ok("imagen pegada se copia a media/", media.length === 1, media.join(","));
  const src = await page.evaluate(() => document.querySelector(".t-photo img")?.getAttribute("src"));
  ok("la foto usa la copia persistente", /^chinchero-media:/.test(src || ""), src);
  ok("la imagen persistente carga", await page.evaluate(() => { const i = document.querySelector(".t-photo img"); return i && i.complete && i.naturalWidth === 120; }));
  await page.screenshot({ path: `${SHOTS}/a1-editor.png` });

  // 3b) Exportar la hoja entera en alta resolución, aunque no entre en pantalla
  for (let i = 0; i < 6; i++) await page.click("#zoomOut");
  for (const [x, y, t] of [[260, 200, "Arriba a la izquierda"], [1000, 560, "Abajo a la derecha"]]) {
    await page.keyboard.press("n"); await page.mouse.click(x, y); await sleep(250);
    await page.keyboard.type(t); await page.keyboard.press("Escape"); await sleep(200);
  }
  await page.click("#zoomLabel"); await sleep(300);
  const menuItem = async label => {
    await page.click("#exportBtn"); await sleep(200);
    await page.evaluate(l => [...document.querySelectorAll(".menu button")].find(b => b.textContent.includes(l)).click(), label);
  };
  const waitFile = async ext => { for (let i = 0; i < 60; i++) { const f = fs.readdirSync(EXPORT).find(n => n.endsWith(ext)); if (f) { await sleep(300); return path.join(EXPORT, f); } await sleep(250); } };
  await menuItem("Exportar hoja como imagen PNG");
  const pngFile = await waitFile(".png");
  const ihdr = pngFile && fs.readFileSync(pngFile);
  const pw = ihdr ? ihdr.readUInt32BE(16) : 0, ph = ihdr ? ihdr.readUInt32BE(20) : 0;
  const vw = await page.evaluate(() => document.getElementById("viewport").clientWidth * devicePixelRatio);
  ok("PNG de la hoja entera a 2x (más grande que la pantalla)", pw > vw * 2, `${pw}×${ph}, lienzo ${vw}px`);
  ok("la interfaz vuelve a la normalidad tras exportar", await page.evaluate(() => !document.body.classList.contains("exporting")));
  await page.click("#addSheet"); await sleep(400);
  await page.keyboard.press("Enter"); await sleep(200); // la hoja nueva empieza renombrándose
  await page.keyboard.press("n"); await page.mouse.click(700, 400); await sleep(250);
  await page.keyboard.type("Segunda hoja"); await page.keyboard.press("Escape"); await sleep(200);
  await menuItem("Exportar todas las hojas como PDF");
  const pdfFile = await waitFile(".pdf");
  const pdf = pdfFile ? fs.readFileSync(pdfFile, "latin1") : "";
  const boxes = [...pdf.matchAll(/\/MediaBox\s*\[\s*0 0 ([\d.]+) ([\d.]+)/g)].map(m => `${Math.round(m[1])}×${Math.round(m[2])}`);
  ok("PDF con una página por hoja, cada una de su tamaño", boxes.length === 2 && boxes[0] !== boxes[1], boxes.join(", "));
  ok("vuelve a la hoja en la que estaba", await page.evaluate(() => document.querySelector(".sheet.active")?.textContent.includes("Hoja 2")));
  await page.click('.sheet[data-i="0"]'); await sleep(800);

  // 4) Volver a Tableros: tarjetas reales con miniatura
  await Promise.all([page.waitForNavigation(), page.click(".back")]);
  await sleep(800);
  const nCards = await page.$$eval("#grid > a.card", c => c.length); ok("la pantalla de tableros lista 2 tarjetas", nCards === 2, "tarjetas=" + nCards);
  await page.screenshot({ path: `${SHOTS}/a2-boards.png` });

  // 5) Cerrar y reabrir: vuelve al último tablero con el contenido
  await browser.disconnect(); proc.kill(); await sleep(1500);
  ({ proc, browser, page } = await launch());
  await sleep(1800);
  ok("al reabrir vuelve al último tablero", page.url().includes("02-tablero.html?board=" + boardId), page.url());
  ok("el contenido persiste tras reiniciar", await page.evaluate(() => document.body.innerText.includes("Nota guardada en disco")));
  await page.screenshot({ path: `${SHOTS}/a3-reopen.png` });

  // 6) Papelera: eliminar el tablero de ejemplo y restaurarlo
  await page.goto(page.url().replace(/02-tablero\.html.*/, "01-tableros.html?view=recent"));
  await sleep(800);
  await page.evaluate(() => { const ex = Store.library().boards.find(b => b.name.startsWith("Ejemplo")); Store.trashBoard(ex.id); });
  await page.goto(page.url().replace(/01-tableros\.html.*/, "04-papelera.html")); await sleep(700);
  ok("la papelera muestra el tablero eliminado", (await page.$$eval("#list .row", r => r.length)) === 1);
  await page.screenshot({ path: `${SHOTS}/a4-trash.png` });

  // 7) Copias de seguridad: automática al abrir, recuperación de un archivo dañado, copia .zip y restaurar
  const autos = fs.readdirSync(path.join(DATA, "backups")).filter(n => /^auto-.*\.zip$/.test(n));
  const autoZip = autos[0] ? Object.keys(unzipSync(fs.readFileSync(path.join(DATA, "backups", autos[0])))) : [];
  ok("al abrir se guarda una copia automática solo con los JSON", autos.length === 1 && autoZip.includes("library.json") && autoZip.includes(`boards/${boardId}.json`) && !autoZip.some(n => n.startsWith("media/")), autos.join(",") + " → " + autoZip.join(","));

  fs.writeFileSync(file, "{ esto no es JSON");
  await page.goto(page.url().replace(/04-papelera\.html.*/, "02-tablero.html?board=" + boardId)); await sleep(1200);
  ok("un tablero dañado se recupera de la copia automática", await page.evaluate(() => document.body.innerText.includes("Nota guardada en disco")));
  ok("avisa que lo recuperó", await page.evaluate(() => document.querySelector(".toast")?.textContent.includes("lo recuperamos")));
  ok("el archivo dañado queda apartado", fs.readdirSync(path.join(DATA, "boards")).some(n => n.includes(".corrupto-")));

  await page.goto(page.url().replace(/02-tablero\.html.*/, "03-ajustes.html")); await sleep(800);
  await page.evaluate(() => document.getElementById("datos").scrollIntoView());
  await page.screenshot({ path: `${SHOTS}/a5-datos.png` });
  await page.evaluate(() => document.getElementById("backupBtn").click());
  const zipFile = await waitFile(".zip");
  const zipped = zipFile ? Object.keys(unzipSync(fs.readFileSync(zipFile))) : [];
  ok("«Hacer copia» guarda un solo .zip con tableros e imágenes", zipped.includes("library.json") && zipped.includes(`boards/${boardId}.json`) && zipped.some(n => n.startsWith("media/")) && !zipped.some(n => n.startsWith("backups/")), zipped.join(","));

  fs.copyFileSync(zipFile, RESTORE);
  await page.evaluate(() => { Store.library().boards.slice().forEach(b => Store.trashBoard(b.id)); });
  page.once("dialog", d => d.accept());
  await Promise.all([page.waitForNavigation(), page.evaluate(() => document.getElementById("restoreBtn").click())]);
  await sleep(900);
  ok("restaurar vuelve a los tableros de la copia", (await page.$$eval("#grid > a.card", c => c.length)) === 1);
  ok("avisa que restauró", await page.evaluate(() => document.querySelector(".toast")?.textContent.includes("Copia restaurada")));
  ok("antes de restaurar guarda el estado actual", fs.readdirSync(path.join(DATA, "backups")).some(n => n.startsWith("antes-de-restaurar-")));
  await page.screenshot({ path: `${SHOTS}/a5-restored.png` });

  fs.writeFileSync(RESTORE, "no es un zip");
  await page.goto(page.url().replace(/01-tableros\.html.*/, "03-ajustes.html")); await sleep(800);
  page.once("dialog", d => d.accept());
  await page.evaluate(() => document.getElementById("restoreBtn").click()); await sleep(600);
  ok("un archivo que no es copia se rechaza sin tocar nada", await page.evaluate(() => document.querySelector(".toast")?.textContent.includes("No se pudo restaurar")) && fs.existsSync(file));

  await browser.disconnect(); proc.kill();
  fs.writeFileSync(path.join(SHOTS, "log.txt"), log.join("\n"));
  if (log.some(l => /^FAIL|PAGEERROR/.test(l))) process.exitCode = 1;
  console.log(log.join("\n"));
})().catch(e => { console.error(e); process.exit(1); });
