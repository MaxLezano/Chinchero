const puppeteer = require("puppeteer-core");
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

// Regenera la imagen para redes de la web (web/assets/og.jpg, 1200×630): logo, título y la captura del asistente.
// No es una prueba: correrla después de tests/capturas-web.js cuando cambien las capturas o el mensaje.
// Uso: node tests/og-web.js
const WEB = path.join(__dirname, "..", "..", "web");
const OUT = path.join(__dirname, "out");
const url = f => pathToFileURL(path.join(WEB, "assets", f)).href;

const html = `<!doctype html><meta charset="utf-8">
<link rel="stylesheet" href="${url("fonts/fonts.css")}">
<style>
  body { margin: 0; width: 1200px; height: 630px; overflow: hidden; background: #141417; color: #f1efe9; font-family: Inter, sans-serif;
    background-image: radial-gradient(#2a2a30 1px, transparent 1px); background-size: 22px 22px; }
  .txt { position: absolute; left: 64px; top: 150px; width: 470px; }
  .logo { display: flex; align-items: center; gap: 16px; font-size: 30px; font-weight: 700; }
  .logo img { width: 52px; height: 52px; }
  h1 { margin: 36px 0 22px; font-size: 64px; line-height: 1.05; letter-spacing: -1.5px; font-weight: 800; }
  h1 span { font-family: Caveat, cursive; color: #ff8a3d; font-weight: 700; font-size: 72px; letter-spacing: 0; }
  p { margin: 0; font-size: 22px; line-height: 1.45; color: #b4b1aa; }
  p b { color: #f1efe9; font-weight: 600; }
  .shot { position: absolute; left: 560px; top: 128px; width: 600px; border-radius: 12px; overflow: hidden;
    transform: perspective(1600px) rotateY(-10deg) rotateX(3deg) rotateZ(-1.5deg);
    box-shadow: 0 30px 80px rgba(0, 0, 0, .6), 0 0 0 1px rgba(255, 255, 255, .08); }
  .shot img { display: block; width: 100%; }
</style>
<div class="txt">
  <div class="logo"><img src="${url("icon-256.png")}" alt="">Chinchero</div>
  <h1>Tu tablero de ideas <span>digital</span></h1>
  <p>Notas, fotos y stickers unidos con hilos, y <b>un asistente con IA</b>. Gratis para Windows.</p>
</div>
<div class="shot"><img src="${url("screens/assistant-dark.webp")}" alt=""></div>`;

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, "og.html");
  fs.writeFileSync(file, html);
  const browser = await puppeteer.launch({ executablePath: process.env.EDGE_PATH || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true, args: ["--allow-file-access-from-files"] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 630 });
    await page.goto(pathToFileURL(file).href, { waitUntil: "networkidle0" });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.join(WEB, "assets", "og.jpg"), type: "jpeg", quality: 86 });
  } finally {
    await browser.close();
  }
  console.log("Imagen en " + path.join(WEB, "assets", "og.jpg"));
})();
