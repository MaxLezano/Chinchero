// Barra lateral compartida. Uso: <aside class="sidebar" data-active="recent|fav|group:<id>|trash|settings">
// La vista define window.HELP = { tour, shortcuts } para el botón de ayuda.
(function () {
  const svg = p => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${p}</svg>`;
  const I = {
    clock: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
    star: svg('<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>'),
    trash: svg('<path d="M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3"/>'),
    moon: '<svg class="icon ico-moon" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
    sun: '<svg class="icon ico-sun" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
    gear: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
    help: svg('<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17.5h.01"/>'),
    plus: svg('<path d="M12 5v14M5 12h14"/>'),
  };
  const COLORS = ["#e8590c", "#4dabf7", "#51cf66", "#cc5de8", "#fab005", "#f06595"];

  const lib = Store.library();
  window.GROUPS = lib.groups;
  const countOf = gid => lib.boards.filter(b => b.group === gid).length;

  const el = document.querySelector(".sidebar");
  const active = el.dataset.active || "";
  const on = key => (key === active ? ' active" aria-current="page' : "");

  function groupRow(g) {
    return `<a class="nav-item${on("group:" + g.id)}" href="01-tableros.html?group=${g.id}" data-group="${g.id}">
      <span class="group-dot" style="background:${g.color}"></span><span class="gname">${esc(g.name)}</span><span class="count">${countOf(g.id)}</span></a>`;
  }

  el.setAttribute("aria-label", "Navegación");
  el.innerHTML = `
    <a class="brand" href="01-tableros.html"><div class="brand-mark surface-cork"><span class="pin"></span></div>Chinchero</a>
    <a class="nav-item${on("recent")}" href="01-tableros.html?view=recent">${I.clock}Recientes</a>
    <a class="nav-item${on("fav")}" href="01-tableros.html?view=fav">${I.star}Favoritos</a>
    <div class="section-label">Grupos <button id="newGroup" aria-label="Nuevo grupo" data-tip="Nuevo grupo" data-tip-pos="left">${I.plus}</button></div>
    <div id="groupList">${GROUPS.map(groupRow).join("")}</div>
    <a class="nav-item${on("trash")}" href="04-papelera.html" style="margin-top:8px">${I.trash}Papelera<span class="count" id="trashCount">${lib.trash.length || ""}</span></a>
    <div class="sidebar-footer">
      <button class="icon-btn" aria-label="Cambiar tema" data-tip="Cambiar tema" data-tip-pos="top" onclick="toggleTheme()">${I.moon}${I.sun}</button>
      <a class="icon-btn${on("settings")}" aria-label="Ajustes" data-tip="Ajustes" data-tip-pos="top" href="03-ajustes.html">${I.gear}</a>
      <button class="icon-btn" id="helpBtn" aria-label="Ayuda" data-tip="Ayuda" data-tip-pos="top">${I.help}</button>
    </div>`;

  const list = el.querySelector("#groupList");

  el.querySelector("#helpBtn").onclick = e => {
    const h = window.HELP || {};
    showHelp(e.currentTarget, h.tour, h.shortcuts);
  };

  function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
  const groupOf = row => Store.group(row.dataset.group);

  function renameInline(row) {
    const name = row.querySelector(".gname");
    const input = document.createElement("input");
    input.value = name.textContent;
    input.setAttribute("aria-label", "Nombre del grupo");
    name.replaceWith(input);
    input.focus(); input.select();
    input.onblur = () => {
      const span = document.createElement("span");
      span.className = "gname";
      span.textContent = input.value.trim() || "Sin nombre";
      input.replaceWith(span);
      const g = groupOf(row);
      if (g && g.name !== span.textContent) { g.name = span.textContent; Store.saveLibrary(); document.dispatchEvent(new CustomEvent("groups-changed")); }
    };
    input.onkeydown = e => { if (e.key === "Enter" || e.key === "Escape") input.blur(); };
    input.onclick = e => e.preventDefault();
  }

  el.querySelector("#newGroup").onclick = () => {
    const g = { id: Store.uid("g"), name: "Nuevo grupo", color: COLORS[GROUPS.length % COLORS.length] };
    GROUPS.push(g);
    Store.saveLibrary();
    list.insertAdjacentHTML("beforeend", groupRow(g));
    renameInline(list.lastElementChild);
  };

  list.addEventListener("contextmenu", e => {
    const row = e.target.closest("[data-group]");
    if (!row) return;
    e.preventDefault();
    showMenu(e.clientX, e.clientY, [
      { label: "Abrir", action: () => row.click() },
      { label: "Renombrar", kbd: "F2", action: () => renameInline(row) },
      { label: "Cambiar color", action: () => {
        const g = groupOf(row);
        g.color = COLORS[(COLORS.indexOf(g.color) + 1) % COLORS.length];
        row.querySelector(".group-dot").style.background = g.color;
        Store.saveLibrary();
        document.dispatchEvent(new CustomEvent("groups-changed"));
      } },
      "-",
      { label: "Eliminar grupo", danger: true, action: () => {
        const n = countOf(row.dataset.group);
        if (n && !confirm(`El grupo tiene ${n} tablero${n > 1 ? "s" : ""}. Se enviará${n > 1 ? "n" : ""} a la papelera junto con el grupo. ¿Continuar?`)) return;
        const entry = Store.trashGroup(row.dataset.group);
        const leaving = row.classList.contains("active");
        row.remove();
        el.querySelector("#trashCount").textContent = lib.trash.length;
        document.dispatchEvent(new CustomEvent("groups-changed"));
        if (leaving) return location.replace("01-tableros.html?view=recent");
        toast("Grupo enviado a la papelera", "Deshacer", () => { Store.restore(entry.id); location.reload(); });
      } },
    ]);
  });

  // Soltar una tarjeta de tablero sobre un grupo para moverla (lo maneja la vista 01)
  list.addEventListener("dragover", e => {
    const row = e.target.closest("[data-group]");
    if (!row || !e.dataTransfer.types.includes("text/board")) return;
    e.preventDefault();
    list.querySelectorAll(".drop").forEach(r => r !== row && r.classList.remove("drop"));
    row.classList.add("drop");
  });
  list.addEventListener("dragleave", e => e.target.closest?.("[data-group]")?.classList.remove("drop"));
  list.addEventListener("drop", e => {
    const row = e.target.closest("[data-group]");
    if (!row) return;
    e.preventDefault();
    row.classList.remove("drop");
    document.dispatchEvent(new CustomEvent("board-move", { detail: { board: e.dataTransfer.getData("text/board"), group: row.dataset.group } }));
  });

  window.setGroupCounts = () => {
    list.querySelectorAll("[data-group]").forEach(r => { r.querySelector(".count").textContent = countOf(r.dataset.group); });
    el.querySelector("#trashCount").textContent = lib.trash.length || "";
  };
})();
