// Panel del asistente con IA en el editor. Conversa con el modelo (vía el proceso principal, ver main/ai.js), que
// responde con texto y acciones; las acciones se aplican a la hoja con Editor.applyAI como un solo cambio.
(() => {
  "use strict";
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const ai = window.chinchero?.ai || null;
  const panel = $("#aiPanel"), log = $("#aiLog"), input = $("#aiInput"), send = $("#aiSend"), btn = $("#aiBtn");
  const msgs = []; // conversación: { role: "user" | "assistant", text }
  let busy = false, st = null;

  const NAMES = { ollama: "Ollama (en tu PC)", gemini: "Gemini (Google)" };
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
      nomodel: "Ollama no tiene ningún modelo instalado. Abre una terminal y escribe «ollama pull llama3.2».",
      offline: local ? "No se pudo conectar con Ollama. ¿Está abierto en tu PC?" : "No se pudo conectar con Google. Revisa tu conexión a internet.",
      timeout: "El modelo tardó demasiado en responder. Prueba de nuevo o con un pedido más corto.",
      400: "Google rechazó el pedido: revisa la clave y el modelo en Ajustes.",
      403: "La clave de Gemini no es válida o no tiene permiso. Revísala en Ajustes.",
      404: local ? "Ese modelo no está instalado en Ollama. Elige otro en Ajustes." : "Ese modelo de Gemini no existe. Elige otro en Ajustes.",
      429: "Se agotó el cupo gratis por ahora. Prueba de nuevo en un rato.",
    }[code] || (/^5\d\d$/.test(code) ? `El servicio no responde en este momento (error ${code}). Prueba en un rato.` : "No se pudo obtener una respuesta. Prueba de nuevo.");
  }

  function bubble(cls, html) {
    const d = document.createElement("div");
    d.className = "ai-msg " + cls;
    d.innerHTML = html;
    log.appendChild(d);
    log.scrollTop = log.scrollHeight;
    return d;
  }
  const settingsLink = '<button class="ai-link" data-go="ajustes">Abrir Ajustes</button>';

  // Estado del panel según los ajustes: sin app de escritorio, desactivado o listo
  function refresh() {
    st = ai ? ai.status() : null;
    const ready = !!st?.enabled && (st.provider !== "gemini" || st.hasKey);
    $("#aiWho").textContent = st?.enabled ? NAMES[st.provider] + (st.model ? " · " + st.model : "") : "";
    $("#aiPrivacy").textContent = !st?.enabled ? "" : st.provider === "gemini"
      ? "Con Gemini, el texto de esta hoja se envía a Google para responder."
      : "Ollama funciona en tu PC: nada sale del equipo.";
    [input, send, ...panel.querySelectorAll("[data-ask]")].forEach(el => el.disabled = !ready || busy);
    if (!log.children.length || log.dataset.state !== String(ready)) {
      log.dataset.state = ready;
      if (!msgs.length) log.innerHTML = "";
      if (!ai) bubble("info", "El asistente está disponible en la app de escritorio.");
      else if (!st.enabled) bubble("info", `El asistente con IA viene desactivado. Puedes usar <b>Ollama</b>, que funciona en tu PC sin internet, o <b>Gemini</b> de Google con una clave gratuita. ${settingsLink}`);
      else if (!ready) bubble("info", `Falta la clave de Gemini. ${settingsLink}`);
      else if (!msgs.length) bubble("info", "Pídeme ideas, que resuma u ordene la hoja, o que convierta notas en tareas. Puedo crear notas, fichas, listas, zonas e hilos. Todo lo que haga se deshace con Ctrl+Z.");
    }
    return ready;
  }

  async function ask(text) {
    text = text.trim();
    if (!text || busy || !refresh()) return;
    busy = true; refresh();
    bubble("user", esc(text));
    msgs.push({ role: "user", text });
    const wait = bubble("wait", "Pensando");
    const r = await ai.chat({ messages: msgs.slice(-12), board: Editor.boardForAI() }).catch(() => ({ error: "fail" }));
    wait.remove();
    busy = false;
    if (r.error) {
      msgs.pop();
      bubble("error", esc(errorText(r.error)) + (["off", "nokey", "400", "403", "404"].includes(r.error) ? " " + settingsLink : ""));
    } else {
      const n = r.actions.length ? Editor.applyAI(r.actions) : 0;
      const reply = r.text || (n ? "Listo." : "No entendí el pedido. ¿Puedes decirlo de otra forma?");
      msgs.push({ role: "assistant", text: reply });
      const b = bubble("assistant", esc(reply));
      if (n) {
        b.insertAdjacentHTML("beforeend", `<span class="ai-did">${n === 1 ? "1 cambio" : n + " cambios"} en la hoja <button data-undo>Deshacer</button></span>`);
        announce(`El asistente hizo ${n === 1 ? "1 cambio" : n + " cambios"} en la hoja`);
      } else announce(reply);
    }
    refresh();
    input.focus();
  }

  function open(prompt) {
    panel.hidden = false;
    document.body.classList.add("ai-open");
    btn.setAttribute("aria-expanded", "true");
    btn.classList.add("active");
    if (refresh() && prompt) ask(prompt);
    else (input.disabled ? $("#aiClose") : input).focus();
  }
  function close() {
    panel.hidden = true;
    document.body.classList.remove("ai-open");
    btn.setAttribute("aria-expanded", "false");
    btn.classList.remove("active");
    btn.focus();
  }

  btn.addEventListener("click", () => panel.hidden ? open() : close());
  $("#aiClose").addEventListener("click", close);
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
    if (t.hasAttribute("data-undo")) { Editor.undo(); t.parentElement.textContent = "Deshecho"; }
  });
  // Al volver de Ajustes en otra pestaña o ventana, el estado puede haber cambiado
  addEventListener("focus", () => { if (!panel.hidden) refresh(); });

  window.Asistente = { open, ideas: () => open(PROMPTS.ideas()), enabled: () => !!(ai && ai.status().enabled) };
})();
