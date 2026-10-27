// Ajustes del asistente con IA. La configuración y la clave viven en el proceso principal (ver main/ai.js):
// aquí solo se ve una pista de la clave («…abcd»), nunca la clave entera.
// Conexión guiada: Gemini con una guía paso a paso que detecta la clave copiada; Ollama lo instala la app.
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
  let st = ai.status();
  // Modelos que se ofrecen en Ollama (comparados con los mismos pedidos; ver OLLAMA_BEST en main/ai.js)
  const OLLAMA_MODELS = ["qwen3:4b", "llama3.2"];
  const HINTS = { "qwen3:4b": "mejor calidad", "llama3.2": "más rápido" };
  const hint = m => HINTS[m] || HINTS[m.replace(/:latest$/, "")];
  const installed = (list, m) => list.some(x => x === m || x === m + ":latest");
  const AI_STUDIO = "https://aistudio.google.com/apikey";

  // Errores de la prueba y de la instalación en palabras simples
  function errorText(code) {
    const local = st.provider === "ollama";
    return {
      nokey: "Falta la clave de Gemini.",
      nomodel: "Ollama no tiene ningún modelo instalado.",
      offline: local ? "No se pudo poner en marcha Ollama. Prueba a instalarlo de nuevo." : "No se pudo conectar con Google. Revisa tu conexión a internet.",
      timeout: "Tardó demasiado en responder. Prueba de nuevo en un momento.",
      400: "Google no aceptó la clave. Revisa que la copiaste entera.",
      403: "Google no aceptó la clave. Revisa que la copiaste entera.",
      404: local ? "Ese modelo no está instalado en Ollama." : "Ese modelo de Gemini no existe. Elige «Automático».",
      429: "Se agotó el cupo gratis por ahora. Prueba de nuevo en un rato.",
      busy: "Ya hay una descarga en curso.",
      cancel: "Cancelado.",
      unsigned: "La descarga no coincide con la versión oficial de Ollama, así que no se usó. Prueba de nuevo o descárgalo a mano.",
      setup: "El instalador de Ollama no terminó bien. Prueba de nuevo o descárgalo a mano.",
      start: "Ollama se instaló pero no arrancó. Ábrelo desde el menú Inicio y vuelve aquí.",
    }[code] || (/^5\d\d$/.test(code) ? "El servicio no responde en este momento. Prueba en un rato." : "Algo falló. Prueba de nuevo.");
  }

  function render() {
    on.checked = st.enabled;
    rows.forEach(r => r.hidden = !st.enabled || (r.dataset.for && r.dataset.for !== st.provider));
    document.querySelectorAll("#aiProvider button").forEach(b => { b.classList.toggle("active", b.dataset.v === st.provider); b.setAttribute("aria-pressed", b.dataset.v === st.provider); });
    $("aiProvHelp").textContent = st.provider === "gemini"
      ? "Lo más fácil: no hay que instalar nada. Gratis con tu cuenta de Google, con un límite de uso diario. Necesita internet y el texto de la hoja se envía a Google para responder."
      : "Para usar sin internet: todo queda en tu PC y nada sale del equipo. Chinchero instala Ollama y un modelo por ti (unos 4 GB de descarga; ocupan cerca de 6 GB); responde más lento en PCs sin tarjeta gráfica.";
    $("aiKeyState").textContent = st.hasKey
      ? `Clave guardada en esta PC (${st.keyHint}), cifrada. Nunca se guarda en tus tableros ni en las copias.`
      : "Haz clic en «Conectar paso a paso»: te guiamos para crear una clave gratis en Google en un par de minutos.";
    $("aiGetKey").textContent = st.hasKey ? "Obtener clave" : "Conectar paso a paso";
    $("aiDelKey").hidden = !st.hasKey;
    $("aiKeyBtns").classList.toggle("stack", st.hasKey);
  }

  // Modelos que ofrece el proveedor; "" deja que Chinchero elija (el primero de Ollama o el Flash más reciente de Gemini)
  async function loadModels() {
    const sel = $("aiModel"), prov = st.provider;
    const auto = prov === "gemini" ? "Automático (el más rápido disponible)" : "Automático (el mejor instalado)";
    sel.innerHTML = `<option value="">${esc(auto)}</option>`;
    $("aiModelHelp").textContent = "Buscando modelos…";
    if (prov === "gemini" && !st.hasKey) { $("aiModelHelp").textContent = "Guarda la clave para ver los modelos disponibles."; sel.value = st.model; return; }
    const r = await ai.models(prov);
    if (prov !== st.provider) return;
    const list = r.models || [];
    if (st.model && !list.includes(st.model)) list.unshift(st.model);
    // Los Pro no tienen cupo en el plan gratuito de Gemini
    sel.insertAdjacentHTML("beforeend", list.map(m => `<option value="${esc(m)}">${esc(m)}${/-pro\b/.test(m) ? " · sin cupo gratis" : hint(m) ? " · " + hint(m) : ""}</option>`).join(""));
    sel.value = st.model;
    if (prov === "ollama") {
      $("aiModelHelp").textContent = "Qwen 3 arma tableros más completos; Llama 3.2 responde más rápido en PCs modestas.";
      ollamaRender(r);
    } else {
      $("aiModelHelp").textContent = r.error === "403" || r.error === "400" ? "Google no aceptó la clave. Revisa que la copiaste entera."
        : r.error ? "No se pudo consultar la lista de modelos. Revisa tu conexión." : "Los modelos Flash son rápidos y entran en el plan gratuito.";
    }
  }

  /* ---------- Ollama: instalar, abrir y bajar un modelo desde aquí ---------- */
  let ollamaAction = null, busy = false, autoStarted = false;
  const pickBox = $("aiOllamaPick");
  const picked = () => pickBox.querySelector("input:checked")?.value || OLLAMA_MODELS[0];
  async function ollamaRender(r) {
    if (busy) return;
    const act = $("aiOllamaAct"), get = $("aiOllamaGet"), txt = $("aiOllama");
    const s = await ai.ollamaState();
    if (st.provider !== "ollama" || busy) return;
    const list = r.models || [], n = list.length;
    // Se ofrecen solo los modelos que faltan; si el elegido ya está, se marca el siguiente
    const missing = OLLAMA_MODELS.filter(m => !installed(list, m));
    pickBox.querySelectorAll("label").forEach(l => l.hidden = !missing.includes(l.querySelector("input").value));
    if (missing.length && !missing.includes(picked())) pickBox.querySelector(`input[value="${missing[0]}"]`).checked = true;
    get.hidden = !!s.running;
    $("aiOllamaDel").hidden = !s.installed;
    act.hidden = false;
    pickBox.hidden = true;
    if (!s.running && !s.installed) {
      txt.textContent = "Ollama no está instalado. Chinchero lo instala por ti, en segundo plano y sin abrir ventanas ni pedir cuentas o permisos: baja la versión oficial (1,6 GB) y después el modelo que elijas (2 o 2,5 GB más).";
      act.textContent = "Instalar Ollama"; ollamaAction = install;
      pickBox.hidden = false;
    } else if (!s.running) {
      // Ollama se cierra junto con Chinchero: aquí se pone en marcha solo, una vez, sin pedir nada
      if (!autoStarted) { autoStarted = true; startOllama(true); return; }
      txt.textContent = "Ollama está instalado pero detenido.";
      act.textContent = "Poner en marcha"; ollamaAction = startOllama;
    } else if (!n) {
      txt.textContent = "Ollama funciona, pero falta un modelo. Elige cuál descargar:";
      act.textContent = "Descargar modelo"; ollamaAction = pull;
      pickBox.hidden = false;
    } else {
      txt.textContent = `Ollama está funcionando con ${n} modelo${n === 1 ? "" : "s"}.`;
      // El otro modelo se ofrece a pedido, para no llenar la fila
      act.textContent = "Descargar otro modelo";
      act.hidden = !missing.length;
      ollamaAction = () => { pickBox.hidden = false; act.textContent = "Descargar"; ollamaAction = pull; pickBox.querySelector("input:checked").focus(); };
    }
  }

  const mb = b => (b / 1024 ** 2).toFixed(0) + " MB";
  const STEPS = { download: "Descargando Ollama", verify: "Comprobando que es la descarga oficial…", install: "Preparando Ollama…", start: "Poniendo en marcha Ollama…", pull: "Descargando el modelo" };
  ai.onProgress(p => {
    const bar = $("aiProgBar"), pct = p.total ? Math.round(p.done / p.total * 100) : null;
    bar.parentElement.classList.toggle("indet", pct === null);
    bar.style.width = pct === null ? "" : pct + "%";
    $("aiProgTxt").textContent = STEPS[p.step] + (pct === null ? "" : `: ${mb(p.done)} de ${mb(p.total)} (${pct} %)`);
    // El instalador ya en marcha no se puede cortar sin dejar Ollama roto
    $("aiCancel").hidden = !["download", "pull"].includes(p.step);
  });

  async function task(label, fn) {
    busy = true;
    $("aiOllamaAct").hidden = $("aiOllamaGet").hidden = $("aiOllamaDel").hidden = pickBox.hidden = true;
    $("aiProg").hidden = false;
    $("aiProgBar").parentElement.classList.add("indet");
    $("aiProgTxt").textContent = label;
    const r = await fn();
    busy = false;
    $("aiProg").hidden = $("aiCancel").hidden = true;
    if (r.error && r.error !== "cancel") { toast(errorText(r.error)); announce(errorText(r.error)); }
    return r;
  }
  async function install() {
    const r = await task("Preparando la descarga…", () => ai.ollamaInstall());
    if (r.ok) { toast("Ollama instalado"); return pull(); }
    loadModels();
  }
  async function startOllama(quiet) {
    const ok = await task("Poniendo en marcha Ollama…", () => ai.ollamaStart().then(ok => ok ? { ok } : { error: "start" }));
    if (ok.ok && quiet !== true) toast("Ollama está en marcha");
    loadModels();
  }
  async function pull() {
    const r = await task("Preparando la descarga del modelo…", () => ai.ollamaPull(picked()));
    await loadModels();
    if (r.ok) { toast("Modelo instalado"); runTest(); }
  }
  async function removeOllama() {
    if (!confirm("Se quitará Ollama de esta PC junto con todos sus modelos descargados, y se liberará ese espacio. Podrás volver a instalarlo desde aquí. ¿Continuar?")) return;
    const r = await task("Quitando Ollama…", () => ai.ollamaRemove());
    if (r.ok) {
      if (st.model) st = await ai.config({ model: "" });
      toast("Ollama se quitó de la PC"); announce("Ollama se quitó de la PC");
    }
    loadModels();
  }

  async function save(patch) {
    st = await ai.config(patch);
    render();
    toast("Guardado");
  }

  /* ---------- Prueba de la conexión ---------- */
  async function runTest(out = $("aiTestTxt")) {
    out.className = "";
    out.textContent = "Probando…";
    const r = await ai.test();
    out.className = r.ok ? "ok-txt" : "err-txt";
    out.textContent = !r.ok ? errorText(r.error)
      : st.model && r.model !== st.model ? `${st.model} no respondió (suele pasar cuando está saturado), así que contestó ${r.model}. El asistente funciona: usará ese de respaldo cuando haga falta.`
      : "✓ Listo, el asistente funciona. Ábrelo con Chinche, el pin rojo de abajo a la derecha en cualquier tablero.";
    return r;
  }

  // Clave copiada en el portapapeles (formato de clave de Google): se ofrece usarla
  async function checkClipboard() {
    if (!st.enabled || st.provider !== "gemini" || guide) return;
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

  /* ---------- Guía paso a paso de Gemini ----------
     Los dibujos imitan lo que se ve en Google AI Studio (sin cargar nada de internet). Mientras está abierta se mira
     el portapapeles cada poco: al copiar la clave se guarda sola y se prueba. */
  let guide = null;
  const shot = (url, body) => `<div class="gg-shot" aria-hidden="true"><div class="bar"><span>${url}</span></div><div class="body">${body}</div></div>`;
  function openGuide() {
    if (guide) return;
    const b = document.createElement("div");
    b.className = "g-backdrop";
    b.innerHTML = `<div class="g-modal gg-modal" role="dialog" aria-modal="true" aria-labelledby="ggTitle">
      <div class="g-head"><h3 id="ggTitle">Conectar con Gemini</h3><button class="icon-btn" data-close aria-label="Cerrar">✕</button></div>
      <p class="gg-intro">Gemini es gratis con tu cuenta de Google. Sigue estos pasos en el navegador y deja esta ventana abierta: Chinchero se da cuenta solo cuando copias la clave.</p>
      <ol class="gg-steps">
        <li class="gg-step now" data-s="1"><span class="gg-num">1</span><b>Abre Google AI Studio</b>
          <p>Se abre en tu navegador, en la página de claves.</p>
          <button class="btn btn-primary" data-open>Abrir Google AI Studio</button></li>
        <li class="gg-step" data-s="2"><span class="gg-num">2</span><b>Inicia sesión con tu cuenta de Google</b>
          <p>La misma de Gmail o YouTube. Si ya tienes la sesión iniciada, pasa al siguiente paso.</p>
          ${shot("accounts.google.com", `<b style="font-size:13px">Iniciar sesión</b><div class="line" style="width:70%"></div><div class="line"></div><span class="hl" style="justify-self:end">Siguiente</span>`)}</li>
        <li class="gg-step" data-s="3"><span class="gg-num">3</span><b>Haz clic en «Create API key» (Crear clave de API)</b>
          <p>Está arriba a la derecha. Si te pide un proyecto, elige «Create project» (Crear proyecto) y luego «Create key». Si ya tienes una clave en la lista, haz clic en ella.</p>
          ${shot("aistudio.google.com/apikey", `<div class="row2"><b style="font-size:13px">API Keys</b><span class="hl">Create API key</span></div><div class="line"></div><div class="line" style="width:60%"></div>`)}</li>
        <li class="gg-step" data-s="4"><span class="gg-num">4</span><b>Copia la clave</b>
          <p>Haz clic en «Copy» (Copiar) junto a la clave. No hace falta pegarla en ningún lado.</p>
          ${shot("aistudio.google.com/apikey", `<b>API key</b><div class="row2"><span class="key">AQ.Ab8RN6•••••••••••••</span><span class="hl">Copy</span></div>`)}</li>
        <li class="gg-step" data-s="5"><span class="gg-num">5</span><b>Listo</b>
          <div class="gg-status" role="status" id="ggStatus"><span class="update-spinner"></span><span>Esperando a que copies la clave…</span></div></li>
      </ol></div>`;
    document.body.appendChild(b);
    const step = (n, cls) => b.querySelector(`[data-s="${n}"]`).classList.add(cls);
    const now = n => b.querySelectorAll(".gg-step").forEach(s => s.classList.toggle("now", +s.dataset.s === n));
    const status = (html, spin) => { $("ggStatus").innerHTML = (spin ? `<span class="update-spinner"></span>` : "") + html; };
    let checking = false, done = false;
    async function poll() {
      if (checking || done) return;
      checking = true;
      const hint = await ai.detectKey();
      if (hint && guide && await ai.saveClipboardKey()) {
        done = true;
        [1, 2, 3, 4].forEach(n => step(n, "done")); now(5);
        st = ai.status(); render(); loadModels();
        status(`<span>Clave guardada (${esc(hint)}). Probando el asistente…</span>`, true);
        await test();
      }
      checking = false;
    }
    async function test() {
      const r = await ai.test();
      if (!guide) return;
      if (r.ok) { step(5, "done"); status(`<span class="ok-txt">✓ Listo, el asistente funciona. Ábrelo con Chinche, el pin rojo de abajo a la derecha en cualquier tablero.</span><button class="btn btn-primary" data-close>Terminar</button>`); }
      else status(`<span class="err-txt">${esc(errorText(r.error))}</span><button class="btn" data-retry>Probar de nuevo</button>`);
      announce($("ggStatus").textContent);
      b.querySelector("[data-close]:not(.icon-btn), [data-retry]")?.focus();
    }
    const timer = setInterval(poll, 1500);
    const close = () => {
      clearInterval(timer);
      b.remove(); document.removeEventListener("keydown", onEsc, true); release();
      guide = null;
      checkClipboard();
    };
    const onEsc = e => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
    b.addEventListener("click", e => {
      if (e.target === b || e.target.closest("[data-close]")) return close();
      if (e.target.closest("[data-open]")) { window.chinchero.openExternal(AI_STUDIO); step(1, "done"); now(2); }
      if (e.target.closest("[data-retry]")) { status("<span>Probando el asistente…</span>", true); test(); }
    });
    document.addEventListener("keydown", onEsc, true);
    const release = trapFocus(b.querySelector(".g-modal"), b.querySelector("[data-open]"));
    guide = { close, poll };
    $("aiFound").hidden = true;
    // Si la clave ya estaba copiada de antes, se toma enseguida
    poll();
  }

  on.addEventListener("change", async () => {
    await save({ enabled: on.checked });
    if (!on.checked) return;
    loadModels();
    // Recién activado con Gemini y sin clave: se abre la guía directamente
    if (st.provider === "gemini" && !st.hasKey) openGuide(); else checkClipboard();
  });
  $("aiProvider").addEventListener("click", async e => {
    const b = e.target.closest("button");
    if (!b || b.dataset.v === st.provider) return;
    await save({ provider: b.dataset.v, model: "" });
    $("aiTestTxt").className = ""; $("aiTestTxt").textContent = "Comprueba que el asistente responde con lo que elegiste.";
    loadModels(); checkClipboard();
  });
  $("aiModel").addEventListener("change", e => save({ model: e.target.value }));
  $("aiOllamaAct").addEventListener("click", () => ollamaAction?.());
  $("aiCancel").addEventListener("click", () => ai.cancel());
  $("aiOllamaGet").addEventListener("click", () => window.chinchero.openExternal("https://ollama.com/download"));
  $("aiGetKey").addEventListener("click", openGuide);
  $("aiTest").addEventListener("click", () => runTest());
  $("aiSkipClip").addEventListener("click", async () => { await ai.ignoreClipboardKey(); $("aiFound").hidden = true; });
  $("aiUseClip").addEventListener("click", async () => { if (await ai.saveClipboardKey()) keySaved(); else toast("La clave ya no está en el portapapeles"); });
  $("aiKeySave").addEventListener("click", async () => {
    const v = $("aiKeyInput").value.trim();
    if (!(await ai.setKey(v))) return toast("Esa no parece una clave de Gemini: empieza por «AQ.» o «AIza». Cópiala entera con el botón «Copiar clave» de Google");
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
  addEventListener("focus", () => guide ? guide.poll() : checkClipboard());

  render();
  if (st.enabled) { loadModels(); checkClipboard(); }
})();
