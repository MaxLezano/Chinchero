// Vista según la URL: ?group=<id> o ?view=recent|fav (por defecto, recientes)
const params = new URLSearchParams(location.search);
let view = params.get("view"), groupId = params.get("group");
if (groupId && !Store.group(groupId)) groupId = null;
if (!groupId && !view) view = "recent";

// Al abrir la app, vuelve al último tablero (una vez por sesión, si está activado en Ajustes)
if (!location.search && !sessionStorage.getItem("started")) {
  sessionStorage.setItem("started", "1");
  const last = getPref("lastBoardId");
  if (getPref("lastboard") !== "0" && last && Store.board(last)) location.replace("02-tablero.html?board=" + last);
}
sessionStorage.setItem("started", "1");
document.getElementById("sidebar").dataset.active = view || "group:" + groupId;
