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
    await p.keyboard.down("Control"); await p.keyboard.press("u"); await p.keyboard.up("Control"); await sleep(150);
    ok("Ctrl+U desagrupa", await p.evaluate(() => getComputedStyle(document.querySelector("#groupBox")).display !== "block"));
    await p.keyboard.press("Escape");
  }
  // Ctrl+V pega la imagen como polaroid; Ctrl+Shift+V, sin marco
  {
    const pasteImg = async shift => {
      await p.mouse.move(700, 300);
      await p.evaluate(shift => {
        document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "V", ctrlKey: true, shiftKey: shift, bubbles: true }));
        const dt = new DataTransfer();
        dt.items.add(new File([Uint8Array.from(atob("R0lGODlhAQABAAAAACw="), c => c.charCodeAt(0))], "pixel.gif", { type: "image/gif" }));
        document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true }));
      }, shift);
      await sleep(200);
      const bare = await p.evaluate(() => { const el = document.querySelector(".item.sel.t-photo"); return el ? el.classList.contains("noframe") : null; });
      await p.keyboard.press("Delete");
      return bare;
    };
    ok("Ctrl+V pega imagen como polaroid", (await pasteImg(false)) === false);
    ok("Ctrl+Shift+V pega imagen sin marco", (await pasteImg(true)) === true);
  }
  // Dibujo: dos trazos seguidos = un solo elemento; seleccionado se arrastra desde su recuadro
  {
    const d0 = await p.evaluate(() => document.querySelectorAll(".t-draw").length);
    await p.keyboard.press("d");
    for (const [x0, y0] of [[1150, 120], [1170, 160]]) { await p.mouse.move(x0, y0); await p.mouse.down(); for (let i = 1; i < 12; i++) await p.mouse.move(x0 + i * 5, y0 + Math.sin(i) * 10); await p.mouse.up(); }
    await sleep(150);
    ok("trazos seguidos forman un dibujo", (await p.evaluate(() => document.querySelectorAll(".t-draw").length)) === d0 + 1);
    // Goma: E la activa; «partes» corta los trazos por donde pasa, «trazos enteros» los quita y Ctrl+Z lo devuelve
    const strokes = () => p.evaluate(() => { const e = [...document.querySelectorAll(".t-draw")].at(-1); return (e?.querySelector("path:not(.dh)").getAttribute("d").match(/M/g) || []).length; });
    const rub = async pts => { await p.mouse.move(...pts[0]); await p.mouse.down(); for (const q of pts.slice(1)) await p.mouse.move(...q, { steps: 4 }); await p.mouse.up(); await sleep(150); };
    const s0 = await strokes();
    await p.keyboard.press("e"); await sleep(100);
    ok("E activa la goma", await p.evaluate(() => document.querySelector('#drawPop [data-de="part"]').classList.contains("on") && document.querySelector("#viewport").classList.contains("erasing")));
    await rub([[1185, 90], [1185, 190]]);
    const s1 = await strokes();
    ok("goma: borrar partes corta los trazos", s0 === 2 && s1 === 4, `${s0} → ${s1}`);
    await p.click('#drawPop [data-de="stroke"]'); await sleep(50);
    await rub([[1158, 90], [1158, 140]]);
    ok("goma: trazos enteros quita solo el trazo tocado", (await strokes()) === s1 - 1);
    const pass = []; for (let y = 100; y <= 180; y += 8) pass.push([1140, y], [1240, y]);
    await rub(pass);
    ok("goma: sin trazos el dibujo desaparece", (await p.evaluate(() => document.querySelectorAll(".t-draw").length)) === d0);
    await p.keyboard.down("Control"); await p.keyboard.press("z"); await p.keyboard.up("Control"); await sleep(150);
    ok("goma: Ctrl+Z devuelve el dibujo", (await p.evaluate(() => document.querySelectorAll(".t-draw").length)) === d0 + 1);
    await p.keyboard.press("e"); await sleep(50);
    ok("E de nuevo vuelve al rotulador", await p.evaluate(() => !document.querySelector("#drawPop [data-de].on") && !document.querySelector("#viewport").classList.contains("erasing")));
    await p.keyboard.press("v"); await sleep(100);
    ok("V vuelve a seleccionar", await p.evaluate(() => document.querySelector('[data-tool="select"]').classList.contains("active")));
  }
  // Nombre largo de una foto: se recorta con «…» dentro del marco polaroid
  ok("foto: el nombre largo no sale del marco", await p.evaluate(() => {
    const c = document.querySelector("#items .t-photo:not(.noframe) .caption");
    c.textContent = "Gemini_Generated_Image_usc7fusc7fusc7fusc7f";
    const r = c.getBoundingClientRect(), f = c.closest(".item").getBoundingClientRect(), ok = getComputedStyle(c).textOverflow === "ellipsis" && r.right <= f.right + 1;
    c.textContent = "Inspiración"; return ok;
  }));
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
  await p.keyboard.down("Control"); await p.keyboard.press("k"); await p.keyboard.up("Control"); await sleep(150);
  await p.keyboard.type("plantilla semana"); await sleep(150);
  await p.keyboard.press("Enter"); await sleep(500);
  ok("Ctrl+K crea hoja con plantilla Semana", await p.evaluate(() => document.querySelector(".sheet.active .name").textContent === "Semana" && document.querySelectorAll(".t-zone").length === 8));
  await shot(p, "e13b-semana");

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

  // Sonidos: apagados por defecto, se encienden en Ajustes; suenan al tachar y no al deshacer en ráfaga
  {
    const q = await open("03-ajustes.html", { prefs: NO_TOURS });
    const st0 = await q.evaluate(() => ({ on: document.getElementById("sounds").checked, vol: document.getElementById("soundVol").disabled }));
    ok("sonidos: apagados por defecto y volumen deshabilitado", !st0.on && st0.vol, JSON.stringify(st0));
    await q.click('label.switch:has(#sounds) span'); await sleep(150);
    const st1 = await q.evaluate(() => ({ pref: localStorage.getItem("chinchero-sounds"), vol: document.getElementById("soundVol").disabled }));
    ok("sonidos: el interruptor guarda y habilita el volumen", st1.pref === "1" && !st1.vol, JSON.stringify(st1));
    await shot(q, "e03-sonidos");
    await q.close();
  }
  for (const on of [true, false]) {
    const q = await open("02-tablero.html", { prefs: { ...NO_TOURS, sounds: on ? "1" : "0" } });
    // Cuenta los sonidos que llegan a los altavoces
    await q.evaluate(() => {
      window.__sonidos = 0;
      const orig = AudioNode.prototype.connect;
      AudioNode.prototype.connect = function (dest, ...r) { if (dest instanceof AudioDestinationNode) window.__sonidos++; return orig.call(this, dest, ...r); };
    });
    const cb = await q.$('.t-list li:not(.done) input[type="checkbox"]');
    await cb.click(); await sleep(150);
    const n1 = await q.evaluate(() => window.__sonidos);
    if (!on) { ok("sonidos apagados: tachar no suena", n1 === 0, `sonidos=${n1}`); await q.close(); continue; }
    ok("sonidos: tachar una tarea suena", n1 === 1, `sonidos=${n1}`);
    for (let i = 0; i < 6; i++) { await q.keyboard.down("Control"); await q.keyboard.press("z"); await q.keyboard.up("Control"); }
    for (let i = 0; i < 6; i++) { await q.keyboard.down("Control"); await q.keyboard.press("y"); await q.keyboard.up("Control"); }
    await sleep(150);
    const n2 = await q.evaluate(() => { for (let i = 0; i < 10; i++) Sound.play("pin"); return window.__sonidos; });
    ok("sonidos: deshacer/rehacer no suena y una ráfaga suena una vez", n2 === n1 + 1, `sonidos=${n2}`);
    await q.close();
  }

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
    await q.click("#cancelModal"); await sleep(150);
    ok("modal: Cancelar lo cierra (sin onclick en el HTML)", await q.evaluate(() => !document.querySelector("#modal.open")));
    await q.close();
  }

  // Accesibilidad: anuncios con aria-live, teclado en el lienzo, menús y diálogos, contraste de los tokens
  {
    const q = await open("02-tablero.html?template=blank&name=A11y", { prefs: NO_TOURS });
    const live = () => q.evaluate(() => document.getElementById("srLive")?.textContent || "");
    ok("a11y: región aria-live presente", await q.evaluate(() => document.getElementById("srLive")?.getAttribute("aria-live") === "polite"));
    // Enter sobre una herramienta crea en el centro de la vista
    await q.focus('[data-tool="note"]'); await q.keyboard.press("Enter"); await sleep(250);
    ok("a11y: Enter en «Nota» crea una nota y se anuncia", await q.evaluate(() => document.querySelectorAll("#items .t-note").length === 1) && (await live()) === "Añadido al lienzo: Nota", await live());
    await q.keyboard.type("Primera"); await q.keyboard.press("Escape"); await sleep(100);
    await q.focus('[data-tool="note"]'); await q.keyboard.press(" "); await sleep(250);
    await q.keyboard.type("Segunda"); await q.keyboard.press("Escape"); await sleep(100);
    ok("a11y: Espacio en un botón lo activa (no mueve el lienzo)", await q.evaluate(() => document.querySelectorAll("#items .t-note").length === 2 && !document.querySelector("#viewport.space")));
    // Tab recorre los elementos y, pasado el último, sale del lienzo
    await q.evaluate(() => { document.querySelector("#canvasFocus").focus(); });
    await q.keyboard.press("Escape");
    await q.keyboard.press("Tab"); await sleep(150);
    ok("a11y: Tab selecciona y anuncia el elemento", /^Nota «(Primera|Segunda)», 1 de 2$/.test(await live()), await live());
    const x0 = await q.evaluate(() => parseFloat(document.querySelector("#items .item.sel").style.left));
    await q.keyboard.press("ArrowRight"); await q.keyboard.press("ArrowRight"); await sleep(700);
    ok("a11y: flechas mueven y se anuncia al terminar", await q.evaluate(() => parseFloat(document.querySelector("#items .item.sel").style.left)) === x0 + 2 && (await live()) === "Elemento movido", await live());
    // Menú contextual con Mayús+F10: foco en la primera opción, flechas, Esc devuelve el foco al lienzo
    await q.keyboard.down("Shift"); await q.keyboard.press("F10"); await q.keyboard.up("Shift"); await sleep(150);
    ok("a11y: Mayús+F10 abre el menú con el foco dentro", await q.evaluate(() => document.activeElement.getAttribute("role") === "menuitem"));
    const first = await q.evaluate(() => document.activeElement.textContent);
    await q.keyboard.press("ArrowDown");
    ok("a11y: flechas recorren el menú", await q.evaluate(f => document.activeElement.getAttribute("role") === "menuitem" && document.activeElement.textContent !== f, first));
    await q.keyboard.press("Escape"); await sleep(100);
    ok("a11y: Esc cierra el menú y devuelve el foco", await q.evaluate(() => !document.querySelector(".menu") && document.activeElement.id === "canvasFocus" && !!document.querySelector("#items .item.sel")));
    await q.keyboard.press("Tab"); await q.keyboard.press("Tab"); await sleep(100);
    ok("a11y: pasado el último elemento, Tab sale del lienzo", await q.evaluate(() => document.activeElement.id !== "canvasFocus" && !document.querySelector("#items .item.sel")));
    await q.focus("#canvasFocus"); await q.keyboard.press("Tab"); await q.keyboard.press("Delete"); await sleep(150);
    ok("a11y: eliminar se anuncia", (await live()) === "Elemento eliminado", await live());
    await q.keyboard.down("Control"); await q.keyboard.press("z"); await q.keyboard.up("Control"); await sleep(150);
    ok("a11y: deshacer se anuncia", (await live()) === "Deshecho", await live());
    // Pestañas de hojas con flechas
    await q.click("#addSheet"); await sleep(200);
    await q.keyboard.press("Enter"); await q.keyboard.press("ArrowLeft"); await sleep(150); // Enter termina de renombrar
    ok("a11y: flechas cambian de hoja y se anuncia", await q.evaluate(() => document.activeElement.matches("#sheets .sheet.active[data-i='0']")) && /^Hoja «.+», 2 elementos$/.test(await live()), await live());
    // Ctrl+K: Tab no se escapa del diálogo y al cerrar vuelve el foco
    await q.focus("#canvasFocus");
    await q.keyboard.down("Control"); await q.keyboard.press("k"); await q.keyboard.up("Control"); await sleep(150);
    await q.keyboard.press("Tab"); await q.keyboard.press("Tab");
    ok("a11y: Ctrl+K retiene el foco", await q.evaluate(() => document.getElementById("cmdk").contains(document.activeElement)));
    await q.keyboard.press("Escape"); await sleep(100);
    ok("a11y: al cerrar Ctrl+K vuelve el foco al lienzo", await q.evaluate(() => document.activeElement.id === "canvasFocus"));
    await q.close();
  }
  {
    const q = await open("01-tableros.html", { prefs: NO_TOURS });
    await q.focus("#newBtn"); await q.keyboard.press("Enter"); await sleep(200);
    for (let i = 0; i < 3; i++) await q.keyboard.down("Shift"), await q.keyboard.press("Tab"), await q.keyboard.up("Shift");
    ok("a11y: el modal de nuevo tablero retiene el foco", await q.evaluate(() => document.getElementById("newForm").contains(document.activeElement)));
    ok("a11y: plantilla elegida marcada con aria-pressed", await q.evaluate(() => document.querySelector("#templates .selected").getAttribute("aria-pressed") === "true"));
    await q.keyboard.press("Escape"); await sleep(100);
    ok("a11y: al cerrar el modal vuelve el foco al botón", await q.evaluate(() => document.activeElement.id === "newBtn"));
    // Contraste WCAG AA (4,5:1) de los tokens de texto en ambos temas
    const ratios = await q.evaluate(() => {
      const lum = c => { const [r, g, b] = c.match(/\d+/g).map(v => +v / 255).map(v => v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4); return .2126 * r + .7152 * g + .0722 * b; };
      const rgb = v => { const d = document.createElement("div"); d.style.color = v; document.body.append(d); const c = getComputedStyle(d).color; d.remove(); return c; };
      const ratio = (a, b) => { const x = lum(rgb(a)), y = lum(rgb(b)); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
      const out = {};
      for (const t of ["light", "dark"]) {
        document.documentElement.dataset.theme = t;
        const v = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
        out[t] = Math.min(...[["--text-muted", "--bg"], ["--text-muted", "--surface"], ["--text-muted", "--surface-2"], ["--on-accent", "--accent"], ["--accent", "--surface"], ["--danger", "--surface"], ["--accent-inv", "--text"]]
          .map(([a, b]) => ratio(v(a), v(b))));
      }
      return out;
    });
    ok("a11y: contraste AA en tema claro y oscuro", ratios.light >= 4.5 && ratios.dark >= 4.5, JSON.stringify(ratios));
    await q.close();
  }

  // Atajos personalizados: el editor usa los de la preferencia y Ajustes los cambia con detección de conflictos
  {
    const q = await open("02-tablero.html", { prefs: { ...NO_TOURS, keys: JSON.stringify({ "tool.note": "Shift+N", duplicate: "" }) } });
    const active = () => q.evaluate(() => document.querySelector("[data-tool].active")?.dataset.tool);
    await q.keyboard.press("n"); await sleep(50);
    ok("atajos: la tecla original ya no actúa", (await active()) === "select");
    await q.keyboard.down("Shift"); await q.keyboard.press("N"); await q.keyboard.up("Shift"); await sleep(50);
    ok("atajos: la combinación nueva elige la herramienta", (await active()) === "note");
    ok("atajos: la pista de la barra muestra el atajo nuevo", await q.$eval('[data-tool="note"]', e => e.dataset.tip.endsWith("· Shift+N")));
    await q.keyboard.press("Escape");
    await q.keyboard.press("?"); await sleep(100);
    ok("atajos: el panel muestra los atajos actuales", await q.evaluate(() => /Shift\+N/.test(document.querySelector(".g-modal").textContent) && [...document.querySelectorAll(".kb-row")].some(r => r.textContent.startsWith("Duplicar") && r.textContent.includes("—"))));
    await q.close();

    const a = await open("03-ajustes.html", { prefs: NO_TOURS });
    const dialogs = [];
    a.on("dialog", d => { dialogs.push(d.message()); d.accept(); });
    const label = id => a.$eval(`[data-key="${id}"]`, e => e.textContent.trim());
    await a.click('[data-key="tool.note"]'); await a.keyboard.press("q"); await sleep(100);
    ok("ajustes: cambiar un atajo", (await label("tool.note")) === "Q" && await a.evaluate(() => JSON.parse(localStorage.getItem("chinchero-keys"))["tool.note"] === "Q"));
    await a.click('[data-key="tool.card"]');
    await a.keyboard.down("Control"); await a.keyboard.press("c"); await a.keyboard.up("Control"); await sleep(100);
    ok("ajustes: una combinación reservada no se acepta", (await label("tool.card")) === "Pulsa la combinación…" && await a.evaluate(() => /reservado/.test(document.body.textContent)));
    await a.keyboard.press("q"); await sleep(100);
    ok("ajustes: conflicto avisa y deja la otra acción sin atajo", dialogs.length === 1 && (await label("tool.card")) === "Q" && (await label("tool.note")) === "Sin atajo");
    await a.click('[data-reset="tool.card"]'); await sleep(100);
    ok("ajustes: restablecer un atajo", (await label("tool.card")) === "F");
    await a.click('[data-key="tool.text"]'); await a.keyboard.press("Escape"); await sleep(50);
    ok("ajustes: Esc cancela sin cambiar", (await label("tool.text")) === "T");
    await a.click("#resetKeys"); await sleep(100);
    ok("ajustes: restablecer todos", (await label("tool.note")) === "N" && await a.evaluate(() => localStorage.getItem("chinchero-keys") === "{}"));
    await a.close();
  }

  // Seguridad: CSP en cada pantalla y valores del modelo escapados (colores, ids, trazos, emoji) aunque no vengan de un .chinchero
  {
    const q = await open("01-tableros.html", { prefs: NO_TOURS });
    const evil = `red"><img src="x" class="evil">`;
    await q.evaluate(evil => {
      const lib = Store.library();
      lib.groups[0].color = evil;
      lib.boards.push({ id: "malo", name: "Malo", group: lib.groups[0].id, surface: evil, items: evil, updatedAt: Date.now(),
        preview: [{ t: "zone", x: 0, y: 0, w: .5, h: .5, c: evil }, { t: "note", x: evil, y: 0, w: .2, h: .2, pin: 1, pc: evil }] });
      Store.saveLibrary();
      const item = (id, type, extra) => ({ id, type, x: 100, y: 100, w: 200, h: 120, rot: 0, z: 1, s: 1, ...extra });
      localStorage.setItem("chinchero-data-board-malo", JSON.stringify({ name: "Malo", active: 0, sheets: [{ id: "s1", name: "Hoja 1", surface: "dots", view: { x: 0, y: 0, z: 1 }, threads: [{ id: "t1", a: "e1", b: "e2", color: evil }], items: [
        item("e1", "note", { text: "Hola", color: "yellow", fs: "m", fix: "pin", pin: { x: .5, y: .1, color: evil } }),
        item("e2", "stamp", { text: "SELLO", color: evil, fix: "pin", pin: { x: .5, y: .1, color: "#e03131" } }),
        item("e3", "sticker", { emoji: evil }),
        item("e4", "draw", { d: evil, color: evil, sw: evil, vw: 10, vh: 10 }),
        item("e5", "photo", { fit: evil, h: evil, frame: "polaroid", caption: "" }),
        item("e6", "link", { domain: "x.com", title: "x", grad: evil }),
      ] }] }));
    }, evil);
    await q.reload({ waitUntil: "networkidle0" }); await sleep(300);
    ok("tableros: valores del modelo escapados", await q.evaluate(() => !document.querySelector(".evil") && !!document.querySelector('[data-id="malo"]')));
    const b = q;
    await b.goto(BASE + "02-tablero.html?board=malo", { waitUntil: "networkidle0" }); await sleep(400);
    ok("editor: valores del modelo escapados", await b.evaluate(() => !document.querySelector(".evil") && document.querySelectorAll("#items .item").length === 6),
      await b.evaluate(() => document.querySelectorAll("#items .item").length + " " + (document.querySelector(".evil")?.parentElement.outerHTML.slice(0, 300) || "")));
    ok("CSP en todas las pantallas", await b.evaluate(() => /script-src 'self'/.test(document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content)));
    const before = log.length;
    ok("CSP: el código inline no se ejecuta", await b.evaluate(async () => {
      const s = document.createElement("script"); s.textContent = "window.__inline = 1"; document.body.append(s);
      await new Promise(r => setTimeout(r, 50)); return !window.__inline;
    }));
    // La violación provocada a propósito no cuenta como error
    for (let i = log.length - 1; i >= before; i--) if (log[i].includes("Content Security Policy")) log.splice(i, 1);
    await q.close();
  }

  await browser.close();
  fs.writeFileSync(path.join(OUT, "log.txt"), log.join("\n"));
  if (log.some(l => /^FAIL|PAGEERROR|Content Security Policy/.test(l))) process.exitCode = 1;
  console.log(log.join("\n"));
})();
