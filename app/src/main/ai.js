// Asistente con IA. Las pantallas nunca hablan con internet: piden aquí una respuesta y este módulo llama al proveedor.
//   ollama  local (http://127.0.0.1:11434): sin internet ni cuenta
//   gemini  API de Google con la clave gratuita del usuario: el texto de la hoja sale del equipo
// La configuración va en config.json (carpeta del perfil, no en la de datos, que puede estar en la nube) y la clave,
// cifrada con safeStorage (DPAPI de Windows): nunca vuelve a las pantallas, solo una pista de sus últimos caracteres.
const { net, safeStorage, clipboard } = require("electron");
const crypto = require("crypto");
const store = require("./store");

// En pruebas se apuntan a un servidor simulado
const OLLAMA = process.env.CHINCHERO_OLLAMA_URL || "http://127.0.0.1:11434";
const GEMINI = process.env.CHINCHERO_GEMINI_URL || "https://generativelanguage.googleapis.com";
// Automático: el Flash Lite responde en un par de segundos y tiene el cupo gratis más amplio; el Flash, de respaldo.
// También son el respaldo de un modelo elegido a mano: los nuevos suelen estar saturados (503) o tardar mucho.
const GEMINI_AUTO = ["gemini-flash-lite-latest", "gemini-flash-latest"];
// Formatos de clave de Google: el clásico «AIza…» (39 caracteres) y el nuevo «AQ.…» de AI Studio
const KEY_RE = /^(AIza[0-9A-Za-z_-]{35}|AQ\.[0-9A-Za-z_-]{30,200})$/;
let sessionKey = null; // si el sistema no puede cifrar, la clave vive solo mientras la app está abierta

// Gemini de fábrica: no hay que instalar nada (Ollama queda para usar sin internet)
const cfg = () => ({ enabled: false, provider: "gemini", model: "", ...store.config.get().ai });

function getKey() {
  const enc = store.config.get().aiKey;
  if (enc && safeStorage.isEncryptionAvailable()) {
    try { return safeStorage.decryptString(Buffer.from(enc, "base64")); } catch { return null; }
  }
  return sessionKey;
}

function status() {
  const c = cfg(), key = getKey();
  return { ...c, hasKey: !!key, keyHint: key ? "…" + key.slice(-4) : "" };
}

function setConfig(patch) {
  store.config.set({ ai: { ...cfg(), ...patch } });
  return status();
}

function setKey(key) {
  if (key && !KEY_RE.test(key)) return false;
  sessionKey = null;
  if (!key) store.config.set({ aiKey: null });
  else if (safeStorage.isEncryptionAvailable()) store.config.set({ aiKey: safeStorage.encryptString(key).toString("base64") });
  else sessionKey = key;
  return true;
}

// La clave copiada de aistudio.google.com: se detecta sin pasarla a la pantalla (solo la pista) y se guarda al aceptar
// (readText puede devolver una promesa según la versión de Electron)
const clipKey = async () => { const t = String(await clipboard.readText() ?? "").trim(); return KEY_RE.test(t) ? t : null; };
// Una clave que el usuario dijo que no quiere usar no se vuelve a ofrecer (se recuerda solo un resumen, no la clave)
const tag = k => crypto.createHash("sha256").update(k).digest("hex").slice(0, 16);
async function detectKey() {
  const k = await clipKey();
  return k && k !== getKey() && tag(k) !== store.config.get().aiClipIgnored ? "…" + k.slice(-4) : null;
}
const saveClipboardKey = async () => { const k = await clipKey(); return !!k && setKey(k); };
async function ignoreClipboardKey() {
  const k = await clipKey();
  if (k) store.config.set({ aiClipIgnored: tag(k) });
  return true;
}

class AIError extends Error {}
async function call(url, opts = {}, ms = 120000) {
  let res;
  try {
    res = await net.fetch(url, { ...opts, signal: AbortSignal.timeout(ms), headers: { "content-type": "application/json", ...opts.headers } });
  } catch (e) {
    throw new AIError(e.name === "TimeoutError" ? "timeout" : "offline");
  }
  if (!res.ok) throw new AIError(String(res.status));
  return res.json();
}

const providers = {
  ollama: {
    async models() {
      const r = await call(OLLAMA + "/api/tags", {}, 4000);
      return (r.models || []).map(m => m.name);
    },
    async chat(model, system, messages) {
      const r = await call(OLLAMA + "/api/chat", {
        method: "POST",
        body: JSON.stringify({ model, stream: false, format: "json", messages: [{ role: "system", content: system }, ...messages.map(m => ({ role: m.role, content: m.text }))] }),
      });
      return { text: r.message?.content || "", model };
    },
  },
  gemini: {
    async models() {
      const key = getKey();
      if (!key) throw new AIError("nokey");
      const r = await call(GEMINI + "/v1beta/models?pageSize=200", { headers: { "x-goog-api-key": key } }, 15000);
      return (r.models || [])
        .filter(m => m.supportedGenerationMethods?.includes("generateContent") && /^models\/gemini/.test(m.name) && !/(tts|image|embedding|live|audio|transcribe|banana|customtools|omni|robotics|computer)/.test(m.name))
        .map(m => m.name.slice(7));
    },
    // Se prueba el modelo elegido y después los de GEMINI_AUTO: si uno está saturado (503), tarda, no tiene cupo gratis
    // (429, los Pro) o ya no existe para claves nuevas (404), se pasa al siguiente. Se devuelve el que respondió.
    async chat(model, system, messages) {
      const key = getKey();
      if (!key) throw new AIError("nokey");
      const body = JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: messages.map(m => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.text }] })),
        generationConfig: { responseMimeType: "application/json", temperature: 0.7 },
      });
      const list = [...new Set([model, ...GEMINI_AUTO].filter(Boolean))];
      for (let i = 0; ; i++) {
        try {
          const r = await call(`${GEMINI}/v1beta/models/${encodeURIComponent(list[i])}:generateContent`, { method: "POST", headers: { "x-goog-api-key": key }, body }, list[i] === model ? 45000 : 30000);
          return { text: r.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("") || "", model: list[i] };
        } catch (e) {
          if (i === list.length - 1 || !(e instanceof AIError) || !/^(5\d\d|404|429|timeout)$/.test(e.message)) throw e;
        }
      }
    },
  },
};

// Lo que se le explica al modelo: qué es la hoja y cómo responder (siempre JSON con su respuesta y las acciones)
const SYSTEM = `Eres el asistente de Chinchero, un tablero de corcho digital con notas, fichas, listas, zonas y hilos que unen elementos.
Respondes en español neutro, breve y amable. Recibes la hoja actual en JSON (elementos con id, tipo, texto y posición; hilos entre ids; "seleccion" con los ids elegidos por el usuario).
Responde SIEMPRE con un único objeto JSON: {"respuesta": "texto para el usuario", "acciones": [...]}. Si no hace falta cambiar nada, "acciones" es [].
Acciones posibles (usa solo estas):
- {"op":"crear","ref":"n1","tipo":"nota|ficha|lista|texto|zona|sello","texto":"...","titulo":"...","tareas":["..."],"color":"...","cerca":"id o ref"}
  nota: "texto" y color amarillo|azul|rosa|verde|violeta|naranja|blanco. ficha: "titulo" y "texto". lista: "titulo" y "tareas". texto: un título grande en "texto". zona: "titulo" (agrupa elementos). sello: "texto" corto en mayúsculas.
  "cerca" coloca el elemento junto a otro; sin "cerca" va a un hueco libre. "ref" es un nombre tuyo para usarlo en otras acciones.
- {"op":"dibujar","ref":"d1","trazos":["M10 80 Q50 10 90 80", "..."],"color":"rojo|azul|negro|amarillo|verde|blanco","grosor":"fino|medio|grueso","cerca":"id o ref"}
  un dibujo a mano alzada (flecha, estrella, casa, cara, esquema...): cada trazo es el "d" de un path SVG (M, L, Q, C, A, Z) en un lienzo de unos 200x200 que empieza en 0,0. Solo líneas, sin relleno ni texto.
- {"op":"unir","a":"id o ref","b":"id o ref","etiqueta":"opcional"} tiende un hilo entre dos elementos.
- {"op":"editar","id":"...","texto":"...","titulo":"...","tareas":["..."],"color":"..."} cambia solo los campos que pongas.
- {"op":"mover","id":"...","x":0,"y":0} mueve un elemento (coordenadas del tablero).
- {"op":"agrupar","titulo":"...","ids":["..."],"color":"..."} crea una zona alrededor de esos elementos y los ordena dentro.
- {"op":"borrar","id":"..."} solo si el usuario lo pide expresamente.
No inventes ids: usa los de la hoja o tus "ref". Textos cortos, como en notas adhesivas (máximo unas 25 palabras por nota).`;

async function chat({ messages, board }) {
  const c = cfg(), p = providers[c.provider];
  if (!c.enabled || !p) return { error: "off" };
  try {
    let model = c.model;
    if (!model && c.provider === "ollama") model = (await p.models())[0];
    if (!model && c.provider === "ollama") return { error: "nomodel" };
    const last = messages.length - 1;
    // La hoja va en el último mensaje del usuario: así el modelo siempre ve su estado actual
    const msgs = messages.map((m, i) => i === last ? { ...m, text: `Hoja actual:\n${board}\n\nPedido: ${m.text}` } : m);
    const r = await p.chat(model, SYSTEM, msgs);
    return { ...parse(r.text), model: r.model };
  } catch (e) {
    return { error: e instanceof AIError ? e.message : "fail" };
  }
}

// Los modelos pequeños a veces envuelven el JSON en ```json … ``` o añaden texto: se rescata el primer objeto
function parse(raw) {
  const s = String(raw).replace(/^\s*```(?:json)?|```\s*$/g, "");
  for (const t of [s, s.slice(s.indexOf("{"), s.lastIndexOf("}") + 1)]) {
    try {
      const o = JSON.parse(t);
      if (o && typeof o === "object") return { text: String(o.respuesta ?? o.reply ?? ""), actions: Array.isArray(o.acciones ?? o.actions) ? (o.acciones ?? o.actions).slice(0, 60) : [] };
    } catch {}
  }
  return { text: s.trim().slice(0, 4000), actions: [] };
}

// Prueba final de la conexión guiada: un pedido mínimo con el proveedor y el modelo elegidos
async function test() {
  const c = cfg(), p = providers[c.provider];
  if (!p) return { error: "off" };
  try {
    const model = c.model || (c.provider === "ollama" ? (await p.models())[0] : "");
    if (!model && c.provider === "ollama") return { error: "nomodel" };
    const r = await p.chat(model, 'Responde solo con este JSON: {"respuesta":"ok","acciones":[]}', [{ role: "user", text: "Prueba de conexión" }]);
    return { ok: true, model: r.model };
  } catch (e) {
    return { error: e instanceof AIError ? e.message : "fail" };
  }
}

async function models(provider) {
  try { return { models: await providers[provider].models() }; }
  catch (e) { return { error: e instanceof AIError ? e.message : "fail" }; }
}

module.exports = { status, setConfig, setKey, detectKey, saveClipboardKey, ignoreClipboardKey, chat, models, test };
