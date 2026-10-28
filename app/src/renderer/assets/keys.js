// Atajos de teclado personalizables. Cada acción tiene su combinación por defecto; las que se cambian en Ajustes
// se guardan en la preferencia «keys» (JSON { acción: "Ctrl+D" }, "" = sin atajo). Una combinación se escribe
// «Ctrl+Alt+Shift+Tecla» y se compara con la del evento, así cambiar un atajo no toca el resto del código.
(function () {
  // Nombre y grupo en el idioma actual (atajos.acciones.* y atajos.grupos.* de los textos)
  const ACTIONS = [
    ["tool.select", "herramientas", "V"],
    ["tool.note", "herramientas", "N"],
    ["tool.card", "herramientas", "F"],
    ["tool.list", "herramientas", "C"],
    ["tool.text", "herramientas", "T"],
    ["tool.image", "herramientas", "I"],
    ["tool.link", "herramientas", "K"],
    ["tool.file", "herramientas", "A"],
    ["tool.sticker", "herramientas", "S"],
    ["tool.zone", "herramientas", "Z"],
    ["tool.draw", "herramientas", "D"],
    ["eraser", "herramientas", "E"],
    ["tool.thread", "herramientas", "L"],
    ["undo", "edicion", "Ctrl+Z"],
    ["redo", "edicion", "Ctrl+Y"],
    ["duplicate", "edicion", "Ctrl+D"],
    ["selectAll", "edicion", "Ctrl+A"],
    ["group", "edicion", "Ctrl+G"],
    ["ungroup", "edicion", "Ctrl+U"],
    ["front", "edicion", "Ctrl+]"],
    ["back", "edicion", "Ctrl+["],
    ["lock", "edicion", "Ctrl+Shift+L"],
    ["search", "vista", "Ctrl+K"],
    ["zoom100", "vista", "Ctrl+0"],
    ["fit", "vista", "Shift+1"],
    ["prevSheet", "vista", "Ctrl+PageUp"],
    ["nextSheet", "vista", "Ctrl+PageDown"],
    ["shortcuts", "vista", "?"],
    ["newBoard", "tableros", "Ctrl+N"],
    ["findBoard", "tableros", "Ctrl+F"],
  ].map(([id, group, def]) => ({
    id, def,
    get label() { return t("atajos.acciones." + id.replace(".", "_")); },
    get group() { return t("atajos.grupos." + group); },
  }));
  // Fijas: no se pueden asignar a otra acción (navegación, edición de texto, portapapeles y sus variantes).
  // El valor es la clave de su nombre en atajos.reservadas.*
  const RESERVED = {
    "Escape": "salir", "Enter": "editar", "F2": "editar", "Tab": "siguiente", "Shift+Tab": "anterior",
    "Delete": "eliminar", "Backspace": "eliminar", "Space": "moverLienzo", "Shift+F10": "opciones", "ContextMenu": "opciones",
    "Ctrl+C": "copiar", "Ctrl+X": "cortar", "Ctrl+V": "pegar", "Ctrl+Shift+V": "pegarSinMarco", "Ctrl+Shift+Z": "rehacer", "Ctrl+Shift+G": "desagrupar",
  };
  for (const a of ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]) RESERVED[a] = RESERVED["Shift+" + a] = "moverSeleccion";
  const byId = Object.fromEntries(ACTIONS.map(a => [a.id, a]));
  // Teclas con nombre propio de cada idioma (RePág / PgUp) o con flecha
  const NAMED = ["PageUp", "PageDown", "Delete", "Space", "ContextMenu"];
  const ARROWS = { Escape: "Esc", ArrowLeft: "←", ArrowRight: "→", ArrowUp: "↑", ArrowDown: "↓" };
  const keyName = p => NAMED.includes(p) ? t("atajos.teclas." + p) : ARROWS[p] || p;

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
  const show = c => c ? c.split("+").map(keyName).join("+") : "";

  window.Keys = {
    ACTIONS, RESERVED, combo, get, show,
    // Para qué está reservada una combinación, o "" si no lo está
    reserved: c => RESERVED[c] ? t("atajos.reservadas." + RESERVED[c]) : "",
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
