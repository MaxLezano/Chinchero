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
  const browser = await puppeteer.launch({ executablePath: process.env.EDGE_PATH || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true,
    // Los textos de la interfaz (assets/locales/*.json) se leen con XHR, que file:// bloquea sin esto
    args: ["--allow-file-access-from-files"] });
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
      // En un navegador no hay asistente: solo asistente.js ve una API «ai» falsa con Ollama y una respuesta fija.
      // store.js sigue sin ver window.chinchero, así que los datos van a localStorage como siempre.
      await page.evaluateOnNewDocument(() => {
        const ai = {
          status: () => ({ enabled: true, provider: "ollama", model: "", hasKey: false }),
          models: async () => ({ models: ["qwen3:4b", "llama3.2"] }),
          config: async c => ({ ...ai.status(), ...c }),
          chat: async () => ({
            model: "qwen3:4b",
            text: "Sumé tres ideas para Kioto unidas con hilos, una lista para el templo y un dibujo del monte Fuji.",
            actions: [
              { op: "crear", tipo: "nota", ref: "a", texto: "Bosque de bambú de Arashiyama al amanecer", color: "verde" },
              { op: "crear", tipo: "nota", ref: "b", texto: "Ceremonia del té en Gion", color: "rosa", cerca: "a" },
              { op: "crear", tipo: "nota", ref: "c", texto: "Fushimi Inari: subir hasta la cima", color: "naranja", cerca: "a" },
              { op: "crear", tipo: "lista", ref: "d", titulo: "Para el templo", tareas: ["Calcetines limpios", "Monedas de 5 yenes", "Libreta goshuin"], cerca: "c" },
              { op: "dibujar", cerca: "b", color: "azul", trazos: ["M20 300 L150 110 Q200 80 250 110 L380 300", "M150 110 Q170 150 190 130 Q210 160 230 130 Q245 150 250 110", "M300 40 A28 28 0 1 1 299 40", "M10 300 L390 300"] },
              { op: "unir", a: "a", b: "b" }, { op: "unir", a: "a", b: "c", etiqueta: "día 3" },
            ],
          }),
        };
        Object.defineProperty(window, "chinchero", { configurable: true, get: () => /\/assets\/asistente\.js$/.test(document.currentScript?.src || "") ? { ai } : undefined });
      });
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
      // Al terminar, el asistente deja seleccionado lo que creó; se suelta con un clic en el corcho vacío
      await shot("assistant", ed("Viaje a Japón"), async () => {
        await page.click("#aiBtn"); await sleep(300);
        await page.type("#aiInput", "Dame ideas para Kioto y dibuja el monte Fuji");
        await page.keyboard.press("Enter"); await sleep(600);
        await page.mouse.click(560, 800);
      });
      await page.close();
    }
  } finally {
    await browser.close();
  }
  console.log("Capturas en " + OUT);
})();
