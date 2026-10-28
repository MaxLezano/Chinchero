// Interruptores enlazados a preferencias (data-on/data-off: valores guardados; por defecto "1"/"0")
document.querySelectorAll("[data-pref]").forEach(input => {
  const k = input.dataset.pref, onV = input.dataset.on || "1", offV = input.dataset.off || "0";
  const cur = getPref(k);
  input.checked = cur === null ? input.dataset.default === "1" : cur === onV;
  input.onchange = () => { setPref(k, input.checked ? onV : offV); toast(t("ajustes.guardado")); };
});
// Sonidos: al encenderlos o mover el volumen se escucha una muestra
const sounds = document.getElementById("sounds"), vol = document.getElementById("soundVol"), volOut = document.getElementById("soundVolOut");
const markVol = () => {
  document.getElementById("volRow").classList.toggle("off", !sounds.checked);
  vol.disabled = !sounds.checked;
  volOut.textContent = vol.value + " %";
};
vol.value = Math.round(Sound.volume() * 100);
markVol();
sounds.addEventListener("change", () => { markVol(); if (sounds.checked) Sound.play("pin"); });
vol.oninput = () => { volOut.textContent = vol.value + " %"; };
vol.onchange = () => { setPref("soundVol", vol.value); Sound.play("pin"); };
document.getElementById("resetTours").onclick = () => {
  Tour.resetAll(); setPref("tours", "on"); setPref("tips", "on");
  document.querySelector('[data-pref="tours"]').checked = true;
  document.querySelector('[data-pref="tips"]').checked = true;
  toast(t("ayuda.volveranAAparecer"));
};

/* ---------- Datos reales de la app ---------- */
const info = Store.info(), lib = Store.library();
document.getElementById("dataPath").textContent = info.dataDir;
document.getElementById("version").textContent = info.version;
const mb = n => (n / 1048576).toFixed(n > 10485760 ? 0 : 1).replace(".", ",") + " MB";
const usage = document.getElementById("usage");
const nb = lib.boards.length;
// Los textos que dependen de datos se vuelven a escribir al cambiar el idioma (con lo último que se midió)
let stats = null, unusedInfo = null;
const paintUsage = () => {
  if (!Store.native) usage.textContent = t("ajustes.usoNavegador", { boards: t("comun.tableros", { count: nb }) });
  else if (stats) usage.textContent = t("ajustes.uso", { size: mb(stats.bytes), boards: t("comun.tableros", { count: nb }), images: t("ajustes.imagenes", { count: stats.images }) });
};
const showUsage = () => window.chinchero.dataStats().then(st => { stats = st; paintUsage(); });
if (Store.native) showUsage();
else paintUsage();

// Liberar espacio: imágenes y archivos de la carpeta que ningún tablero, papelera ni copia automática usa
const unused = document.getElementById("unused"), cleanBtn = document.getElementById("cleanBtn");
const size = n => n < 1048576 ? Math.max(1, Math.round(n / 1024)) + " KB" : mb(n);
const paintUnused = () => {
  const u = unusedInfo;
  if (!Store.native) unused.textContent = t("comun.soloEscritorio") + ".";
  else if (u) unused.textContent = u.count ? t("ajustes.sinUsar", { count: u.count, size: size(u.bytes) }) + " " + t("ajustes.seConservan")
    : u.bytes ? t("ajustes.miniaturasSinUsar", { size: size(u.bytes) }) : t("ajustes.nadaQueBorrar") + " " + t("ajustes.seConservan");
};
const showUnused = async () => {
  const u = unusedInfo = await window.chinchero.unusedMedia();
  cleanBtn.disabled = !u.bytes;
  cleanBtn.dataset.mb = size(u.bytes);
  paintUnused();
};
if (Store.native) showUnused();
else paintUnused();
cleanBtn.onclick = async () => {
  if (!confirm(t("ajustes.confirmarLiberar", { size: cleanBtn.dataset.mb }))) return;
  cleanBtn.disabled = true;
  const r = await window.chinchero.cleanMedia();
  toast(r.bytes ? t("ajustes.liberado", { size: size(r.bytes) }) : t("ajustes.nadaQueBorrarCorto"));
  showUsage(); showUnused();
};
const paintBackup = () => { if (lib.lastBackup) document.getElementById("lastBackup").textContent = t("ajustes.ultimaCopia", { when: relTime(lib.lastBackup) }); };
paintBackup();
document.addEventListener("chinchero:lang", () => { paintUsage(); paintUnused(); paintBackup(); });

document.getElementById("openData").onclick = () => Store.desktop("openDataDir");
document.getElementById("changeData").onclick = async () => {
  if (!Store.native) return Store.desktop("chooseDataDir");
  if (!confirm(t("ajustes.confirmarCambiarCarpeta"))) return;
  if (await window.chinchero.chooseDataDir("new")) location.href = "01-tableros.html";
};
document.getElementById("importData").onclick = async () => {
  if (await Store.desktop("chooseDataDir", "existing")) location.href = "01-tableros.html";
};
document.getElementById("backupBtn").onclick = async () => {
  const dest = await Store.desktop("backup");
  if (!dest) return;
  lib.lastBackup = Date.now(); Store.saveLibrary();
  paintBackup();
  toast(t("ajustes.copiaCreada"));
};
document.getElementById("restoreBtn").onclick = async () => {
  if (Store.native && !confirm(t("ajustes.confirmarRestaurar"))) return;
  const r = await Store.desktop("restoreBackup");
  if (!r) return;
  if (r.error) return toast(t("ajustes.noSePudoRestaurar"));
  sessionStorage.setItem("chinchero-aviso", t("ajustes.copiaRestaurada", { boards: t("comun.tableros", { count: r.boards }) }));
  location.href = "01-tableros.html";
};
document.getElementById("checkUpdates").onclick = () => { toast(t("ajustes.buscandoActualizaciones")); Store.desktop("checkUpdates"); };

// Índice de secciones: marca la que se está viendo (la última cuyo título pasó bajo la barra superior;
// al llegar al final, la última aunque sea corta)
const main = document.querySelector("main"), tabs = [...document.querySelectorAll(".tabs a")];
const spy = () => {
  const top = main.getBoundingClientRect().top + 100;
  const atEnd = main.scrollTop + main.clientHeight >= main.scrollHeight - 4;
  let cur = tabs[0];
  for (const a of tabs) if (atEnd || document.querySelector(a.hash).getBoundingClientRect().top <= top) cur = a;
  tabs.forEach(a => {
    a.classList.toggle("active", a === cur);
    if (a === cur) a.setAttribute("aria-current", "location"); else a.removeAttribute("aria-current");
  });
};
main.addEventListener("scroll", spy, { passive: true });
addEventListener("resize", spy);
spy();

window.HELP = { tour: "settings" };
const scrollTo = sel => () => document.querySelector(sel).scrollIntoView({ block: "start" });
// Función: el idioma se puede cambiar aquí mismo, así el tutorial sale en el que esté elegido al abrirlo
Tour.define("settings", () => [
  { el: null, title: t("barra.ajustes"), text: t("ajustes.tour.p1") },
  { el: "#apariencia", before: scrollTo("#apariencia"), place: "right", title: t("ajustes.apariencia"), text: t("ajustes.tour.p2") },
  { el: "#tablero", before: scrollTo("#tablero"), place: "right", title: t("ajustes.tour.t3"), text: t("ajustes.tour.p3") },
  { el: "#asistente", before: scrollTo("#asistente"), place: "right", title: t("ajustes.asistenteConIa"), text: t("ajustes.tour.p4") },
  { el: "#datos", before: scrollTo("#datos"), place: "right", title: t("ajustes.tour.t5"), text: t("ajustes.tour.p5") },
  { el: "#ayuda", before: scrollTo("#ayuda"), place: "right", title: t("ajustes.tour.t6"), text: t("ajustes.tour.p6") },
]);
Tour.auto("settings");
setTimeout(() => Tips.show("backup", t("ajustes.sugerenciaCopia"), { label: t("tableros.sug.backup.boton"), fn: scrollTo("#datos") }), 1500);
