// Tutoriales guiados, sugerencias y ayuda compartidos entre vistas
(function () {
  const get = k => { try { return localStorage.getItem("chinchero-" + k); } catch (e) { return null; } };
  const set = (k, v) => { try { localStorage.setItem("chinchero-" + k, v); } catch (e) {} };

  /* ---------- Tutoriales ----------
     Tour.define(id, [{ el, title, text, place?, await?, task?, before?, after? }])
     el: selector, función que devuelve un elemento, o null (centrado).
     await: nombre de evento; el paso avanza solo cuando la vista llama Tour.emit(nombre). */
  const tours = {};
  let cur = null;

  function define(id, steps) { tours[id] = steps; }

  function start(id) {
    if (!tours[id]) return;
    stop(false);
    Tips.hide();
    // Contenedor fijo: fuera del flujo, para no convertirse en celda de layouts con grid (barra lateral)
    const root = document.createElement("div");
    root.className = "tour-root";
    root.innerHTML = '<div class="tour-spot"></div><div class="tour-pop" role="dialog" aria-live="polite"></div>';
    document.body.appendChild(root);
    cur = { id, i: -1, steps: tours[id], root, spot: root.firstChild, pop: root.lastChild, off: null };
    window.addEventListener("resize", place);
    document.addEventListener("keydown", onKey, true);
    show(0);
  }

  function stop(done = true) {
    if (!cur) return;
    cur.off?.();
    cur.steps[cur.i]?.after?.();
    if (done) set("tour-" + cur.id, "done");
    cur.root.remove();
    window.removeEventListener("resize", place);
    document.removeEventListener("keydown", onKey, true);
    cur = null;
  }

  function show(i) {
    cur.off?.(); cur.off = null;
    cur.steps[cur.i]?.after?.();
    cur.i = i;
    const s = cur.steps[i], n = cur.steps.length, last = i === n - 1;
    s.before?.();
    cur.pop.innerHTML = `
      <div class="tour-step">Paso ${i + 1} de ${n}</div>
      <h4>${s.title}</h4><p>${s.text}</p>
      ${s.await ? `<div class="tour-await">👉 ${s.task}</div>` : ""}
      <div class="tour-btns">
        <button class="tour-skip">Saltar tutorial</button>
        ${i ? '<button class="btn tour-prev">Atrás</button>' : ""}
        <button class="btn ${s.await ? "" : "btn-primary"} tour-next">${last ? "Terminar" : s.await ? "Saltar paso" : "Siguiente"}</button>
      </div>`;
    cur.pop.querySelector(".tour-skip").onclick = () => stop();
    cur.pop.querySelector(".tour-prev")?.addEventListener("click", () => show(i - 1));
    cur.pop.querySelector(".tour-next").onclick = next;
    if (s.await) {
      const h = () => setTimeout(next, 400);
      document.addEventListener("chinchero:" + s.await, h, { once: true });
      cur.off = () => document.removeEventListener("chinchero:" + s.await, h);
    }
    requestAnimationFrame(place);
  }

  function next() {
    if (!cur) return;
    cur.i < cur.steps.length - 1 ? show(cur.i + 1) : stop();
  }

  function onKey(e) {
    const typing = e.target.isContentEditable || e.target.matches?.("input, textarea");
    if (e.key === "Escape") { e.stopPropagation(); stop(); }
    else if (typing || cur.steps[cur.i].await) return;
    else if (e.key === "ArrowRight") { e.preventDefault(); e.stopPropagation(); next(); }
    else if (e.key === "ArrowLeft" && cur.i) { e.preventDefault(); e.stopPropagation(); show(cur.i - 1); }
  }

  function place() {
    if (!cur) return;
    const s = cur.steps[cur.i];
    const el = typeof s.el === "function" ? s.el() : s.el ? document.querySelector(s.el) : null;
    const { pop, spot } = cur, pad = s.pad ?? 6, m = 14;
    const pw = pop.offsetWidth, ph = pop.offsetHeight, W = innerWidth, H = innerHeight;
    if (!el) {
      spot.classList.add("none");
      Object.assign(spot.style, { left: W / 2 + "px", top: H / 2 + "px", width: "0px", height: "0px" });
      Object.assign(pop.style, { left: (W - pw) / 2 + "px", top: (H - ph) / 2 + "px" });
      return;
    }
    spot.classList.remove("none");
    const r = el.getBoundingClientRect();
    const b = { l: r.left - pad, t: r.top - pad, w: r.width + pad * 2, h: r.height + pad * 2 };
    Object.assign(spot.style, { left: b.l + "px", top: b.t + "px", width: b.w + "px", height: b.h + "px" });
    const fits = {
      bottom: b.t + b.h + m + ph < H, top: b.t - m - ph > 0,
      right: b.l + b.w + m + pw < W, left: b.l - m - pw > 0,
    };
    const side = [s.place, "bottom", "right", "top", "left"].find(o => o && fits[o]);
    let x, y;
    if (side === "bottom" || side === "top") { x = b.l + b.w / 2 - pw / 2; y = side === "bottom" ? b.t + b.h + m : b.t - m - ph; }
    else if (side) { y = b.t + b.h / 2 - ph / 2; x = side === "right" ? b.l + b.w + m : b.l - m - pw; }
    else { x = (W - pw) / 2; y = H - ph - 64; }
    pop.style.left = Math.max(12, Math.min(x, W - pw - 12)) + "px";
    pop.style.top = Math.max(12, Math.min(y, H - ph - 12)) + "px";
  }

  // Arranca el tutorial la primera vez que se visita la vista
  function auto(id, delay = 700) {
    if (get("tours") === "off" || get("tour-" + id)) return;
    setTimeout(() => { if (!cur) start(id); }, delay);
  }

  function resetAll() {
    try {
      Object.keys(localStorage).filter(k => /^chinchero-(tour|tip|sug)-/.test(k)).forEach(k => localStorage.removeItem(k));
    } catch (e) {}
  }

  const emit = name => document.dispatchEvent(new CustomEvent("chinchero:" + name));

  window.Tour = {
    define, start, stop, auto, emit, resetAll, refresh: () => requestAnimationFrame(place),
    get active() { return !!cur; },
  };

  /* ---------- Sugerencias: una a la vez, cada una se muestra una sola vez ---------- */
  let tipEl = null;
  const Tips = {
    show(id, text, action) {
      if (cur || tipEl || get("tips") === "off" || get("tip-" + id)) return false;
      tipEl = document.createElement("div");
      tipEl.className = "tip";
      tipEl.setAttribute("role", "status");
      tipEl.innerHTML = `<b>💡 Sugerencia</b><p>${text}</p><div class="tip-btns">
        <button class="tip-mute">No mostrar más</button>
        ${action ? `<button class="btn tip-act">${action.label}</button>` : ""}
        <button class="btn btn-primary tip-ok">Entendido</button></div>`;
      const close = () => { set("tip-" + id, "seen"); Tips.hide(); };
      tipEl.querySelector(".tip-ok").onclick = close;
      tipEl.querySelector(".tip-mute").onclick = () => {
        set("tips", "off"); close();
        toast("Sugerencias desactivadas. Puedes volver a activarlas en Ajustes o en Ayuda.");
      };
      if (action) tipEl.querySelector(".tip-act").onclick = () => { close(); action.fn(); };
      document.body.appendChild(tipEl);
      return true;
    },
    hide() { tipEl?.remove(); tipEl = null; },
    get enabled() { return get("tips") !== "off"; },
  };
  window.Tips = Tips;

  /* ---------- Ayuda: menú y panel de atajos ---------- */
  window.showShortcuts = function (groups) {
    document.querySelector(".g-backdrop")?.remove();
    const b = document.createElement("div");
    b.className = "g-backdrop";
    b.innerHTML = `<div class="g-modal" role="dialog" aria-modal="true" aria-label="Atajos de teclado">
      <div class="g-head"><h3>Atajos de teclado</h3><button class="icon-btn" aria-label="Cerrar">✕</button></div>
      <div class="kb-cols">${groups.map(g => `<div><h5>${g.title}</h5>${g.rows.map(([label, keys]) =>
        `<div class="kb-row"><span>${label}</span><span>${keys.split(" ").map(k => `<kbd>${k}</kbd>`).join("")}</span></div>`).join("")}</div>`).join("")}
      </div></div>`;
    let release;
    const close = () => { b.remove(); document.removeEventListener("keydown", esc, true); release(); };
    const esc = e => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
    b.onclick = e => { if (e.target === b || e.target.closest(".g-head button")) close(); };
    document.addEventListener("keydown", esc, true);
    document.body.appendChild(b);
    release = trapFocus(b.querySelector(".g-modal"));
  };

  window.showHelp = function (anchor, tourId, shortcuts) {
    const r = anchor.getBoundingClientRect();
    const tipsOn = get("tips") !== "off";
    showMenu(r.left, r.bottom + 6, [
      { label: "Ver tutorial de esta pantalla", action: () => start(tourId) },
      shortcuts && { label: "Atajos de teclado", kbd: "?", action: () => showShortcuts(shortcuts) },
      "-",
      { label: tipsOn ? "Desactivar sugerencias" : "Activar sugerencias", action: () => {
        set("tips", tipsOn ? "off" : "on");
        toast(tipsOn ? "Sugerencias desactivadas" : "Sugerencias activadas");
      } },
      { label: "Volver a ver todos los tutoriales", action: () => { resetAll(); set("tours", "on"); toast("Los tutoriales y sugerencias volverán a aparecer"); } },
    ].filter(Boolean));
  };
})();
