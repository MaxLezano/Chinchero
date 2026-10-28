// Idioma del proceso principal (diálogos de Windows, mensajes de error que llegan a las pantallas): usa los mismos
// textos que la interfaz (sección «main» de assets/locales) y el idioma que eligió el usuario en Ajustes.
const path = require("path");
const i18next = require("i18next");

const LANGS = ["es", "en"];
const DIR = path.join(__dirname, "..", "renderer", "assets", "locales");
const i18n = i18next.createInstance();
i18n.init({
  lng: "es", fallbackLng: "es", initAsync: false,
  resources: Object.fromEntries(LANGS.map(l => [l, { translation: require(path.join(DIR, l + ".json")) }])),
  interpolation: { escapeValue: false },
});

module.exports = {
  LANGS,
  t: (key, opts) => i18n.t(key, opts),
  get lang() { return i18n.language; },
  set(l) { if (LANGS.includes(l)) i18n.changeLanguage(l); },
};
