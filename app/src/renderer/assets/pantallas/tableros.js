const $ = s => document.querySelector(s);
const grid = $("#grid");
const lib = Store.library();
const group = groupId ? Store.group(groupId) : null;
const NOTE = { yellow: "var(--note-yellow)", blue: "var(--note-blue)", pink: "var(--note-pink)", green: "var(--note-green)", purple: "var(--note-purple)", orange: "#ffc078", white: "#f8f9fa" };
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
let chip = "all";

$("#title").innerHTML = group
  ? `<span class="group-dot" style="background:${esc(group.color)};width:14px;height:14px"></span>${esc(group.name)}`
  : view === "fav" ? "Favoritos" : "Recientes";
if (view === "recent") $("#sort").closest(".sort").hidden = true;

// Miniatura: coordenadas ya normalizadas por el editor (0..1 dentro del recuadro de la tarjeta)
function miniHTML(p) {
  const st = esc(`left:${p.x * 100}%;top:${p.y * 100}%;width:${Math.max(2, p.w * 100)}%;height:${Math.max(3, p.h * 100)}%;transform:rotate(${p.r || 0}deg)`);
  const pinAt = p.px != null ? `;left:${+p.px * 100}%;top:${+p.py * 100}%` : "";
  const pin = p.pin ? `<span class="pin" style="--pin:${esc(p.pc || "#e03131")}${esc(pinAt)}"></span>` : "";
  switch (p.t) {
    case "zone": return `<i class="pv zone" style="${st};--zc:${esc(p.c)}"></i>`;
    case "note": return `<i class="pv note" style="${st};background:${esc(NOTE[p.c] || NOTE.yellow)}">${pin}</i>`;
    case "photo": return `<i class="pv photo" style="${st}">${pin}</i>`;
    case "stamp": return `<i class="pv stamp" style="${st};background:${esc(p.c || "#e03131")}"></i>`;
    case "sticker": return `<i class="pv dot" style="${st};background:${esc(p.c || "#fab005")}"></i>`;
    case "text": return `<i class="pv text" style="${st}"></i>`;
    case "draw": return `<i class="pv draw" style="${st};border-color:${esc(p.c)}"></i>`;
    default: return `<i class="pv paper" style="${st}">${pin}</i>`;
  }
}
// Hilos de la miniatura: SVG de 0..100 estirado sobre el recuadro (el trazo no se deforma) y chinches encima
function threadsHTML(ts) {
  if (!ts?.length) return "";
  const n = v => Number.isFinite(+v) ? +v * 100 : 0;
  const pt = ([x, y]) => `${n(x).toFixed(1)} ${n(y).toFixed(1)}`;
  const head = ([x, y], c) => `<span class="pin th-pin" style="${esc(`left:${n(x)}%;top:${n(y)}%;--pin:${c || "#e03131"}`)}"></span>`;
  return `<svg class="th" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${ts.map(t =>
    `<path d="M${pt(t.a)} Q${pt(t.m)} ${pt(t.b)}" style="stroke:${esc(t.c || "var(--thread)")}"/>`).join("")}</svg>`
    + ts.map(t => head(t.a, t.ac) + head(t.b, t.bc)).join("");
}

function cardHTML(b) {
  const g = Store.group(b.group);
  const n = b.sheets || 1;
  return `<a class="card${b.fav ? " fav" : ""}" href="02-tablero.html?board=${encodeURIComponent(b.id)}" data-id="${esc(b.id)}">
    <button class="fav-btn" aria-label="${b.fav ? "Quitar de favoritos" : "Añadir a favoritos"}"><svg class="icon"><use href="#i-star"/></svg></button>
    <div class="thumb surface-${esc(b.surface || "dots")}"><div class="pv-box">${(b.preview || []).map(miniHTML).join("")}${threadsHTML(b.previewThreads)}</div>
      ${!group && g ? `<span class="gchip"><span class="group-dot" style="background:${esc(g.color)}"></span>${esc(g.name)}</span>` : ""}</div>
    <div class="card-body"><div class="card-title">${esc(b.name)}</div>
      <div class="card-meta">${n} hoja${n > 1 ? "s" : ""} · ${esc(b.items || 0)} elemento${b.items === 1 ? "" : "s"} · ${relTime(b.updatedAt)}</div></div></a>`;
}

const sameDay = ts => ts && new Date(ts).toDateString() === new Date().toDateString();

function render() {
  const q = $("#search").value.trim().toLowerCase();
  const sort = view === "recent" ? "date" : $("#sort").value;
  const list = lib.boards
    .filter(b => group ? b.group === group.id : view !== "fav" || b.fav)
    .filter(b => chip === "all" || (chip === "today" ? sameDay(b.updatedAt) : b.hasImages))
    .filter(b => b.name.toLowerCase().includes(q))
    .sort((a, b) => sort === "name" ? a.name.localeCompare(b.name) : (b.updatedAt || 0) - (a.updatedAt || 0));
  grid.innerHTML = list.map(cardHTML).join("")
    + (group ? '<button class="new-card" id="newCard"><svg class="icon" style="width:28px;height:28px"><use href="#i-plus"/></svg>Nuevo tablero</button>' : "");
  setGroupCounts();

  const empty = !list.length;
  grid.style.display = empty ? "none" : "";
  $("#empty").classList.toggle("show", empty);
  if (empty) {
    const filtering = q || chip !== "all";
    const none = !lib.boards.length;
    $("#emptyTitle").textContent = filtering ? "Sin resultados" : none ? "Aún no tienes tableros" : view === "fav" ? "Aún no hay favoritos" : "Este grupo está vacío";
    $("#emptyText").textContent = filtering ? "Prueba con otro nombre o quita los filtros."
      : view === "fav" && !none ? "Pulsa la ⭐ de un tablero para tenerlo siempre a mano." : "Crea un tablero en blanco o empieza con una plantilla.";
    $("#emptyBtn").style.display = filtering || (view === "fav" && !none) ? "none" : "";
  }
}

$("#search").oninput = render;
$(".search kbd").textContent = Keys.label("findBoard").replace("+", " ");
$(".search kbd").hidden = !Keys.get("findBoard");
$("#sort").onchange = render;
$("#chips").onclick = e => {
  const b = e.target.closest(".chip"); if (!b) return;
  $("#chips .active").setAttribute("aria-pressed", "false"); $("#chips .active").classList.remove("active");
  b.classList.add("active"); b.setAttribute("aria-pressed", "true");
  chip = b.dataset.f; render();
};
document.addEventListener("groups-changed", render);

grid.addEventListener("click", e => {
  const fav = e.target.closest(".fav-btn"); if (!fav) return;
  e.preventDefault();
  const b = Store.board(fav.closest(".card").dataset.id);
  Store.touch(b.id, { fav: !b.fav });
  toast(b.fav ? "Añadido a favoritos" : "Quitado de favoritos");
  render();
});

/* ---------- Mover tableros de grupo ---------- */
function moveTo(id, gid) {
  const b = Store.board(id);
  if (!b || b.group === gid) return;
  const from = b.group;
  Store.touch(id, { group: gid });
  render();
  toast(`Movido a «${Store.group(gid).name}»`, "Deshacer", () => { Store.touch(id, { group: from }); render(); });
}
grid.addEventListener("dragstart", e => {
  const c = e.target.closest(".card"); if (!c) return;
  e.dataTransfer.setData("text/board", c.dataset.id);
  e.dataTransfer.effectAllowed = "move";
  c.classList.add("dragging");
});
grid.addEventListener("dragend", e => e.target.closest?.(".card")?.classList.remove("dragging"));
document.addEventListener("board-move", e => moveTo(e.detail.board, e.detail.group));

/* ---------- Acciones sobre un tablero ---------- */
function rename(id) {
  const title = grid.querySelector(`[data-id="${id}"] .card-title`);
  title.contentEditable = "true"; title.focus();
  document.getSelection().selectAllChildren(title);
  title.onclick = ev => ev.preventDefault();
  title.onkeydown = ev => { if (ev.key === "Enter" || ev.key === "Escape") { ev.preventDefault(); title.blur(); } };
  title.onblur = () => {
    title.contentEditable = "false";
    Store.touch(id, { name: title.textContent.trim() || "Sin título" });
    render();
  };
}
function duplicate(id) {
  const b = Store.board(id), doc = Store.loadBoard(id);
  const copy = { ...JSON.parse(JSON.stringify(b)), id: Store.uid(), name: b.name + " (copia)", fav: false, createdAt: Date.now(), updatedAt: Date.now() };
  if (doc) Store.saveBoard(copy.id, { ...doc, name: copy.name });
  lib.boards.push(copy);
  Store.saveLibrary();
  render(); toast("Tablero duplicado");
}
function remove(id) {
  const entry = Store.trashBoard(id);
  render();
  toast("Tablero enviado a la papelera", "Deshacer", () => { Store.restore(entry.id); render(); });
}

/* ---------- Compartir: exportar e importar .chinchero ---------- */
async function exportBoard(id) {
  if (await Store.desktop("exportBoard", id, Store.board(id).name)) toast("Tablero exportado. Quien lo reciba lo abre con doble clic o lo arrastra a Chinchero");
}
async function importBoards(files) {
  const added = [];
  for (const f of files) { const b = await Store.importBoard(f, groupId); if (b) added.push(b); }
  if (!added.length) return;
  render();
  if (added.length === 1) toast(`Tablero «${added[0].name}» importado`, "Abrir", () => location.href = "02-tablero.html?board=" + added[0].id);
  else toast(`${added.length} tableros importados`);
}
$("#importBtn").onclick = () => importBoards([null]);
// Arrastrar archivos .chinchero a la ventana (las tarjetas arrastradas no traen "Files")
document.addEventListener("dragover", e => { if (e.dataTransfer.types.includes("Files")) e.preventDefault(); });
document.addEventListener("drop", e => {
  if (!e.dataTransfer.files.length) return;
  e.preventDefault();
  const files = [...e.dataTransfer.files].filter(f => /\.chinchero$/i.test(f.name));
  files.length ? importBoards(files) : toast("Aquí solo se pueden soltar tableros compartidos (.chinchero)");
});
// Abiertos con doble clic: si es uno solo, se abre directamente
const opened = params.get("abrir") ? Store.takeOpened() : [];
if (opened.length) (async () => {
  const added = [];
  for (const p of opened) { const b = await Store.importBoard(p); if (b) added.push(b); }
  if (added.length === 1) {
    try { sessionStorage.setItem("chinchero-aviso", `Tablero «${added[0].name}» importado`); } catch {}
    location.replace("02-tablero.html?board=" + added[0].id);
  } else if (added.length) { render(); toast(`${added.length} tableros importados`); }
})();

grid.addEventListener("contextmenu", e => {
  const card = e.target.closest(".card");
  if (!card) return;
  e.preventDefault();
  const id = card.dataset.id, b = Store.board(id);
  showMenu(e.clientX, e.clientY, [
    { label: "Abrir", kbd: "Enter", action: () => card.click() },
    { label: b.fav ? "Quitar de favoritos" : "Añadir a favoritos", action: () => { Store.touch(id, { fav: !b.fav }); render(); } },
    { label: "Renombrar", kbd: "F2", action: () => rename(id) },
    { label: "Duplicar", action: () => duplicate(id) },
    { label: "Exportar tablero…", action: () => exportBoard(id) },
    { label: "Mover a grupo…", action: () => showMenu(e.clientX + 12, e.clientY + 12,
      lib.groups.filter(g => g.id !== b.group).map(g => ({ label: "→ " + g.name, action: () => moveTo(id, g.id) }))) },
    "-",
    { label: "Eliminar", kbd: "Supr", danger: true, action: () => remove(id) },
  ]);
});
grid.addEventListener("keydown", e => {
  const card = e.target.closest?.(".card"); if (!card || e.target !== card) return;
  if (e.key === "F2") { e.preventDefault(); rename(card.dataset.id); }
  if (e.key === "Delete") remove(card.dataset.id);
});

/* ---------- Sugerencias ---------- */
const SUGGESTIONS = [
  { id: "templates", em: "🧩", title: "Empieza con una plantilla", text: "Detective, Kanban, Semana, Moodboard o Viaje: tableros listos para rellenar.", cta: "Ver plantillas", fn: () => openModal("detective") },
  { id: "backup", em: "💾", title: "Haz una copia de seguridad", text: "Guarda una copia de tus tableros en un USB o en una carpeta de la nube.", cta: "Ir a Datos", fn: () => location.href = "03-ajustes.html#datos" },
  { id: "dragcards", em: "🗂️", title: "Ordena arrastrando", text: "Arrastra una tarjeta sobre un grupo de la izquierda para moverla.", cta: "Entendido", fn: () => {} },
];
function renderSuggestions() {
  const box = $("#suggest");
  const list = Tips.enabled && lib.boards.length ? SUGGESTIONS.filter(s => getPref("sug-" + s.id) === null) : [];
  box.hidden = !list.length || view === "fav";
  box.innerHTML = list.map(s => `<div class="sug" data-id="${s.id}"><span class="em">${s.em}</span><div><b>${s.title}</b><p>${s.text}</p><button class="link">${s.cta} →</button></div><button class="x" aria-label="Descartar sugerencia">✕</button></div>`).join("");
}
$("#suggest").onclick = e => {
  const el = e.target.closest(".sug"); if (!el) return;
  const s = SUGGESTIONS.find(x => x.id === el.dataset.id);
  if (e.target.closest(".x, .link")) { setPref("sug-" + s.id, "1"); renderSuggestions(); }
  if (e.target.closest(".link")) s.fn();
};

/* ---------- Nuevo tablero ---------- */
const modal = $("#modal");
function pickOpt(box, v) { box.querySelectorAll(".opt").forEach(o => { o.classList.toggle("selected", o.dataset.v === v); o.setAttribute("aria-pressed", o.dataset.v === v); }); }
let releaseModal = null;
function openModal(template = "blank") {
  $("#groupSelect").innerHTML = lib.groups.map(g => `<option value="${g.id}" ${g.id === (groupId || lib.groups[0]?.id) ? "selected" : ""}>${esc(g.name)}</option>`).join("");
  pickOpt($("#templates"), template);
  pickOpt($("#surfaces"), getPref("surface") || "dots");
  modal.classList.add("open");
  $("#boardName").value = "Sin título";
  releaseModal ??= trapFocus($("#newForm"), $("#boardName"));
  $("#boardName").select();
}
function closeModal() {
  if (!modal.classList.contains("open")) return;
  modal.classList.remove("open");
  releaseModal?.(); releaseModal = null;
}
modal.onclick = e => { if (e.target === modal) closeModal(); };
$("#cancelModal").onclick = () => closeModal();
$("#newBtn").onclick = $("#emptyBtn").onclick = () => openModal();
// La tarjeta «Nuevo tablero» se vuelve a dibujar con la lista
document.addEventListener("click", e => { if (e.target.closest("#newCard")) openModal(); });
["#templates", "#surfaces"].forEach(id => $(id).onclick = e => {
  const o = e.target.closest(".opt"); if (o) pickOpt($(id), o.dataset.v);
});
$("#newForm").onsubmit = e => {
  e.preventDefault();
  const q = new URLSearchParams({
    new: "1", template: $("#templates .selected").dataset.v, surface: $("#surfaces .selected").dataset.v,
    group: $("#groupSelect").value, name: $("#boardName").value.trim() || "Sin título",
  });
  location.href = "02-tablero.html?" + q;
};

document.addEventListener("keydown", e => {
  if (e.key === "Escape") closeModal();
  // Mientras se escribe, solo cuentan los atajos con Ctrl o Alt
  const typing = e.target.matches("input, textarea, select, [contenteditable=true]");
  const act = typing && !e.ctrlKey && !e.altKey ? null : Keys.match(e);
  if (act === "newBoard") { e.preventDefault(); openModal(); }
  if (act === "findBoard") { e.preventDefault(); $("#search").focus(); }
  if (act === "shortcuts") showShortcuts(HELP.shortcuts);
});

/* ---------- Ayuda y tutorial ---------- */
window.HELP = {
  tour: "boards",
  shortcuts: [
    { title: "Tableros", rows: [["Nuevo tablero", Keys.label("newBoard")], ["Buscar", Keys.label("findBoard")], ["Abrir tablero enfocado", "Enter"], ["Renombrar", "F2"], ["Eliminar", "Supr"], ["Ver atajos", Keys.label("shortcuts")]] },
  ],
};
Tour.define("boards", [
  { el: null, title: "¡Estos son tus tableros!", text: "Te enseño esta pantalla en menos de un minuto. Puedes saltarlo y volver a verlo con el botón <b>?</b> de abajo a la izquierda." },
  { el: "#groupList", place: "right", title: "Grupos", text: "Organiza tus tableros en grupos como <b>Trabajo</b> o <b>Personal</b>. Usa <b>+</b> para crear uno y clic derecho para renombrarlo o cambiar su color." },
  { el: () => document.querySelector('.sidebar a[href*="view=fav"]'), place: "right", title: "Favoritos y recientes", text: "Marca un tablero con la ⭐ y lo tendrás siempre en <b>Favoritos</b>. <b>Recientes</b> muestra lo último que editaste." },
  { el: () => grid.querySelector(".card"), title: "Cada tarjeta es un tablero", text: "Haz clic para abrirlo. Con <b>clic derecho</b> lo renombras, duplicas, mueves o exportas para compartirlo. También puedes <b>arrastrarlo</b> sobre un grupo de la izquierda." },
  { el: ".search", title: "Busca y filtra", text: `Escribe parte del nombre (atajo <b>${Keys.label("findBoard")}</b>) o usa los filtros de abajo.` },
  { el: "#newBtn", place: "bottom", title: "Crea un tablero", text: `Elige nombre, grupo, fondo y, si quieres, una <b>plantilla</b> para no empezar de cero. Atajo: <b>${Keys.label("newBoard")}</b>.` },
  { el: "#helpBtn", place: "right", title: "¿Dudas?", text: "Desde aquí vuelves a ver este tutorial, consultas los atajos o activas y desactivas las sugerencias." },
]);

render();
renderSuggestions();
Tour.auto("boards");
setTimeout(() => {
  if (!Tour.active && lib.boards.length > 2 && !lib.boards.some(b => b.fav))
    Tips.show("fav", "Marca con la ⭐ los tableros que más uses para encontrarlos rápido en Favoritos.");
}, 1500);
