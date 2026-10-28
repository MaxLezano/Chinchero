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
    $("aiIntro").textContent = t("comun.soloEscritorio") + ".";
    rows.forEach(r => r.hidden = true);
    return;
  }
  let st = ai.status();
  // Modelos que se ofrecen en Ollama (comparados con los mismos pedidos; ver OLLAMA_BEST en main/ai.js)
  const OLLAMA_MODELS = ["qwen3:4b", "llama3.2"];
  const HINTS = { "qwen3:4b": "mejorCalidad", "llama3.2": "masRapido" };
  const hint = m => { const k = HINTS[m] || HINTS[m.replace(/:latest$/, "")]; return k && t("ajustesIa.modelos." + k); };
  const installed = (list, m) => list.some(x => x === m || x === m + ":latest");
  const AI_STUDIO = "https://aistudio.google.com/apikey";

  // Errores de la prueba y de la instalación en palabras simples
  function errorText(code) {
    const local = st.provider === "ollama";
    const key = {
      nokey: "nokey", nomodel: "nomodel", offline: local ? "offlineOllama" : "offlineGemini", timeout: "timeout",
      400: "clave", 403: "clave", 404: local ? "modeloOllama" : "modeloGemini", 429: "cupo",
      busy: "busy", cancel: "cancel", unsigned: "unsigned", setup: "setup", start: "start",
    }[code] || (/^5\d\d$/.test(code) ? "servicio" : "otro");
    return t("ajustesIa.errores." + key);
  }

  function render() {
    on.checked = st.enabled;
    rows.forEach(r => r.hidden = !st.enabled || (r.dataset.for && r.dataset.for !== st.provider));
    document.querySelectorAll("#aiProvider button").forEach(b => { b.classList.toggle("active", b.dataset.v === st.provider); b.setAttribute("aria-pressed", b.dataset.v === st.provider); });
    $("aiProvHelp").textContent = t(st.provider === "gemini" ? "ajustesIa.ayudaGemini" : "ajustesIa.ayudaOllama");
    $("aiKeyState").textContent = st.hasKey ? t("ajustesIa.claveGuardadaEn", { hint: st.keyHint }) : t("ajustesIa.sinClave");
    $("aiGetKey").textContent = t(st.hasKey ? "ajustesIa.obtenerClave" : "ajustes.conectarPasoAPaso");
    $("aiDelKey").hidden = !st.hasKey;
    $("aiKeyBtns").classList.toggle("stack", st.hasKey);
  }

  // Modelos que ofrece el proveedor; "" deja que Chinchero elija (el primero de Ollama o el Flash más reciente de Gemini)
  async function loadModels() {
    const sel = $("aiModel"), prov = st.provider;
    const auto = t(prov === "gemini" ? "ajustesIa.modelos.autoGemini" : "ajustesIa.modelos.autoOllama");
    sel.innerHTML = `<option value="">${esc(auto)}</option>`;
    $("aiModelHelp").textContent = t("ajustesIa.modelos.buscando");
    if (prov === "gemini" && !st.hasKey) { $("aiModelHelp").textContent = t("ajustesIa.modelos.guardaClave"); sel.value = st.model; return; }
    const r = await ai.models(prov);
    if (prov !== st.provider) return;
    const list = r.models || [];
    if (st.model && !list.includes(st.model)) list.unshift(st.model);
    // Los Pro no tienen cupo en el plan gratuito de Gemini
    sel.insertAdjacentHTML("beforeend", list.map(m => `<option value="${esc(m)}">${esc(m)}${/-pro\b/.test(m) ? " · " + t("ajustesIa.modelos.sinCupo") : hint(m) ? " · " + hint(m) : ""}</option>`).join(""));
    sel.value = st.model;
    if (prov === "ollama") {
      $("aiModelHelp").textContent = t("ajustesIa.modelos.ayudaOllama");
      ollamaRender(r);
    } else {
      $("aiModelHelp").textContent = t(r.error === "403" || r.error === "400" ? "ajustesIa.errores.clave"
        : r.error ? "ajustesIa.modelos.sinLista" : "ajustesIa.modelos.ayudaGemini");
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
      txt.textContent = t("ajustesIa.ollama.noInstalado");
      act.textContent = t("ajustesIa.ollama.instalar"); ollamaAction = install;
      pickBox.hidden = false;
    } else if (!s.running) {
      // Ollama se cierra junto con Chinchero: aquí se pone en marcha solo, una vez, sin pedir nada
      if (!autoStarted) { autoStarted = true; startOllama(true); return; }
      txt.textContent = t("ajustesIa.ollama.detenido");
      act.textContent = t("ajustesIa.ollama.ponerEnMarcha"); ollamaAction = startOllama;
    } else if (!n) {
      txt.textContent = t("ajustesIa.ollama.faltaModelo");
      act.textContent = t("ajustesIa.ollama.descargarModelo"); ollamaAction = pull;
      pickBox.hidden = false;
    } else {
      txt.textContent = t("ajustesIa.ollama.funcionando", { count: n });
      // El otro modelo se ofrece a pedido, para no llenar la fila
      act.textContent = t("ajustesIa.ollama.descargarOtro");
      act.hidden = !missing.length;
      ollamaAction = () => { pickBox.hidden = false; act.textContent = t("ajustesIa.ollama.descargar"); ollamaAction = pull; pickBox.querySelector("input:checked").focus(); };
    }
  }

  const mb = b => (b / 1024 ** 2).toFixed(0) + " MB";
  ai.onProgress(p => {
    const bar = $("aiProgBar"), pct = p.total ? Math.round(p.done / p.total * 100) : null;
    bar.parentElement.classList.toggle("indet", pct === null);
    bar.style.width = pct === null ? "" : pct + "%";
    $("aiProgTxt").textContent = t("ajustesIa.pasos." + p.step) + (pct === null ? "" : ": " + t("ajustesIa.pasos.de", { done: mb(p.done), total: mb(p.total), pct }));
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
    const r = await task(t("ajustesIa.ollama.preparando"), () => ai.ollamaInstall());
    if (r.ok) { toast(t("ajustesIa.ollama.instalado")); return pull(); }
    loadModels();
  }
  async function startOllama(quiet) {
    const ok = await task(t("ajustesIa.pasos.start"), () => ai.ollamaStart().then(ok => ok ? { ok } : { error: "start" }));
    if (ok.ok && quiet !== true) toast(t("ajustesIa.ollama.enMarcha"));
    loadModels();
  }
  async function pull() {
    const r = await task(t("ajustesIa.ollama.preparandoModelo"), () => ai.ollamaPull(picked()));
    await loadModels();
    if (r.ok) { toast(t("ajustesIa.ollama.modeloInstalado")); runTest(); }
  }
  async function removeOllama() {
    if (!confirm(t("ajustesIa.ollama.confirmarQuitar"))) return;
    const r = await task(t("ajustesIa.ollama.quitando"), () => ai.ollamaRemove());
    if (r.ok) {
      if (st.model) st = await ai.config({ model: "" });
      toast(t("ajustesIa.ollama.quitado")); announce(t("ajustesIa.ollama.quitado"));
    }
    loadModels();
  }

  async function save(patch) {
    st = await ai.config(patch);
    render();
    toast(t("ajustes.guardado"));
  }

  /* ---------- Prueba de la conexión ---------- */
  async function runTest(out = $("aiTestTxt")) {
    out.className = "";
    out.textContent = t("ajustesIa.probando");
    const r = await ai.test();
    out.className = r.ok ? "ok-txt" : "err-txt";
    out.textContent = !r.ok ? errorText(r.error)
      : st.model && r.model !== st.model ? t("ajustesIa.respaldo", { model: st.model, other: r.model })
      : "✓ " + t("ajustesIa.listo");
    return r;
  }

  // Clave copiada en el portapapeles (formato de clave de Google): se ofrece usarla
  async function checkClipboard() {
    if (!st.enabled || st.provider !== "gemini" || guide) return;
    const hint = await ai.detectKey();
    $("aiFound").hidden = !hint;
    if (hint) $("aiFoundTxt").textContent = t("ajustesIa.claveCopiada", { hint });
  }
  const keySaved = async () => {
    $("aiFound").hidden = true;
    st = ai.status();
    render(); loadModels();
    toast(t("ajustesIa.claveGuardada"));
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
      <div class="g-head"><h3 id="ggTitle">${t("ajustesIa.guia.titulo")}</h3><button class="icon-btn" data-close aria-label="${t("comun.cerrar")}">✕</button></div>
      <p class="gg-intro">${t("ajustesIa.guia.intro")}</p>
      <ol class="gg-steps">
        <li class="gg-step now" data-s="1"><span class="gg-num">1</span><b>${t("ajustesIa.guia.p1")}</b>
          <p>${t("ajustesIa.guia.p1Ayuda")}</p>
          <button class="btn btn-primary" data-open>${t("ajustesIa.guia.abrir")}</button></li>
        <li class="gg-step" data-s="2"><span class="gg-num">2</span><b>${t("ajustesIa.guia.p2")}</b>
          <p>${t("ajustesIa.guia.p2Ayuda")}</p>
          ${shot("accounts.google.com", `<b style="font-size:13px">${t("ajustesIa.guia.iniciarSesion")}</b><div class="line" style="width:70%"></div><div class="line"></div><span class="hl" style="justify-self:end">${t("ayuda.siguiente")}</span>`)}</li>
        <li class="gg-step" data-s="3"><span class="gg-num">3</span><b>${t("ajustesIa.guia.p3")}</b>
          <p>${t("ajustesIa.guia.p3Ayuda")}</p>
          ${shot("aistudio.google.com/apikey", `<div class="row2"><b style="font-size:13px">API Keys</b><span class="hl">Create API key</span></div><div class="line"></div><div class="line" style="width:60%"></div>`)}</li>
        <li class="gg-step" data-s="4"><span class="gg-num">4</span><b>${t("ajustesIa.guia.p4")}</b>
          <p>${t("ajustesIa.guia.p4Ayuda")}</p>
          ${shot("aistudio.google.com/apikey", `<b>API key</b><div class="row2"><span class="key">AQ.Ab8RN6•••••••••••••</span><span class="hl">Copy</span></div>`)}</li>
        <li class="gg-step" data-s="5"><span class="gg-num">5</span><b>${t("ajustesIa.guia.p5")}</b>
          <div class="gg-status" role="status" id="ggStatus"><span class="update-spinner"></span><span>${t("ajustesIa.guia.esperando")}</span></div></li>
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
        status(`<span>${esc(t("ajustesIa.guia.guardadaProbando", { hint }))}</span>`, true);
        await test();
      }
      checking = false;
    }
    async function test() {
      const r = await ai.test();
      if (!guide) return;
      if (r.ok) { step(5, "done"); status(`<span class="ok-txt">✓ ${t("ajustesIa.listo")}</span><button class="btn btn-primary" data-close>${t("ayuda.terminar")}</button>`); }
      else status(`<span class="err-txt">${esc(errorText(r.error))}</span><button class="btn" data-retry>${t("ajustesIa.probarDeNuevo")}</button>`);
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
      if (e.target.closest("[data-retry]")) { status(`<span>${t("ajustesIa.probandoAsistente")}</span>`, true); test(); }
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
    $("aiTestTxt").className = ""; $("aiTestTxt").textContent = t("ajustes.compruebaQueElAsistente");
    loadModels(); checkClipboard();
  });
  $("aiModel").addEventListener("change", e => save({ model: e.target.value }));
  $("aiOllamaAct").addEventListener("click", () => ollamaAction?.());
  $("aiCancel").addEventListener("click", () => ai.cancel());
  $("aiOllamaGet").addEventListener("click", () => window.chinchero.openExternal("https://ollama.com/download"));
  $("aiGetKey").addEventListener("click", openGuide);
  $("aiTest").addEventListener("click", () => runTest());
  $("aiSkipClip").addEventListener("click", async () => { await ai.ignoreClipboardKey(); $("aiFound").hidden = true; });
  $("aiUseClip").addEventListener("click", async () => { if (await ai.saveClipboardKey()) keySaved(); else toast(t("ajustesIa.yaNoEsta")); });
  $("aiKeySave").addEventListener("click", async () => {
    const v = $("aiKeyInput").value.trim();
    if (!(await ai.setKey(v))) return toast(t("ajustesIa.noEsClave"));
    $("aiKeyInput").value = "";
    keySaved();
  });
  $("aiKeyInput").addEventListener("keydown", e => { if (e.key === "Enter") $("aiKeySave").click(); });
  $("aiDelKey").addEventListener("click", async () => {
    if (!confirm(t("ajustesIa.confirmarBorrarClave"))) return;
    await ai.setKey(null);
    st = ai.status(); render(); loadModels();
    toast(t("ajustesIa.claveBorrada"));
  });
  // Al volver del navegador con la clave copiada
  addEventListener("focus", () => guide ? guide.poll() : checkClipboard());

  render();
  if (st.enabled) { loadModels(); checkClipboard(); }
  // Otro idioma: se vuelven a escribir los textos que arma este archivo
  document.addEventListener("chinchero:lang", () => { render(); if (st.enabled) { loadModels(); checkClipboard(); } });
})();
