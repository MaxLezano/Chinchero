const puppeteer = require("puppeteer-core");
const path = require("path");
const fs = require("fs");

// Recorrido de QA: captura cada pantalla, modal y menú en tema claro y oscuro a varios tamaños de ventana,
// y lista textos desbordados, scroll horizontal y errores de consola. No es una prueba: deja un informe en tests/out/qa/.
// Uso: node tests/qa-capturas.js
const BASE = require("url").pathToFileURL(path.join(__dirname, "..", "src", "renderer")).href + "/";
const OUT = path.join(__dirname, "out", "qa");
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const log = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const SIZES = [[1000, 640], [1440, 900], [1920, 1080]];
const NO_TOURS = { tours: "off", tips: "off" };

// Textos que se salen de su caja (sin recorte con «…») o elementos fuera de la ventana
function audit() {
  const out = [];
  const name = el => el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + (el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/).join(".") : "");
  if (document.documentElement.scrollWidth > innerWidth + 1) out.push(`scroll horizontal: ${document.documentElement.scrollWidth} > ${innerWidth}`);
  for (const el of document.querySelectorAll("body *")) {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || el.closest("svg, #items, .lightbox:not(.open), [hidden]")) continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    const text = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
    if (text && el.scrollWidth > el.clientWidth + 1 && cs.overflowX === "visible" && cs.textOverflow !== "ellipsis")
      out.push(`texto desbordado: ${name(el)} «${el.textContent.trim().slice(0, 40)}» (${el.scrollWidth} > ${el.clientWidth})`);
    if (text && (r.right > innerWidth + 1 || r.left < -1) && !el.closest(".viewport, .canvas, .board-scroll"))
      out.push(`fuera de la ventana: ${name(el)} «${el.textContent.trim().slice(0, 40)}»`);
  }
  return [...new Set(out)];
}

(async () => {
  const browser = await puppeteer.launch({ executablePath: process.env.EDGE_PATH || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
  try {
    for (const theme of ["light", "dark"]) for (const [w, h] of SIZES) {
      const tag = `${theme}-${w}`;
      const page = await browser.newPage();
      await page.setViewport({ width: w, height: h });
      page.on("console", m => { if (m.type() === "error") log.push(`[${tag}] console.error: ${m.text()}`); });
      page.on("pageerror", e => log.push(`[${tag}] PAGEERROR: ${e.message}`));
      await page.evaluateOnNewDocument((t, p) => {
        if (sessionStorage.getItem("init")) return;
        sessionStorage.setItem("init", "1");
        localStorage.clear(); localStorage.setItem("chinchero-theme", t);
        for (const [k, v] of Object.entries(p)) localStorage.setItem("chinchero-" + k, v);
      }, theme, NO_TOURS);
      const go = async (file, n, prep) => {
        await page.goto(BASE + file, { waitUntil: "networkidle0" }); await sleep(400);
        if (prep) { await prep(); await sleep(350); }
        await page.screenshot({ path: `${OUT}/${n}-${tag}.png` });
        for (const a of await page.evaluate(audit)) log.push(`[${n}-${tag}] ${a}`);
      };
      const key = async (k, mod) => { if (mod) await page.keyboard.down(mod); await page.keyboard.press(k); if (mod) await page.keyboard.up(mod); };

      await go("00-bienvenida.html", "00-bienvenida");
      // Datos de ejemplo: tres tableros, uno con nombre largo
      for (const q of ["template=detective&name=Caso del collar perdido de la tía Marta en la casa de campo", "template=semana&name=Semana", "template=demo&name=Ideas generales"])
        await page.goto(BASE + "02-tablero.html?" + q, { waitUntil: "networkidle0" });
      const ed = "02-tablero.html?board=" + await page.evaluate(() => Store.library().boards.find(b => b.name === "Ideas generales").id);
      await go("01-tableros.html?view=recent", "01-tableros");
      await go("01-tableros.html?view=recent", "01-nuevo", () => page.click("#newBtn"));
      await go("01-tableros.html?view=recent", "01-menu", async () => { const c = await page.$("#grid .card"); const b = await c.boundingBox(); await page.mouse.click(b.x + 40, b.y + 40, { button: "right" }); });
      await go("03-ajustes.html", "03-ajustes");
      await go("03-ajustes.html", "03-ajustes-fin", () => page.evaluate(() => { const m = document.querySelector("main, .main, .content") || document.scrollingElement; m.scrollTop = 1e6; }));
      await go("04-papelera.html", "04-papelera");
      // Banner de actualización lista (en el navegador no hay updater: se arma con el mismo HTML de store.js)
      await go("01-tableros.html?view=recent", "01-actualizacion", () => page.evaluate(() => {
        const b = document.createElement("div");
        b.className = "update-banner";
        b.innerHTML = `<span>La versión <b>0.4.0</b> está lista. Se instalará al cerrar Chinchero.</span><button class="btn btn-primary">Reiniciar ahora</button><button class="icon-btn" aria-label="Cerrar">✕</button>`;
        document.body.appendChild(b);
      }));
      await go(ed, "02-editor");
      await go(ed, "02-cmdk", () => key("k", "Control"));
      await go(ed, "02-atajos", () => key("?"));
      await go(ed, "02-menu", async () => { await page.mouse.click(w / 2, h / 2, { button: "right" }); });
      await go(ed, "02-seleccion", async () => { const it = await page.$("#items .t-photo"); const b = await it.boundingBox(); await page.mouse.click(b.x + b.width / 2, b.y + 20); });
      // Foto con nombre largo, como al soltar «Gemini_Generated_Image_usc7f….png»
      await go(ed, "02-foto-larga", () => page.evaluate(() => {
        const c = document.querySelector("#items .t-photo .caption");
        c.textContent = "Gemini_Generated_Image_usc7fusc7fusc7f";
      }));
      await go(ed, "02-asistente", () => page.click("#aiBtn"));
      // Conversación armada con las mismas clases de asistente.js (en el navegador no hay IA)
      await go(ed, "02-asistente-chat", async () => {
        await page.click("#aiBtn");
        await page.evaluate(() => {
          const log = document.getElementById("aiLog"), add = (c, h) => log.insertAdjacentHTML("beforeend", `<div class="ai-msg ${c}">${h}</div>`);
          log.innerHTML = "";
          add("user", "Dame ideas para el viaje a Japón con presupuesto ajustado");
          add("assistant", 'Te propongo cuatro ideas y las uní con hilos a «Viaje».<span class="ai-did">4 cambios en la hoja <button data-undo>Deshacer</button></span>');
          add("user", "Ordénalo por tema");
          add("error", 'Se agotó el cupo gratis por ahora. Prueba de nuevo en un rato. <button class="ai-link" data-go="ajustes">Abrir Ajustes</button>');
          add("wait", "Pensando");
        });
      });
      await page.close();
    }
    // Web del producto: página entera en escritorio y móvil (sin animaciones de entrada)
    const WEB = require("url").pathToFileURL(path.join(__dirname, "..", "..", "web", "index.html")).href;
    for (const theme of ["light", "dark"]) for (const [w, h, mobile] of [[1440, 900], [390, 844, true]]) {
      const tag = `web-${theme}-${w}`;
      const page = await browser.newPage();
      await page.setViewport({ width: w, height: h, isMobile: !!mobile, hasTouch: !!mobile });
      await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }, { name: "prefers-color-scheme", value: theme }]);
      page.on("console", m => { if (m.type() === "error") log.push(`[${tag}] console.error: ${m.text()}`); });
      page.on("pageerror", e => log.push(`[${tag}] PAGEERROR: ${e.message}`));
      page.on("requestfailed", r => log.push(`[${tag}] no carga: ${r.url()}`));
      await page.goto(WEB, { waitUntil: "networkidle0" }); await sleep(800);
      await page.screenshot({ path: `${OUT}/${tag}.png`, fullPage: true });
      for (const a of await page.evaluate(audit)) log.push(`[${tag}] ${a}`);
      await page.close();
    }
  } finally {
    await browser.close();
  }
  fs.writeFileSync(path.join(OUT, "informe.txt"), log.join("\n"));
  console.log(log.join("\n") || "Sin avisos");
})();
