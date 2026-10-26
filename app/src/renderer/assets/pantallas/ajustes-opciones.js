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
bindChoice("thread", "thread", "");
bindChoice("notefont", "notefont", "hand");
bindChoice("surface", "surface", "dots");
