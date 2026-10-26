// Chinchero — web del producto: tema, animaciones, galería y descargas desde GitHub Releases
const CONFIG = { owner: "MaxLezano", repo: "Chinchero" };
const REPO_URL = `https://github.com/${CONFIG.owner}/${CONFIG.repo}`;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/* ---------- Tema ---------- */
(function theme() {
  const root = document.documentElement;
  let saved = null;
  try { saved = localStorage.getItem("site-theme"); } catch (e) {}
  root.dataset.theme = saved || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  $("#themeBtn").onclick = () => {
    root.dataset.theme = root.dataset.theme === "dark" ? "light" : "dark";
    try { localStorage.setItem("site-theme", root.dataset.theme); } catch (e) {}
    showShot();
  };
})();

$$("[data-repo]").forEach(a => a.href = REPO_URL);
addEventListener("scroll", () => $(".nav").classList.toggle("scrolled", scrollY > 10), { passive: true });

/* ---------- Corcho procedural (mismo método que la app: gránulos en un canvas que se repite) ---------- */
function corkTexture() {
  const S = 768, c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d");
  const tones = [["#7a4520", .06], ["#96592a", .13], ["#b5763f", .24], ["#cf955a", .25], ["#e2b07a", .20], ["#f2cc9c", .12]];
  g.fillStyle = "#a8703f"; g.fillRect(0, 0, S, S);
  let seed = 20261024;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const pick = () => { let r = rnd(); for (const [col, w] of tones) if ((r -= w) <= 0) return col; return tones[0][0]; };
  for (let i = 0; i < 16000; i++) {
    const x = rnd() * S, y = rnd() * S, r = 1.5 + rnd() * rnd() * 7, n = 5 + Math.floor(rnd() * 3), a0 = rnd() * 6.28;
    const pts = Array.from({ length: n }, (_, k) => { const a = a0 + k / n * 6.28 + (rnd() - .5) * .6, rr = r * (.6 + rnd() * .55); return [Math.cos(a) * rr, Math.sin(a) * rr]; });
    g.fillStyle = pick();
    for (const dx of [0, -S, S]) for (const dy of [0, -S, S]) {
      if (x + dx < -r || x + dx > S + r || y + dy < -r || y + dy > S + r) continue;
      g.beginPath();
      pts.forEach(([px, py], k) => k ? g.lineTo(x + dx + px, y + dy + py) : g.moveTo(x + dx + px, y + dy + py));
      g.fill();
    }
  }
  return c.toDataURL("image/jpeg", .85);
}
$("#heroBoard").style.backgroundImage = `url(${corkTexture()})`;

/* ---------- Tablero animado del hero ---------- */
(function heroBoard() {
  const board = $("#heroBoard"), cur = $(".cursor", board);
  const els = id => $(`[data-k="${id}"]`, board);
  const moveCursor = (x, y, click) => {
    cur.style.left = x + "%"; cur.style.top = y + "%";
    if (click) setTimeout(() => { cur.classList.remove("click"); void cur.offsetWidth; cur.classList.add("click"); }, 900);
  };
  const show = k => els(k)?.classList.add("in");
  const type = (k, text, speed = 55) => new Promise(res => {
    const el = $(".t", els(k)); el.textContent = ""; el.classList.add("typing");
    let i = 0;
    const tick = () => { el.textContent = text.slice(0, ++i); i < text.length ? setTimeout(tick, speed) : (el.classList.remove("typing"), res()); };
    tick();
  });
  const wait = ms => new Promise(r => setTimeout(r, ms));

  async function run() {
    board.classList.remove("fade");
    $$(".el, path", board).forEach(e => e.classList.remove("in"));
    $$(".list i", board).forEach(i => i.classList.remove("done"));
    moveCursor(70, 105);
    await wait(500);
    moveCursor(22, 26, true); await wait(1000); show("n1"); await wait(400);
    await type("n1", "Ideas para el finde");
    moveCursor(72, 22, true); await wait(1000); show("p1"); await wait(800);
    moveCursor(23.5, 13); await wait(950);
    moveCursor(74, 9); show("t1"); await wait(1100);
    moveCursor(76, 62, true); await wait(1000); show("l1"); await wait(600);
    for (const i of $$(".list i", board).slice(0, 2)) { await wait(450); i.classList.add("done"); }
    show("t2"); await wait(900);
    moveCursor(24, 70, true); await wait(1000); show("n2"); await wait(300);
    await type("n2", "¡Llevar cámara!");
    show("s1"); await wait(500);
    moveCursor(4, 4); await wait(900); show("z1"); await wait(1400);
    moveCursor(70, 105); await wait(2600);
    board.classList.add("fade"); await wait(900);
    run();
  }
  if (reduced) { $$(".el, path", board).forEach(e => e.classList.add("in")); $$("[data-k] .t", board).forEach(t => t.textContent = t.dataset.text); }
  else run();
})();

/* ---------- Aparición al hacer scroll y pausa de demos fuera de pantalla ---------- */
const io = new IntersectionObserver(entries => entries.forEach(e => {
  if (e.target.classList.contains("reveal") && e.isIntersecting) e.target.classList.add("visible");
  if (e.target.classList.contains("demo")) e.target.classList.toggle("paused", !e.isIntersecting);
}), { threshold: .12 });
$$(".reveal, .demo").forEach(el => io.observe(el));

/* ---------- Galería de capturas ---------- */
const SHOTS = {
  editor: ["editor", "Tu tablero: notas, fotos, listas, stickers y zonas, todo unido con hilos."],
  detective: ["detective", "Plantilla Detective sobre corcho: fotos, pistas e hilos con etiquetas."],
  kanban: ["kanban", "Kanban con zonas: mueve una zona y se mueve todo lo que tiene dentro."],
  select: ["editor-select", "Selecciona un elemento para cambiar marco, encuadre, chinche o bloquearlo."],
  search: ["search", "Ctrl+K: encuentra cualquier nota, foto o lista en todas las hojas."],
  boards: ["boards", "Tus tableros organizados en grupos, con miniaturas, favoritos y recientes."],
  settings: ["settings", "Tema claro u oscuro, color de los hilos, letra de las notas y copias de seguridad."],
};
let currentShot = "editor";
function showShot(key = currentShot) {
  currentShot = key;
  const [file, caption] = SHOTS[key], theme = document.documentElement.dataset.theme;
  const img = $("#shotImg");
  img.style.opacity = .3;
  const next = new Image();
  next.onload = () => { img.src = next.src; img.alt = caption; img.style.opacity = 1; };
  next.src = `assets/screens/${file}-${theme}.webp`;
  $("#shotCaption").textContent = caption;
  $$(".tab").forEach(t => {
    const on = t.dataset.shot === key;
    t.classList.toggle("active", on);
    t.setAttribute("aria-selected", on);
    t.tabIndex = on ? 0 : -1;
  });
}
$(".tabs").onclick = e => { const t = e.target.closest(".tab"); if (t) showShot(t.dataset.shot); };
// Pestañas con teclado: flechas, Inicio y Fin
$(".tabs").onkeydown = e => {
  const tabs = $$(".tab"), i = tabs.findIndex(t => t.dataset.shot === currentShot);
  const j = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
  if (j === undefined) return;
  e.preventDefault();
  const t = tabs[(j + tabs.length) % tabs.length];
  showShot(t.dataset.shot); t.focus();
};
showShot();

/* ---------- Descargas: releases públicas del repositorio ---------- */
// Markdown mínimo para las notas de versión (títulos, listas, negrita, enlaces)
function md(text) {
  const inline = s => esc(s)
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
    .replace(/`(.+?)`/g, "<code>$1</code>")
    .replace(/\[(.+?)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  let html = "", inList = false;
  for (const raw of (text || "").split(/\r?\n/)) {
    const line = raw.trim();
    const li = line.match(/^[-*]\s+(.*)/);
    if (li) { if (!inList) { html += "<ul>"; inList = true; } html += `<li>${inline(li[1])}</li>`; continue; }
    if (inList) { html += "</ul>"; inList = false; }
    const h = line.match(/^#{1,6}\s+(.*)/);
    if (h) html += `<h4>${inline(h[1])}</h4>`;
    else if (line) html += `<p>${inline(line)}</p>`;
  }
  return html + (inList ? "</ul>" : "");
}
const fmtDate = d => new Date(d).toLocaleDateString("es-AR", { day: "numeric", month: "long", year: "numeric" });
const fmtSize = b => (b / 1048576).toFixed(0) + " MB";
const installer = r => r.assets.find(a => /\.exe$/i.test(a.name));

async function fetchReleases() {
  const KEY = "releases-cache";
  try {
    const c = JSON.parse(sessionStorage.getItem(KEY));
    if (c && Date.now() - c.at < 10 * 60 * 1000) return c.data;
  } catch (e) {}
  const res = await fetch(`https://api.github.com/repos/${CONFIG.owner}/${CONFIG.repo}/releases?per_page=30`, { headers: { Accept: "application/vnd.github+json" } });
  if (!res.ok) throw new Error(res.status);
  const data = (await res.json()).filter(r => !r.draft);
  try { sessionStorage.setItem(KEY, JSON.stringify({ at: Date.now(), data })); } catch (e) {}
  return data;
}

function noReleases(msg) {
  $("#latest").innerHTML = `<div class="ver"><h3>Muy pronto</h3></div>
    <p class="meta">${msg}</p>
    <a class="btn" href="${esc(REPO_URL)}/releases" target="_blank" rel="noopener">Ver releases en GitHub</a>`;
  $("#versions").innerHTML = '<li style="padding:14px 4px;color:var(--muted)">Aquí aparecerá el historial de versiones.</li>';
  $$(".dl-btn").forEach(b => { b.href = "#descargar"; $(".dl-ver", b).textContent = "Próximamente"; });
}

fetchReleases().then(list => {
  const stable = list.filter(r => !r.prerelease);
  const latest = stable[0] || list[0];
  if (!latest) return noReleases("Todavía no hay versiones publicadas. Vuelve en unos días.");
  const exe = installer(latest);
  const downloads = list.reduce((n, r) => n + r.assets.reduce((m, a) => m + (/\.exe$/i.test(a.name) ? a.download_count : 0), 0), 0);
  const href = esc(exe ? exe.browser_download_url : latest.html_url);
  $$(".dl-btn").forEach(b => { b.href = exe ? exe.browser_download_url : latest.html_url; $(".dl-ver", b).textContent = latest.tag_name; });
  $("#latest").innerHTML = `
    <div class="ver"><h3>${esc(latest.name || latest.tag_name)}</h3><span class="badge">${latest.prerelease ? "Beta" : "Última versión"}</span></div>
    <p class="meta">Publicada el ${fmtDate(latest.published_at)}${exe ? ` · ${fmtSize(exe.size)}` : ""}${downloads ? ` · ${downloads.toLocaleString("es-AR")} descargas` : ""}</p>
    <a class="btn btn-primary" href="${href}">${ICON_WIN} Descargar instalador <small>${esc(latest.tag_name)}</small></a>
    <div class="notes">${md(latest.body) || "<p>Sin notas para esta versión.</p>"}</div>`;
  // Cerradas: las notas de la última ya se ven arriba
  $("#versions").innerHTML = list.map(r => {
    const e = installer(r);
    return `<li><details><summary>${esc(r.tag_name)}${r.prerelease ? " · beta" : ""} <small>${fmtDate(r.published_at)}</small></summary>
      <div class="vbody">${md(r.body) || "<p>Sin notas.</p>"}${e ? `<a class="btn" href="${esc(e.browser_download_url)}">Descargar ${esc(r.tag_name)} · ${fmtSize(e.size)}</a>` : ""}</div></details></li>`;
  }).join("");
}).catch(() => noReleases("No pudimos consultar las versiones ahora mismo. Puedes verlas directamente en GitHub."));

const ICON_WIN = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3 5.5 10.5 4.5v7H3zM11.5 4.4 21 3v8.5h-9.5zM3 12.5h7.5v7L3 18.5zM11.5 12.5H21V21l-9.5-1.4z"/></svg>';
