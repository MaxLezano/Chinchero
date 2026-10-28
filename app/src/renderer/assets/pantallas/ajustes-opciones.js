// Grupos de opciones: marcan la activa y guardan la preferencia
function bindChoice(id, key, fallback) {
  const box = document.getElementById(id);
  const mark = () => {
    const cur = getPref(key) ?? fallback;
    box.querySelectorAll("button").forEach(b => { b.classList.toggle("active", b.dataset.v === cur); b.setAttribute("aria-pressed", b.dataset.v === cur); });
  };
  box.onclick = e => {
    const b = e.target.closest("button"); if (!b) return;
    setPref(key, b.dataset.v);
    if (key === "thread" && !b.dataset.v) document.documentElement.style.removeProperty("--thread");
    mark();
  };
  mark();
}
bindChoice("theme", "theme", "system");

// Idioma: se aplica al momento (I18n.set retraduce la pantalla y avisa con «chinchero:lang»)
const langBox = document.getElementById("lang");
const markLang = () => langBox.querySelectorAll("button").forEach(b => { b.classList.toggle("active", b.dataset.v === I18n.lang); b.setAttribute("aria-pressed", b.dataset.v === I18n.lang); });
langBox.onclick = e => {
  const b = e.target.closest("button"); if (!b) return;
  I18n.set(b.dataset.v);
  markLang();
  announce(t("ajustes.idiomaCambiado"));
};
markLang();
bindChoice("thread", "thread", "");
bindChoice("notefont", "notefont", "hand");
bindChoice("surface", "surface", "dots");
