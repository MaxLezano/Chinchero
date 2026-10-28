// Textos de la interfaz: todo pasa por i18next. Uso: node tests/i18n.js
// 1) es.json y en.json tienen las mismas claves (con sus plurales) y ningún texto vacío.
// 2) Cada clave usada en el código (t("…"), data-i18n) existe.
// 3) Ningún texto visible queda suelto: en el HTML, todo texto y atributo visible (aria-label, title, placeholder,
//    data-tip, alt) lleva data-i18n; en el JS, ninguna cadena parece una frase para el usuario.
//    Excepciones contadas: una línea con «i18n-ok» o un tramo entre «i18n-off» e «i18n-on» (p. ej. el texto para la IA).
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SETS = [
  { name: "app", locales: path.join(ROOT, "src/renderer/assets/locales"), dirs: ["src/renderer", "src/main"].map(d => path.join(ROOT, d)) },
  { name: "web", locales: path.join(ROOT, "../web/assets/locales"), dirs: [path.join(ROOT, "../web")] },
];
const log = [];
const ok = (name, cond, extra = "") => log.push(`${cond ? "PASS" : "FAIL"} ${name}${extra ? " — " + extra : ""}`);

const flat = (o, p = "", out = {}) => {
  for (const [k, v] of Object.entries(o)) v && typeof v === "object" ? flat(v, p + k + ".", out) : out[p + k] = v;
  return out;
};
const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => {
  const f = path.join(d, e.name);
  if (e.isDirectory()) return ["locales", "vendor", "fonts", "screens", "node_modules"].includes(e.name) ? [] : walk(f);
  return /\.(js|html)$/.test(e.name) ? [f] : [];
});
// Tramos ignorados: se reemplazan por espacios para conservar los números de línea
const skipRegions = s => s.replace(/i18n-off[\s\S]*?i18n-on/g, m => m.replace(/[^\n]/g, " "))
  .split("\n").map(l => l.includes("i18n-ok") ? "" : l).join("\n");
const lineOf = (s, i) => s.slice(0, i).split("\n").length;

// ¿Parece una frase para el usuario? (no un selector, CSS, clave, nombre de evento ni HTML vacío)
const LETTER = /[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/;
function looksLikeText(s) {
  s = s.replace(/\$\{[^}]*\}/g, " ").replace(/<[^>]*>/g, " ").replace(/&\w+;/g, " ").trim();
  if (!LETTER.test(s)) return false;
  if (/[áéíóúñ¿¡«»…]/i.test(s)) return true;
  const words = s.split(/\s+/).filter(w => /^[A-Za-z]{2,}[,.:;!?)]*$/.test(w));
  const code = s.split(/\s+/).filter(w => /[.#\[\]=:{}()\/_\\$@|]|^-|--|\d(px|%|em|deg|ms|s)\b/.test(w) && !/^[A-Za-z]+[.,:;!?]$/.test(w));
  // Frase: al menos dos palabras y más palabras que trozos de código, empezando en mayúscula
  return words.length >= 2 && words.length > code.length * 2 && /^[A-ZÁÉÍÓÚ¿¡]/.test(s);
}

for (const set of SETS) {
  if (!fs.existsSync(set.locales)) { ok(`${set.name}: hay textos`, false, set.locales); continue; }
  const es = flat(JSON.parse(fs.readFileSync(path.join(set.locales, "es.json"), "utf8")));
  const en = flat(JSON.parse(fs.readFileSync(path.join(set.locales, "en.json"), "utf8")));
  const onlyEs = Object.keys(es).filter(k => !(k in en)), onlyEn = Object.keys(en).filter(k => !(k in es));
  ok(`${set.name}: es.json y en.json tienen las mismas claves`, !onlyEs.length && !onlyEn.length,
    [...onlyEs.map(k => "falta en en: " + k), ...onlyEn.map(k => "falta en es: " + k)].slice(0, 20).join("; "));
  const empty = Object.entries({ ...es, ...en }).filter(([, v]) => typeof v !== "string" || !v.trim()).map(([k]) => k);
  ok(`${set.name}: ningún texto vacío`, !empty.length, empty.join(", "));
  // Mismas variables {{x}} en los dos idiomas
  const vars = s => [...String(s).matchAll(/\{\{(\w+)\}\}/g)].map(m => m[1]).sort().join(",");
  const diffVars = Object.keys(es).filter(k => k in en && vars(es[k]) !== vars(en[k]));
  ok(`${set.name}: mismas variables en los dos idiomas`, !diffVars.length, diffVars.join(", "));

  // Con plurales (_one/_other) o una lista (returnObjects: claves a.b.0, a.b.1…)
  const has = k => k in es || `${k}_one` in es || `${k}_other` in es || `${k}.0` in es;
  const missing = [], loose = [];
  for (const f of set.dirs.flatMap(walk)) {
    const rel = path.relative(ROOT, f).replace(/\\/g, "/");
    const raw = fs.readFileSync(f, "utf8");
    // Sin comentarios (se conservan los números de línea)
    const blank = m => m.replace(/[^\n]/g, " ");
    const src = f.endsWith(".html")
      ? skipRegions(raw).replace(/<!--[\s\S]*?-->/g, blank)
      : skipRegions(raw).replace(/\/\*[\s\S]*?\*\//g, blank).replace(/(^|[^:"'`\\])\/\/[^\n]*/g, (m, a) => a + blank(m.slice(a.length)));
    // Claves usadas: t("a.b"), t('a.b'), t(`a.b`) sin interpolar y data-i18n
    for (const m of src.matchAll(/\bt\(\s*(["'`])([\w.-]+)\1/g)) if (!m[2].endsWith(".") && !has(m[2])) missing.push(`${rel}:${lineOf(src, m.index)} ${m[2]}`);
    for (const m of src.matchAll(/\bt\((?:[^()"'`]|"[^"]*"|'[^']*')*?\?\s*"([\w.-]+)"\s*:\s*"([\w.-]+)"/g))
      for (const k of [m[1], m[2]]) if (k.includes(".") && !has(k)) missing.push(`${rel}:${lineOf(src, m.index)} ${k}`);
    for (const m of src.matchAll(/data-i18n="([^"$]+)"/g))
      for (const part of m[1].split(";")) { const k = part.replace(/^\[[\w-]+\]/, "").trim(); if (!has(k)) missing.push(`${rel}:${lineOf(src, m.index)} ${k}`); }

    if (f.endsWith(".html")) {
      // Texto entre etiquetas: el elemento que lo contiene (o uno de sus padres con [html]) lleva data-i18n
      // Fuera: código, estilos, dibujos y teclas (<kbd>Ctrl</kbd> es igual en todos los idiomas)
      const body = src.replace(/<(script|style|svg|kbd)\b[\s\S]*?<\/\1>/gi, blank);
      const stack = [];
      const re = /<(\/?)([a-zA-Z][\w-]*)([^>]*)>|([^<]+)/g;
      for (let m; (m = re.exec(body));) {
        const [, close, tag, attrs, text] = m;
        if (text !== undefined) {
          const s = text.trim();
          if (!(looksLikeText(s) || (LETTER.test(s) && s.length > 1 && /^[A-ZÁÉÍÓÚ¿¡]/.test(s)))) continue;
          // Lo cubre el elemento que lo contiene (texto o [html]) o un padre con [html]
          const parts = el => (/data-i18n="([^"]*)"/.exec(el.attrs)?.[1] || "").split(";").map(p => p.trim()).filter(Boolean);
          const top = stack[stack.length - 1];
          const covered = (top && parts(top).some(p => !p.startsWith("[") || p.startsWith("[html]")))
            || stack.some(el => parts(el).some(p => p.startsWith("[html]")));
          if (!covered) loose.push(`${rel}:${lineOf(body, m.index)} «${s.slice(0, 60)}»`);
          continue;
        }
        const t = tag.toLowerCase();
        if (!close) {
          for (const a of ["aria-label", "title", "placeholder", "data-tip", "alt", "value"]) {
            const v = new RegExp(`\\s${a}="([^"]*)"`).exec(attrs)?.[1];
            if (v && LETTER.test(v) && !v.includes("${") && !(a === "value" && !/\s/.test(v) && !/[áéíóúñ]/i.test(v))
              && !new RegExp(`data-i18n="[^"]*\\[${a}\\]`).test(attrs)) loose.push(`${rel}:${lineOf(body, m.index)} ${a}="${v.slice(0, 50)}"`);
          }
          if (!/\/$/.test(attrs) && !["br", "hr", "img", "input", "meta", "link", "source", "wbr", "use", "path", "circle", "rect"].includes(t)) stack.push({ tag: t, attrs });
        } else {
          const i = stack.map(s => s.tag).lastIndexOf(t);
          if (i >= 0) stack.length = i;
        }
      }
    } else {
      // Cadenas del JS que parecen frases
      const code = src;
      for (const m of code.matchAll(/"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g)) {
        const s = m[1] ?? m[2] ?? m[3];
        // HTML armado en el JS: atributos visibles y texto entre etiquetas, cada uno por su cuenta
        const parts = [...s.matchAll(/(?:title|aria-label|placeholder|data-tip|alt)="([^"]*)"|>([^<>]+)</g)].map(x => (x[1] ?? x[2]).replace(/\$\{[^}]*\}/g, " ").trim());
        const bad = parts.find(p => LETTER.test(p) && /^[A-ZÁÉÍÓÚ¿¡]/.test(p) && /\s/.test(p) && looksLikeText(p));
        if (bad) loose.push(`${rel}:${lineOf(code, m.index)} «${bad.slice(0, 70)}»`);
        else if (looksLikeText(s)) loose.push(`${rel}:${lineOf(code, m.index)} «${s.replace(/\s+/g, " ").slice(0, 70)}»`);
      }
    }
  }
  ok(`${set.name}: las claves usadas existen`, !missing.length, missing.slice(0, 30).join("\n    "));
  ok(`${set.name}: ningún texto visible suelto`, !loose.length, `${loose.length}\n    ` + loose.slice(0, +process.env.I18N_MAX || 40).join("\n    "));
}

console.log(log.join("\n"));
const fails = log.filter(l => l.startsWith("FAIL")).length;
console.log(`\n${log.length - fails}/${log.length} ok`);
process.exit(fails ? 1 : 0);
