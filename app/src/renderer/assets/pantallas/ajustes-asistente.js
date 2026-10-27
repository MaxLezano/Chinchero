// Ajustes del asistente con IA. La configuración y la clave viven en el proceso principal (ver main/ai.js):
// aquí solo se ve una pista de la clave («…abcd»), nunca la clave entera.
(() => {
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const ai = window.chinchero?.ai;
  const on = $("aiOn"), rows = document.querySelectorAll("#asistente [data-ai]");
  if (!ai) {
    on.disabled = true;
    $("aiIntro").textContent = "Disponible en la app de escritorio.";
    rows.forEach(r => r.hidden = true);
    return;
  }
  const GEMINI_DEFAULT = "gemini-flash-latest";
  let st = ai.status();

  function render() {
    on.checked = st.enabled;
    rows.forEach(r => r.hidden = !st.enabled || (r.dataset.for && r.dataset.for !== st.provider));
    document.querySelectorAll("#aiProvider button").forEach(b => { b.classList.toggle("active", b.dataset.v === st.provider); b.setAttribute("aria-pressed", b.dataset.v === st.provider); });
    $("aiProvHelp").textContent = st.provider === "gemini"
      ? "Gratis con tu cuenta de Google, con un límite de uso diario. Necesita internet y el texto de la hoja se envía a Google para responder."
      : "Funciona en tu PC, sin internet ni cuenta: nada sale del equipo. Necesitas instalar Ollama (gratis) y un modelo.";
    $("aiKeyState").textContent = st.hasKey
      ? `Clave guardada en esta PC (${st.keyHint}), cifrada. Nunca se guarda en tus tableros ni en las copias.`
      : "Haz clic en «Obtener clave»: se abre Google AI Studio, inicias sesión, creas la clave y la copias. Chinchero la detecta al volver.";
    $("aiDelKey").hidden = !st.hasKey;
  }

  // Modelos que ofrece el proveedor; "" deja que Chinchero elija (el primero de Ollama o el Flash más reciente de Gemini)
  async function loadModels() {
    const sel = $("aiModel"), prov = st.provider;
    const auto = prov === "gemini" ? `Automático (${GEMINI_DEFAULT})` : "Automático (el primero instalado)";
    sel.innerHTML = `<option value="">${esc(auto)}</option>`;
    $("aiModelHelp").textContent = "Buscando modelos…";
    if (prov === "gemini" && !st.hasKey) { $("aiModelHelp").textContent = "Guarda la clave para ver los modelos disponibles."; sel.value = st.model; return; }
    const r = await ai.models(prov);
    if (prov !== st.provider) return;
    const list = r.models || [];
    if (st.model && !list.includes(st.model)) list.unshift(st.model);
    sel.insertAdjacentHTML("beforeend", list.map(m => `<option value="${esc(m)}">${esc(m)}</option>`).join(""));
    sel.value = st.model;
    if (prov === "ollama") {
      $("aiOllama").textContent = r.error ? "No encontramos Ollama en tu PC. Instálalo y ábrelo; luego vuelve aquí."
        : list.length ? `Ollama está funcionando con ${list.length} modelo${list.length === 1 ? "" : "s"}.`
        : "Ollama está funcionando pero no tiene modelos. Abre una terminal y escribe «ollama pull llama3.2».";
      $("aiOllamaGet").hidden = !r.error;
      $("aiModelHelp").textContent = "Los modelos pequeños responden más rápido; los grandes, mejor.";
    } else {
      $("aiModelHelp").textContent = r.error === "403" || r.error === "400" ? "Google no aceptó la clave. Revisa que la copiaste entera."
        : r.error ? "No se pudo consultar la lista de modelos. Revisa tu conexión." : "Los modelos Flash son rápidos y entran en el plan gratuito.";
    }
  }

  async function save(patch) {
    st = await ai.config(patch);
    render();
    toast("Guardado");
  }

  // Clave copiada en el portapapeles (formato de clave de Google): se ofrece usarla
  async function checkClipboard() {
    if (!st.enabled || st.provider !== "gemini") return;
    const hint = await ai.detectKey();
    $("aiFound").hidden = !hint;
    if (hint) $("aiFoundTxt").textContent = `Encontramos una clave de Gemini copiada (${hint}). ¿La usamos?`;
  }
  const keySaved = async () => {
    $("aiFound").hidden = true;
    st = ai.status();
    render(); loadModels();
    toast("Clave guardada");
  };

  on.addEventListener("change", async () => { await save({ enabled: on.checked }); if (on.checked) { loadModels(); checkClipboard(); } });
  $("aiProvider").addEventListener("click", async e => {
    const b = e.target.closest("button");
    if (!b || b.dataset.v === st.provider) return;
    await save({ provider: b.dataset.v, model: "" });
    loadModels(); checkClipboard();
  });
  $("aiModel").addEventListener("change", e => save({ model: e.target.value }));
  $("aiOllamaGet").addEventListener("click", () => window.chinchero.openExternal("https://ollama.com/download"));
  $("aiGetKey").addEventListener("click", () => window.chinchero.openExternal("https://aistudio.google.com/apikey"));
  $("aiUseClip").addEventListener("click", async () => { if (await ai.saveClipboardKey()) keySaved(); else toast("La clave ya no está en el portapapeles"); });
  $("aiKeySave").addEventListener("click", async () => {
    const v = $("aiKeyInput").value.trim();
    if (!(await ai.setKey(v))) return toast("Esa no parece una clave de Gemini: empieza por «AIza» y tiene 39 caracteres");
    $("aiKeyInput").value = "";
    keySaved();
  });
  $("aiKeyInput").addEventListener("keydown", e => { if (e.key === "Enter") $("aiKeySave").click(); });
  $("aiDelKey").addEventListener("click", async () => {
    if (!confirm("Se borrará la clave de Gemini de esta PC. ¿Continuar?")) return;
    await ai.setKey(null);
    st = ai.status(); render(); loadModels();
    toast("Clave borrada");
  });
  // Al volver del navegador con la clave copiada
  addEventListener("focus", checkClipboard);

  render();
  if (st.enabled) { loadModels(); checkClipboard(); }
})();
