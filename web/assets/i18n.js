// Idioma de la web con i18next. Los textos viven en assets/locales/<idioma>.json; el HTML los pide con data-i18n
// y site.js con t(). Se usa el idioma elegido con el botón de arriba o, la primera vez, el del navegador.
// data-i18n="clave" pone el texto; "[html]clave" el HTML; "[atributo]clave" un atributo; se encadenan con «;».
(function () {
  const LANGS = ["es", "en"];
  let saved = null;
  try { saved = localStorage.getItem("site-lang"); } catch (e) {}
  let lng = LANGS.includes(saved) ? saved : /^en\b/i.test(navigator.language || "") ? "en" : "es";

  // Síncrono: la página se pinta ya en su idioma
  function load(l) {
    const x = new XMLHttpRequest();
    x.open("GET", "assets/locales/" + l + ".json", false);
    x.send();
    return JSON.parse(x.responseText);
  }
  i18next.init({
    lng, fallbackLng: "es", initAsync: false,
    resources: Object.fromEntries([...new Set([lng, "es"])].map(l => [l, { translation: load(l) }])),
    interpolation: { escapeValue: false },
  });
  document.documentElement.lang = lng;
  window.t = (key, opts) => i18next.t(key, opts);

  // Pone el texto sin borrar los íconos que el elemento tenga dentro
  function setText(el, s) {
    if (!el.children.length) { el.textContent = s; return; }
    const node = [...el.childNodes].find(n => n.nodeType === 3 && n.textContent.trim());
    if (node) node.textContent = node.textContent.replace(/\S[\s\S]*\S|\S/, s);
    else el.append(" " + s);
  }
  function translate(root = document) {
    const els = root.querySelectorAll ? [...root.querySelectorAll("[data-i18n]")] : [];
    if (root.dataset?.i18n) els.unshift(root);
    for (const el of els) for (const part of el.dataset.i18n.split(";")) {
      const m = part.trim().match(/^(?:\[([\w-]+)\])?(.+)$/);
      if (!m) continue;
      const [, attr, key] = m, s = t(key);
      if (!attr) setText(el, s);
      else if (attr === "html") el.innerHTML = s;
      else el.setAttribute(attr, s);
    }
  }

  window.I18n = {
    get lang() { return lng; },
    // Cambia al momento: retraduce la página y avisa a site.js («site:lang») para lo que arma con JS
    set(l) {
      if (!LANGS.includes(l) || l === lng) return;
      if (!i18next.hasResourceBundle(l, "translation")) i18next.addResourceBundle(l, "translation", load(l));
      lng = l;
      try { localStorage.setItem("site-lang", l); } catch (e) {}
      i18next.changeLanguage(l);
      document.documentElement.lang = l;
      translate();
      document.dispatchEvent(new CustomEvent("site:lang", { detail: l }));
    },
  };

  // Mientras se lee el HTML, cada parte se traduce al llegar (antes de que corra site.js)
  const added = list => { for (const r of list) for (const n of r.addedNodes) if (n.nodeType === 1) translate(n); };
  translate();
  const mo = new MutationObserver(added);
  mo.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener("DOMContentLoaded", () => { added(mo.takeRecords()); mo.disconnect(); });
})();
