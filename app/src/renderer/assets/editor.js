// Editor del tablero (mockup 02). El estado vive en `doc` (hojas → elementos + hilos) y el DOM se genera a partir de él.
(() => {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const rand = (a, b) => Math.round((a + Math.random() * (b - a)) * 10) / 10;
  // Texto plano a HTML: los saltos pasan a <br> y la sangría (tabulación = 4 espacios) y los espacios seguidos a
  // espacios duros, que el HTML no junta
  const plainHtml = s => esc(s.replace(/\r\n?/g, "\n").replace(/\t/g, "    ")).replace(/^ +| {2,}/gm, m => "&nbsp;".repeat(m.length)).replace(/\n/g, "<br>");
  const plain = html => { const d = document.createElement("div"); d.innerHTML = html || ""; return d.textContent; };
  // HTML de texto con formato: solo negrita, cursiva, subrayado, tachado, listas, saltos y <font> con un color de
  // TEXT_COLORS o un tamaño de TEXT_SIZES (lo que genera la barra de formato) y la alineación de líneas y listas
  // (text-align izquierda, centro o derecha); ningún otro atributo. Lo demás se descarta (scripts, imágenes, estilos) o se deja solo su texto; títulos y párrafos pasan a líneas.
  // Valor: clave del nombre (editor.formato.colores.* y editor.formato.tamanos.*)
  const TEXT_COLORS = { "#c92a2a": "rojo", "#d9480f": "naranja", "#2b8a3e": "verde", "#1864ab": "azul", "#862e9c": "morado", "#868e96": "gris" };
  const TEXT_SIZES = { 2: "pequeno", 3: "normal", 5: "grande", 6: "muyGrande" };
  const RICH_TAGS = { B: "b", STRONG: "b", I: "i", EM: "i", U: "u", S: "s", STRIKE: "s", DEL: "s", UL: "ul", OL: "ol", LI: "li" };
  const RICH_DROP = /^(SCRIPT|STYLE|TEMPLATE|IFRAME|OBJECT|EMBED|NOSCRIPT|SVG|MATH|HEAD|TITLE|META|LINK|IMG|PICTURE|VIDEO|AUDIO|CANVAS|INPUT|BUTTON|SELECT|TEXTAREA)$/;
  const alignOf = n => { const a = (n.style.textAlign || n.getAttribute("align") || "").toLowerCase(); return /^(left|center|right)$/.test(a) ? a : ""; };
  const RICH_BLOCK = /^(DIV|P|H[1-6]|BLOCKQUOTE|PRE|TR|SECTION|ARTICLE|HEADER|FOOTER|ASIDE|DT|DD|FIGCAPTION|ADDRESS)$/;
  function cleanHtml(html) {
    const src = document.createElement("template"), out = document.createElement("div");
    // Los atributos se descartan igual, pero un onerror="…" pegado haría que la CSP avise al analizarlo
    src.innerHTML = (html || "").replace(/<[^>]*>/g, tag => tag.replace(/\son/gi, " data-on"));
    const walk = (from, to, pre) => {
      for (const n of from.childNodes) {
        if (n.nodeType === 3) {
          // Fuera de <pre> los saltos y tabulaciones del código fuente no se ven: se juntan (los &nbsp; se respetan)
          if (pre) n.data.split("\n").forEach((t, i) => { if (i) to.append(document.createElement("br")); to.append(t); });
          else to.append(n.data.replace(/[ \t\r\n\f]+/g, " "));
        } else if (n.nodeType !== 1 || RICH_DROP.test(n.tagName)) continue;
        else if (n.tagName === "BR") to.append(document.createElement("br"));
        else if (n.tagName === "FONT") {
          // El tamaño normal (3) no se guarda: execCommand ya quitó el de los padres al aplicarlo
          const color = (n.getAttribute("color") || "").toLowerCase(), size = n.getAttribute("size");
          if (!TEXT_COLORS[color] && !(TEXT_SIZES[size] && size !== "3")) { walk(n, to, pre); continue; }
          const f = to.appendChild(document.createElement("font"));
          if (TEXT_COLORS[color]) f.setAttribute("color", color);
          if (TEXT_SIZES[size] && size !== "3") f.setAttribute("size", size);
          walk(n, f, pre);
        } else if (RICH_TAGS[n.tagName]) {
          const t = to.appendChild(document.createElement(RICH_TAGS[n.tagName]));
          if (/^(UL|OL|LI)$/.test(n.tagName) && alignOf(n)) t.style.textAlign = alignOf(n);
          walk(n, t, pre);
        } else if (RICH_BLOCK.test(n.tagName)) {
          const d = to.appendChild(document.createElement("div"));
          if (alignOf(n)) d.style.textAlign = alignOf(n);
          walk(n, /^H\d$/.test(n.tagName) ? d.appendChild(document.createElement("b")) : d, pre || n.tagName === "PRE");
          if (!d.textContent.trim() && !d.querySelector("br")) d.replaceWith(...(d.textContent ? [" "] : []));
        } else { walk(n, to, pre); if (/^T[DH]$/.test(n.tagName)) to.append(" "); }
      }
    };
    walk(src.content, out, false);
    return out.innerHTML.replace(/^(\s|<br>)+|(\s|<br>)+$/g, "");
  }
  const norm = s => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

  const viewport = $("#viewport"), world = $("#world"), itemsEl = $("#items");
  const threadsSvg = $("#threads"), threadLayer = $("#threadLayer"), drawTmp = $("#drawTmp");
  const ctx = $("#ctx"), fmt = $("#fmt"), hint = $("#hint"), band = $("#band"), ghost = $("#ghost");
  const stickerPop = $("#stickerPop"), drawPop = $("#drawPop"), minimap = $("#minimap");

  /* ---------- Constantes ---------- */
  const NOTE_COLORS = { yellow: "var(--note-yellow)", blue: "var(--note-blue)", pink: "var(--note-pink)", green: "var(--note-green)", purple: "var(--note-purple)", orange: "#ffc078", white: "#f8f9fa" };
  const PIN_COLORS = ["#e03131", "#1c7ed6", "#2f9e44", "#f59f00", "#ae3ec9", "#343a40"];
  const INK_COLORS = ["", "#e03131", "#1c7ed6", "#2f9e44", "#ae3ec9"];
  const ZONE_COLORS = ["#4dabf7", "#f783ac", "#69db7c", "#ffa94d", "#9775fa", "#868e96"];
  const STAMP_COLORS = ["#e03131", "#2f9e44", "#1c7ed6", "#f08c00", "#7048e8", "#495057"];
  const DRAW_COLORS = ["#e03131", "#1c7ed6", "#2b2a27", "#f59f00", "#2f9e44", "#ffffff"];
  const FILE_COLORS = { pdf: "#e03131", doc: "#1c7ed6", docx: "#1c7ed6", xls: "#2f9e44", xlsx: "#2f9e44", ppt: "#e8590c", pptx: "#e8590c", zip: "#7048e8", txt: "#868e96", mp3: "#ae3ec9", mp4: "#d6336c" };
  const GRADS = ["linear-gradient(135deg,#4dabf7,#7048e8)", "linear-gradient(135deg,#ff922b,#f03e3e)", "linear-gradient(135deg,#38d9a9,#1c7ed6)", "linear-gradient(135deg,#f783ac,#ae3ec9)", "linear-gradient(135deg,#ffd43b,#f76707)"];
  const FS = { s: "19px", m: "24px", l: "32px" };
  const PINNABLE = new Set(["note", "card", "list", "photo", "link", "file", "text"]);
  const SCALED = new Set(["text", "sticker", "stamp"]);
  const CREATE = new Set(["note", "card", "list", "text", "image", "link", "file", "sticker"]);
  // Nombre de cada tipo en el idioma actual: TYPE_NAMES.note → «Nota»
  const TYPE_NAMES = new Proxy({}, { get: (o, k) => t("editor.tipos." + String(k)) });
  const TYPE_ICON = { note: "📝", card: "🗒️", list: "☑️", text: "🔤", photo: "🖼️", link: "🔗", file: "📎", sticker: "⭐", stamp: "🏷️", zone: "🗂️", draw: "✏️" };
  const CLIP = "chinchero:";

  const svgI = p => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${p}</svg>`;
  const ICON = {
    dup: svgI('<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>'),
    trash: svgI('<path d="M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3"/>'),
    more: svgI('<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>'),
    lock: svgI('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>'),
    unlock: svgI('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.5-2"/>'),
    alignL: svgI('<path d="M4 3v18M8 7h10M8 12h6M8 17h12"/>'),
    alignT: svgI('<path d="M3 4h18M7 8v10M12 8v6M17 8v12"/>'),
    grid: svgI('<rect x="4" y="4" width="6" height="6"/><rect x="14" y="4" width="6" height="6"/><rect x="4" y="14" width="6" height="6"/><rect x="14" y="14" width="6" height="6"/>'),
    zone: svgI('<rect x="3" y="6" width="18" height="14" rx="3" stroke-dasharray="3 3"/><path d="M5 3h7"/>'),
  };

  const ART = {
    sunset: '<svg viewBox="0 0 200 180" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="gSky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff9a76"/><stop offset="1" stop-color="#ffd8a8"/></linearGradient></defs><rect width="200" height="180" fill="url(#gSky)"/><circle cx="140" cy="70" r="26" fill="#fff3bf"/><path d="M0 130 L50 80 L90 120 L130 70 L200 140 V180 H0z" fill="#5c3d6e"/><path d="M0 150 L60 115 L120 150 L200 120 V180 H0z" fill="#3b2a4a"/></svg>',
    tree: '<svg viewBox="0 0 200 180" preserveAspectRatio="xMidYMid slice"><rect width="200" height="180" fill="#a5d8ff"/><rect y="120" width="200" height="60" fill="#69db7c"/><circle cx="60" cy="120" r="34" fill="#2b8a3e"/><rect x="56" y="120" width="8" height="30" fill="#5c3d1e"/><path d="M110 60 q10-10 20 0 q10-10 20 0" stroke="#495057" stroke-width="3" fill="none"/></svg>',
    sea: '<svg viewBox="0 0 200 180" preserveAspectRatio="xMidYMid slice"><rect width="200" height="180" fill="#d0ebff"/><circle cx="60" cy="60" r="20" fill="#ffe066"/><rect y="105" width="200" height="75" fill="#1c7ed6"/><path d="M0 120 q12-8 25 0 t25 0 t25 0 t25 0 t25 0 t25 0 t25 0 t25 0" stroke="#e7f5ff" stroke-width="3" fill="none"/><path d="M130 105 l20-40 l20 40z" fill="#fff"/></svg>',
    city: '<svg viewBox="0 0 200 180" preserveAspectRatio="xMidYMid slice"><rect width="200" height="180" fill="#1c2541"/><circle cx="160" cy="40" r="14" fill="#fff3bf"/><g fill="#3a506b"><rect x="0" y="110" width="30" height="70"/><rect x="34" y="70" width="34" height="110"/><rect x="72" y="100" width="26" height="80"/><rect x="102" y="55" width="36" height="125"/><rect x="142" y="95" width="26" height="85"/><rect x="172" y="120" width="28" height="60"/></g><g fill="#ffd43b"><rect x="40" y="80" width="5" height="5"/><rect x="54" y="96" width="5" height="5"/><rect x="110" y="66" width="5" height="5"/><rect x="124" y="90" width="5" height="5"/><rect x="110" y="120" width="5" height="5"/><rect x="148" y="104" width="5" height="5"/></g></svg>',
    person: '<svg viewBox="0 0 200 180" preserveAspectRatio="xMidYMid slice"><rect width="200" height="180" fill="#ced4da"/><circle cx="100" cy="70" r="30" fill="#495057"/><path d="M40 180 Q 40 110 100 110 Q 160 110 160 180z" fill="#495057"/><path d="M60 52 h80 l-8 -16 h-64z" fill="#343a40"/></svg>',
    map: '<svg viewBox="0 0 200 180" preserveAspectRatio="xMidYMid slice"><rect width="200" height="180" fill="#f4e7c5"/><path d="M0 60 Q 60 40 100 80 T 200 70" stroke="#74c0fc" stroke-width="10" fill="none"/><path d="M30 0 L60 180 M140 0 L120 180 M0 130 L200 120" stroke="#fff" stroke-width="5"/><path d="M128 102 l14 14 m0 -14 l-14 14" stroke="#e03131" stroke-width="5" stroke-linecap="round"/></svg>',
  };

  /* ---------- Modelo ---------- */
  let uid = 1;
  const nid = () => "e" + uid++;
  let zTop = 0, zBottom = 0, zZoneTop = 0, zZoneBottom = 0;
  const pinC = color => ({ x: .5, y: .04, color });

  const DEFAULTS = {
    note: () => ({ w: 180, h: 170, color: "yellow", text: "", fs: "m", fix: "pin" }),
    card: () => ({ w: 240, h: 150, title: t("editor.nuevos.titulo"), text: "", fix: "pin" }),
    list: () => ({ w: 230, h: 120, title: t("editor.tipos.list"), tasks: [{ text: "", done: false }], fix: "pin" }),
    text: () => ({ text: t("editor.nuevos.titulo"), s: 1, ink: "" }),
    photo: () => ({ w: 210, h: 180, src: "", art: "", caption: t("tableros.sinTitulo"), frame: "polaroid", fit: "cover", fix: "pin" }),
    link: () => ({ w: 260, url: "", domain: "", title: "", grad: GRADS[0], fix: "pin" }),
    file: () => ({ w: 240, name: t("editor.nuevos.archivo"), ext: "", size: "", fix: "pin" }),
    sticker: () => ({ emoji: "⭐", img: "", s: 1 }),
    stamp: () => ({ text: t("editor.nuevos.sello"), color: "#e03131", s: 1 }),
    zone: () => ({ w: 420, h: 300, title: t("editor.tipos.zone"), color: ZONE_COLORS[0] }),
    draw: () => ({ w: 100, h: 100, vw: 100, vh: 100, d: "", color: "#e03131", sw: 3 }),
  };

  function mk(type, x, y, o = {}) {
    const it = Object.assign({ id: nid(), type, x, y, rot: 0, locked: false, fix: null, pin: pinC("#e03131") }, DEFAULTS[type](), o);
    it.z = type === "zone" ? ++zZoneTop : ++zTop;
    return it;
  }
  const th = (a, b, o = {}) => ({ id: nid(), a: a.id, b: b.id, color: "", label: "", sag: 1, ...o });
  const newSheet = (name, o = {}) => ({ id: nid(), name, color: o.color || "yellow", surface: o.surface || getPref("surface") || "dots", items: o.items || [], threads: o.threads || [], view: null });

  function linkData(raw) {
    let url = raw.trim();
    if (!/^https?:\/\//i.test(url)) url = "https://" + url;
    let host = url, last = "";
    try { const u = new URL(url); host = u.hostname.replace(/^www\./, ""); last = decodeURIComponent(u.pathname).split("/").filter(Boolean).pop() || ""; } catch (e) {}
    const title = last ? last.replace(/\.\w+$/, "").replace(/[-_]+/g, " ").replace(/^./, c => c.toUpperCase()) : host.charAt(0).toUpperCase() + host.slice(1);
    const h = [...host].reduce((a, c) => a + c.charCodeAt(0), 0);
    return { url, domain: host, title, grad: GRADS[h % GRADS.length] };
  }
  const isUrl = s => /^(https?:\/\/|www\.)\S+$/i.test(s.trim());
  const isImageUrl = s => isUrl(s) && /\.(png|jpe?g|gif|webp|svg)(\?|$)/i.test(s.trim());

  /* ---------- Plantillas ---------- */
  function kanbanItems() {
    const z = [[t("plantillas.porHacer"), "#4dabf7"], [t("plantillas.haciendo"), "#ffa94d"], [t("plantillas.hecho"), "#69db7c"]].map(([title, color], i) => mk("zone", 140 + i * 380, 110, { w: 340, h: 560, title, color }));
    const notes = [
      mk("note", 170, 160, { color: "yellow", text: t("plantillas.kanban1"), rot: -2 }),
      mk("note", 170, 380, { color: "blue", text: t("plantillas.kanban2"), rot: 2, pin: pinC("#1c7ed6") }),
      mk("note", 550, 160, { color: "pink", text: t("plantillas.kanban3"), rot: 1, pin: pinC("#ae3ec9") }),
      mk("note", 930, 160, { color: "green", text: t("plantillas.kanban4"), rot: -1, pin: pinC("#2f9e44") }),
      mk("note", 930, 380, { color: "green", text: t("plantillas.kanban5"), rot: 2, pin: pinC("#2f9e44") }),
    ];
    return { items: [...z, ...notes], threads: [] };
  }

  function semanaItems() {
    const days = t("plantillas.dias", { returnObjects: true });
    const z = days.map((title, i) => mk("zone", 140 + i * 260, 110, { w: 240, h: 420, title, color: i < 5 ? "#4dabf7" : "#f783ac" }));
    const ideas = mk("zone", 140, 570, { w: 1000, h: 300, title: t("plantillas.ideasSemana"), color: "#ffa94d" });
    const items = [...z, ideas,
      mk("text", 150, 30, { text: t("plantillas.miSemana"), rot: -1 }),
      mk("note", 165, 160, { color: "yellow", text: t("plantillas.reunion"), rot: -2 }),
      mk("note", 685, 160, { color: "blue", text: t("plantillas.informe"), rot: 2, pin: pinC("#1c7ed6") }),
      mk("note", 1465, 160, { color: "pink", text: t("plantillas.paseo"), rot: -1, pin: pinC("#ae3ec9") }),
      mk("note", 170, 620, { color: "orange", text: t("plantillas.receta"), rot: 1, pin: pinC("#f59f00") }),
      mk("list", 1200, 600, { w: 260, title: t("plantillas.pendientes"), pin: pinC("#2f9e44"), tasks: [{ text: t("plantillas.regalo"), done: false }, { text: t("plantillas.dentista"), done: false }, { text: t("plantillas.facturas"), done: true }] }),
    ];
    return { items, threads: [] };
  }

  const TEMPLATES = {
    blank: () => [newSheet(t("editor.hojaN", { n: 1 }))],
    kanban: () => [newSheet(t("plantillas.tablero"), { color: "blue", surface: "grid", ...kanbanItems() })],
    semana: () => [newSheet(t("tableros.plantillas.semana"), { color: "green", surface: "grid", ...semanaItems() })],
    detective() {
      const p1 = mk("photo", 160, 120, { w: 170, h: 160, art: "person", caption: t("plantillas.sospechosoA"), rot: -4 });
      const p2 = mk("photo", 540, 90, { w: 170, h: 160, art: "person", caption: t("plantillas.sospechosoB"), rot: 3, pin: pinC("#1c7ed6") });
      const p3 = mk("photo", 900, 140, { w: 170, h: 160, art: "person", caption: t("plantillas.testigo"), rot: -2, pin: pinC("#2f9e44") });
      const m = mk("photo", 470, 440, { w: 260, h: 170, art: "map", caption: t("plantillas.lugar"), rot: 2, pin: pinC("#f59f00") });
      const n1 = mk("note", 170, 470, { color: "yellow", text: t("plantillas.dondeEstaba"), rot: -3 });
      const n2 = mk("note", 900, 460, { color: "pink", text: t("plantillas.coartada"), rot: 3, pin: pinC("#ae3ec9") });
      const c = mk("card", 1150, 120, { w: 220, title: t("plantillas.cronologia"), text: t("plantillas.cronologiaTexto"), rot: 1.5, pin: pinC("#343a40") });
      const st = mk("stamp", 760, 50, { text: t("plantillas.sospechoso"), color: "#e03131", rot: -12, s: .8 });
      return [newSheet(t("plantillas.caso"), { color: "pink", surface: "cork", items: [p1, p2, p3, m, n1, n2, c, st],
        threads: [th(p1, p2, { label: t("plantillas.complice") }), th(p1, n1), th(p2, m), th(p3, m), th(p3, n2), th(n2, c), th(m, n1)] })];
    },
    moodboard() {
      const z = mk("zone", 130, 90, { w: 900, h: 600, title: t("plantillas.estilo"), color: "#9775fa" });
      const items = [z,
        mk("photo", 170, 150, { w: 260, h: 200, art: "sunset", frame: "none", fix: "tape", rot: -2 }),
        mk("photo", 480, 140, { art: "sea", caption: t("plantillas.calma"), rot: 3, pin: pinC("#1c7ed6") }),
        mk("photo", 740, 160, { w: 240, h: 300, art: "city", frame: "none", fix: "tape", rot: 1 }),
        mk("photo", 200, 410, { art: "tree", caption: t("plantillas.natural"), rot: -3, pin: pinC("#2f9e44") }),
        mk("note", 500, 460, { color: "purple", text: t("plantillas.calido"), rot: 2, pin: pinC("#ae3ec9") }),
        mk("card", 1080, 140, { w: 220, title: t("plantillas.paleta"), text: t("plantillas.paletaTexto"), pin: pinC("#343a40") }),
        mk("sticker", 1000, 520, { emoji: "🎨", rot: 10 }),
      ];
      return [newSheet(t("tableros.plantillas.moodboard"), { color: "purple", surface: "dots", items }), newSheet(t("plantillas.tipografia"), { color: "blue" })];
    },
    viaje() {
      const d1 = mk("zone", 140, 110, { w: 440, h: 460, title: t("plantillas.dia1"), color: "#f783ac" });
      const d2 = mk("zone", 620, 110, { w: 440, h: 460, title: t("plantillas.dia2"), color: "#69db7c" });
      const a = mk("note", 170, 170, { color: "yellow", text: t("plantillas.fushimi"), rot: -2 });
      const b = mk("photo", 360, 300, { w: 180, h: 150, art: "sunset", caption: t("plantillas.torii"), rot: 4, pin: pinC("#1c7ed6") });
      const c = mk("note", 650, 170, { color: "green", text: t("plantillas.ciervos"), rot: 2, pin: pinC("#2f9e44") });
      const d = mk("note", 820, 330, { color: "blue", text: t("plantillas.tren"), rot: -2, pin: pinC("#1c7ed6") });
      const lugares = [
        mk("link", 160, 120, linkData("https://www.japan-guide.com/e/e3915.html")),
        mk("link", 480, 150, { ...linkData("https://maps.google.com/kyoto-nara"), rot: 2, pin: pinC("#1c7ed6") }),
        mk("photo", 820, 120, { art: "tree", caption: t("plantillas.arashiyama"), rot: -3, pin: pinC("#2f9e44") }),
      ];
      const eq = [
        mk("list", 160, 120, { title: t("plantillas.equipaje"), tasks: [{ text: t("plantillas.pasaporte"), done: true }, { text: t("plantillas.adaptador"), done: false }, { text: t("plantillas.jrPass"), done: false }, { text: t("plantillas.paraguas"), done: false }] }),
        mk("list", 480, 140, { title: t("plantillas.antesDeSalir"), rot: 2, pin: pinC("#1c7ed6"), tasks: [{ text: t("plantillas.banco"), done: true }, { text: t("plantillas.seguro"), done: false }] }),
      ];
      return [
        newSheet(t("plantillas.itinerario"), { color: "pink", surface: "cork", items: [d1, d2, a, b, c, d], threads: [th(a, b)] }),
        newSheet(t("plantillas.lugares"), { color: "green", items: lugares }),
        newSheet(t("plantillas.equipaje"), { color: "blue", items: eq }),
      ];
    },
  };

  function demoSheets() {
    const t1 = mk("text", 160, 30, { text: t("plantillas.demo.titulo"), rot: -2 });
    const z1 = mk("zone", 150, 120, { w: 660, h: 340, title: t("plantillas.demo.idea"), color: "#4dabf7" });
    const n1 = mk("note", 190, 160, { color: "yellow", rot: -3, text: t("plantillas.demo.n1") });
    const p1 = mk("photo", 520, 150, { rot: 4, art: "sunset", caption: t("plantillas.demo.inspiracion"), pin: pinC("#1c7ed6") });
    const c1 = mk("list", 880, 160, { rot: -1.5, title: t("plantillas.porHacer"), pin: pinC("#2f9e44"), tasks: [
      { text: t("plantillas.demo.t1"), done: true }, { text: t("plantillas.demo.t2"), done: false }, { text: t("plantillas.demo.t3"), done: false }, { text: t("plantillas.demo.t4"), done: false }] });
    const n2 = mk("note", 240, 520, { color: "blue", rot: 2, text: t("plantillas.demo.n2"), pin: pinC("#f59f00") });
    const p2 = mk("photo", 560, 510, { rot: -5, art: "tree", caption: t("plantillas.demo.cinta"), fix: "tape" });
    const n3 = mk("note", 900, 520, { color: "pink", rot: -2, text: t("plantillas.demo.n3"), pin: pinC("#ae3ec9") });
    const f1 = mk("card", 1150, 300, { rot: 1.5, w: 230, title: t("plantillas.demo.principios"), text: t("plantillas.demo.principiosTexto"), pin: pinC("#1c7ed6") });
    const s1 = mk("sticker", 780, 50, { emoji: "💡", rot: 12 });
    const s2 = mk("stamp", 1180, 110, { text: t("editor.urgente"), color: "#e03131", rot: -10 });
    const s3 = mk("sticker", 440, 660, { emoji: "⭐", rot: -8 });
    const d1 = mk("draw", 1100, 150, { w: 90, h: 80, vw: 90, vh: 80, d: "M85 6 Q 60 60 8 70 M22 58 L8 70 L25 76", color: "#e03131", sw: 3 });
    const ideas = newSheet(t("editor.ideasGenerales"), { color: "yellow", items: [z1, t1, n1, p1, c1, n2, p2, n3, f1, s1, s2, s3, d1],
      threads: [th(n1, p1), th(p1, c1), th(n1, n2), th(c1, n3, { label: t("plantillas.demo.decidir") })] });

    const l1 = mk("link", 160, 120, { ...linkData("https://www.pinterest.com/ideas/corkboard-ideas"), rot: -2 });
    const l2 = mk("link", 480, 140, { ...linkData("https://dribbble.com/shots/moodboard-app"), rot: 2, pin: pinC("#1c7ed6") });
    const fl1 = mk("file", 160, 440, { name: t("plantillas.demo.brief"), ext: "pdf", size: t("plantillas.demo.tamano"), rot: 1, pin: pinC("#2f9e44") });
    const fl2 = mk("file", 480, 460, { name: t("plantillas.demo.presupuesto"), ext: "xlsx", size: "48 KB", rot: -2 });
    const pc = mk("photo", 820, 140, { art: "city", caption: t("plantillas.demo.nocturna"), rot: 3, pin: pinC("#ae3ec9") });
    const nr = mk("note", 820, 460, { color: "orange", text: t("plantillas.demo.revisar"), rot: -2, pin: pinC("#f59f00") });
    const refs = newSheet(t("plantillas.demo.referencias"), { color: "blue", items: [l1, l2, fl1, fl2, pc, nr], threads: [th(l1, nr), th(fl1, l1)] });

    return [ideas, refs, newSheet(t("plantillas.demo.roadmap"), { color: "green", surface: "grid", ...kanbanItems() }), newSheet(t("plantillas.demo.bugs"), { color: "pink" })];
  }

  /* ---------- Estado: abrir el tablero o crearlo desde una plantilla ---------- */
  TEMPLATES.demo = demoSheets;
  const params = new URLSearchParams(location.search);
  const lib = Store.library();

  // Resumen para la tarjeta del tablero en la pantalla de Tableros: elementos (miniatura) e hilos entre sus chinches
  function computePreview(sh) {
    if (!sh?.items?.length) return { items: [], threads: [] };
    const est = o => ({
      w: o.type === "stamp" ? ((o.text || "").length * 11 + 36) * (o.s || 1)
        : SCALED.has(o.type) ? (o.type === "text" ? Math.max(3, (o.text || "").length) * 26 : 70) * (o.s || 1) : o.w || 200,
      h: o.type === "photo" ? o.h + (o.frame === "polaroid" ? 60 : 20) : o.type === "stamp" ? 44 * (o.s || 1) : SCALED.has(o.type) ? 64 * (o.s || 1) : o.h || 150,
    });
    const rank = o => (o.type === "zone" ? -1e6 : 0) + o.z;
    const rs = [...sh.items].sort((a, b) => rank(a) - rank(b)).slice(-24).map(o => ({ o, ...est(o) }));
    const x0 = Math.min(...rs.map(r => r.o.x)), y0 = Math.min(...rs.map(r => r.o.y));
    const bw = Math.max(...rs.map(r => r.o.x + r.w)) - x0 || 1, bh = Math.max(...rs.map(r => r.o.y + r.h)) - y0 || 1;
    // s: fracción del ancho por unidad del tablero; en vertical se multiplica por A (proporción ancho/alto de la miniatura)
    const A = 1.8, s = Math.min(1 / bw, 1 / (bh * A)), ox = (1 - bw * s) / 2, oy = (1 - bh * s * A) / 2;
    const r3 = n => Math.round(n * 1000) / 1000;
    const nx = x => r3(ox + (x - x0) * s), ny = y => r3(oy + (y - y0) * s * A);
    const pinned = o => o.fix === "pin" && o.pin;
    const items = rs.map(({ o, w, h }) => ({
      t: o.type, x: nx(o.x), y: ny(o.y), w: r3(w * s), h: r3(h * s * A), r: o.rot || 0,
      c: o.type === "sticker" ? "#fab005" : o.color, pin: o.fix === "pin", pc: o.pin?.color,
      ...(pinned(o) && { px: r3(o.pin.x), py: r3(o.pin.y) }),
    }));
    // Hilos: mismos extremos (chinche girada con el elemento) y misma curva que drawThreads, en coordenadas de la miniatura
    const byIdP = new Map(rs.map(r => [r.o.id, r]));
    const pinAt = ({ o, w, h }) => {
      const lx = o.pin.x * w - w / 2, ly = o.pin.y * h - h / 2;
      const a = (o.rot || 0) * Math.PI / 180, c = Math.cos(a), si = Math.sin(a);
      return { x: o.x + w / 2 + lx * c - ly * si, y: o.y + h / 2 + lx * si + ly * c };
    };
    const threads = (sh.threads || []).flatMap(t => {
      const ra = byIdP.get(t.a), rb = byIdP.get(t.b);
      if (!ra || !rb || !pinned(ra.o) || !pinned(rb.o)) return [];
      const a = pinAt(ra), b = pinAt(rb);
      const sag = Math.min(140, Math.hypot(b.x - a.x, b.y - a.y) * .16) * (t.sag ?? 1);
      return [{ a: [nx(a.x), ny(a.y)], m: [nx((a.x + b.x) / 2), ny((a.y + b.y) / 2 + sag)], b: [nx(b.x), ny(b.y)], c: t.color || "", ac: ra.o.pin.color, bc: rb.o.pin.color }];
    });
    return { items, threads };
  }
  function boardMeta(d) {
    const items = d.sheets.flatMap(s => s.items), pv = computePreview(d.sheets[0]);
    return { sheets: d.sheets.length, items: items.length, hasImages: items.some(o => o.type === "photo" && (o.src || o.art)), surface: d.sheets[0]?.surface || "dots", preview: pv.items, previewThreads: pv.threads };
  }
  function createBoard(tpl, name, group, surface) {
    const sheets = (TEMPLATES[tpl] || TEMPLATES.blank)();
    if (surface) sheets.forEach(s => s.surface = surface);
    const id = Store.uid(), d = { name, sheets, active: 0 };
    lib.boards.push({ id, name, group: Store.group(group) ? group : lib.groups[0]?.id, fav: false, createdAt: Date.now(), updatedAt: Date.now(), ...boardMeta(d) });
    Store.saveBoard(id, d);
    Store.saveLibrary();
    return { id, d };
  }

  let boardId = params.get("board");
  let loaded = boardId && Store.loadBoard(boardId);
  if (boardId && !loaded) { location.replace("01-tableros.html"); return; }
  if (!loaded) {
    if (params.get("demo")) createBoard("demo", t("plantillas.demo.nombre"), params.get("group"));
    const c = createBoard(params.get("template") || "demo", params.get("name") || (params.get("template") ? t("tableros.sinTitulo") : t("editor.ideasGenerales")), params.get("group"), params.get("surface"));
    boardId = c.id; loaded = c.d;
    history.replaceState(null, "", "?board=" + boardId);
  }
  const doc = { name: Store.board(boardId)?.name || loaded.name, sheets: loaded.sheets, active: loaded.active || 0 };
  setPref("lastBoardId", boardId);

  let view = { x: 40, y: 20, z: 1 };
  let tool = "select", toolLocked = false, selection = [], selThread = null, editing = null, drag = null;
  let spaceDown = false, mouseInside = false, lastMouse = { x: 0, y: 0 };
  let pendingSticker = null, stickerReplace = null, threadFrom = null, internalClip = null;
  let createStreak = { type: null, n: 0 }, lastNudge = 0;
  const drawOpts = { color: "#e03131", sw: 3, erase: null };
  const myStickers = lib.stickers;
  const undoStack = [], redoStack = [];

  const sheet = () => doc.sheets[doc.active];
  const byId = id => sheet().items.find(i => i.id === id);
  const els = new Map(); // id → { el, html }: los nodos de la hoja actual (ver render)
  const elOf = id => els.get(id)?.el || null;
  const linkedCount = it => sheet().threads.filter(t => t.a === it.id || t.b === it.id).length;

  function recalcZ() {
    const all = doc.sheets.flatMap(s => s.items);
    const z = all.filter(i => i.type !== "zone").map(i => i.z), zz = all.filter(i => i.type === "zone").map(i => i.z);
    zTop = Math.max(0, ...z); zBottom = Math.min(0, ...z);
    zZoneTop = Math.max(0, ...zz); zZoneBottom = Math.min(0, ...zz);
    uid = Math.max(uid, ...doc.sheets.flatMap(s => [s, ...s.items, ...s.threads]).map(o => +String(o.id).slice(1) || 0)) + 1;
  }

  function toWorld(e) {
    const r = viewport.getBoundingClientRect();
    return { x: (e.clientX - r.left - view.x) / view.z, y: (e.clientY - r.top - view.y) / view.z };
  }
  // Ancho y alto del lienzo que se ve: sin la parte que tapa el panel del asistente, si está abierto
  // «left»: lo que tapa la barra de herramientas a la izquierda (en ventanas angostas va abajo y no cuenta)
  function visibleSize() {
    const p = $("#aiPanel"), v = viewport.getBoundingClientRect(), tb = $(".toolbar")?.getBoundingClientRect();
    const cut = p && !p.hidden ? Math.max(0, v.right - p.getBoundingClientRect().left + 12) : 0;
    const left = tb && tb.height > tb.width ? Math.max(0, tb.right - v.left + 8) : 0;
    return { w: Math.max(200, viewport.clientWidth - cut), h: viewport.clientHeight, left: Math.min(left, 120) };
  }
  function viewCenter() {
    const { w, h, left } = visibleSize();
    return { x: ((left + w) / 2 - view.x) / view.z, y: (h / 2 - view.y) / view.z };
  }
  function itemRect(it) {
    const el = elOf(it.id);
    return { x: it.x, y: it.y, w: el?.offsetWidth || 0, h: el?.offsetHeight || 0 };
  }

  /* ---------- Historial y guardado ---------- */
  const snapshot = () => JSON.stringify({ name: doc.name, sheets: doc.sheets, active: doc.active });
  function checkpoint() {
    undoStack.push(snapshot());
    if (undoStack.length > 200) undoStack.shift();
    redoStack.length = 0;
    updateUndoButtons();
  }
  function restore(s) {
    const d = JSON.parse(s);
    doc.name = d.name; doc.sheets = d.sheets; doc.active = d.active;
    selection = []; selThread = null;
    recalcZ(); renderAll(); saved();
  }
  function undo() {
    stopEdit();
    if (!undoStack.length) return toast(t("editor.msg.nadaDeshacer"));
    redoStack.push(snapshot()); restore(undoStack.pop()); updateUndoButtons();
    announce(t("ia.deshecho"));
  }
  function redo() {
    stopEdit();
    if (!redoStack.length) return toast(t("editor.msg.nadaRehacer"));
    undoStack.push(snapshot()); restore(redoStack.pop()); updateUndoButtons();
    announce(t("editor.msg.rehecho"));
  }
  function updateUndoButtons() {
    $("#undoBtn").disabled = !undoStack.length;
    $("#redoBtn").disabled = !redoStack.length;
  }

  // Guardado automático: cada cambio programa una escritura a disco (agrupando ráfagas de cambios)
  let saveTimer, persistTimer = null;
  function saved() {
    const s = $("#save");
    s.classList.add("saving"); s.querySelector("span").textContent = t("editor.guardando");
    clearTimeout(saveTimer);
    clearTimeout(persistTimer);
    persistTimer = setTimeout(persist, 400);
  }
  function persist(touch = true) {
    clearTimeout(persistTimer);
    persistTimer = null;
    sheet().view = { ...view };
    const d = { name: doc.name, sheets: doc.sheets, active: doc.active };
    Store.saveBoard(boardId, d);
    if (touch) Store.touch(boardId, { name: doc.name, updatedAt: Date.now(), ...boardMeta(d) });
    const s = $("#save");
    saveTimer = setTimeout(() => { s.classList.remove("saving"); s.querySelector("span").textContent = t("ajustes.guardado"); }, 200);
  }
  // Al salir se guarda lo pendiente y la posición de la vista de cada hoja
  window.addEventListener("beforeunload", () => persist(persistTimer !== null));
  function mutate(fn) { checkpoint(); fn(); render(); saved(); }

  /* ---------- Render ---------- */
  // En el lienzo las fotos guardadas usan su miniatura (ver thumbFile en main/store.js); el visor usa la original
  const thumb = src => src.replace(/^chinchero-media:\/\/media\//, "chinchero-media://thumbs/");
  function itemHTML(it) {
    const fix = it.fix === "pin" ? `<span class="pin" style="left:${esc(it.pin.x * 100)}%;top:${esc(it.pin.y * 100)}%;--pin:${esc(it.pin.color)}" title="${t("editor.lienzo.chinche")}"></span>`
      : it.fix === "tape" ? '<span class="tape"></span>' : "";
    switch (it.type) {
      case "note": return fix + `<div class="txt" data-edit="text" data-rich data-ph="${t("editor.lienzo.escribeAqui")}">${it.text}</div>`;
      case "card": return fix + `<div class="card-title" data-edit="title">${esc(it.title)}</div><div class="txt" data-edit="text" data-rich data-ph="${t("editor.lienzo.escribeAqui")}">${it.text}</div>`;
      case "list": {
        const done = it.tasks.filter(t => t.done).length;
        return fix + `<div class="list-head"><span data-edit="title">${esc(it.title)}</span><span class="prog">${done}/${it.tasks.length}</span></div>
          <ul>${it.tasks.map((task, i) => `<li class="${task.done ? "done" : ""}"><input type="checkbox" data-i="${i}" ${task.done ? "checked" : ""} aria-label="${esc(t("editor.lienzo.completar", { task: task.text }))}"><span class="task" data-edit="task" data-i="${i}" data-rich data-ph="${t("editor.lienzo.nuevaTarea")}">${task.html || esc(task.text)}</span></li>`).join("")}</ul>
          <button class="add-task">+ ${t("editor.lienzo.anadirTarea")}</button>`;
      }
      case "text": return fix + `<div class="txt" data-edit="text">${esc(it.text)}</div>`;
      case "photo": {
        const media = it.src ? `<img src="${esc(thumb(it.src))}" alt="" decoding="async">` : it.art ? ART[it.art] : `<div class="ph-empty">${t("editor.lienzo.fotoVacia")}</div>`;
        return fix + `<div class="img ${esc(it.fit)}" style="height:${esc(it.h)}px">${media}</div>` + (it.frame === "polaroid" ? `<div class="caption" data-edit="caption">${esc(it.caption)}</div>` : "");
      }
      case "link": return fix + `<div class="lp" style="--g:${esc(it.grad)}">${esc(it.domain.charAt(0).toUpperCase())}</div><div class="lb"><div class="lt" data-edit="title">${esc(it.title)}</div><div class="lu">🔗 ${esc(it.domain)}</div></div>`;
      case "file": return fix + `<div class="fi" style="--fc:${esc(FILE_COLORS[it.ext] || "#868e96")}">${esc(it.ext.toUpperCase() || "?")}</div><div><div class="fn">${esc(it.name)}</div><div class="fm">${esc(it.size)} · ${t("editor.lienzo.dobleClicAbrir")}</div></div>`;
      case "sticker": return it.img ? `<img src="${esc(it.img)}" alt="">` : esc(it.emoji);
      case "stamp": return `<span class="badge" data-edit="text" style="--b:${esc(it.color)}">${esc(it.text)}</span>`;
      case "zone": return `<div class="zt" data-edit="title">${esc(it.title)}</div>`;
      case "draw": return `<svg viewBox="0 0 ${esc(it.vw)} ${esc(it.vh)}" preserveAspectRatio="none"><path class="dh" d="${esc(it.d)}"/><path d="${esc(it.d)}" stroke="${esc(it.color)}" stroke-width="${esc(it.sw)}"/></svg>`;
    }
    return "";
  }

  function styleItem(el, it) {
    el.style.left = it.x + "px";
    el.style.top = it.y + "px";
    el.style.setProperty("--rot", it.rot + "deg");
    el.style.zIndex = it.type === "zone" ? it.z : 1000 + it.z;
    if (!SCALED.has(it.type)) el.style.width = it.w + "px";
    if (["note", "card", "list"].includes(it.type)) el.style.minHeight = it.h + "px";
    if (it.type === "zone" || it.type === "draw") el.style.height = it.h + "px";
    if (SCALED.has(it.type)) el.style.setProperty("--s", it.s);
    if (it.type === "note") { el.style.setProperty("--c", NOTE_COLORS[it.color]); el.style.setProperty("--fs", FS[it.fs]); }
    // Fichas y listas: tamaño de todo el texto (s, m, l) con data-fs, para no mover las rayas del papel
    if (it.type === "card" || it.type === "list") el.dataset.fs = it.fs === "s" || it.fs === "l" ? it.fs : "m";
    if (it.type === "text") el.style.setProperty("--ink", it.ink || "var(--text)");
    if (it.type === "zone") el.style.setProperty("--zc", it.color);
  }

  // Render incremental: cada elemento recuerda el HTML con que se dibujó y solo se reconstruye si cambia.
  // Clases y estilos (posición, giro, tamaño) se aplican siempre: es barato y no toca el contenido.
  function render() {
    const items = sheet().items, seen = new Set();
    let prev = null;
    for (const it of items) {
      const html = itemHTML(it) + (it.locked ? '<span class="lock-ico" aria-hidden="true">🔒</span>' : "");
      let c = els.get(it.id);
      if (!c) {
        c = { el: document.createElement("div"), html: null };
        c.el.dataset.id = it.id;
        els.set(it.id, c);
      }
      if (c.html !== html) { c.el.innerHTML = html; c.html = html; }
      else c.el.querySelector(":scope > .handles")?.remove(); // applySelection las vuelve a poner
      c.el.className = `item t-${it.type}${it.frame === "none" ? " noframe" : ""}${it.locked ? " locked" : ""}`;
      styleItem(c.el, it);
      // El orden del DOM sigue al del modelo; solo se mueve lo que no está en su sitio
      const at = prev ? prev.nextSibling : itemsEl.firstChild;
      if (at !== c.el) itemsEl.insertBefore(c.el, at);
      prev = c.el;
      seen.add(it.id);
    }
    for (const [id, c] of els) if (!seen.has(id)) { c.el.remove(); els.delete(id); }
    applySelection();
    $("#canvasEmpty").classList.toggle("show", !sheet().items.length);
    drawMinimap();
  }

  function renderAll() {
    applySurface(); render(); renderSheets();
    $("#boardName").textContent = doc.name;
    document.title = `${doc.name} — Chinchero`;
  }

  /* ---------- Selección ---------- */
  function setSel(ids) { selection = ids; selThread = null; applySelection(); }
  function toggleSel(id) {
    const unit = expand([id]);
    setSel(selection.includes(id) ? selection.filter(x => !unit.includes(x)) : [...new Set([...selection, ...unit])]);
  }
  function selectThread(id) { stopEdit(); selection = []; selThread = id; applySelection(); }

  function handlesHTML(it) {
    const hs = SCALED.has(it.type) ? ["se"] : ["nw", "ne", "sw", "se"];
    // .rz: zonas invisibles justo fuera de cada esquina; al pasar el ratón el cursor indica giro
    const rz = it.type === "zone" ? "" : ["nw", "ne", "sw", "se"].map(c => `<span class="rz" data-c="${c}" title="${t("editor.lienzo.girar")}"></span>`).join("");
    return `<div class="handles">${rz}${hs.map(h => `<span class="h" data-h="${h}" title="${t(it.type === "photo" ? "editor.lienzo.tamanoLibre" : "editor.lienzo.tamanoProporcional")}"></span>`).join("")}</div>`;
  }

  // Grupos: los elementos con el mismo `group` se seleccionan y mueven juntos (Ctrl+clic elige uno solo)
  function expand(ids) {
    const groups = new Set(ids.map(id => byId(id)?.group).filter(Boolean));
    if (!groups.size) return ids;
    return [...new Set([...ids, ...sheet().items.filter(o => groups.has(o.group)).map(o => o.id)])];
  }
  // Devuelve el id del grupo si la selección es exactamente un grupo completo
  function selGroup() {
    const its = selection.map(byId).filter(Boolean), g = its[0]?.group;
    return g && its.length > 1 && its.every(o => o.group === g) && sheet().items.filter(o => o.group === g).length === its.length ? g : null;
  }
  function drawGroupBox() {
    const box = $("#groupBox"), g = selGroup();
    if (!g || editing) { box.style.display = "none"; return; }
    const vr = viewport.getBoundingClientRect();
    const rs = selection.map(id => elOf(id).getBoundingClientRect());
    const toW = (x, y) => ({ x: (x - vr.left - view.x) / view.z, y: (y - vr.top - view.y) / view.z });
    const a = toW(Math.min(...rs.map(r => r.left)), Math.min(...rs.map(r => r.top)));
    const b = toW(Math.max(...rs.map(r => r.right)), Math.max(...rs.map(r => r.bottom)));
    const pad = 10;
    Object.assign(box.style, { display: "block", left: a.x - pad + "px", top: a.y - pad + "px", width: b.x - a.x + pad * 2 + "px", height: b.y - a.y + pad * 2 + "px" });
    box.querySelector("span").textContent = `Grupo · ${selection.length}`;
  }

  function applySelection() {
    $$(".item.sel", itemsEl).forEach(e => { e.classList.remove("sel", "multi", "grp"); e.querySelector(".handles")?.remove(); });
    selection = selection.filter(byId);
    const g = selGroup();
    for (const id of selection) {
      const el = elOf(id);
      el.classList.add("sel");
      if (selection.length > 1) el.classList.add(g ? "grp" : "multi");
    }
    if (selection.length === 1 && !editing) {
      const it = byId(selection[0]);
      if (!it.locked) elOf(it.id).insertAdjacentHTML("beforeend", handlesHTML(it));
    }
    drawGroupBox();
    drawThreads();
    buildCtx();
    if (selection.length > 1 && !g) checkTips("multi");
  }

  /* ---------- Hilos ---------- */
  function pinWorld(it) {
    const el = elOf(it.id);
    if (!el || it.fix !== "pin") return null;
    const w = el.offsetWidth, h = el.offsetHeight;
    const lx = it.pin.x * w - w / 2, ly = it.pin.y * h - h / 2;
    const a = it.rot * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    return { x: it.x + w / 2 + lx * c - ly * s, y: it.y + h / 2 + lx * s + ly * c, color: it.pin.color };
  }
  function curve(a, b, k = 1) {
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const sag = Math.min(140, Math.hypot(b.x - a.x, b.y - a.y) * .16) * k;
    return { d: `M${a.x} ${a.y} Q${mx} ${my + sag} ${b.x} ${b.y}`, mid: { x: (a.x + 2 * mx + b.x) / 4, y: (a.y + 2 * (my + sag) + b.y) / 4 } };
  }
  const pinHead = p => `<g filter="url(#pinShadow)"><circle cx="${esc(p.x)}" cy="${esc(p.y)}" r="8" fill="${esc(p.color)}"/><circle cx="${esc(p.x)}" cy="${esc(p.y)}" r="8" fill="url(#pinShine)"/></g>`;
  function labelSVG(m, text) {
    const w = text.length * 7 + 20;
    return `<g class="tl" transform="translate(${esc(m.x)} ${esc(m.y)})"><rect x="${-w / 2}" y="-12" width="${w}" height="24" rx="5"/><text text-anchor="middle" dy="4">${esc(text)}</text></g>`;
  }

  function drawThreads(preview) {
    const sh = sheet();
    sh.threads = sh.threads.filter(t => byId(t.a)?.fix === "pin" && byId(t.b)?.fix === "pin");
    const related = new Set(selection);
    const out = [], heads = new Map();
    for (const t of sh.threads) {
      const a = pinWorld(byId(t.a)), b = pinWorld(byId(t.b));
      if (!a || !b) continue;
      const { d, mid } = curve(a, b, t.sag ?? 1);
      const hl = t.id === selThread || related.has(t.a) || related.has(t.b);
      out.push(["t" + t.id, `<g class="th${hl ? " hl" : ""}${t.id === selThread ? " sel" : ""}" data-t="${esc(t.id)}">
        <path d="${esc(d)}" class="sh" transform="translate(1.5 4)"/><path d="${esc(d)}" class="ln" style="stroke:${esc(t.color || "var(--thread)")}"/><path d="${esc(d)}" class="hit"/>
        ${t.label ? labelSVG(mid, t.label) : ""}</g>`]);
      heads.set(t.a, a); heads.set(t.b, b);
    }
    if (preview?.a) {
      out.push(["pv", `<path d="${curve(preview.a, preview.b).d}" class="pv"/>`]);
      heads.set("_", preview.a);
    }
    for (const [id, p] of heads) out.push(["h" + id, pinHead(p)]);
    patchSvg(threadLayer, out, svgEls);
  }

  // Como render() pero para el SVG de hilos: solo se rehacen los nodos cuyo marcado cambió.
  // Reemplazar todo el SVG (que cubre la hoja entera) obligaba a repintarlo completo en cada movimiento.
  const svgEls = new Map(); // clave → { el, html }
  function patchSvg(parent, entries, cache) {
    const seen = new Set();
    let prev = null;
    for (const [key, html] of entries) {
      let c = cache.get(key);
      if (!c || c.html !== html) {
        const tmp = document.createElementNS("http://www.w3.org/2000/svg", "g");
        tmp.innerHTML = html;
        const el = tmp.firstElementChild;
        if (c) c.el.replaceWith(el);
        c = { el, html };
        cache.set(key, c);
      }
      const at = prev ? prev.nextSibling : parent.firstChild;
      if (at !== c.el) parent.insertBefore(c.el, at);
      prev = c.el;
      seen.add(key);
    }
    for (const [key, c] of cache) if (!seen.has(key)) { c.el.remove(); cache.delete(key); }
  }

  function addThread(a, b) {
    const sh = sheet();
    if (sh.threads.some(t => (t.a === a.id && t.b === b.id) || (t.a === b.id && t.b === a.id))) {
      toast(t("editor.msg.yaUnidos"));
      drawThreads();
      return;
    }
    checkpoint();
    sh.threads.push(th(a, b));
    drawThreads(); saved();
    announce(t("editor.msg.hiloCreado", { a: describe(a), b: describe(b) }));
    Tour.emit("thread");
  }

  // Herramienta Hilo: el primer elemento elegido (clic, o Tab y Enter) es el origen y el segundo el otro extremo
  function threadPick(it, byKey) {
    if (it.fix !== "pin") return noPinMsg(it);
    if (!threadFrom) {
      threadFrom = it; elOf(it.id).classList.add("thread-target");
      if (byKey) announce(t("editor.msg.hiloDesde", { item: describe(it) }));
      return;
    }
    if (it !== threadFrom) addThread(threadFrom, it);
    elOf(threadFrom.id)?.classList.remove("thread-target");
    threadFrom = null;
    drawThreads();
  }

  function noPinMsg(it) {
    toast(SCALED.has(it.type) && it.type !== "text" || it.type === "zone" || it.type === "draw"
      ? t("editor.msg.sinChincheTipo", { type: TYPE_NAMES[it.type] })
      : t("editor.msg.sinChinche"));
  }

  /* ---------- Vista ---------- */
  function applyView() {
    world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.z})`;
    world.style.setProperty("--inv", (1 / view.z).toFixed(3));
    viewport.style.setProperty("--bz", view.z); // el fondo (puntos, cuadrícula, corcho) escala con el zoom vía CSS
    viewport.classList.toggle("far", view.z < .45); // de lejos, sombras simples (ver editor.css)
    viewport.style.backgroundPosition = `${view.x}px ${view.y}px`;
    $("#zoomLabel").textContent = Math.round(view.z * 100) + "%";
    placeCtx(); placeFmt(); drawMinimap();
    if (view.z < .5) checkTips("zoom");
  }
  function zoomAt(cx, cy, z) {
    z = clamp(z, .2, 3);
    const wx = (cx - view.x) / view.z, wy = (cy - view.y) / view.z;
    view = { x: cx - wx * z, y: cy - wy * z, z };
    applyView();
  }
  const zoomBy = f => zoomAt(viewport.clientWidth / 2, viewport.clientHeight / 2, view.z * f);
  function fit() {
    const rs = sheet().items.map(itemRect);
    if (!rs.length) { view = { x: 40, y: 20, z: 1 }; return applyView(); }
    const x0 = Math.min(...rs.map(r => r.x)) - 60, y0 = Math.min(...rs.map(r => r.y)) - 60;
    const x1 = Math.max(...rs.map(r => r.x + r.w)) + 60, y1 = Math.max(...rs.map(r => r.y + r.h)) + 60;
    const W = viewport.clientWidth, H = viewport.clientHeight;
    const z = clamp(Math.min(W / (x1 - x0), H / (y1 - y0)), .2, 1.5);
    view = { z, x: (W - (x1 - x0) * z) / 2 - x0 * z, y: (H - (y1 - y0) * z) / 2 - y0 * z };
    applyView();
  }
  // Vista al entrar a una hoja: la guardada si muestra algún elemento; si no, se encuadran todos (sin pasar del 100 %)
  function enterView() {
    view = sheet().view ? { ...sheet().view } : { x: 40, y: 20, z: 1 };
    const rs = sheet().items.map(itemRect);
    if (!rs.length) return applyView();
    const { w, h, left } = visibleSize(), m = 60;
    const seen = rs.some(r => r.x * view.z + view.x < w && (r.x + r.w) * view.z + view.x > left && r.y * view.z + view.y < h && (r.y + r.h) * view.z + view.y > 0);
    if (!seen) {
      const x0 = Math.min(...rs.map(r => r.x)), y0 = Math.min(...rs.map(r => r.y));
      const x1 = Math.max(...rs.map(r => r.x + r.w)), y1 = Math.max(...rs.map(r => r.y + r.h));
      const z = clamp(Math.min(1, (w - left - 2 * m) / (x1 - x0 || 1), (h - 2 * m) / (y1 - y0 || 1)), .2, 1);
      view = { z, x: (left + w) / 2 - (x0 + x1) / 2 * z, y: h / 2 - (y0 + y1) / 2 * z };
    }
    applyView();
  }
  function centerOn(it) {
    const r = itemRect(it), { w, h, left } = visibleSize();
    view.x = (left + w) / 2 - (r.x + r.w / 2) * view.z;
    view.y = h / 2 - (r.y + r.h / 2) * view.z;
    applyView();
  }
  // Si algo de estos elementos queda fuera de lo que se ve (o debajo del panel del asistente), se centra la vista en
  // todos ellos, alejando el zoom si no entran
  function showItems(its) {
    const rs = its.map(itemRect), { w, h, left } = visibleSize(), m = 40;
    const x0 = Math.min(...rs.map(r => r.x)), y0 = Math.min(...rs.map(r => r.y));
    const x1 = Math.max(...rs.map(r => r.x + r.w)), y1 = Math.max(...rs.map(r => r.y + r.h));
    const inside = x0 * view.z + view.x >= left && y0 * view.z + view.y >= 0 && x1 * view.z + view.x <= w && y1 * view.z + view.y <= h;
    if (inside) return;
    const z = clamp(Math.min(view.z, (w - left - 2 * m) / (x1 - x0 || 1), (h - 2 * m) / (y1 - y0 || 1)), .2, 3);
    view = { z, x: (left + w) / 2 - (x0 + x1) / 2 * z, y: h / 2 - (y0 + y1) / 2 * z };
    applyView();
  }
  function applySurface() {
    const s = sheet().surface;
    viewport.className = viewport.className.replace(/\bsurface-\w+/g, "").trim() + " surface-" + s;
    $$("#surfaces button").forEach(b => { b.classList.toggle("active", b.dataset.s === s); b.setAttribute("aria-pressed", b.dataset.s === s); });
    applyView();
  }

  /* ---------- Arrastres (listeners en window: no se usa pointer capture, así el doble clic llega al elemento) ---------- */
  function beginDrag(d) {
    drag = d;
    window.addEventListener("pointermove", onDragMove);
    window.addEventListener("pointerup", onDragEnd);
    window.addEventListener("pointercancel", onDragEnd);
  }
  function onDragMove(e) { drag?.move?.(e); }
  function onDragEnd(e) {
    window.removeEventListener("pointermove", onDragMove);
    window.removeEventListener("pointerup", onDragEnd);
    window.removeEventListener("pointercancel", onDragEnd);
    const d = drag; drag = null;
    d?.up?.(e);
  }

  viewport.addEventListener("pointerdown", e => {
    if (e.button === 2) return;
    let tEl = e.target;
    // Los extremos de un hilo tapan la chinche: la chinche tiene prioridad para poder tender más hilos
    if (tEl.closest("#threads")) tEl = document.elementsFromPoint(e.clientX, e.clientY).find(x => x.classList?.contains("pin")) || tEl;
    // El recuadro de un grupo seleccionado está por encima: se mira qué hay debajo
    const onGroupBox = !!tEl.closest("#groupBox");
    if (onGroupBox) tEl = document.elementsFromPoint(e.clientX, e.clientY).find(x => x.closest?.(".item")) || tEl;
    // Un clic dentro del elemento que se edita (en su borde o debajo del texto) no corta la edición ni lo mueve:
    // en otro campo del mismo elemento (otra tarea, el título) pasa a editar ese; si no, deja el cursor donde se pueda
    if (editing && !editing.el.contains(tEl) && tEl.closest(".item") === elOf(editing.it.id) && !(editing.it.type === "zone" && !tEl.closest(".zt")) && !tEl.matches("input, .pin") && !tEl.closest(".add-task")) {
      e.preventDefault();
      const f = tEl.closest("[data-edit]");
      if (f) return edit(editing.it, f, { x: e.clientX, y: e.clientY });
      const r = document.caretRangeFromPoint?.(e.clientX, e.clientY);
      if (r && editing.el.contains(r.startContainer)) { const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); }
      return;
    }
    const ended = editing && !editing.el.contains(tEl) ? editing.it : null;
    if (ended) stopEdit();
    if (tEl.isContentEditable || tEl.matches("input")) return;
    $(".inpop")?.remove();
    stickerPop.classList.remove("open");
    const pt = toWorld(e);
    if (e.button === 1 || spaceDown) return startPan(e);

    const tg = tEl.closest("#threads .th");
    if (tg && tool === "select") return selectThread(tg.dataset.t);

    const itemEl = tEl.closest(".item");
    const it = itemEl && byId(itemEl.dataset.id);
    if (tEl.classList.contains("h")) return startResize(e, it, tEl.dataset.h);
    if (tEl.classList.contains("rz")) return startRotate(e, it);
    if (tEl.closest(".add-task")) { e.preventDefault(); return addTask(it); }
    if (tEl.classList.contains("pin") && (tool === "select" || tool === "thread") && !it.locked)
      return e.shiftKey ? startPinMove(e, it) : startThreadDrag(e, it);

    if (tool === "thread") return it && threadPick(it);
    if (tool === "draw") return drawOpts.erase ? startErase(e) : startDraw(e);
    if (tool === "zone") return startZoneDraw(e);
    // preventDefault: evita que el foco vuelva al lienzo y corte la edición del elemento recién creado
    if (CREATE.has(tool)) { e.preventDefault(); return create(tool, pt, e); }

    // Arrastrar dentro del recuadro de un grupo mueve el grupo entero (Ctrl+clic elige el elemento de debajo)
    if (onGroupBox && !(e.ctrlKey && it)) return startMove(e, it && selection.includes(it.id) ? it : byId(selection[0]));
    // Fondo (o el interior de una zona no seleccionada): arrastrar mueve el lienzo; Shift+arrastrar selecciona varios
    // (el clic que termina de editar el título de una zona tampoco la mueve)
    const onCanvas = !it || (it.type === "zone" && !tEl.closest(".zt") && (!selection.includes(it.id) || it === ended));
    if (onCanvas) return e.shiftKey ? startBand(e) : startPan(e, true);
    startMove(e, it);
  });

  viewport.addEventListener("pointermove", e => {
    lastMouse = toWorld(e);
    if (drag) return;
    if (tool === "sticker" && pendingSticker) {
      ghost.style.display = "block";
      ghost.style.left = e.clientX + "px"; ghost.style.top = e.clientY + "px";
    }
    if (tool === "thread" && threadFrom) drawThreads({ a: pinWorld(threadFrom), b: lastMouse });
  });
  viewport.addEventListener("pointerenter", () => mouseInside = true);
  viewport.addEventListener("pointerleave", () => { mouseInside = false; ghost.style.display = "none"; });

  // clearOnClick: un clic sin arrastrar sobre el fondo deselecciona
  function startPan(e, clearOnClick) {
    e.preventDefault();
    const sx = e.clientX, sy = e.clientY, ox = view.x, oy = view.y;
    let moved = false;
    beginDrag({
      move: ev => {
        if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 3) return;
        if (!moved) { moved = true; viewport.classList.add("panning"); hideCtx(); }
        view.x = ox + ev.clientX - sx; view.y = oy + ev.clientY - sy;
        applyView();
      },
      up: () => {
        viewport.classList.remove("panning");
        if (moved) { buildCtx(); Tour.emit("pan"); checkTips("pan"); }
        else if (clearOnClick) { document.activeElement?.blur?.(); if (selection.length || selThread) setSel([]); }
      },
    });
  }

  function collectMovers() {
    const ids = new Set(selection.filter(id => !byId(id).locked));
    for (const id of [...ids]) {
      const z = byId(id);
      if (z.type !== "zone") continue;
      for (const o of sheet().items) {
        if (o.type === "zone" || o.locked) continue;
        const r = itemRect(o), cx = r.x + r.w / 2, cy = r.y + r.h / 2;
        if (cx > z.x && cx < z.x + z.w && cy > z.y && cy < z.y + z.h) ids.add(o.id);
      }
    }
    for (const id of selection) {
      const o = byId(id);
      if (o.type !== "zone" && !o.locked) { o.z = ++zTop; elOf(id).style.zIndex = 1000 + o.z; }
    }
    return [...ids].map(id => { const o = byId(id); return { o, x: o.x, y: o.y }; });
  }

  function startMove(e, it) {
    const shift = e.shiftKey, wasSel = selection.includes(it.id);
    const unit = e.ctrlKey ? [it.id] : expand([it.id]);
    if (shift) toggleSel(it.id);
    else if (!wasSel || (e.ctrlKey && selection.length > 1)) setSel(unit);
    if (!selection.includes(it.id)) return;
    const sx = e.clientX, sy = e.clientY;
    let movers = null, moved = false;
    beginDrag({
      move: ev => {
        if (!moved) {
          if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 4) return;
          moved = true;
          checkpoint();
          if (e.altKey) pasteItems(buildClip(), null, true, 0);
          movers = collectMovers();
          if (!movers.length) { undoStack.pop(); updateUndoButtons(); toast(t("editor.msg.bloqueadoMover")); moved = "blocked"; }
          hideCtx();
        }
        if (moved === "blocked") return;
        const dx = (ev.clientX - sx) / view.z, dy = (ev.clientY - sy) / view.z;
        for (const m of movers) {
          m.o.x = Math.round(m.x + dx); m.o.y = Math.round(m.y + dy);
          const el = elOf(m.o.id);
          el.style.left = m.o.x + "px"; el.style.top = m.o.y + "px";
        }
        drawThreads(); drawMinimap(); drawGroupBox();
      },
      up: () => {
        if (moved === true) {
          if (getPref("snap") === "1") movers.forEach(m => { m.o.x = Math.round(m.o.x / 22) * 22; m.o.y = Math.round(m.o.y / 22) * 22; });
          render(); saved();
          announce(movedMsg(movers.length));
          Sound.play("paper");
          Tour.emit("move");
        } else if (!moved && !shift && wasSel && selection.length > unit.length) setSel(unit);
        else buildCtx();
      },
    });
  }

  function setBand(x0, y0, x1, y1) {
    Object.assign(band.style, { display: "block", left: Math.min(x0, x1) + "px", top: Math.min(y0, y1) + "px", width: Math.abs(x1 - x0) + "px", height: Math.abs(y1 - y0) + "px" });
  }

  function startBand(e) {
    const base = e.shiftKey ? [...selection] : [];
    if (!e.shiftKey && (selection.length || selThread)) setSel([]);
    const sx = e.clientX, sy = e.clientY;
    let active = false;
    beginDrag({
      move: ev => {
        if (!active && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 5) return;
        active = true;
        setBand(sx, sy, ev.clientX, ev.clientY);
        const l = Math.min(sx, ev.clientX), r = Math.max(sx, ev.clientX), t = Math.min(sy, ev.clientY), b = Math.max(sy, ev.clientY);
        const hits = sheet().items.filter(o => {
          const rr = elOf(o.id).getBoundingClientRect();
          return o.type === "zone"
            ? rr.left >= l && rr.right <= r && rr.top >= t && rr.bottom <= b
            : rr.left < r && rr.right > l && rr.top < b && rr.bottom > t;
        }).map(o => o.id);
        selection = expand([...new Set([...base, ...hits])]);
        selThread = null;
        applySelection();
      },
      up: () => {
        band.style.display = "none";
        if (active) checkTips();
      },
    });
  }

  function startResize(e, it, h) {
    e.stopPropagation();
    const el = elOf(it.id);
    const w0 = el.offsetWidth, h0 = it.type === "photo" ? it.h : el.offsetHeight, H0 = el.offsetHeight;
    const s0 = it.s, a = it.rot * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    const sxS = h.includes("e") ? 1 : -1, syS = h.includes("s") ? 1 : -1;
    const cx0 = it.x + w0 / 2, cy0 = it.y + H0 / 2, ratio = w0 / h0;
    const start = toWorld(e);
    checkpoint();
    beginDrag({
      move: ev => {
        const p = toWorld(ev), dxw = p.x - start.x, dyw = p.y - start.y;
        const dx = dxw * c + dyw * s, dy = -dxw * s + dyw * c;
        if (SCALED.has(it.type)) {
          it.s = Math.round(clamp(s0 * (w0 + dx) / w0, .3, 5) * 100) / 100;
          el.style.setProperty("--s", it.s);
        } else {
          let nw = Math.max(it.type === "zone" ? 160 : 70, w0 + sxS * dx);
          let nh = Math.max(it.type === "zone" ? 100 : 40, h0 + syS * dy);
          if ((it.type === "photo") !== ev.shiftKey) nh = nw / ratio;
          const dwc = (nw - w0) / 2 * sxS, dhc = (nh - h0) / 2 * syS;
          const ncx = cx0 + dwc * c - dhc * s, ncy = cy0 + dwc * s + dhc * c;
          it.w = Math.round(nw); it.h = Math.round(nh);
          if (it.type === "photo") el.querySelector(".img").style.height = it.h + "px";
          styleItem(el, it);
          it.x = Math.round(ncx - it.w / 2); it.y = Math.round(ncy - el.offsetHeight / 2);
          el.style.left = it.x + "px"; el.style.top = it.y + "px";
        }
        drawThreads(); placeCtx();
      },
      up: () => { render(); saved(); Tour.emit("resize"); },
    });
  }

  // Giro relativo: el elemento gira lo mismo que el puntero alrededor de su centro, sin saltos al agarrar
  function startRotate(e, it) {
    e.stopPropagation();
    const el = elOf(it.id);
    const cx = it.x + el.offsetWidth / 2, cy = it.y + el.offsetHeight / 2;
    const angle = p => Math.atan2(p.y - cy, p.x - cx) * 180 / Math.PI;
    const a0 = angle(toWorld(e)), rot0 = it.rot;
    viewport.classList.add("rotating");
    checkpoint();
    beginDrag({
      move: ev => {
        let a = rot0 + angle(toWorld(ev)) - a0;
        if (ev.shiftKey) a = Math.round(a / 15) * 15;
        it.rot = Math.round((((a + 540) % 360) - 180) * 10) / 10;
        el.style.setProperty("--rot", it.rot + "deg");
        drawThreads(); placeCtx();
      },
      up: () => { viewport.classList.remove("rotating"); render(); saved(); Tour.emit("rotate"); },
    });
  }

  function startPinMove(e, it) {
    e.stopPropagation();
    const el = elOf(it.id), w = el.offsetWidth, h = el.offsetHeight;
    const cx = it.x + w / 2, cy = it.y + h / 2, a = -it.rot * Math.PI / 180;
    checkpoint();
    beginDrag({
      move: ev => {
        const p = toWorld(ev), dx = p.x - cx, dy = p.y - cy;
        const lx = dx * Math.cos(a) - dy * Math.sin(a), ly = dx * Math.sin(a) + dy * Math.cos(a);
        it.pin.x = Math.round(clamp((lx + w / 2) / w, .04, .96) * 1000) / 1000;
        it.pin.y = Math.round(clamp((ly + h / 2) / h, .02, .96) * 1000) / 1000;
        const pe = el.querySelector(".pin");
        pe.style.left = it.pin.x * 100 + "%"; pe.style.top = it.pin.y * 100 + "%";
        drawThreads();
      },
      up: () => { saved(); Tour.emit("pin-move"); },
    });
  }

  // Mira a través de los hilos (están por encima) para encontrar el elemento bajo el puntero
  function itemAt(x, y) {
    const el = document.elementsFromPoint(x, y).map(e => e.closest?.(".item")).find(Boolean);
    return el && byId(el.dataset.id);
  }

  function startThreadDrag(e, it) {
    e.stopPropagation();
    e.preventDefault();
    const sx = e.clientX, sy = e.clientY;
    let active = false;
    const clearTargets = () => $$(".thread-target", itemsEl).forEach(x => x.classList.remove("thread-target"));
    beginDrag({
      move: ev => {
        if (!active && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 5) return;
        active = true;
        hideCtx();
        const over = itemAt(ev.clientX, ev.clientY);
        const target = over && over !== it && over.fix === "pin" ? over : null;
        clearTargets();
        elOf(it.id).classList.add("thread-target");
        if (target) elOf(target.id).classList.add("thread-target");
        drawThreads({ a: pinWorld(it), b: target ? pinWorld(target) : toWorld(ev) });
      },
      up: ev => {
        clearTargets();
        if (!active) { setSel([it.id]); return; }
        const over = itemAt(ev.clientX, ev.clientY);
        if (over && over !== it) over.fix === "pin" ? addThread(it, over) : noPinMsg(over);
        else if (!over) toast(t("editor.msg.sueltaHilo"));
        drawThreads(); buildCtx();
      },
    });
  }

  /* ---------- Dibujo y zonas ---------- */
  function smoothPath(p) {
    const f = n => Math.round(n * 10) / 10;
    if (p.length < 3) return `M${f(p[0].x)} ${f(p[0].y)} L${f(p.at(-1).x)} ${f(p.at(-1).y)}`;
    let d = `M${f(p[0].x)} ${f(p[0].y)}`;
    for (let i = 1; i < p.length - 1; i++) d += ` Q${f(p[i].x)} ${f(p[i].y)} ${f((p[i].x + p[i + 1].x) / 2)} ${f((p[i].y + p[i + 1].y) / 2)}`;
    return d + ` L${f(p.at(-1).x)} ${f(p.at(-1).y)}`;
  }

  // Los trazos seguidos con el mismo color y grosor se suman al mismo dibujo (un dibujo = una sesión de la herramienta),
  // así un boceto de muchos trazos se selecciona y mueve como una sola pieza.
  let drawSession = null;
  function startDraw(e) {
    const pts = [toWorld(e)];
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.style.stroke = drawOpts.color;
    path.style.strokeWidth = drawOpts.sw;
    drawTmp.appendChild(path);
    beginDrag({
      move: ev => {
        const p = toWorld(ev), last = pts.at(-1);
        if (Math.hypot(p.x - last.x, p.y - last.y) < 1.5 / view.z) return;
        pts.push(p);
        path.setAttribute("d", smoothPath(pts));
      },
      up: () => {
        path.remove();
        if (pts.length < 3) return;
        let it = drawSession && byId(drawSession.id);
        const sameSession = it && it.strokes && drawSession.color === drawOpts.color && drawSession.sw === drawOpts.sw
          && it.w === it.vw && it.h === it.vh && !it.rot && it.x === drawSession.x && it.y === drawSession.y;
        if (!sameSession) it = null;
        const all = [...(it ? it.strokes.map(s => s.map(p => ({ x: p.x + it.x, y: p.y + it.y }))) : []), pts];
        const flat = all.flat(), pad = drawOpts.sw + 4, r1 = n => Math.round(n * 10) / 10;
        const x0 = Math.round(Math.min(...flat.map(p => p.x)) - pad), y0 = Math.round(Math.min(...flat.map(p => p.y)) - pad);
        const w = Math.round(Math.max(...flat.map(p => p.x)) - x0 + pad), h = Math.round(Math.max(...flat.map(p => p.y)) - y0 + pad);
        const strokes = all.map(s => s.map(p => ({ x: r1(p.x - x0), y: r1(p.y - y0) })));
        const data = { x: x0, y: y0, w, h, vw: w, vh: h, strokes, d: strokes.map(smoothPath).join(" ") };
        checkpoint();
        if (it) Object.assign(it, data);
        else { it = mk("draw", x0, y0, { ...data, color: drawOpts.color, sw: drawOpts.sw }); sheet().items.push(it); }
        drawSession = { id: it.id, color: drawOpts.color, sw: drawOpts.sw, x: it.x, y: it.y };
        render(); saved();
        Tour.emit("create:draw");
      },
    });
  }

  // Goma: al pasar por encima borra la parte de los trazos que toca («part») o el trazo entero («stroke»).
  // Los dibujos sin `strokes` (solo `d`, como los de las plantillas) se pasan a puntos recorriendo cada subtrazo.
  function startErase(e) {
    const r = 9 / view.z, step = r / 2; // radio de la goma en el mundo: 9 px en pantalla
    const dense = new Map(), touched = new Set();
    let changed = false, last = toWorld(e);
    // Del mundo al viewBox del dibujo: deshace el giro (alrededor del centro) y el estirado
    const local = (it, p) => {
      const a = -(it.rot || 0) * Math.PI / 180, dx = p.x - it.x - it.w / 2, dy = p.y - it.y - it.h / 2;
      return { x: (dx * Math.cos(a) - dy * Math.sin(a) + it.w / 2) * it.vw / it.w, y: (dx * Math.sin(a) + dy * Math.cos(a) + it.h / 2) * it.vh / it.h };
    };
    // Puntos cada `gap` como mucho, para no saltarse un trazo hecho con el ratón rápido
    const densify = (s, gap) => s.flatMap((p, i) => {
      if (!i) return [p];
      const q = s[i - 1], n = Math.ceil(Math.hypot(p.x - q.x, p.y - q.y) / gap);
      return Array.from({ length: n }, (_, k) => ({ x: q.x + (p.x - q.x) * (k + 1) / n, y: q.y + (p.y - q.y) * (k + 1) / n }));
    });
    // `d` antiguo → trazos de puntos cada 2 unidades (un subtrazo por cada M); null si no se puede medir
    const legacy = new Map();
    const fromD = it => {
      if (legacy.has(it.id)) return legacy.get(it.id);
      const svg = elOf(it.id)?.querySelector("svg");
      let out = null;
      if (svg && it.d) {
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        svg.append(path);
        out = it.d.split(/(?=M)/).map(sub => {
          path.setAttribute("d", sub);
          const len = path.getTotalLength(), n = Math.max(1, Math.ceil(len / 2));
          return Array.from({ length: n + 1 }, (_, k) => { const p = path.getPointAtLength(len * k / n); return { x: p.x, y: p.y }; });
        }).filter(st => st.length > 1);
        path.remove();
      }
      legacy.set(it.id, out?.length ? out : null);
      return legacy.get(it.id);
    };
    const eraseAt = p => {
      for (const it of [...sheet().items]) {
        if (it.type !== "draw" || it.locked) continue;
        const m = Math.hypot(it.w, it.h) / 2 + r;
        if (Math.abs(p.x - it.x - it.w / 2) > m || Math.abs(p.y - it.y - it.h / 2) > m) continue;
        const q = local(it, p), rx = r * it.vw / it.w + it.sw / 2, ry = r * it.vh / it.h + it.sw / 2;
        const hit = s => ((s.x - q.x) / rx) ** 2 + ((s.y - q.y) / ry) ** 2 <= 1;
        let strokes = null;
        const base = it.strokes || fromD(it);
        if (base) {
          if (!dense.has(it.id)) dense.set(it.id, base.map(s => densify(s, Math.min(rx, ry) / 2)));
          const all = dense.get(it.id);
          if (!all.some(s => s.some(hit))) continue;
          strokes = erase.mode === "stroke" ? all.filter(s => !s.some(hit))
            : all.flatMap(s => s.reduce((runs, pt) => { if (hit(pt)) runs.push([]); else runs.at(-1).push(pt); return runs; }, [[]]))
              .filter(s => s.length > 1);
        } else if (!elOf(it.id)?.querySelector(".dh")?.isPointInStroke(new DOMPoint(q.x, q.y))) continue;
        if (!changed) { checkpoint(); changed = true; }
        if (strokes?.length) {
          dense.set(it.id, strokes);
          it.strokes = strokes.map(s => s.map(pt => ({ x: Math.round(pt.x * 10) / 10, y: Math.round(pt.y * 10) / 10 })));
          it.d = it.strokes.map(smoothPath).join(" ");
          touched.add(it.id);
        } else {
          sheet().items = sheet().items.filter(o => o !== it);
          sheet().threads = sheet().threads.filter(t => t.a !== it.id && t.b !== it.id);
          setSel(selection.filter(id => id !== it.id));
        }
      }
    };
    const erase = { mode: drawOpts.erase };
    eraseAt(last);
    render();
    beginDrag({
      move: ev => {
        const p = toWorld(ev), n = Math.ceil(Math.hypot(p.x - last.x, p.y - last.y) / step);
        for (let k = 1; k <= n; k++) eraseAt({ x: last.x + (p.x - last.x) * k / n, y: last.y + (p.y - last.y) * k / n });
        last = p;
        render();
      },
      up: () => {
        if (!changed) return;
        // Ajusta el recuadro a lo que queda (si el dibujo no está girado ni estirado)
        for (const id of touched) {
          const it = byId(id);
          if (!it || it.rot || it.w !== it.vw || it.h !== it.vh) continue;
          const flat = it.strokes.flat(), pad = it.sw + 4;
          const x0 = Math.min(...flat.map(p => p.x)) - pad, y0 = Math.min(...flat.map(p => p.y)) - pad;
          const dx = Math.round(x0), dy = Math.round(y0);
          it.strokes = it.strokes.map(s => s.map(p => ({ x: Math.round((p.x - dx) * 10) / 10, y: Math.round((p.y - dy) * 10) / 10 })));
          it.x += dx; it.y += dy;
          it.w = it.vw = Math.round(Math.max(...flat.map(p => p.x)) - dx + pad);
          it.h = it.vh = Math.round(Math.max(...flat.map(p => p.y)) - dy + pad);
          it.d = it.strokes.map(smoothPath).join(" ");
        }
        drawSession = null;
        render(); saved();
        announce(t("editor.msg.trazosBorrados"));
      },
    });
  }
  function setEraser(mode) {
    drawOpts.erase = mode;
    $$("[data-de]", drawPop).forEach(x => { x.classList.toggle("on", x.dataset.de === mode); x.setAttribute("aria-pressed", x.dataset.de === mode); });
    $$("[data-dc], [data-dw]", drawPop).forEach(x => x.classList.toggle("off", !!mode));
    viewport.classList.toggle("erasing", tool === "draw" && !!mode);
    showHint();
  }

  function startZoneDraw(e) {
    const p0 = toWorld(e), sx = e.clientX, sy = e.clientY;
    let active = false;
    band.classList.add("zone");
    beginDrag({
      move: ev => {
        if (!active && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 6) return;
        active = true;
        setBand(sx, sy, ev.clientX, ev.clientY);
      },
      up: ev => {
        band.style.display = "none"; band.classList.remove("zone");
        let z;
        if (!active) z = add(mk("zone", 0, 0), p0);
        else {
          const p1 = toWorld(ev);
          z = add(mk("zone", 0, 0, { w: Math.round(Math.max(160, Math.abs(p1.x - p0.x))), h: Math.round(Math.max(100, Math.abs(p1.y - p0.y))) }), { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 });
        }
        edit(z, null, null, { continues: true });
        done("zone");
      },
    });
  }

  /* ---------- Crear elementos ---------- */
  function add(it, pt) {
    checkpoint();
    const tilt = getPref("tilt") !== "0";
    if (it.type === "sticker" || it.type === "stamp") it.rot = tilt ? rand(-14, 14) : 0;
    else if (it.type !== "zone" && it.type !== "draw") it.rot = tilt ? rand(-3.5, 3.5) : 0;
    it.pin.color = getPref("lastPin") || "#e03131";
    sheet().items.push(it);
    render();
    const el = elOf(it.id);
    it.x = Math.round(pt.x - el.offsetWidth / 2);
    it.y = Math.round(pt.y - el.offsetHeight / 2);
    if (getPref("snap") === "1") { it.x = Math.round(it.x / 22) * 22; it.y = Math.round(it.y / 22) * 22; }
    styleItem(el, it);
    setSel([it.id]);
    saved();
    announce(t("editor.msg.anadido", { type: TYPE_NAMES[it.type] }));
    if (it.type !== "zone" && it.type !== "draw") Sound.play(it.fix || "paper");
    Tour.emit("create:" + it.type);
    setTimeout(() => checkTips(), 300);
    return it;
  }

  function done(kind) {
    createStreak = createStreak.type === kind ? { type: kind, n: createStreak.n + 1 } : { type: kind, n: 1 };
    if (createStreak.n >= 3 && !toolLocked) checkTips("repeat");
    if (!toolLocked && tool !== "select") setTool("select");
  }

  function create(kind, pt, ev) {
    if (kind === "image") { const it = add(mk("photo", 0, 0), pt); pickImage(it); return done(kind); }
    if (kind === "file") { pickFiles("", true, files => addFiles(files, pt)); return done(kind); }
    if (kind === "link") {
      inputPop(ev.clientX, ev.clientY, "", t("editor.msg.direccionWeb"), url => {
        if (url) add(mk("link", 0, 0, linkData(url)), pt);
        done("link");
      });
      return;
    }
    if (kind === "zone") { edit(add(mk("zone", 0, 0), pt), null, null, { continues: true }); return done(kind); }
    if (kind === "sticker") {
      if (!pendingSticker) return openStickers();
      const it = add(mk(pendingSticker.type, 0, 0, { ...pendingSticker.o }), pt);
      if (pendingSticker.custom) edit(it, null, null, { continues: true });
      if (!toolLocked) { pendingSticker = null; ghost.style.display = "none"; }
      return done("sticker");
    }
    const it = add(mk(kind, 0, 0), pt);
    edit(it, kind === "list" ? taskEl(it, 0) : null, null, { continues: true });
    done(kind);
  }

  function createCenter(kind) {
    const c = viewCenter(), r = viewport.getBoundingClientRect();
    create(kind, c, { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 });
  }

  /* ---------- Imágenes y archivos ---------- */
  function pickFiles(accept, multiple, cb) {
    const input = Object.assign(document.createElement("input"), { type: "file", accept, multiple });
    input.onchange = () => cb([...input.files]);
    input.click();
  }
  function fillPhoto(it, f) {
    it.src = URL.createObjectURL(f);
    // Se muestra al instante y se copia a la carpeta de datos; al terminar, la foto apunta a la copia
    Store.importFile(f).then(url => { it.src = url; if (byId(it.id)) render(); saved(); })
      .catch(() => toast(t("editor.msg.noSeGuardoImagen")));
    it.art = "";
    it.caption = f.name.replace(/\.[^.]+$/, "").slice(0, 28) || t("atajos.acciones.tool_image");
    const img = new Image();
    img.onload = () => {
      it.h = Math.round(clamp(it.w * img.naturalHeight / img.naturalWidth, 80, 420));
      if (byId(it.id)) { render(); }
    };
    img.src = it.src;
    setTimeout(() => checkTips("photo"), 400);
  }
  function pickImage(it) {
    pickFiles("image/*", false, ([f]) => {
      if (!f) return;
      checkpoint(); fillPhoto(it, f); render(); saved();
    });
  }
  function fileData(f) {
    const ext = (f.name.includes(".") ? f.name.split(".").pop() : "").toLowerCase().slice(0, 4);
    const kb = f.size / 1024;
    return { name: f.name, ext, size: kb > 1024 ? (kb / 1024).toFixed(1).replace(".", ",") + " MB" : Math.max(1, Math.round(kb)) + " KB" };
  }
  function addFiles(files, pt, over, bare) {
    const imgs = files.filter(f => f.type.startsWith("image/")), others = files.filter(f => !f.type.startsWith("image/"));
    if (over?.type === "photo" && imgs.length) {
      checkpoint(); fillPhoto(over, imgs.shift()); render(); saved();
      toast("Imagen colocada en la foto");
    }
    imgs.forEach((f, k) => { const it = mk("photo", 0, 0, bare ? { frame: "none" } : {}); fillPhoto(it, f); add(it, { x: pt.x + k * 40, y: pt.y + k * 30 }); });
    others.forEach((f, k) => {
      const it = add(mk("file", 0, 0, fileData(f)), { x: pt.x + k * 30, y: pt.y + (imgs.length ? 220 : 0) + k * 30 });
      Store.importFile(f).then(url => { it.src = url; saved(); }).catch(() => toast(t("editor.msg.noSeGuardo", { name: f.name })));
    });
  }
  const openLink = it => Store.native ? Store.desktop("openExternal", it.url) : window.open(it.url, "_blank", "noopener");
  const openFile = it => it.src ? Store.desktop("openMedia", it.src) : toast("Este archivo no tiene una copia guardada");
  function editUrl(it, x, y) {
    inputPop(x, y, it.url, "Dirección web", url => { if (url) mutate(() => Object.assign(it, linkData(url))); });
  }

  let dragDepth = 0;
  viewport.addEventListener("dragenter", e => {
    if (e.dataTransfer.types.includes(STICKER_MIME) || !e.dataTransfer.types.some(t => t === "Files" || t === "text/uri-list" || t === "text/plain")) return;
    dragDepth++;
    $("#dropzone").classList.add("show");
  });
  viewport.addEventListener("dragleave", () => { if (--dragDepth <= 0) { dragDepth = 0; $("#dropzone").classList.remove("show"); } });
  viewport.addEventListener("dragover", e => {
    e.preventDefault();
    const over = itemAt(e.clientX, e.clientY);
    $$(".drop-target", itemsEl).forEach(x => x.classList.remove("drop-target"));
    if (over?.type === "photo") elOf(over.id).classList.add("drop-target");
  });
  viewport.addEventListener("drop", e => {
    e.preventDefault();
    dragDepth = 0;
    $("#dropzone").classList.remove("show");
    $$(".drop-target", itemsEl).forEach(x => x.classList.remove("drop-target"));
    const pt = toWorld(e), over = itemAt(e.clientX, e.clientY);
    if (e.dataTransfer.types.includes(STICKER_MIME)) {
      const spec = JSON.parse(e.dataTransfer.getData(STICKER_MIME));
      stickerPop.classList.remove("open");
      const it = add(mk(spec.type, 0, 0, { ...spec.o }), pt);
      if (spec.custom) edit(it, null, null, { continues: true });
      return;
    }
    const files = [...e.dataTransfer.files];
    if (files.length && files.every(f => /\.chinchero$/i.test(f.name))) return importBoards(files);
    if (files.length) return addFiles(files, pt, over);
    const text = (e.dataTransfer.getData("text/uri-list") || e.dataTransfer.getData("text/plain")).split("\n")[0].trim();
    if (!text) return;
    if (isImageUrl(text) || /^(blob|data):/.test(text)) {
      if (over?.type === "photo") return mutate(() => { over.src = text; over.art = ""; });
      add(mk("photo", 0, 0, { src: text, caption: "Imagen web" }), pt);
    } else if (isUrl(text)) add(mk("link", 0, 0, linkData(text)), pt);
    else add(mk("note", 0, 0, { text: esc(text) }), pt);
  });

  /* ---------- Copiar, cortar, pegar, duplicar ---------- */
  function buildClip() {
    const ids = new Set(selection);
    return {
      items: selection.map(byId).filter(Boolean).map(o => JSON.parse(JSON.stringify(o))),
      threads: sheet().threads.filter(t => ids.has(t.a) && ids.has(t.b)).map(t => ({ ...t })),
    };
  }
  function pasteItems(clip, pt, noCheckpoint, offset = 30) {
    if (!clip?.items?.length) return [];
    if (!noCheckpoint) checkpoint();
    const map = {};
    const minX = Math.min(...clip.items.map(i => i.x)), minY = Math.min(...clip.items.map(i => i.y));
    const dx = pt ? pt.x - minX : offset, dy = pt ? pt.y - minY : offset;
    // Las copias forman grupos nuevos (si se copió más de un miembro); nunca se suman al grupo original
    const gCount = {}, gMap = {};
    clip.items.forEach(o => { if (o.group) gCount[o.group] = (gCount[o.group] || 0) + 1; });
    const copies = clip.items.map(o => {
      const c = JSON.parse(JSON.stringify(o));
      map[o.id] = c.id = nid();
      if (c.group) { if (gCount[c.group] > 1) c.group = gMap[c.group] ||= "g" + nid(); else delete c.group; }
      c.x = Math.round(c.x + dx); c.y = Math.round(c.y + dy);
      c.z = c.type === "zone" ? ++zZoneTop : ++zTop;
      c.locked = false;
      return c;
    });
    sheet().items.push(...copies);
    for (const t of clip.threads || []) if (map[t.a] && map[t.b]) sheet().threads.push({ ...t, id: nid(), a: map[t.a], b: map[t.b] });
    render();
    setSel(copies.map(c => c.id));
    if (!noCheckpoint) saved();
    return copies;
  }
  function duplicateSel() {
    if (!selection.length) return;
    pasteItems(buildClip(), null);
  }
  // clipFresh: lo último copiado fue un elemento del tablero y la ventana no perdió el foco desde entonces
  // (si el usuario copia algo en otra app o hace una captura, la ventana pierde el foco y gana el portapapeles del sistema)
  let clipFresh = false;
  window.addEventListener("blur", () => { clipFresh = false; });
  function remember(cut) {
    internalClip = buildClip();
    clipFresh = true;
    const n = internalClip.items.length;
    toast(t(cut ? "editor.msg.cortados" : "editor.msg.copiados", { count: n }));
  }
  function copySel() {
    if (!selection.length) return;
    remember(false);
    try { document.execCommand("copy"); } catch (e) {}
  }
  const pastePoint = () => mouseInside ? lastMouse : viewCenter();
  let pasteBare = false; // Ctrl+Shift+V: las imágenes se pegan sin marco

  function onCopy(e, cut) {
    if (editing || e.target.matches?.("input, textarea") || !selection.length) return;
    remember(cut);
    e.clipboardData.setData("text/plain", CLIP + JSON.stringify(internalClip));
    e.preventDefault();
    if (cut) deleteSel(true);
  }
  document.addEventListener("copy", e => onCopy(e, false));
  document.addEventListener("cut", e => onCopy(e, true));
  document.addEventListener("paste", e => {
    if (editing || e.target.matches?.("input, textarea") || e.target.isContentEditable) return;
    const dt = e.clipboardData, text = dt.getData("text/plain"), bare = pasteBare;
    pasteBare = false;
    e.preventDefault();
    if (text.startsWith(CLIP)) {
      try { pasteItems(JSON.parse(text.slice(CLIP.length)), pastePoint()); } catch (er) {}
      return;
    }
    if (clipFresh && internalClip) return pasteItems(internalClip, pastePoint());
    const files = [...dt.files];
    if (files.length) return addFiles(files, pastePoint(), null, bare);
    if (!text.trim()) return internalClip && pasteItems(internalClip, pastePoint());
    if (isImageUrl(text)) add(mk("photo", 0, 0, { src: text.trim(), caption: t("editor.msg.imagenWeb"), ...(bare && { frame: "none" }) }), pastePoint());
    else if (isUrl(text)) add(mk("link", 0, 0, linkData(text)), pastePoint());
    else {
      // La nota sale sin el formato del origen; si traía negrita, listas, etc., el aviso ofrece conservarlo
      const it = mk("note", 0, 0, { text: plainHtml(text.replace(/^\s*\n|\s+$/g, "")) }), html = cleanHtml(dt.getData("text/html"));
      add(it, pastePoint());
      if (/<(b|i|u|s|ul|ol)>/.test(html)) toast(t("editor.msg.notaSinFormato"), t("editor.msg.conservarFormato"), () => {
        if (!byId(it.id) || editing?.it === it) return;
        checkpoint(); it.text = html; saved(); render();
      });
    }
    checkTips("paste");
  });

  /* ---------- Edición de texto ---------- */
  const taskEl = (it, i) => elOf(it.id)?.querySelector(`.task[data-i="${i}"]`);
  const hasEdit = it => !!elOf(it.id)?.querySelector("[data-edit]");

  // opts.continues: la edición continúa un cambio que ya guardó su punto de historial (crear, añadir tarea),
  // así un solo Ctrl+Z deshace ambos. opts.before: estado previo a ese cambio (null = no comparar).
  function edit(it, fieldEl, how, opts = {}) {
    if (!it || it.locked) return;
    fieldEl = fieldEl || elOf(it.id)?.querySelector("[data-edit]");
    if (!fieldEl) return;
    stopEdit();
    // stopEdit vuelve a dibujar el elemento: si el campo era del DOM anterior, se busca el mismo en el nuevo
    if (!fieldEl.isConnected) fieldEl = fieldOf(it, fieldEl.dataset.edit, fieldEl.dataset.i);
    if (!fieldEl) return;
    if (!selection.includes(it.id) || selection.length > 1) { selection = [it.id]; selThread = null; }
    editing = { it, el: fieldEl, field: fieldEl.dataset.edit, i: fieldEl.dataset.i, before: opts.continues ? opts.before ?? null : JSON.stringify(it) };
    els.get(it.id).html = null; // al editar, el DOM ya no coincide con el HTML guardado: el próximo render lo rehace
    if (!opts.continues) checkpoint();
    applySelection();
    fieldEl.contentEditable = "true";
    fieldEl.spellcheck = false;
    fieldEl.focus();
    const sel = getSelection();
    let placed = false;
    if (how?.x != null && document.caretRangeFromPoint) {
      const r = document.caretRangeFromPoint(how.x, how.y);
      if (r && fieldEl.contains(r.startContainer)) { sel.removeAllRanges(); sel.addRange(r); placed = true; }
    }
    if (!placed && how === "end") { sel.selectAllChildren(fieldEl); if (sel.rangeCount) sel.collapseToEnd(); placed = true; }
    if (!placed) sel.selectAllChildren(fieldEl);
    fieldEl.addEventListener("blur", stopEdit, { once: true });
    fieldEl.addEventListener("keydown", onEditKey);
    fieldEl.addEventListener("input", onEditInput);
    fieldEl.addEventListener("paste", onEditPaste);
    if (fieldEl.hasAttribute("data-rich")) showFmt();
    hideCtx();
    Tour.emit("edit");
  }

  const fieldOf = (it, field, i) => elOf(it.id)?.querySelector(`[data-edit="${CSS.escape(field)}"]${i != null ? `[data-i="${CSS.escape(i)}"]` : ""}`);

  // Una tarea guarda su texto plano y, si tiene formato, también su HTML saneado (en una sola línea)
  function setTask(task, el) {
    const html = cleanHtml(el.innerHTML).replace(/<br>|<\/?(div|ul|ol|li)>/g, " ").replace(/\s+/g, " ").trim();
    task.text = plain(html).trim();
    if (/<(b|i|u|s|font)\b/.test(html)) task.html = html; else delete task.html;
  }

  function saveField(it, field, i, el) {
    if (field === "task") {
      if (!el.textContent.trim() && it.tasks.length > 1) it.tasks.splice(+i, 1);
      else if (it.tasks[+i]) setTask(it.tasks[+i], el);
      return;
    }
    const val = el.hasAttribute("data-rich") ? cleanHtml(el.innerHTML) : el.textContent.trim();
    it[field] = val || (field === "title" || it.type === "text" || it.type === "stamp" ? TYPE_NAMES[it.type] : "");
  }

  function stopEdit() {
    if (!editing) return;
    const { it, el, field, i, before } = editing;
    editing = null;
    el.removeEventListener("keydown", onEditKey);
    el.removeEventListener("input", onEditInput);
    el.removeEventListener("paste", onEditPaste);
    richPaste = null;
    el.contentEditable = "false";
    if (byId(it.id)) saveField(it, field, i, el);
    if (before !== null && JSON.stringify(it) === before) { undoStack.pop(); updateUndoButtons(); }
    else saved();
    fmt.classList.remove("open");
    getSelection().removeAllRanges();
    el.blur();
    render();
    Tour.emit("edit-end");
  }

  function onEditInput() {
    drawThreads();
    placeFmt();
  }

  // Al editar, el texto se pega sin formato (sin fuentes, colores ni bloques de código del origen) pero con sus
  // saltos y sangría. Si traía negrita, listas, etc., el botón del aviso ofrece conservarlo.
  let richPaste = null; // { html, after }: versión con formato de lo último pegado y cómo quedó el campo
  function onEditPaste(e) {
    const dt = e.clipboardData, text = dt.getData("text/plain"), el = editing.el;
    e.preventDefault();
    richPaste = null;
    if (!text || text.startsWith(CLIP)) return; // un elemento copiado de Chinchero no se pega como texto
    // Títulos y tareas: una sola línea
    if (!el.hasAttribute("data-rich") || editing.field === "task") return document.execCommand("insertText", false, text.replace(/\s*\n\s*/g, " ").trim());
    document.execCommand("insertHTML", false, plainHtml(text));
    const html = cleanHtml(dt.getData("text/html"));
    if (!/<(b|i|u|s|ul|ol)>/.test(html)) return;
    richPaste = { html, after: el.innerHTML };
    toast(t("editor.msg.pegadoSinFormato"), t("editor.msg.conservarFormato"), keepFormat);
    $(".toast button")?.addEventListener("pointerdown", ev => ev.preventDefault()); // que el clic no termine la edición
  }
  // Cambia lo recién pegado por su versión con formato, si el texto no cambió desde entonces
  function keepFormat() {
    const rp = richPaste;
    richPaste = null;
    if (!rp || !editing || editing.el.innerHTML !== rp.after) return;
    editing.el.focus();
    document.execCommand("undo");
    document.execCommand("insertHTML", false, rp.html);
    $(".toast")?.remove();
    onEditInput();
  }

  function onEditKey(e) {
    e.stopPropagation(); // las teclas de edición no deben disparar atajos globales
    const { it, el, field } = editing;
    const i = +editing.i;
    if (e.key === "Escape" || (e.key === "Enter" && e.ctrlKey)) { e.preventDefault(); el.blur(); return; }
    if (field === "task") {
      if (e.key === "Enter") {
        e.preventDefault();
        if (!el.textContent.trim()) return el.blur();
        stopEdit();
        addTask(it, i + 1);
      } else if (e.key === "Backspace" && !el.textContent) {
        e.preventDefault();
        if (it.tasks.length === 1) return;
        stopEdit();
        edit(it, i > 0 ? taskEl(it, i - 1) : elOf(it.id).querySelector('[data-edit="title"]'), "end");
      } else if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        e.preventDefault();
        const j = i + (e.key === "ArrowUp" ? -1 : 1);
        if (j < 0 || j >= it.tasks.length) return;
        setTask(it.tasks[i], el);
        stopEdit();
        checkpoint();
        [it.tasks[i], it.tasks[j]] = [it.tasks[j], it.tasks[i]];
        render();
        edit(it, taskEl(it, j), "end");
      }
      return;
    }
    if (e.key === "Enter" && !e.shiftKey && !el.hasAttribute("data-rich")) {
      e.preventDefault();
      if (it.type === "list" && field === "title") { stopEdit(); edit(it, taskEl(it, 0), "end"); }
      else el.blur();
    }
  }

  function addTask(it, at = it.tasks.length) {
    stopEdit();
    const before = JSON.stringify(it);
    checkpoint();
    it.tasks.splice(at, 0, { text: "", done: false });
    render();
    edit(it, taskEl(it, at), null, { continues: true, before });
  }

  itemsEl.addEventListener("change", e => {
    const cb = e.target.closest('input[type="checkbox"][data-i]');
    if (!cb) return;
    const it = byId(cb.closest(".item").dataset.id);
    mutate(() => { it.tasks[+cb.dataset.i].done = cb.checked; });
    if (cb.checked) Sound.play("tick");
    if (it.tasks.every(task => task.done)) toast(t("editor.msg.listaCompletada", { name: it.title }));
  });

  // Barra de formato para notas, fichas y tareas de listas. Color y tamaño se aplican a lo seleccionado con <font>
  // (execCommand) y se eligen en un panel que se abre debajo de la barra. Las tareas son de una línea: sin viñetas ni
  // alineación. Abajo, el tamaño de todo el texto del elemento
  const hexRgb = h => `rgb(${[1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)).join(", ")})`;
  function showFmt() {
    const it = editing.it, task = editing.field === "task";
    const F = k => t("editor.formato." + k);
    const fsNames = it.type === "note" ? { s: "notaPequena", m: "notaNormal", l: "notaGrande" } : { s: "tamanos.pequeno", m: "tamanos.normal", l: "tamanos.grande" };
    const fs = it.fs || "m";
    fmt.innerHTML = `<button data-f="bold" aria-label="${F("negrita")}" title="${F("negrita")}"><b>${F("letraNegrita")}</b></button>
      <button data-f="italic" aria-label="${F("cursiva")}" title="${F("cursiva")}"><i class="serif">${F("letraCursiva")}</i></button>
      <button data-f="underline" aria-label="${F("subrayado")}" title="${F("subrayado")}"><u>${F("letraSubrayado")}</u></button>
      <button data-f="strikeThrough" aria-label="${F("tachado")}" title="${F("tachado")}"><s>${F("letraTachado")}</s></button>
      <span class="sep"></span>
      <button data-pop="color" aria-label="${F("color")}" title="${F("color")}" aria-expanded="false"><span class="fmt-a">A</span></button>
      <button data-pop="size" aria-label="${F("tamano")}" title="${F("tamano")}" aria-expanded="false">Aa</button>
      ${task ? "" : `<button data-f="insertUnorderedList" title="${F("vinetas")}">• ${t("editor.tipos.list")}</button>
      <span class="sep"></span>
      ${[["justifyLeft", F("izquierda"), "M4 6h16M4 10h10M4 14h16M4 18h10"], ["justifyCenter", F("centrar"), "M4 6h16M7 10h10M4 14h16M7 18h10"], ["justifyRight", F("derecha"), "M4 6h16M10 10h10M4 14h16M10 18h10"]]
        .map(([f, n, d]) => `<button data-f="${f}" aria-label="${n}" title="${n}"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="${d}"/></svg></button>`).join("")}`}
      <span class="sep"></span>${["s", "m", "l"].map(s => `<button data-fs="${s}" class="${fs === s ? "on" : ""}" aria-pressed="${fs === s}" title="${F(it.type === "note" ? "tamanoNota" : "tamanoTodo")}">${F(fsNames[s])}</button>`).join("")}
      <span class="sep"></span><button data-done title="${F("terminar")}">${F("listo")}</button>
      <div class="fmt-pop" data-for="color" role="group" aria-label="${F("color")}" hidden>
        <button data-color="" class="swatch auto" aria-label="${F("automatico")}" title="${F("automatico")}"></button>
        ${Object.entries(TEXT_COLORS).map(([c, n]) => `<button data-color="${c}" class="swatch" style="background:${c}" aria-label="${F("colores." + n)}" title="${F("colores." + n)}"></button>`).join("")}
      </div>
      <div class="fmt-pop" data-for="size" role="group" aria-label="${F("tamano")}" hidden>
        ${Object.entries(TEXT_SIZES).map(([v, n]) => `<button data-size="${v}"><font size="${v}">${F("tamanos." + n)}</font></button>`).join("")}
      </div>`;
    fmt.classList.add("open");
    placeFmt();
    syncFmt();
  }
  // Los botones quedan marcados según el texto donde está el cursor o la selección
  function syncFmt() {
    if (!editing || !fmt.classList.contains("open")) return;
    $$("[data-f]", fmt).forEach(b => {
      const on = document.queryCommandState(b.dataset.f);
      b.classList.toggle("on", on);
      b.setAttribute("aria-pressed", on);
    });
    const color = Object.keys(TEXT_COLORS).find(c => hexRgb(c) === document.queryCommandValue("foreColor")) || "";
    // El tamaño se lee del <font> más cercano: queryCommandValue lo deduce de los px, que aquí dependen de la nota
    const node = getSelection().focusNode, f = node && editing.el.contains(node) ? (node.nodeType === 1 ? node : node.parentElement).closest("font[size]") : null;
    const size = f && editing.el.contains(f) ? f.getAttribute("size") : "3";
    $(".fmt-a", fmt).style.borderColor = color || "currentColor";
    $$("[data-color]", fmt).forEach(b => { b.classList.toggle("on", b.dataset.color === color); b.setAttribute("aria-pressed", b.dataset.color === color); });
    $$("[data-size]", fmt).forEach(b => { b.classList.toggle("on", b.dataset.size === size); b.setAttribute("aria-pressed", b.dataset.size === size); });
  }
  document.addEventListener("selectionchange", syncFmt);
  document.addEventListener("keyup", syncFmt); // Ctrl+B / Ctrl+I con el cursor sin selección no cambian la selección
  function placeFmt() {
    if (!editing || !fmt.classList.contains("open")) return;
    const r = elOf(editing.it.id)?.getBoundingClientRect();
    if (!r) return;
    fmt.style.left = clamp(r.left, 8, innerWidth - fmt.offsetWidth - 8) + "px";
    fmt.style.top = Math.max(60, r.top - fmt.offsetHeight - 14) + "px";
  }
  function togglePop(name) {
    $$(".fmt-pop", fmt).forEach(p => { p.hidden = p.dataset.for !== name || !p.hidden; });
    $$("[data-pop]", fmt).forEach(b => b.setAttribute("aria-expanded", !$(`.fmt-pop[data-for="${b.dataset.pop}"]`, fmt).hidden));
  }
  fmt.addEventListener("pointerdown", e => e.preventDefault());
  fmt.addEventListener("click", e => {
    const b = e.target.closest("button");
    if (!b || !editing) return;
    document.execCommand("styleWithCSS", false, false); // <font> y no style="…", que el saneado descartaría
    if (b.dataset.f) document.execCommand(b.dataset.f);
    if (b.dataset.pop) return togglePop(b.dataset.pop);
    // «Automático» pinta con el color propio del texto: el saneado lo quita al guardar porque no está en la paleta
    if (b.dataset.color != null) document.execCommand("foreColor", false, b.dataset.color || getComputedStyle(editing.el).color);
    if (b.dataset.size) document.execCommand("fontSize", false, b.dataset.size);
    if (b.dataset.color != null || b.dataset.size) togglePop(null);
    if (b.dataset.fs) {
      editing.it.fs = b.dataset.fs;
      if (editing.it.type === "note") elOf(editing.it.id).style.setProperty("--fs", FS[b.dataset.fs]);
      else elOf(editing.it.id).dataset.fs = b.dataset.fs;
      $$("[data-fs]", fmt).forEach(x => { x.classList.toggle("on", x === b); x.setAttribute("aria-pressed", x === b); });
    }
    if (b.hasAttribute("data-done")) return editing.el.blur();
    drawThreads(); placeFmt(); syncFmt();
  });

  /* ---------- Barra contextual ---------- */
  function sw(act, list, cur, cls = "") {
    return list.map(c => {
      const bg = act === "color" && NOTE_COLORS[c] ? NOTE_COLORS[c] : c || "transparent";
      const name = NOTE_COLORS[c] && act === "color" ? t("editor.ctx.notas." + c) : c || t("editor.formato.automatico");
      return `<button class="swatch ${cls}${c === cur ? " on" : ""}${c === "" ? " auto" : ""}" data-act="${act}" data-v="${c}" aria-pressed="${c === cur}" style="background:${bg}" aria-label="${name}" data-tip="${name}" data-tip-pos="bottom"></button>`;
    }).join("");
  }
  const seg = (act, opts, cur) => `<div class="seg" role="group">${opts.map(([v, l]) => `<button data-act="${act}" data-v="${v}" class="${String(v) === String(cur) ? "on" : ""}" aria-pressed="${String(v) === String(cur)}">${l}</button>`).join("")}</div>`;
  const icon = (act, svg, label, v) => `<button class="icon-btn" data-act="${act}"${v ? ` data-v="${v}"` : ""} aria-label="${label}" data-tip="${label}" data-tip-pos="bottom">${svg}</button>`;
  const tbtn = (act, label) => `<button class="txt-btn" data-act="${act}">${label}</button>`;

  function commonTail(its) {
    const allLocked = its.every(o => o.locked);
    const C = k => t("editor.ctx." + k);
    return icon("lock", allLocked ? ICON.lock : ICON.unlock, allLocked ? C("desbloquear") : C("bloquear"))
      + icon("dup", ICON.dup, C("duplicar")) + icon("del", ICON.trash, C("eliminar")) + icon("more", ICON.more, C("mas"));
  }

  function itemCtx(it) {
    const p = [], C = k => t("editor.ctx." + k);
    switch (it.type) {
      case "note": p.push(sw("color", Object.keys(NOTE_COLORS), it.color, "sq")); break;
      case "text": p.push(sw("ink", INK_COLORS, it.ink)); break;
      case "stamp": p.push(sw("color", STAMP_COLORS, it.color)); break;
      case "zone": p.push(sw("color", ZONE_COLORS, it.color)); break;
      case "draw": p.push(sw("color", DRAW_COLORS, it.color), seg("sw", [[2, t("editor.fino")], [4, t("editor.medio")], [8, t("editor.grueso")]], it.sw)); break;
      case "photo": p.push(seg("frame", [["polaroid", C("polaroid")], ["none", C("sinMarco")]], it.frame), seg("fit", [["cover", C("rellenar")], ["contain", C("completa")]], it.fit), tbtn("image", C("cambiarImagen"))); break;
      case "link": p.push(tbtn("open", C("abrirEnlace")) + tbtn("url", C("editarUrl"))); break;
      case "file": p.push(tbtn("open", t("barra.menu.abrir"))); break;
      case "sticker": p.push(tbtn("sticker", C("cambiarSticker"))); break;
    }
    if (PINNABLE.has(it.type)) {
      p.push(seg("fix", it.type === "text" ? [["none", C("sinFijar")], ["pin", C("chinche")]] : [["pin", C("chinche")], ["tape", C("cinta")]], it.fix || "none"));
      if (it.fix === "pin") p.push(sw("pin", PIN_COLORS, it.pin.color));
    }
    p.push(commonTail([it]));
    return p;
  }

  function multiCtx(its) {
    const g = selGroup(), C = k => t("editor.ctx." + k);
    const p = [`<span class="txt-btn" style="cursor:default">${C(g ? "grupo" : "seleccion")} · ${its.length}</span>`
      + (g ? tbtn("ungroup", t("atajos.acciones.ungroup")) : `<button class="btn btn-primary" style="padding:5px 10px;font-size:12px" data-act="group" data-tip="${t("atajos.acciones.group")} · ${Keys.label("group")}" data-tip-pos="bottom">${t("atajos.acciones.group")}</button>`)];
    if (its.every(o => o.type === "note")) p.push(sw("color", Object.keys(NOTE_COLORS), null, "sq"));
    p.push(icon("align", ICON.alignL, C("alinearIzquierda"), "left") + icon("align", ICON.alignT, C("alinearArriba"), "top")
      + icon("tidy", ICON.grid, C("cuadricula")) + icon("zone", ICON.zone, C("zonaAlrededor")));
    p.push(commonTail(its));
    return p;
  }

  function threadCtx(thr) {
    return [
      `<span class="txt-btn" style="cursor:default">${t("atajos.acciones.tool_thread")}</span>`,
      sw("tcolor", ["", ...PIN_COLORS], thr.color),
      tbtn("tlabel", t(thr.label ? "editor.ctx.editarEtiqueta" : "editor.ctx.anadirEtiqueta")),
      seg("tsag", [["0.35", t("editor.ctx.tenso")], ["1", t("ajustes.normal")], ["1.8", t("editor.ctx.flojo")]], String(thr.sag ?? 1)),
      icon("tdel", ICON.trash, t("editor.ctx.eliminarHilo")),
    ];
  }

  function buildCtx() {
    if (editing || drag || tool !== "select") return hideCtx();
    let parts = null;
    const thr = selThread && sheet().threads.find(x => x.id === selThread);
    if (thr) parts = threadCtx(thr);
    else if (selection.length > 1) parts = multiCtx(selection.map(byId));
    else if (selection.length === 1) parts = itemCtx(byId(selection[0]));
    if (!parts) return hideCtx();
    // Se rehace en cada cambio: si el foco estaba en un botón, vuelve al mismo (o a su grupo) para seguir con teclado
    const f = ctx.contains(document.activeElement) && document.activeElement.dataset;
    ctx.innerHTML = parts.map(x => `<div class="cg">${x}</div>`).join("");
    if (f?.act) (ctx.querySelector(`[data-act="${CSS.escape(f.act)}"][data-v="${CSS.escape(f.v ?? "")}"]`) || ctx.querySelector(`[data-act="${CSS.escape(f.act)}"]`))?.focus();
    ctx.classList.add("open");
    placeCtx();
  }
  const hideCtx = () => ctx.classList.remove("open");

  function placeCtx() {
    if (!ctx.classList.contains("open")) return;
    let r;
    if (selThread) r = $(`#threads [data-t="${selThread}"]`)?.getBoundingClientRect();
    else {
      const rs = selection.map(id => elOf(id)?.getBoundingClientRect()).filter(Boolean);
      if (rs.length) r = { left: Math.min(...rs.map(x => x.left)), right: Math.max(...rs.map(x => x.right)), top: Math.min(...rs.map(x => x.top)), bottom: Math.max(...rs.map(x => x.bottom)) };
    }
    if (!r) return hideCtx();
    const vr = viewport.getBoundingClientRect(), w = ctx.offsetWidth, h = ctx.offsetHeight;
    const gap = selection.length === 1 && !byId(selection[0])?.locked && byId(selection[0])?.type !== "zone" ? 48 : 16;
    let y = r.top - h - gap;
    if (y < vr.top + 8) y = r.bottom + 16;
    ctx.style.left = clamp((r.left + r.right) / 2 - w / 2, 8, innerWidth - w - 8) + "px";
    ctx.style.top = clamp(y, vr.top + 8, vr.bottom - h - 8) + "px";
  }

  ctx.addEventListener("click", e => {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    const a = b.dataset.act, v = b.dataset.v;
    const its = selection.map(byId).filter(Boolean), it = its.length === 1 ? its[0] : null;
    const thr = selThread && sheet().threads.find(x => x.id === selThread);
    const r = b.getBoundingClientRect();
    switch (a) {
      case "color": mutate(() => its.forEach(o => o.color = v)); break;
      case "ink": mutate(() => it.ink = v); break;
      case "sw": mutate(() => it.sw = +v); break;
      case "frame": mutate(() => it.frame = v); break;
      case "fit": mutate(() => it.fit = v); break;
      case "image": pickImage(it); break;
      case "open": it.type === "link" ? openLink(it) : openFile(it); break;
      case "url": editUrl(it, r.left, r.bottom); break;
      case "sticker": openStickers(it); break;
      case "fix": setFix(it, v); break;
      case "pin": mutate(() => its.forEach(o => o.pin.color = v)); setPref("lastPin", v); break;
      case "lock": toggleLock(); break;
      case "dup": duplicateSel(); break;
      case "del": case "tdel": deleteSel(); break;
      case "more": thr ? threadMenu(r.left, r.bottom + 6) : itemMenu(r.left, r.bottom + 6); break;
      case "group": groupSel(); break;
      case "ungroup": ungroupSel(); break;
      case "align": align(v); break;
      case "tidy": tidy(); break;
      case "zone": zoneAround(); break;
      case "tcolor": mutate(() => thr.color = v); break;
      case "tlabel": editThreadLabel(thr, r.left, r.bottom); break;
      case "tsag": mutate(() => thr.sag = +v); break;
    }
  });

  /* ---------- Acciones sobre la selección ---------- */
  function setFix(it, v) {
    const n = v === "pin" ? 0 : linkedCount(it);
    mutate(() => { it.fix = v === "none" ? null : v; });
    if (v !== "none") Sound.play(v);
    if (n) toast(t("editor.msg.hilosQuitados", { count: n }), t("comun.deshacer"), undo);
  }
  function groupSel() {
    const its = selection.map(byId).filter(Boolean);
    if (its.length < 2) return toast(t("editor.msg.dosParaAgrupar"));
    const g = "g" + nid();
    mutate(() => its.forEach(o => o.group = g));
    toast(t("editor.msg.agrupados"));
    Tour.emit("group");
  }
  function ungroupSel() {
    const its = selection.map(byId).filter(o => o?.group);
    if (!its.length) return;
    mutate(() => its.forEach(o => delete o.group));
    toast(t(its.length === 1 ? "editor.msg.sacadoGrupo" : "editor.msg.desagrupados"));
  }
  function toggleLock() {
    const its = selection.map(byId).filter(Boolean);
    if (!its.length) return;
    const lock = !its.every(o => o.locked);
    mutate(() => its.forEach(o => o.locked = lock));
    toast(t(lock ? "editor.msg.bloqueado" : "editor.msg.desbloqueado"));
  }
  function restack(dir) {
    mutate(() => selection.map(byId).forEach(o => {
      if (o.type === "zone") o.z = dir > 0 ? ++zZoneTop : --zZoneBottom;
      else o.z = dir > 0 ? ++zTop : --zBottom;
    }));
  }
  function align(dir) {
    const its = selection.map(byId).filter(o => o.type !== "zone" && !o.locked);
    if (its.length < 2) return;
    const rs = its.map(o => ({ o, ...itemRect(o) }));
    mutate(() => {
      if (dir === "left") { const x = Math.min(...rs.map(r => r.x)); rs.forEach(r => r.o.x = x); }
      if (dir === "top") { const y = Math.min(...rs.map(r => r.y)); rs.forEach(r => r.o.y = y); }
    });
  }
  function tidy() {
    const its = selection.map(byId).filter(o => o.type !== "zone" && !o.locked);
    if (its.length < 2) return;
    const rs = its.map(o => ({ o, ...itemRect(o) })).sort((a, b) => a.y - b.y || a.x - b.x);
    const cols = Math.ceil(Math.sqrt(rs.length));
    const x0 = Math.min(...rs.map(r => r.x)), colW = Math.max(...rs.map(r => r.w)) + 40;
    let y = Math.min(...rs.map(r => r.y));
    mutate(() => {
      for (let i = 0; i < rs.length; i += cols) {
        const row = rs.slice(i, i + cols);
        row.forEach((r, k) => { r.o.x = x0 + k * colW; r.o.y = y; });
        y += Math.max(...row.map(r => r.h)) + 40;
      }
    });
  }
  function zoneAround() {
    const its = selection.map(byId).filter(o => o.type !== "zone");
    if (!its.length) return;
    const rs = its.map(itemRect);
    const x0 = Math.min(...rs.map(r => r.x)) - 40, y0 = Math.min(...rs.map(r => r.y)) - 56;
    const x1 = Math.max(...rs.map(r => r.x + r.w)) + 40, y1 = Math.max(...rs.map(r => r.y + r.h)) + 40;
    checkpoint();
    const z = mk("zone", Math.round(x0), Math.round(y0), { w: Math.round(x1 - x0), h: Math.round(y1 - y0), color: ZONE_COLORS[(zZoneTop) % ZONE_COLORS.length] });
    sheet().items.push(z);
    render(); saved();
    edit(z, null, null, { continues: true });
  }
  function deleteSel(quiet) {
    stopEdit();
    if (selThread) {
      checkpoint();
      sheet().threads = sheet().threads.filter(t => t.id !== selThread);
      selThread = null;
      applySelection(); saved();
      if (!quiet) { toast(t("editor.msg.hiloEliminado"), t("comun.deshacer"), undo); Sound.play("trash"); }
      else announce(t("editor.msg.hiloEliminado"));
      return;
    }
    const ids = selection.filter(id => !byId(id)?.locked);
    if (!ids.length) { if (selection.length) toast(t("editor.msg.bloqueadoEliminar")); return; }
    checkpoint();
    sheet().items = sheet().items.filter(o => !ids.includes(o.id));
    selection = [];
    render(); saved();
    const msg = t("editor.msg.eliminados", { count: ids.length });
    if (!quiet) { toast(msg, t("comun.deshacer"), undo); Sound.play("trash"); } // cortar (quiet) no suena: no es tirarlo
    else announce(msg);
    checkTips("delete");
  }
  function editThreadLabel(thr, x, y) {
    inputPop(x, y, thr.label, t("editor.msg.etiquetaHilo"), v => { if (v !== null) mutate(() => thr.label = v); });
  }

  function inputPop(x, y, value, placeholder, cb) {
    $(".inpop")?.remove();
    const p = document.createElement("form");
    p.className = "inpop";
    p.innerHTML = `<input value="${esc(value)}" placeholder="${esc(placeholder)}" aria-label="${esc(placeholder)}"><button class="btn btn-primary">Aceptar</button>`;
    document.body.appendChild(p);
    p.style.left = clamp(x, 8, innerWidth - p.offsetWidth - 8) + "px";
    p.style.top = clamp(y + 8, 60, innerHeight - p.offsetHeight - 50) + "px";
    const input = p.querySelector("input");
    let finished = false;
    const finish = v => { if (finished) return; finished = true; p.remove(); cb(v); };
    p.onsubmit = e => { e.preventDefault(); finish(input.value.trim()); };
    input.onkeydown = e => { if (e.key === "Escape") { e.stopPropagation(); finish(null); } };
    input.onblur = () => setTimeout(() => finish(null), 200);
    setTimeout(() => { input.focus(); input.select(); });
  }

  /* ---------- Menús contextuales ---------- */
  viewport.addEventListener("contextmenu", e => {
    e.preventDefault();
    if (Date.now() - keyMenuAt < 1000) return; // ya lo abrió keyMenu
    stopEdit();
    if (e.target.closest("#groupBox")) return itemMenu(e.clientX, e.clientY);
    const tg = e.target.closest("#threads .th");
    if (tg) { selectThread(tg.dataset.t); return threadMenu(e.clientX, e.clientY); }
    const itemEl = e.target.closest(".item");
    const it = itemEl && byId(itemEl.dataset.id);
    if (!it || (it.type === "zone" && !e.target.closest(".zt") && !selection.includes(it.id))) {
      setSel([]);
      return canvasMenu(e.clientX, e.clientY, toWorld(e));
    }
    if (!selection.includes(it.id)) setSel([it.id]);
    itemMenu(e.clientX, e.clientY);
  });

  function itemMenu(x, y) {
    const its = selection.map(byId).filter(Boolean);
    const it = its.length === 1 ? its[0] : null;
    const m = [], dbl = t("editor.menu.dobleClic");
    if (it) {
      if (it.type === "photo") m.push({ label: t("editor.menu.verImagen"), kbd: dbl, action: () => openLightbox(it) }, { label: t("editor.ctx.cambiarImagen"), action: () => pickImage(it) });
      if (it.type === "link") m.push({ label: t("editor.menu.abrirEnlace"), kbd: dbl, action: () => openLink(it) }, { label: t("editor.menu.editarUrl"), action: () => editUrl(it, x, y) });
      if (it.type === "file") m.push({ label: t("editor.menu.abrirArchivo"), kbd: dbl, action: () => openFile(it) });
      if (it.type === "sticker") m.push({ label: t("editor.menu.cambiarSticker"), action: () => openStickers(it) });
      if (hasEdit(it)) m.push({ label: t("editor.menu.editarTexto"), kbd: "Enter", action: () => edit(it) });
      if (it.type === "list") m.push({ label: t("editor.lienzo.anadirTarea"), action: () => addTask(it) });
      if (m.length) m.push("-");
    }
    m.push({ label: t("atajos.reservadas.copiar"), kbd: "Ctrl+C", action: copySel },
      { label: t("atajos.reservadas.cortar"), kbd: "Ctrl+X", action: () => { copySel(); deleteSel(true); } });
    if (internalClip) m.push({ label: t("atajos.reservadas.pegar"), kbd: "Ctrl+V", action: () => pasteItems(internalClip, null) });
    m.push({ label: t("atajos.acciones.duplicate"), kbd: Keys.label("duplicate"), action: duplicateSel }, "-",
      { label: t("atajos.acciones.front"), kbd: Keys.label("front"), action: () => restack(1) },
      { label: t("atajos.acciones.back"), kbd: Keys.label("back"), action: () => restack(-1) });
    if (window.Asistente?.enabled()) m.push("-", { label: t("editor.menu.ideasIa"), action: () => Asistente.ideas() });
    if (its.some(o => o.rot)) m.push({ label: t("editor.menu.enderezar"), action: () => mutate(() => its.forEach(o => o.rot = 0)) });
    if (it && PINNABLE.has(it.type)) {
      const toPin = it.fix !== "pin";
      m.push({ label: t(toPin ? "editor.menu.fijarChinche" : it.type === "text" ? "editor.menu.quitarChinche" : "editor.menu.fijarCinta"), action: () => setFix(it, toPin ? "pin" : it.type === "text" ? "none" : "tape") });
      if (!toPin) m.push({ label: t("editor.menu.unirHilo"), kbd: t("editor.menu.arrastraChinche"), action: () => { setTool("thread"); threadFrom = it; elOf(it.id).classList.add("thread-target"); } });
    }
    if (its.length > 1) m.push("-",
      selGroup() ? { label: t("atajos.acciones.ungroup"), kbd: Keys.label("ungroup"), action: ungroupSel } : { label: t("atajos.acciones.group"), kbd: Keys.label("group"), action: groupSel },
      { label: t("editor.ctx.alinearIzquierda"), action: () => align("left") },
      { label: t("editor.ctx.alinearArriba"), action: () => align("top") },
      { label: t("editor.ctx.cuadricula"), action: tidy },
      { label: t("editor.ctx.zonaAlrededor"), action: zoneAround });
    if (its.some(o => linkedCount(o))) m.push({ label: t("editor.menu.quitarHilos"), action: () => mutate(() => {
      const ids = new Set(selection);
      sheet().threads = sheet().threads.filter(t => !ids.has(t.a) && !ids.has(t.b));
    }) });
    if (it?.group) m.push({ label: t("editor.menu.sacarGrupo"), action: ungroupSel });
    const allLocked = its.every(o => o.locked);
    m.push("-", { label: t(allLocked ? "editor.menu.desbloquear" : "editor.menu.bloquear"), kbd: Keys.label("lock"), action: toggleLock },
      { label: t("papelera.eliminar"), kbd: Keys.show("Delete"), danger: true, action: () => deleteSel() });
    showMenu(x, y, m);
  }

  function canvasMenu(x, y, pt) {
    const ev = { clientX: x, clientY: y };
    const here = k => () => create(k, pt, ev);
    showMenu(x, y, [
      { label: t("editor.menu.notaAqui"), kbd: Keys.label("tool.note"), action: here("note") },
      { label: t("editor.tipos.card"), kbd: Keys.label("tool.card"), action: here("card") },
      { label: t("editor.tipos.list"), kbd: Keys.label("tool.list"), action: here("list") },
      { label: t("editor.tipos.text"), kbd: Keys.label("tool.text"), action: here("text") },
      { label: t("editor.menu.imagen"), kbd: Keys.label("tool.image"), action: here("image") },
      { label: t("editor.menu.enlace"), kbd: Keys.label("tool.link"), action: here("link") },
      { label: t("editor.menu.archivo"), kbd: Keys.label("tool.file"), action: here("file") },
      { label: t("editor.tipos.zone"), kbd: Keys.label("tool.zone"), action: () => { edit(add(mk("zone", 0, 0), pt), null, null, { continues: true }); } },
      "-",
      internalClip && { label: t("atajos.reservadas.pegar"), kbd: "Ctrl+V", action: () => pasteItems(internalClip, pt) },
      { label: t("atajos.acciones.selectAll"), kbd: Keys.label("selectAll"), action: selectAll },
      { label: t("atajos.acciones.fit"), kbd: Keys.label("fit"), action: fit },
    ].filter(Boolean));
  }

  function threadMenu(x, y) {
    const thr = sheet().threads.find(x => x.id === selThread);
    if (!thr) return;
    showMenu(x, y, [
      { label: t(thr.label ? "editor.ctx.editarEtiqueta" : "editor.ctx.anadirEtiqueta"), kbd: t("editor.menu.dobleClic"), action: () => editThreadLabel(thr, x, y) },
      { label: t("editor.menu.colorAutomatico"), action: () => mutate(() => thr.color = "") },
      "-",
      { label: t("editor.menu.eliminarHilo"), kbd: Keys.show("Delete"), danger: true, action: () => deleteSel() },
    ]);
  }

  const selectAll = () => setSel(sheet().items.map(o => o.id));

  /* ---------- Doble clic ---------- */
  viewport.addEventListener("dblclick", e => {
    if (tool !== "select") return;
    let tEl = e.target;
    if (tEl.closest("#groupBox")) tEl = document.elementsFromPoint(e.clientX, e.clientY).find(x => x.closest?.(".item")) || tEl;
    const tg = tEl.closest("#threads .th");
    if (tg) { const th = sheet().threads.find(x => x.id === tg.dataset.t); return th && editThreadLabel(th, e.clientX, e.clientY); }
    const itemEl = tEl.closest(".item");
    const it = itemEl && byId(itemEl.dataset.id);
    // Mientras se edita, el doble clic selecciona una palabra (lo hace el navegador): no se vuelve a empezar la edición
    if (editing && it === editing.it) return;
    if (!it || (it.type === "zone" && !tEl.closest(".zt"))) return;
    if (it.locked) return toast(t("editor.msg.bloqueadoEditar"));
    if (tEl.closest(".t-photo .img")) return it.src || it.art ? openLightbox(it) : pickImage(it);
    if (it.type === "link" && !tEl.closest("[data-edit]")) return openLink(it);
    if (it.type === "file") return openFile(it);
    if (it.type === "sticker") return openStickers(it);
    if (it.type === "draw") return;
    edit(it, tEl.closest("[data-edit]"), { x: e.clientX, y: e.clientY });
  });

  /* ---------- Visor de fotos ---------- */
  let lbList = [], lbIdx = 0;
  function openLightbox(it) {
    lbList = sheet().items.filter(o => o.type === "photo" && (o.src || o.art));
    lbIdx = Math.max(0, lbList.findIndex(o => o.id === it.id));
    showLightbox();
    $("#lightbox").classList.add("open");
    releaseLightbox ??= trapFocus($("#lightbox"), $("#lightbox .close"));
  }
  function showLightbox() {
    const o = lbList[lbIdx];
    $("#lbFrame").innerHTML = o.src ? `<img src="${esc(o.src)}" alt="">` : ART[o.art];
    $("#lbCaption").textContent = o.caption || "";
    $("#lbCount").textContent = `${lbIdx + 1} / ${lbList.length}`;
    $$("#lightbox .prev, #lightbox .next").forEach(b => b.hidden = lbList.length < 2);
  }
  const lbStep = d => { lbIdx = (lbIdx + d + lbList.length) % lbList.length; showLightbox(); };
  let releaseLightbox = null;
  const closeLightbox = () => { $("#lightbox").classList.remove("open"); releaseLightbox?.(); releaseLightbox = null; };
  $("#lightbox").addEventListener("click", e => {
    if (e.target.closest(".prev")) return lbStep(-1);
    if (e.target.closest(".next")) return lbStep(1);
    if (!e.target.closest(".frame")) closeLightbox();
  });

  /* ---------- Herramientas ---------- */
  // Pista de cada herramienta: editor.pistas.<herramienta>
  const HINTS = new Set(["note", "card", "list", "text", "image", "link", "file", "sticker", "zone", "draw", "thread"]);
  function showHint() {
    const h = tool === "draw" && drawOpts.erase ? t(drawOpts.erase === "part" ? "editor.pistas.gomaPartes" : "editor.pistas.gomaTrazos") : HINTS.has(tool) ? t("editor.pistas." + tool) : "";
    hint.innerHTML = h ? `${h}${toolLocked ? " · <b>" + t("editor.pistas.fija") + "</b>" : ""} · ${t("editor.pistas.salir")}` : "";
    hint.classList.toggle("open", !!h);
  }

  function setTool(toolId) {
    if (toolId === "sticker" && !pendingSticker) return openStickers();
    tool = toolId;
    if (toolId !== "draw") drawSession = null;
    if (toolId !== "sticker") { pendingSticker = null; ghost.style.display = "none"; }
    if (threadFrom) elOf(threadFrom.id)?.classList.remove("thread-target");
    threadFrom = null;
    if (toolId === "select") toolLocked = false;
    $$("[data-tool]").forEach(b => {
      const on = b.dataset.tool === toolId;
      b.classList.toggle("active", on);
      b.classList.toggle("locked", on && toolLocked);
      b.setAttribute("aria-pressed", on);
    });
    viewport.classList.toggle("creating", CREATE.has(toolId) || toolId === "zone" || toolId === "draw");
    viewport.classList.toggle("tool-thread", toolId === "thread");
    drawPop.classList.toggle("open", toolId === "draw");
    viewport.classList.toggle("erasing", toolId === "draw" && !!drawOpts.erase);
    if (toolId !== "sticker") stickerPop.classList.remove("open");
    showHint();
    drawThreads();
    buildCtx();
  }

  $("#toolbar").addEventListener("click", e => {
    const b = e.target.closest("[data-tool]");
    if (!b) return;
    const toolId = b.dataset.tool;
    if (toolId === "sticker") return openStickers();
    toolLocked = false;
    // detail 0 = activado con teclado: no hay dónde hacer clic, así que se crea en el centro de la vista
    if (e.detail === 0 && (CREATE.has(toolId) || toolId === "zone")) { setTool("select"); return createCenter(toolId); }
    setTool(toolId === tool && toolId !== "select" ? "select" : toolId);
  });
  $("#toolbar").addEventListener("dblclick", e => {
    const b = e.target.closest("[data-tool]");
    if (!b || b.dataset.tool === "sticker") return;
    toolLocked = true;
    setTool(b.dataset.tool);
    toast(t("editor.msg.herramientaFija"));
  });

  // Stickers: elegir en la paleta y hacer clic en el tablero
  function openStickers(replace) {
    stickerReplace = replace || null;
    const btn = $('[data-tool="sticker"]').getBoundingClientRect();
    stickerPop.style.top = clamp(btn.top - 120, 60, innerHeight - 420) + "px";
    $("#stickerTitle").textContent = replace ? t("editor.ctx.cambiarSticker") : t("atajos.acciones.tool_sticker");
    stickerPop.classList.toggle("open", replace ? true : !stickerPop.classList.contains("open"));
  }
  function renderMyStickers() {
    $("#myStickers").innerHTML = myStickers.length
      ? myStickers.map(src => `<button data-st="img" data-src="${esc(src)}" draggable="true" aria-label="${t("editor.stickerPropio")}"><img src="${esc(src)}" alt="" draggable="false"></button>`).join("")
      : `<small style="grid-column:1/-1;color:var(--text-muted);font-size:12px;padding:4px">${t("editor.stickersVacio")}</small>`;
  }
  function stickerSpec(b) {
    const kind = b.dataset.st;
    return kind === "emoji" ? { type: "sticker", o: { emoji: b.textContent.trim(), img: "" } }
      : kind === "img" ? { type: "sticker", o: { img: b.dataset.src, emoji: "" } }
      // El texto del sello es el del botón, ya en el idioma de la interfaz
      : kind === "stamp" ? { type: "stamp", o: { text: b.textContent.trim(), color: b.dataset.color } }
      : { type: "stamp", o: { text: t("editor.miSello"), color: "#7048e8" }, custom: true };
  }
  // Arrastrar un sticker desde la paleta: viaja como dato propio, no como archivo de imagen
  // (si no, el navegador lo entrega como imagen y se creaba una foto con el nombre interno del archivo)
  const STICKER_MIME = "application/x-chinchero-sticker";
  $$("[data-st]", stickerPop).forEach(b => { b.draggable = true; });
  stickerPop.addEventListener("dragstart", e => {
    const b = e.target.closest?.("[data-st]");
    if (!b) return;
    e.dataTransfer.clearData();
    e.dataTransfer.setData(STICKER_MIME, JSON.stringify(stickerSpec(b)));
    e.dataTransfer.effectAllowed = "copy";
  });
  stickerPop.addEventListener("click", e => {
    if (e.target.closest("#importSticker")) {
      return pickFiles("image/*", true, files => {
        files.forEach(f => Store.importFile(f).then(url => { myStickers.push(url); Store.saveLibrary(); renderMyStickers(); }));
      });
    }
    const b = e.target.closest("[data-st]");
    if (!b) return;
    const kind = b.dataset.st;
    const spec = stickerSpec(b);
    stickerPop.classList.remove("open");
    if (stickerReplace) {
      const it = stickerReplace;
      stickerReplace = null;
      if (it.type === spec.type) mutate(() => Object.assign(it, spec.o));
      return;
    }
    pendingSticker = spec;
    ghost.innerHTML = kind === "img" ? `<img src="${b.dataset.src}" alt="">` : b.innerHTML;
    setTool("sticker");
    if (e.detail === 0) createCenter("sticker"); // con teclado: se pega en el centro de la vista
  });

  drawPop.addEventListener("click", e => {
    const b = e.target.closest("[data-dc], [data-dw], [data-de]");
    if (!b) return;
    if (b.dataset.de) return setEraser(drawOpts.erase === b.dataset.de ? null : b.dataset.de);
    setEraser(null);
    if (b.dataset.dc) drawOpts.color = b.dataset.dc;
    if (b.dataset.dw) drawOpts.sw = +b.dataset.dw;
    $$("[data-dc]", drawPop).forEach(x => { x.classList.toggle("on", x.dataset.dc === drawOpts.color); x.setAttribute("aria-pressed", x.dataset.dc === drawOpts.color); });
    $$("[data-dw]", drawPop).forEach(x => { x.classList.toggle("on", +x.dataset.dw === drawOpts.sw); x.setAttribute("aria-pressed", +x.dataset.dw === drawOpts.sw); });
  });

  /* ---------- Hojas ---------- */
  const sheetsEl = $("#sheets");
  function renderSheets() {
    sheetsEl.innerHTML = doc.sheets.map((s, i) => `<button class="sheet${i === doc.active ? " active" : ""}" data-i="${i}" draggable="true" role="tab" aria-selected="${i === doc.active}" tabindex="${i === doc.active ? 0 : -1}" title="${t("editor.hojas.pista")}">
      <span class="sw" style="background:${NOTE_COLORS[s.color]}"></span><span class="name">${esc(s.name)}</span></button>`).join("");
  }
  function switchSheet(i) {
    if (i === doc.active || !doc.sheets[i]) return;
    stopEdit();
    sheet().view = { ...view };
    doc.active = i;
    selection = []; selThread = null;
    applySurface(); render(); renderSheets(); enterView();
    sheetsEl.children[i]?.scrollIntoView({ block: "nearest" });
    const n = sheet().items.length;
    announce(t("editor.hojas.anuncio", { name: sheet().name, items: t("comun.elementos", { count: n }) }));
    Tour.emit("sheet");
  }
  // Pestañas de hojas con teclado: flechas, Inicio y Fin cambian de hoja; F2 renombra
  sheetsEl.addEventListener("keydown", e => {
    const b = e.target.closest(".sheet");
    if (!b || e.target.isContentEditable) return;
    const i = { ArrowLeft: doc.active - 1, ArrowRight: doc.active + 1, Home: 0, End: doc.sheets.length - 1 }[e.key];
    if (i !== undefined) { e.preventDefault(); switchSheet(i); sheetsEl.children[doc.active]?.focus(); }
    else if (e.key === "F2") { e.preventDefault(); renameSheet(+b.dataset.i); }
  });
  function renameSheet(i) {
    const n = sheetsEl.children[i]?.querySelector(".name");
    if (!n || n.isContentEditable) return; // ya se está renombrando: el doble clic solo selecciona una palabra
    n.contentEditable = "true"; n.focus();
    getSelection().selectAllChildren(n);
    n.onkeydown = e => { if (e.key === "Enter" || e.key === "Escape") { e.preventDefault(); n.blur(); sheetsEl.children[i]?.focus(); } }; // con teclado, el foco sigue en la pestaña
    n.onblur = () => {
      n.contentEditable = "false";
      const v = n.textContent.trim() || t("comun.sinNombre");
      if (v !== doc.sheets[i].name) { checkpoint(); doc.sheets[i].name = v; saved(); }
      renderSheets();
    };
  }
  function cloneSheet(s) {
    const map = {};
    const items = s.items.map(o => { const c = JSON.parse(JSON.stringify(o)); map[o.id] = c.id = nid(); return c; });
    const threads = s.threads.map(t => ({ ...t, id: nid(), a: map[t.a], b: map[t.b] }));
    return { ...JSON.parse(JSON.stringify(s)), id: nid(), name: s.name + " (copia)", items, threads };
  }
  function addSheet() {
    checkpoint();
    sheet().view = { ...view };
    doc.sheets.push(newSheet(`Hoja ${doc.sheets.length + 1}`, { color: Object.keys(NOTE_COLORS)[doc.sheets.length % 5] }));
    switchSheet(doc.sheets.length - 1);
    saved();
    renameSheet(doc.active);
  }

  function addWeekSheet() {
    checkpoint();
    sheet().view = { ...view };
    doc.sheets.push(TEMPLATES.semana()[0]);
    switchSheet(doc.sheets.length - 1);
    saved(); fit();
  }

  sheetsEl.addEventListener("click", e => {
    const s = e.target.closest(".sheet");
    if (s && !e.target.isContentEditable) switchSheet(+s.dataset.i);
  });
  sheetsEl.addEventListener("dblclick", e => { const s = e.target.closest(".sheet"); if (s) renameSheet(+s.dataset.i); });
  sheetsEl.addEventListener("contextmenu", e => {
    const s = e.target.closest(".sheet");
    if (!s) return;
    e.preventDefault();
    const i = +s.dataset.i, sh = doc.sheets[i];
    const move = d => { checkpoint(); const cur = sheet(); doc.sheets.splice(i, 1); doc.sheets.splice(i + d, 0, sh); doc.active = doc.sheets.indexOf(cur); renderSheets(); saved(); };
    showMenu(e.clientX, e.clientY - 10, [
      { label: t("barra.menu.renombrar"), kbd: t("editor.menu.dobleClic"), action: () => renameSheet(i) },
      { label: t("atajos.acciones.duplicate"), action: () => { checkpoint(); doc.sheets.splice(i + 1, 0, cloneSheet(sh)); if (i < doc.active) doc.active++; switchSheet(i + 1); saved(); } },
      { label: t("barra.menu.color"), action: () => { checkpoint(); const k = Object.keys(NOTE_COLORS); sh.color = k[(k.indexOf(sh.color) + 1) % k.length]; renderSheets(); saved(); } },
      i > 0 && { label: t("editor.hojas.moverIzquierda"), action: () => move(-1) },
      i < doc.sheets.length - 1 && { label: t("editor.hojas.moverDerecha"), action: () => move(1) },
      "-",
      { label: t("editor.hojas.eliminar"), danger: true, action: () => {
        if (doc.sheets.length === 1) return toast(t("editor.hojas.alMenosUna"));
        checkpoint();
        const cur = sheet();
        doc.sheets.splice(i, 1);
        if (cur === sh) { doc.active = Math.min(i, doc.sheets.length - 1); view = sheet().view ? { ...sheet().view } : { x: 40, y: 20, z: 1 }; }
        else doc.active = doc.sheets.indexOf(cur);
        selection = [];
        renderAll(); saved();
        toast(t("editor.hojas.eliminada", { name: sh.name }), t("comun.deshacer"), undo);
      } },
    ].filter(Boolean));
  });
  sheetsEl.addEventListener("dragstart", e => {
    const s = e.target.closest(".sheet");
    if (s) e.dataTransfer.setData("text/sheet", s.dataset.i);
  });
  sheetsEl.addEventListener("dragover", e => {
    const s = e.target.closest(".sheet");
    if (!s || !e.dataTransfer.types.includes("text/sheet")) return;
    e.preventDefault();
    $$(".drag-over", sheetsEl).forEach(x => x.classList.remove("drag-over"));
    s.classList.add("drag-over");
  });
  sheetsEl.addEventListener("drop", e => {
    const s = e.target.closest(".sheet");
    if (!s) return;
    e.preventDefault();
    const from = +e.dataTransfer.getData("text/sheet"), to = +s.dataset.i;
    if (from === to || Number.isNaN(from)) return renderSheets();
    checkpoint();
    const cur = sheet();
    const [moved] = doc.sheets.splice(from, 1);
    doc.sheets.splice(to, 0, moved);
    doc.active = doc.sheets.indexOf(cur);
    renderSheets(); saved();
  });
  sheetsEl.addEventListener("dragend", () => $$(".drag-over", sheetsEl).forEach(x => x.classList.remove("drag-over")));
  $("#addSheet").onclick = addSheet;
  $("#allSheets").onclick = e => {
    const r = e.currentTarget.getBoundingClientRect();
    showMenu(r.left, r.top - 8 - doc.sheets.length * 34, doc.sheets.map((s, i) => ({ label: (i === doc.active ? "✓ " : "   ") + s.name, action: () => switchSheet(i) })));
  };

  /* ---------- Barra superior ---------- */
  $("#surfaces").addEventListener("click", e => {
    const b = e.target.closest("[data-s]");
    if (!b || b.dataset.s === sheet().surface) return;
    checkpoint();
    sheet().surface = b.dataset.s;
    applySurface(); saved();
  });
  const boardName = $("#boardName");
  boardName.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === "Escape") { e.preventDefault(); boardName.blur(); } });
  boardName.addEventListener("blur", () => {
    const v = boardName.textContent.trim() || t("tableros.sinTitulo");
    if (v !== doc.name) { checkpoint(); doc.name = v; saved(); }
    boardName.textContent = doc.name;
    document.title = `${doc.name} — Chinchero`;
  });
  $("#undoBtn").onclick = undo;
  $("#redoBtn").onclick = redo;
  $("#searchBtn").onclick = openCmdk;
  /* ---------- Exportación: la hoja entera a 2x, por partes, sin la interfaz ---------- */
  const EXPORT_SCALE = 2, EXPORT_MAX_SIDE = 16000, EXPORT_MAX_AREA = 120e6; // límites del canvas
  const frames = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  // Rectángulo de la hoja en coordenadas del mundo (incluye elementos girados e hilos)
  function sheetBounds() {
    const vr = viewport.getBoundingClientRect();
    const rs = [...itemsEl.children, ...threadLayer.children].map(e => e.getBoundingClientRect()).filter(r => r.width || r.height);
    if (!rs.length) return null;
    const toW = (x, y) => ({ x: (x - vr.left - view.x) / view.z, y: (y - vr.top - view.y) / view.z });
    const a = toW(Math.min(...rs.map(r => r.left)), Math.min(...rs.map(r => r.top)));
    const b = toW(Math.max(...rs.map(r => r.right)), Math.max(...rs.map(r => r.bottom)));
    const pad = 40;
    return { x: a.x - pad, y: a.y - pad, w: b.x - a.x + pad * 2, h: b.y - a.y + pad * 2 };
  }
  // Recorre la hoja en mosaicos del tamaño del lienzo, captura cada uno y los une en un PNG
  async function captureSheet() {
    const b = sheetBounds();
    if (!b) return null;
    const dpr = devicePixelRatio;
    const s = Math.min(EXPORT_SCALE, EXPORT_MAX_SIDE / b.w, EXPORT_MAX_SIDE / b.h, Math.sqrt(EXPORT_MAX_AREA / (b.w * b.h)));
    // Las fotos que a esta escala necesitan más píxeles que su miniatura (1280 px) se exportan con la original
    const swapped = $$('img[src^="chinchero-media://thumbs/"]', itemsEl)
      .filter(i => i.naturalWidth && Math.max(i.offsetWidth / i.naturalWidth, i.offsetHeight / i.naturalHeight) * s > 1);
    for (const i of swapped) i.src = i.src.replace("chinchero-media://thumbs/", "chinchero-media://media/");
    await Promise.all($$("img", itemsEl).map(i => i.decode().catch(() => {})));
    try { return await tileSheet(b, s, dpr); }
    finally { for (const i of swapped) i.src = thumb(i.src); }
  }
  async function tileSheet(b, s, dpr) {
    const z = s / dpr, W = Math.ceil(b.w * z), H = Math.ceil(b.h * z); // px CSS a ese zoom
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    const g = canvas.getContext("2d");
    const vr = viewport.getBoundingClientRect(), tw = viewport.clientWidth, th = viewport.clientHeight;
    const prev = view;
    try {
      for (let ty = 0; ty < H; ty += th) for (let tx = 0; tx < W; tx += tw) {
        view = { z, x: Math.round(-b.x * z) - tx, y: Math.round(-b.y * z) - ty };
        applyView();
        await frames();
        const png = await Store.desktop("capture", { x: vr.left, y: vr.top, width: Math.min(tw, W - tx), height: Math.min(th, H - ty) });
        g.drawImage(await createImageBitmap(new Blob([png], { type: "image/png" })), Math.round(tx * dpr), Math.round(ty * dpr));
      }
    } finally { view = prev; applyView(); }
    const blob = await new Promise(r => canvas.toBlob(r, "image/png"));
    return { png: new Uint8Array(await blob.arrayBuffer()), w: b.w, h: b.h };
  }
  // Oculta la interfaz mientras dura la captura; en el navegador solo avisa
  async function exporting(fn) {
    if (!Store.native) return Store.desktop("capture");
    stopEdit();
    await Store.desktop("coverWindow", true);
    document.body.classList.add("exporting");
    try { await frames(); return await fn(); }
    finally { document.body.classList.remove("exporting"); await frames(); Store.desktop("coverWindow", false); }
  }
  const emptySheet = () => toast(t("editor.exportar.hojaVacia"));
  async function exportPng() {
    const shot = await exporting(captureSheet);
    if (shot === null) return emptySheet();
    if (shot && await Store.desktop("exportPng", shot.png, `${doc.name} - ${sheet().name}`)) toast(t("editor.exportar.imagenGuardada"));
  }
  async function copyPng() {
    const shot = await exporting(captureSheet);
    if (shot === null) return emptySheet();
    if (shot && await Store.desktop("copyPng", shot.png)) toast(t("editor.exportar.imagenCopiada"));
  }
  // PDF con una página por hoja; las hojas vacías se saltan
  async function exportPdf(all) {
    const cur = doc.active;
    const pages = await exporting(async () => {
      const out = [];
      try {
        for (const i of all ? doc.sheets.map((_, i) => i) : [cur]) {
          switchSheet(i);
          const shot = await captureSheet();
          if (shot) out.push(shot);
        }
      } finally { switchSheet(cur); }
      return out;
    });
    if (!pages) return;
    if (!pages.length) return all ? toast(t("editor.exportar.hojasVacias")) : emptySheet();
    const name = all ? doc.name : `${doc.name} - ${sheet().name}`;
    toast(t("editor.exportar.preparandoPdf"));
    if (await Store.desktop("exportPdf", pages, name)) toast(all ? t("editor.exportar.pdfPaginas", { count: pages.length }) : t("editor.exportar.pdfGuardado"));
  }
  // Compartir: el tablero entero con sus imágenes en un .chinchero (antes se guarda lo pendiente)
  async function exportBoard() {
    persist(persistTimer !== null);
    if (await Store.desktop("exportBoard", boardId, doc.name)) toast(t("tableros.exportado"));
  }
  // Un .chinchero soltado sobre el lienzo se importa como tablero nuevo (en el mismo grupo) y se abre
  async function importBoards(files) {
    const added = [];
    for (const f of files) { const b = await Store.importBoard(f, Store.board(boardId)?.group); if (b) added.push(b); }
    if (!added.length) return;
    try { sessionStorage.setItem("chinchero-aviso", added.length === 1 ? t("tableros.importadoUno", { name: added[0].name }) : t("tableros.importados", { count: added.length })); } catch {}
    location.href = "02-tablero.html?board=" + added[added.length - 1].id;
  }
  $("#exportBtn").onclick = e => {
    const r = e.currentTarget.getBoundingClientRect();
    showMenu(r.left - 160, r.bottom + 6, [
      { label: t("editor.exportar.png") + "…", action: exportPng },
      { label: t("editor.exportar.pdf") + "…", action: () => exportPdf(false) },
      ...(doc.sheets.length > 1 ? [{ label: t("editor.exportar.pdfTodas") + "…", action: () => exportPdf(true) }] : []),
      { label: t("editor.exportar.compartir") + "…", action: exportBoard },
      "-",
      { label: t("editor.exportar.copiar"), action: copyPng },
    ]);
  };
  // Nombre de cada modo: editor.hilos.<modo>
  const THREAD_MODES = ["over", "dim", "hidden"];
  function applyThreadMode() {
    const m = getPref("threads") || "over";
    threadsSvg.classList.toggle("dim", m === "dim");
    threadsSvg.classList.toggle("hidden", m === "hidden");
    $("#threadsBtn").classList.toggle("active", m !== "over");
  }
  $("#threadsBtn").onclick = e => {
    const r = e.currentTarget.getBoundingClientRect(), cur = getPref("threads") || "over";
    showMenu(r.left - 200, r.bottom + 6, THREAD_MODES.map(v => ({ label: (v === cur ? "✓ " : "   ") + t("editor.hilos." + v), action: () => { setPref("threads", v); applyThreadMode(); } })));
  };
  $("#helpBtn").onclick = e => showHelp(e.currentTarget, "editor", shortcutGroups());

  $("#zoomIn").onclick = () => zoomBy(1.2);
  $("#zoomOut").onclick = () => zoomBy(1 / 1.2);
  $("#zoomFit").onclick = fit;
  $("#zoomLabel").onclick = () => zoomAt(viewport.clientWidth / 2, viewport.clientHeight / 2, 1);
  $("#mmToggle").onclick = () => {
    minimap.hidden = !minimap.hidden;
    setPref("minimap", minimap.hidden ? "off" : "on");
    $("#mmToggle").classList.toggle("active", !minimap.hidden); $("#mmToggle").setAttribute("aria-pressed", !minimap.hidden);
    drawMinimap();
  };

  viewport.addEventListener("wheel", e => {
    e.preventDefault();
    const r = viewport.getBoundingClientRect();
    // La rueda hace zoom hacia el puntero; Shift+rueda desplaza en horizontal
    if (e.shiftKey && !e.ctrlKey) { view.x -= e.deltaY || e.deltaX; applyView(); return; }
    const d = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
    zoomAt(e.clientX - r.left, e.clientY - r.top, view.z * Math.exp(-clamp(d, -120, 120) * .0016));
  }, { passive: false });

  /* ---------- Minimapa ---------- */
  let mmRaf = 0, mmView = null;
  const mmDots = [];
  function drawMinimap() {
    if (mmRaf) return;
    mmRaf = requestAnimationFrame(() => { mmRaf = 0; paintMinimap(); });
  }
  function miniColor(o) {
    if (o.type === "note") return NOTE_COLORS[o.color];
    if (o.type === "zone") return `color-mix(in srgb, ${o.color} 30%, transparent)`;
    if (o.type === "sticker" || o.type === "stamp") return "#fab005";
    if (o.type === "draw") return o.color;
    if (o.type === "text") return "var(--text-muted)";
    return "#dee2e6";
  }
  function paintMinimap() {
    if (minimap.hidden) return;
    const W = minimap.clientWidth, H = minimap.clientHeight;
    const vw = viewport.clientWidth / view.z, vh = viewport.clientHeight / view.z, vx = -view.x / view.z, vy = -view.y / view.z;
    const rs = sheet().items.map(o => ({ o, ...itemRect(o) }));
    const pad = 80;
    const x0 = Math.min(vx, ...rs.map(r => r.x)) - pad, y0 = Math.min(vy, ...rs.map(r => r.y)) - pad;
    const x1 = Math.max(vx + vw, ...rs.map(r => r.x + r.w)) + pad, y1 = Math.max(vy + vh, ...rs.map(r => r.y + r.h)) + pad;
    const sc = Math.min(W / (x1 - x0), H / (y1 - y0));
    const ox = (W - (x1 - x0) * sc) / 2, oy = (H - (y1 - y0) * sc) / 2;
    minimap._m = { x0, y0, sc, ox, oy };
    // Se reutilizan los nodos y solo se reescribe el estilo de los que cambian (al arrastrar, casi siempre uno)
    if (!mmView) { minimap.innerHTML = '<b class="mv"></b>'; mmView = minimap.firstChild; }
    while (mmDots.length < rs.length) mmDots.push(minimap.insertBefore(document.createElement("i"), mmView));
    while (mmDots.length > rs.length) mmDots.pop().remove();
    rs.forEach((r, k) => {
      const css = `left:${ox + (r.x - x0) * sc}px;top:${oy + (r.y - y0) * sc}px;width:${Math.max(2, r.w * sc)}px;height:${Math.max(2, r.h * sc)}px;background:${miniColor(r.o)}`;
      if (mmDots[k]._css !== css) { mmDots[k].style.cssText = css; mmDots[k]._css = css; }
    });
    mmView.style.cssText = `left:${ox + (vx - x0) * sc}px;top:${oy + (vy - y0) * sc}px;width:${vw * sc}px;height:${vh * sc}px`;
  }
  minimap.addEventListener("pointerdown", e => {
    const m = minimap._m;
    const go = ev => {
      const r = minimap.getBoundingClientRect();
      const wx = m.x0 + (ev.clientX - r.left - m.ox) / m.sc, wy = m.y0 + (ev.clientY - r.top - m.oy) / m.sc;
      view.x = viewport.clientWidth / 2 - wx * view.z;
      view.y = viewport.clientHeight / 2 - wy * view.z;
      applyView();
    };
    go(e);
    beginDrag({ move: go });
  });

  /* ---------- Buscar y acciones (Ctrl+K) ---------- */
  const cmdk = $("#cmdk"), cmdkInput = $("#cmdkInput"), cmdkList = $("#cmdkList");
  let cmdkRows = [], cmdkIdx = 0;
  function itemText(o) {
    switch (o.type) {
      case "note": return plain(o.text);
      case "card": return `${o.title} — ${plain(o.text)}`;
      case "list": return `${o.title}: ${o.tasks.map(t => t.text).join(", ")}`;
      case "text": case "stamp": return o.text;
      case "photo": return o.caption || TYPE_NAMES.photo;
      case "link": return `${o.title} (${o.domain})`;
      case "file": return o.name;
      case "zone": return o.title;
      default: return "";
    }
  }
  // Cómo se nombra un elemento al anunciarlo: tipo y su texto, abreviado
  function describe(o) {
    const itTxt = (itemText(o) || "").trim();
    return TYPE_NAMES[o.type] + (itTxt ? ` «${itTxt.length > 60 ? itTxt.slice(0, 60) + "…" : itTxt}»` : "");
  }
  const movedMsg = n => t("editor.msg.movidos", { count: n });

  function openCmdk() {
    stopEdit();
    cmdk.classList.add("open");
    cmdkInput.value = "";
    renderCmdk();
    releaseCmdk ??= trapFocus(cmdk, cmdkInput);
    cmdkInput.focus();
  }
  let releaseCmdk = null;
  const closeCmdk = () => { cmdk.classList.remove("open"); releaseCmdk?.(); releaseCmdk = null; };
  function goToItem(si, id) {
    switchSheet(si);
    const it = byId(id);
    if (!it) return;
    centerOn(it);
    setSel([id]);
    const el = elOf(id);
    el.classList.add("flash");
    setTimeout(() => el.classList.remove("flash"), 2000);
  }
  function renderCmdk() {
    const q = norm(cmdkInput.value.trim());
    const found = [];
    doc.sheets.forEach((s, si) => s.items.forEach(o => {
      const txt = itemText(o);
      if (txt && (!q || norm(txt).includes(q))) found.push({ icon: TYPE_ICON[o.type], label: txt, sub: `${TYPE_NAMES[o.type]} · ${s.name}`, run: () => goToItem(si, o.id) });
    }));
    const actions = [
      { icon: "📝", label: t("editor.cmdk.nota"), sub: Keys.label("tool.note"), run: () => createCenter("note") },
      { icon: "🗒️", label: t("editor.cmdk.ficha"), sub: Keys.label("tool.card"), run: () => createCenter("card") },
      { icon: "☑️", label: t("editor.cmdk.lista"), sub: Keys.label("tool.list"), run: () => createCenter("list") },
      { icon: "🗂️", label: t("editor.cmdk.zona"), sub: Keys.label("tool.zone"), run: () => edit(add(mk("zone", 0, 0), viewCenter()), null, null, { continues: true }) },
      { icon: "🖼️", label: t("editor.cmdk.imagen"), sub: Keys.label("tool.image"), run: () => createCenter("image") },
      { icon: "🔗", label: t("editor.cmdk.enlace"), sub: Keys.label("tool.link"), run: () => createCenter("link") },
      ...doc.sheets.map((s, i) => ({ icon: "📄", label: t("editor.cmdk.irHoja", { name: s.name }), sub: i === doc.active ? t("editor.cmdk.actual") : "", run: () => switchSheet(i) })),
      { icon: "➕", label: t("editor.nuevaHoja"), sub: "", run: addSheet },
      { icon: "📅", label: t("editor.cmdk.hojaSemana"), sub: "", run: addWeekSheet },
      { icon: "✨", label: t("ajustes.asistenteConIa"), sub: "", run: () => Asistente.open() },
      { icon: "🔍", label: t("atajos.acciones.fit"), sub: Keys.label("fit"), run: fit },
      { icon: "🌗", label: t("editor.cmdk.tema"), sub: "", run: () => toggleTheme() },
      { icon: "⌨️", label: t("editor.cmdk.atajos"), sub: Keys.label("shortcuts"), run: () => showShortcuts(shortcutGroups()) },
      { icon: "🎓", label: t("editor.cmdk.tutorial"), sub: "", run: () => Tour.start("editor") },
      { icon: "📤", label: t("editor.exportar.png"), sub: "", run: exportPng },
      { icon: "📄", label: t("editor.exportar.pdf"), sub: "", run: () => exportPdf(false) },
      ...(doc.sheets.length > 1 ? [{ icon: "📚", label: t("editor.exportar.pdfTodas"), sub: "", run: () => exportPdf(true) }] : []),
      { icon: "📦", label: t("editor.exportar.compartir") + " (.chinchero)", sub: "", run: exportBoard },
      { icon: "📋", label: t("editor.exportar.copiar"), sub: "", run: copyPng },
    ].filter(a => !q || norm(a.label).includes(q));
    const shown = q ? found.slice(0, 30) : found.slice(0, 6);
    cmdkRows = [...shown, ...actions];
    cmdkIdx = 0;
    const row = (r, i) => `<li data-k="${i}" role="option"><span class="ci">${r.icon}</span><span class="cl">${esc(r.label)}</span><small>${esc(r.sub)}</small></li>`;
    cmdkList.innerHTML = (shown.length ? `<li class="cmdk-sec">${t(q ? "editor.cmdk.enEsteTablero" : "editor.cmdk.elementos")}</li>` + shown.map(row).join("") : "")
      + (actions.length ? '<li class="cmdk-sec">Acciones</li>' + actions.map((r, i) => row(r, i + shown.length)).join("") : "")
      + (!cmdkRows.length ? `<li class="cmdk-empty">${t("tableros.vacio.sinResultados")}</li>` : "");
    markCmdk();
  }
  function markCmdk() {
    $$("li[data-k]", cmdkList).forEach(li => li.classList.toggle("on", +li.dataset.k === cmdkIdx));
    cmdkList.querySelector("li.on")?.scrollIntoView({ block: "nearest" });
  }
  function runCmdk(i) {
    const r = cmdkRows[i];
    if (!r) return;
    closeCmdk();
    r.run();
  }
  cmdkInput.addEventListener("input", renderCmdk);
  cmdkInput.addEventListener("keydown", e => {
    if (e.key === "ArrowDown") { e.preventDefault(); cmdkIdx = Math.min(cmdkRows.length - 1, cmdkIdx + 1); markCmdk(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); cmdkIdx = Math.max(0, cmdkIdx - 1); markCmdk(); }
    else if (e.key === "Enter") { e.preventDefault(); runCmdk(cmdkIdx); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeCmdk(); }
  });
  cmdkList.addEventListener("click", e => { const li = e.target.closest("li[data-k]"); if (li) runCmdk(+li.dataset.k); });
  cmdk.addEventListener("click", e => { if (e.target === cmdk) closeCmdk(); });

  /* ---------- Asistente con IA: la hoja para el modelo y sus acciones (el panel está en asistente.js) ---------- */
  const AI_TYPES = { nota: "note", ficha: "card", lista: "list", texto: "text", zona: "zone", sello: "stamp", sticker: "sticker" };
  const AI_NAMES = { ...Object.fromEntries(Object.entries(AI_TYPES).map(([k, v]) => [v, k])), photo: "foto", link: "enlace", file: "archivo", sticker: "sticker", draw: "dibujo" };
  const AI_NOTE = { amarillo: "yellow", azul: "blue", rosa: "pink", verde: "green", violeta: "purple", naranja: "orange", blanco: "white" };
  const AI_HEX = {
    zone: { azul: "#4dabf7", rosa: "#f783ac", verde: "#69db7c", naranja: "#ffa94d", violeta: "#9775fa", gris: "#868e96" },
    stamp: { rojo: "#e03131", verde: "#2f9e44", azul: "#1c7ed6", naranja: "#f08c00", violeta: "#7048e8", gris: "#495057" },
  };
  const AI_DRAW = { rojo: "#e03131", azul: "#1c7ed6", negro: "#2b2a27", amarillo: "#f59f00", verde: "#2f9e44", blanco: "#ffffff" };
  const AI_SW = { fino: 2, medio: 4, grueso: 8 };
  // Un trazo SVG del modelo: solo comandos de trazado y números (nada de etiquetas ni urls)
  const AI_PATH = /^\s*[Mm][MLHVCSQTAZmlhvcsqtaz0-9eE.,+\-\s]*$/;
  const aiNoteName = Object.fromEntries(Object.entries(AI_NOTE).map(([k, v]) => [v, k]));
  const aiStr = (v, max = 500) => typeof v === "string" ? v.trim().slice(0, max) : "";
  const aiRich = v => esc(aiStr(v, 1000)).replace(/\n/g, "<br>"); // el texto de notas y fichas se pinta como HTML

  function boardForAI() {
    const s = sheet();
    const elementos = s.items.slice(-200).map(o => {
      const r = itemRect(o);
      return { id: o.id, tipo: AI_NAMES[o.type] || o.type, texto: (itemText(o) || "").slice(0, 300), x: Math.round(o.x), y: Math.round(o.y), w: Math.round(r.w), h: Math.round(r.h), ...(o.type === "note" && { color: aiNoteName[o.color] }) };
    });
    return JSON.stringify({ hoja: s.name, hojas: doc.sheets.map(h => h.name), elementos, hilos: s.threads.map(t => ({ a: t.a, b: t.b, ...(t.label && { etiqueta: t.label }) })), seleccion: selection });
  }

  // Desplaza un trazo SVG (dx, dy): solo se mueven las coordenadas absolutas. Un «m» al principio del trazo se pasa
  // a «M», porque al unir varios trazos se tomaría desde el final del anterior. Los grupos incompletos se descartan.
  const PATH_ARGS = { M: 2, L: 2, T: 2, C: 6, S: 4, Q: 4, A: 7, H: 1, V: 1, Z: 0 };
  function shiftPath(t, dx, dy) {
    const tok = t.match(/[A-Za-z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) || [], out = [], r1 = n => Math.round(n * 10) / 10;
    let i = 0, first = true;
    while (i < tok.length) {
      let c = tok[i++];
      const n = PATH_ARGS[c.toUpperCase()];
      if (n == null) return "";
      if (!n) { out.push(c); first = false; continue; }
      for (let g = 0; i + n <= tok.length && !isNaN(tok[i]); g++) {
        const v = tok.slice(i, i + n).map(Number);
        i += n;
        if (v.some(x => !Number.isFinite(x))) return "";
        const abs = c === c.toUpperCase() || (first && c === "m" && g === 0);
        if (abs) {
          const C = c.toUpperCase();
          if (C === "H") v[0] += dx;
          else if (C === "V") v[0] += dy;
          else if (C === "A") { v[5] += dx; v[6] += dy; }
          else v.forEach((x, k) => { v[k] = x + (k % 2 ? dy : dx); });
        }
        out.push((g === 0 ? (first && c === "m" ? "M" : c) : first && c === "m" && g === 1 ? "l" : "") + v.map(r1).join(" "));
      }
      first = false;
    }
    return out.join(" ");
  }

  // Un dibujo a mano alzada con los trazos del modelo. El recuadro se mide con el navegador (getBBox) y se ajusta al
  // dibujo, sin depender de dónde dibujó el modelo, y se escala para que el lado mayor quede entre 120 y 480 px.
  function drawFromAI(trazos, a) {
    const sw = AI_SW[aiStr(a.grosor).toLowerCase()] || (Number.isFinite(a.grosor) ? clamp(Math.round(a.grosor), 1, 12) : 3);
    const d0 = trazos.map(t => shiftPath(t, 0, 0)).filter(Boolean).join(" ");
    if (!d0) return null;
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d0);
    drawTmp.appendChild(path);
    let b = null;
    try { b = path.getBBox(); } catch (e) {}
    path.remove();
    if (!b || ![b.x, b.y, b.width, b.height].every(Number.isFinite) || b.width > 1e4 || b.height > 1e4) return null;
    // El margen es de unos píxeles en pantalla, ya con la escala aplicada
    const m = Math.max(b.width, b.height, 1), k = clamp(1, 260 / m, 480 / m), pad = (sw + 4) / k;
    const vw = Math.ceil(b.width + 2 * pad), vh = Math.ceil(b.height + 2 * pad);
    const d = trazos.map(t => shiftPath(t, pad - b.x, pad - b.y)).filter(Boolean).join(" ");
    // «negro» o «blanco» casi no se ven sobre la hoja oscura o clara: se usa el que contrasta con el tema actual
    let color = aiStr(a.color).toLowerCase();
    if (["negro", "blanco"].includes(color)) color = document.documentElement.dataset.theme === "dark" ? "blanco" : "negro";
    return mk("draw", 0, 0, { w: Math.round(vw * k), h: Math.round(vh * k), vw, vh, d, color: AI_DRAW[color] || "#e03131", sw: Math.max(sw, 3) });
  }

  // Aplica lo que pidió el modelo como un solo cambio (un Ctrl+Z lo deshace entero, también entre hojas). Lo que no
  // se entiende se ignora. Devuelve cuántos cambios hizo; en «did» deja qué hizo, con ids, para el historial del chat.
  function applyAI(actions, did = []) {
    const refs = new Map(), made = [], tilt = getPref("tilt") !== "0", active0 = doc.active, zonesLater = [];
    let sh = sheet(), changes = 0, renamed = false;
    const find = k => typeof k === "string" ? refs.get(k) || sh.items.find(o => o.id === k) : null;
    const before = snapshot();
    // Los creados aquí (o los de otra hoja) aún no se dibujaron: se estima su tamaño
    const est = o => o.type === "text" ? { w: 40 + o.text.length * 24 * (o.s || 1), h: 70 * (o.s || 1) }
      : o.type === "stamp" ? { w: 40 + o.text.length * 13, h: 44 } : o.type === "sticker" ? { w: 90, h: 90 }
      : { w: o.w || 200, h: o.type === "list" ? 60 + 28 * o.tasks.length : o.h || 170 };
    const rectOf = o => elOf(o.id) ? itemRect(o) : { x: o.x, y: o.y, ...est(o) };
    // Hueco libre: columnas a la derecha de lo que ya hay (o en el centro de la vista si la hoja está vacía)
    let free, freeN, nearN;
    const resetFree = () => {
      const rs = sh.items.map(rectOf);
      free = rs.length ? { x: Math.max(...rs.map(r => r.x + r.w)) + 100, y: Math.min(...rs.map(r => r.y)) } : viewCenter();
      freeN = 0; nearN = new Map();
    };
    resetFree();
    const busy = (x, y, w, h) => sh.items.some(o => {
      if (o.type === "zone") return false;
      const r = rectOf(o);
      return x < r.x + r.w + 30 && x + w + 30 > r.x && y < r.y + r.h + 30 && y + h + 30 > r.y;
    });
    // Junto a otro elemento (alrededor, cada vez más lejos) o en la siguiente casilla libre; se salta lo ocupado
    const place = (it, near) => {
      const { w, h } = rectOf(it);
      for (let tries = 0; tries < 40; tries++) {
        let x, y;
        if (near) {
          const r = rectOf(near), k = nearN.get(near.id) || 0;
          const ring = [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]][k % 8], far = 1 + Math.floor(k / 8);
          nearN.set(near.id, k + 1);
          x = r.x + ring[0] * (r.w + 80) * far;
          y = r.y + ring[1] * (Math.max(r.h, 170) + 70) * far;
        } else {
          x = free.x + (freeN % 3) * 280;
          y = free.y + Math.floor(freeN / 3) * 260;
          freeN++;
        }
        it.x = Math.round(x); it.y = Math.round(y);
        if (!busy(x, y, w, h)) return;
      }
    };
    const tell = (verb, it) => {
      const itTxt = (itemText(it) || "").replace(/\s+/g, " ").trim();
      did.push(`${verb} ${AI_NAMES[it.type] || it.type} ${it.id}${itTxt ? ` «${itTxt.length > 40 ? itTxt.slice(0, 40) + "…" : itTxt}»` : ""}`);
    };
    // Una zona alrededor de esos elementos, ordenados en cuadrícula desde x0, y0
    const zoneOf = (its, x0, y0, a) => {
      const sz = its.map(rectOf), cols = Math.ceil(Math.sqrt(its.length));
      const cw = Math.max(...sz.map(r => r.w)) + 30, rh = Math.max(...sz.map(r => r.h)) + 30;
      its.forEach((o, i) => { o.x = x0 + 40 + (i % cols) * cw; o.y = y0 + 56 + Math.floor(i / cols) * rh; });
      const z = mk("zone", x0, y0, { w: cols * cw + 50, h: Math.ceil(its.length / cols) * rh + 76, title: aiStr(a.titulo, 120) || t("editor.tipos.zone"), color: AI_HEX.zone[aiStr(a.color).toLowerCase()] || ZONE_COLORS[zZoneTop % ZONE_COLORS.length] });
      sh.items.push(z); made.push(z); changes++;
      tell("creé", z); // i18n-ok: registro para el modelo
      return z;
    };
    const goSheet = i => {
      sh.view = { ...view };
      doc.active = i; sh = sheet();
      view = sh.view ? { ...sh.view } : { x: 40, y: 20, z: 1 };
      resetFree();
    };
    const setFields = (it, a) => {
      if (a.texto != null && ["note", "card"].includes(it.type)) it.text = aiRich(a.texto);
      // Las notas no tienen título: si el modelo lo manda, va en negrita al principio
      if (aiStr(a.titulo) && it.type === "note") it.text = `<b>${esc(aiStr(a.titulo, 120))}</b>` + (aiStr(a.texto) ? "<br>" + aiRich(a.texto) : "");
      if (a.texto != null && it.type === "text") it.text = aiStr(a.texto, 120) || it.text;
      if (a.texto != null && it.type === "stamp") it.text = aiStr(a.texto, 24).toUpperCase() || it.text;
      if (a.titulo != null && ["card", "list", "zone"].includes(it.type)) it.title = aiStr(a.titulo, 120);
      if (Array.isArray(a.tareas) && it.type === "list") it.tasks = a.tareas.slice(0, 30).map(t => ({ text: aiStr(typeof t === "string" ? t : t?.texto, 200), done: !!t?.hecha }));
      // Los stickers solo aceptan emojis (nada de texto ni imágenes)
      if (it.type === "sticker" && /^\p{Extended_Pictographic}/u.test(aiStr(a.emoji, 16))) it.emoji = aiStr(a.emoji, 16);
      if (a.color != null) {
        const c = aiStr(a.color, 20).toLowerCase();
        if (it.type === "note" && (AI_NOTE[c] || NOTE_COLORS[c])) it.color = AI_NOTE[c] || c;
        if (AI_HEX[it.type]?.[c]) it.color = AI_HEX[it.type][c];
      }
    };
    const create = a => {
      const type = AI_TYPES[a.tipo], it = mk(type, 0, 0);
      if (type === "list") it.tasks = [];
      setFields(it, a);
      if (type === "list" && !it.tasks.length) it.tasks = [{ text: "", done: false }];
      it.rot = type === "zone" ? 0 : ["stamp", "sticker"].includes(type) ? (tilt ? rand(-14, 14) : 0) : tilt ? rand(-3.5, 3.5) : 0;
      it.pin.color = getPref("lastPin") || "#e03131";
      place(it, find(a.cerca));
      sh.items.push(it); made.push(it); changes++;
      if (typeof a.ref === "string") refs.set(a.ref, it);
      tell("creé", it); // i18n-ok: registro para el modelo
      return it;
    };
    for (const a of actions) {
      if (!a || typeof a !== "object") continue;
      if (a.op === "crear" && a.tipo === "zona" && Array.isArray(a.dentro) && a.dentro.length) {
        // La zona se arma al final, cuando ya existe lo que va dentro. Los modelos chicos a veces escriben ahí los
        // elementos enteros en vez de sus refs: se crean en ese momento
        const dentro = a.dentro.slice(0, 40).map(d => d && typeof d === "object" ? (AI_TYPES[d.tipo] && d.tipo !== "zona" ? create(d).id : null) : d);
        zonesLater.push({ a: { ...a, dentro }, sh });
      } else if (a.op === "crear" && AI_TYPES[a.tipo]) {
        create(a);
      } else if (a.op === "dibujar" && Array.isArray(a.trazos)) {
        const it = drawFromAI(a.trazos.slice(0, 60).filter(t => typeof t === "string" && t.length <= 4000 && AI_PATH.test(t)), a);
        if (!it) continue;
        place(it, find(a.cerca));
        sh.items.push(it); made.push(it); changes++;
        if (typeof a.ref === "string") refs.set(a.ref, it);
        tell("dibujé", it); // i18n-ok: registro para el modelo
      } else if (a.op === "unir") {
        const x = find(a.a), y = find(a.b);
        if (!x || !y || x === y || x.fix !== "pin" || y.fix !== "pin") continue;
        if (sh.threads.some(t => (t.a === x.id && t.b === y.id) || (t.a === y.id && t.b === x.id))) continue;
        sh.threads.push(th(x, y, { label: aiStr(a.etiqueta, 40) })); changes++;
        did.push(`uní ${x.id} con ${y.id}`); // i18n-ok: registro para el modelo
      } else if (a.op === "editar") {
        const it = find(a.id);
        if (!it || it.locked) continue;
        setFields(it, a); changes++;
        tell("edité", it); // i18n-ok: registro para el modelo
      } else if (a.op === "mover") {
        const it = find(a.id);
        if (!it || it.locked || !Number.isFinite(a.x) || !Number.isFinite(a.y)) continue;
        it.x = Math.round(clamp(a.x, -1e4, 1e5)); it.y = Math.round(clamp(a.y, -1e4, 1e5)); changes++;
        did.push(`moví ${it.id}`); // i18n-ok: registro para el modelo
      } else if (a.op === "agrupar" && Array.isArray(a.ids)) {
        render(); // los recién creados necesitan su tamaño real
        const its = [...new Set(a.ids.map(find))].filter(o => o && o.type !== "zone" && !o.locked);
        if (!its.length) continue;
        const sz = its.map(rectOf);
        zoneOf(its, Math.min(...sz.map(r => r.x)), Math.min(...sz.map(r => r.y)), a);
      } else if (a.op === "hoja") {
        // Crea una hoja (o va a la que tenga ese nombre) y lo que sigue ocurre ahí; «llevar» pasa elementos con sus hilos
        const name = aiStr(a.nombre, 60);
        if (a.renombrar === true) {
          // Renombra la hoja abierta (mejor que crear otra y dejar esta vacía)
          if (!name || name === sh.name) continue;
          did.push(`renombré la hoja «${sh.name}» a «${name}»`); // i18n-ok: registro para el modelo
          sh.name = name; renamed = true; changes++;
          continue;
        }
        const moving = Array.isArray(a.llevar) ? [...new Set(a.llevar.map(find))].filter(o => o && !o.locked) : [];
        // Una zona viaja con lo que tiene dentro si se llevan todos sus elementos (si no, quedaría vacía)
        const within = (z, o) => { const r = rectOf(o); return r.x >= z.x && r.y >= z.y && r.x + r.w <= z.x + z.w && r.y + r.h <= z.y + z.h; };
        if (moving.length) {
          for (const z of sh.items.filter(o => o.type === "zone" && !moving.includes(o) && !o.locked)) {
            const inside = sh.items.filter(o => o.type !== "zone" && within(z, o));
            if (inside.length && inside.every(o => moving.includes(o))) moving.push(z);
          }
        }
        let i = a.nueva === true || !name ? -1 : doc.sheets.findIndex(s => s.name.toLowerCase() === name.toLowerCase());
        if (i === doc.active) continue;
        // Llevar todo a una hoja nueva dejaría esta vacía: se renombra (los modelos lo piden así aunque se les explique)
        if (i < 0 && name && moving.length && sh.items.every(o => moving.includes(o))) {
          did.push(`renombré la hoja «${sh.name}» a «${name}» (tenía solo eso)`); // i18n-ok: registro para el modelo
          sh.name = name; renamed = true; changes++;
          continue;
        }
        if (i < 0) {
          doc.sheets.push(newSheet(name || `Hoja ${doc.sheets.length + 1}`, { color: Object.keys(NOTE_COLORS)[doc.sheets.length % 5] }));
          i = doc.sheets.length - 1;
          did.push(`creé la hoja «${doc.sheets[i].name}» y fui a ella`); // i18n-ok: registro para el modelo
        } else did.push(`fui a la hoja «${doc.sheets[i].name}»`); // i18n-ok: registro para el modelo
        const from = sh, ids = new Set(moving.map(o => o.id)), rs = moving.map(rectOf);
        goSheet(i);
        if (moving.length) {
          // Conservan cómo estaban entre sí; si la hoja ya tiene cosas, van a su derecha
          const has = sh.items.length > 0, x0 = Math.min(...rs.map(r => r.x)), y0 = Math.min(...rs.map(r => r.y));
          moving.forEach(o => { if (has) { o.x += free.x - x0; o.y += free.y - y0; } });
          sh.items.push(...moving);
          sh.threads.push(...from.threads.filter(t => ids.has(t.a) && ids.has(t.b)));
          from.items = from.items.filter(o => !ids.has(o.id));
          from.threads = from.threads.filter(t => !ids.has(t.a) && !ids.has(t.b));
          made.push(...moving);
          did.push(`llevé ${[...ids].join(", ")} a esa hoja`); // i18n-ok: registro para el modelo
          resetFree();
        }
        changes++;
      } else if (a.op === "borrar") {
        const it = find(a.id);
        if (!it || it.locked) continue;
        sh.items = sh.items.filter(o => o !== it);
        sh.threads = sh.threads.filter(t => t.a !== it.id && t.b !== it.id); changes++;
        did.push(`borré ${it.id}`); // i18n-ok: registro para el modelo
      }
    }
    // Zonas con contenido: cada una en su bloque, en fila a la derecha de lo demás, para que no se pisen
    const later = zonesLater.filter(z => z.sh === sh)
      .map(({ a }) => ({ a, its: [...new Set(a.dentro.map(find))].filter(o => o && o.type !== "zone" && !o.locked) })).filter(g => g.its.length);
    if (later.length) {
      render();
      const inside = new Set(later.flatMap(g => g.its)), rest = sh.items.filter(o => !inside.has(o) && o.type !== "zone").map(rectOf);
      const c = viewCenter(), x0 = rest.length ? Math.max(...rest.map(r => r.x + r.w)) + 120 : Math.round(c.x - 400);
      let x = x0, y = rest.length ? Math.min(...rest.map(r => r.y)) : Math.round(c.y - 250), rowH = 0;
      for (const g of later) {
        const z = zoneOf(g.its, x, y, g.a);
        rowH = Math.max(rowH, z.h);
        x += z.w + 80;
        if (x - x0 > 2200) { x = x0; y += rowH + 80; rowH = 0; }
      }
    }
    if (!changes) return 0;
    undoStack.push(before);
    if (undoStack.length > 200) undoStack.shift();
    redoStack.length = 0;
    updateUndoButtons();
    if (doc.active !== active0) {
      selection = []; selThread = null;
      renderAll();
      sheetsEl.children[doc.active]?.scrollIntoView({ block: "nearest" });
      announce(t("editor.hojas.hoja", { name: sh.name }));
    } else {
      render();
      if (renamed) renderSheets();
    }
    saved();
    const shown = made.filter(o => sh.items.includes(o));
    if (shown.length) {
      setSel(shown.filter(o => o.type !== "zone").map(o => o.id));
      showItems(shown);
      Sound.play("pin");
    }
    return changes;
  }
  window.Editor = {
    boardForAI, applyAI, undo,
    boardId: () => boardId,
    // Texto de los elementos elegidos, para los pedidos rápidos del asistente
    selected: () => selection.map(byId).filter(Boolean).map(describe),
  };

  /* ---------- Hoja vacía: sugerencias para empezar ---------- */
  $("#canvasEmpty").addEventListener("click", e => {
    const b = e.target.closest("[data-start]");
    if (!b) return;
    const k = b.dataset.start;
    if (k === "kanban" || k === "semana" || k === "detective") {
      checkpoint();
      const src = k === "kanban" ? kanbanItems() : k === "semana" ? semanaItems() : TEMPLATES.detective()[0];
      sheet().items.push(...src.items);
      sheet().threads.push(...src.threads);
      if (k === "detective") { sheet().surface = "cork"; applySurface(); }
      render(); saved(); fit();
      return;
    }
    createCenter(k);
  });

  /* ---------- Teclado ---------- */
  const KEY_ACTIONS = {
    undo, redo, selectAll, search: openCmdk, duplicate: duplicateSel, group: groupSel, ungroup: ungroupSel, lock: toggleLock, fit,
    front: () => restack(1), back: () => restack(-1),
    zoom100: () => zoomAt(viewport.clientWidth / 2, viewport.clientHeight / 2, 1),
    prevSheet: () => switchSheet(doc.active - 1), nextSheet: () => switchSheet(doc.active + 1),
    shortcuts: () => showShortcuts(shortcutGroups()),
    eraser: () => { toolLocked = false; if (tool !== "draw") setTool("draw"); setEraser(drawOpts.erase ? null : "part"); },
  };
  function runKey(act) {
    if (act.startsWith("tool.")) { toolLocked = false; return setTool(act.slice(5)); }
    KEY_ACTIONS[act]?.();
  }
  const NATIVE_KEYS = new Set([" ", "Enter", "Tab", "Delete", "Backspace", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "F2"]);
  let nudgeTimer;
  function nudge(dx, dy) {
    const its = selection.map(byId).filter(o => o && !o.locked);
    if (!its.length) return;
    if (Date.now() - lastNudge > 800) checkpoint();
    lastNudge = Date.now();
    its.forEach(o => { o.x += dx; o.y += dy; });
    render(); saved();
    clearTimeout(nudgeTimer);
    nudgeTimer = setTimeout(() => announce(movedMsg(its.length)), 500);
  }
  // Tab recorre los elementos de arriba abajo; pasado el último (o antes del primero) devuelve false
  // y el foco sale del lienzo hacia el resto de la interfaz, para no quedar atrapado
  function cycleSelection(back) {
    const its = [...sheet().items].filter(o => o.type !== "zone").sort((a, b) => a.y - b.y || a.x - b.x);
    const cur = its.findIndex(o => o.id === selection[0]);
    const i = cur < 0 ? (back ? its.length - 1 : 0) : cur + (back ? -1 : 1);
    const next = its[i];
    if (!next) { setSel([]); return false; }
    setSel([next.id]);
    $("#canvasFocus").focus({ preventScroll: true });
    const r = elOf(next.id).getBoundingClientRect(), vr = viewport.getBoundingClientRect();
    if (r.right < vr.left || r.left > vr.right || r.bottom < vr.top || r.top > vr.bottom) centerOn(next);
    announce(`${describe(next)}, ${i + 1} de ${its.length}${next.locked ? ", bloqueado" : ""}`);
    return true;
  }

  // Menú contextual con teclado (tecla Menú o Mayús+F10): junto a lo seleccionado o en el centro de la vista
  let keyMenuAt = 0;
  function keyMenu() {
    keyMenuAt = Date.now();
    stopEdit();
    const vr = viewport.getBoundingClientRect(), cx = vr.left + vr.width / 2, cy = vr.top + vr.height / 2;
    if (selThread) return threadMenu(cx, cy);
    if (selection.length) {
      const r = elOf(selection[0]).getBoundingClientRect();
      return itemMenu(r.left + r.width / 2, r.top + Math.min(r.height / 2, 40));
    }
    canvasMenu(cx, cy, viewCenter());
  }

  document.addEventListener("keydown", e => {
    if ($("#lightbox").classList.contains("open")) {
      if (e.key === "Escape") closeLightbox();
      if (e.key === "ArrowLeft") lbStep(-1);
      if (e.key === "ArrowRight") lbStep(1);
      return;
    }
    if (editing || e.target.isContentEditable || e.target.matches("input, textarea, select") || cmdk.classList.contains("open") || $(".g-backdrop")) return;
    const k = e.key.toLowerCase(), mod = e.ctrlKey || e.metaKey;
    // Con el foco en un botón, enlace o pestaña, estas teclas hacen lo suyo y no actúan sobre el lienzo
    const onControl = e.target.id !== "canvasFocus" && e.target.matches("button, a, [tabindex], [role=tab]");
    if (onControl && !mod && NATIVE_KEYS.has(e.key)) return;

    if (e.key === " ") { e.preventDefault(); if (!spaceDown) { spaceDown = true; viewport.classList.add("space"); } return; }
    // Fijas (ver Keys.RESERVED); las demás se pueden cambiar en Ajustes
    if (mod && e.shiftKey && k === "z") { e.preventDefault(); return redo(); }
    if (mod && e.shiftKey && k === "g") { e.preventDefault(); return ungroupSel(); }
    if (mod && k === "v") pasteBare = e.shiftKey;
    if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) { e.preventDefault(); return keyMenu(); }
    const act = Keys.match(e);
    if (act) { e.preventDefault(); return runKey(act); }
    if (mod || e.altKey) return;

    if (e.key === "Escape") {
      $(".inpop")?.remove();
      if (stickerPop.classList.contains("open")) return stickerPop.classList.remove("open");
      if (tool !== "select") return setTool("select");
      return setSel([]);
    }
    if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); return deleteSel(); }
    if (e.key === "Enter" && tool === "thread" && selection.length === 1) { e.preventDefault(); return threadPick(byId(selection[0]), true); }
    if ((e.key === "Enter" || e.key === "F2") && selection.length === 1) { e.preventDefault(); return edit(byId(selection[0]), null, "end"); }
    if (e.key === "Tab") { if (cycleSelection(e.shiftKey)) e.preventDefault(); return; }
    const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (arrows[e.key] && selection.length) { e.preventDefault(); const [dx, dy] = arrows[e.key], f = e.shiftKey ? 10 : 1; return nudge(dx * f, dy * f); }
  });
  document.addEventListener("keyup", e => {
    if (e.key === " ") { spaceDown = false; viewport.classList.remove("space"); }
  });
  window.addEventListener("resize", () => { placeCtx(); drawMinimap(); });

  /* ---------- Sugerencias contextuales ---------- */
  function checkTips(reason) {
    if (Tour.active || !Tips.enabled) return;
    const sh = sheet(), its = sh.items;
    // Motivo → sugerencia (texto en editor.sugerencias.<id>)
    const tips = { delete: "undo", pan: "pan", multi: "multi", photo: "photo", paste: "paste", repeat: "lock-tool", zoom: "minimap" };
    const tip = (id, action) => Tips.show(id, t("editor.sugerencias." + id), action);
    if (tips[reason]) return tip(tips[reason]);
    const pinned = its.filter(o => o.fix === "pin").length;
    if (pinned >= 3 && !sh.threads.length) return tip("thread");
    if (its.length >= 8 && !its.some(o => o.type === "zone"))
      return tip("zone", { label: t("editor.sugerencias.crearZona"), fn: () => setTool("zone") });
    if (its.length >= 5) return tip("search");
  }

  /* ---------- Atajos y tutorial ---------- */
  // Con las combinaciones actuales (se pueden cambiar en Ajustes); «—» = sin atajo
  const ks = (...ids) => ids.map(id => Keys.label(id) || "—").join(" ");
  // Filas: [clave del nombre en editor.atajos.*, teclas]; las teclas con palabras («Doble-clic») también se traducen
  const K = k => t("editor.atajos.teclas." + k);
  const shortcutGroups = () => [
    ["herramientas", [["seleccionar", ks("tool.select")], ["notaFichaListaTexto", ks("tool.note", "tool.card", "tool.list", "tool.text")], ["imagenEnlaceArchivo", ks("tool.image", "tool.link", "tool.file")], ["stickersZonaDibujo", ks("tool.sticker", "tool.zone", "tool.draw")], ["goma", ks("eraser")], ["hilo", ks("tool.thread")], ["hiloTeclado", "Tab Enter"], ["herramientaFija", K("dobleClic")]]], // i18n-ok: teclas
    ["edicion", [["deshacerRehacer", ks("undo", "redo")], ["copiarCortarPegar", "Ctrl+C Ctrl+X Ctrl+V"], ["duplicar", ks("duplicate")], ["duplicarArrastrando", K("altArrastrar")], ["editar", "Enter"], ["seleccionarTodo", ks("selectAll")], ["recuadro", K("shiftArrastrar")], ["agruparDesagrupar", ks("group", "ungroup")], ["pegarSinMarco", "Ctrl+Shift+V"], ["unoDelGrupo", K("ctrlClic")], ["anadirSeleccion", K("shiftClic")], ["mover", K("flechas")], ["siguienteAnterior", "Tab Shift+Tab"], ["opciones", "Shift+F10"], ["frenteFondo", ks("front", "back")], ["bloquear", ks("lock")], ["eliminar", Keys.show("Delete")], ["verAtajos", ks("shortcuts")]]],
    ["vista", [["buscar", ks("search")], ["moverLienzo", K("arrastrarFondo")], ["zoom", K("rueda")], ["horizontal", K("shiftRueda")], ["zoomAjustar", ks("zoom100", "fit")], ["hojaAnteriorSiguiente", ks("prevSheet", "nextSheet")]]],
    ["chinches", [["tenderHilo", K("arrastrarChinche")], ["moverChinche", K("shiftArrastrar")], ["etiquetaHilo", K("dobleClic")], ["girar", K("arrastrarEsquina")], ["girar15", K("shiftGirar")]]],
  ].map(([g, rows]) => ({ title: t("editor.atajos.grupos." + g), rows: rows.map(([k, keys]) => [t("editor.atajos." + k), keys]) }));

  const T = (n, o) => ({ title: t(`editor.tour.t${n}`), text: t(`editor.tour.p${n}`, o) });
  const noteKey = Keys.label("tool.note");
  Tour.define("editor", [
    { el: null, ...T(1) },
    { el: "#toolbar", place: "right", ...T(2) },
    { el: "#viewport", await: "create:note", task: t(noteKey ? "editor.tour.tarea3" : "editor.tour.tarea3SinAtajo", { key: noteKey }), title: t("editor.tour.t3"), text: t(noteKey ? "editor.tour.p3" : "editor.tour.p3SinAtajo", { key: noteKey }) },
    { el: "#viewport", await: "edit-end", task: t("editor.tour.tarea4"), ...T(4) },
    { el: () => $(".item.sel") || $("#viewport"), await: "move", task: t("editor.tour.tarea5"), ...T(5) },
    { el: "#viewport", await: "thread", task: t("editor.tour.tarea6"), ...T(6) },
    { el: '[data-tool="zone"]', place: "right", ...T(7) },
    { el: "#viewport", await: "pan", task: t("editor.tour.tarea8"), ...T(8) },
    { el: ".bottombar .sheets", place: "top", ...T(9) },
    { el: "#undoGroup", place: "bottom", ...T(10, { key: Keys.label("undo") }) },
    { el: "#searchBtn", place: "bottom", ...T(11, { key: Keys.label("search") }) },
    { el: "#helpBtn", place: "bottom", ...T(12) },
  ]);

  /* ---------- Inicio ---------- */
  const group = Store.group(Store.board(boardId)?.group);
  if (group) {
    $(".crumb .group").innerHTML = `<span class="dot" style="background:${esc(group.color)}"></span>${esc(group.name)} /`; // i18n-ok: nombre del grupo
    $(".back").href = "01-tableros.html?group=" + group.id;
  }
  recalcZ();
  minimap.hidden = getPref("minimap") === "off";
  $("#mmToggle").classList.toggle("active", !minimap.hidden); $("#mmToggle").setAttribute("aria-pressed", !minimap.hidden);
  applyThreadMode();
  // Pistas de la barra con los atajos actuales
  $$("[data-tool], [data-key]").forEach(b => { const k = Keys.label(b.dataset.key || "tool." + b.dataset.tool); b.dataset.tip = b.dataset.tip.replace(/ · [^·]*$/, "") + (k ? " · " + k : ""); });
  renderAll(); enterView();
  renderMyStickers();
  updateUndoButtons();
  setTool("select");
  document.fonts.ready.then(() => { render(); });
  Tour.auto("editor", 900);
  setTimeout(() => checkTips(), 4000);
})();
