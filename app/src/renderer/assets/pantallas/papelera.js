const list = document.getElementById("list");
const lib = Store.library();
const DAY = 86400000;
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function rowHTML(t) {
  const left = Math.max(0, 30 - Math.floor((Date.now() - t.deletedAt) / DAY));
  let thumb, meta;
  if (t.kind === "group") {
    thumb = `<div class="thumb surface-plain" style="display:grid;place-items:center"><span class="group-dot" style="background:${esc(t.group.color)};width:14px;height:14px"></span></div>`;
    meta = `<span class="kind">Grupo</span>${t.boards.length} tablero${t.boards.length === 1 ? "" : "s"}`;
  } else {
    const b = t.board, g = Store.group(b.group);
    thumb = `<div class="thumb surface-${esc(b.surface || "dots")}"></div>`;
    meta = `<span class="kind">Tablero</span>${g ? `<span class="group-dot" style="background:${esc(g.color)}"></span>${esc(g.name)} · ` : ""}${esc(b.items || 0)} elementos`;
  }
  return `<div class="row" data-id="${esc(t.id)}">${thumb}
    <div><div class="name">${esc(t.name)}</div><div class="meta">${meta}</div></div>
    <div class="days${left <= 3 ? " soon" : ""}">quedan ${left} día${left === 1 ? "" : "s"}</div>
    <div class="actions"><button class="btn" data-a="restore">Restaurar</button><button class="btn btn-danger" data-a="delete">Eliminar</button></div></div>`;
}

function refresh() {
  list.innerHTML = lib.trash.map(rowHTML).join("");
  const empty = !lib.trash.length;
  list.style.display = empty ? "none" : "";
  document.getElementById("empty").classList.toggle("show", empty);
  document.getElementById("emptyAll").disabled = empty;
  setGroupCounts();
}

list.onclick = e => {
  const b = e.target.closest("[data-a]"); if (!b) return;
  const id = b.closest(".row").dataset.id, t = lib.trash.find(x => x.id === id);
  if (b.dataset.a === "restore") {
    Store.restore(id);
    toast(`«${t.name}» restaurado`);
    location.reload(); // la barra lateral muestra de nuevo el grupo o los contadores
  } else if (confirm(`¿Eliminar «${t.name}» para siempre? No se puede deshacer.`)) {
    Store.purge(id);
    toast(`«${t.name}» eliminado`);
    refresh();
  }
};
document.getElementById("emptyAll").onclick = () => {
  if (!confirm("¿Vaciar la papelera? Todo se eliminará para siempre.")) return;
  [...lib.trash].forEach(t => Store.purge(t.id));
  refresh();
};

window.HELP = { tour: "trash" };
Tour.define("trash", [
  { el: null, title: "La papelera", text: "Lo que eliminas (tableros o grupos) espera aquí 30 días antes de borrarse para siempre." },
  { el: "#list .row", title: "Cada fila es algo eliminado", text: "Ves qué es, de dónde venía y cuántos días le quedan. En <b>rojo</b>, lo que está a punto de borrarse." },
  { el: "#list .row .actions", place: "left", title: "Restaurar o eliminar", text: "<b>Restaurar</b> lo devuelve a su sitio. <b>Eliminar</b> lo borra para siempre: te pediremos confirmación." },
  { el: "#emptyAll", place: "bottom", title: "Vaciar", text: "Borra todo de una vez. Úsalo con cuidado: no se puede deshacer." },
]);
refresh();
if (lib.trash.length) Tour.auto("trash");
setTimeout(() => Tips.show("trash-undo", "Para recuperar algo que acabas de borrar dentro de un tablero, no hace falta venir aquí: pulsa <b>Ctrl+Z</b> en el propio tablero."), 1500);
