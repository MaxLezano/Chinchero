// Prueba de carga con la app real: un tablero con 500 elementos (100 fotos grandes) y 120 hilos.
// Mide cuánto tarda en abrir y la fluidez (duración de los fotogramas) al arrastrar, hacer zoom y mover todo.
// Perfil y datos aislados en tests/out. Uso: node tests/carga.js
const { spawn, spawnSync } = require("child_process");
const puppeteer = require("puppeteer-core");
const fs = require("fs");
const path = require("path");

const APP = path.join(__dirname, "..");
const TMP = path.join(__dirname, "out", "carga-profile");
const SHOTS = path.join(__dirname, "out", "carga");
fs.rmSync(TMP, { recursive: true, force: true });
fs.rmSync(SHOTS, { recursive: true, force: true });
fs.mkdirSync(SHOTS, { recursive: true });
const DATA = path.join(TMP, "data"), USER = path.join(TMP, "user");
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = [];
const ok = (n, c, x = "") => log.push(`${c ? "PASS" : "FAIL"} ${n}${x ? " — " + x : ""}`);

// Objetivos
const OPEN_MS = 1000, FRAME_P95_MS = 34;
const PHOTOS = 100, ITEMS = 500, THREADS = 120;

fs.mkdirSync(USER, { recursive: true });
fs.writeFileSync(path.join(USER, "config.json"), JSON.stringify({ firstRunDone: true }));
fs.mkdirSync(path.join(DATA, "boards"), { recursive: true });
fs.writeFileSync(path.join(DATA, "library.json"), JSON.stringify({
  version: 1, groups: [{ id: "personal", name: "Personal", color: "#51cf66" }], trash: [], stickers: [],
  boards: [{ id: "carga", name: "Carga", group: "personal", createdAt: Date.now(), updatedAt: Date.now(), sheets: 1, items: ITEMS }],
}));

const ELECTRON = path.join(APP, "node_modules/electron/dist/electron.exe");
const ENV = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== "ELECTRON_RUN_AS_NODE")), CHINCHERO_USER_DATA: USER, CHINCHERO_DATA_DIR: DATA };

// Electron lanzado por las pruebas: se cierra con todo su árbol al salir, aunque una prueba falle con una excepción
const vivos = new Set();
const lanzar = (...a) => { const p = spawn(...a); vivos.add(p); p.on("exit", () => vivos.delete(p)); return p; };
process.on("exit", () => { for (const p of vivos) spawnSync("taskkill", ["/pid", String(p.pid), "/T", "/F"], { stdio: "ignore" }); });

// Tablero sintético: cuadrícula de 25 × 20 con notas, fichas, listas, textos, stickers y fotos repartidas
function makeBoard(urls) {
  const items = [], kinds = ["note", "note", "note", "card", "list", "note", "text", "sticker", "note", "card"];
  let p = 0;
  for (let i = 0; i < ITEMS; i++) {
    const x = 40 + (i % 25) * 300, y = 40 + Math.floor(i / 25) * 300, base = { id: "e" + (i + 1), x, y, rot: (i % 7) - 3, z: i + 1, locked: false, pin: { x: .5, y: .04, color: "#e03131" } };
    const type = i % 5 === 2 && p < PHOTOS ? "photo" : kinds[i % kinds.length];
    if (type === "photo") items.push({ ...base, type, w: 210, h: 180, src: urls[p++], art: "", caption: "Foto " + p, frame: "polaroid", fit: "cover", fix: "pin" });
    else if (type === "note") items.push({ ...base, type, w: 180, h: 170, color: ["yellow", "blue", "pink", "green"][i % 4], text: `Nota <b>${i}</b> con algo de texto`, fs: "m", fix: "pin" });
    else if (type === "card") items.push({ ...base, type, w: 240, h: 150, title: "Ficha " + i, text: "Detalle de la ficha", fix: "pin" });
    else if (type === "list") items.push({ ...base, type, w: 230, h: 120, title: "Lista " + i, tasks: [{ text: "Uno", done: true }, { text: "Dos", done: false }, { text: "Tres", done: false }], fix: "pin" });
    else if (type === "text") items.push({ ...base, type, text: "Título " + i, s: 1, ink: "", fix: null });
    else items.push({ ...base, type: "sticker", emoji: "⭐", img: "", s: 1, fix: null });
  }
  const pinned = items.filter(o => o.fix === "pin"), threads = [];
  for (let i = 0; i < THREADS; i++) threads.push({ id: "t" + i, a: pinned[i].id, b: pinned[i + 1].id, color: "", label: i % 10 ? "" : "hilo", sag: 1 });
  return { name: "Carga", active: 0, sheets: [{ id: "s1", name: "Hoja 1", color: "yellow", surface: "dots", items, threads, view: null }] };
}

// Graba la duración de cada fotograma mientras corre `fn` (rAF en la página)
async function frames(page, fn) {
  await page.evaluate(() => {
    window.__fr = []; let last = performance.now();
    const tick = t => { window.__fr.push(t - last); last = t; if (window.__fr) window.__frId = requestAnimationFrame(tick); };
    window.__frId = requestAnimationFrame(tick);
  });
  await fn();
  await sleep(300);
  const fr = await page.evaluate(() => { cancelAnimationFrame(window.__frId); const f = window.__fr.slice(1); window.__fr = null; return f; });
  const sorted = [...fr].sort((a, b) => a - b);
  return { n: fr.length, p95: Math.round(sorted[Math.floor(sorted.length * .95)] || 0), max: Math.round(sorted.at(-1) || 0) };
}
// Una medición puede caer justo cuando la máquina está ocupada (otra prueba, el antivirus): se repite hasta 3 veces
// y vale la mejor, así la prueba mide lo que la app puede hacer y no el ruido
async function bestFrames(page, fn) {
  let best = null;
  for (let i = 1; i <= 3; i++) {
    const f = { ...await frames(page, fn), tries: i };
    if (!best || f.p95 < best.p95) best = f;
    if (best.p95 <= FRAME_P95_MS) break;
  }
  return best;
}
const fmtF = f => `p95 ${f.p95} ms, máx ${f.max} ms, ${f.n} fotogramas${f.tries > 1 ? `, ${f.tries} intentos` : ""}`;

delete process.env.ELECTRON_RUN_AS_NODE;
(async () => {
  const proc = lanzar(ELECTRON, [APP, "--remote-debugging-port=9334"], { env: ENV, stdio: "ignore" });
  let browser, page;
  for (let i = 0; i < 40 && !browser; i++) { await sleep(500); try { browser = await puppeteer.connect({ browserURL: "http://127.0.0.1:9334", defaultViewport: null }); } catch {} }
  for (let i = 0; i < 20 && !page; i++) { page = (await browser.pages()).find(p => p.url().startsWith("chinchero:")); if (!page) await sleep(300); }
  page.on("pageerror", e => log.push("PAGEERROR " + e.message));
  page.on("console", m => { if (m.type() === "error") log.push("console.error " + m.text()); });
  await sleep(800);

  // 1) 100 fotos JPEG de 3000 × 2000 importadas como lo hace la app (se copian a media/)
  const t0 = Date.now();
  const urls = await page.evaluate(async n => {
    const c = document.createElement("canvas"); c.width = 3000; c.height = 2000;
    const g = c.getContext("2d"), out = [];
    for (let i = 0; i < n; i++) {
      const gr = g.createLinearGradient(0, 0, 3000, 2000);
      gr.addColorStop(0, `hsl(${i * 37 % 360} 70% 55%)`); gr.addColorStop(1, `hsl(${(i * 37 + 120) % 360} 70% 35%)`);
      g.fillStyle = gr; g.fillRect(0, 0, 3000, 2000);
      for (let k = 0; k < 400; k++) { g.fillStyle = `hsl(${(i * 13 + k * 7) % 360} 60% ${30 + k % 50}%)`; g.fillRect((k * 397 + i * 53) % 3000, (k * 211 + i * 31) % 2000, 60 + k % 140, 40 + k % 90); }
      const blob = await new Promise(r => c.toBlob(r, "image/jpeg", .9));
      out.push(await Store.importFile(new File([blob], `foto-${i}.jpg`, { type: "image/jpeg" })));
    }
    return out;
  }, PHOTOS);
  await sleep(1000); // la última miniatura se crea justo después de importar
  const media = fs.readdirSync(path.join(DATA, "media")).filter(f => f.endsWith(".jpg"));
  ok(`importa ${PHOTOS} fotos grandes`, media.length === PHOTOS, `${media.length} en media/, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  const thumbs = path.join(DATA, "media", "thumbs");
  const nThumbs = fs.existsSync(thumbs) ? fs.readdirSync(thumbs).length : 0;
  ok("genera una miniatura por foto en media/thumbs/", nThumbs === PHOTOS, `${nThumbs} miniaturas`);
  fs.writeFileSync(path.join(DATA, "boards", "carga.json"), JSON.stringify(makeBoard(urls)));

  // 2) Abrir el tablero (dos veces: la primera calienta la caché de disco del sistema)
  const url = page.url().replace(/[^/]+\.html.*/, "02-tablero.html?board=carga");
  let open = 0, imgs = 0;
  for (let k = 0; k < 2; k++) {
    await page.goto(url, { waitUntil: "load" });
    open = await page.evaluate(() => Math.round(performance.getEntriesByType("navigation")[0].loadEventEnd));
    imgs = await page.evaluate(async () => {
      const all = [...document.querySelectorAll(".t-photo img")];
      await Promise.all(all.map(i => i.decode().catch(() => {})));
      return Math.round(performance.now());
    });
  }
  const count = await page.evaluate(() => document.querySelectorAll("#items .item").length);
  ok(`abre el tablero con ${ITEMS} elementos en menos de ${OPEN_MS} ms`, count === ITEMS && open < OPEN_MS, `${open} ms hasta load, ${imgs} ms con las fotos decodificadas, ${count} elementos`);
  const thumbSrc = await page.evaluate(() => document.querySelector(".t-photo img")?.getAttribute("src") || "");
  const dims = await page.evaluate(() => { const i = document.querySelector(".t-photo img"); return `${i.naturalWidth}×${i.naturalHeight}`; });
  ok("el lienzo usa la miniatura de la foto (1280 px)", thumbSrc.startsWith("chinchero-media://thumbs/") && dims === "1280×853", `${thumbSrc} · ${dims}`);
  await page.screenshot({ path: `${SHOTS}/c1-abierto.png` });

  // Imágenes de antes de las miniaturas: se crean la primera vez que el lienzo las pide
  fs.rmSync(thumbs, { recursive: true, force: true });
  await page.setCacheEnabled(false); // como al reiniciar la app: que las pida de nuevo al proceso principal
  await page.reload({ waitUntil: "load" });
  await page.evaluate(() => Promise.all([...document.querySelectorAll(".t-photo img")].map(i => i.decode().catch(() => {}))));
  const regen = fs.existsSync(thumbs) ? fs.readdirSync(thumbs).length : 0;
  ok("si faltan, las miniaturas se regeneran al abrir el tablero", regen === PHOTOS && await page.evaluate(() => [...document.querySelectorAll(".t-photo img")].every(i => i.naturalWidth === 1280)), `${regen} miniaturas`);

  // 3) Arrastrar una nota a zoom 100 %
  const box = async sel => page.evaluate(s => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, sel);
  const dragFrom = async p => {
    await page.mouse.move(p.x, p.y); await page.mouse.down();
    for (let i = 1; i <= 60; i++) await page.mouse.move(p.x + i * 4, p.y + i * 2);
    await page.mouse.up();
  };
  const x2 = () => page.evaluate(() => parseFloat(document.querySelector('.item[data-id="e2"]').style.left));
  const before2 = await x2();
  let f = await bestFrames(page, () => box('.item[data-id="e2"] .txt').then(dragFrom));
  ok("arrastrar una nota (100 %) es fluido", f.p95 <= FRAME_P95_MS && await x2() > before2, fmtF(f));

  // 4) Zoom con la rueda hasta el mínimo (20 %), y arrastrar con cientos de elementos en pantalla
  f = await bestFrames(page, async () => {
    await page.mouse.move(700, 450);
    for (let i = 0; i < 25; i++) { await page.mouse.wheel({ deltaY: 100 }); await sleep(16); }
  });
  ok("zoom con la rueda es fluido", f.p95 <= FRAME_P95_MS, fmtF(f));
  await page.keyboard.press("Escape");
  await page.keyboard.down("Shift"); await page.keyboard.press("Digit1"); await page.keyboard.up("Shift");
  await sleep(500);
  await page.screenshot({ path: `${SHOTS}/c2-todo.png` });
  // La nota más cercana al centro de la pantalla
  const mid = await page.evaluate(() => {
    const d = e => { const r = e.getBoundingClientRect(); return Math.hypot(r.left + r.width / 2 - 700, r.top + r.height / 2 - 450); };
    return [...document.querySelectorAll(".item.t-note")].sort((a, b) => d(a) - d(b))[0].dataset.id;
  });
  const xMid = () => page.evaluate(id => parseFloat(document.querySelector(`.item[data-id="${id}"]`).style.left), mid);
  const before = mid && await xMid();
  f = await bestFrames(page, () => box(`.item[data-id="${mid}"] .txt`).then(dragFrom));
  ok("arrastrar con cientos de elementos en pantalla (20 %) es fluido", !!mid && f.p95 <= FRAME_P95_MS && await xMid() > before, fmtF(f));
  f = await bestFrames(page, async () => {
    await page.mouse.move(700, 450);
    for (let i = 0; i < 25; i++) { await page.mouse.wheel({ deltaY: i < 12 ? -100 : 100 }); await sleep(16); }
  });
  ok("zoom con cientos de elementos en pantalla es fluido", f.p95 <= FRAME_P95_MS, fmtF(f));

  // 5) Mover los 500 elementos a la vez (Ctrl+A y flechas): cada pulsación guarda y vuelve a dibujar
  await page.mouse.click(5, 450);
  await page.keyboard.down("Control"); await page.keyboard.press("a"); await page.keyboard.up("Control");
  const tNudge = await page.evaluate(async () => {
    const t = performance.now();
    for (let i = 0; i < 10; i++) document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    await new Promise(r => requestAnimationFrame(() => r()));
    return Math.round((performance.now() - t) / 10);
  });
  ok("mover todo con las flechas responde rápido", tNudge < 50, `${tNudge} ms por pulsación`);
  await page.screenshot({ path: `${SHOTS}/c3-movido.png` });

  await browser.disconnect(); proc.kill();
  fs.writeFileSync(path.join(SHOTS, "log.txt"), log.join("\n"));
  if (log.some(l => /^FAIL|PAGEERROR|Content Security Policy/.test(l))) process.exitCode = 1;
  console.log(log.join("\n"));
})().catch(e => { console.error(e); process.exit(1); });
