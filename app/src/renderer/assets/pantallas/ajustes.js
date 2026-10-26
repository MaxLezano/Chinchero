// Interruptores enlazados a preferencias (data-on/data-off: valores guardados; por defecto "1"/"0")
document.querySelectorAll("[data-pref]").forEach(input => {
  const k = input.dataset.pref, onV = input.dataset.on || "1", offV = input.dataset.off || "0";
  const cur = getPref(k);
  input.checked = cur === null ? input.dataset.default === "1" : cur === onV;
  input.onchange = () => { setPref(k, input.checked ? onV : offV); toast("Guardado"); };
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
  toast("Los tutoriales y sugerencias volverán a aparecer");
};

/* ---------- Datos reales de la app ---------- */
const info = Store.info(), lib = Store.library();
document.getElementById("dataPath").textContent = info.dataDir;
document.getElementById("version").textContent = info.version;
const mb = n => (n / 1048576).toFixed(n > 10485760 ? 0 : 1).replace(".", ",") + " MB";
const usage = document.getElementById("usage");
const nb = lib.boards.length;
if (Store.native) window.chinchero.dataStats().then(st => { usage.textContent = `${mb(st.bytes)} · ${nb} tablero${nb === 1 ? "" : "s"} · ${st.images} imágenes`; });
else usage.textContent = `${nb} tablero${nb === 1 ? "" : "s"} (modo de prueba en el navegador)`;
if (lib.lastBackup) document.getElementById("lastBackup").textContent = `Última copia: ${relTime(lib.lastBackup)}. Guarda todo en un solo archivo .zip donde elijas.`;

document.getElementById("openData").onclick = () => Store.desktop("openDataDir");
document.getElementById("changeData").onclick = async () => {
  if (!Store.native) return Store.desktop("chooseDataDir");
  if (!confirm("Chinchero empezará a usar la carpeta que elijas (se creará una subcarpeta «Chinchero»). Tus tableros actuales siguen en la carpeta anterior. ¿Continuar?")) return;
  if (await window.chinchero.chooseDataDir("new")) location.href = "01-tableros.html";
};
document.getElementById("importData").onclick = async () => {
  if (await Store.desktop("chooseDataDir", "existing")) location.href = "01-tableros.html";
};
document.getElementById("backupBtn").onclick = async () => {
  const dest = await Store.desktop("backup");
  if (!dest) return;
  lib.lastBackup = Date.now(); Store.saveLibrary();
  document.getElementById("lastBackup").textContent = "Última copia: ahora.";
  toast("Copia de seguridad creada");
};
document.getElementById("restoreBtn").onclick = async () => {
  if (Store.native && !confirm("Tus tableros actuales se reemplazarán por los de la copia. Antes se guarda una copia del estado actual en la carpeta «backups». ¿Continuar?")) return;
  const r = await Store.desktop("restoreBackup");
  if (!r) return;
  if (r.error) return toast("No se pudo restaurar: el archivo no es una copia de Chinchero");
  sessionStorage.setItem("chinchero-aviso", `Copia restaurada: ${r.boards} tablero${r.boards === 1 ? "" : "s"}`);
  location.href = "01-tableros.html";
};
document.getElementById("checkUpdates").onclick = () => { toast("Buscando actualizaciones…"); Store.desktop("checkUpdates"); };

window.HELP = { tour: "settings" };
const scrollTo = sel => () => document.querySelector(sel).scrollIntoView({ block: "start" });
Tour.define("settings", [
  { el: null, title: "Ajustes", text: "Aquí personalizas Chinchero. Todo se guarda al instante, no hay botón Guardar." },
  { el: "#apariencia", before: scrollTo("#apariencia"), place: "right", title: "Apariencia", text: "Tema claro u oscuro, color de los hilos, letra de las notas y sonidos. La vista previa cambia mientras eliges." },
  { el: "#tablero", before: scrollTo("#tablero"), place: "right", title: "Comportamiento del tablero", text: "El fondo para hojas nuevas, si los elementos aparecen un poco girados y si se alinean a la cuadrícula." },
  { el: "#datos", before: scrollTo("#datos"), place: "right", title: "Tus datos son tuyos", text: "Todo vive en esta carpeta, imágenes incluidas. Haz una <b>copia de seguridad</b> (.zip) de vez en cuando y recupérala con <b>Restaurar copia</b>, o abre la carpeta desde otro equipo con <b>Abrir datos existentes</b>." },
  { el: "#ayuda", before: scrollTo("#ayuda"), place: "right", title: "Tutoriales y sugerencias", text: "Si ya conoces la app, desactívalos. Si quieres repasar, reinícialos." },
]);
Tour.auto("settings");
setTimeout(() => Tips.show("backup", "Acostúmbrate a hacer una <b>copia de seguridad</b> antes de cambiar de PC o formatear.", { label: "Ir a Datos", fn: scrollTo("#datos") }), 1500);
