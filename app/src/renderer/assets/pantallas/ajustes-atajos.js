// Ajustes → Atajos: cada atajo es un botón; al pulsarlo espera la nueva combinación (ver assets/keys.js)
(function () {
  const table = document.getElementById("keyTable");
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  let recording = null;

  function render() {
    let html = "", group = "";
    for (const a of Keys.ACTIONS) {
      if (a.group !== group) { group = a.group; html += `<tr class="grp"><td colspan="2">${esc(group)}</td></tr>`; }
      const k = Keys.label(a.id);
      html += `<tr><td>${esc(a.label)}</td><td>
        <button class="keybtn${k ? "" : " none"}" data-key="${esc(a.id)}" aria-label="${esc(a.label)}: ${esc(k || "sin atajo")}. Pulsa para cambiarlo">${esc(k || "Sin atajo")}</button>
        <button class="icon-btn keyreset" data-reset="${esc(a.id)}" title="Restablecer (${esc(Keys.show(a.def))})" aria-label="Restablecer ${esc(a.label)}"${Keys.isCustom(a.id) ? "" : " hidden"}>↺</button>
      </td></tr>`;
    }
    table.innerHTML = html;
  }

  function stop(focus) {
    if (!recording) return;
    const id = recording.dataset.key;
    document.removeEventListener("keydown", onKey, true);
    recording = null;
    render();
    if (focus) table.querySelector(`[data-key="${id}"]`)?.focus();
  }

  function start(b) {
    stop();
    recording = b;
    b.classList.add("rec");
    b.textContent = "Pulsa la combinación…";
    announce("Pulsa la nueva combinación. Escape cancela, Suprimir quita el atajo.");
    document.addEventListener("keydown", onKey, true);
  }

  function onKey(e) {
    e.preventDefault(); e.stopPropagation();
    const id = recording.dataset.key, a = Keys.ACTIONS.find(x => x.id === id);
    if (e.key === "Escape") return stop(true);
    if (e.key === "Delete" || e.key === "Backspace") {
      Keys.set(id, "");
      toast(`«${a.label}» queda sin atajo`);
      return stop(true);
    }
    const c = Keys.combo(e);
    if (!c) return; // solo un modificador: sigue esperando la tecla
    if (Keys.RESERVED[c]) return toast(`${Keys.show(c)} está reservado para «${Keys.RESERVED[c]}». Prueba otra combinación.`);
    if (/^(Shift\+)?(Enter|Tab|Home|End|Insert|PageUp|PageDown|F1|F5|F11|F12)$/.test(c))
      return toast(`${Keys.show(c)} no se puede usar como atajo. Prueba otra combinación.`);
    const other = Keys.owner(c, id);
    if (other && !confirm(`${Keys.show(c)} ya es el atajo de «${other.label}». ¿Usarlo para «${a.label}» y dejar «${other.label}» sin atajo?`)) return stop(true);
    if (other) Keys.set(other.id, "");
    Keys.set(id, c);
    toast(`«${a.label}»: ${Keys.show(c)}`);
    stop(true);
  }

  table.addEventListener("click", e => {
    const r = e.target.closest("[data-reset]");
    if (r) {
      const a = Keys.ACTIONS.find(x => x.id === r.dataset.reset);
      const other = Keys.owner(a.def, a.id);
      if (other && !confirm(`${Keys.show(a.def)} ya es el atajo de «${other.label}». ¿Restablecerlo igualmente y dejar «${other.label}» sin atajo?`)) return;
      if (other) Keys.set(other.id, "");
      Keys.reset(a.id);
      render();
      toast(`«${a.label}» vuelve a ${Keys.show(a.def)}`);
      table.querySelector(`[data-key="${a.id}"]`)?.focus();
      return;
    }
    const b = e.target.closest("[data-key]");
    if (b && b !== recording) start(b);
  });
  // Un clic fuera cancela la espera
  document.addEventListener("pointerdown", e => { if (recording && !recording.contains(e.target)) stop(); });

  document.getElementById("resetKeys").addEventListener("click", () => {
    if (!confirm("¿Volver a los atajos de teclado originales?")) return;
    Keys.reset();
    render();
    toast("Atajos restablecidos");
  });

  render();
})();
