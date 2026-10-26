// Tema claro/oscuro y preferencias visuales compartidas entre mockups (recordadas en localStorage)
(function () {
  const root = document.documentElement;
  const get = k => { try { return localStorage.getItem("chinchero-" + k); } catch (e) { return null; } };
  const set = (k, v) => { try { localStorage.setItem("chinchero-" + k, v); } catch (e) {} };
  const media = window.matchMedia("(prefers-color-scheme: dark)");

  // Textura de corcho procedural: gránulos poligonales irregulares de varios tonos sobre un tile de 512 px
  // (dibujado a 2x para pantallas HiDPI). Los gránulos que cruzan un borde se repiten en el opuesto para que
  // el mosaico no tenga costuras. Semilla fija: el corcho se ve igual en cada carga.
  const corkCache = {};
  function corkTexture(dark) {
    const key = dark ? "dark" : "light";
    if (corkCache[key]) return corkCache[key];
    const S = 1024, c = document.createElement("canvas");
    c.width = c.height = S;
    const g = c.getContext("2d");
    const tones = dark
      ? [["#2a170a", .07], ["#3d2510", .15], ["#553519", .24], ["#6e4625", .24], ["#875a32", .19], ["#a07142", .11]]
      : [["#7a4520", .06], ["#96592a", .13], ["#b5763f", .24], ["#cf955a", .25], ["#e2b07a", .20], ["#f2cc9c", .12]];
    g.fillStyle = dark ? "#4a2e16" : "#a8703f";
    g.fillRect(0, 0, S, S);
    let seed = 20261024;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const pick = () => { let r = rnd(); for (const [col, w] of tones) if ((r -= w) <= 0) return col; return tones[0][0]; };
    for (let i = 0; i < 30000; i++) {
      const x = rnd() * S, y = rnd() * S;
      const r = 2 + rnd() * rnd() * 9;
      const n = 5 + Math.floor(rnd() * 3), a0 = rnd() * Math.PI * 2;
      const pts = [];
      for (let k = 0; k < n; k++) {
        const a = a0 + (k / n) * Math.PI * 2 + (rnd() - .5) * .6, rr = r * (.6 + rnd() * .55);
        pts.push([Math.cos(a) * rr, Math.sin(a) * rr]);
      }
      g.fillStyle = pick();
      for (const dx of [0, -S, S]) for (const dy of [0, -S, S]) {
        if (x + dx < -r || x + dx > S + r || y + dy < -r || y + dy > S + r) continue;
        g.beginPath();
        pts.forEach(([px, py], k) => k ? g.lineTo(x + dx + px, y + dy + py) : g.moveTo(x + dx + px, y + dy + py));
        g.fill();
      }
    }
    return corkCache[key] = `url(${c.toDataURL("image/jpeg", .85)})`;
  }

  function applyTheme() {
    const pref = get("theme") || "system";
    root.dataset.theme = pref === "system" ? (media.matches ? "dark" : "light") : pref;
    root.style.setProperty("--cork-tex", corkTexture(root.dataset.theme === "dark"));
  }
  function applyPrefs() {
    const thread = get("thread");
    if (thread) root.style.setProperty("--thread", thread);
    root.dataset.notefont = get("notefont") || "hand";
  }
  applyTheme();
  applyPrefs();
  media.addEventListener("change", applyTheme);

  window.getPref = get;
  window.setPref = function (k, v) {
    set(k, v);
    applyTheme();
    applyPrefs();
  };
  window.toggleTheme = function () {
    setPref("theme", root.dataset.theme === "dark" ? "light" : "dark");
  };
  // Botones de tema (sin onclick en el HTML: la CSP no permite código inline)
  document.addEventListener("click", e => { if (e.target.closest("[data-theme-toggle]")) toggleTheme(); });
})();
