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
        ? t("ia.pedidos.ideasSel", { sel: sel.join(", ") })
        : t("ia.pedidos.ideas");
    },
    resumir: () => t("ia.pedidos.resumir"),
    ordenar: () => t("ia.pedidos.ordenar"),
    tareas: () => t("ia.pedidos.tareas"),
  };
  function errorText(code) {
    const local = st?.provider === "ollama";
    const key = {
      off: "off", nokey: "nokey", nomodel: "nomodel", offline: local ? "offlineOllama" : "offlineGemini", timeout: "timeout",
      400: "rechazado", 403: "clave", 404: local ? "modeloOllama" : "modeloGemini", 429: "cupo",
    }[code];
    return key ? t("ia.errores." + key) : /^5\d\d$/.test(code) ? t("ia.errores.saturado", { code }) : t("ia.errores.otro");
  }
  const changes = n => t("ia.cambios", { count: n });

  function bubble(cls, html) {
    const d = document.createElement("div");
    d.className = "ai-msg " + cls;
    d.innerHTML = html;
    log.appendChild(d);
    log.scrollTop = log.scrollHeight;
    return d;
  }
  const settingsLink = () => `<button class="ai-link" data-go="ajustes">${t("ia.abrirAjustes")}</button>`;
  const showMsg = m => {
    const b = bubble(m.role, esc(m.text));
    if (m.n) b.insertAdjacentHTML("beforeend", `<span class="ai-did">${m.undone ? t("ia.deshecho") : t("ia.enLaHoja", { changes: changes(m.n) })}</span>`);
    return b;
  };

  // Pedidos rápidos: a la vista mientras la conversación está vacía; después, con el botón de la bombilla
  function showTips(on) {
    chips.hidden = !on;
    tips.setAttribute("aria-pressed", on);
  }

  // Modelo elegido: se cambia desde el panel (se guarda igual que en Ajustes). La lista se pide una vez por pantalla.
  function modelOptions(list) {
    const auto = t(st.provider === "gemini" ? "ajustesIa.modelos.autoGemini" : "ajustesIa.modelos.autoOllama");
    if (st.model && !list.includes(st.model)) list = [st.model, ...list];
    const hint = m => /-pro\b/.test(m) ? " · " + t("ajustesIa.modelos.sinCupo") : /^qwen3:4b$/.test(m) ? " · " + t("ajustesIa.modelos.mejorCalidad") : /^llama3\.2(:latest)?$/.test(m) ? " · " + t("ajustesIa.modelos.masRapido") : "";
    pick.innerHTML = `<option value="">${esc(auto)}</option>` + list.map(m => `<option value="${esc(m)}">${esc(m)}${hint(m)}</option>`).join("");
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
    $("#aiPrivacy").textContent = !st?.enabled ? "" : t(st.provider === "gemini" ? "ia.privacidadGemini" : "ia.privacidadOllama");
    [input, send, pick, ...panel.querySelectorAll("[data-ask]")].forEach(el => el.disabled = !ready || busy);
    $("#aiNew").disabled = busy || !msgs.length;
    if (shown !== ready) {
      shown = ready;
      log.innerHTML = "";
      if (!ai) bubble("info", t("ia.soloEscritorio"));
      else if (!st.enabled) bubble("info", t("ia.desactivado") + " " + settingsLink());
      else if (!ready) bubble("info", t("ajustesIa.errores.nokey") + " " + settingsLink());
      else if (!msgs.length) bubble("info", t("ia.bienvenida"));
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
    const wait = bubble("wait", t("ia.pensando"));
    // Un modelo saturado puede tardar casi un minuto antes de que se pruebe otro
    const slow = setTimeout(() => wait.textContent = t(st.provider === "gemini" ? "ia.tardandoGemini" : "ia.tardando"), 12000);
    // Lo que hizo cada respuesta (con ids) va junto a su texto: así el modelo sabe a qué se refiere «hazlo» o «eso»
    const toModel = m => ({ role: m.role, text: m.did ? `${m.text}\n[${m.undone ? "Deshecho por el usuario" : "Hecho"}: ${m.did}]` : m.text }); // i18n-ok: para el modelo
    const r = await ai.chat({ messages: msgs.slice(-12).map(toModel), board: Editor.boardForAI() }).catch(() => ({ error: "fail" }));
    clearTimeout(slow);
    wait.remove();
    busy = false;
    if (r.error) {
      msgs.pop();
      bubble("error", esc(errorText(r.error)) + (["off", "nokey", "nomodel", "400", "403"].includes(r.error) ? " " + settingsLink() : ""));
    } else {
      const did = [];
      const n = r.actions.length ? Editor.applyAI(r.actions, did) : 0;
      const reply = r.text || t(n ? "ia.listo" : "ia.noEntendi");
      msgs.push({ role: "assistant", text: reply, ...(n && { n, did: did.join("; ").slice(0, 1500) }) });
      const b = bubble("assistant", esc(reply));
      if (n) {
        b.insertAdjacentHTML("beforeend", `<span class="ai-did">${t("ia.enLaHoja", { changes: changes(n) })} <button data-undo="${msgs.length - 1}">${t("comun.deshacer")}</button></span>`);
        announce(t("ia.hizo", { changes: changes(n) }));
      } else announce(reply);
      // El modelo elegido no respondió (saturado, sin cupo…) y contestó uno de respaldo
      if (st.model && r.model && r.model !== st.model) b.insertAdjacentHTML("beforeend", `<span class="ai-note">${esc(t("ia.respaldo", { model: st.model, other: r.model }))}</span>`);
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
    announce(t("editor.nuevaConversacion"));
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
    toast(t("ia.modeloCambiado"));
  });
  send.addEventListener("click", () => { const text = input.value; input.value = ""; ask(text); });
  input.addEventListener("keydown", e => {
    // Enter envía; Mayús+Enter es salto de línea (los atajos del lienzo no actúan dentro de un textarea)
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); send.click(); }
  });
  panel.addEventListener("keydown", e => { if (e.key === "Escape") { e.stopPropagation(); close(); } });
  panel.addEventListener("click", e => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.ask) ask(PROMPTS[b.dataset.ask]());
    if (b.dataset.go) location.href = "03-ajustes.html#asistente";
    if (b.hasAttribute("data-undo")) {
      Editor.undo();
      b.parentElement.textContent = t("ia.deshecho");
      if (msgs[b.dataset.undo]) { msgs[b.dataset.undo].undone = true; remember(); }
    }
  });
  // Al volver de Ajustes en otra pestaña o ventana, el estado puede haber cambiado
  addEventListener("focus", () => { if (!panel.hidden) { models = null; refresh(); } });
  showTips(!msgs.length);

  window.Asistente = { open, ideas: () => open(PROMPTS.ideas()), enabled: () => !!(ai && ai.status().enabled) };
})();
