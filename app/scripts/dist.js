// Compila los dos instaladores de Windows y une sus latest.yml en uno solo:
//   Chinchero-Setup-X.Y.Z.exe        → x64 (Intel y AMD; también funciona emulada en ARM)
//   Chinchero-Setup-X.Y.Z-arm64.exe  → ARM64 (Snapdragon y otros)
// Son dos instaladores separados y no uno con las dos arquitecturas, que pesaría el doble para todos.
// electron-updater elige del latest.yml el archivo cuyo nombre contiene process.arch («arm64») y, si ninguno
// lo contiene, el primero: por eso la x64 va primera y sin sufijo (así la siguen bajando las versiones viejas y winget).
// Argumentos extra se pasan a electron-builder (p. ej. --publish never).
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const APP = path.join(__dirname, "..");
const DIST = path.join(APP, "dist");
const LATEST = path.join(DIST, "latest.yml");
const CLI = require.resolve("electron-builder/cli.js");
const extra = process.argv.slice(2);

function compilar(arch, ...opciones) {
  const r = spawnSync(process.execPath, [CLI, "--win", `--${arch}`, ...opciones, ...extra], { cwd: APP, stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status || 1);
  return yaml.load(fs.readFileSync(LATEST, "utf8"));
}

// Cada compilación pisa latest.yml: se guarda el de cada una y al final se escribe el unido
const x64 = compilar("x64");
const arm64 = compilar("arm64", "-c.win.artifactName=Chinchero-Setup-${version}-arm64.${ext}");
if (x64.version !== arm64.version) throw new Error(`Versiones distintas: ${x64.version} y ${arm64.version}`);

x64.files.push(...arm64.files.filter(f => /arm64/.test(f.url)));
fs.writeFileSync(LATEST, yaml.dump(x64, { lineWidth: -1 }));
console.log("latest.yml con " + x64.files.map(f => `${f.url} (${(f.size / 1048576).toFixed(0)} MB)`).join(" y "));
