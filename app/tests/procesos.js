// Procesos que lanzan las pruebas (Electron). Se cierran como lo haría el usuario —taskkill sin /F manda WM_CLOSE a sus
// ventanas; sin /T, porque con /T Windows no cierra al padre mientras tenga hijos vivos y nunca le llega— y solo se
// matan (con todo su árbol) si no responden. Matarlos de golpe (proc.kill, taskkill /F) deja sus ventanas como
// fantasmas en Alt+Tab, sin proceso detrás, hasta reiniciar el Explorador de Windows.
const { spawn, spawnSync } = require("child_process");

const vivos = new Set();
const lanzar = (...a) => { const p = spawn(...a); vivos.add(p); p.on("exit", () => vivos.delete(p)); return p; };

const ignorar = { stdio: "ignore" };
const sigue = pid => spawnSync("tasklist", ["/FI", `PID eq ${pid}`, "/NH"], { encoding: "utf8" }).stdout.includes(` ${pid} `);
const esperar = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// Versión síncrona, para process.on("exit"), donde no se puede esperar con promesas
function matar(p) {
  spawnSync("taskkill", ["/pid", String(p.pid)], ignorar);
  for (let i = 0; i < 20 && sigue(p.pid); i++) esperar(250);
  if (sigue(p.pid)) spawnSync("taskkill", ["/pid", String(p.pid), "/T", "/F"], ignorar);
}

async function cerrar(p) {
  if (!vivos.has(p)) return;
  const fin = new Promise(r => p.once("exit", r));
  spawnSync("taskkill", ["/pid", String(p.pid)], ignorar);
  await Promise.race([fin, new Promise(r => setTimeout(r, 5000))]);
  if (vivos.has(p)) { spawnSync("taskkill", ["/pid", String(p.pid), "/T", "/F"], ignorar); await fin; }
}

// Aunque una prueba falle con una excepción, al salir no queda nada abierto
process.on("exit", () => { for (const p of vivos) matar(p); });

module.exports = { vivos, lanzar, matar, cerrar };
