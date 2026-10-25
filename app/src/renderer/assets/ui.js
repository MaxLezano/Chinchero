// Menú contextual y avisos compartidos entre mockups
(function () {
  window.closeMenu = () => document.querySelectorAll(".menu").forEach(m => m.remove());

  // items: [{ label, kbd?, danger?, action }] o "-" para separador
  window.showMenu = function (x, y, items) {
    closeMenu();
    const m = document.createElement("div");
    m.className = "menu";
    for (const it of items) {
      if (it === "-") { m.appendChild(document.createElement("hr")); continue; }
      const b = document.createElement("button");
      b.innerHTML = `<span>${it.label}</span>${it.kbd ? `<kbd>${it.kbd}</kbd>` : ""}`;
      if (it.danger) b.classList.add("danger");
      b.onclick = () => { closeMenu(); it.action?.(); };
      m.appendChild(b);
    }
    document.body.appendChild(m);
    const r = m.getBoundingClientRect();
    m.style.left = Math.max(8, Math.min(x, innerWidth - r.width - 8)) + "px";
    m.style.top = Math.max(8, Math.min(y, innerHeight - r.height - 8)) + "px";
  };

  window.toast = function (msg, actionLabel, action) {
    document.querySelector(".toast")?.remove();
    const t = document.createElement("div");
    t.className = "toast";
    // Como texto: los mensajes llevan nombres de tableros, hojas y listas (pueden venir de un tablero importado)
    t.appendChild(document.createElement("span")).textContent = msg;
    if (actionLabel) {
      const b = document.createElement("button");
      b.textContent = actionLabel;
      b.onclick = () => { t.remove(); action(); };
      t.appendChild(b);
    }
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 4000);
  };

  document.addEventListener("pointerdown", e => { if (!e.target.closest(".menu")) closeMenu(); }, true);
  document.addEventListener("keydown", e => { if (e.key === "Escape") closeMenu(); });
  window.addEventListener("blur", closeMenu);
})();
