// Atajos de teclado personalizables. Cada acción tiene su combinación por defecto; las que se cambian en Ajustes
// se guardan en la preferencia «keys» (JSON { acción: "Ctrl+D" }, "" = sin atajo). Una combinación se escribe
// «Ctrl+Alt+Shift+Tecla» y se compara con la del evento, así cambiar un atajo no toca el resto del código.
(function () {
  const ACTIONS = [
    { id: "tool.select", group: "Herramientas", label: "Seleccionar", def: "V" },
    { id: "tool.note", group: "Herramientas", label: "Nota", def: "N" },
    { id: "tool.card", group: "Herramientas", label: "Ficha", def: "F" },
    { id: "tool.list", group: "Herramientas", label: "Lista", def: "C" },
    { id: "tool.text", group: "Herramientas", label: "Texto", def: "T" },
    { id: "tool.image", group: "Herramientas", label: "Imagen", def: "I" },
    { id: "tool.link", group: "Herramientas", label: "Enlace", def: "K" },
    { id: "tool.file", group: "Herramientas", label: "Archivo", def: "A" },
    { id: "tool.sticker", group: "Herramientas", label: "Stickers", def: "S" },
    { id: "tool.zone", group: "Herramientas", label: "Zona", def: "Z" },
    { id: "tool.draw", group: "Herramientas", label: "Dibujo", def: "D" },
    { id: "eraser", group: "Herramientas", label: "Goma", def: "E" },
    { id: "tool.thread", group: "Herramientas", label: "Hilo", def: "L" },
    { id: "undo", group: "Edición", label: "Deshacer", def: "Ctrl+Z" },
    { id: "redo", group: "Edición", label: "Rehacer", def: "Ctrl+Y" },
    { id: "duplicate", group: "Edición", label: "Duplicar", def: "Ctrl+D" },
    { id: "selectAll", group: "Edición", label: "Seleccionar todo", def: "Ctrl+A" },
    { id: "group", group: "Edición", label: "Agrupar", def: "Ctrl+G" },
    { id: "ungroup", group: "Edición", label: "Desagrupar", def: "Ctrl+U" },
    { id: "front", group: "Edición", label: "Traer al frente", def: "Ctrl+]" },
    { id: "back", group: "Edición", label: "Enviar al fondo", def: "Ctrl+[" },
    { id: "lock", group: "Edición", label: "Bloquear / desbloquear", def: "Ctrl+Shift+L" },
    { id: "search", group: "Vista", label: "Buscar y acciones", def: "Ctrl+K" },
    { id: "zoom100", group: "Vista", label: "Zoom al 100 %", def: "Ctrl+0" },
    { id: "fit", group: "Vista", label: "Ajustar a la vista", def: "Shift+1" },
    { id: "prevSheet", group: "Vista", label: "Hoja anterior", def: "Ctrl+PageUp" },
    { id: "nextSheet", group: "Vista", label: "Hoja siguiente", def: "Ctrl+PageDown" },
    { id: "shortcuts", group: "Vista", label: "Ver los atajos", def: "?" },
    { id: "newBoard", group: "Tableros", label: "Nuevo tablero", def: "Ctrl+N" },
    { id: "findBoard", group: "Tableros", label: "Buscar tableros", def: "Ctrl+F" },
  ];
  // Fijas: no se pueden asignar a otra acción (navegación, edición de texto, portapapeles y sus variantes)
  const RESERVED = {
    "Escape": "Salir / cancelar", "Enter": "Editar el elemento", "F2": "Editar el elemento", "Tab": "Siguiente elemento", "Shift+Tab": "Elemento anterior",
    "Delete": "Eliminar", "Backspace": "Eliminar", "Space": "Mover el lienzo", "Shift+F10": "Opciones del elemento", "ContextMenu": "Opciones del elemento",
    "Ctrl+C": "Copiar", "Ctrl+X": "Cortar", "Ctrl+V": "Pegar", "Ctrl+Shift+V": "Pegar imagen sin marco o conservar el formato del texto", "Ctrl+Shift+Z": "Rehacer", "Ctrl+Shift+G": "Desagrupar",
  };
  for (const a of ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]) RESERVED[a] = RESERVED["Shift+" + a] = "Mover la selección";
  const byId = Object.fromEntries(ACTIONS.map(a => [a.id, a]));
  const SHOW = { PageUp: "RePág", PageDown: "AvPág", Delete: "Supr", Escape: "Esc", Space: "Espacio", ArrowLeft: "←", ArrowRight: "→", ArrowUp: "↑", ArrowDown: "↓", ContextMenu: "Menú" };

  // Combinación de un evento de teclado; "" si solo se pulsó un modificador
  function combo(e) {
    let k = e.key;
    if (!k || ["Control", "Shift", "Alt", "Meta", "AltGraph", "CapsLock", "Dead", "Unidentified"].includes(k)) return "";
    if (/^(Digit|Numpad)\d$/.test(e.code)) k = e.code.slice(-1); // Shift+1 en vez de «!»
    if (k === " ") k = "Space";
    const char = k.length === 1;
    if (char) k = k.toUpperCase();
    // «?» o «]» ya llevan la Mayús (o AltGr) en el propio carácter
    const shift = e.shiftKey && !(char && !/[\p{L}\d]/u.test(k));
    const alt = e.altKey && !e.getModifierState?.("AltGraph");
    return [(e.ctrlKey || e.metaKey) && "Ctrl", alt && "Alt", shift && "Shift", k].filter(Boolean).join("+");
  }

  const overrides = () => { try { return JSON.parse(getPref("keys") || "{}") || {}; } catch (e) { return {}; } };
  const save = o => setPref("keys", JSON.stringify(o));
  const get = id => { const o = overrides(); return typeof o[id] === "string" ? o[id] : byId[id]?.def || ""; };
  // Texto para mostrar: «Ctrl+RePág», «Shift+1»…
  const show = c => c ? c.split("+").map(p => SHOW[p] || p).join("+") : "";

  window.Keys = {
    ACTIONS, RESERVED, combo, get, show,
    label: id => show(get(id)),
    isCustom: id => typeof overrides()[id] === "string" && overrides()[id] !== byId[id].def,
    // Acción del evento, o null
    match(e) {
      const c = combo(e);
      if (!c) return null;
      const o = overrides();
      return ACTIONS.find(a => (typeof o[a.id] === "string" ? o[a.id] : a.def) === c)?.id || null;
    },
    // Acción que ya usa una combinación (sin contar `except`)
    owner: (c, except) => ACTIONS.find(a => a.id !== except && get(a.id) === c) || null,
    set(id, c) {
      const o = overrides();
      if (c === byId[id].def) delete o[id]; else o[id] = c;
      save(o);
    },
    reset(id) {
      if (!id) return save({});
      const o = overrides(); delete o[id]; save(o);
    },
  };
})();
