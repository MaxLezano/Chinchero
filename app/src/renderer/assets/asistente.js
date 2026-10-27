// Panel del asistente con IA en el editor. Conversa con el modelo (vía el proceso principal, ver main/ai.js), que
// responde con texto y acciones; las acciones se aplican a la hoja con Editor.applyAI como un solo cambio.
// La conversación se recuerda por tablero (localStorage del perfil, no en la carpeta de datos ni en lo que se comparte).
(() => {
  "use strict";
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const ai = window.chinchero?.ai || null;
  const panel = $("#aiPanel"), log = $("#aiLog"), input = $("#aiInput"), send = $("#aiSend"), btn = $("#aiBtn");
  const chips = $("#aiChips"), tips = $("#aiTips"), pick = $("#aiModelPick");
  const KEEP = 40; // mensajes que se recuerdan; al modelo van los últimos 12
  const KEY = "chinchero-chat-" + Editor.boardId();
  let msgs = []; // conversación: { role: "user" | "assistant", text, n? (cambios hechos) }
  try { msgs = (JSON.parse(localStorage.getItem(KEY)) || []).filter(m => m && /^(user|assistant)$/.test(m.role) && typeof m.text === "string"); } catch (e) {}
  const remember = () => { try { msgs.length ? localStorage.setItem(KEY, JSON.stringify(msgs.slice(-KEEP))) : localStorage.removeItem(KEY); } catch (e) {} };
  let busy = false, st = null, shown = null, models = null;

  const NAMES = { ollama: "Ollama", gemini: "Gemini" };
  const PROMPTS = {
    ideas: () => {
      const sel = Editor.selected();
      return sel.length
        ? `Propón 4 ideas relacionadas con ${sel.join(", ")}. Créalas como notas junto a ese elemento y únelas con hilos.`
        : "Propón 5 ideas nuevas relacionadas con lo que hay en la hoja. Créalas como notas cerca del elemento con el que tengan que ver y únelas con hilos.";
    },
    resumir: () => "Resume en pocas frases lo que hay en esta hoja y añade una ficha «Resumen» con ese resumen.",
    ordenar: () => "Ordena los elementos de la hoja en zonas por tema.",
    tareas: () => "Busca las tareas pendientes que aparecen en la hoja y crea una lista con ellas.",
  };
  function errorText(code) {
    const local = st?.provider === "ollama";
    return {
      off: "El asistente está desactivado. Actívalo en Ajustes.",
      nokey: "Falta la clave de Gemini. Ve a Ajustes → Asistente con IA.",
      nomodel: "Ollama no tiene ningún modelo instalado. Descarga uno en Ajustes → Asistente con IA.",
      offline: local ? "No se pudo poner en marcha Ollama. Revísalo en Ajustes → Asistente con IA." : "No se pudo conectar con Google. Revisa tu conexión a internet.",
      timeout: "El modelo tardó demasiado en responder. Prueba de nuevo o con un pedido más corto.",
      400: "Google rechazó el pedido: revisa la clave y el modelo en Ajustes.",
      403: "La clave de Gemini no es válida o no tiene permiso. Revísala en Ajustes.",
      404: local ? "Ese modelo no está instalado en Ollama. Elige otro arriba." : "Ese modelo de Gemini no está disponible. Elige otro arriba.",
      429: "Se agotó el cupo gratis por ahora. Prueba de nuevo en un rato.",
    }[code] || (/^5\d\d$/.test(code) ? `Los modelos de Google están saturados en este momento (error ${code}). Prueba en un rato.` : "No se pudo obtener una respuesta. Prueba de nuevo.");
  }
  const changes = n => n === 1 ? "1 cambio" : n + " cambios";

  function bubble(cls, html) {
    const d = document.createElement("div");
    d.className = "ai-msg " + cls;
    d.innerHTML = html;
    log.appendChild(d);
    log.scrollTop = log.scrollHeight;
    return d;
  }
  const settingsLink = '<button class="ai-link" data-go="ajustes">Abrir Ajustes</button>';
  const showMsg = m => {
    const b = bubble(m.role, esc(m.text));
    if (m.n) b.insertAdjacentHTML("beforeend", `<span class="ai-did">${m.undone ? "Deshecho" : changes(m.n) + " en la hoja"}</span>`);
    return b;
  };

  // Pedidos rápidos: a la vista mientras la conversación está vacía; después, con el botón de la bombilla
  function showTips(on) {
    chips.hidden = !on;
    tips.setAttribute("aria-pressed", on);
  }

  // Modelo elegido: se cambia desde el panel (se guarda igual que en Ajustes). La lista se pide una vez por pantalla.
  function modelOptions(list) {
    const auto = st.provider === "gemini" ? "Automático (el más rápido disponible)" : "Automático (el primero instalado)";
    if (st.model && !list.includes(st.model)) list = [st.model, ...list];
    pick.innerHTML = `<option value="">${esc(auto)}</option>` + list.map(m => `<option value="${esc(m)}">${esc(m)}${/-pro\b/.test(m) ? " · sin cupo gratis" : ""}</option>`).join("");
    pick.value = st.model || "";
    pick.title = pick.selectedOptions[0]?.textContent || "";
  }
  async function loadModels() {
    const prov = st.provider;
    modelOptions(models?.prov === prov ? models.list : []);
    if (models?.prov === prov) return;
    const r = await ai.models(prov);
    if (prov !== st.provider || r.error) return;
    models = { prov, list: r.models };
    modelOptions(models.list);
  }

  // Estado del panel según los ajustes: sin app de escritorio, desactivado o listo
  function refresh() {
    st = ai ? ai.status() : null;
    const ready = !!st?.enabled && (st.provider !== "gemini" || st.hasKey);
    $("#aiModelBar").hidden = !ready;
    if (ready) { $("#aiWho").textContent = NAMES[st.provider]; loadModels(); }
    $("#aiPrivacy").textContent = !st?.enabled ? "" : st.provider === "gemini"
      ? "Con Gemini, el texto de esta hoja se envía a Google para responder."
      : "Ollama funciona en tu PC: nada sale del equipo.";
    [input, send, pick, ...panel.querySelectorAll("[data-ask]")].forEach(el => el.disabled = !ready || busy);
    $("#aiNew").disabled = busy || !msgs.length;
    if (shown !== ready) {
      shown = ready;
      log.innerHTML = "";
      if (!ai) bubble("info", "El asistente está disponible en la app de escritorio.");
      else if (!st.enabled) bubble("info", `El asistente con IA viene desactivado. Lo más fácil es <b>Gemini</b> de Google, gratis y sin instalar nada: en Ajustes te guiamos paso a paso. Si prefieres usarlo sin internet, Chinchero puede instalar <b>Ollama</b>. ${settingsLink}`);
      else if (!ready) bubble("info", `Falta la clave de Gemini. ${settingsLink}`);
      else if (!msgs.length) bubble("info", "Pídeme ideas, que resuma u ordene la hoja, o que convierta notas en tareas. Puedo armar tableros completos con notas, fichas, listas, zonas, hilos y dibujos, y trabajar en otras hojas. Todo lo que haga se deshace con Ctrl+Z.");
      msgs.forEach(showMsg);
    }
    return ready;
  }

  async function ask(text) {
    text = text.trim();
    if (!text || busy || !refresh()) return;
    if (!msgs.length) log.innerHTML = ""; // la bienvenida deja lugar a la conversación
    busy = true; refresh();
    showTips(false);
    bubble("user", esc(text));
    msgs.push({ role: "user", text });
    const wait = bubble("wait", "Pensando");
    // Un modelo saturado puede tardar casi un minuto antes de que se pruebe otro
    const slow = setTimeout(() => wait.textContent = "Está tardando más de lo normal" + (st.provider === "gemini" ? "; si no responde, probaré con otro modelo" : ""), 12000);
    // Lo que hizo cada respuesta (con ids) va junto a su texto: así el modelo sabe a qué se refiere «hazlo» o «eso»
    const toModel = m => ({ role: m.role, text: m.did ? `${m.text}\n[${m.undone ? "Deshecho por el usuario" : "Hecho"}: ${m.did}]` : m.text });
    const r = await ai.chat({ messages: msgs.slice(-12).map(toModel), board: Editor.boardForAI() }).catch(() => ({ error: "fail" }));
    clearTimeout(slow);
    wait.remove();
    busy = false;
    if (r.error) {
      msgs.pop();
      bubble("error", esc(errorText(r.error)) + (["off", "nokey", "nomodel", "400", "403"].includes(r.error) ? " " + settingsLink : ""));
    } else {
      const did = [];
      const n = r.actions.length ? Editor.applyAI(r.actions, did) : 0;
      const reply = r.text || (n ? "Listo." : "No entendí el pedido. ¿Puedes decirlo de otra forma?");
      msgs.push({ role: "assistant", text: reply, ...(n && { n, did: did.join("; ").slice(0, 1500) }) });
      const b = bubble("assistant", esc(reply));
      if (n) {
        b.insertAdjacentHTML("beforeend", `<span class="ai-did">${changes(n)} en la hoja <button data-undo="${msgs.length - 1}">Deshacer</button></span>`);
        announce(`El asistente hizo ${changes(n)} en la hoja`);
      } else announce(reply);
      // El modelo elegido no respondió (saturado, sin cupo…) y contestó uno de respaldo
      if (st.model && r.model && r.model !== st.model) b.insertAdjacentHTML("beforeend", `<span class="ai-note">${esc(st.model)} no respondió; contestó ${esc(r.model)}.</span>`);
    }
    remember();
    refresh();
    input.focus();
  }

  function newChat() {
    if (busy || !msgs.length) return;
    msgs = [];
    remember();
    shown = null;
    refresh();
    showTips(true);
    input.focus();
    announce("Nueva conversación");
  }

  function open(prompt) {
    if (panel.hidden) {
      // El panel crece desde Chinche: se mide el pin antes de que se esconda
      const r = btn.getBoundingClientRect();
      panel.hidden = false;
      const p = panel.getBoundingClientRect();
      panel.style.transformOrigin = `${r.left + r.width / 2 - p.left}px ${r.top + r.height / 2 - p.top}px`;
      panel.classList.add("sale");
    }
    document.body.classList.add("ai-open");
    btn.setAttribute("aria-expanded", "true");
    log.scrollTop = log.scrollHeight;
    if (refresh() && prompt) ask(prompt);
    else (input.disabled ? $("#aiClose") : input).focus();
  }
  function close() {
    panel.hidden = true;
    panel.classList.remove("sale");
    document.body.classList.remove("ai-open");
    btn.setAttribute("aria-expanded", "false");
    btn.focus();
  }

  btn.addEventListener("click", () => panel.hidden ? open() : close());
  panel.addEventListener("animationend", e => { if (e.target === panel) panel.classList.remove("sale"); });
  $("#aiClose").addEventListener("click", close);
  $("#aiNew").addEventListener("click", newChat);
  tips.addEventListener("click", () => showTips(chips.hidden));
  pick.addEventListener("change", async () => {
    st = await ai.config({ model: pick.value });
    pick.title = pick.selectedOptions[0]?.textContent || "";
    toast("Modelo cambiado");
  });
  send.addEventListener("click", () => { const t = input.value; input.value = ""; ask(t); });
  input.addEventListener("keydown", e => {
    // Enter envía; Mayús+Enter es salto de línea (los atajos del lienzo no actúan dentro de un textarea)
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); send.click(); }
  });
  panel.addEventListener("keydown", e => { if (e.key === "Escape") { e.stopPropagation(); close(); } });
  panel.addEventListener("click", e => {
    const t = e.target.closest("button");
    if (!t) return;
    if (t.dataset.ask) ask(PROMPTS[t.dataset.ask]());
    if (t.dataset.go) location.href = "03-ajustes.html#asistente";
    if (t.hasAttribute("data-undo")) {
      Editor.undo();
      t.parentElement.textContent = "Deshecho";
      if (msgs[t.dataset.undo]) { msgs[t.dataset.undo].undone = true; remember(); }
    }
  });
  // Al volver de Ajustes en otra pestaña o ventana, el estado puede haber cambiado
  addEventListener("focus", () => { if (!panel.hidden) { models = null; refresh(); } });
  showTips(!msgs.length);

  window.Asistente = { open, ideas: () => open(PROMPTS.ideas()), enabled: () => !!(ai && ai.status().enabled) };
})();
