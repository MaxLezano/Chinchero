// Prueba de punta a punta de la app Electron real: primer inicio, crear tablero, guardar en disco, reabrir.
// Perfil y datos aislados en tests/out. Uso: node tests/e2e-app.js
const { spawn } = require("child_process");
const puppeteer = require("puppeteer-core");
const fs = require("fs");
const path = require("path");
const { unzipSync, zipSync, strToU8 } = require("fflate");

const APP = path.join(__dirname, "..");
const TMP = path.join(__dirname, "out", "app-profile");
const SHOTS = path.join(__dirname, "out", "app");
fs.rmSync(TMP, { recursive: true, force: true });
fs.rmSync(SHOTS, { recursive: true, force: true });
fs.mkdirSync(SHOTS, { recursive: true });
const DATA = path.join(TMP, "data");
const EXPORT = path.join(TMP, "export");
const RESTORE = path.join(TMP, "restaurar.zip");
const IMPORT = path.join(TMP, "importar.chinchero");
fs.mkdirSync(EXPORT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = [];
const ok = (n, c, x = "") => log.push(`${c ? "PASS" : "FAIL"} ${n}${x ? " — " + x : ""}`);

// CHINCHERO_EXE prueba la app empaquetada (dist/win-unpacked/Chinchero.exe), con los fuses activados
const ELECTRON = process.env.CHINCHERO_EXE || path.join(APP, "node_modules/electron/dist/electron.exe");
const ENV = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== "ELECTRON_RUN_AS_NODE")), CHINCHERO_USER_DATA: path.join(TMP, "user"), CHINCHERO_DATA_DIR: DATA, CHINCHERO_EXPORT_DIR: EXPORT, CHINCHERO_RESTORE_FILE: RESTORE, CHINCHERO_IMPORT_FILE: IMPORT };

async function launch() {
  const proc = spawn(ELECTRON, [APP, "--remote-debugging-port=9333"], { env: ENV, stdio: "ignore" });
  let browser;
  for (let i = 0; i < 40 && !browser; i++) {
    await sleep(500);
    try { browser = await puppeteer.connect({ browserURL: "http://127.0.0.1:9333", defaultViewport: null }); } catch (e) {}
  }
  let page;
  for (let i = 0; i < 20 && !page; i++) { page = (await browser.pages()).find(p => p.url().startsWith("chinchero:")); if (!page) await sleep(300); }
  page.on("pageerror", e => log.push("PAGEERROR " + e.message));
  page.on("console", m => { if (m.type() === "error") log.push("console.error " + m.text()); });
  return { proc, browser, page };
}

// Proveedor de IA simulado: imita las API de Ollama y de Gemini y guarda los pedidos para revisarlos
// La clave falsa se arma por partes para que los escáneres de secretos no la tomen por una real
const AI_KEY = ["AIza", "Prueba_0123456789abcdefghijklmnopqr"].join("");
const aiReqs = [];
function fakeAI() {
  const http = require("http");
  const send = (res, code, obj) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
  const srv = http.createServer((req, res) => {
    let body = "";
    req.on("data", c => body += c);
    req.on("end", () => {
      const r = { method: req.method, url: req.url, key: req.headers["x-goog-api-key"], body: body ? JSON.parse(body) : null };
      aiReqs.push(r);
      if (req.url === "/api/tags") return send(res, 200, { models: [{ name: "llama-prueba" }] });
      if (req.url === "/api/chat") {
        // Respuesta envuelta en ```json como hacen algunos modelos pequeños, con una acción sobre un id que no existe
        const acciones = [
          { op: "crear", ref: "n1", tipo: "nota", texto: "Idea <b>uno</b>", color: "verde" },
          { op: "crear", ref: "l1", tipo: "lista", titulo: "Tareas IA", tareas: ["Primera", "Segunda"], cerca: "n1" },
          { op: "unir", a: "n1", b: "l1", etiqueta: "relación" },
          { op: "borrar", id: "no-existe" },
        ];
        return send(res, 200, { message: { role: "assistant", content: "```json\n" + JSON.stringify({ respuesta: "Creé una idea y una lista.", acciones }) + "\n```" } });
      }
      if (r.key !== AI_KEY) return send(res, 403, { error: { message: "API key not valid" } });
      if (req.url.startsWith("/v1beta/models?")) return send(res, 200, { models: [
        { name: "models/gemini-flash-latest", supportedGenerationMethods: ["generateContent"] },
        { name: "models/gemini-prueba-pro", supportedGenerationMethods: ["generateContent"] },
        { name: "models/text-embedding-004", supportedGenerationMethods: ["embedContent"] },
      ] });
      if (/^\/v1beta\/models\/[\w.-]+:generateContent$/.test(req.url)) {
        // El primero del modo automático está saturado: la app debe pasar sola al siguiente
        if (req.url.includes("flash-lite")) return send(res, 503, { error: { message: "high demand" } });
        if (r.body.contents.at(-1).parts[0].text.includes("Pedido: cupo")) return send(res, 429, { error: { message: "quota" } });
        return send(res, 200, { candidates: [{ content: { parts: [{ text: JSON.stringify({ respuesta: "Hola desde Gemini", acciones: [] }) }] } }] });
      }
      send(res, 404, {});
    });
  });
  return new Promise(r => srv.listen(0, "127.0.0.1", () => r(srv)));
}

delete process.env.ELECTRON_RUN_AS_NODE;
(async () => {
  const aiSrv = await fakeAI();
  ENV.CHINCHERO_OLLAMA_URL = ENV.CHINCHERO_GEMINI_URL = `http://127.0.0.1:${aiSrv.address().port}`;
  // 1) Primer inicio → Bienvenida
  let { proc, browser, page } = await launch();
  // Espera (hasta 4 s) un toast con ese texto: leerlo una sola vez fallaba a veces si tardaba un poco más
  const toast = text => page.waitForFunction(t => [...document.querySelectorAll(".toast")].some(e => e.textContent.includes(t)), { timeout: 4000 }, text).then(() => true, () => false);
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
  // Cada mosaico se captura con su parte de la hoja aunque la ventana que tapa el lienzo esté encima:
  // la nota de arriba a la izquierda y la de abajo a la derecha salen en su cuarto del PNG
  const notas = ihdr ? await page.evaluate(async b64 => {
    const bmp = await createImageBitmap(new Blob([Uint8Array.from(atob(b64), c => c.charCodeAt(0))], { type: "image/png" }));
    const c = new OffscreenCanvas(bmp.width, bmp.height), g = c.getContext("2d");
    g.drawImage(bmp, 0, 0);
    const amarillo = (x, y, w, h) => { const d = g.getImageData(x, y, w, h).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 230 && d[i + 1] > 200 && d[i + 2] < 140) n++; return n; };
    const W = bmp.width, H = bmp.height;
    return [amarillo(0, 0, W / 2, H / 2), amarillo(W / 2, H / 2, W / 2, H / 2)];
  }, ihdr.toString("base64")) : [0, 0];
  ok("el PNG tiene la nota de cada esquina (los mosaicos no se repiten)", notas[0] > 5000 && notas[1] > 5000, notas.join(" / "));
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
  const beforeFetch = log.length; // los 404 de esta prueba son esperados
  ok("chinchero://app solo sirve archivos de las pantallas", await page.evaluate(async () => {
    const st = async u => { try { return (await fetch(u)).status; } catch { return 0; } };
    return [await st("chinchero://app/assets/theme.css"), await st("chinchero://app/%2e%2e/main/main.js"), await st("chinchero://app/..%2fmain%2fmain.js")];
  }).then(r => r[0] === 200 && r[1] === 404 && r[2] === 404));
  for (let i = log.length - 1; i >= beforeFetch; i--) if (log[i].includes("404 (Not Found)")) log.splice(i, 1);
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
  ok("avisa que lo recuperó", await toast("lo recuperamos"));
  ok("el archivo dañado queda apartado", fs.readdirSync(path.join(DATA, "boards")).some(n => n.includes(".corrupto-")));

  // Liberar espacio: un archivo sin usar y su miniatura se borran; lo que usa un tablero o una copia de backups/ se conserva
  const MEDIA = path.join(DATA, "media"), inUse = fs.readdirSync(MEDIA).filter(n => n !== "thumbs");
  fs.mkdirSync(path.join(MEDIA, "thumbs"), { recursive: true });
  fs.writeFileSync(path.join(MEDIA, "sinusar0001.png"), Buffer.alloc(300 * 1024, 1));
  fs.writeFileSync(path.join(MEDIA, "thumbs", "sinusar0001.jpg"), Buffer.alloc(1024, 1));
  fs.writeFileSync(path.join(MEDIA, "encopia0001.pdf"), Buffer.alloc(1024, 1));
  fs.writeFileSync(path.join(DATA, "backups", "prueba-copia.zip"), zipSync({ "boards/viejo.json": strToU8(JSON.stringify({ sheets: [{ items: [{ type: "file", src: "chinchero-media://media/encopia0001.pdf" }] }] })) }));
  await page.goto(page.url().replace(/02-tablero\.html.*/, "03-ajustes.html")); await sleep(800);
  await page.evaluate(() => document.getElementById("datos").scrollIntoView());
  await page.screenshot({ path: `${SHOTS}/a5-datos.png` });
  ok("«Liberar espacio» cuenta solo lo que no se usa", await page.evaluate(() => /^1 imagen o archivo que ningún tablero usa \(301 KB\)/.test(document.getElementById("unused").textContent) && !document.getElementById("cleanBtn").disabled),
    await page.evaluate(() => document.getElementById("unused").textContent));
  page.once("dialog", d => d.accept());
  await page.evaluate(() => document.getElementById("cleanBtn").click()); await sleep(800);
  const left = fs.readdirSync(MEDIA);
  ok("«Liberar espacio» borra el archivo sin usar y su miniatura", !left.includes("sinusar0001.png") && !fs.existsSync(path.join(MEDIA, "thumbs", "sinusar0001.jpg")) && await toast("Espacio liberado: 301 KB"), left.join(","));
  ok("«Liberar espacio» conserva lo que usan los tableros y las copias", inUse.length > 0 && inUse.every(n => left.includes(n)) && left.includes("encopia0001.pdf") && await page.evaluate(() => document.getElementById("cleanBtn").disabled && document.getElementById("unused").textContent.startsWith("No hay nada que borrar")));
  fs.rmSync(path.join(DATA, "backups", "prueba-copia.zip"));
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
  ok("avisa que restauró", await toast("Copia restaurada"));
  ok("antes de restaurar guarda el estado actual", fs.readdirSync(path.join(DATA, "backups")).some(n => n.startsWith("antes-de-restaurar-")));
  await page.screenshot({ path: `${SHOTS}/a5-restored.png` });

  fs.writeFileSync(RESTORE, "no es un zip");
  await page.goto(page.url().replace(/01-tableros\.html.*/, "03-ajustes.html")); await sleep(800);
  page.once("dialog", d => d.accept());
  await page.evaluate(() => document.getElementById("restoreBtn").click()); await sleep(600);
  ok("un archivo que no es copia se rechaza sin tocar nada", await toast("No se pudo restaurar") && fs.existsSync(file));

  // 8) Compartir un tablero: exportar a .chinchero e importarlo (botón, archivo dañado, contenido peligroso, doble clic)
  await page.goto(page.url().replace(/03-ajustes\.html.*/, "01-tableros.html?view=recent")); await sleep(800);
  await page.click(`#grid > a.card[data-id="${boardId}"]`, { button: "right" }); await sleep(200);
  await page.evaluate(() => [...document.querySelectorAll(".menu button")].find(b => b.textContent.includes("Exportar tablero")).click());
  const shareFile = await waitFile(".chinchero");
  const shared = shareFile ? unzipSync(fs.readFileSync(shareFile)) : {};
  const sharedPkg = shared["tablero.json"] ? JSON.parse(Buffer.from(shared["tablero.json"]).toString("utf8")) : {};
  const sharedMedia = Object.keys(shared).filter(n => n.startsWith("media/"));
  ok("«Exportar tablero…» guarda un .chinchero con el tablero y sus imágenes", sharedPkg.formato === "chinchero-tablero" && sharedMedia.length > 0 && !shared["library.json"], Object.keys(shared).join(","));

  fs.rmSync(path.join(DATA, "media"), { recursive: true, force: true });
  fs.copyFileSync(shareFile, IMPORT);
  await page.click("#importBtn"); await sleep(1000);
  const libImp = JSON.parse(fs.readFileSync(path.join(DATA, "library.json"), "utf8"));
  const imported = libImp.boards.find(b => b.id !== boardId);
  ok("«Importar tablero» crea un tablero nuevo con otro id", libImp.boards.length === 2 && imported?.name === sharedPkg.board.name && fs.existsSync(path.join(DATA, "boards", imported.id + ".json")), libImp.boards.map(b => b.id).join(","));
  ok("avisa que lo importó y ofrece abrirlo", await toast("importadoAbrir"));
  ok("las imágenes del tablero importado se copian a media/", fs.existsSync(path.join(DATA, "media")) && fs.readdirSync(path.join(DATA, "media")).length === sharedMedia.length);
  await page.screenshot({ path: `${SHOTS}/a6-imported.png` });
  await Promise.all([page.waitForNavigation(), page.evaluate(() => document.querySelector(".toast button").click())]);
  await sleep(1200);
  ok("el tablero importado abre con su contenido e imagen", await page.evaluate(() => document.body.innerText.includes("Nota guardada en disco") && [...document.querySelectorAll(".t-photo img")].some(i => i.complete && i.naturalWidth === 120)));

  fs.writeFileSync(IMPORT, "no es un tablero");
  await page.goto(page.url().replace(/02-tablero\.html.*/, "01-tableros.html?view=recent")); await sleep(800);
  await page.click("#importBtn"); await sleep(600);
  ok("un archivo que no es un tablero se rechaza", await toast("No se pudo importar") && JSON.parse(fs.readFileSync(path.join(DATA, "library.json"), "utf8")).boards.length === 2);

  const evil = '<img src=x onerror="window.__xss=1">';
  const evilDoc = { name: "Ajeno", active: 0, sheets: [{ name: `Hoja${evil}`, color: "yellow", threads: [], items: [
    { id: `n1${evil}`, type: "note", x: 100, y: 100, w: 180, h: 170, rot: 0, z: 1, color: "yellow", fs: "m", fix: "pin", pin: { x: .5, y: .04, color: `red">${evil}` }, text: `<b onclick="x()">Hola</b>${evil}<script>window.__xss=1</script>` },
    { id: "s1", type: "stamp", x: 400, y: 100, rot: 0, z: 2, s: 1, text: "SELLO", color: `red">${evil}` },
  ] }] };
  fs.writeFileSync(IMPORT, zipSync({ "tablero.json": strToU8(JSON.stringify({ formato: "chinchero-tablero", version: 1, board: { name: `Ajeno${evil}` }, doc: evilDoc })) }));
  // Los atributos on… se renombran antes de analizar el texto con formato: Chromium ni siquiera avisa de la CSP
  const beforeEvil = log.length;
  await page.click("#importBtn"); await sleep(800);
  ok("importar un tablero con atributos on… no da avisos de CSP", !log.slice(beforeEvil).some(l => l.includes("Content Security Policy")));
  const evilId = JSON.parse(fs.readFileSync(path.join(DATA, "library.json"), "utf8")).boards.find(b => b.name.startsWith("Ajeno"))?.id;
  await page.goto(page.url().replace(/01-tableros\.html.*/, "02-tablero.html?board=" + evilId)); await sleep(1200);
  ok("un tablero importado no puede ejecutar código", await page.evaluate(() => !window.__xss && document.querySelector(".t-note .txt")?.innerHTML === "<b>Hola</b>" && !document.querySelector("#items img")),
    await page.evaluate(() => document.querySelector(".t-note .txt")?.innerHTML));

  // El proceso principal rechaza argumentos que no son del tipo esperado
  const ipc = await page.evaluate(async () => {
    const rejects = async p => { try { await p; return false; } catch { return true; } };
    const c = window.chinchero;
    return {
      load: c.loadBoard("../library") === null,
      save: await rejects(c.saveBoard("../../fuera", { sheets: [] })),
      saveDoc: await rejects(c.saveBoard("bueno", "no es un documento")),
      lib: await rejects(c.saveLibrary(null)),
      del: await rejects(c.deleteBoard({ id: "x" })),
      choose: await rejects(c.chooseDataDir("C:\\")),
      ext: await rejects(c.openExternal(["https://x.com"])),
      media: await rejects(c.openMedia("file:///C:/Windows/notepad.exe")),
      rect: await rejects(c.capture({ x: 0, y: 0, width: -5, height: "a" })),
      cover: await rejects(c.coverWindow("sí")),
      png: await rejects(c.exportPng("no son bytes", "x")),
      pdf: await rejects(c.exportPdf([{ png: new Uint8Array(1), w: 1 }], "x")),
      imp: await rejects(c.importBoard("C:\\Windows\\win.ini")),
      aiProv: await rejects(c.ai.config({ provider: "otro" })),
      aiOn: await rejects(c.ai.config({ enabled: "sí" })),
      aiExtra: await rejects(c.ai.config({ url: "http://evil" })),
      aiKey: await rejects(c.ai.setKey(123)),
      aiModels: await rejects(c.ai.models("otro")),
      aiEmpty: await rejects(c.ai.chat({ messages: [], board: "{}" })),
      aiRole: await rejects(c.ai.chat({ messages: [{ role: "system", text: "x" }], board: "{}" })),
    };
  });
  ok("IPC: argumentos no válidos se rechazan", Object.values(ipc).every(Boolean), JSON.stringify(ipc));
  ok("IPC: el tablero sigue intacto tras los rechazos", fs.existsSync(path.join(DATA, "library.json")) && !fs.existsSync(path.join(TMP, "fuera.json")));

  // 9) Asistente con IA (proveedor simulado): desactivado de fábrica, Ollama, Gemini con la clave del portapapeles
  await page.goto(page.url().replace(/02-tablero\.html.*/, "03-ajustes.html")); await sleep(800);
  ok("IA: desactivada de fábrica", await page.evaluate(() => !document.getElementById("aiOn").checked && !window.chinchero.ai.status().enabled && document.querySelector("#asistente [data-ai]").hidden));
  await page.click("#aiOn + span"); await sleep(1000);
  ok("IA: al activarla usa Ollama y encuentra sus modelos", await page.evaluate(() => {
    const st = window.chinchero.ai.status();
    return st.enabled && st.provider === "ollama" && document.getElementById("aiOllama").textContent.includes("1 modelo") && [...document.querySelectorAll("#aiModel option")].some(o => o.value === "llama-prueba");
  }), await page.evaluate(() => document.getElementById("aiOllama").textContent));
  await page.screenshot({ path: `${SHOTS}/a8-ajustes-ia.png` });
  await page.goto(page.url().replace(/03-ajustes\.html.*/, "02-tablero.html?board=" + boardId)); await sleep(1200);
  const count = () => page.evaluate(() => ({ items: document.querySelectorAll("#items .item").length, threads: document.querySelectorAll("#threadLayer .th").length }));
  const before = await count();
  await page.click("#aiBtn"); await sleep(300);
  await page.type("#aiInput", "Dame ideas"); await page.keyboard.press("Enter");
  await page.waitForSelector(".ai-msg.assistant", { timeout: 8000 }).catch(() => {});
  await sleep(500);
  const after = await count();
  const chatReq = aiReqs.find(r => r.url === "/api/chat");
  ok("IA: Ollama recibe la hoja y el pedido", !!chatReq && chatReq.body.model === "llama-prueba" && chatReq.body.format === "json" && chatReq.body.messages[0].role === "system"
    && chatReq.body.messages.at(-1).content.includes("Pedido: Dame ideas") && chatReq.body.messages.at(-1).content.includes("Nota guardada en disco"));
  ok("IA: aplica las acciones (nota, lista e hilo) y avisa", after.items === before.items + 2 && after.threads === before.threads + 1
    && await page.evaluate(() => document.querySelector(".ai-msg.assistant").textContent.includes("3 cambios")), JSON.stringify({ before, after }));
  ok("IA: el texto del modelo no se interpreta como HTML", await page.evaluate(() => [...document.querySelectorAll(".t-note .txt")].some(e => e.innerHTML.includes("&lt;b&gt;uno"))));
  await page.screenshot({ path: `${SHOTS}/a9-asistente.png` });
  await page.click(".ai-did button"); await sleep(400);
  ok("IA: «Deshacer» quita todo lo que hizo de una vez", JSON.stringify(await count()) === JSON.stringify(before));

  // Gemini: la clave copiada se detecta, se guarda cifrada y nunca llega a la pantalla ni a la carpeta de datos
  await page.evaluate(() => window.chinchero.ai.config({ provider: "gemini" }));
  await page.goto(page.url().replace(/02-tablero\.html.*/, "03-ajustes.html")); await sleep(1000);
  // Se copia desde la página (sin lanzar otros programas) y se vuelve a enfocar la ventana, como al volver del navegador
  await page.evaluate(k => { const t = document.createElement("textarea"); t.value = k; document.body.append(t); t.select(); document.execCommand("copy"); t.remove(); window.dispatchEvent(new Event("focus")); }, AI_KEY);
  await sleep(600);
  ok("IA: detecta la clave de Gemini copiada", await page.evaluate(k => !document.getElementById("aiFound").hidden && document.getElementById("aiFoundTxt").textContent.includes(k.slice(-4)), AI_KEY));
  await page.evaluate(() => document.getElementById("aiUseClip").click()); await sleep(1000);
  const aiSt = await page.evaluate(() => window.chinchero.ai.status());
  const cfgTxt = fs.readFileSync(path.join(TMP, "user", "config.json"), "utf8");
  const files = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(f => f.isDirectory() ? files(path.join(d, f.name)) : [path.join(d, f.name)]);
  const leaks = files(DATA).filter(f => fs.readFileSync(f).includes(AI_KEY));
  ok("IA: la clave se guarda cifrada y fuera de los tableros", aiSt.hasKey && aiSt.keyHint === "…" + AI_KEY.slice(-4) && !JSON.stringify(aiSt).includes(AI_KEY) && cfgTxt.includes("aiKey") && !cfgTxt.includes(AI_KEY) && !leaks.length, leaks.join(","));
  ok("IA: lista los modelos de Gemini que sirven para chatear", await page.evaluate(() => { const o = [...document.querySelectorAll("#aiModel option")].map(o => o.value); return o.includes("gemini-prueba-pro") && !o.includes("text-embedding-004"); }));
  await page.goto(page.url().replace(/03-ajustes\.html.*/, "02-tablero.html?board=" + boardId)); await sleep(1200);
  await page.click("#aiBtn"); await sleep(300);
  ok("IA: con Gemini se avisa que el texto sale del equipo", await page.evaluate(() => document.getElementById("aiPrivacy").textContent.includes("Google")));
  await page.type("#aiInput", "Hola"); await page.keyboard.press("Enter");
  await page.waitForFunction(() => [...document.querySelectorAll(".ai-msg.assistant")].some(e => e.textContent.includes("Gemini")), { timeout: 8000 }).catch(() => {});
  const gReq = aiReqs.find(r => r.url.includes("gemini-flash-latest:generateContent"));
  ok("IA: Gemini responde con la clave guardada (y si un modelo está saturado prueba el siguiente)", !!gReq && aiReqs.some(r => r.url.includes("flash-lite-latest:generateContent")) && gReq.key === AI_KEY && gReq.body.generationConfig.responseMimeType === "application/json"
    && await page.evaluate(() => [...document.querySelectorAll(".ai-msg.assistant")].some(e => e.textContent.includes("Hola desde Gemini"))));
  await page.type("#aiInput", "cupo"); await page.keyboard.press("Enter");
  await page.waitForSelector(".ai-msg.error", { timeout: 8000 }).catch(() => {});
  ok("IA: sin cupo gratis se explica qué pasa", await page.evaluate(() => document.querySelector(".ai-msg.error")?.textContent.includes("cupo")));
  ok("IA: una clave con otro formato no se acepta", await page.evaluate(() => window.chinchero.ai.setKey("no-es-una-clave")) === false);
  ok("IA: acepta el formato nuevo de clave de AI Studio («AQ.…»)", await page.evaluate(() => window.chinchero.ai.setKey("AQ.Prueba_0123456789-abcdefghijklmnopqrstuvwxyz")) === true);
  aiSrv.close();

  fs.copyFileSync(shareFile, path.join(TMP, "doble-clic.chinchero"));
  spawn(ELECTRON, [APP, path.join(TMP, "doble-clic.chinchero")], { env: ENV, stdio: "ignore" });
  let opened = null;
  for (let i = 0; i < 30 && !opened; i++) {
    await sleep(300);
    const id = new URL(page.url()).searchParams.get("board");
    if (id && ![boardId, imported?.id, evilId].includes(id)) opened = id;
  }
  await sleep(800);
  ok("abrir un .chinchero con doble clic (app abierta) lo importa y lo abre", !!opened && await page.evaluate(() => document.body.innerText.includes("Nota guardada en disco")), page.url());
  await page.screenshot({ path: `${SHOTS}/a7-doble-clic.png` });

  await browser.disconnect(); proc.kill();
  fs.writeFileSync(path.join(SHOTS, "log.txt"), log.join("\n"));
  if (log.some(l => /^FAIL|PAGEERROR|Content Security Policy/.test(l))) process.exitCode = 1;
  console.log(log.join("\n"));
})().catch(e => { console.error(e); process.exit(1); });
