const steps = [...document.querySelectorAll(".step")];
const dots = [...document.querySelectorAll("#dots i")];
let i = 0;
function go(n) {
  i = n;
  steps.forEach((s, k) => s.classList.toggle("active", k === i));
  dots.forEach((d, k) => d.classList.toggle("on", k === i));
  document.getElementById("back").style.visibility = i ? "visible" : "hidden";
  document.getElementById("skip").style.visibility = i === steps.length - 1 ? "hidden" : "visible";
  document.getElementById("next").textContent = t(i === 0 ? "bienvenida.empezar" : i === steps.length - 1 ? "bienvenida.crearYAbrir" : "ayuda.siguiente");
  if (i === steps.length - 1) document.getElementById("boardName").select();
}
document.getElementById("next").onclick = () => {
  if (i < steps.length - 1) return go(i + 1);
  setPref("tours", document.getElementById("wantTours").checked ? "on" : "off");
  setPref("tips", document.getElementById("wantTips").checked ? "on" : "off");
  Store.firstRunDone();
  const q = new URLSearchParams({ new: "1", template: "blank", group: "personal", name: document.getElementById("boardName").value.trim() || t("bienvenida.nombrePorDefecto") });
  if (document.getElementById("wantDemo").checked) q.set("demo", "1");
  location.href = "02-tablero.html?" + q;
};
document.getElementById("back").onclick = () => go(i - 1);
document.getElementById("skip").onclick = () => { Store.firstRunDone(); location.href = "01-tableros.html"; };
document.getElementById("haveData").onclick = () => { go(2); document.getElementById("existing").click(); };
document.getElementById("docsPath").textContent = Store.info().dataDir;

// Elegir carpeta: se abre el selector de Windows al marcar la opción
document.getElementById("optOther").addEventListener("click", async e => {
  if (!Store.native || e.target.matches("input")) return;
  const dir = await window.chinchero.chooseDataDir("new");
  if (dir) document.getElementById("otherPath").innerHTML = `<code>${dir}</code>`;
});
// Datos existentes: si se elige una carpeta válida, se entra directamente a los tableros
document.getElementById("existing").addEventListener("click", async e => {
  if (!Store.native || e.target.matches("input")) return;
  const dir = await window.chinchero.chooseDataDir("existing");
  if (dir) { Store.firstRunDone(); location.href = "01-tableros.html"; }
});
document.addEventListener("keydown", e => { if (e.key === "Enter" && !e.target.matches("button")) document.getElementById("next").click(); });

const themeBox = document.getElementById("themeChoices");
const markTheme = () => themeBox.querySelectorAll(".choice").forEach(c => { c.classList.toggle("selected", c.dataset.v === document.documentElement.dataset.theme); c.setAttribute("aria-pressed", c.classList.contains("selected")); });
themeBox.onclick = e => { const c = e.target.closest(".choice"); if (c) { setPref("theme", c.dataset.v); markTheme(); } };
markTheme();

document.querySelectorAll(".option").forEach(o => o.onclick = () => {
  document.querySelectorAll(".option").forEach(x => x.classList.toggle("selected", x === o));
});
