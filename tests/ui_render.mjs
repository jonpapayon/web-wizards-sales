// Prueba de renderizado de la interfaz sin navegador: ejecuta app/static/app.js real sobre un DOM mínimo simulado,
// contra el servidor local real (http://127.0.0.1:PORT). Uso: node tests/ui_render.mjs PORT ruta=texto [ruta=texto...]
// Sale con código 1 si alguna sección no contiene el texto esperado o muestra un error.
const PORT = process.argv[2];
const checks = process.argv.slice(3).map((a) => a.split("=")).map(([r, ...t]) => [r, t.join("=")]);
const BASE = `http://127.0.0.1:${PORT}`;

class ClassList { constructor(el) { this.el = el; } _s() { return new Set((this.el.className || "").split(/\s+/).filter(Boolean)); }
  add(c) { const s = this._s(); s.add(c); this.el.className = [...s].join(" "); } remove(c) { const s = this._s(); s.delete(c); this.el.className = [...s].join(" "); }
  toggle(c, f) { const s = this._s(); const on = f === undefined ? !s.has(c) : f; on ? s.add(c) : s.delete(c); this.el.className = [...s].join(" "); return on; }
  contains(c) { return this._s().has(c); } }
class Node_ { constructor() { this.parent = null; this.childNodes = []; } }
class Text_ extends Node_ { constructor(t) { super(); this.data = String(t); } get textContent() { return this.data; } }
class El extends Node_ {
  constructor(tag) { super(); this.tagName = tag.toUpperCase(); this.attributes = {}; this.className = ""; this.listeners = {}; this.dataset = {}; this.value = ""; this.checked = false; this._html = null; this.classList = new ClassList(this); }
  removeAttribute(k) { delete this.attributes[k]; }
  hasAttribute(k) { return k in this.attributes; }
  setAttribute(k, v) { this.attributes[k] = String(v); if (k === "id") this.id = v; if (k.startsWith("data-")) this.dataset[k.slice(5)] = v; if (k === "value") this.value = v; if (k === "checked") this.checked = true; }
  getAttribute(k) { return this.attributes[k]; }
  addEventListener(t, f) { (this.listeners[t] ||= []).push(f); }
  append(...ns) { for (const n of ns) { const x = typeof n === "string" ? new Text_(n) : n; if (x.parent) x.remove(); x.parent = this; this.childNodes.push(x); } }
  replaceChildren(...ns) { this.childNodes.forEach((c) => (c.parent = null)); this.childNodes = []; this._html = null; this.append(...ns); }
  remove() { if (this.parent) { this.parent.childNodes = this.parent.childNodes.filter((c) => c !== this); this.parent = null; } }
  get children() { return this.childNodes.filter((c) => c instanceof El); }
  set innerHTML(s) { this.childNodes = []; this._html = s; }
  get textContent() { return this._html != null ? this._html.replace(/<[^>]+>/g, " ") : this.childNodes.map((c) => c.textContent).join(""); }
  set textContent(t) { this.replaceChildren(new Text_(t)); }
  focus() {} click() { (this.listeners.click || []).forEach((f) => f({ target: this })); }
  _all() { const out = []; for (const c of this.children) { out.push(c, ...c._all()); } return out; }
  _match(sel) { if (sel.startsWith("#")) return this.id === sel.slice(1); const [tag, cls] = sel.split("."); return (!tag || this.tagName === tag.toUpperCase()) && (!cls || this.classList.contains(cls)); }
  querySelectorAll(sel) { const parts = sel.trim().split(/\s+/); let set = [this]; for (const p of parts) set = set.flatMap((e) => e._all().filter((x) => x._match(p))); return set; }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
}
const body = new El("body");
const mk = (tag, id, cls) => { const e = new El(tag); if (id) e.setAttribute("id", id); if (cls) e.className = cls; return e; };
const nav = mk("nav", "nav", "nav");
for (const r of ["dashboard", "prospectos", "pipeline", "investigacion", "mensajes", "seguimientos", "reportes", "configuracion"]) { const a = mk("a"); a.setAttribute("data-route", r); nav.append(a); }
const sidebar = mk("aside", "sidebar", "sidebar"); sidebar.append(nav, mk("span", "c-leads"), mk("span", "c-review"), mk("span", "c-drafts"));
const layout = mk("div", null, "layout"); const navP = mk("a", "nav-prospeccion"); navP.setAttribute("data-route", "prospeccion"); nav.append(navP);
body.append(layout, mk("button", "logout-btn"), mk("div", "banner"), sidebar, mk("strong", "page-title"), mk("span", "env-badge"), mk("button", "who-btn"), mk("span", "who-name"), mk("button", "menu-btn"), mk("main", "view"), mk("div", "toasts"));
const winListeners = {};
globalThis.document = { createElement: (t) => new El(t), createTextNode: (t) => new Text_(t), querySelector: (s) => body.querySelector(s), querySelectorAll: (s) => body.querySelectorAll(s), body };
globalThis.Node = Node_;
globalThis.window = { addEventListener: (t, f) => (winListeners[t] ||= []).push(f) };
globalThis.location = { hash: "#/dashboard" };
const store = {}; globalThis.localStorage = { getItem: (k) => store[k] ?? null, setItem: (k, v) => (store[k] = String(v)) };
const realFetch = globalThis.fetch;
let COOKIE = "";
globalThis.fetch = async (url, opt = {}) => {
  const headers = { ...(opt.headers || {}), ...(COOKIE ? { Cookie: COOKIE } : {}), Origin: BASE };
  const r = await realFetch(BASE + url, { ...opt, headers });
  const sc = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
  if (sc.length) COOKIE = sc[0].split(";")[0];
  return r;
};
const LOGIN = process.env.WW_UI_LOGIN;  // "usuario:contraseña" para el backend Worker
if (LOGIN) {
  const [usuario, password] = LOGIN.split(/:(.*)/s);
  const r = await globalThis.fetch("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ usuario, password }) });
  if (r.status !== 200) { console.log("FALLA login", r.status); process.exit(1); }
}

const view = body.querySelector("#view");
const settle = async () => { for (let i = 0; i < 100; i++) { await new Promise((r) => setTimeout(r, 50)); if (!view.querySelector(".skeleton") && view.childNodes.length) return; } };
await import(new URL("../app/static/app.js", import.meta.url));
await settle();
let fails = 0;
for (const [route, text] of checks) {
  location.hash = `#/${route}`; (winListeners.hashchange || []).forEach((f) => f()); await settle();
  const t = view.textContent;
  const ok = t.includes(text) && !t.includes("No se pudo cargar");
  if (!ok) fails++;
  console.log(`${ok ? "OK   " : "FALLA"} #/${route} contiene «${text}»${ok ? "" : " → " + t.slice(0, 200)}`);
}
const banner = body.querySelector("#banner").textContent, env = body.querySelector("#env-badge").textContent;
console.log(`entorno mostrado: ${env}${banner ? " · " + banner : ""}`);
process.exit(fails ? 1 : 0);
