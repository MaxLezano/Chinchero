const list = document.getElementById("list");
const lib = Store.library();
const DAY = 86400000;
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function rowHTML(it) {
  const left = Math.max(0, 30 - Math.floor((Date.now() - it.deletedAt) / DAY));
  let thumb, meta;
  if (it.kind === "group") {
    thumb = `<div class="thumb surface-plain" style="display:grid;place-items:center"><span class="group-dot" style="background:${esc(it.group.color)};width:14px;height:14px"></span></div>`;
    meta = `<span class="kind">${t("papelera.grupo")}</span>${t("comun.tableros", { count: it.boards.length })}`;
  } else {
    const b = it.board, g = Store.group(b.group);
    thumb = `<div class="thumb surface-${esc(b.surface || "dots")}"></div>`;
    meta = `<span class="kind">${t("papelera.tablero")}</span>${g ? `<span class="group-dot" style="background:${esc(g.color)}"></span>${esc(g.name)} · ` : ""}${t("comun.elementos", { count: b.items || 0 })}`;
  }
  return `<div class="row" data-id="${esc(it.id)}">${thumb}
    <div><div class="name">${esc(it.name)}</div><div class="meta">${meta}</div></div>
    <div class="days${left <= 3 ? " soon" : ""}">${t("papelera.quedan", { count: left })}</div>
    <div class="actions"><button class="btn" data-a="restore">${t("papelera.restaurar")}</button><button class="btn btn-danger" data-a="delete">${t("papelera.eliminar")}</button></div></div>`;
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
  const id = b.closest(".row").dataset.id, it = lib.trash.find(x => x.id === id);
  if (b.dataset.a === "restore") {
    Store.restore(id);
    toast(t("papelera.restaurado", { name: it.name }));
    location.reload(); // la barra lateral muestra de nuevo el grupo o los contadores
  } else if (confirm(t("papelera.confirmarEliminar", { name: it.name }))) {
    Store.purge(id);
    toast(t("papelera.eliminado", { name: it.name }));
    refresh();
  }
};
document.getElementById("emptyAll").onclick = () => {
  if (!confirm(t("papelera.confirmarVaciar"))) return;
  [...lib.trash].forEach(it => Store.purge(it.id));
  refresh();
};

window.HELP = { tour: "trash" };
Tour.define("trash", [
  { el: null, title: t("papelera.tour.t1"), text: t("papelera.tour.p1") },
  { el: "#list .row", title: t("papelera.tour.t2"), text: t("papelera.tour.p2") },
  { el: "#list .row .actions", place: "left", title: t("papelera.tour.t3"), text: t("papelera.tour.p3") },
  { el: "#emptyAll", place: "bottom", title: t("papelera.tour.t4"), text: t("papelera.tour.p4") },
]);
refresh();
if (lib.trash.length) Tour.auto("trash");
setTimeout(() => Tips.show("trash-undo", t("papelera.sugerenciaDeshacer")), 1500);
