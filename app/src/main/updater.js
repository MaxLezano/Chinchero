// Actualizaciones automáticas desde las releases de GitHub (configuradas en electron-builder.yml → publish).
// Descarga en segundo plano y se instala al cerrar la app, o al momento si el usuario elige "Reiniciar ahora".
const { app } = require("electron");
const { autoUpdater } = require("electron-updater");

let getWin = () => null;
let manual = false;
let ready = null; // versión ya descargada, lista para instalar

function send(payload) {
  getWin()?.webContents.send("update", payload);
}

function init(winGetter) {
  getWin = winGetter;
  if (!app.isPackaged) return; // en desarrollo no hay releases contra las que comparar

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on("update-available", info => { if (!ready) send({ state: "available", version: info.version }); });
  autoUpdater.on("update-not-available", () => { if (manual) send({ state: "none", version: app.getVersion() }); manual = false; });
  autoUpdater.on("download-progress", p => send({ state: "downloading", percent: Math.round(p.percent) }));
  autoUpdater.on("update-downloaded", info => { ready = info.version; send({ state: "ready", version: ready }); });
  autoUpdater.on("error", err => { if (manual) send({ state: "error", message: String(err?.message || err) }); manual = false; });

  // Cada pantalla es un HTML propio: al navegar se vuelve a mostrar el banner «Reiniciar ahora»
  getWin()?.webContents.on("did-finish-load", () => { if (ready) send({ state: "ready", version: ready }); });

  // Primera comprobación unos segundos después de abrir, y luego cada 4 horas
  setTimeout(() => check(false), 5000);
  setInterval(() => check(false), 4 * 60 * 60 * 1000);
}

async function check(isManual) {
  if (!app.isPackaged) {
    send({ state: "dev" });
    return;
  }
  if (ready) { send({ state: "ready", version: ready }); return; } // ya está descargada
  manual = isManual;
  try { await autoUpdater.checkForUpdates(); }
  catch (err) { if (isManual) send({ state: "error", message: String(err?.message || err) }); }
}

function install() {
  autoUpdater.quitAndInstall(false, true);
}

module.exports = { init, check, install };
