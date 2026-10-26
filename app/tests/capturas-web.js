const puppeteer = require("puppeteer-core");
const path = require("path");

// Regenera las capturas de la galería de la web (web/assets/screens/*-light|dark.webp) a 1440×900
// con tableros de ejemplo. No es una prueba: correrla cuando cambie la interfaz.
// Uso: node tests/capturas-web.js
const BASE = require("url").pathToFileURL(path.join(__dirname, "..", "src", "renderer")).href + "/";
const OUT = path.join(__dirname, "..", "..", "web", "assets", "screens");
const sleep = ms => new Promise(r => setTimeout(r, ms));
// El último que se crea es el primero en «Recientes»
const BOARDS = [
  ["detective", "Caso abierto", "ideas"], ["kanban", "Roadmap", "trabajo"], ["moodboard", "Moodboard", "ideas"],
  ["viaje", "Viaje a Japón", "personal"], ["demo", "Ideas generales", "personal"],
];

(async () => {
  const browser = await puppeteer.launch({ executablePath: process.env.EDGE_PATH || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
  try {
    for (const theme of ["light", "dark"]) {
      const page = await browser.newPage();
      await page.setViewport({ width: 1440, height: 900 });
      page.on("pageerror", e => console.log(`[${theme}] PAGEERROR: ${e.message}`));
      await page.evaluateOnNewDocument(t => {
        if (sessionStorage.getItem("init")) return;
        sessionStorage.setItem("init", "1");
        localStorage.clear(); localStorage.setItem("chinchero-theme", t);
        localStorage.setItem("chinchero-tours", "off"); localStorage.setItem("chinchero-tips", "off");
      }, theme);
      const ids = {};
      for (const [template, name, group] of BOARDS) {
        await page.goto(BASE + "02-tablero.html?" + new URLSearchParams({ template, name, group }), { waitUntil: "networkidle0" });
        ids[name] = await page.evaluate(n => Store.library().boards.find(b => b.name === n).id, name);
      }
      const shot = async (file, url, prep) => {
        await page.goto(BASE + url, { waitUntil: "networkidle0" }); await sleep(500);
        if (prep) { await prep(); await sleep(400); }
        await page.screenshot({ path: path.join(OUT, `${file}-${theme}.webp`), type: "webp", quality: 82 });
      };
      const ed = name => "02-tablero.html?board=" + ids[name];
      await shot("boards", "01-tableros.html?view=recent");
      await shot("settings", "03-ajustes.html");
      await shot("editor", ed("Ideas generales"));
      await shot("editor-select", ed("Ideas generales"), async () => {
        const b = await (await page.$("#items .t-photo")).boundingBox();
        await page.mouse.click(b.x + b.width / 2, b.y + 20);
      });
      await shot("search", ed("Ideas generales"), async () => {
        await page.keyboard.down("Control"); await page.keyboard.press("k"); await page.keyboard.up("Control");
        await sleep(200); await page.keyboard.type("idea");
      });
      await shot("detective", ed("Caso abierto"));
      await shot("kanban", ed("Roadmap"));
      await page.close();
    }
  } finally {
    await browser.close();
  }
  console.log("Capturas en " + OUT);
})();
