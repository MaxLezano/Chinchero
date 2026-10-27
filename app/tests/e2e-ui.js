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
  // La barra de formato marca lo aplicado (antes B/I/Lista nunca quedaban marcados)
  const fmtOn = () => p.evaluate(() => [...document.querySelectorAll(".fmt [data-f]")].map(b => b.classList.contains("on") && b.getAttribute("aria-pressed") === "true"));
  ok("formato: sin negrita, B no está marcado", (await fmtOn())[0] === false);
  await p.keyboard.down("Shift"); await p.keyboard.press("Home"); await p.keyboard.up("Shift");
  await p.click('.fmt [data-f="bold"]'); await sleep(100);
  ok("formato: al aplicar negrita, B queda marcado", (await fmtOn())[0] === true);
  await p.keyboard.down("Control"); await p.keyboard.press("i"); await p.keyboard.up("Control"); await sleep(100);
  ok("formato: Ctrl+I marca I", (await fmtOn())[1] === true);
  await p.keyboard.press("End"); await p.keyboard.type("x"); await p.keyboard.press("Home"); await sleep(100);
  ok("formato: al mover el cursor se actualiza", JSON.stringify(await fmtOn()) === JSON.stringify(await p.evaluate(() => ["bold", "italic", "insertUnorderedList"].map(c => document.queryCommandState(c)))));
  ok("formato: el marcado se distingue del hover", await p.evaluate(() => {
    const b = document.querySelector('.fmt [data-f="bold"]'); b.classList.add("on");
    const on = getComputedStyle(b).backgroundColor; return on !== "rgba(127, 127, 127, 0.35)" && on !== "rgba(0, 0, 0, 0)";
  }));
  // Editando: doble clic en una palabra la selecciona sin cortar la edición; un clic en la nota fuera del texto no la mueve
  const noteBox = () => p.evaluate(() => { const r = document.activeElement.closest(".item").getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(Math.round).join(); });
  const box0 = await noteBox();
  const w = await p.evaluate(() => {
    const t = document.createTreeWalker(document.activeElement, NodeFilter.SHOW_TEXT).nextNode(), r = document.createRange();
    r.setStart(t, 1); r.collapse(true); const b = r.getBoundingClientRect(); return { x: b.x + 2, y: b.y + b.height / 2 };
  });
  await p.mouse.click(w.x, w.y, { clickCount: 1 }); await p.mouse.click(w.x, w.y, { clickCount: 2 }); await sleep(200);
  ok("editando: doble clic selecciona una palabra sin cerrar la edición", await p.evaluate(() => document.activeElement.isContentEditable && getSelection().toString().trim().length > 0), await p.evaluate(() => document.activeElement.className + " «" + getSelection() + "»"));
  const nb = await p.evaluate(() => { const r = document.activeElement.closest(".item").getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.bottom - 8 }; });
  await p.mouse.move(nb.x, nb.y); await p.mouse.down(); await p.mouse.move(nb.x + 40, nb.y + 30, { steps: 5 }); await p.mouse.up(); await sleep(150);
  ok("editando: clic y arrastre dentro de la nota no corta la edición ni la mueve", await p.evaluate(() => document.activeElement.isContentEditable) && (await noteBox()) === box0, box0 + " → " + await noteBox());
  await p.keyboard.press("Escape"); await sleep(200);
  // La barra contextual se rehace al cambiar algo: el foco vuelve al mismo botón para seguir con teclado
  await p.mouse.click(c.x, c.y); await sleep(200);
  await p.focus('.ctx [data-act="color"][data-v="blue"]'); await p.keyboard.press("Enter"); await sleep(200);
  ok("barra contextual: tras elegir con teclado el foco sigue en la opción", await p.evaluate(() => {
    const a = document.activeElement; return a.dataset.act === "color" && a.dataset.v === "blue" && a.getAttribute("aria-pressed") === "true";
  }));
  await p.keyboard.down("Control"); await p.keyboard.press("z"); await p.keyboard.up("Control"); await sleep(150);
  await p.keyboard.press("Escape"); await sleep(150);

  // Texto existente editable
  c = await center(".t-text .txt");
  await p.mouse.click(c.x, c.y, { clickCount: 2 }); await sleep(200);
  ok("texto existente editable", await p.evaluate(() => document.activeElement.closest(".t-text") !== null));
  await p.keyboard.press("Escape"); await sleep(150);

  // Lista: editando una tarea, un clic en otra pasa a editar esa (antes cortaba la edición y empezaba a mover la lista)
  c = await center('.t-list .task[data-i="0"]');
  await p.mouse.click(c.x, c.y, { clickCount: 2 }); await sleep(200);
  const listBox0 = await p.$eval(".t-list", e => e.style.left + e.style.top);
  c = await center('.t-list .task[data-i="1"]');
  await p.mouse.click(c.x, c.y); await sleep(200);
  ok("lista: con una tarea en edición, un clic en otra la edita", await p.evaluate(() => document.activeElement.isContentEditable && document.activeElement.dataset.i === "1") && (await p.$eval(".t-list", e => e.style.left + e.style.top)) === listBox0);
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
    await sleep(600); // pasa el límite anti-ráfaga
    await q.evaluate(() => { const play = Sound.play; window.__pedidos = []; Sound.play = (n, f) => { window.__pedidos.push(n); return play(n, f); }; });
    const nt = await q.$eval(".t-note", e => { const r = e.getBoundingClientRect(); return { x: r.left + r.width * .85, y: r.top + r.height * .85 }; });
    await q.mouse.click(nt.x, nt.y); await sleep(150);
    const n3 = await q.evaluate(() => window.__sonidos);
    await q.keyboard.press("Delete"); await sleep(150);
    ok("sonidos: eliminar un elemento suena a papelera", await q.evaluate(n => window.__pedidos.at(-1) === "trash" && window.__sonidos > n, n3), await q.evaluate(() => window.__pedidos.join()));
    await q.close();
  }

  // 4) Claro + tableros + ajustes
  for (const [f, n] of [["01-tableros.html", "v01"], ["03-ajustes.html", "v03"], ["04-papelera.html", "v04"], ["02-tablero.html", "v02"], ["00-bienvenida.html", "v00"]]) {
    const q = await open(f, { theme: "light", prefs: NO_TOURS });
    await shot(q, `${n}-light`);
    if (n === "v04") ok("papelera vacía: el aviso va en el centro del espacio libre", await q.evaluate(() => {
      const m = document.querySelector("main").getBoundingClientRect(), e = document.querySelector("#empty svg").getBoundingClientRect();
      return Math.abs((e.left + e.right) / 2 - (m.left + m.right) / 2) < 4 && e.top > m.top + m.height * .3;
    }));
    if (n === "v01") {
      ok("tableros: enviar a la papelera puede sonar (sound.js cargado)", await q.evaluate(() => typeof Sound?.play === "function"));
      await q.goto(q.url().replace(/\?.*|$/, "?view=fav"), { waitUntil: "networkidle0" }); await sleep(300);
      ok("favoritos sin tableros: invita a crear uno", await q.evaluate(() => !Store.library().boards.length ? /Crea un tablero/.test(document.querySelector("#emptyText").textContent) && getComputedStyle(document.querySelector("#emptyBtn")).display !== "none" : true));
    }
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
    // Hilo con teclado: herramienta Hilo, Tab y Enter en cada extremo
    await q.focus("#canvasFocus"); await q.keyboard.press("Escape");
    await q.keyboard.press("l"); await q.keyboard.press("Tab"); await q.keyboard.press("Enter"); await sleep(100);
    ok("a11y: Enter con la herramienta Hilo marca el origen", /^Hilo desde Nota «.+»\. Elige el otro extremo/.test(await live()), await live());
    await q.keyboard.press("Tab"); await q.keyboard.press("Enter"); await sleep(150);
    ok("a11y: Tab y Enter en el otro extremo tienden el hilo", await q.evaluate(() => document.querySelectorAll("#threads .th").length === 1) && /^Hilo creado entre Nota «.+» y Nota «.+»$/.test(await live()), await live());
    await q.keyboard.press("Escape");
    await q.keyboard.down("Control"); await q.keyboard.press("z"); await q.keyboard.up("Control"); await sleep(150);
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
    // Barras de desplazamiento propias: regla en theme.css (file:// no deja leer cssRules) y pulgar distinto en cada tema
    const css = fs.readFileSync(path.join(__dirname, "..", "src", "renderer", "assets", "theme.css"), "utf8");
    const scroll = await q.evaluate(() => {
      const thumb = t => { document.documentElement.dataset.theme = t; return getComputedStyle(document.documentElement).getPropertyValue("--scroll-thumb").trim(); };
      return { light: thumb("light"), dark: thumb("dark") };
    });
    scroll.rule = /::-webkit-scrollbar-thumb\s*\{[^}]*var\(--scroll-thumb\)[^}]*border-radius/.test(css);
    ok("barras de desplazamiento con el color del tema", scroll.rule && scroll.light && scroll.dark && scroll.light !== scroll.dark, JSON.stringify(scroll));
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

  // Pulido: Ajustes a lo ancho con la sección visible marcada; miniaturas con hilos y sellos; goma en dibujos antiguos (solo `d`)
  {
    const a = await open("03-ajustes.html", { prefs: NO_TOURS, vp: { width: 1920, height: 1080 } });
    const active = () => a.evaluate(() => [...document.querySelectorAll(".tabs a.active")].map(x => x.hash).join());
    const lay = await a.evaluate(() => ({ dir: getComputedStyle(document.querySelector(".tabs")).flexDirection, left: document.querySelector(".content").getBoundingClientRect().left }));
    ok("ajustes: índice a la izquierda y contenido centrado a 1920 px", lay.dir === "column" && lay.left > 600, JSON.stringify(lay));
    ok("ajustes: al abrir marca Apariencia", (await active()) === "#apariencia");
    await a.evaluate(() => document.querySelector("#datos").scrollIntoView({ block: "start" })); await sleep(150);
    ok("ajustes: al desplazarse marca la sección visible", (await active()) === "#datos", await active());
    await a.evaluate(() => { const m = document.querySelector("main"); m.scrollTop = m.scrollHeight; }); await sleep(150);
    ok("ajustes: al final marca Acerca de", (await active()) === "#acerca", await active());
    ok("ajustes: «tablero de ideas digital» en Acerca de", await a.evaluate(() => /tablero de ideas digital/.test(document.querySelector("#acerca").textContent)));
    await shot(a, "e03-ajustes-1920");
    await a.goto(BASE + "00-bienvenida.html", { waitUntil: "networkidle0" });
    ok("bienvenida: «tablero de ideas digital»", await a.evaluate(() => /tablero de ideas digital/.test(document.body.textContent) && !/corcho digital/.test(document.body.textContent)));

    await a.evaluate(() => {
      const lib = Store.library();
      lib.boards.push({ id: "pulido", name: "Pulido", group: lib.groups[0].id, updatedAt: Date.now() });
      Store.saveLibrary();
      const item = (id, type, x, y, extra) => ({ id, type, x, y, w: 200, h: 120, rot: 0, z: 1, s: 1, ...extra });
      const pin = { x: .5, y: .1, color: "#1c7ed6" };
      localStorage.setItem("chinchero-data-board-pulido", JSON.stringify({ name: "Pulido", active: 0, sheets: [{ id: "s1", name: "Hoja 1", surface: "dots", view: { x: 0, y: 0, z: 1 },
        threads: [{ id: "t1", a: "n1", b: "c1" }, { id: "t2", a: "c1", b: "p1" }], items: [
          item("n1", "note", 100, 100, { text: "A", color: "yellow", fs: "m", fix: "pin", pin }),
          item("c1", "card", 500, 120, { title: "Ficha", body: "", fix: "pin", pin }),
          item("p1", "stamp", 300, 400, { text: "HECHO", color: "#2f9e44", fix: "pin", pin }),
          item("d1", "draw", 100, 300, { w: 200, h: 80, vw: 200, vh: 80, d: "M10 40 L190 40", color: "#e03131", sw: 4 }),
        ] }] }));
    });
    await a.goto(BASE + "02-tablero.html?board=pulido", { waitUntil: "networkidle0" }); await sleep(400);
    const r = await a.evaluate(() => { const b = document.querySelector('[data-id="d1"]').getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; });
    await a.keyboard.press("d"); await a.keyboard.press("e"); await sleep(100);
    await a.mouse.move(r.x, r.y - 40); await a.mouse.down(); await a.mouse.move(r.x, r.y + 40, { steps: 8 }); await a.mouse.up(); await sleep(200);
    const parts = await a.evaluate(() => { const e = document.querySelector('[data-id="d1"] path:not(.dh)'); return e ? (e.getAttribute("d").match(/M/g) || []).length : -1; });
    ok("goma: un dibujo antiguo (solo d) se corta en partes", parts === 2, "partes: " + parts);
    await a.goto(BASE + "01-tableros.html?view=recent", { waitUntil: "networkidle0" }); await sleep(300);
    const pv = await a.evaluate(() => {
      const c = document.querySelector('[data-id="pulido"]');
      return { threads: c.querySelectorAll("svg.th path").length, stamp: !!c.querySelector(".pv.stamp"), paper: !!c.querySelector(".pv.paper"),
        cardClass: document.querySelectorAll(".pv.card").length, radius: getComputedStyle(c.querySelector(".pv.paper")).borderRadius };
    });
    ok("tableros: la miniatura dibuja hilos, sellos y fichas", pv.threads === 2 && pv.stamp && pv.paper && !pv.cardClass && pv.radius === "0px", JSON.stringify(pv));
    const cw = await a.evaluate(() => document.querySelector(".card").getBoundingClientRect().width);
    ok("tableros: tarjetas más grandes a 1920 px", cw >= 300, "ancho " + Math.round(cw));
    await shot(a, "e01-tableros-1920");
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
        preview: [{ t: "zone", x: 0, y: 0, w: .5, h: .5, c: evil }, { t: "note", x: evil, y: 0, w: .2, h: .2, pin: 1, pc: evil, px: evil, py: 0 }],
        previewThreads: [{ a: [evil, 0], m: [0, evil], b: [1, 1], c: evil, ac: evil, bc: evil }] });
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

  // Asistente con IA: hojas, zonas con su contenido, stickers y el registro de lo hecho para el historial
  {
    const p = await open("02-tablero.html?template=blank&name=IA-hojas", { prefs: NO_TOURS });
    const r = await p.evaluate(() => {
      const did = [];
      const n = Editor.applyAI([
        { op: "crear", tipo: "texto", texto: "Cuentas del local" },
        { op: "crear", ref: "m1", tipo: "ficha", titulo: "Mesa 1", texto: "Total: $45" },
        { op: "crear", ref: "m2", tipo: "ficha", titulo: "Mesa 2", texto: "Total: $30" },
        { op: "crear", ref: "l", tipo: "lista", titulo: "Cobros", tareas: ["Mesa 1", "Mesa 2"] },
        { op: "crear", ref: "z1", tipo: "zona", titulo: "Mesas", dentro: ["m1", "m2"] },
        { op: "crear", ref: "z2", tipo: "zona", titulo: "Caja", dentro: ["l"] },
        { op: "crear", tipo: "zona", titulo: "Vacía" }, { op: "crear", tipo: "zona", titulo: "Extra", dentro: [{ tipo: "nota", texto: "Escrita dentro" }] },
        { op: "crear", tipo: "sticker", emoji: "🐴" }, { op: "crear", tipo: "sticker", emoji: "<b>x</b>" },
      ], did);
      const zones = [...document.querySelectorAll(".t-zone")].map(z => ({ t: z.textContent, r: z.getBoundingClientRect() }));
      const inZone = (el, t) => { const z = zones.find(z => z.t === t).r, b = el.getBoundingClientRect(); return b.left >= z.left && b.right <= z.right && b.top >= z.top && b.bottom <= z.bottom + 4; };
      const [a, b] = zones.filter(z => z.t !== "Vacía").map(z => z.r);
      return {
        n, did, zones: zones.map(z => z.t), stickers: [...document.querySelectorAll(".t-sticker")].map(e => e.textContent),
        inside: [...document.querySelectorAll(".t-card")].every(c => inZone(c, "Mesas")) && inZone(document.querySelector(".t-list"), "Caja"),
        apart: !!a && !!b && (a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top),
      };
    });
    ok("IA: las zonas se arman con su contenido y no se pisan", r.zones.includes("Mesas") && r.zones.includes("Caja") && r.inside && r.apart, JSON.stringify(r));
    ok("IA: una zona con el elemento escrito dentro lo crea", await p.evaluate(() => [...document.querySelectorAll(".t-note .txt")].some(e => e.textContent === "Escrita dentro") && [...document.querySelectorAll(".t-zone")].some(z => z.textContent === "Extra")));
    ok("IA: stickers solo con emoji", r.stickers.includes("🐴") && !r.stickers.some(s => s.includes("x")), JSON.stringify(r.stickers));
    ok("IA: deja registro de lo que hizo, con ids", r.did.some(d => /^creé ficha e\d+ «Mesa 1/.test(d)) && r.did.some(d => d.startsWith("creé zona")), JSON.stringify(r.did));
    const h = await p.evaluate(() => {
      const ids = JSON.parse(Editor.boardForAI()).elementos.filter(e => e.tipo === "ficha").map(e => e.id), did = [];
      const n = Editor.applyAI([{ op: "hoja", nombre: "Pagos", nueva: true, llevar: ids }, { op: "crear", tipo: "nota", texto: "Revisar propinas" }], did);
      const b = JSON.parse(Editor.boardForAI());
      return { n, did, hoja: b.hoja, hojas: b.hojas, tipos: b.elementos.map(e => e.tipo).sort().join(","), tab: document.querySelector(".sheet.active")?.textContent || "" };
    });
    ok("IA: crea una hoja, lleva elementos (con su zona) y sigue trabajando en ella", h.hoja === "Pagos" && h.hojas.length === 2 && h.tipos === "ficha,ficha,nota,zona" && h.tab.includes("Pagos") && h.did.some(d => d.startsWith("llevé")), JSON.stringify(h));
    const back = await p.evaluate(() => {
      const before = JSON.parse(Editor.boardForAI()).elementos.length;
      Editor.applyAI([{ op: "hoja", nombre: "Hoja 1" }, { op: "crear", tipo: "nota", texto: "De vuelta" }]);
      const b = JSON.parse(Editor.boardForAI());
      return { before, hoja: b.hoja, sinFichas: !b.elementos.some(e => e.tipo === "ficha"), nota: b.elementos.some(e => e.texto === "De vuelta") };
    });
    ok("IA: va a una hoja que ya existe por su nombre", back.hoja === "Hoja 1" && back.sinFichas && back.nota, JSON.stringify(back));
    await p.keyboard.down("Control"); await p.keyboard.press("z"); await p.keyboard.press("z"); await p.keyboard.up("Control"); await sleep(300);
    ok("IA: deshacer quita la hoja nueva y devuelve lo que se llevó", await p.evaluate(() => { const b = JSON.parse(Editor.boardForAI()); return b.hojas.length === 1 && b.elementos.filter(e => e.tipo === "ficha").length === 2; }));
    ok("IA: renombra la hoja abierta", await p.evaluate(() => Editor.applyAI([{ op: "hoja", nombre: "Caja", renombrar: true }]) === 1
      && JSON.parse(Editor.boardForAI()).hoja === "Caja" && document.querySelector(".sheet.active").textContent.includes("Caja")));
    ok("IA: llevar todo a una hoja nueva renombra la actual en vez de dejarla vacía", await p.evaluate(() => {
      const ids = JSON.parse(Editor.boardForAI()).elementos.map(e => e.id);
      Editor.applyAI([{ op: "hoja", nombre: "Todo", nueva: true, llevar: ids }]);
      const b = JSON.parse(Editor.boardForAI());
      return b.hojas.length === 1 && b.hoja === "Todo" && b.elementos.length === ids.length;
    }));
    await p.close();
  }

  // Asistente con IA: sin la app de escritorio no se puede usar; las acciones del modelo se aplican con cuidado
  {
    const p = await open("02-tablero.html?template=blank&name=IA", { prefs: NO_TOURS });
    // Chinche: el pin flotante que abre el asistente, fuera de la barra de arriba y sin tapar el minimapa
    const pin = () => p.evaluate(() => {
      const b = document.getElementById("aiBtn"), r = b.getBoundingClientRect(), mm = document.getElementById("minimap");
      const m = mm.hidden ? null : mm.getBoundingClientRect(), cs = getComputedStyle(b);
      return { top: !!b.closest(".topbar"), fixed: cs.position === "fixed", visible: cs.visibility === "visible" && r.width > 0,
        overMinimap: !!m && r.bottom > m.top && r.right > m.left && r.left < m.right,
        floats: getComputedStyle(b.querySelector(".chinche-flota")).animationName, label: b.getAttribute("aria-label"), expanded: b.getAttribute("aria-expanded") };
    });
    let c = await pin();
    ok("Chinche: pin flotante fuera de la barra, con nombre y animación en reposo", !c.top && c.fixed && c.visible && /Chinche/.test(c.label) && c.floats === "chinche-flota", JSON.stringify(c));
    ok("Chinche: no tapa el minimapa", !c.overMinimap, JSON.stringify(c));
    await p.click("#mmToggle"); await sleep(100);
    ok("Chinche: sin minimapa baja a la esquina", await p.evaluate(() => innerHeight - document.getElementById("aiBtn").getBoundingClientRect().bottom < 70));
    await p.click("#mmToggle"); await sleep(100);
    await p.hover("#aiBtn"); await sleep(400);
    ok("Chinche: al pasar el ratón se levanta y muestra el brillo", await p.evaluate(() => getComputedStyle(document.querySelector(".chinche-brillo")).opacity === "1" && getComputedStyle(document.querySelector(".chinche-pin")).transform !== "none"));
    await shot(p, "chinche");
    await p.click("#aiBtn"); await sleep(60);
    ok("Chinche: el panel sale desde el pin", await p.evaluate(() => {
      const pn = document.getElementById("aiPanel"), [x, y] = getComputedStyle(pn).transformOrigin.split(" ").map(parseFloat);
      return pn.classList.contains("sale") && x > pn.offsetWidth / 2 && y > 0;
    }));
    await sleep(400);
    c = await pin();
    ok("Chinche: con el panel abierto se esconde y queda expandido", !c.visible && c.expanded === "true", JSON.stringify(c));
    await p.keyboard.press("Escape"); await sleep(300);
    ok("Chinche: al cerrar vuelve y recibe el foco", await p.evaluate(() => document.activeElement.id === "aiBtn" && getComputedStyle(document.activeElement).visibility === "visible" && document.activeElement.getAttribute("aria-expanded") === "false"));
    await p.keyboard.press("Enter"); await sleep(300);
    ok("Chinche: se abre con el teclado", await p.evaluate(() => !document.getElementById("aiPanel").hidden));
    await p.keyboard.press("Escape"); await sleep(300);
    await p.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
    ok("Chinche: con movimiento reducido no flota", (await pin()).floats === "none");
    await p.emulateMediaFeatures([]);
    await p.click("#aiBtn"); await sleep(300);
    ok("IA: en el navegador el panel avisa que es de la app de escritorio", await p.evaluate(() => !document.getElementById("aiPanel").hidden && document.getElementById("aiLog").textContent.includes("app de escritorio") && document.getElementById("aiInput").disabled));
    await p.keyboard.press("Escape"); await sleep(200);
    ok("IA: Esc cierra el panel", await p.evaluate(() => document.getElementById("aiPanel").hidden));
    const r = await p.evaluate(() => {
      const n = Editor.applyAI([
        { op: "crear", ref: "z", tipo: "nota", texto: "<img src=x onerror=alert(1)>\nSegunda línea", color: "rosa" },
        { op: "crear", ref: "f", tipo: "ficha", titulo: "<b>Resumen</b>", texto: "Hola", cerca: "z" },
        { op: "crear", ref: "l", tipo: "lista", titulo: "Tareas", tareas: ["Uno", { texto: "Dos", hecha: true }] },
        { op: "crear", tipo: "sello", texto: "listo" },
        { op: "crear", tipo: "nota", titulo: "Tokio", texto: "Shibuya", cerca: "l" },
        { op: "crear", tipo: "foto" }, { op: "volar" }, null, "texto",
        { op: "unir", a: "z", b: "f", etiqueta: "porque" }, { op: "unir", a: "z", b: "f" }, { op: "unir", a: "z", b: "inventado" },
        { op: "agrupar", titulo: "Tema", ids: ["z", "f"], color: "verde" },
      ]);
      const note = document.querySelector(".t-note .txt"), list = document.querySelector(".t-list");
      return {
        n, items: document.querySelectorAll("#items .item").length, threads: document.querySelectorAll("#threadLayer .th").length,
        noteHtml: note.innerHTML, img: !!document.querySelector("#items img"),
        cardTitle: document.querySelector(".t-card .card-title").textContent,
        tasks: [...list.querySelectorAll(".task")].map(t => t.textContent).join("|"), done: list.querySelector(".prog").textContent,
        stamp: document.querySelector(".t-stamp .badge").textContent, titled: [...document.querySelectorAll(".t-note .txt")].some(e => e.innerHTML === "<b>Tokio</b><br>Shibuya"), zone: document.querySelector(".t-zone .zt").textContent,
        board: JSON.parse(Editor.boardForAI()),
      };
    });
    ok("IA: aplica solo las acciones válidas", r.n === 7 && r.items === 6 && r.threads === 1, JSON.stringify({ n: r.n, items: r.items, threads: r.threads }));
    ok("IA: el texto del modelo se escapa", !r.img && r.noteHtml.startsWith("&lt;img") && r.noteHtml.includes("<br>") && r.cardTitle === "<b>Resumen</b>", r.noteHtml);
    ok("IA: listas, sellos y zonas con sus datos", r.tasks === "Uno|Dos" && r.done === "1/2" && r.stamp === "LISTO" && r.zone === "Tema" && r.titled, JSON.stringify(r));
    ok("IA: la hoja que ve el modelo trae ids, tipos, textos e hilos", r.board.elementos.length === 6 && r.board.elementos.some(e => e.tipo === "lista" && e.texto.includes("Uno")) && r.board.hilos[0].etiqueta === "porque");
    ok("IA: «agrupar» deja los elementos dentro de la zona", await p.evaluate(() => {
      const z = document.querySelector(".t-zone").getBoundingClientRect();
      return [".t-note", ".t-card"].every(s => { const b = document.querySelector(s).getBoundingClientRect(); return b.left >= z.left && b.right <= z.right && b.top >= z.top && b.bottom <= z.bottom + 4; });
    }));
    await shot(p, "ia-acciones");
    await p.keyboard.down("Control"); await p.keyboard.press("z"); await p.keyboard.up("Control"); await sleep(300);
    ok("IA: un Ctrl+Z deshace todo lo que hizo", await p.evaluate(() => !document.querySelector("#items .item")));
    ok("IA: sin acciones válidas no cambia nada", await p.evaluate(() => Editor.applyAI([{ op: "borrar", id: "nada" }, { op: "editar", id: "nada", texto: "x" }]) === 0 && document.getElementById("undoBtn").disabled));
    ok("IA: lo que crea no queda encima de otra cosa", await p.evaluate(() => {
      Editor.applyAI([{ op: "crear", ref: "a", tipo: "nota", texto: "Centro" }, { op: "crear", tipo: "lista", titulo: "L", tareas: ["1", "2", "3", "4"] },
        ...[1, 2, 3, 4, 5].map(i => ({ op: "crear", tipo: i % 2 ? "nota" : "ficha", texto: "Idea " + i, cerca: "a" })), { op: "crear", tipo: "nota", texto: "Suelta" }]);
      const rs = [...document.querySelectorAll("#items .item")].map(e => e.getBoundingClientRect());
      return rs.length === 8 && rs.every((a, i) => rs.every((b, j) => i === j || a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top));
    }));
    await p.click("#aiBtn"); await sleep(300);
    ok("IA: con el panel abierto, lo que crea queda a la vista y no debajo del panel", await p.evaluate(() => {
      Editor.applyAI([1, 2, 3, 4, 5, 6, 7, 8, 9].map(i => ({ op: "crear", tipo: "nota", texto: "Lejos " + i })));
      const pr = document.getElementById("aiPanel").getBoundingClientRect(), vr = document.getElementById("viewport").getBoundingClientRect();
      const rs = [...document.querySelectorAll("#items .item")].filter(e => e.textContent.includes("Lejos")).map(e => e.getBoundingClientRect());
      return rs.length === 9 && rs.every(r => r.right <= pr.left && r.left >= vr.left && r.top >= vr.top && r.bottom <= vr.bottom);
    }));
    await p.keyboard.press("Escape"); await sleep(200);
    const dr = await p.evaluate(() => {
      const n = Editor.applyAI([
        { op: "dibujar", trazos: ["M10 10 L60 10 L35 50 Z", "M35 50 L35 90"], color: "azul", grosor: "grueso" },
        { op: "dibujar", trazos: ["m100 100 l20 0", "m100 120 l20 0"] }, // relativos, lejos del 0,0 y diminutos
        { op: "dibujar", trazos: ['M0 0"/><script>alert(1)</script>', "<g>"] }, { op: "dibujar", trazos: "M0 0 L9 9" }, { op: "dibujar", trazos: [] },
      ]);
      const ds = [...document.querySelectorAll(".t-draw")], paths = ds.map(e => e.querySelectorAll("path")[1]);
      return { n, count: ds.length, d: paths[0]?.getAttribute("d"), d2: paths[1]?.getAttribute("d"), stroke: paths[0]?.getAttribute("stroke"), sw: paths[0]?.getAttribute("stroke-width"),
        sizes: ds.map(e => Math.max(e.offsetWidth, e.offsetHeight)), script: !!document.querySelector("#items script") };
    });
    ok("IA: «dibujar» crea dibujos con los trazos válidos", dr.n === 2 && dr.count === 2 && dr.d === "M3.7 3.7 L53.7 3.7 L28.7 43.7 Z M28.7 43.7 L28.7 83.7" && dr.d2 === "M0.5 0.5 l20 0 M0.5 20.5 l20 0" && dr.stroke === "#1c7ed6" && dr.sw === "8" && !dr.script, JSON.stringify(dr));
    ok("IA: los dibujos de la IA tienen un tamaño visible", dr.sizes.every(s => s >= 260 && s <= 480), JSON.stringify(dr.sizes));
    await shot(p, "ia-dibujo");
    await p.close();
    const s = await open("03-ajustes.html", { prefs: NO_TOURS });
    ok("IA: en el navegador los ajustes del asistente están desactivados", await s.evaluate(() => document.getElementById("aiOn").disabled && document.getElementById("aiIntro").textContent.includes("app de escritorio")));
    await s.close();
  }

  await browser.close();
  fs.writeFileSync(path.join(OUT, "log.txt"), log.join("\n"));
  if (log.some(l => /^FAIL|PAGEERROR|Content Security Policy/.test(l))) process.exitCode = 1;
  console.log(log.join("\n"));
})();
