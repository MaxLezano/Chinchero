// Verifica que las pantallas y la web cargan sus fuentes sin internet (se bloquea toda petición http/https)
const puppeteer = require("puppeteer-core");
const path = require("path");
const { pathToFileURL } = require("url");
const pages = [
  path.join(__dirname, "..", "src", "renderer", "01-tableros.html"),
  path.join(__dirname, "..", "src", "renderer", "02-tablero.html"),
  path.join(__dirname, "..", "..", "web", "index.html"),
];
(async () => {
  const b = await puppeteer.launch({ executablePath: process.env.EDGE_PATH || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
  let fail = false;
  for (const file of pages) {
    const p = await b.newPage();
    const external = [];
    await p.setRequestInterception(true);
    p.on("request", r => { if (/^https?:/.test(r.url()) && !r.url().includes("api.github.com")) { external.push(r.url()); r.abort(); } else r.continue(); });
    await p.goto(pathToFileURL(file).href, { waitUntil: "networkidle0" });
    const fonts = await p.evaluate(async () => { await document.fonts.ready; return ["Inter", "Caveat"].map(f => [...document.fonts].some(ff => ff.family.replace(/"/g, "") === f && ff.status === "loaded")); });
    const ok = !external.length && fonts.every(Boolean);
    if (!ok) fail = true;
    console.log(`${ok ? "PASS" : "FAIL"} ${path.basename(file)} — fuentes cargadas: Inter=${fonts[0]} Caveat=${fonts[1]}${external.length ? " · externas: " + external.join(", ") : ""}`);
    await p.close();
  }
  await b.close();
  process.exitCode = fail ? 1 : 0;
})();
