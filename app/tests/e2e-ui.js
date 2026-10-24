const puppeteer = require("puppeteer-core");
const path = require("path");
const fs = require("fs");

// Pruebas de interfaz en Edge (modo navegador: datos en localStorage). Uso: node tests/e2e-ui.js
const BASE = require("url").pathToFileURL(path.join(__dirname, "..", "src", "renderer")).href + "/";
const OUT = path.join(__dirname, "out", "ui");
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const log = [];
const ok = (name, cond, extra = "") => log.push(`${cond ? "PASS" : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({ executablePath: process.env.EDGE_PATH || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });

  async function open(name, { theme = "dark", prefs = {}, vp = { width: 1440, height: 900 } } = {}) {
    const page = await browser.newPage();
    await page.setViewport(vp);
    page.on("console", m => { if (m.type() === "error") log.push(`[${name}] console.error: ${m.text()}`); });
    page.on("pageerror", e => log.push(`[${name}] PAGEERROR: ${e.message}`));
    await page.evaluateOnNewDocument((t, p) => {
      if (sessionStorage.getItem("init")) return;
      sessionStorage.setItem("init", "1");
      localStorage.clear(); localStorage.setItem("chinchero-theme", t);
      for (const [k, v] of Object.entries(p)) localStorage.setItem("chinchero-" + k, v);
    }, theme, prefs);
    await page.goto(BASE + name, { waitUntil: "networkidle0" });
    await sleep(500);
    return page;
  }
  const shot = (p, n) => p.screenshot({ path: `${OUT}/${n}.png` });
  const NO_TOURS = { tours: "off", tips: "off" };

  // 1) Tutoriales: primer paso y layout en cada vista
  for (const [file, n] of [["00-bienvenida.html", "00"], ["01-tableros.html", "01"], ["03-ajustes.html", "03"], ["04-papelera.html", "04"], ["02-tablero.html", "02"]]) {
    const p = await open(file);
    await sleep(900);
    await shot(p, `tour-${n}-a`);
    const has = await p.evaluate(() => !!document.querySelector(".tour-pop"));
    // La papelera solo lanza su tutorial cuando tiene elementos (en una instalación nueva está vacía)
    if (n !== "00" && n !== "04") ok(`tour auto ${n}`, has);
    const sideH = await p.evaluate(() => { const s = document.querySelector(".sidebar"); return s ? s.getBoundingClientRect().height : innerHeight; });
    ok(`layout intacto con tutorial ${n}`, Math.abs(sideH - 900) < 2, `sidebar h=${sideH}`);
    if (has) {
      await p.click(".tour-next"); await sleep(300);
      await shot(p, `tour-${n}-b`);
      await p.click(".tour-next"); await sleep(300);
      await shot(p, `tour-${n}-c`);
    }
    await p.close();
  }

  // 2) Tutorial interactivo del editor
  {
    const p = await open("02-tablero.html?template=blank&name=Prueba", { prefs: { tips: "off" } });
    await sleep(900);
    await p.click(".tour-next"); await sleep(250); // paso 2
    await p.click(".tour-next"); await sleep(250); // paso 3 (crear nota)
    await p.keyboard.press("n"); await p.mouse.click(700, 400); await sleep(600);
    const step = await p.$eval(".tour-step", e => e.textContent);
    ok("tour editor avanza al crear nota", step.includes("4"), step);
    await p.keyboard.type("Mi idea"); await p.mouse.click(1100, 700); await sleep(600);
    ok("tour editor avanza al terminar edición", (await p.$eval(".tour-step", e => e.textContent)).includes("5"));
    await shot(p, "tour-02-move");
    await p.close();
  }

  // 3) Editor: interacciones
  const p = await open("02-tablero.html", { prefs: NO_TOURS });
  const count = () => p.evaluate(() => document.querySelectorAll("#items > .item").length);
  const center = (sel, fx = .5, fy = .5) => p.$eval(sel, (el, fx, fy) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width * fx, y: r.top + r.height * fy }; }, fx, fy);
  await shot(p, "e00-demo");


  // Navegación: arrastrar el fondo mueve, la rueda hace zoom, doble clic en hueco no crea nada
  {
    const before = await p.evaluate(() => document.querySelector("#world").style.transform);
    await p.mouse.move(700, 120); await p.mouse.down(); await p.mouse.move(760, 160, { steps: 5 }); await p.mouse.up(); await sleep(150);
    const after = await p.evaluate(() => document.querySelector("#world").style.transform);
    ok("arrastrar el fondo mueve el lienzo", before !== after && !(await p.evaluate(() => document.querySelector(".item.sel"))), after);
    const z0 = await p.$eval("#zoomLabel", e => e.textContent);
    await p.mouse.move(700, 400); await p.mouse.wheel({ deltaY: -300 }); await sleep(200);
    const z1 = await p.$eval("#zoomLabel", e => e.textContent);
    ok("la rueda hace zoom", parseInt(z1) > parseInt(z0), `${z0}→${z1}`);
    await p.mouse.wheel({ deltaY: 300 }); await sleep(150);
    const n0 = await count();
    await p.mouse.click(700, 120, { clickCount: 2 }); await sleep(200);
    ok("doble clic en hueco no crea nada", (await count()) === n0);
    ok("botón Seleccionar presente y sin Mano", !!(await p.$('[data-tool="select"]')) && !(await p.$('[data-tool="hand"]')));
  }

  // Agrupar: Shift+recuadro sobre notas de abajo, Ctrl+G, clic en una selecciona todo el grupo
  {
    await p.keyboard.press("Escape");
    await p.keyboard.down("Shift"); await p.mouse.move(240, 640); await p.mouse.down(); await p.mouse.move(560, 880, { steps: 6 }); await p.mouse.up(); await p.keyboard.up("Shift"); await sleep(150);
    const nsel = await p.evaluate(() => document.querySelectorAll(".item.sel").length);
    await p.keyboard.down("Control"); await p.keyboard.press("g"); await p.keyboard.up("Control"); await sleep(200);
    ok("Ctrl+G agrupa y muestra recuadro", nsel >= 2 && await p.evaluate(() => getComputedStyle(document.querySelector("#groupBox")).display === "block"), `sel=${nsel}`);
    await p.keyboard.press("Escape"); await sleep(100);
    const star = await p.evaluate(() => { const el = [...document.querySelectorAll(".t-sticker")].find(e => e.textContent.includes("⭐")); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    await p.mouse.click(star.x, star.y); await sleep(150);
    ok("clic en un miembro selecciona el grupo", (await p.evaluate(() => document.querySelectorAll(".item.sel").length)) === nsel);
    await shot(p, "e20-group");
    await p.keyboard.down("Control"); await p.keyboard.down("Shift"); await p.keyboard.press("g"); await p.keyboard.up("Shift"); await p.keyboard.up("Control"); await sleep(150);
    await p.keyboard.press("Escape");
  }
  // Dibujo: dos trazos seguidos = un solo elemento; seleccionado se arrastra desde su recuadro
  {
    const d0 = await p.evaluate(() => document.querySelectorAll(".t-draw").length);
    await p.keyboard.press("d");
    for (const [x0, y0] of [[1150, 120], [1170, 160]]) { await p.mouse.move(x0, y0); await p.mouse.down(); for (let i = 1; i < 12; i++) await p.mouse.move(x0 + i * 5, y0 + Math.sin(i) * 10); await p.mouse.up(); }
    await sleep(150);
    ok("trazos seguidos forman un dibujo", (await p.evaluate(() => document.querySelectorAll(".t-draw").length)) === d0 + 1);
    await p.keyboard.press("v"); await sleep(100);
    ok("V vuelve a seleccionar", await p.evaluate(() => document.querySelector('[data-tool="select"]').classList.contains("active")));
  }
  // Sticker arrastrado desde la paleta (incluido uno propio) se pega como sticker, no como foto
  {
    const n0 = await count();
    await p.evaluate(() => {
      const dt = new DataTransfer();
      dt.setData("application/x-chinchero-sticker", JSON.stringify({ type: "sticker", o: { img: "data:image/gif;base64,R0lGODlhAQABAAAAACw=", emoji: "" } }));
      document.querySelector("#viewport").dispatchEvent(new DragEvent("drop", { dataTransfer: dt, clientX: 700, clientY: 300, bubbles: true }));
    });
    await sleep(200);
    ok("sticker propio arrastrado se crea como sticker", (await count()) === n0 + 1 && await p.evaluate(() => document.querySelector(".item.sel").classList.contains("t-sticker")));
    await p.keyboard.press("Delete");
  }
  ok("tooltip de 'Todas las hojas' alineado a la izquierda", await p.$eval("#allSheets", e => e.dataset.tipPos === "top-start"));
  // B1: doble clic en una nota existente edita (no crea)
  let n0 = await count();
  let c = await center(".t-note .txt", .85, .85);
  await p.mouse.click(c.x, c.y, { clickCount: 2 }); await sleep(200);
  ok("doble clic en nota edita sin crear", (await count()) === n0 && await p.evaluate(() => document.activeElement.isContentEditable));
  await p.keyboard.press("End"); await p.keyboard.type(" ✔"); await shot(p, "e01-edit-note");
  await p.keyboard.press("Escape"); await sleep(200);

  // Texto existente editable
  c = await center(".t-text .txt");
  await p.mouse.click(c.x, c.y, { clickCount: 2 }); await sleep(200);
  ok("texto existente editable", await p.evaluate(() => document.activeElement.closest(".t-text") !== null));
  await p.keyboard.press("Escape"); await sleep(150);

  // Lista: añadir tarea con Enter
  const tasks0 = await p.evaluate(() => document.querySelectorAll(".t-list li").length);
  c = await center(".t-list .task");
  await p.mouse.click(c.x, c.y, { clickCount: 2 }); await sleep(150);
  await p.keyboard.press("End"); await p.keyboard.press("Enter"); await sleep(150);
  await p.keyboard.type("Tarea nueva QA"); await p.keyboard.press("Enter"); await sleep(150);
  await p.keyboard.press("Escape"); await sleep(200);
  const tasks1 = await p.evaluate(() => [...document.querySelectorAll(".t-list .task")].map(t => t.textContent));
  ok("lista: Enter añade tarea y la vacía se descarta", tasks1.length === tasks0 + 1 && tasks1.includes("Tarea nueva QA"), JSON.stringify(tasks1));
  await shot(p, "e02-list");

  // Undo / redo
  await p.keyboard.down("Control"); await p.keyboard.press("z"); await p.keyboard.up("Control"); await sleep(200);
  const tasks2 = await p.evaluate(() => document.querySelectorAll(".t-list .task").length);
  ok("deshacer revierte la tarea", tasks2 === tasks0, `tareas=${tasks2}`);
  await p.keyboard.down("Control"); await p.keyboard.press("y"); await p.keyboard.up("Control"); await sleep(200);
  ok("rehacer la recupera", (await p.evaluate(() => document.querySelectorAll(".t-list .task").length)) === tasks0 + 1);

  // Selección + resize + rotate
  const noteSel = '.t-note';
  c = await center(noteSel, .85, .85);
  await p.mouse.click(c.x, c.y); await sleep(150);
  const w0 = await p.$eval(".item.sel", e => e.offsetWidth);
  const h = await center(".item.sel .h[data-h='se']");
  await p.mouse.move(h.x, h.y); await p.mouse.down(); await p.mouse.move(h.x + 60, h.y + 40, { steps: 6 }); await p.mouse.up(); await sleep(150);
  const w1 = await p.$eval(".item.sel", e => e.offsetWidth);
  ok("redimensionar nota", w1 > w0 + 40, `${w0}→${w1}`);
  const r = await center(".item.sel .rz[data-c='ne']");
  ok("zona de giro con cursor de giro", (await p.$eval(".item.sel .rz[data-c='ne']", e => getComputedStyle(e).cursor)).includes("url"));
  await p.mouse.move(r.x, r.y); await p.mouse.down(); await p.mouse.move(r.x + 10, r.y + 90, { steps: 8 }); await p.mouse.up(); await sleep(150);
  const rot = await p.$eval(".item.sel", e => e.style.getPropertyValue("--rot"));
  ok("girar con el asa", parseFloat(rot) > 10, rot);
  await shot(p, "e03-resize-rotate");

  // Hilo arrastrando chinche → chinche (n2 -> n3: notas azul y rosa)
  const threads0 = await p.evaluate(() => document.querySelectorAll("#threads .th").length);
  const notes = await p.$$eval(".t-note > .pin", els => els.map(e => { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }));
  await p.mouse.move(notes[1].x, notes[1].y); await p.mouse.down(); await p.mouse.move(notes[2].x, notes[2].y, { steps: 10 });
  await shot(p, "e04-thread-drag");
  await p.mouse.up(); await sleep(200);
  ok("hilo por arrastre", (await p.evaluate(() => document.querySelectorAll("#threads .th").length)) === threads0 + 1);
  // Duplicado
  await p.mouse.move(notes[1].x, notes[1].y); await p.mouse.down(); await p.mouse.move(notes[2].x, notes[2].y, { steps: 10 }); await p.mouse.up(); await sleep(200);
  ok("no permite hilos duplicados", (await p.evaluate(() => document.querySelectorAll("#threads .th").length)) === threads0 + 1);

  // Seleccionar hilo y ponerle etiqueta
  const tl = await p.evaluate(() => { const g = document.querySelectorAll("#threads .th .hit")[0]; const l = g.getTotalLength(); const pt = g.getPointAtLength(l / 2); const m = g.getScreenCTM(); return { x: pt.x * m.a + m.e, y: pt.y * m.d + m.f }; });
  await p.mouse.click(tl.x, tl.y); await sleep(200);
  ok("seleccionar hilo muestra su barra", await p.evaluate(() => document.querySelector(".ctx.open")?.textContent.includes("Hilo")));
  await shot(p, "e05-thread-selected");
  await p.keyboard.press("Escape");

  // Recuadro de selección
  await p.keyboard.down("Shift"); await p.mouse.move(150, 560); await p.mouse.down(); await p.mouse.move(1100, 880, { steps: 8 }); await p.mouse.up(); await p.keyboard.up("Shift"); await sleep(200);
  const nsel = await p.evaluate(() => document.querySelectorAll(".item.sel").length);
  ok("recuadro selecciona varios", nsel >= 3, `sel=${nsel}`);
  await shot(p, "e06-band");
  await p.keyboard.press("Escape");

  // Mover zona arrastra su contenido
  const zoneTitle = await center(".t-zone .zt");
  const n1Before = await p.evaluate(() => { const el = [...document.querySelectorAll(".t-note")][0]; return el.offsetLeft; });
  await p.mouse.move(zoneTitle.x, zoneTitle.y); await p.mouse.down(); await p.mouse.move(zoneTitle.x + 50, zoneTitle.y + 10, { steps: 6 }); await p.mouse.up(); await sleep(200);
  const n1After = await p.evaluate(() => { const el = [...document.querySelectorAll(".t-note")][0]; return el.offsetLeft; });
  ok("mover zona mueve su contenido", n1After - n1Before === 50, `${n1Before}→${n1After}`);

  // Bloquear y no poder borrar
  await p.keyboard.down("Control"); await p.keyboard.down("Shift"); await p.keyboard.press("l"); await p.keyboard.up("Shift"); await p.keyboard.up("Control"); await sleep(150);
  n0 = await count();
  await p.keyboard.press("Delete"); await sleep(150);
  ok("bloqueado no se borra", (await count()) === n0);
  await p.keyboard.down("Control"); await p.keyboard.press("z"); await p.keyboard.up("Control"); await sleep(150);

  // Duplicar y eliminar con deshacer
  c = await center(".t-card");
  await p.mouse.click(c.x, c.y); await sleep(100);
  n0 = await count();
  await p.keyboard.down("Control"); await p.keyboard.press("d"); await p.keyboard.up("Control"); await sleep(150);
  ok("Ctrl+D duplica", (await count()) === n0 + 1);
  await p.keyboard.press("Delete"); await sleep(200);
  ok("Supr elimina y ofrece deshacer", (await count()) === n0 && await p.evaluate(() => document.querySelector(".toast")?.textContent.includes("Deshacer")));
  await shot(p, "e07-delete-toast");

  // Creación en el punto del clic: lista y sticker
  await p.keyboard.press("c"); await p.mouse.click(1250, 700); await sleep(200);
  const listPos = await p.evaluate(() => { const el = document.querySelector(".item.sel"); const r = el.getBoundingClientRect(); return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, t: el.className }; });
  ok("lista se crea donde haces clic", listPos.t.includes("t-list") && Math.abs(listPos.cx - 1250) < 40, JSON.stringify(listPos));
  await p.keyboard.type("Comprar chinches"); await p.keyboard.press("Escape"); await sleep(150);
  ok("crear con clic deja escribir", await p.evaluate(() => [...document.querySelectorAll(".t-list .task")].some(t => t.textContent === "Comprar chinches")));
  await p.keyboard.press("Escape");
  await p.keyboard.press("s"); await sleep(150);
  await shot(p, "e08-stickers");
  await p.click('#stickerPop [data-st="emoji"]:nth-child(3)'); await p.mouse.move(300, 780); await sleep(100);
  await p.mouse.click(300, 780); await sleep(200);
  const st = await p.evaluate(() => { const el = document.querySelector(".item.sel"); const r = el.getBoundingClientRect(); return { cx: r.left + r.width / 2, t: el.className }; });
  ok("sticker se pega donde haces clic", st.t.includes("t-sticker") && Math.abs(st.cx - 300) < 40, JSON.stringify(st));

  // Zona con la herramienta
  await p.keyboard.press("Escape"); await p.keyboard.press("Escape");
  // Dibujo
  await p.keyboard.press("d"); await sleep(100);
  await p.mouse.move(1180, 520); await p.mouse.down();
  for (let i = 0; i < 20; i++) await p.mouse.move(1180 + i * 6, 520 + Math.sin(i / 3) * 30);
  await p.mouse.up(); await sleep(200);
  ok("dibujo crea un elemento", await p.evaluate(() => !!document.querySelector(".t-draw:last-child path")));
  await p.keyboard.press("Escape");

  // Ctrl+K buscar
  await p.keyboard.down("Control"); await p.keyboard.press("k"); await p.keyboard.up("Control"); await sleep(150);
  await p.keyboard.type("presupuesto"); await sleep(150);
  await shot(p, "e09-cmdk");
  await p.keyboard.press("Enter"); await sleep(400);
  ok("Ctrl+K encuentra y salta a otra hoja", await p.evaluate(() => document.querySelector(".sheet.active .name").textContent === "Referencias" && document.querySelector(".item.sel .fn")?.textContent === "presupuesto.xlsx"));
  await shot(p, "e10-referencias");

  // Visor de fotos
  c = await center(".t-photo .img");
  await p.mouse.click(c.x, c.y, { clickCount: 2 }); await sleep(250);
  ok("doble clic en foto abre visor", await p.evaluate(() => document.querySelector("#lightbox").classList.contains("open")));
  await shot(p, "e11-lightbox");
  await p.keyboard.press("Escape");

  // Hoja vacía con sugerencias
  await p.click(".sheet:nth-child(4)"); await sleep(250);
  await shot(p, "e12-empty-sheet");
  await p.click('[data-start="kanban"]'); await sleep(400);
  ok("sugerencia Kanban rellena la hoja", (await count()) >= 8);
  await shot(p, "e13-kanban");

  // Copiar / pegar entre hojas
  await p.click(".sheet:nth-child(1)"); await sleep(250);
  c = await center(".t-card"); await p.mouse.click(c.x, c.y);
  await p.keyboard.down("Control"); await p.keyboard.press("c"); await p.keyboard.up("Control");
  await p.click(".sheet:nth-child(2)"); await sleep(250);
  n0 = await count();
  await p.mouse.move(700, 500);
  await p.keyboard.down("Control"); await p.keyboard.press("v"); await p.keyboard.up("Control"); await sleep(250);
  ok("copiar/pegar entre hojas", (await count()) === n0 + 1, `${n0}→${await count()}`);

  // Menú contextual en elemento y en lienzo
  await p.click(".sheet:nth-child(1)"); await sleep(250);
  c = await center(".t-photo");
  await p.mouse.click(c.x, c.y, { button: "right" }); await sleep(150);
  await shot(p, "e14-ctx-menu");
  await p.keyboard.press("Escape");

  // Barra contextual cerca del borde derecho no se sale
  c = await center(".t-stamp");
  await p.mouse.click(c.x, c.y); await sleep(150);
  const ctxR = await p.$eval("#ctx", e => e.getBoundingClientRect().right);
  ok("barra contextual dentro de la pantalla", ctxR <= 1440, `right=${ctxR}`);

  // Corcho en oscuro: legibilidad del texto
  await p.click('#surfaces [data-s="cork"]'); await sleep(200);
  await p.keyboard.press("Escape");
  await shot(p, "e15-cork-dark");
  await p.close();

  // 4) Claro + tableros + ajustes
  for (const [f, n] of [["01-tableros.html", "v01"], ["03-ajustes.html", "v03"], ["04-papelera.html", "v04"], ["02-tablero.html", "v02"], ["00-bienvenida.html", "v00"]]) {
    const q = await open(f, { theme: "light", prefs: NO_TOURS });
    await shot(q, `${n}-light`);
    await q.close();
  }
  {
    const q = await open("01-tableros.html?view=recent", { prefs: { tours: "off" } });
    await sleep(1600);
    await shot(q, "v01-recent-tip");
    await q.click("#newBtn"); await sleep(200);
    ok("modal: nombre enfocado", await q.evaluate(() => document.activeElement.id === "boardName"));
    await shot(q, "v01-modal");
    await q.close();
  }

  await browser.close();
  fs.writeFileSync(path.join(OUT, "log.txt"), log.join("\n"));
  if (log.some(l => /^FAIL|PAGEERROR/.test(l))) process.exitCode = 1;
  console.log(log.join("\n"));
})();
