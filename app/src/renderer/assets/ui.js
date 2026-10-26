// Menú contextual y avisos compartidos entre mockups
(function () {
  let menuOpener = null;
  window.closeMenu = () => document.querySelectorAll(".menu").forEach(m => m.remove());

  // Región para lectores de pantalla: lo que pasa en el lienzo se anuncia aquí (no se ve)
  const live = document.createElement("div");
  live.id = "srLive";
  live.className = "sr-only";
  live.setAttribute("role", "status");
  live.setAttribute("aria-live", "polite");
  document.body.appendChild(live);
  let liveTimer;
  window.announce = function (msg) {
    clearTimeout(liveTimer);
    live.textContent = "";
    // Un instante después: así se anuncia aunque el mensaje sea igual al anterior
    liveTimer = setTimeout(() => live.textContent = msg, 60);
  };

  // items: [{ label, kbd?, danger?, action }] o "-" para separador
  window.showMenu = function (x, y, items) {
    if (!document.querySelector(".menu")) menuOpener = document.activeElement;
    closeMenu();
    const m = document.createElement("div");
    m.className = "menu";
    m.setAttribute("role", "menu");
    for (const it of items) {
      if (it === "-") { m.appendChild(document.createElement("hr")); continue; }
      const b = document.createElement("button");
      b.setAttribute("role", "menuitem");
      // Como texto: las etiquetas llevan nombres de hojas y grupos
      b.appendChild(document.createElement("span")).textContent = it.label;
      if (it.kbd) b.appendChild(document.createElement("kbd")).textContent = it.kbd;
      if (it.danger) b.classList.add("danger");
      b.onclick = () => {
        closeMenu(); it.action?.();
        // Si la acción no abrió otro menú ni movió el foco, vuelve a donde estaba
        if (!document.querySelector(".menu") && document.activeElement === document.body) menuOpener?.focus?.({ preventScroll: true });
      };
      m.appendChild(b);
    }
    document.body.appendChild(m);
    const r = m.getBoundingClientRect();
    m.style.left = Math.max(8, Math.min(x, innerWidth - r.width - 8)) + "px";
    m.style.top = Math.max(8, Math.min(y, innerHeight - r.height - 8)) + "px";
    // Teclado: flechas, Inicio y Fin recorren las opciones; Esc o Tab cierran y devuelven el foco
    const btns = [...m.querySelectorAll("button")];
    m.addEventListener("keydown", e => {
      const i = btns.indexOf(document.activeElement);
      const go = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: btns.length - 1 }[e.key];
      if (go !== undefined) { e.preventDefault(); e.stopPropagation(); btns[(go + btns.length) % btns.length].focus(); }
      else if (e.key === "Escape" || e.key === "Tab") { e.preventDefault(); e.stopPropagation(); closeMenu(); menuOpener?.focus?.(); }
    });
    btns[0]?.focus({ preventScroll: true });
  };

  // Diálogos: Tab no sale del contenedor y, al soltarlo, el foco vuelve a donde estaba antes de abrirlo
  window.trapFocus = function (box, first) {
    const opener = document.activeElement;
    const focusables = () => [...box.querySelectorAll("button, a[href], input, select, textarea, [tabindex]:not([tabindex='-1'])")]
      .filter(x => !x.disabled && !x.hidden && x.offsetParent !== null);
    const onKey = e => {
      if (e.key !== "Tab") return;
      const f = focusables(); if (!f.length) return;
      const i = f.indexOf(document.activeElement);
      if (e.shiftKey ? i <= 0 : i === f.length - 1 || i < 0) { e.preventDefault(); f[e.shiftKey ? f.length - 1 : 0].focus(); }
    };
    box.addEventListener("keydown", onKey);
    if (!box.contains(document.activeElement)) (first || focusables()[0])?.focus({ preventScroll: true });
    return () => { box.removeEventListener("keydown", onKey); if (opener?.isConnected) opener.focus({ preventScroll: true }); };
  };

  window.toast = function (msg, actionLabel, action) {
    document.querySelector(".toast")?.remove();
    const t = document.createElement("div");
    t.className = "toast";
    announce(msg);
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
