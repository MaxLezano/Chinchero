// Idioma de la interfaz con i18next. Los textos viven en assets/locales/<idioma>.json; el HTML los pide con
// data-i18n y el código con t(). El idioma elegido se guarda en la preferencia «lang» (por defecto, español).
// data-i18n="clave" pone el texto; "[html]clave" el HTML (textos con <b>); "[atributo]clave" un atributo.
// Se pueden encadenar con «;»: data-i18n="[aria-label]a.b;[data-tip]a.b".
(function () {
  const LANGS = ["es", "en"];
  const get = () => { try { return localStorage.getItem("chinchero-lang"); } catch (e) { return null; } };
  let lng = LANGS.includes(get()) ? get() : "es";

  // Síncrono: las pantallas pintan sus textos al cargar, antes de cualquier espera
  function load(l) {
    const x = new XMLHttpRequest();
    x.open("GET", "assets/locales/" + l + ".json", false);
    x.send();
    return JSON.parse(x.responseText);
  }

  i18next.init({
    lng, fallbackLng: "es", initAsync: false,
    resources: Object.fromEntries([...new Set([lng, "es"])].map(l => [l, { translation: load(l) }])),
    // Los valores se escapan con esc() al armar HTML (como antes); aquí iría doble
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
    LANGS, translate,
    get lang() { return lng; },
    // Cambia el idioma al momento: retraduce el HTML y avisa a la pantalla («chinchero:lang») para lo generado en JS
    set(l) {
      if (!LANGS.includes(l) || l === lng) return;
      if (!i18next.hasResourceBundle(l, "translation")) i18next.addResourceBundle(l, "translation", load(l));
      lng = l;
      try { localStorage.setItem("chinchero-lang", l); } catch (e) {}
      i18next.changeLanguage(l);
      document.documentElement.lang = l;
      translate();
      window.chinchero?.setLang?.(l);
      document.dispatchEvent(new CustomEvent("chinchero:lang", { detail: l }));
    },
  };

  // El proceso principal usa el idioma en sus diálogos
  window.chinchero?.setLang?.(lng);

  // Mientras se lee el HTML, cada parte se traduce al llegar: las mutaciones se entregan antes de correr
  // cada <script> del body, así las pantallas ya encuentran los textos en su idioma
  // (lo que ya estaba, como el <title>, se traduce ahora). Al terminar no se retraduce todo: pisaría los textos
  // que las pantallas ya cambiaron al cargar
  const added = list => { for (const r of list) for (const n of r.addedNodes) if (n.nodeType === 1) translate(n); };
  translate();
  const mo = new MutationObserver(added);
  mo.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener("DOMContentLoaded", () => { added(mo.takeRecords()); mo.disconnect(); });
})();
