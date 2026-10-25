// Acceso a datos para las pantallas.
// En la app de escritorio usa window.chinchero (disco, vía preload); abierta en un navegador usa localStorage,
// lo que permite probar las pantallas sin Electron.
(function () {
  const native = window.chinchero || null;
  const LS = "chinchero-data-";
  const ls = {
    get(k, d) { try { const v = localStorage.getItem(LS + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(LS + k, JSON.stringify(v)); } catch (e) {} },
    del(k) { try { localStorage.removeItem(LS + k); } catch (e) {} },
  };
  const DAY = 86400000;
  const DEFAULT_LIBRARY = () => ({
    version: 1,
    groups: [
      { id: "personal", name: "Personal", color: "#51cf66" },
      { id: "trabajo", name: "Trabajo", color: "#4dabf7" },
      { id: "ideas", name: "Ideas", color: "#e8590c" },
    ],
    boards: [], trash: [], stickers: [],
  });

  let lib = null;

  const Store = {
    native: !!native,

    library() {
      if (lib) return lib;
      lib = native ? native.getLibrary() : ls.get("library", DEFAULT_LIBRARY());
      lib.trash ||= []; lib.stickers ||= [];
      // La papelera se vacía sola a los 30 días
      const expired = lib.trash.filter(t => Date.now() - t.deletedAt > 30 * DAY);
      if (expired.length) {
        expired.forEach(t => (t.kind === "group" ? t.boards : [t.board]).forEach(b => Store.deleteBoardFile(b.id)));
        lib.trash = lib.trash.filter(t => !expired.includes(t));
        Store.saveLibrary();
      }
      return lib;
    },
    saveLibrary() { native ? native.saveLibrary(lib) : ls.set("library", lib); },

    loadBoard(id) { return native ? native.loadBoard(id) : ls.get("board-" + id, null); },
    saveBoard(id, doc) { return native ? native.saveBoard(id, doc) : ls.set("board-" + id, doc); },
    deleteBoardFile(id) { native ? native.deleteBoard(id) : ls.del("board-" + id); },

    // Copia una imagen o archivo a la carpeta de datos y devuelve la URL persistente
    importFile(file) {
      if (native) return native.importFile(file);
      return new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(file); });
    },

    info() {
      return native ? native.info() : { version: "0.1.0", dataDir: "Almacenamiento del navegador (modo de prueba)", packaged: false, firstRun: !ls.get("firstRunDone", false) };
    },
    firstRunDone() { native ? native.firstRunDone() : ls.set("firstRunDone", true); },

    uid(prefix = "b") { return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); },
    board(id) { return Store.library().boards.find(b => b.id === id); },
    group(id) { return Store.library().groups.find(g => g.id === id); },
    touch(id, patch) {
      const b = Store.board(id);
      if (!b) return;
      Object.assign(b, patch);
      Store.saveLibrary();
    },

    trashBoard(id) {
      const l = Store.library(), b = Store.board(id);
      if (!b) return null;
      const entry = { id: Store.uid("t"), kind: "board", name: b.name, deletedAt: Date.now(), board: b };
      l.boards = l.boards.filter(x => x.id !== id);
      l.trash.unshift(entry);
      Store.saveLibrary();
      return entry;
    },
    trashGroup(gid) {
      const l = Store.library(), g = Store.group(gid);
      if (!g) return null;
      const boards = l.boards.filter(b => b.group === gid);
      const entry = { id: Store.uid("t"), kind: "group", name: g.name, deletedAt: Date.now(), group: g, boards };
      l.groups = l.groups.filter(x => x.id !== gid);
      l.boards = l.boards.filter(b => b.group !== gid);
      l.trash.unshift(entry);
      Store.saveLibrary();
      return entry;
    },
    restore(trashId) {
      const l = Store.library(), t = l.trash.find(x => x.id === trashId);
      if (!t) return;
      if (t.kind === "group") {
        if (!Store.group(t.group.id)) l.groups.push(t.group);
        l.boards.push(...t.boards);
      } else {
        if (!Store.group(t.board.group)) t.board.group = l.groups[0]?.id;
        l.boards.push(t.board);
      }
      l.trash = l.trash.filter(x => x !== t);
      Store.saveLibrary();
    },
    purge(trashId) {
      const l = Store.library(), t = l.trash.find(x => x.id === trashId);
      if (!t) return;
      (t.kind === "group" ? t.boards : [t.board]).forEach(b => Store.deleteBoardFile(b.id));
      l.trash = l.trash.filter(x => x !== t);
      Store.saveLibrary();
    },

    // Funciones que solo existen en la app de escritorio; en el navegador avisan
    desktop(fn, ...args) {
      if (native && native[fn]) return native[fn](...args);
      window.toast?.("Disponible en la app de escritorio");
      return Promise.resolve(null);
    },
  };

  window.Store = Store;

  // Avisos que deben verse en la pantalla siguiente (p. ej. tras restaurar) y archivos dañados recuperados de una copia
  setTimeout(() => {
    const t = window.toast || (() => {});
    let aviso = null;
    try { aviso = sessionStorage.getItem("chinchero-aviso"); sessionStorage.removeItem("chinchero-aviso"); } catch {}
    if (aviso) t(aviso);
    if (!native?.takeRecovered) return;
    for (const r of native.takeRecovered()) {
      t(r.ok
        ? `No se pudo leer ${r.label}; lo recuperamos de la copia automática (${relTime(r.when)}).`
        : `No se pudo leer ${r.label} y no hay copia para recuperarlo. El archivo dañado quedó apartado en la carpeta de datos.`);
    }
  }, 600);

  window.relTime = function (ts) {
    if (!ts) return "";
    const s = (Date.now() - ts) / 1000;
    if (s < 60) return "ahora";
    if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
    if (s < 86400) return `hace ${Math.floor(s / 3600)} h`;
    if (s < 2 * 86400) return "ayer";
    if (s < 14 * 86400) return `hace ${Math.floor(s / 86400)} días`;
    if (s < 60 * 86400) return `hace ${Math.floor(s / 604800)} semanas`;
    return new Date(ts).toLocaleDateString("es-AR", { day: "numeric", month: "short", year: "numeric" });
  };

  // Avisos de actualización (solo en la app instalada)
  if (native) native.onUpdate(u => {
    const t = window.toast || (() => {});
    if (u.state === "available") t(`Descargando la versión ${u.version}…`);
    else if (u.state === "none") t(`Ya tienes la última versión (${u.version})`);
    else if (u.state === "dev") t("En modo desarrollo no se buscan actualizaciones");
    else if (u.state === "error") t("No se pudo buscar actualizaciones. Revisa tu conexión.");
    else if (u.state === "ready") {
      // Si el usuario lo cerró, no se insiste en cada pantalla: se instalará al cerrar Chinchero
      let oculto = null;
      try { oculto = sessionStorage.getItem("update-oculto"); } catch {}
      if (oculto === u.version) return;
      document.querySelector(".update-banner")?.remove();
      const b = document.createElement("div");
      b.className = "update-banner";
      b.innerHTML = `<span>La versión <b>${u.version}</b> está lista. Se instalará al cerrar Chinchero.</span><button class="btn btn-primary">Reiniciar ahora</button><button class="icon-btn" aria-label="Cerrar">✕</button>`;
      // La instalación tarda unos segundos (y puede pedir permiso de Windows): se avisa qué va a pasar
      b.querySelector(".btn").onclick = () => {
        b.innerHTML = `<span class="update-spinner" aria-hidden="true"></span><span role="status">Instalando la versión <b>${u.version}</b>… Chinchero se cerrará y volverá a abrirse solo. Si Windows pide permiso, haz clic en «Sí».</span>`;
        native.installUpdate();
      };
      b.querySelector(".icon-btn").onclick = () => {
        try { sessionStorage.setItem("update-oculto", u.version); } catch {}
        b.remove();
      };
      document.body.appendChild(b);
    }
  });
})();
