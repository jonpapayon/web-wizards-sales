// Web Wizards Sales OS — interfaz. Sin dependencias. Todo el texto se inserta como texto (no HTML) salvo el
// markdown, que se escapa antes de convertirse. Ninguna acción de esta interfaz envía mensajes.
const $ = (s, el = document) => el.querySelector(s);
const STATE_LABEL = {
  calificado: "Calificado", descartado: "Descartado", mensaje_borrador: "Borrador", pendiente_aprobacion: "Pendiente de aprobación",
  aprobado: "Aprobado (uso humano)", contactado: "Primer contacto", en_conversacion: "Respondió", interesado: "Interesado",
  reunion_agendada: "Demo programada", demo_realizada: "Demo realizada", propuesta_enviada: "Propuesta enviada", negociacion: "Negociación",
  ganado: "Ganado", perdido: "Perdido", pausado: "Seguimiento futuro", no_contactar: "No contactar",
};
const NICHO = { dentista: "Clínica dental", clinica: "Consultorio / clínica", estetica_spa: "Estética / spa", veterinaria: "Veterinaria",
  belleza: "Salón, barbería, uñas", fitness: "Gimnasio, yoga, pilates", inmobiliaria: "Inmobiliaria", autos: "Agencia de autos", energia_solar: "Paneles solares",
  construccion: "Construcción / remodelación", educacion: "Escuela / academia", viajes: "Agencia de viajes", industrial: "Proveedor industrial",
  retail: "Tienda / retail", distribucion: "Distribuidora / mayorista", otro: "Otro" };
const CANAL = { whatsapp: "WhatsApp", email: "Correo", facebook_messenger: "Messenger", instagram_dm: "Instagram DM", formulario: "Formulario", llamada: "Llamada", telefono: "Llamada" };
const CRITERIO = { citas: ["Citas o reservaciones", 20], whatsapp: ["WhatsApp comercial", 15], anuncios: ["Actividad publicitaria", 15], volumen: ["Volumen / reseñas", 10],
  tamano: ["Sucursales o personal", 10], problema: ["Problema operativo", 15], presencia: ["Presencia digital mejorable", 5], contacto: ["Contacto verificable", 10] };
function scoreLine(L) {
  let c = null; try { c = L.criterios ? JSON.parse(L.criterios) : null; } catch {}
  if (!c) return `${L.puntaje_total}/100 · rúbrica v1 (ICP ${L.puntaje_icp} · Oportunidad ${L.puntaje_oportunidad} · Contacto ${L.puntaje_contacto} · Capacidad ${L.puntaje_capacidad})`;
  return h("div", {}, h("div", {}, `${L.puntaje_total}/100 · rúbrica v2`), h("ul", { style: "margin:4px 0 0;padding-left:18px" },
    Object.entries(CRITERIO).map(([k, [label, mx]]) => h("li", { class: c[k] ? "" : "faint" }, `${label}: ${c[k] ?? 0}/${mx}`))));
}
const MOTIVO = { sin_respuesta: "Sin respuesta", no_interesado: "No interesado", precio: "Precio", sin_presupuesto: "Sin presupuesto",
  ya_tiene_proveedor: "Ya tiene proveedor", no_es_momento: "No es el momento", fuera_de_perfil: "Fuera de perfil", otro: "Otro" };
let NEEDS_DATE = new Set(["contactado", "en_conversacion", "interesado", "reunion_agendada", "demo_realizada", "propuesta_enviada", "negociacion", "pausado"]);
let SESSION = null, FINALS = [];
const todayStr = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" });

// ---------------------------------------------------------------- utilidades
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "style") { if (el.style) el.style.cssText = v; else el.setAttribute("style", v); }  // CSSOM: lo permite la CSP style-src 'self'; setAttribute("style") no
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}
// Ícono del sprite de index.html. Decorativo por defecto (aria-hidden); con label se anuncia.
function icon(name, label) {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg"); svg.setAttribute("class", "i");
  if (label) { svg.setAttribute("role", "img"); svg.setAttribute("aria-label", label); } else svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS(NS, "use"); use.setAttribute("href", `#i-${name}`); svg.append(use);
  return svg;
}
// Estado vacío: qué significa y, si aplica, el siguiente paso.
function emptyState(title, text, action) {
  return h("div", { class: "empty-state" }, h("div", { class: "empty-ico" }, icon("empty")), h("strong", {}, title), text ? h("p", {}, text) : null, action || null);
}
const fmtDate = (s) => (s ? s.slice(0, 10) : "—");
const fmtDT = (s) => (s ? s.replace("T", " ").slice(0, 16) : "—");
const who = () => { try { return localStorage.getItem("ww-name") || ""; } catch { return ""; } };
const setWho = (n) => { try { localStorage.setItem("ww-name", n); } catch {} $("#who-name").textContent = n || "sin nombre"; };

async function api(path, body) {
  const opt = body === undefined ? {} : {
    method: "POST", headers: { "Content-Type": "application/json", "X-WW-Token": SESSION.token },
    body: JSON.stringify({ por: who(), ...body }),
  };
  const r = await fetch(path, opt);
  let data; try { data = await r.json(); } catch { data = { ok: false, error: `Respuesta inesperada (${r.status})` }; }
  if (r.status === 401 && data.login) { renderLogin(); throw new Error("Sesión expirada: inicia sesión."); }
  if (!r.ok || data.ok === false) throw new Error(data.error || `Error ${r.status}`);
  return data;
}
const isWorker = () => SESSION?.backend === "worker";

function renderLogin(msg = "") {
  document.querySelector(".layout").setAttribute("hidden", "");
  let box = $("#login");
  if (!box) { box = h("div", { id: "login", class: "modal-back", style: "background:var(--bg)" }); document.body.append(box); }
  const user = h("input", { class: "input", id: "lg-user", autocomplete: "username", required: true });
  const pass = h("input", { class: "input", id: "lg-pass", type: "password", autocomplete: "current-password", required: true });
  const err = h("p", { class: "notice bad", hidden: !msg }, msg);
  const submit = async (e) => {
    e.preventDefault();
    try {
      const r = await fetch("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ usuario: user.value, password: pass.value }) });
      const d = await r.json();
      if (!r.ok) { err.textContent = d.error || "No se pudo iniciar sesión."; err.hidden = false; pass.value = ""; return; }
      box.remove(); document.querySelector(".layout").removeAttribute("hidden"); init();
    } catch { err.textContent = "No se pudo conectar con el servidor."; err.hidden = false; }
  };
  box.replaceChildren(h("form", { class: "modal", onsubmit: submit },
    h("div", { class: "brand", style: "padding:0 0 12px" }, h("div", { class: "logo" }, icon("mark")), h("div", {}, "Web Wizards", h("small", {}, "Sales OS"))),
    h("h2", {}, "Iniciar sesión"), h("p", {}, "Acceso privado. La información comercial solo se muestra con sesión."), err,
    h("label", { for: "lg-user" }, "Usuario"), user, h("label", { for: "lg-pass" }, "Contraseña"), pass,
    h("div", { class: "actions" }, h("button", { class: "btn primary", type: "submit" }, "Entrar"))));
  user.focus();
}
function toast(msg, kind = "") {
  const t = h("div", { class: `toast ${kind}`, role: "status" }, msg);
  $("#toasts").append(t); setTimeout(() => t.remove(), kind === "bad" ? 9000 : 4500);
}
function badgeClass(c) { return h("span", { class: `badge ${c || "neutral"}` }, c === "descartado" ? "Desc." : c || "—"); }
// Color del punto por etapa: lo que te toca (aprobar), en contacto, avanzando, cerrado, bloqueado.
const STATE_GROUP = { mensaje_borrador: "todo", pendiente_aprobacion: "todo", aprobado: "todo", contactado: "contact", en_conversacion: "contact",
  interesado: "won", reunion_agendada: "won", demo_realizada: "won", propuesta_enviada: "won", negociacion: "won", ganado: "won" };
function stateEl(s) {
  const g = s === "no_contactar" ? "blocked" : FINALS.includes(s) ? "final" : STATE_GROUP[s] || "";
  return h("span", { class: `state ${g}` }, STATE_LABEL[s] || s);
}
// Carga: silueta de título + filas (se parece a casi todas las vistas y no salta al llegar los datos).
function skeleton() {
  return h("div", { class: "sk-page", "aria-busy": "true", "aria-label": "Cargando" }, h("div", { class: "skeleton sk-title" }), h("div", { class: "skeleton sk-sub" }),
    h("div", { class: "sk-rows" }, Array.from({ length: 6 }, () => h("div", { class: "skeleton sk-row" }))));
}

// markdown mínimo y seguro (escapa primero)
function esc(s) { return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function inline(s) {
  return esc(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/(^|[\s(])(https?:\/\/[^\s<)|]+)/g, '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>');
}
function md(text) {
  const out = []; const lines = (text || "").split("\n"); let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (/^```/.test(l)) { const b = []; i++; while (i < lines.length && !/^```/.test(lines[i])) b.push(lines[i++]); i++; out.push(`<pre>${esc(b.join("\n"))}</pre>`); continue; }
    if (/^\|/.test(l)) {
      const rows = []; while (i < lines.length && /^\|/.test(lines[i])) rows.push(lines[i++]);
      const cells = (r) => r.replace(/^\||\|$/g, "").split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));
      const body = rows.filter((r) => !/^\|[\s:|-]+\|$/.test(r));
      out.push("<table>" + body.map((r, k) => "<tr>" + cells(r).map((c) => (k === 0 ? `<th>${inline(c)}</th>` : `<td>${inline(c)}</td>`)).join("") + "</tr>").join("") + "</table>");
      continue;
    }
    let m;
    if ((m = l.match(/^(#{1,4})\s+(.*)/))) { out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`); i++; continue; }
    if (/^>\s?/.test(l)) { const b = []; while (i < lines.length && /^>\s?/.test(lines[i])) b.push(lines[i++].replace(/^>\s?/, "")); out.push(`<blockquote>${b.map(inline).join("<br>")}</blockquote>`); continue; }
    if (/^\s*([-*]|\d+\.)\s+/.test(l)) { const b = []; while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) b.push(lines[i++].replace(/^\s*([-*]|\d+\.)\s+/, "")); out.push("<ul>" + b.map((x) => `<li>${inline(x.replace(/^\[ \]\s*|^\[x\]\s*/i, (c) => (c.includes("x") ? "☑ " : "☐ ")))}</li>`).join("") + "</ul>"); continue; }
    if (!l.trim()) { i++; continue; }
    const p = []; while (i < lines.length && lines[i].trim() && !/^(#|\||>|```|\s*([-*]|\d+\.)\s)/.test(lines[i])) p.push(lines[i++]);
    out.push(`<p>${p.map(inline).join("<br>")}</p>`);
  }
  const d = h("div", { class: "md" }); d.innerHTML = out.join(""); return d;
}

// ---------------------------------------------------------------- modales
function modal({ title, text, fields = [], confirm = "Confirmar", danger = false, checks = [] }) {
  return new Promise((resolve) => {
    const inputs = {};
    const opener = document.activeElement;  // al cerrar, el foco vuelve a donde estaba
    const onKey = (e) => { if (e.key === "Escape") { e.preventDefault(); close(null); } };
    const close = (v) => { document.removeEventListener("keydown", onKey); back.remove(); if (opener && opener.focus) opener.focus(); resolve(v); };
    document.addEventListener("keydown", onKey);
    const body = h("div", {},
      fields.map((f) => [h("label", { for: `f-${f.name}` }, f.label),
        inputs[f.name] = f.type === "select"
          ? h("select", { class: "input", id: `f-${f.name}` }, f.options.map((o) => h("option", { value: o.value, selected: String(o.value) === String(f.value ?? "") }, o.label)))
          : f.type === "textarea" ? (() => { const t = h("textarea", { class: "input", id: `f-${f.name}`, placeholder: f.placeholder || "" }); t.value = f.value || ""; return t; })()
          : h("input", { class: "input", id: `f-${f.name}`, type: f.type || "text", placeholder: f.placeholder || "", value: f.value || "" })]),
      checks.map((c, k) => h("label", { class: "check" }, inputs[`chk${k}`] = h("input", { type: "checkbox" }), c)));
    const ok = h("button", { class: `btn ${danger ? "danger" : "primary"}`, onclick: () => {
      const vals = {}; for (const f of fields) { vals[f.name] = inputs[f.name].value.trim(); if (f.required && !vals[f.name]) { inputs[f.name].focus(); return toast(`Falta: ${f.label}`, "bad"); } }
      for (let k = 0; k < checks.length; k++) if (!inputs[`chk${k}`].checked) return toast("Marca la casilla de confirmación.", "bad");
      close(vals);
    } }, confirm);
    const back = h("div", { class: "modal-back", onclick: (e) => e.target === back && close(null) },
      h("div", { class: "modal", role: "dialog", "aria-modal": "true", "aria-labelledby": "modal-title" }, h("h2", { id: "modal-title" }, title), text ? h("p", { style: "white-space:pre-line" }, text) : null, body,
        h("div", { class: "actions" }, h("button", { class: "btn", onclick: () => close(null) }, "Cancelar"), ok)));
    document.body.append(back);
    (Object.values(inputs)[0] || ok).focus();
  });
}
async function askName() {
  const r = await modal({ title: "¿Quién eres?", text: "Tu nombre se guarda en este navegador y se registra en la auditoría de cada aprobación o acción. Nunca uses el nombre de un agente.",
    fields: [{ name: "n", label: "Nombre y apellido", required: true, value: who() }], confirm: "Guardar" });
  if (r) setWho(r.n); return r?.n;
}

// ---------------------------------------------------------------- acciones de lead (comparten validación con crm_tool.py)
const MONEY = { placeholder: "Ej. 6000 (MXN, sin comas)" };
async function moveLead(L, to, after) {
  const fields = [];
  if (to === "perdido") fields.push({ name: "motivo_perdida", label: "Motivo de pérdida", type: "select", options: Object.entries(MOTIVO).map(([value, label]) => ({ value, label })) });
  if (to === "demo_realizada") fields.push({ name: "fecha_demo", label: "Fecha de la demostración", type: "date", required: true, value: L.fecha_demo || todayStr() });
  if (to === "propuesta_enviada" || to === "negociacion") fields.push({ name: "fecha_propuesta", label: "Fecha en que se envió la propuesta", type: "date", required: true, value: L.fecha_propuesta || todayStr() },
    { name: "monto_implementacion", label: "Implementación propuesta (MXN, opcional)", ...MONEY, value: L.monto_implementacion || "" },
    { name: "monto_mensual", label: "Mensualidad propuesta (MXN, opcional)", ...MONEY, value: L.monto_mensual || "" });
  if (NEEDS_DATE.has(to)) fields.push({ name: "proxima_accion", label: "Próxima acción concreta", placeholder: "Ej. Llamar para confirmar la demo", required: true },
    { name: "fecha", label: "Fecha de la próxima acción (día hábil; domingos y festivos se rechazan)", type: "date", required: true });
  fields.push({ name: "nota", label: "Nota (opcional)", type: "textarea" });
  const r = await modal({ title: `Mover a «${STATE_LABEL[to]}»`, text: `${L.nombre_negocio} · ${STATE_LABEL[L.estado_pipeline]} → ${STATE_LABEL[to]}. Solo se permiten transiciones válidas del esquema.`, fields, confirm: "Mover" });
  if (!r) return;
  const { fecha, nota, ...extra } = r;
  try { await api(`/api/leads/${L.lead_id}/transition`, { to, nota, proximo_seguimiento: fecha, ...extra }); toast("Estado actualizado y auditado.", "ok"); after(); }
  catch (e) { toast(e.message, "bad"); }
}
async function editNext(L, after) {
  const r = await modal({ title: "Próxima acción", text: `${L.nombre_negocio}: qué sigue y cuándo. Evita contactos olvidados.`,
    fields: [{ name: "proxima_accion", label: "Próxima acción concreta", required: true, value: L.proxima_accion || "", placeholder: "Ej. Enviar propuesta con alcance de recordatorios" },
      { name: "fecha", label: "Fecha (día hábil)", type: "date", required: true, value: L.proximo_seguimiento || "" },
      { name: "nota", label: "Nota (opcional)", type: "textarea" }], confirm: "Guardar" });
  if (!r) return;
  try { await api(`/api/leads/${L.lead_id}/next`, { proxima_accion: r.proxima_accion, proximo_seguimiento: r.fecha, nota: r.nota }); toast("Próxima acción guardada.", "ok"); after(); }
  catch (e) { toast(e.message, "bad"); }
}
async function approveLead(L, after) {
  if (!isWorker() && !who() && !(await askName())) return;
  const r = await modal({ title: "Aprobar para uso humano", text: `${L.nombre_negocio}: el borrador queda listo para que una persona lo envíe desde su propia cuenta. Este sistema NO enviará nada.`
      + (isWorker() ? ` Se registrará como aprobado por ${SESSION.nombre} (tu sesión).` : ""),
    fields: isWorker() ? [] : [{ name: "por", label: "Aprobado por (persona)", required: true, value: who() }],
    checks: ["Revisé el mensaje, sus evidencias y las observaciones de cumplimiento. Entiendo que aprobar no envía el mensaje."], confirm: "Aprobar" });
  if (!r) return;
  try { await api(`/api/leads/${L.lead_id}/approve`, { aprobado_por: r.por || SESSION.nombre }); toast("Aprobado. Nada fue enviado.", "ok"); after(); }
  catch (e) { toast(e.message, "bad"); }
}
// Suma n días hábiles (lunes a viernes). Los festivos los rechaza el servidor con su propio calendario.
function addBizDays(ymd, n) {
  const d = new Date(`${ymd}T12:00:00Z`);
  while (n > 0) { d.setUTCDate(d.getUTCDate() + 1); const w = d.getUTCDay(); if (w !== 0 && w !== 6) n--; }
  return d.toISOString().slice(0, 10);
}
const CANALES = ["whatsapp", "email", "telefono", "formulario_web", "instagram_dm", "facebook_messenger", "presencial"];
// «Marcar como enviado»: una persona ya envió el mensaje aprobado fuera del sistema. Hace los dos pasos de siempre con los
// mismos endpoints: registra la interacción (mensaje_inicial) y mueve a «Primer contacto» con el FU1 (D+3 hábiles, policies/contact-cadence.md).
async function markSent(L, after) {
  if (!isWorker() && !who() && !(await askName())) return;
  const persona = isWorker() ? SESSION.nombre : who();
  const canal0 = CANALES.includes(L.canal_preferido) ? L.canal_preferido : "whatsapp";
  const r = await modal({ title: "Marcar como enviado", text: `${L.nombre_negocio}: registra que una persona ya envió el mensaje aprobado y deja programado el primer seguimiento. Este sistema no envía nada.`,
    fields: [{ name: "canal", label: "Canal por el que se envió", type: "select", value: canal0, options: CANALES.map((v) => ({ value: v, label: CANAL[v] || v })) },
      { name: "resumen", label: "Resumen (sin datos sensibles)", type: "textarea", required: true, value: `Mensaje inicial aprobado enviado por ${persona}.` },
      { name: "proxima_accion", label: "Próxima acción", required: true, value: "Enviar seguimiento 1 (FU1) si no responde" },
      { name: "fecha", label: "Fecha del seguimiento (FU1 = 3 días hábiles; festivos se rechazan)", type: "date", required: true, value: addBizDays(todayStr(), 3) }],
    checks: ["Confirmo que una persona ya envió este mensaje desde su propia cuenta."], confirm: "Registrar envío" });
  if (!r) return;
  try { await api(`/api/leads/${L.lead_id}/interaction`, { direccion: "saliente", tipo: "mensaje_inicial", canal: r.canal, resumen: r.resumen }); }
  catch (e) { return toast(e.message, "bad"); }
  try { await api(`/api/leads/${L.lead_id}/transition`, { to: "contactado", proxima_accion: r.proxima_accion, proximo_seguimiento: r.fecha, nota: "Envío registrado desde el dashboard" });
    toast(`Envío registrado. ${L.nombre_negocio} pasa a «Primer contacto» con seguimiento el ${r.fecha}.`, "ok"); }
  catch (e) { toast(`El envío quedó registrado, pero no se pudo mover a «Primer contacto»: ${e.message}. Muévelo desde la ficha.`, "bad"); }
  after();
}
// «Abrir en WhatsApp» (policies/consent.md §2: manual, una persona, uno a uno, al número que el negocio publica, tras aprobación).
// Solo arma un enlace wa.me con el texto escrito; quien envía es la persona, en su WhatsApp. El CRM no envía nada.
function waNumber(raw) {
  const d = String(raw || "").replace(/\D/g, "");
  if (d.length === 10) return `52${d}`;                      // número nacional de 10 dígitos
  if (d.length === 12 && d.startsWith("52")) return d;         // +52 + 10 dígitos
  if (d.length === 13 && d.startsWith("521")) return `52${d.slice(3)}`;  // formato móvil antiguo
  return null;
}
function waLink(raw, text) { const n = waNumber(raw); return n ? `https://wa.me/${n}?text=${encodeURIComponent(text)}` : null; }
const sendableDraft = (L, b) => L?.estado_pipeline === "aprobado" && b && !(b.meta?.estado || "").startsWith("no_elegible") && waNumber(L.whatsapp_publico);
async function openWhatsApp(L, b) {
  const url = sendableDraft(L, b) ? waLink(L.whatsapp_publico, b.mensaje || "") : null;
  if (!url) return toast("Solo se abre WhatsApp para leads aprobados con un WhatsApp publicado y completo.", "bad");
  const verif = (b.verificacion || "").replace(/^[-*]\s*/gm, "• ").replace(/\*\*/g, "").trim();
  const ok = await modal({ title: "Abrir en WhatsApp", confirm: "Abrir WhatsApp",
    text: `Se abrirá WhatsApp con el mensaje ya escrito para ${L.nombre_negocio} (+${waNumber(L.whatsapp_publico)}). Tú lo revisas y presionas Enviar; el CRM no envía nada.`
      + (verif ? `\n\nAntes de enviar, verifica:\n${verif}` : ""),
    checks: ["Revisé la verificación previa y confirmé que este número es el WhatsApp que publica el negocio."] });
  if (!ok) return;
  const a = h("a", { href: url, target: "_blank", rel: "noopener noreferrer" }); document.body.append(a); a.click(); a.remove();
  toast("WhatsApp abierto con el mensaje escrito. Cuando lo envíes, regresa y presiona «Marcar como enviado».", "ok");
}
async function copyText(text, okMsg = "Copiado.") {
  try { await navigator.clipboard.writeText(text); toast(okMsg, "ok"); } catch { toast("No se pudo copiar automáticamente; selecciona el texto.", "bad"); }
}
async function requestChanges(L, after) {
  const r = await modal({ title: "Pedir cambios", fields: [{ name: "nota", label: "¿Qué hay que cambiar?", type: "textarea", required: true }], confirm: "Enviar a borrador" });
  if (!r) return;
  try { await api(`/api/leads/${L.lead_id}/request-changes`, { nota: r.nota }); toast("Vuelve a borrador con tu nota.", "ok"); after(); } catch (e) { toast(e.message, "bad"); }
}
async function logInteraction(L, after) {
  const r = await modal({ title: "Registrar interacción", text: "Solo registra lo que ya ocurrió fuera del sistema. No envía nada.",
    fields: [{ name: "kind", label: "Tipo", type: "select", options: [
      { value: "entrante|respuesta_lead", label: "Respuesta recibida del prospecto" },
      { value: "saliente|mensaje_inicial", label: "Una persona envió el mensaje inicial aprobado" },
      { value: "saliente|seguimiento", label: "Una persona envió un seguimiento" },
      { value: "saliente|llamada", label: "Una persona hizo una llamada" },
      { value: "interna|reunion", label: "Reunión realizada" }, { value: "interna|nota", label: "Nota interna" }] },
      { name: "canal", label: "Canal", type: "select", options: ["email", "whatsapp", "telefono", "formulario_web", "instagram_dm", "facebook_messenger", "presencial"].map((v) => ({ value: v, label: v })) },
      { name: "resumen", label: "Resumen (sin datos sensibles)", type: "textarea", required: true }],
    checks: ["Si es una respuesta: no contiene una petición de baja (si la contiene, usa «Registrar baja»)."], confirm: "Registrar" });
  if (!r) return;
  const [direccion, tipo] = r.kind.split("|");
  if (direccion === "saliente" && !isWorker() && !who() && !(await askName())) return;
  try { await api(`/api/leads/${L.lead_id}/interaction`, { direccion, tipo, canal: tipo === "nota" || tipo === "reunion" ? "interno" : r.canal, resumen: r.resumen }); toast("Interacción registrada.", "ok"); after(); }
  catch (e) { toast(e.message, "bad"); }
}
async function optOut(L, after) {
  const r = await modal({ title: "Registrar baja (no contactar)", danger: true,
    text: "Irreversible: el prospecto pasa a «No contactar», sus datos de contacto entran a la lista de exclusión y se cancelan sus seguimientos.",
    fields: [{ name: "fuente", label: "Origen de la baja", placeholder: "Ej. respuesta por email del 12-nov: «no me interesa»", required: true },
      { name: "confirm", label: "Escribe BAJA para confirmar", required: true }], confirm: "Registrar baja" });
  if (!r) return;
  if (r.confirm.toUpperCase() !== "BAJA") return toast("No se registró: escribe BAJA para confirmar.", "bad");
  try { await api(`/api/leads/${L.lead_id}/optout`, { fuente: r.fuente }); toast("Baja registrada. El prospecto no volverá a contactarse.", "ok"); after(); }
  catch (e) { toast(e.message, "bad"); }
}
// ---------------------------------------------------------------- alta manual e importación CSV (entran como candidatos «por investigar»)
const IMPORT_COLS = ["nombre_negocio", "nicho", "subnicho", "ciudad", "estado_mx", "direccion", "telefono_publico", "whatsapp_publico", "email_publico",
  "sitio_web", "google_maps_url", "instagram_url", "facebook_url", "fuente", "fuente_url", "notas"];
const FUENTES = ["manual", "google_maps", "meta_ad_library", "sitio_web", "instagram", "facebook", "google_busqueda", "doctoralia", "directorio_otro", "referido", "evento"];
function parseCsv(text) {  // RFC 4180: comas, comillas dobles y saltos de línea dentro de comillas
  const rows = []; let row = [], f = "", q = false; text = text.replace(/^﻿/, "");
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { f += '"'; i++; } else if (c === '"') q = false; else f += c; }
    else if (c === '"') q = true; else if (c === ",") { row.push(f); f = ""; } else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(f); rows.push(row); row = []; f = ""; } else f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim()));
}
function importSummary(res) {
  const lines = [`${res.creados.length} candidato(s) creados en Investigación → «Por investigar».`];
  if (res.duplicados.length) lines.push(`${res.duplicados.length} duplicado(s) omitidos: ${res.duplicados.slice(0, 5).map((d) => `fila ${d.fila} (${d.nombre} = ${d.de.join(", ")})`).join("; ")}${res.duplicados.length > 5 ? "…" : ""}`);
  if (res.excluidos) lines.push(`${res.excluidos} en lista de exclusión: no se guardaron.`);
  if (res.invalidos.length) lines.push(`${res.invalidos.length} fila(s) con errores: ${res.invalidos.slice(0, 5).map((x) => `fila ${x.fila}: ${x.errores.join(", ")}`).join(" · ")}${res.invalidos.length > 5 ? "…" : ""}`);
  const posibles = res.creados.filter((c) => c.posibles_duplicados?.length);
  if (posibles.length) lines.push(`${posibles.length} con posible duplicado por nombre y ciudad: revísalos antes de registrar.`);
  return lines;
}
async function newProspect() {
  const r = await modal({ title: "Nuevo prospecto", text: "Entra a Investigación como «por investigar» (sin calificar). Solo datos públicos del negocio, con su fuente.",
    fields: [{ name: "nombre_negocio", label: "Nombre del negocio", required: true },
      { name: "nicho", label: "Nicho", type: "select", options: Object.entries(NICHO).map(([value, label]) => ({ value, label })) },
      { name: "ciudad", label: "Ciudad", required: true }, { name: "estado_mx", label: "Estado", required: true },
      { name: "telefono_publico", label: "Teléfono publicado (opcional)" }, { name: "whatsapp_publico", label: "WhatsApp publicado (opcional)" },
      { name: "email_publico", label: "Email publicado (opcional)" }, { name: "sitio_web", label: "Sitio web (opcional)", placeholder: "https://…" },
      { name: "google_maps_url", label: "Enlace de Google Maps (opcional)", placeholder: "https://maps.google.com/…" },
      { name: "fuente", label: "Dónde lo encontraste", type: "select", options: FUENTES.map((x) => ({ value: x, label: x })) },
      { name: "fuente_url", label: "URL de la fuente (si no es ninguna de las anteriores)", placeholder: "https://…" },
      { name: "notas", label: "Notas (opcional)", type: "textarea" }], confirm: "Agregar" });
  if (!r) return;
  try { const res = (await api("/api/candidates", { rows: [r], origen: "manual", por: who() })).resultado;
    if (res.creados.length) { toast("Agregado a Investigación → Por investigar.", "ok"); location.hash = "#/investigacion"; } else toast(importSummary(res).slice(1).join(" "), "bad"); }
  catch (e) { toast(e.message, "bad"); }
}
function downloadTemplate() {
  const ej = ["Clínica Ejemplo", "dentista", "ortodoncia", "Morelia", "Michoacán", "Av. Ejemplo 123", "443 000 0000", "", "", "https://ejemplo.mx", "https://maps.google.com/?cid=0", "", "", "google_maps", "", "Fila de ejemplo: bórrala"];
  const csv = [IMPORT_COLS.join(","), ej.map((x) => (/[",\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x)).join(",")].join("\n") + "\n";
  const a = h("a", { href: URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" })), download: "plantilla-prospectos.csv" });
  document.body.append(a); a.click(); a.remove();
}
async function importCsv() {
  const input = h("input", { type: "file", accept: ".csv,text/csv" });
  input.onchange = async () => {
    const file = input.files[0]; if (!file) return;
    if (file.size > 2 * 1024 * 1024) return toast("Archivo demasiado grande (máximo 2 MB).", "bad");
    const rows = parseCsv(await file.text());
    if (rows.length < 2) return toast("El CSV no tiene filas de datos.", "bad");
    const head = rows[0].map((x) => x.trim().toLowerCase());
    const missing = ["nombre_negocio", "ciudad", "estado_mx"].filter((c) => !head.includes(c));
    if (missing.length) return toast(`Faltan columnas: ${missing.join(", ")}. Descarga la plantilla.`, "bad");
    const data = rows.slice(1).map((r) => Object.fromEntries(head.map((k, i) => [k, r[i] ?? ""]).filter(([k]) => IMPORT_COLS.includes(k))));
    if (data.length > 1000) return toast("Máximo 1000 filas por archivo.", "bad");
    const ok = await modal({ title: "Importar prospectos", text: `${data.length} fila(s) de «${file.name}». Entran a Investigación como «por investigar». Se omiten duplicados del CRM y de la cola, y negocios en la lista de exclusión.`, confirm: "Importar" });
    if (!ok) return;
    const total = { creados: [], duplicados: [], excluidos: 0, invalidos: [] };
    try {
      for (let i = 0; i < data.length; i += 100) {  // lotes de 100 (límite por petición)
        const res = (await api("/api/candidates", { rows: data.slice(i, i + 100), origen: "csv", por: who() })).resultado;
        total.creados.push(...res.creados); total.excluidos += res.excluidos;
        total.duplicados.push(...res.duplicados.map((d) => ({ ...d, fila: d.fila + i }))); total.invalidos.push(...res.invalidos.map((d) => ({ ...d, fila: d.fila + i })));
      }
    } catch (e) { toast(e.message, "bad"); }
    await modal({ title: "Resultado de la importación", text: importSummary(total).join("\n"), confirm: "Ver en Investigación" }) && (location.hash = "#/investigacion");
  };
  input.click();
}
function transitionSelect(L, transitions, after) {
  const opts = transitions.filter((t) => t !== "aprobado");
  if (!opts.length) return null;
  return h("select", { class: "input", "aria-label": "Mover a", onchange: (e) => { const v = e.target.value; e.target.value = ""; if (v) moveLead(L, v, after); } },
    h("option", { value: "" }, "Mover a…"), opts.map((t) => h("option", { value: t }, STATE_LABEL[t])));
}

// ---------------------------------------------------------------- vistas
const views = {};

function hbar(label, n, total) {
  return h("div", { class: "hbar" }, h("span", { class: "lbl", title: label }, label), h("div", { class: "track" }, h("div", { class: "fill", style: `width:${total ? (100 * n) / total : 0}%` })), h("span", { class: "n" }, n));
}

// Etiquetas legibles para códigos del esquema (el código queda como dato secundario en el title).
const SENAL = { WEB_NONE: "Sin sitio web", WEB_SOCIAL_ONLY: "Solo redes sociales", WEB_BROKEN: "Sitio con errores", WEB_NOT_MOBILE: "Sitio no apto para celular", WEB_NO_HTTPS: "Sitio sin HTTPS",
  WEB_OUTDATED: "Sitio desactualizado", WEB_SLOW: "Sitio lento", WEB_NO_CTA: "Sitio sin llamada a la acción", BOOK_NONE: "Sin agenda en línea", BOOK_PHONE_ONLY: "Citas solo por teléfono",
  WA_NO_LINK: "WhatsApp sin enlace directo", WA_NONE: "Sin WhatsApp", FORM_BROKEN: "Formulario roto", REV_CONTACT_ISSUES: "Reseñas: problemas de contacto", REV_UNANSWERED: "Reseñas sin respuesta",
  GBP_INCOMPLETE: "Perfil de Google incompleto", INFO_INCONSISTENT: "Datos inconsistentes", ADS_WEAK_LANDING: "Anuncios a perfil o sitio débil", GROWTH_SIGNAL: "Señal de crecimiento" };
const SERVICIO = { citas_whatsapp: "Citas por WhatsApp", seguimiento_comercial: "Seguimiento comercial", agente_ia: "Agente de IA", web_conversion: "Web que convierte", sistema_interno: "Sistema interno",
  reputacion: "Reputación", integraciones: "Integraciones", sitio_nuevo: "Sitio nuevo", rediseno_web: "Rediseño web", whatsapp_integracion: "Integración de WhatsApp", agenda_en_linea: "Agenda en línea",
  automatizacion: "Automatización", seo_local: "SEO local" };
const senalChip = (x) => h("span", { class: "badge accent", title: x }, SENAL[x] || x);
const CONTACT_STATES = new Set(["contactado", "en_conversacion"]), DEAL_STATES = new Set(["interesado", "reunion_agendada", "demo_realizada", "propuesta_enviada", "negociacion"]);
const daysSince = (iso) => { const t = Date.parse(iso || ""); return Number.isFinite(t) ? Math.max(0, Math.floor((Date.now() - t) / 864e5)) : null; };
let LEAD_NAV = null;  // orden de la última lista de prospectos: anterior/siguiente en la ficha y regreso con los mismos filtros
function replaceHash(hash) { window.history?.replaceState?.(null, "", hash); LAST_ROUTE = hash; }

views.prospectos = async (v, param, qp) => {
  if (param) return leadDetail(v, param);
  const { leads } = await api("/api/leads");
  const QUICK = [
    ["todos", "Todos", () => true],
    ["aprobar", "Por aprobar", (L) => L.estado_pipeline === "pendiente_aprobacion"],
    ["enviar", "Por enviar", (L) => L.estado_pipeline === "aprobado"],
    ["preparar", "Calificados sin mensaje", (L) => ["calificado", "mensaje_borrador"].includes(L.estado_pipeline) && ["A", "B"].includes(L.clasificacion)],
    ["contacto", "En contacto", (L) => CONTACT_STATES.has(L.estado_pipeline)],
    ["oportunidad", "Oportunidades", (L) => DEAL_STATES.has(L.estado_pipeline)],
    ["sin_accion", "Sin próxima acción", (L) => NEEDS_DATE.has(L.estado_pipeline) && !L.proximo_seguimiento],
    ["cerrados", "Cerrados", (L) => FINALS.includes(L.estado_pipeline)],
  ];
  const g = (k, d = "") => qp?.get?.(k) || d;
  const f = { vista: g("vista", "todos"), q: g("q"), nicho: g("nicho"), clase: g("clase"), estado: g("estado"), ciudad: g("ciudad") };
  const [sk, sd] = g("orden", "puntaje_total:-1").split(":"); let sort = { k: sk, dir: +sd || -1 };
  const uniq = (k) => [...new Set(leads.map((L) => L[k]).filter(Boolean))].sort();
  const sync = () => { const p = new URLSearchParams(Object.entries({ ...f, orden: `${sort.k}:${sort.dir}` }).filter(([k, x]) => x && !(k === "vista" && x === "todos") && !(k === "orden" && x === "puntaje_total:-1")));
    const qs = p.toString(); replaceHash(`#/prospectos${qs ? `?${qs}` : ""}`); };
  const sel = (key, label, values, map = (x) => x) => h("select", { class: "input", "aria-label": label, onchange: (e) => { f[key] = e.target.value; draw(); } },
    h("option", { value: "" }, label), values.map((x) => h("option", { value: x, selected: f[key] === x }, map(x))));
  const body = h("tbody"); const chips = h("div", { class: "chips", role: "tablist", "aria-label": "Vistas rápidas" }); const countEl = h("span", { class: "faint result-count" });
  const cols = [["nombre_negocio", "Negocio"], ["clasificacion", "Clase"], ["puntaje_total", "Puntos", "num"], ["estado_pipeline", "Estado"],
    ["ciudad", "Ciudad"], ["whatsapp_publico", "Contacto", "hide-sm"], ["sitio_web", "Sitio web", "hide-lg"],
    ["proxima_accion", "Próxima acción", "hide-md"], ["lead_id", "ID", "hide-lg"]];
  const inds = {};
  const ths = cols.map(([k, l, c]) => h("th", { class: `sortable ${c || ""}`, scope: "col", tabindex: "0",
    onclick: () => { sort = { k, dir: sort.k === k ? -sort.dir : (k === "puntaje_total" ? -1 : 1) }; draw(); }, onkeydown: (e) => e.key === "Enter" && e.target.click() }, l, inds[k] = h("span", { class: "sort-ind", "aria-hidden": "true" })));
  const thead = h("thead", {}, h("tr", {}, ths));
  const search = h("input", { class: "input search", type: "search", value: f.q, placeholder: "Buscar por nombre, ciudad, teléfono, WhatsApp, correo o ID…", "aria-label": "Buscar en prospectos",
    oninput: (e) => { f.q = e.target.value; draw(); } });
  function draw() {
    const q = norm(f.q.trim()), qd = f.q.replace(/\D/g, "");
    const base = leads.filter((L) => (!q || norm([L.lead_id, L.nombre_negocio, L.ciudad, L.telefono_publico, L.whatsapp_publico, L.email_publico, L.sitio_web].join(" ")).includes(q)
        || (qd.length >= 4 && [L.telefono_publico, L.whatsapp_publico].join(" ").replace(/\D/g, "").includes(qd)))
      && (!f.nicho || L.nicho === f.nicho) && (!f.clase || L.clasificacion === f.clase) && (!f.estado || L.estado_pipeline === f.estado) && (!f.ciudad || L.ciudad === f.ciudad));
    const test = (QUICK.find((x) => x[0] === f.vista) || QUICK[0])[2];
    const list = base.filter(test).sort((a, b) => { const x = a[sort.k], y = b[sort.k]; const n = sort.k === "puntaje_total"; return (n ? (+x - +y) : String(x || "").localeCompare(String(y || ""))) * sort.dir; });
    chips.replaceChildren(...QUICK.map(([k, label, fn]) => { const n = base.filter(fn).length; if (!n && k !== "todos" && k !== f.vista) return null;
      return h("button", { role: "tab", "aria-selected": String(f.vista === k), class: `chip ${f.vista === k ? "on" : ""}`, onclick: () => { f.vista = k; draw(); } }, label, h("span", { class: "chip-n" }, n)); }).filter(Boolean));
    cols.forEach(([k], i) => { const on = sort.k === k; ths[i].setAttribute("aria-sort", on ? (sort.dir > 0 ? "ascending" : "descending") : "none");
      inds[k].textContent = on ? (sort.dir > 0 ? " ↑" : " ↓") : ""; });
    countEl.textContent = list.length === leads.length ? `${leads.length} prospectos` : `${list.length} de ${leads.length}`;
    body.replaceChildren(...(list.length ? list.map((L) => h("tr", { onclick: () => (location.hash = `#/prospectos/${L.lead_id}`), tabindex: "0", onkeydown: (e) => e.key === "Enter" && (location.hash = `#/prospectos/${L.lead_id}`) },
      h("td", { class: "biz" }, h("strong", {}, L.nombre_negocio), h("small", {}, NICHO[L.nicho] || L.nicho)),
      h("td", {}, badgeClass(L.clasificacion)), h("td", { class: "num" }, L.puntaje_total), h("td", { class: "nowrap" }, stateEl(L.estado_pipeline)),
      h("td", { class: "nowrap" }, L.ciudad),
      h("td", { class: "hide-sm contact" }, L.whatsapp_publico ? h("span", {}, h("b", {}, "WA "), L.whatsapp_publico) : null,
        L.telefono_publico && L.telefono_publico !== L.whatsapp_publico ? h("span", {}, h("b", {}, "Tel "), L.telefono_publico) : null,
        !L.whatsapp_publico && !L.telefono_publico ? h("span", { class: "faint" }, L.email_publico || "—") : null),
      h("td", { class: "hide-lg site" }, L.sitio_web ? h("a", { href: L.sitio_web, target: "_blank", rel: "noopener noreferrer", onclick: (e) => e.stopPropagation() }, L.sitio_web.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")) : h("span", { class: "faint" }, "sin sitio")),
      h("td", { class: "hide-md muted next" }, L.proxima_accion || h("span", { class: "faint" }, "—")), h("td", { class: "hide-lg mono nowrap faint" }, L.lead_id)))
      : [h("tr", {}, h("td", { colspan: cols.length }, emptyState("Ningún prospecto coincide", "Prueba con otra búsqueda, otra vista o quita algún filtro.",
          h("button", { class: "btn", onclick: () => { Object.assign(f, { vista: "todos", q: "", nicho: "", clase: "", estado: "", ciudad: "" }); replaceHash("#/prospectos"); route(); } }, "Quitar filtros"))))]));
    sync(); LEAD_NAV = { ids: list.map((L) => L.lead_id), back: LAST_ROUTE };
  }
  v.append(h("div", { class: "page-head" }, h("div", {}, h("h1", {}, "Prospectos"), h("p", {}, `${leads.length} registrados en el CRM.`)),
      h("div", { class: "row" },
        h("button", { class: "btn primary", onclick: () => newProspect() }, "Nuevo prospecto"),
        h("button", { class: "btn", onclick: () => importCsv() }, "Importar CSV"),
        h("details", { class: "menu" }, h("summary", { class: "btn" }, "Más"),
          h("div", { class: "menu-list" }, h("button", { class: "menu-item", onclick: () => downloadTemplate() }, "Descargar plantilla CSV"),
            h("a", { class: "menu-item", href: "/api/export/leads.csv", download: "leads.csv" }, "Exportar prospectos (CSV)"))))),
    chips,
    h("div", { class: "toolbar" }, search,
      sel("nicho", "Nicho", uniq("nicho"), (x) => NICHO[x] || x), sel("clase", "Clase", ["A", "B", "C", "descartado"]),
      sel("estado", "Estado", uniq("estado_pipeline"), (x) => STATE_LABEL[x] || x), sel("ciudad", "Ciudad", uniq("ciudad")), countEl),
    h("div", { class: "card flat" }, h("div", { class: "table-wrap" }, h("table", {}, thead, body))));
  draw();
};

// Acción principal según el estado: lo más probable que toque hacer con este prospecto.
function primaryAction(L, reload) {
  const s = L.estado_pipeline;
  if (s === "pendiente_aprobacion") return h("a", { class: "btn primary", href: `#/mensajes/${L.lead_id}` }, "Revisar y aprobar mensaje");
  if (s === "aprobado") return h("button", { class: "btn primary", onclick: () => markSent(L, reload) }, icon("check"), "Marcar como enviado");
  if (CONTACT_STATES.has(s) || DEAL_STATES.has(s)) return h("button", { class: "btn primary", onclick: () => logInteraction(L, reload) }, "Registrar interacción");
  if (!FINALS.includes(s)) return h("button", { class: "btn primary", onclick: () => editNext(L, reload) }, "Definir próxima acción");
  return null;
}
async function leadDetail(v, id) {
  const d = await api(`/api/leads/${id}`); const L = d.lead;
  const reload = () => route();
  const tabs = ["Resumen", "Investigación", "Mensajes", "Historial"]; let tab = "Resumen";
  const pane = h("div");
  const tabBar = h("div", { class: "tabs", role: "tablist" }, tabs.map((t) => h("button", { role: "tab", "aria-selected": String(t === tab), class: t === tab ? "active" : "",
    onclick: (e) => { tab = t; [...tabBar.children].forEach((b) => { const on = b === e.currentTarget; b.classList.toggle("active", on); b.setAttribute("aria-selected", String(on)); }); drawTab(); } },
    t, t === "Mensajes" && d.borradores.length ? h("span", { class: "chip-n" }, d.borradores.length) : null)));
  const kv = (pairs) => h("dl", { class: "kv" }, pairs.filter(([, val]) => val !== undefined).map(([k, val]) => [h("dt", {}, k), h("dd", {}, val || h("span", { class: "faint" }, "no encontrado"))]));
  const nextBox = () => {
    if (FINALS.includes(L.estado_pipeline)) return null;
    const venc = L.proximo_seguimiento && L.proximo_seguimiento < todayStr();
    return h("div", { class: `next-box ${!L.proxima_accion && NEEDS_DATE.has(L.estado_pipeline) ? "missing" : venc ? "late" : ""}` },
      h("div", {}, h("div", { class: "next-label" }, "Próxima acción"),
        h("div", { class: "next-text" }, L.proxima_accion || d.proxima_accion || "Sin definir", L.proximo_seguimiento ? h("span", { class: venc ? "bad-text" : "muted" }, ` · ${L.proximo_seguimiento}${venc ? " (vencida)" : ""}`) : null)),
      h("button", { class: "btn sm", onclick: () => editNext(L, reload) }, L.proxima_accion ? "Cambiar" : "Definir"));
  };
  function drawTab() {
    pane.replaceChildren();
    if (tab === "Resumen") pane.append(
      h("div", { class: "card summary-top" }, h("div", { class: "summary-contact" }, h("h3", {}, "Contacto"), contactChips(L) || h("span", { class: "faint" }, "Sin teléfono, WhatsApp ni correo publicado."),
        L.sitio_web ? h("a", { class: "site-link", href: L.sitio_web, target: "_blank", rel: "noopener noreferrer" }, L.sitio_web.replace(/^https?:\/\/(www\.)?/, "")) : null), nextBox()),
      h("div", { class: "grid cols-2", style: "margin-top:16px" },
        h("div", { class: "card" }, h("h3", {}, "Datos verificados"), kv([["Negocio", L.nombre_negocio], ["Nicho", NICHO[L.nicho] || L.nicho], ["Ciudad", `${L.ciudad}, ${L.estado_mx}`], ["Dirección", L.direccion],
          ["Sitio web", L.sitio_web ? h("a", { href: L.sitio_web, target: "_blank", rel: "noopener noreferrer" }, L.sitio_web) : ""], ["Teléfono", L.telefono_publico], ["WhatsApp", L.whatsapp_publico], ["Email", L.email_publico],
          ["Fuente", h("span", {}, `${L.fuente} · `, h("a", { href: L.fuente_url, target: "_blank", rel: "noopener noreferrer" }, "ver"), ` · ${L.fecha_fuente}`)], ["Notas", L.notas || h("span", { class: "faint" }, "Sin notas")]])),
        h("div", { class: "card" }, h("h3", {}, "Calificación"), kv([["Puntaje", scoreLine(L)],
          ["Clase", badgeClass(L.clasificacion)], ["Motivo", L.motivo_clasificacion], ["Señales", h("div", { class: "chip-wrap" }, (L.senales_oportunidad || "").split(";").filter(Boolean).map(senalChip))],
          ["Servicio propuesto", (L.servicio_recomendado || "").split(";").filter(Boolean).map((x) => SERVICIO[x] || x).join(", ")], ["Canal preferido", CANAL[L.canal_preferido] || L.canal_preferido],
          ["Aprobación", L.aprobacion_estado + (L.aprobado_por ? ` · ${L.aprobado_por}` : "")]]))),
      h("div", { class: "card", style: "margin-top:16px" }, h("h3", {}, "Seguimiento comercial"), kv([
        ["Demostración", L.fecha_demo || h("span", { class: "faint" }, "Sin registrar")],
        ["Propuesta", L.fecha_propuesta ? [L.fecha_propuesta, L.monto_implementacion ? ` · implementación $${L.monto_implementacion}` : "", L.monto_mensual ? ` · mensual $${L.monto_mensual}` : ""].join("") : h("span", { class: "faint" }, "Sin registrar")],
        ["Motivo de pérdida", L.motivo_perdida ? MOTIVO[L.motivo_perdida] || L.motivo_perdida : undefined]])));
    if (tab === "Investigación") pane.append(evidenceCard(d.evidencia, L), h("div", { class: "card", style: "margin-top:16px" }, h("h3", {}, "Dossier"), d.dossier ? md(d.dossier) : emptyState("Sin dossier", "Este prospecto no tiene dossier de investigación.")));
    if (tab === "Mensajes") pane.append(d.borradores.length ? h("div", { class: "stack" }, d.borradores.map((b) => draftCard(b, L, reload, true))) : h("div", { class: "card" }, emptyState("Sin borradores", "Claude prepara mensajes solo para leads A y B.")));
    if (tab === "Historial") pane.append(h("div", { class: "grid cols-2" },
      h("div", { class: "card" }, h("h3", {}, "Interacciones"), d.interacciones.length ? h("ul", { class: "timeline" }, d.interacciones.slice().reverse().map((i) => h("li", {}, h("div", {}, `${i.tipo} · ${i.resumen}`), h("div", { class: "when" }, `${fmtDT(i.fecha_hora)} · ${CANAL[i.canal] || i.canal} · ${i.registrado_por}`)))) : emptyState("Sin interacciones", "Aquí aparecen envíos, respuestas, llamadas y notas.")),
      h("div", { class: "card" }, h("h3", {}, "Auditoría"), d.auditoria.length ? h("ul", { class: "timeline" }, d.auditoria.slice().reverse().map((e) => h("li", {}, h("div", {}, e.evento), h("div", { class: "when" }, `${fmtDT(e.ts)} · ${e.actor}`)))) : emptyState("Sin eventos", "Cada cambio queda registrado aquí."))));
  }
  const nav = LEAD_NAV && LEAD_NAV.ids.includes(id) ? LEAD_NAV : null;
  const idx = nav ? nav.ids.indexOf(id) : -1;
  const goRel = (step) => { const n = nav?.ids[idx + step]; if (n) location.hash = `#/prospectos/${n}`; };
  const actions = d.bloqueado ? h("div", { class: "notice bad" }, "Dado de baja / no contactar. El sistema impide cualquier cambio o reactivación.")
    : h("div", { class: "row lead-actions" }, primaryAction(L, reload),
      (() => { const wb = d.borradores.find((b) => !(b.meta?.estado || "").startsWith("no_elegible")); return sendableDraft(L, wb) ? h("button", { class: "btn", onclick: () => openWhatsApp(L, wb) }, "Abrir en WhatsApp") : null; })(),
      transitionSelect(L, d.transiciones, reload),
      h("details", { class: "menu" }, h("summary", { class: "btn" }, "Más acciones"),
        h("div", { class: "menu-list" },
          L.estado_pipeline === "pendiente_aprobacion" ? [h("button", { class: "menu-item", onclick: () => approveLead(L, reload) }, "Aprobar para uso humano"), h("button", { class: "menu-item", onclick: () => requestChanges(L, reload) }, "Pedir cambios")] : null,
          FINALS.includes(L.estado_pipeline) ? null : h("button", { class: "menu-item", onclick: () => editNext(L, reload) }, "Próxima acción"),
          h("button", { class: "menu-item", onclick: () => logInteraction(L, reload) }, "Registrar interacción"),
          h("div", { class: "menu-sep" }),
          h("button", { class: "menu-item danger", onclick: () => optOut(L, reload) }, "Registrar baja"))));
  v.append(h("div", { class: "detail-top" }, h("a", { href: nav?.back || "#/prospectos", class: "back-link" }, "← Prospectos"),
      nav ? h("div", { class: "rv-nav" }, h("span", { class: "faint" }, `${idx + 1} de ${nav.ids.length}`),
        h("button", { class: "btn ghost icon-btn", "aria-label": "Prospecto anterior (K)", title: "Anterior (K)", disabled: idx <= 0, onclick: () => goRel(-1) }, "‹"),
        h("button", { class: "btn ghost icon-btn", "aria-label": "Prospecto siguiente (J)", title: "Siguiente (J)", disabled: idx >= nav.ids.length - 1, onclick: () => goRel(1) }, "›")) : null),
    h("div", { class: "page-head lead-head" }, h("div", {}, h("h1", {}, L.nombre_negocio),
      h("p", { class: "row lead-meta" }, badgeClass(L.clasificacion), h("span", { class: "muted" }, `${L.puntaje_total} pts`), stateEl(L.estado_pipeline),
        h("span", { class: "muted" }, [L.ciudad, NICHO[L.nicho] || L.nicho].filter(Boolean).join(" · ")), h("span", { class: "mono faint" }, L.lead_id))), actions), tabBar, pane);
  VIEW_KEYDOWN = (e) => { if (e.key === "j" || e.key === "J") goRel(1); else if (e.key === "k" || e.key === "K") goRel(-1); };
  drawTab();
}

function confBadge(c) { const m = { alta: "ok", media: "warn", baja: "bad" }; return h("span", { class: `badge ${m[c || "media"]}` }, `confianza ${c || "media"}`); }
function evidenceCard(ev, L) {
  if (!ev) return h("div", { class: "card empty" }, "Sin evidencia estructurada.");
  return h("div", { class: "card" }, h("h3", {}, "Evidencia de problemas detectados"),
    h("div", { class: "table-wrap" }, h("table", {}, h("thead", {}, h("tr", {}, ["Señal", "Observación", "Fuente", "Verificado", "Método", "Confianza"].map((x) => h("th", {}, x)))),
      h("tbody", {}, ev.evidencias.map((e) => h("tr", {}, h("td", {}, h("span", { class: "badge accent" }, e.senal)), h("td", {}, e.observacion),
        h("td", {}, h("a", { href: e.url, target: "_blank", rel: "noopener noreferrer" }, e.url.replace(/^https?:\/\//, "").slice(0, 40))), h("td", {}, e.fecha_verificacion), h("td", { class: "muted" }, e.metodo), h("td", {}, confBadge(e.confianza))))))),
    h("div", { class: "grid cols-2", style: "margin-top:14px" },
      h("div", {}, h("h3", {}, "Fuentes consultadas"), h("ul", {}, [ev.fuente_url, ...(ev.otras_fuentes || [])].filter(Boolean).map((u) => h("li", {}, h("a", { href: u, target: "_blank", rel: "noopener noreferrer" }, u))))),
      h("div", {}, h("h3", {}, "Datos no encontrados"), (ev.campos_no_encontrados || []).length ? h("ul", {}, ev.campos_no_encontrados.map((c) => h("li", {}, c))) : h("p", { class: "muted" }, "Ninguno."),
        h("p", { class: "faint", style: "font-size:12px" }, "«No encontrado»: se revisaron las fuentes y el dato no está publicado. «No disponible»: la fuente no pudo consultarse; ver notas del prospecto."))));
}

// Pipeline: cinco fases del flujo activo; cada tarjeta muestra su estado exacto. Lo que está fuera del flujo, plegado abajo.
const PHASES = [["Preparación", ["calificado", "mensaje_borrador"]], ["Aprobación", ["pendiente_aprobacion", "aprobado"]], ["Contacto", ["contactado", "en_conversacion"]],
  ["Oportunidad", ["interesado", "reunion_agendada", "demo_realizada"]], ["Cierre", ["propuesta_enviada", "negociacion"]]];
const money = (n) => `$${Math.round(n).toLocaleString("es-MX")}`;
views.pipeline = async (v) => {
  const p = await api("/api/pipeline"); FINALS = p.finales;
  const reload = () => route();
  const inFlow = new Set(PHASES.flatMap(([, s]) => s));
  const card = (L) => {
    const venc = L.proximo_seguimiento && L.proximo_seguimiento < todayStr(); const dias = daysSince(L.fecha_actualizacion);
    return h("article", { class: `kcard ${venc ? "late" : ""}` },
      h("a", { class: "t", href: `#/prospectos/${L.lead_id}` }, L.nombre_negocio),
      h("div", { class: "meta" }, badgeClass(L.clasificacion), h("span", {}, `${L.puntaje_total} pts`), L.ciudad ? h("span", {}, L.ciudad) : null),
      h("div", { class: "k-state" }, stateEl(L.estado_pipeline), dias != null ? h("span", { class: `k-age ${dias >= 7 ? "old" : ""}`, title: "Días desde el último cambio registrado" }, dias === 0 ? "hoy" : `${dias} d`) : null),
      L.proxima_accion ? h("div", { class: "k-next" }, venc ? h("span", { class: "badge bad" }, "vencida") : null, " ", L.proxima_accion, L.proximo_seguimiento && !L.proxima_accion.includes(L.proximo_seguimiento) ? h("span", { class: "faint" }, ` · ${L.proximo_seguimiento}`) : null) : null,
      L.opt_out === "true" ? null : transitionSelect(L, p.transiciones[L.estado_pipeline] || [], reload));
  };
  const active = p.leads.filter((L) => inFlow.has(L.estado_pipeline));
  const out = p.leads.filter((L) => !inFlow.has(L.estado_pipeline));
  const propuesto = p.leads.filter((L) => DEAL_STATES.has(L.estado_pipeline) || L.estado_pipeline === "ganado").reduce((n, L) => n + (+L.monto_implementacion || 0), 0);
  const ganados = p.leads.filter((L) => L.estado_pipeline === "ganado").length;
  const stat = (label, val) => h("div", { class: "pstat" }, h("strong", {}, val), h("span", {}, label));
  v.append(h("div", { class: "page-head" }, h("div", {}, h("h1", {}, "Pipeline"), h("p", {}, "Flujo activo por fase. Cada tarjeta ofrece solo los movimientos válidos del esquema; las bajas se registran desde la ficha.")),
      h("a", { class: "btn", href: "#/prospectos" }, "Ver como lista")),
    h("div", { class: "pstats" }, stat("en flujo activo", active.length), stat("en oportunidad o cierre", p.leads.filter((L) => DEAL_STATES.has(L.estado_pipeline)).length),
      stat("ganados", ganados), stat("implementación propuesta", propuesto ? money(propuesto) : "—")),
    h("div", { class: "kanban phases" }, PHASES.map(([name, states]) => { const items = active.filter((L) => states.includes(L.estado_pipeline));
      const monto = items.reduce((n, L) => n + (+L.monto_implementacion || 0), 0);
      return h("section", { class: "col", "aria-label": name },
        h("div", { class: "col-head" }, h("span", {}, name), h("span", { class: "n" }, items.length)),
        h("div", { class: "col-sub" }, states.map((s) => STATE_LABEL[s]).join(" · "), monto ? h("span", {}, ` · ${money(monto)}`) : null),
        h("div", { class: "col-body" }, items.length ? items.map(card) : h("div", { class: "col-empty" }, "Sin prospectos"))); })),
    out.length ? h("details", { class: "card out-flow" }, h("summary", {}, `Fuera del flujo activo (${out.length})`, h("span", { class: "faint" }, " · en pausa, ganados, perdidos, descartados y bajas")),
      h("div", { class: "out-grid" }, p.estados.filter((s) => !inFlow.has(s)).map((s) => { const items = out.filter((L) => L.estado_pipeline === s); if (!items.length) return null;
        return h("div", {}, h("h3", {}, `${STATE_LABEL[s]} (${items.length})`), h("div", { class: "col-body" }, items.map(card))); }).filter(Boolean))) : null);
};

views.investigacion = async (v) => {
  const r = await api("/api/research"); const reload = () => route();
  const review = r.revision;
  v.append(h("div", { class: "page-head" }, h("div", {}, h("h1", {}, "Investigación"), h("p", {}, "Candidatos en revisión antes de registrarse, y evidencia de cada prospecto."))),
    h("div", { class: "card" }, h("h2", {}, `Área de revisión (${review.length})`),
      review.length ? h("div", { class: "stack" }, review.map((c) => h("div", { class: "card", style: "background:var(--surface-2)" },
        h("div", { class: "row", style: "justify-content:space-between" }, h("div", {}, h("strong", {}, c.nombre_negocio || c.archivo), " ", c.clasificacion ? badgeClass(c.clasificacion) : h("span", { class: "badge warn" }, "por investigar"),
          c.ciudad ? h("span", { class: "muted" }, ` · ${c.ciudad}`) : null,
          h("div", { class: "faint mono" }, c.archivo)),
          h("div", { class: "row" }, h("button", { class: "btn primary", disabled: !c.listo_para_registrar, onclick: async () => {
            const ok = await modal({ title: "Registrar en el CRM", text: `${c.nombre_negocio}: se validará de nuevo (esquema, duplicados, exclusiones, coherencia de la calificación).`, confirm: "Registrar" });
            if (!ok) return; try { const res = await api("/api/review/register", { archivo: c.archivo }); toast(`Registrado como ${res.resultado.registrado}.`, "ok"); reload(); } catch (e) { toast(e.message, "bad"); } } }, "Registrar"),
            h("button", { class: "btn", onclick: async () => { const m = await modal({ title: "Rechazar candidato", fields: [{ name: "motivo", label: "Motivo", required: true, type: "textarea" }], confirm: "Rechazar" });
              if (!m) return; try { await api("/api/review/reject", { archivo: c.archivo, motivo: m.motivo }); toast("Candidato rechazado (se conserva en rechazados/).", "ok"); reload(); } catch (e) { toast(e.message, "bad"); } } }, "Rechazar"))),
        !c.calificado ? h("div", { class: "notice warn", style: "margin-top:10px" }, h("strong", {}, "Por investigar: "), "aún no tiene evidencia ni calificación. Pide a Claude que lo investigue (Google Maps, sitio, Meta Ads) y lo califique antes de registrarlo.")
          : c.errores.length ? h("div", { class: "notice warn", style: "margin-top:10px" }, h("strong", {}, "Pendiente de revisión: "), h("ul", {}, c.errores.map((e) => h("li", {}, e)))) : null,
        c.posibles_duplicados?.length ? h("div", { class: "notice warn", style: "margin-top:10px" }, `Posible duplicado (mismo nombre y ciudad): ${c.posibles_duplicados.map((x) => x[0]).join(", ")}`) : null,
        c.duplicados.length ? h("div", { class: "notice bad", style: "margin-top:10px" }, `Duplicado de ${c.duplicados.map((x) => x[0]).join(", ")}`) : null,
        c.suprimido.length ? h("div", { class: "notice bad", style: "margin-top:10px" }, "En lista de exclusión: no se puede registrar.") : null,
        c.evidencias.length ? h("details", { style: "margin-top:10px" }, h("summary", {}, `${c.evidencias.length} evidencias`), h("ul", {}, c.evidencias.map((e) => h("li", {}, `${e.senal}: ${e.observacion} `, confBadge(e.confianza))))) : null)))
        : h("div", { class: "empty" }, "No hay candidatos en revisión. Para investigar, pide en Claude Code: «investiga 10 dentistas en Puebla» (ver docs/OPERACION.md).")),
    h("h2", { style: "margin-top:24px" }, "Evidencia por prospecto"),
    h("div", { class: "stack" }, r.leads.map((L) => h("div", { class: "card" },
      h("div", { class: "row", style: "justify-content:space-between;margin-bottom:10px" }, h("div", {}, h("a", { href: `#/prospectos/${L.lead_id}` }, h("strong", {}, L.nombre_negocio)), " ", badgeClass(L.clasificacion), h("span", { class: "muted" }, ` ${L.puntaje} pts`)),
        h("div", { class: "row" }, Object.entries(L.confianza).map(([c, n]) => h("span", { class: `badge ${{ alta: "ok", media: "warn", baja: "bad" }[c]}` }, `${n} ${c}`)))),
      h("div", { class: "table-wrap" }, h("table", {}, h("thead", {}, h("tr", {}, ["Problema detectado", "Evidencia", "Verificado", "Confianza"].map((x) => h("th", {}, x)))),
        h("tbody", {}, L.evidencias.map((e) => h("tr", {}, h("td", {}, h("span", { class: "badge accent" }, e.senal)), h("td", {}, e.observacion, " ", h("a", { href: e.url, target: "_blank", rel: "noopener noreferrer" }, "fuente")), h("td", {}, e.fecha_verificacion), h("td", {}, confBadge(e.confianza))))))),
      h("div", { class: "row faint", style: "margin-top:10px;font-size:12px" }, `Fuente: ${L.fuente} (${L.fecha_fuente}) · No encontrados: ${L.campos_no_encontrados.join(", ") || "ninguno"}`),
      L.no_disponibles.length ? h("div", { class: "faint", style: "font-size:12px" }, `No disponibles: ${L.no_disponibles.join("; ")}`) : null))));
};

function draftCard(b, L, reload, compact = false) {
  const copyText = [b.asunto && !/^No aplica/.test(b.asunto) ? `Asunto: ${b.asunto}` : "", b.mensaje].filter(Boolean).join("\n\n");
  const isRef = (b.meta.estado || "").startsWith("no_elegible");
  const comp = (b.meta.compliance || "").replace("_", " ");
  return h("div", { class: "card" },
    h("div", { class: "row", style: "justify-content:space-between" },
      h("div", {}, compact ? null : h("a", { href: `#/prospectos/${b.lead_id}` }, h("strong", {}, L?.nombre_negocio || b.lead_id)), " ",
        h("span", { class: "badge info" }, CANAL[b.meta.canal] || b.meta.canal || "—"), " ",
        isRef ? h("span", { class: "badge neutral" }, "Solo referencia (clase C)") : h("span", { class: `badge ${L?.aprobacion_estado === "aprobado" ? "ok" : "warn"}` }, L?.aprobacion_estado === "aprobado" ? "Aprobado" : L?.aprobacion_estado === "pendiente" ? "Por aprobar" : (L?.aprobacion_estado || "—")), " ",
        h("span", { class: `badge ${comp.startsWith("aprobado") ? "ok" : comp.startsWith("bloq") ? "bad" : "warn"}` }, comp.startsWith("aprobado") ? "Cumplimiento OK" : comp.startsWith("bloq") ? "Bloqueado por cumplimiento" : `Cumplimiento: ${comp || "—"}`)),
      h("div", { class: "row" }, h("button", { class: "btn", onclick: async () => { try { await navigator.clipboard.writeText(copyText); toast("Mensaje copiado. Recuerda: lo envía una persona.", "ok"); } catch { toast("No se pudo copiar automáticamente; selecciona el texto.", "bad"); } } }, "Copiar"),
        !isRef && L?.estado_pipeline === "pendiente_aprobacion" ? [h("button", { class: "btn primary", onclick: () => approveLead(L, reload) }, "Aprobar para uso humano"), h("button", { class: "btn", onclick: () => requestChanges(L, reload) }, "Pedir cambios")] : null)),
    b.aviso ? h("div", { style: "margin-top:12px" }, md(b.aviso)) : null,
    b.asunto ? h("div", { class: "muted", style: "margin-top:12px" }, h("strong", {}, "Asunto: "), b.asunto) : null,
    h("div", { class: "message", style: "margin-top:10px" }, b.mensaje || "(sin mensaje)"),
    h("details", { style: "margin-top:12px" }, h("summary", {}, "Justificación y trazabilidad"), md(b.trazabilidad), b.notas ? [h("h3", { style: "margin-top:12px" }, "Notas para quien aprueba"), md(b.notas)] : null),
    b.cumplimiento ? h("details", { style: "margin-top:8px" }, h("summary", {}, "Observaciones de cumplimiento"), md(b.cumplimiento)) : null,
    b.historial ? h("details", { style: "margin-top:8px" }, h("summary", {}, "Historial del borrador"), md(b.historial)) : null);
}

// ---------------------------------------------------------------- Aprobar mensajes: modo revisión (lista + detalle)
const draftGroup = (b) => b.lead?.estado_pipeline === "pendiente_aprobacion" && !(b.meta.estado || "").startsWith("no_elegible") ? "pendientes"
  : b.lead?.estado_pipeline === "aprobado" ? "enviar" : "otros";
function contactChips(L) {
  if (!L) return null;
  const items = [["WhatsApp", L.whatsapp_publico], ["Teléfono", L.telefono_publico !== L.whatsapp_publico ? L.telefono_publico : ""], ["Correo", L.email_publico]].filter(([, x]) => x);
  if (!items.length) return null;
  return h("div", { class: "contact-chips" }, items.map(([k, x]) => h("button", { class: "chip-copy", type: "button", title: `Copiar ${k.toLowerCase()}`, onclick: () => copyText(x, `${k} copiado.`) },
    h("span", {}, k), h("strong", {}, x))));
}
views.mensajes = async (v, param) => {
  let all = (await api("/api/drafts")).borradores;
  const count = (g) => all.filter((b) => draftGroup(b) === g).length;
  let tab = param ? (draftGroup(all.find((b) => b.lead_id === param) || {}) || "todos") : count("pendientes") ? "pendientes" : count("enviar") ? "enviar" : "todos";
  if (tab === "otros") tab = "todos";
  let sel = param ? all.find((b) => b.lead_id === param)?.archivo : null;
  const tabs = h("div", { class: "seg", role: "tablist", "aria-label": "Filtrar borradores" });
  const listEl = h("ul", { class: "rv-list", role: "listbox", "aria-label": "Borradores" });
  const detail = h("section", { class: "rv-detail", "aria-live": "polite" });
  const shown = () => all.filter((b) => tab === "todos" || draftGroup(b) === tab);
  async function refresh(keepIndex) {
    const idx = shown().findIndex((b) => b.archivo === sel);
    all = (await api("/api/drafts")).borradores; refreshCounts();
    const list = shown(); if (!list.find((b) => b.archivo === sel)) sel = list[Math.min(Math.max(keepIndex ?? idx, 0), list.length - 1)]?.archivo || null;
    draw();
  }
  function select(archivo, focusDetail) {
    sel = archivo; draw();
    const b = all.find((x) => x.archivo === archivo);
    if (b) window.history?.replaceState?.(null, "", `#/mensajes/${b.lead_id}`), (LAST_ROUTE = `#/mensajes/${b.lead_id}`);
    if (focusDetail && window.matchMedia?.("(max-width: 1100px)").matches) detail.scrollIntoView?.({ behavior: "smooth", block: "start" });
  }
  function move(step) { const list = shown(); const i = list.findIndex((b) => b.archivo === sel); const n = list[Math.min(list.length - 1, Math.max(0, i + step))]; if (n) select(n.archivo); }
  function draw() {
    const list = shown();
    if (!list.find((b) => b.archivo === sel)) sel = list[0]?.archivo || null;
    tabs.replaceChildren(...[["pendientes", "Por aprobar"], ["enviar", "Por enviar"], ["todos", "Todos"]].map(([k, l]) =>
      h("button", { role: "tab", "aria-selected": String(tab === k), class: tab === k ? "active" : "", onclick: () => { tab = k; sel = null; draw(); } }, `${l} (${k === "todos" ? all.length : count(k)})`)));
    listEl.replaceChildren(...list.map((b) => { const L = b.lead || {}; const g = draftGroup(b);
      return h("li", { role: "option", tabindex: "0", "aria-selected": String(b.archivo === sel), class: `rv-item ${b.archivo === sel ? "on" : ""}`,
        onclick: () => select(b.archivo, true), onkeydown: (e) => e.key === "Enter" && select(b.archivo, true) },
        h("span", { class: `rv-dot ${g}` }), h("span", { class: "rv-main" }, h("strong", {}, L.nombre_negocio || b.lead_id), h("small", {}, [L.ciudad, CANAL[b.meta.canal] || b.meta.canal].filter(Boolean).join(" · "))),
        badgeClass(L.clasificacion)); }));
    const b = all.find((x) => x.archivo === sel);
    if (!b) { detail.replaceChildren(h("div", { class: "card" }, emptyState(tab === "pendientes" ? "Nada por aprobar" : tab === "enviar" ? "Nada por enviar" : "Sin borradores",
      tab === "pendientes" ? "Todos los borradores están revisados. Los nuevos aparecerán aquí." : tab === "enviar" ? "Cuando apruebes un mensaje, aquí lo copias y registras el envío." : "Cuando Claude prepare mensajes para leads A y B, aparecerán aquí.",
      h("a", { class: "btn", href: "#/hoy" }, "Ir a Hoy")))); return; }
    const L = b.lead || {}; const g = draftGroup(b); const i = list.indexOf(b);
    const comp = (b.meta.compliance || "").replace("_", " ");
    const text = [b.asunto && !/^No aplica/.test(b.asunto) ? `Asunto: ${b.asunto}` : "", b.mensaje].filter(Boolean).join("\n\n");
    const after = () => refresh(i);
    const actions = g === "pendientes"
      ? [h("button", { class: "btn primary", onclick: () => approveLead(L, after) }, icon("check"), "Aprobar para uso humano", h("kbd", {}, "A")),
         h("button", { class: "btn", onclick: () => requestChanges(L, after) }, "Pedir cambios", h("kbd", {}, "C")),
         h("button", { class: "btn ghost", onclick: () => copyText(text, "Mensaje copiado.") }, "Copiar")]
      : g === "enviar"
      ? [sendableDraft(L, b) ? h("button", { class: "btn primary", onclick: () => openWhatsApp(L, b) }, "Abrir en WhatsApp") : null,
         h("button", { class: `btn ${sendableDraft(L, b) ? "" : "primary"}`, onclick: () => copyText(text, "Mensaje copiado. Recuerda: lo envía una persona desde su cuenta.") }, "Copiar mensaje"),
         h("button", { class: "btn", onclick: () => markSent(L, after) }, icon("check"), "Marcar como enviado")]
      : [h("button", { class: "btn", onclick: () => copyText(text, "Mensaje copiado.") }, "Copiar")];
    detail.replaceChildren(h("div", { class: "card rv-card" },
      h("div", { class: "rv-head" },
        h("div", { class: "rv-title" }, h("a", { href: `#/prospectos/${b.lead_id}` }, h("h2", {}, L.nombre_negocio || b.lead_id)),
          h("div", { class: "row rv-meta" }, badgeClass(L.clasificacion), L.puntaje_total ? h("span", { class: "muted" }, `${L.puntaje_total} pts`) : null, L.ciudad ? h("span", { class: "muted" }, L.ciudad) : null,
            h("span", { class: "badge info" }, CANAL[b.meta.canal] || b.meta.canal || "—"),
            h("span", { class: `badge ${comp.startsWith("aprobado") ? "ok" : comp.startsWith("bloq") ? "bad" : "warn"}` }, comp.startsWith("aprobado") ? "Cumplimiento OK" : comp.startsWith("bloq") ? "Bloqueado por cumplimiento" : `Cumplimiento: ${comp || "—"}`))),
        h("div", { class: "rv-nav" }, h("span", { class: "faint" }, `${i + 1} de ${list.length}`),
          h("button", { class: "btn ghost icon-btn", "aria-label": "Anterior (K)", title: "Anterior (K)", disabled: i <= 0, onclick: () => move(-1) }, "‹"),
          h("button", { class: "btn ghost icon-btn", "aria-label": "Siguiente (J)", title: "Siguiente (J)", disabled: i >= list.length - 1, onclick: () => move(1) }, "›"))),
      contactChips(L),
      b.verificacion && g !== "otros" ? h("div", { class: "verify" }, h("strong", {}, g === "pendientes" ? "Antes de aprobar, verifica" : "Antes de enviar, verifica"), md(b.verificacion)) : null,
      b.aviso ? md(b.aviso) : null,
      b.asunto ? h("div", { class: "muted rv-subject" }, h("strong", {}, "Asunto: "), b.asunto) : null,
      h("div", { class: "message" }, b.mensaje || "(sin mensaje)"),
      h("div", { class: "rv-actions" }, actions),
      b.notas ? h("details", { open: true }, h("summary", {}, "Notas para quien aprueba"), md(b.notas)) : null,
      h("details", {}, h("summary", {}, "Justificación y trazabilidad"), md(b.trazabilidad)),
      b.cumplimiento ? h("details", {}, h("summary", {}, "Observaciones de cumplimiento"), md(b.cumplimiento)) : null,
      b.historial ? h("details", {}, h("summary", {}, "Historial del borrador"), md(b.historial)) : null));
  }
  VIEW_KEYDOWN = (e) => {
    const b = all.find((x) => x.archivo === sel); const g = b && draftGroup(b);
    if (e.key === "j" || e.key === "J") { e.preventDefault(); move(1); }
    else if (e.key === "k" || e.key === "K") { e.preventDefault(); move(-1); }
    else if ((e.key === "a" || e.key === "A") && g === "pendientes") { e.preventDefault(); approveLead(b.lead, () => refresh()); }
    else if ((e.key === "c" || e.key === "C") && g === "pendientes") { e.preventDefault(); requestChanges(b.lead, () => refresh()); }
  };
  v.append(h("div", { class: "page-head" }, h("div", {}, h("h1", {}, "Aprobar mensajes"),
      h("p", {}, "Revisa, aprueba y registra el envío. Aprobar no envía nada: una persona lo manda desde su propia cuenta.")), tabs),
    h("div", { class: "review" }, h("div", { class: "card flat rv-side" }, listEl, h("div", { class: "rv-keys faint" }, h("kbd", {}, "J"), h("kbd", {}, "K"), " moverse · ", h("kbd", {}, "A"), " aprobar · ", h("kbd", {}, "C"), " cambios")), detail));
  draw();
};

// ---------------------------------------------------------------- Hoy: una sola cola de trabajo ordenada por urgencia
const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"], MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const prettyDate = (ymd) => { const d = new Date(`${ymd}T12:00:00Z`); return `${DIAS[d.getUTCDay()]} ${d.getUTCDate()} de ${MESES[d.getUTCMonth()]}`; };
views.hoy = async (v) => {
  const [t, s] = await Promise.all([api("/api/today"), api("/api/summary").catch(() => null)]);
  const reload = () => route();
  const open = (id) => () => (location.hash = `#/prospectos/${id}`);
  const B = (label, onclick, cls = "") => h("button", { class: `btn sm ${cls}`, onclick: (e) => { e.stopPropagation(); onclick(); } }, label);
  const groups = [
    { title: "Vencidas", tone: "bad", items: t.acciones.filter((x) => x.vencido), sub: (x) => `${x.accion || "Sin acción"} · vencía el ${x.fecha}`,
      act: (x) => [B("Reprogramar", () => editNext(x, reload), "primary")] },
    { title: "Aprobados por enviar", tone: "ok", items: t.por_enviar, sub: (x) => `Mensaje aprobado · ${CANAL[x.canal_preferido] || x.canal_preferido || "canal por definir"}`,
      act: (x) => [B("Ver mensaje", () => (location.hash = `#/mensajes/${x.lead_id}`), "primary"), B("Marcar enviado", () => markSent(x, reload))] },
    { title: "Acciones de hoy", tone: "accent", items: t.acciones.filter((x) => !x.vencido), sub: (x) => x.accion || "Sin acción",
      act: (x) => [B("Actualizar", () => editNext(x, reload), "primary")] },
    { title: "Seguimientos de hoy", tone: "accent", items: t.seguimientos.map((f) => ({ ...f, nombre_negocio: f.negocio })), sub: (f) => `FU${f.numero_seguimiento} por ${CANAL[f.canal] || f.canal}${f.vencido ? ` · vencía el ${f.fecha_programada}` : ""}`,
      act: () => [B("Ir a Seguimientos", () => (location.hash = "#/seguimientos"))] },
    { title: "Por aprobar", tone: "warn", items: t.por_aprobar, sub: (x) => `Clase ${x.clasificacion} · ${x.puntaje_total} pts${x.ciudad ? ` · ${x.ciudad}` : ""}`,
      act: (x) => [B("Revisar", () => (location.hash = `#/mensajes/${x.lead_id}`), "primary")] },
    { title: "Sin próxima acción", tone: "bad", items: t.sin_accion, sub: () => "Define qué sigue y cuándo para que no se olvide",
      act: (x) => [B("Definir", () => editNext(x, reload), "primary")] },
  ].filter((g) => g.items.length);
  const total = groups.reduce((n, g) => n + g.items.length, 0), venc = (groups.find((g) => g.title === "Vencidas")?.items.length || 0);
  const goal = s?.objetivo; const pct = goal ? Math.min(100, Math.round((100 * goal.hoy) / Math.max(1, goal.meta))) : 0;
  const bar = h("div", { class: "meter-fill", style: `width:${pct}%` });
  v.append(
    h("div", { class: "page-head" }, h("div", {}, h("h1", {}, "Hoy"), h("p", {}, `${prettyDate(t.hoy)} · `,
      total ? h("span", {}, `${total} pendiente${total === 1 ? "" : "s"}`, venc ? h("span", { class: "bad-text" }, ` · ${venc} vencida${venc === 1 ? "" : "s"}`) : null) : "estás al día")),
      h("button", { class: "btn hide-sm", onclick: () => openSearch() }, icon("search"), "Buscar prospecto")),
    goal ? h("div", { class: "card goal-strip" },
      h("div", { class: "goal-num" }, h("strong", {}, goal.hoy), h("span", {}, ` / ${goal.meta}`)),
      h("div", { class: "goal-body" }, h("div", { class: "goal-label" }, "Calificados (A+B) registrados hoy"), h("div", { class: "meter", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": String(goal.meta), "aria-valuenow": String(goal.hoy), "aria-label": "Avance de la meta diaria" }, bar)),
      h("div", { class: "goal-links" }, h("a", { href: "#/mensajes" }, `${s.kpis.pendientes_aprobacion || 0} por aprobar`), h("a", { href: "#/investigacion" }, `${s.kpis.en_revision || 0} en revisión`))) : null,
    total ? h("div", { class: "queue" }, groups.map((g) => h("section", { class: "q-group", "aria-label": g.title },
      h("div", { class: "q-head" }, h("span", { class: `q-dot ${g.tone}` }), h("h2", {}, g.title), h("span", { class: "q-count" }, g.items.length)),
      h("div", { class: "card flat q-list" }, g.items.map((x) => h("div", { class: "q-row", tabindex: "0", role: "link", "aria-label": `Abrir ${x.nombre_negocio || x.lead_id}`,
        onclick: open(x.lead_id), onkeydown: (e) => e.target === e.currentTarget && e.key === "Enter" && open(x.lead_id)() },
        h("div", { class: "q-main" }, h("strong", {}, x.nombre_negocio || x.lead_id), h("small", {}, g.sub(x))),
        x.estado_pipeline ? h("span", { class: "q-state" }, stateEl(x.estado_pipeline)) : null,
        h("div", { class: "q-acts" }, g.act(x))))))))
      : h("div", { class: "card" }, emptyState("Estás al día", "No hay tareas para hoy. Buen momento para revisar candidatos o pedir una nueva búsqueda de prospectos.",
        h("div", { class: "row" }, h("a", { class: "btn primary", href: "#/investigacion" }, "Revisar candidatos"), h("a", { class: "btn", href: "#/prospectos" }, "Ver prospectos")))),
    h("section", { class: "q-group" }, h("div", { class: "q-head" }, h("span", { class: "q-dot muted" }), h("h2", {}, "Próximos 7 días"), h("span", { class: "q-count" }, t.proximos.length)),
      t.proximos.length ? h("div", { class: "card flat q-list" }, t.proximos.map((x) => h("div", { class: "q-row", tabindex: "0", role: "link", onclick: open(x.lead_id), onkeydown: (e) => e.key === "Enter" && open(x.lead_id)() },
        h("span", { class: "q-date" }, prettyDate(x.fecha).replace(/ de \S+$/, "")), h("div", { class: "q-main" }, h("strong", {}, x.nombre_negocio), h("small", {}, x.accion)), h("span", { class: "q-state" }, stateEl(x.estado_pipeline)))))
        : h("div", { class: "card" }, emptyState("Nada programado", "Ningún prospecto tiene acciones en los próximos 7 días."))));
};

views.seguimientos = async (v) => {
  const s = await api("/api/followups"); const reload = () => route();
  const table = (cols, data, row) => data.length ? h("div", { class: "table-wrap" }, h("table", {}, h("thead", {}, h("tr", {}, cols.map((c) => h("th", {}, c)))), h("tbody", {}, data.map(row)))) : h("div", { class: "empty" }, "Nada por ahora.");
  v.append(h("div", { class: "page-head" }, h("div", {}, h("h1", {}, "Seguimientos"), h("p", {}, "Cadencia según policies/contact-cadence.md. Domingos y días inhábiles se rechazan automáticamente.")),
      h("button", { class: "btn primary", onclick: async () => {
        const { leads } = await api("/api/leads"); const act = leads.filter((L) => !["descartado", "ganado", "perdido", "no_contactar"].includes(L.estado_pipeline));
        if (!act.length) return toast("No hay prospectos activos.", "bad");
        const r = await modal({ title: "Programar seguimiento", fields: [{ name: "lead_id", label: "Prospecto", type: "select", options: act.map((L) => ({ value: L.lead_id, label: `${L.nombre_negocio} (${L.lead_id})` })) },
          { name: "fecha", label: "Fecha (día hábil)", type: "date", required: true }, { name: "numero", label: "Número de seguimiento", type: "select", options: [1, 2, 3].map((n) => ({ value: n, label: `FU${n}` })) },
          { name: "canal", label: "Canal", type: "select", options: ["email", "whatsapp", "telefono", "formulario_web", "instagram_dm", "facebook_messenger"].map((x) => ({ value: x, label: x })) }], confirm: "Programar" });
        if (!r) return; try { await api("/api/followups", { lead_id: r.lead_id, fecha_programada: r.fecha, numero_seguimiento: r.numero, canal: r.canal, ventana_horaria: "10:00-13:00" }); toast("Seguimiento programado.", "ok"); reload(); } catch (e) { toast(e.message, "bad"); }
      } }, "Programar seguimiento")),
    h("div", { class: "grid cols-2" },
      h("div", { class: "card flat" }, h("div", { style: "padding:16px 16px 0" }, h("h3", {}, "Próximas acciones")),
        table(["Fecha", "Prospecto", "Acción"], s.proximas, (a) => h("tr", { onclick: () => (location.hash = `#/prospectos/${a.lead_id}`) }, h("td", {}, a.vencido ? h("span", { class: "badge bad" }, `${a.fecha} vencido`) : a.fecha), h("td", {}, a.negocio), h("td", { class: "muted" }, a.accion)))),
      h("div", { class: "card flat" }, h("div", { style: "padding:16px 16px 0" }, h("h3", {}, "Seguimientos programados")),
        table(["Fecha", "Prospecto", "FU", "Canal", "Estado", ""], s.seguimientos, (f) => h("tr", {}, h("td", {}, f.vencido ? h("span", { class: "badge bad" }, f.fecha_programada) : f.fecha_programada), h("td", {}, f.negocio), h("td", {}, `FU${f.numero_seguimiento}`), h("td", {}, f.canal), h("td", {}, f.estado),
          h("td", {}, ["enviado", "cancelado"].includes(f.estado) ? null : h("select", { class: "input", onchange: async (e) => { const est = e.target.value; e.target.value = ""; if (!est) return;
            if ((est === "enviado") && !who() && !(await askName())) return;
            const ok = await modal({ title: `Marcar ${f.seguimiento_id} como «${est}»`, text: est === "enviado" ? "Confirma que una persona ya lo envió fuera del sistema." : "", confirm: "Confirmar" });
            if (!ok) return; try { await api(`/api/followups/${f.seguimiento_id}/status`, { estado: est }); toast("Seguimiento actualizado.", "ok"); reload(); } catch (err) { toast(err.message, "bad"); } } },
            h("option", { value: "" }, "Cambiar…"), ["borrador_listo", "pendiente_aprobacion", "enviado", "cancelado"].map((x) => h("option", { value: x }, x)))))))),
    h("div", { class: "grid cols-3", style: "margin-top:16px" },
      h("div", { class: "card" }, h("h3", {}, `Historial de contactos (${s.historial.length})`), s.historial.length ? h("ul", { class: "timeline" }, s.historial.slice(0, 20).map((i) => h("li", {}, h("div", {}, `${i.negocio}: ${i.tipo}`), h("div", { class: "when" }, `${fmtDT(i.fecha_hora)} · ${i.canal}`)))) : h("div", { class: "empty" }, "Sin contactos registrados.")),
      h("div", { class: "card" }, h("h3", {}, `Pausados (${s.pausados.length})`), s.pausados.length ? s.pausados.map((L) => h("div", {}, h("a", { href: `#/prospectos/${L.lead_id}` }, L.nombre_negocio), h("span", { class: "muted" }, ` · retomar ${L.proximo_seguimiento}`))) : h("div", { class: "empty" }, "Ninguno.")),
      h("div", { class: "card" }, h("h3", {}, `Perdidos y bajas (${s.perdidos.length})`), s.perdidos.length ? s.perdidos.map((L) => h("div", {}, h("a", { href: `#/prospectos/${L.lead_id}` }, L.nombre_negocio), " ", stateEl(L.estado_pipeline))) : h("div", { class: "empty" }, "Ninguno."))),
    s.tareas ? h("div", { class: "card", style: "margin-top:16px" }, h("h3", {}, `Tareas internas (${s.tareas.length})`),
      s.tareas.length ? s.tareas.map((t) => h("div", { class: "row", style: "justify-content:space-between;border-bottom:1px solid var(--border);padding:8px 0" },
        h("div", {}, h("span", { class: "badge neutral" }, t.tipo), " ", h("strong", {}, t.titulo), h("div", { class: "faint", style: "font-size:12px" }, `${t.detalle} · ${fmtDT(t.creado_en)} · ${t.origen}`)),
        h("div", { class: "row" }, ["hecha", "descartada"].map((est) => h("button", { class: "btn sm", onclick: async () => { try { await api(`/api/tasks/${t.id}/status`, { estado: est }); reload(); } catch (e) { toast(e.message, "bad"); } } }, est === "hecha" ? "Hecha" : "Descartar")))))
        : h("div", { class: "empty" }, "Sin tareas abiertas.")) : "");
};

// ---------------------------------------------------------------- Rendimiento: dashboard y reportes en una sola pantalla
const EVENTO = { "aprobacion.humana": "Mensaje aprobado", "borrador.guardado": "Borrador guardado", "borrador.listo": "Borrador listo para aprobar", "baja.registrada": "Baja registrada",
  "supresion.agregada": "Agregado a exclusión", "candidato.actualizado": "Candidato actualizado", "candidato.rechazado": "Candidato rechazado", "candidato.subido": "Candidato subido",
  "candidatos.alta": "Candidatos agregados", "config.actualizada": "Configuración actualizada", "documento.actualizado": "Documento actualizado", "exportacion": "Exportación",
  "investigacion.fallida": "Investigación fallida", "investigacion.pendiente": "Investigación pendiente", "lead.actualizado": "Prospecto actualizado", "lead.estado_cambiado": "Cambio de estado",
  "lead.registrado": "Prospecto registrado", "prospeccion.solicitada": "Búsqueda solicitada", "prospecto.nuevo": "Prospecto nuevo", "reporte.diario": "Reporte diario",
  "seguimiento.actualizado": "Seguimiento actualizado", "seguimiento.programado": "Seguimiento programado", "tarea.cerrada": "Tarea cerrada", "respuesta.recibida": "Respuesta recibida",
  "interaccion.registrada": "Interacción registrada", "auth.login": "Inicio de sesión", "auth.fallo": "Intento de acceso fallido" };
const pct = (a, b) => (b ? Math.round((100 * a) / b) : null);
function rateBar(p) { return h("div", { class: "rate" }, h("div", { class: "rate-track" }, h("div", { class: "rate-fill", style: `width:${p || 0}%` })), h("span", {}, p == null ? "—" : `${p}%`)); }
function breakdown(title, g, label = (k) => k) {
  const rows = Object.entries(g).map(([k, x]) => ({ k, total: x.total, ab: (x.A || 0) + (x.B || 0) })).sort((a, b) => b.total - a.total || b.ab - a.ab);
  const row = (r) => h("tr", {}, h("td", { class: "bd-name" }, label(r.k)), h("td", { class: "num" }, r.total), h("td", { class: "num" }, r.ab), h("td", {}, rateBar(pct(r.ab, r.total))));
  const head = h("thead", {}, h("tr", {}, h("th", {}, title), h("th", { class: "num" }, "Total"), h("th", { class: "num" }, "A+B"), h("th", {}, "Calificación")));
  return h("div", { class: "card flat bd" }, rows.length ? h("div", { class: "table-wrap" }, h("table", {}, head, h("tbody", {}, rows.slice(0, 6).map(row))),
      rows.length > 6 ? h("details", { class: "bd-more" }, h("summary", {}, `Ver ${rows.length - 6} más`), h("table", {}, h("tbody", {}, rows.slice(6).map(row)))) : null)
    : emptyState(`Sin datos por ${title.toLowerCase()}`, "Aparecerán cuando haya prospectos registrados."));
}
views.dashboard = async (v) => {
  const [s, r, ls] = await Promise.all([api("/api/summary"), api("/api/reports"), SEARCH_CACHE ? Promise.resolve({ leads: SEARCH_CACHE }) : api("/api/leads").catch(() => ({ leads: [] }))]);
  const k = s.kpis; const names = Object.fromEntries((ls.leads || []).map((L) => [L.lead_id, L.nombre_negocio]));
  // Últimos 7 días contra los 7 anteriores (prospectos registrados por día).
  const today = todayStr(); const dayN = (n) => { const d = new Date(`${today}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };
  const sumDays = (from, to) => Object.entries(r.diario || {}).filter(([d]) => d > dayN(to) && d <= dayN(from)).reduce((n, [, x]) => n + x, 0);
  const last7 = sumDays(0, 7), prev7 = sumDays(7, 14), delta = last7 - prev7;
  const goalPct = Math.min(100, pct(s.objetivo.hoy, Math.max(1, s.objetivo.meta)) || 0);
  const tile = (label, value, sub, extra, cls = "") => h("div", { class: `card tile ${cls}` }, h("div", { class: "tile-label" }, label), h("div", { class: "tile-value" }, value), extra || null, sub ? h("div", { class: "tile-sub" }, sub) : null);
  // Embudo: cada etapa contra la primera (ancho) y contra la anterior (conversión).
  const fun = (r.embudo || []).filter((e) => e.etapa !== "mensaje_borrador"); const top = Math.max(1, fun[0]?.leads || 0);
  const funnel = h("div", { class: "funnel", role: "list" }, fun.map((e, i) => { const prev = i ? fun[i - 1].leads : null; const conv = i ? pct(e.leads, prev) : null;
    return h("div", { class: "f-row", role: "listitem" }, h("span", { class: "f-label" }, STATE_LABEL[e.etapa] || e.etapa),
      h("div", { class: "f-track" }, h("div", { class: `f-bar ${e.leads ? "" : "zero"}`, style: `width:${Math.max(e.leads ? 2 : 0, (100 * e.leads) / top)}%` })),
      h("span", { class: "f-n" }, e.leads), h("span", { class: "f-conv" }, conv == null ? "" : prev ? `${conv}%` : "—")); }));
  const maxAct = Math.max(1, ...s.actividad.map((a) => a.eventos));
  const weeks = Object.entries(r.semanal || {}).slice(-8); const maxW = Math.max(1, ...weeks.map(([, n]) => n));
  const conf = r.calidad_evidencia || {}; const totC = (conf.alta || 0) + (conf.media || 0) + (conf.baja || 0);
  const nf = Object.entries(r.campos_no_encontrados || {}).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const attention = [["Mensajes por aprobar", k.pendientes_aprobacion, "#/mensajes", "warn"], ["Aprobados por enviar", k.aprobados, "#/prospectos?vista=enviar", "ok"],
    ["Candidatos en revisión", k.en_revision, "#/investigacion", "accent"]];
  v.append(
    h("div", { class: "page-head" }, h("div", {}, h("h1", {}, "Rendimiento"), h("p", {}, "Datos en vivo del CRM y de la auditoría.")),
      h("button", { class: "btn", onclick: async () => { try { const x = await api("/api/export", {}); toast(`Exportado: ${x.resultado.exportado}`, "ok"); } catch (e) { toast(e.message, "bad"); } } }, "Exportar CRM")),
    h("div", { class: "tiles" },
      tile("Objetivo diario", h("span", {}, s.objetivo.hoy, h("small", {}, ` / ${s.objetivo.meta}`)), "Calificados (A+B) registrados hoy",
        h("div", { class: "meter", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": String(s.objetivo.meta), "aria-valuenow": String(s.objetivo.hoy), "aria-label": "Avance de la meta diaria" }, h("div", { class: "meter-fill", style: `width:${goalPct}%` })), "lead"),
      tile("Registrados, últimos 7 días", last7, prev7 || last7 ? h("span", { class: delta > 0 ? "up" : delta < 0 ? "down" : "" }, delta > 0 ? `↑ ${delta} más` : delta < 0 ? `↓ ${-delta} menos` : "Igual", ` que los 7 días anteriores (${prev7})`) : "Sin registros en las últimas dos semanas"),
      tile("Tasa de respuesta", k.tasa_respuesta != null ? `${k.tasa_respuesta}%` : "—", k.contactados ? `${k.respuestas} de ${k.contactados} contactados respondieron` : "Aún no hay contactos registrados"),
      tile("Reuniones y cierres", h("span", {}, k.reuniones, h("small", {}, " reuniones")), `${k.ganados} cliente${k.ganados === 1 ? "" : "s"} cerrado${k.ganados === 1 ? "" : "s"}${k.tasa_conversion != null ? ` · conversión ${k.tasa_conversion}%` : ""}`)),
    h("div", { class: "grid perf-main" },
      h("div", { class: "card" }, h("div", { class: "card-head" }, h("h2", {}, "Conversión por etapa"), h("span", { class: "faint" }, "prospectos que llegaron a cada etapa · % contra la anterior")),
        fun.length && top ? funnel : emptyState("Sin datos de embudo", "El embudo se llena a medida que los prospectos avanzan.")),
      h("div", { class: "stack" },
        h("div", { class: "card" }, h("h2", {}, "Requiere atención"), h("div", { class: "attn" }, attention.map(([label, n, href, tone]) =>
          h("a", { class: `attn-row ${n ? "" : "zero"}`, href }, h("span", { class: `q-dot ${n ? tone : "muted"}` }), h("span", { class: "attn-label" }, label), h("strong", {}, n || 0))))),
        h("div", { class: "card" }, h("h2", {}, "Por estado"), h("div", {}, Object.entries(s.por_estado).sort((a, b) => b[1] - a[1]).slice(0, 7).map(([st, n]) => hbar(STATE_LABEL[st] || st, n, k.registrados)))))),
    h("div", { class: "grid perf-act" },
      h("div", { class: "card" }, h("div", { class: "card-head" }, h("h2", {}, "Actividad, últimos 14 días"),
          h("div", { class: "legend" }, h("span", {}, h("i", { class: "lg ev" }), "Eventos registrados"), h("span", {}, h("i", { class: "lg ca" }), "Calificados"))),
        h("div", { class: "bars", role: "img", "aria-label": `Actividad de 14 días: ${s.actividad.reduce((n, a) => n + a.eventos, 0)} eventos y ${s.actividad.reduce((n, a) => n + a.calificados, 0)} calificados` },
          s.actividad.map((a) => h("div", { class: "bar", title: `${a.dia}: ${a.eventos} eventos, ${a.calificados} calificados`, style: `height:${(100 * a.eventos) / maxAct}%` },
            h("span", { style: `height:${a.eventos ? (100 * a.calificados) / a.eventos : 0}%` })))),
        h("div", { class: "bars-x" }, s.actividad.map((a) => h("span", {}, a.dia.slice(8))))),
      h("div", { class: "card" }, h("h2", {}, "Registrados por semana"), weeks.length ? weeks.map(([w, n]) => hbar(w.replace(/^\d{4}-S/, "Semana "), n, maxW)) : emptyState("Sin registros", "Aún no hay prospectos registrados."))),
    h("div", { class: "section-head" }, h("h2", {}, "Dónde prospectar"), h("span", { class: "faint" }, "Qué nichos, ciudades y fuentes dan más prospectos A y B")),
    h("div", { class: "grid cols-3" }, breakdown("Nicho", r.por_nicho, (x) => NICHO[x] || x), breakdown("Ciudad", r.por_ciudad), breakdown("Fuente", r.por_fuente)),
    h("div", { class: "grid cols-2 perf-bottom" },
      h("div", { class: "card" }, h("h2", {}, "Calidad de investigación"),
        totC ? [h("div", { class: "stackbar", role: "img", "aria-label": `Evidencias: ${conf.alta || 0} alta, ${conf.media || 0} media, ${conf.baja || 0} baja` },
            ["alta", "media", "baja"].map((c) => conf[c] ? h("span", { class: `sb-${c}`, style: `width:${(100 * conf[c]) / totC}%` }) : null)),
          h("div", { class: "legend" }, ["alta", "media", "baja"].map((c) => h("span", {}, h("i", { class: `lg sb-${c}` }), `Confianza ${c}: ${conf[c] || 0}`)))]
          : h("p", { class: "muted" }, "Sin evidencias estructuradas registradas todavía."),
        nf.length ? [h("h3", { style: "margin-top:16px" }, "Datos no encontrados más frecuentes"), nf.map(([c, n]) => hbar(c, n, Math.max(...nf.map((x) => x[1]))))] : null,
        h("p", { class: "faint", style: "font-size:12px;margin:12px 0 0" }, r.revision ? `Revisión: ${r.revision.pendientes} pendientes · ${r.revision.rechazados} rechazados. ` : "", r.tiempo_investigacion || "")),
      h("div", { class: "card" }, h("h2", {}, "Actividad reciente"),
        s.recientes.length ? h("ul", { class: "timeline" }, s.recientes.slice(0, 8).map((e) => h("li", {}, h("div", {}, h("strong", {}, EVENTO[e.evento] || e.evento.replace(/[._]/g, " ")),
          e.entidad ? [" · ", names[e.entidad] ? h("a", { href: `#/prospectos/${e.entidad}` }, names[e.entidad]) : h("span", { class: "muted" }, e.entidad)] : null),
          h("div", { class: "when" }, `${fmtDT(e.ts)} · ${e.actor}`)))) : emptyState("Sin eventos todavía", "Cada acción en el CRM queda registrada aquí."))));
};
// «Reportes» quedó dentro de Rendimiento; la ruta vieja sigue funcionando.
views.reportes = async (v, p, q) => { replaceHash("#/dashboard"); return views.dashboard(v, p, q); };

views.configuracion = async (v) => {
  const c = await api("/api/config"); const cfg = c.config; const reload = () => route();
  const save = async (patch) => { try { await api("/api/config", patch); toast("Configuración guardada y auditada.", "ok"); reload(); } catch (e) { toast(e.message, "bad"); } };
  const policyTabs = h("div", { class: "tabs" }); const policyPane = h("div");
  const names = { "opt-out": "Bajas", consent: "Consentimiento", "contact-cadence": "Cadencias y límites" };
  Object.keys(c.politicas).forEach((k, i) => policyTabs.append(h("button", { class: i === 0 ? "active" : "", onclick: (e) => { [...policyTabs.children].forEach((b) => b.classList.toggle("active", b === e.target)); policyPane.replaceChildren(md(c.politicas[k])); } }, names[k])));
  policyPane.append(md(c.politicas["opt-out"]));
  v.append(h("div", { class: "page-head" }, h("div", {}, h("h1", {}, "Configuración"), h("p", {}, "Parámetros operativos editables. Políticas y reglas de puntuación son de solo lectura: se cambian con aprobación de una persona en Claude Code."))),
    h("div", { class: "grid cols-3" },
      h("div", { class: "card" }, h("h3", {}, "Objetivo diario"), h("div", { class: "row" }, h("input", { class: "input", type: "number", min: 1, max: 500, value: cfg.objetivo_diario_calificados, id: "goal", style: "width:110px" }),
        h("button", { class: "btn primary", onclick: () => save({ objetivo_diario_calificados: +$("#goal").value }) }, "Guardar")), h("p", { class: "faint", style: "font-size:12px" }, "Prospectos calificados (A+B) por día.")),
      h("div", { class: "card" }, h("h3", {}, "Nichos"), cfg.nichos.map((n, i) => h("label", { class: "check", style: "margin:6px 0" }, h("input", { type: "checkbox", checked: n.activo, onchange: (e) => { cfg.nichos[i].activo = e.target.checked; save({ nichos: cfg.nichos }); } }),
        h("span", {}, h("strong", {}, `${n.prioridad}. ${n.nombre}`), h("br"), h("span", { class: "faint", style: "font-size:12px" }, n.motivo))))),
      h("div", { class: "card" }, h("h3", {}, "Ciudades"), cfg.ciudades.map((n, i) => h("label", { class: "check", style: "margin:6px 0" }, h("input", { type: "checkbox", checked: n.activa, onchange: (e) => { cfg.ciudades[i].activa = e.target.checked; save({ ciudades: cfg.ciudades }); } }), `${n.nombre}, ${n.estado_mx}`)),
        h("button", { class: "btn sm", style: "margin-top:8px", onclick: async () => { const r = await modal({ title: "Añadir ciudad", fields: [{ name: "nombre", label: "Ciudad", required: true }, { name: "estado", label: "Estado", required: true }], confirm: "Añadir" });
          if (r) save({ ciudades: [...cfg.ciudades, { nombre: r.nombre, estado_mx: r.estado, activa: true }] }); } }, "+ Añadir ciudad"))),
    h("div", { class: "grid cols-2", style: "margin-top:16px" },
      h("div", { class: "card" }, h("h3", {}, "Puntuación (solo lectura)"), h("p", { class: "muted" }, `A: ≥${c.puntuacion.clasificacion.A.total_min} pts, ≥${c.puntuacion.clasificacion.A.senales_min} señales, contacto ≥${c.puntuacion.clasificacion.A.contacto_min} · B: ≥${c.puntuacion.clasificacion.B.total_min}, ≥${c.puntuacion.clasificacion.B.senales_min} señal · descartado <${c.puntuacion.clasificacion.descartado_si_total_menor_a}. Tope de oportunidad: ${c.puntuacion.oportunidad.tope}. Las señales solo con confianza baja no puntúan.`),
        h("div", { class: "table-wrap" }, h("table", {}, h("thead", {}, h("tr", {}, h("th", {}, "Señal"), h("th", {}, "Puntos"))), h("tbody", {}, Object.entries(c.puntuacion.senales).map(([k, n]) => h("tr", {}, h("td", { class: "mono" }, k), h("td", { class: "num" }, n))))))),
      h("div", { class: "card" }, h("h3", {}, "Políticas (solo lectura)"), policyTabs, policyPane)),
    h("div", { class: "grid cols-3", style: "margin-top:16px" },
      h("div", { class: "card" }, h("h3", {}, "Reglas de aprobación automática"), c.reglas_aprobacion.map((r) => h("div", { class: "row", style: "margin:6px 0" }, h("span", { class: "badge neutral" }, r.id), h("span", { class: `badge ${r.estado === "activa" ? "ok" : "neutral"}` }, r.estado), h("span", { class: "muted", style: "font-size:12px" }, r.accion))),
        h("p", { class: "faint", style: "font-size:12px" }, `Envíos automáticos: ${c.automatizaciones.envios_automaticos}. n8n: ${c.automatizaciones.n8n}.`)),
      h("div", { class: "card" }, h("h3", {}, "Integraciones"), c.integraciones.map((i) => h("div", { style: "margin:8px 0" }, h("div", { class: "row" }, h("span", { class: `badge ${/^activo/.test(i.estado) ? "ok" : /disponible|implementado|preparado/.test(i.estado) ? "info" : "neutral"}` }, i.estado), h("strong", { style: "font-size:13px" }, i.nombre)),
        i.requiere ? h("div", { class: "faint", style: "font-size:12px" }, i.requiere) : null)),
        h("h3", { style: "margin-top:14px" }, "Variables de entorno"), Object.entries(c.variables_entorno).map(([k, on]) => h("div", { class: "row mono" }, h("span", { class: `badge ${on ? "ok" : "neutral"}` }, on ? "definida" : "vacía"), k))),
      h("div", { class: "card" }, h("h3", {}, "Días sin contacto"), h("p", { class: "faint", style: "font-size:12px" }, "Además de todos los domingos. Se rechazan al programar seguimientos."),
        c.dias_inhabiles.map((d) => h("div", { class: "row", style: "font-size:13px;margin:4px 0" }, h("span", { class: "mono" }, d.fecha), h("span", { class: "muted" }, d.motivo))))));
};

views.prospeccion = async (v) => {
  const p = await api("/api/prospecting"); const reload = () => route();
  const NICHOS = [["dentista", "Clínica dental"], ["clinica", "Consultorio médico"], ["estetica_spa", "Estética / spa"], ["veterinaria", "Veterinaria"]];
  const stat = (label, n, cls = "") => h("div", { class: `card kpi ${cls}`, style: "padding:12px" }, h("div", { class: "label" }, label), h("div", { class: "value", style: "font-size:22px" }, n ?? 0));
  const form = h("form", { class: "card", onsubmit: async (e) => {
    e.preventDefault(); const f = e.target;
    const clases = ["A", "B", "C"].filter((c) => f[`c${c}`].checked);
    const fuentes = ["denue", "osm"].filter((s) => f[`f_${s}`].checked);
    const ok = await modal({ title: "Iniciar prospección", text: `Se buscarán negocios en fuentes públicas (${fuentes.join(" + ") || "ninguna"}), se descartarán duplicados y exclusiones, y el investigador del Mac verificará los sitios. Los resultados quedan en revisión: nada se registra ni se envía automáticamente.`, confirm: "Iniciar" });
    if (!ok) return;
    try { const r = await api("/api/prospecting", { nicho: f.nicho.value, estado_mx: f.estado.value, municipio: f.municipio.value, cantidad: +f.cantidad.value,
      criterios: { clases, puntaje_min: +f.min.value, solo_con_sitio: f.sitio.checked }, fuentes });
      toast(`Solicitud #${r.resultado.id}: ${r.resultado.mensaje || r.resultado.estado}`, "ok"); reload(); } catch (err) { toast(err.message, "bad"); }
  } },
    h("h2", {}, "Nueva solicitud"),
    h("div", { class: "grid cols-3" },
      h("label", {}, "Nicho", h("select", { class: "input", name: "nicho", style: "width:100%" }, NICHOS.map(([v, l]) => h("option", { value: v }, l)))),
      h("label", {}, "Estado", h("input", { class: "input", name: "estado", value: "Puebla", required: true, style: "width:100%" })),
      h("label", {}, "Municipio o ciudad", h("input", { class: "input", name: "municipio", value: "Puebla", style: "width:100%" }))),
    h("div", { class: "grid cols-3", style: "margin-top:10px" },
      h("label", {}, "Cantidad objetivo (calificados)", h("input", { class: "input", name: "cantidad", type: "number", min: 1, max: 200, value: 30, style: "width:100%" })),
      h("label", {}, "Puntaje mínimo", h("input", { class: "input", name: "min", type: "number", min: 0, max: 100, value: 50, style: "width:100%" })),
      h("div", {}, h("div", { class: "muted", style: "font-size:12px" }, "Clases aceptadas"), ["A", "B", "C"].map((c) => h("label", { class: "check", style: "display:inline-flex;margin-right:10px" }, h("input", { type: "checkbox", name: `c${c}`, checked: c !== "C" }), c)))),
    h("div", { class: "row", style: "margin-top:10px" },
      h("label", { class: "check" }, h("input", { type: "checkbox", name: "f_denue", checked: true }), `DENUE (INEGI) ${p.denue ? "" : "· sin token"}`),
      h("label", { class: "check" }, h("input", { type: "checkbox", name: "f_osm", checked: true }), "OpenStreetMap (vía investigador)"),
      h("label", { class: "check" }, h("input", { type: "checkbox", name: "sitio" }), "Solo negocios con sitio web")),
    h("div", { class: "row", style: "margin-top:14px;justify-content:space-between" },
      h("span", { class: "faint", style: "font-size:12px" }, p.investigador ? "Investigador habilitado: debe estar corriendo en el Mac (bin/ww investigator)." : "Investigador sin WORKER_TOKEN: los trabajos quedarán pendientes."),
      h("button", { class: "btn primary", type: "submit" }, "Iniciar prospección")));
  v.append(h("div", { class: "page-head" }, h("div", {}, h("h1", {}, "Prospección"), h("p", {}, "Motor de búsqueda e investigación. Objetivo: 30 calificados al día sin sacrificar veracidad."))),
    !p.denue ? h("div", { class: "notice warn", style: "margin-bottom:14px" }, "DENUE no está conectado (falta el secreto DENUE_TOKEN). Puedes usar OpenStreetMap mediante el investigador del Mac.") : null,
    form,
    h("h2", { style: "margin-top:24px" }, "Solicitudes"),
    p.solicitudes.length ? h("div", { class: "stack" }, p.solicitudes.map((r) => h("div", { class: "card" },
      h("div", { class: "row", style: "justify-content:space-between" }, h("div", {}, h("strong", {}, `#${r.id} · ${NICHOS.find((n) => n[0] === r.nicho)?.[1] || r.nicho} · ${r.municipio || r.estado_mx}`), " ",
        h("span", { class: `badge ${r.estado === "completada" ? "ok" : r.estado === "investigando" ? "info" : "warn"}` }, r.estado)), h("span", { class: "faint" }, `${fmtDT(r.creado_en)} · ${r.creado_por}`)),
      h("div", { class: "grid kpis", style: "margin-top:10px;grid-template-columns:repeat(auto-fill,minmax(120px,1fr))" },
        stat("Encontrados", r.encontrados), stat("Duplicados", r.duplicados), stat("Investigados", r.investigados), stat("Descartados", r.descartados),
        stat("Calificados", r.calificados, "accent"), stat("En revisión", r.en_revision), stat("Trabajos pendientes", (r.trabajos.pendiente || 0) + (r.trabajos.en_proceso || 0))),
      r.mensaje ? h("p", { class: "faint", style: "font-size:12px;margin:10px 0 0" }, r.mensaje) : null)))
      : h("div", { class: "card empty" }, "Todavía no hay solicitudes."));
};

// ---------------------------------------------------------------- router
const TITLES = { hoy: "Hoy", prospeccion: "Buscar negocios", dashboard: "Rendimiento", prospectos: "Prospectos", pipeline: "Pipeline", investigacion: "Investigación", mensajes: "Aprobar mensajes", seguimientos: "Seguimientos", reportes: "Rendimiento", configuracion: "Configuración" };
let LAST_ROUTE = "", VIEW_KEYDOWN = null;  // atajos de la vista activa; se limpian al cambiar de pantalla
function setMenu(open) {
  $("#sidebar").classList.toggle("open", open); $("#scrim").hidden = !open;
  $("#menu-btn").setAttribute("aria-expanded", String(open));
}
async function route() {
  const [pathPart, qs = ""] = location.hash.replace(/^#\/?/, "#/").split("?");
  const [, name = "hoy", param] = (pathPart.match(/^#\/([^/]*)\/?(.*)$/) || []);
  const key = views[name] ? name : "hoy";
  const navKey = key === "reportes" ? "dashboard" : key;
  document.querySelectorAll("#nav a").forEach((a) => { const on = a.dataset.route === navKey; a.classList.toggle("active", on); on ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current"); });
  $("#page-title").textContent = TITLES[key]; document.title = `${TITLES[key]} · Web Wizards Sales OS`; setMenu(false);
  const changed = location.hash !== LAST_ROUTE; LAST_ROUTE = location.hash; VIEW_KEYDOWN = null;
  const v = $("#view"); v.replaceChildren(skeleton());
  try {
    const box = h("div"); const add = box.append.bind(box);
    box.append = (...kids) => add(...kids.flat(Infinity).filter((x) => x != null && x !== false));  // nunca "null" en pantalla
    await views[key](box, param ? decodeURIComponent(param) : null, new URLSearchParams(qs)); v.replaceChildren(box);
    // Al cambiar de pantalla, el foco va al título (lectores de pantalla y teclado); en recargas de la misma vista no se mueve.
    if (changed) { const h1 = v.querySelector("h1"); if (h1) { h1.setAttribute("tabindex", "-1"); h1.focus({ preventScroll: true }); } window.scrollTo(0, 0); }
  }
  catch (e) { v.replaceChildren(h("div", { class: "card" }, h("h2", {}, "No se pudo cargar esta sección"), h("p", { class: "muted" }, e.message), h("button", { class: "btn", onclick: route }, "Reintentar"))); }
  refreshCounts();
}

// ---------------------------------------------------------------- búsqueda global ( / o Ctrl/⌘ K )
let SEARCH_CACHE = null, SEARCH_AT = 0;
const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
async function openSearch() {
  if ($("#palette")) return;
  const opener = document.activeElement;
  const input = h("input", { class: "palette-input", id: "palette-q", type: "search", placeholder: "Nombre, ciudad, teléfono, WhatsApp, correo o ID…", autocomplete: "off",
    role: "combobox", "aria-expanded": "true", "aria-controls": "palette-list", "aria-label": "Buscar prospecto" });
  const list = h("ul", { class: "palette-list", id: "palette-list", role: "listbox", "aria-label": "Resultados" });
  const status = h("div", { class: "palette-foot" }, "Cargando prospectos…");
  const back = h("div", { class: "modal-back palette-back", id: "palette", onclick: (e) => e.target === back && close() },
    h("div", { class: "palette", role: "dialog", "aria-modal": "true", "aria-label": "Buscar prospecto" },
      h("div", { class: "palette-head" }, icon("search"), input, h("kbd", {}, "Esc")), list, status));
  let items = [], sel = 0;
  function close() { back.remove(); document.removeEventListener("keydown", onKey, true); if (opener?.focus) opener.focus(); }
  function go(i) { const it = items[i]; if (!it) return; close(); location.hash = it.href; }
  function paint() {
    list.replaceChildren(...items.map((it, i) => h("li", { role: "option", id: `pal-${i}`, "aria-selected": String(i === sel), class: i === sel ? "on" : "",
      onmousemove: () => { if (sel !== i) { sel = i; paint(); } }, onclick: () => go(i) },
      it.badge || h("span", { class: "pal-ico" }, icon(it.icon || "arrow")), h("span", { class: "pal-main" }, h("strong", {}, it.title), it.sub ? h("small", {}, it.sub) : null),
      it.right ? h("span", { class: "pal-right" }, it.right) : null)));
    input.setAttribute("aria-activedescendant", items[sel] ? `pal-${sel}` : "");
    list.querySelector(".on")?.scrollIntoView?.({ block: "nearest" });
  }
  function search() {
    const q = norm(input.value.trim()); const leads = SEARCH_CACHE || [];
    const pages = Object.entries(TITLES).filter(([k]) => k !== "prospeccion" || isWorker()).filter(([, t]) => !q || norm(t).includes(q))
      .map(([k, t]) => ({ title: `Ir a ${t}`, href: `#/${k}`, icon: "arrow", sub: null }));
    const hits = !q ? [] : leads.filter((L) => norm([L.nombre_negocio, L.ciudad, L.lead_id, L.telefono_publico, L.whatsapp_publico, L.email_publico, L.sitio_web].join(" ")).includes(q)
      || (q.replace(/\D/g, "").length >= 4 && [L.telefono_publico, L.whatsapp_publico].join(" ").replace(/\D/g, "").includes(q.replace(/\D/g, ""))));
    items = [...hits.slice(0, 8).map((L) => ({ title: L.nombre_negocio, sub: [L.ciudad, NICHO[L.nicho] || L.nicho].filter(Boolean).join(" · "), href: `#/prospectos/${L.lead_id}`,
      badge: badgeClass(L.clasificacion), right: STATE_LABEL[L.estado_pipeline] || L.estado_pipeline })), ...pages.slice(0, q ? 3 : 10)];
    sel = 0; paint();
    status.textContent = !SEARCH_CACHE ? "Cargando prospectos…" : q ? (hits.length ? `${hits.length} prospecto(s) · Enter para abrir` : "Ningún prospecto coincide.") : `${leads.length} prospectos · escribe para buscar · ↑↓ para moverte`;
  }
  function onKey(e) {
    if (e.key === "Escape") { e.preventDefault(); close(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); sel = Math.min(items.length - 1, sel + 1); paint(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); sel = Math.max(0, sel - 1); paint(); }
    else if (e.key === "Enter" && document.activeElement === input) { e.preventDefault(); go(sel); }
  }
  input.addEventListener("input", search); document.addEventListener("keydown", onKey, true);
  document.body.append(back); input.focus(); search();
  if (!SEARCH_CACHE || Date.now() - SEARCH_AT > 60000) {
    try { SEARCH_CACHE = (await api("/api/leads")).leads; SEARCH_AT = Date.now(); } catch (e) { status.textContent = `No se pudo cargar: ${e.message}`; return; }
    if ($("#palette")) search();
  }
}
function typingInField(e) { const t = e.target; return t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)); }
async function refreshCounts() {
  try {
    const s = await api("/api/summary");
    $("#c-leads").textContent = s.kpis.registrados; $("#c-review").textContent = s.kpis.en_revision || ""; $("#c-drafts").textContent = s.kpis.pendientes_aprobacion || "";
    const t = await api("/api/today"); const n = t.acciones.length + t.seguimientos.length + t.por_enviar.length + t.sin_accion.length; $("#c-today").textContent = n || "";
  } catch {}
}
let LISTENERS = false;
async function init() {
  const r = await fetch("/api/session");
  if (r.status === 401) return renderLogin();
  SESSION = await r.json();
  const p = await api("/api/pipeline"); FINALS = p.finales;
  if (p.con_seguimiento) NEEDS_DATE = new Set(p.con_seguimiento);  // la fuente es el esquema (x-estados-con-seguimiento)
  const demo = SESSION.entorno === "demo";
  $("#env-badge").textContent = demo ? "DEMO" : "CRM real"; $("#env-badge").className = `badge ${demo ? "warn" : "ok"}`;
  if (demo) $("#banner").replaceChildren(h("div", { class: "banner demo" }, "MODO DEMOSTRACIÓN · datos ficticios en demo/ · no son prospectos reales"));
  if (isWorker()) {
    $("#who-name").textContent = SESSION.nombre; $("#who-btn").setAttribute("disabled", ""); $("#who-btn").title = "Usuario de la sesión";
    $("#logout-btn").removeAttribute("hidden"); $("#nav-prospeccion").removeAttribute("hidden");
  } else setWho(who());
  if (!LISTENERS) {
    LISTENERS = true;
    $("#who-btn").addEventListener("click", () => !isWorker() && askName());
    $("#logout-btn").addEventListener("click", async () => { try { await api("/api/logout", {}); } catch {} location.hash = ""; renderLogin("Sesión cerrada."); });
    $("#menu-btn").addEventListener("click", () => setMenu(!$("#sidebar").classList.contains("open")));
    $("#scrim").addEventListener("click", () => setMenu(false));
    $("#search-btn").addEventListener("click", openSearch);
    document.addEventListener("keydown", (e) => {
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) { e.preventDefault(); openSearch(); }
      else if (e.key === "/" && !typingInField(e) && !$(".modal-back")) { e.preventDefault(); openSearch(); }
      else if (e.key === "Escape" && $("#sidebar").classList.contains("open")) setMenu(false);
      else if (VIEW_KEYDOWN && !e.metaKey && !e.ctrlKey && !e.altKey && !typingInField(e) && !$(".modal-back")) VIEW_KEYDOWN(e);
    });
    window.addEventListener("hashchange", route);
  }
  route();
}
init().catch((e) => { $("#view").replaceChildren(h("div", { class: "card" }, h("h2", {}, "No se pudo conectar con el servidor local"), h("p", { class: "muted" }, `${e.message}. Inicia el sistema con: python3 app/server.py`))); });
