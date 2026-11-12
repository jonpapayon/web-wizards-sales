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
    h("div", { class: "brand", style: "padding:0 0 12px" }, h("div", { class: "logo" }, "✦"), h("div", {}, "Web Wizards", h("small", {}, "Sales OS"))),
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
function stateEl(s) {
  return h("span", { class: `state ${FINALS.includes(s) ? "final" : ""} ${s === "no_contactar" ? "blocked" : ""}` }, STATE_LABEL[s] || s);
}
function skeleton(n = 4) { return h("div", { class: "grid kpis" }, Array.from({ length: n }, () => h("div", { class: "skeleton" }))); }

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
    const close = (v) => { back.remove(); resolve(v); };
    const body = h("div", {},
      fields.map((f) => [h("label", { for: `f-${f.name}` }, f.label),
        inputs[f.name] = f.type === "select"
          ? h("select", { class: "input", id: `f-${f.name}` }, f.options.map((o) => h("option", { value: o.value }, o.label)))
          : f.type === "textarea" ? h("textarea", { class: "input", id: `f-${f.name}`, placeholder: f.placeholder || "" })
          : h("input", { class: "input", id: `f-${f.name}`, type: f.type || "text", placeholder: f.placeholder || "", value: f.value || "" })]),
      checks.map((c, k) => h("label", { class: "check" }, inputs[`chk${k}`] = h("input", { type: "checkbox" }), c)));
    const ok = h("button", { class: `btn ${danger ? "danger" : "primary"}`, onclick: () => {
      const vals = {}; for (const f of fields) { vals[f.name] = inputs[f.name].value.trim(); if (f.required && !vals[f.name]) { inputs[f.name].focus(); return toast(`Falta: ${f.label}`, "bad"); } }
      for (let k = 0; k < checks.length; k++) if (!inputs[`chk${k}`].checked) return toast("Marca la casilla de confirmación.", "bad");
      close(vals);
    } }, confirm);
    const back = h("div", { class: "modal-back", onclick: (e) => e.target === back && close(null) },
      h("div", { class: "modal", role: "dialog", "aria-modal": "true" }, h("h2", {}, title), text ? h("p", { style: "white-space:pre-line" }, text) : null, body,
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

views.dashboard = async (v) => {
  const s = await api("/api/summary"); const k = s.kpis;
  const pct = Math.min(100, Math.round((100 * s.objetivo.hoy) / s.objetivo.meta));
  const maxAct = Math.max(1, ...s.actividad.map((a) => a.eventos));
  const kpi = (label, value, sub, cls = "") => h("div", { class: `card kpi ${cls}` }, h("div", { class: "label" }, label), h("div", { class: "value" }, value ?? "—"), sub ? h("div", { class: "sub" }, sub) : null);
  v.append(
    h("div", { class: "page-head" }, h("div", {}, h("h1", {}, "Dashboard"), h("p", {}, "Estado comercial con datos del CRM.")),
      h("a", { class: "btn primary", href: "#/investigacion" }, "Revisar candidatos")),
    h("div", { class: "grid kpis" },
      kpi("Investigados", k.investigados, `${k.en_revision} en revisión`, "accent"), kpi("Calificados (A+B)", k.calificados, `${k.registrados} registrados`),
      kpi("Pendientes de aprobación", k.pendientes_aprobacion), kpi("Aprobados", k.aprobados, "listos para uso humano"),
      kpi("Contactados", k.contactados), kpi("Respuestas", k.respuestas, k.tasa_respuesta != null ? `${k.tasa_respuesta}% de contactados` : "sin contactos aún"),
      kpi("Reuniones", k.reuniones), kpi("Clientes cerrados", k.ganados, k.tasa_conversion != null ? `conversión ${k.tasa_conversion}%` : "conversión: sin datos")),
    h("div", { class: "grid cols-2", style: "margin-top:16px" },
      h("div", { class: "card" }, h("h3", {}, "Actividad (14 días)"),
        h("div", { class: "bars" }, s.actividad.map((a) => h("div", { class: "bar", title: `${a.dia}: ${a.eventos} eventos, ${a.calificados} calificados`, style: `height:${(100 * a.eventos) / maxAct}%` },
          h("span", { style: `height:${a.eventos ? (100 * a.calificados) / a.eventos : 0}%` })))),
        h("div", { class: "bars-x" }, s.actividad.map((a) => h("span", {}, a.dia.slice(8))))),
      h("div", { class: "card" }, h("h3", {}, "Objetivo diario"),
        h("div", { class: "goal" }, h("div", { class: "ring", style: `--p:${pct}`, "data-label": `${s.objetivo.hoy}/${s.objetivo.meta}` }),
          h("div", {}, h("div", { style: "font-size:15px;font-weight:600" }, `${s.objetivo.hoy} calificados hoy`),
            h("div", { class: "muted" }, `Meta: ${s.objetivo.meta} prospectos A+B al día.`),
            h("div", { class: "faint", style: "margin-top:6px;font-size:12px" }, "La calidad no se negocia: el CRM rechaza clases que no cuadran con la evidencia."))))),
    h("div", { class: "grid cols-2", style: "margin-top:16px" },
      h("div", { class: "card" }, h("h3", {}, "Por estado"), Object.entries(s.por_estado).sort((a, b) => b[1] - a[1]).map(([st, n]) => hbar(STATE_LABEL[st] || st, n, k.registrados))),
      h("div", { class: "card" }, h("h3", {}, "Actividad reciente"),
        s.recientes.length ? h("ul", { class: "timeline" }, s.recientes.map((e) => h("li", {}, h("div", {}, `${e.evento} · ${e.entidad}`), h("div", { class: "when" }, `${fmtDT(e.ts)} · ${e.actor}`)))) : h("div", { class: "empty" }, "Sin eventos todavía."))));
};
function hbar(label, n, total) {
  return h("div", { class: "hbar" }, h("span", { class: "lbl", title: label }, label), h("div", { class: "track" }, h("div", { class: "fill", style: `width:${total ? (100 * n) / total : 0}%` })), h("span", { class: "n" }, n));
}

views.prospectos = async (v, param) => {
  if (param) return leadDetail(v, param);
  const { leads } = await api("/api/leads");
  let sort = { k: "puntaje_total", dir: -1 };
  const f = { q: "", nicho: "", clase: "", estado: "", ciudad: "" };
  const uniq = (k) => [...new Set(leads.map((L) => L[k]).filter(Boolean))].sort();
  const sel = (key, label, values, map = (x) => x) => h("select", { class: "input", "aria-label": label, onchange: (e) => { f[key] = e.target.value; draw(); } },
    h("option", { value: "" }, label), values.map((x) => h("option", { value: x }, map(x))));
  const body = h("tbody");
  const cols = [["lead_id", "ID"], ["nombre_negocio", "Negocio"], ["nicho", "Nicho"], ["ciudad", "Ciudad"], ["sitio_web", "Sitio web", "hide-sm"],
    ["telefono_publico", "Teléfono", "hide-sm"], ["whatsapp_publico", "WhatsApp", "hide-sm"], ["puntaje_total", "Puntos"], ["clasificacion", "Clase"],
    ["estado_pipeline", "Estado"], ["fecha_registro", "Investigado", "hide-sm"], ["proxima_accion", "Próxima acción", "hide-sm"]];
  const thead = h("thead", {}, h("tr", {}, cols.map(([k, l, c]) => h("th", { class: `sortable ${c || ""}`, onclick: () => { sort = { k, dir: sort.k === k ? -sort.dir : 1 }; draw(); } }, l))));
  function draw() {
    const q = f.q.toLowerCase();
    const list = leads.filter((L) => (!q || [L.lead_id, L.nombre_negocio, L.ciudad, L.telefono_publico, L.sitio_web].join(" ").toLowerCase().includes(q))
      && (!f.nicho || L.nicho === f.nicho) && (!f.clase || L.clasificacion === f.clase) && (!f.estado || L.estado_pipeline === f.estado) && (!f.ciudad || L.ciudad === f.ciudad))
      .sort((a, b) => { const x = a[sort.k], y = b[sort.k]; const n = sort.k === "puntaje_total"; return (n ? (+x - +y) : String(x).localeCompare(String(y))) * sort.dir; });
    body.replaceChildren(...(list.length ? list.map((L) => h("tr", { onclick: () => (location.hash = `#/prospectos/${L.lead_id}`), tabindex: "0", onkeydown: (e) => e.key === "Enter" && (location.hash = `#/prospectos/${L.lead_id}`) },
      h("td", { class: "mono" }, L.lead_id), h("td", {}, h("strong", {}, L.nombre_negocio)), h("td", {}, NICHO[L.nicho] || L.nicho), h("td", {}, L.ciudad),
      h("td", { class: "hide-sm" }, L.sitio_web ? h("a", { href: L.sitio_web, target: "_blank", rel: "noopener noreferrer", onclick: (e) => e.stopPropagation() }, L.sitio_web.replace(/^https?:\/\/(www\.)?/, "").slice(0, 28)) : h("span", { class: "faint" }, "sin sitio")),
      h("td", { class: "hide-sm" }, L.telefono_publico || "—"), h("td", { class: "hide-sm" }, L.whatsapp_publico || "—"), h("td", { class: "num" }, L.puntaje_total),
      h("td", {}, badgeClass(L.clasificacion)), h("td", {}, stateEl(L.estado_pipeline)), h("td", { class: "hide-sm" }, fmtDate(L.fecha_registro)), h("td", { class: "hide-sm muted" }, L.proxima_accion)))
      : [h("tr", {}, h("td", { colspan: cols.length, class: "empty" }, "Ningún prospecto coincide con los filtros."))]));
  }
  v.append(h("div", { class: "page-head" }, h("div", {}, h("h1", {}, "Prospectos"), h("p", {}, `${leads.length} registrados en el CRM.`)),
      h("div", { class: "row" },
        h("button", { class: "btn primary", onclick: () => newProspect() }, "Nuevo prospecto"),
        h("button", { class: "btn", onclick: () => importCsv() }, "Importar CSV"),
        h("button", { class: "btn", onclick: () => downloadTemplate() }, "Plantilla CSV"),
        h("a", { class: "btn", href: "/api/export/leads.csv", download: "leads.csv" }, "Descargar CSV"))),
    h("div", { class: "toolbar" }, h("input", { class: "input search", placeholder: "Buscar por nombre, ID, ciudad, teléfono…", oninput: (e) => { f.q = e.target.value; draw(); } }),
      sel("nicho", "Nicho", uniq("nicho"), (x) => NICHO[x] || x), sel("clase", "Clase", ["A", "B", "C", "descartado"]),
      sel("estado", "Estado", uniq("estado_pipeline"), (x) => STATE_LABEL[x] || x), sel("ciudad", "Ciudad", uniq("ciudad"))),
    h("div", { class: "card flat" }, h("div", { class: "table-wrap" }, h("table", {}, thead, body))));
  draw();
};

async function leadDetail(v, id) {
  const d = await api(`/api/leads/${id}`); const L = d.lead;
  const reload = () => route();
  const tabs = ["Resumen", "Investigación", "Mensajes", "Historial"]; let tab = "Resumen";
  const pane = h("div");
  const tabBar = h("div", { class: "tabs", role: "tablist" }, tabs.map((t) => h("button", { role: "tab", class: t === tab ? "active" : "", onclick: (e) => { tab = t; [...tabBar.children].forEach((b) => b.classList.toggle("active", b === e.target)); drawTab(); } }, t)));
  const kv = (pairs) => h("dl", { class: "kv" }, pairs.filter(([, val]) => val !== undefined).map(([k, val]) => [h("dt", {}, k), h("dd", {}, val || h("span", { class: "faint" }, "no encontrado"))]));
  function drawTab() {
    pane.replaceChildren();
    if (tab === "Resumen") pane.append(h("div", { class: "grid cols-2" },
      h("div", { class: "card" }, h("h3", {}, "Datos verificados"), kv([["Negocio", L.nombre_negocio], ["Nicho", NICHO[L.nicho] || L.nicho], ["Ciudad", `${L.ciudad}, ${L.estado_mx}`], ["Dirección", L.direccion],
        ["Sitio web", L.sitio_web ? h("a", { href: L.sitio_web, target: "_blank", rel: "noopener noreferrer" }, L.sitio_web) : ""], ["Teléfono", L.telefono_publico], ["WhatsApp", L.whatsapp_publico], ["Email", L.email_publico],
        ["Fuente", h("span", {}, `${L.fuente} · `, h("a", { href: L.fuente_url, target: "_blank", rel: "noopener noreferrer" }, "ver"), ` · ${L.fecha_fuente}`)], ["Notas", L.notas]])),
      h("div", { class: "card" }, h("h3", {}, "Calificación"), kv([["Puntaje", scoreLine(L)],
        ["Clase", badgeClass(L.clasificacion)], ["Motivo", L.motivo_clasificacion], ["Señales", L.senales_oportunidad.split(";").filter(Boolean).map((x) => h("span", { class: "badge accent", style: "margin:0 4px 4px 0" }, x))],
        ["Servicio propuesto", L.servicio_recomendado.replaceAll(";", ", ")], ["Canal preferido", L.canal_preferido], ["Estado", stateEl(L.estado_pipeline)], ["Aprobación", L.aprobacion_estado + (L.aprobado_por ? ` · ${L.aprobado_por}` : "")],
        ["Próxima acción", d.proxima_accion]]))),
      h("div", { class: "card", style: "margin-top:16px" }, h("h3", {}, "Seguimiento comercial"), kv([
        ["Próxima acción", L.proxima_accion ? `${L.proxima_accion}${L.proximo_seguimiento ? ` · ${L.proximo_seguimiento}` : ""}` : (NEEDS_DATE.has(L.estado_pipeline) ? h("span", { class: "badge bad" }, "Falta definirla") : "")],
        ["Demostración", L.fecha_demo || h("span", { class: "faint" }, "Sin registrar")],
        ["Propuesta", L.fecha_propuesta ? [L.fecha_propuesta, L.monto_implementacion ? ` · implementación $${L.monto_implementacion}` : "", L.monto_mensual ? ` · mensual $${L.monto_mensual}` : ""].join("") : h("span", { class: "faint" }, "Sin registrar")],
        ["Motivo de pérdida", L.motivo_perdida ? MOTIVO[L.motivo_perdida] || L.motivo_perdida : undefined]])));
    if (tab === "Investigación") pane.append(evidenceCard(d.evidencia, L), h("div", { class: "card", style: "margin-top:16px" }, h("h3", {}, "Dossier"), d.dossier ? md(d.dossier) : h("div", { class: "empty" }, "Sin dossier.")));
    if (tab === "Mensajes") pane.append(d.borradores.length ? h("div", { class: "stack" }, d.borradores.map((b) => draftCard(b, L, reload, true))) : h("div", { class: "card empty" }, "Sin borradores para este prospecto."));
    if (tab === "Historial") pane.append(h("div", { class: "grid cols-2" },
      h("div", { class: "card" }, h("h3", {}, "Interacciones"), d.interacciones.length ? h("ul", { class: "timeline" }, d.interacciones.slice().reverse().map((i) => h("li", {}, h("div", {}, `${i.tipo} · ${i.resumen}`), h("div", { class: "when" }, `${fmtDT(i.fecha_hora)} · ${i.canal} · ${i.registrado_por}`)))) : h("div", { class: "empty" }, "Sin interacciones.")),
      h("div", { class: "card" }, h("h3", {}, "Auditoría"), d.auditoria.length ? h("ul", { class: "timeline" }, d.auditoria.slice().reverse().map((e) => h("li", {}, h("div", {}, e.evento), h("div", { class: "when" }, `${fmtDT(e.ts)} · ${e.actor}`)))) : h("div", { class: "empty" }, "Sin eventos auditados."))));
  }
  const actions = d.bloqueado ? h("div", { class: "notice bad" }, "Dado de baja / no contactar. El sistema impide cualquier cambio o reactivación.")
    : h("div", { class: "row" }, transitionSelect(L, d.transiciones, reload),
      L.estado_pipeline === "pendiente_aprobacion" ? [h("button", { class: "btn primary", onclick: () => approveLead(L, reload) }, "Aprobar para uso humano"), h("button", { class: "btn", onclick: () => requestChanges(L, reload) }, "Pedir cambios")] : null,
      FINALS.includes(L.estado_pipeline) ? null : h("button", { class: "btn", onclick: () => editNext(L, reload) }, "Próxima acción"),
      h("button", { class: "btn", onclick: () => logInteraction(L, reload) }, "Registrar interacción"),
      h("button", { class: "btn danger", onclick: () => optOut(L, reload) }, "Registrar baja"));
  v.append(h("div", { class: "page-head" }, h("div", {}, h("a", { href: "#/prospectos", class: "muted" }, "← Prospectos"), h("h1", {}, L.nombre_negocio),
    h("p", { class: "row" }, h("span", { class: "mono" }, L.lead_id), badgeClass(L.clasificacion), stateEl(L.estado_pipeline))), actions), tabBar, pane);
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

views.pipeline = async (v) => {
  const p = await api("/api/pipeline"); FINALS = p.finales;
  const by = Object.fromEntries(p.estados.map((s) => [s, []])); p.leads.forEach((L) => by[L.estado_pipeline]?.push(L));
  const reload = () => route();
  v.append(h("div", { class: "page-head" }, h("div", {}, h("h1", {}, "Pipeline"), h("p", {}, "Solo se ofrecen las transiciones válidas del esquema. Las bajas se registran desde la ficha del prospecto."))),
    h("div", { class: "kanban" }, p.estados.map((st) => h("section", { class: `col ${p.finales.includes(st) ? "final" : ""}`, "aria-label": STATE_LABEL[st] },
      h("div", { class: "col-head" }, h("span", {}, STATE_LABEL[st]), h("span", { class: "n" }, by[st].length)),
      h("div", { class: "col-body" }, by[st].length ? by[st].map((L) => h("article", { class: "kcard" },
        h("div", { class: "t", onclick: () => (location.hash = `#/prospectos/${L.lead_id}`) }, L.nombre_negocio),
        h("div", { class: "meta" }, badgeClass(L.clasificacion), h("span", {}, `${L.puntaje_total} pts`), h("span", {}, L.ciudad)),
        h("div", { class: "faint", style: "font-size:12px;margin-top:4px" }, L.proxima_accion),
        L.opt_out === "true" ? null : transitionSelect(L, p.transiciones[st] || [], reload))) : h("div", { class: "faint", style: "font-size:12px;padding:6px" }, "Vacío"))))));
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
        h("span", { class: "badge info" }, b.meta.canal || "—"), " ", h("span", { class: "badge neutral" }, `envío: ${b.meta.envio || "manual"}`), " ",
        isRef ? h("span", { class: "badge neutral" }, "solo referencia (clase C)") : h("span", { class: `badge ${L?.aprobacion_estado === "aprobado" ? "ok" : "warn"}` }, `aprobación: ${L?.aprobacion_estado || "—"}`), " ",
        h("span", { class: `badge ${comp.startsWith("aprobado") ? "ok" : comp.startsWith("bloq") ? "bad" : "warn"}` }, `cumplimiento: ${comp || "—"}`)),
      h("div", { class: "row" }, h("button", { class: "btn", onclick: async () => { try { await navigator.clipboard.writeText(copyText); toast("Mensaje copiado. Recuerda: lo envía una persona.", "ok"); } catch { toast("No se pudo copiar automáticamente; selecciona el texto.", "bad"); } } }, "Copiar"),
        !isRef && L?.estado_pipeline === "pendiente_aprobacion" ? [h("button", { class: "btn primary", onclick: () => approveLead(L, reload) }, "Aprobar para uso humano"), h("button", { class: "btn", onclick: () => requestChanges(L, reload) }, "Pedir cambios")] : null)),
    b.aviso ? h("div", { style: "margin-top:12px" }, md(b.aviso)) : null,
    b.asunto ? h("div", { class: "muted", style: "margin-top:12px" }, h("strong", {}, "Asunto: "), b.asunto) : null,
    h("div", { class: "message", style: "margin-top:10px" }, b.mensaje || "(sin mensaje)"),
    h("details", { style: "margin-top:12px" }, h("summary", {}, "Justificación y trazabilidad"), md(b.trazabilidad), b.notas ? [h("h3", { style: "margin-top:12px" }, "Notas para quien aprueba"), md(b.notas)] : null),
    b.cumplimiento ? h("details", { style: "margin-top:8px" }, h("summary", {}, "Observaciones de cumplimiento"), md(b.cumplimiento)) : null,
    b.historial ? h("details", { style: "margin-top:8px" }, h("summary", {}, "Historial del borrador"), md(b.historial)) : null);
}

views.mensajes = async (v) => {
  const { borradores } = await api("/api/drafts"); const reload = () => route();
  v.append(h("div", { class: "page-head" }, h("div", {}, h("h1", {}, "Mensajes"), h("p", {}, "Borradores personalizados. Copiar y aprobar nunca envía nada."))),
    h("div", { class: "notice safe", style: "margin-bottom:16px" }, "Aprobar marca el borrador como listo para que una persona lo envíe desde su propia cuenta, el día hábil indicado. No hay ningún mecanismo de envío conectado."),
    borradores.length ? h("div", { class: "stack" }, borradores.map((b) => draftCard(b, b.lead, reload))) : h("div", { class: "card empty" }, "No hay borradores."));
};

views.hoy = async (v) => {
  const t = await api("/api/today"); const reload = () => route();
  const go = (id) => () => (location.hash = `#/prospectos/${id}`);
  const list = (title, items, sub, empty, cls = "") => h("div", { class: "card" }, h("h3", {}, `${title} (${items.length})`),
    items.length ? h("div", { class: "stack" }, items.map((x) => h("div", { class: "row", style: "justify-content:space-between;border-bottom:1px solid var(--border);padding:8px 0;cursor:pointer", onclick: go(x.lead_id) },
      h("div", {}, h("strong", {}, x.nombre_negocio || x.negocio), " ", x.estado_pipeline ? stateEl(x.estado_pipeline) : null, h("div", { class: "faint", style: "font-size:12px" }, sub(x))),
      x.vencido ? h("span", { class: "badge bad" }, "vencido") : cls && x.fecha ? h("span", { class: `badge ${cls}` }, x.fecha) : null)))
      : h("div", { class: "empty" }, empty));
  const total = t.acciones.length + t.seguimientos.length + t.por_enviar.length + t.por_aprobar.length + t.sin_accion.length;
  v.append(h("div", { class: "page-head" }, h("div", {}, h("h1", {}, `Hoy · ${t.hoy}`), h("p", {}, total ? "Lo que toca hacer hoy. Cada prospecto activo debe tener una próxima acción con fecha." : "Nada pendiente para hoy."))),
    h("div", { class: "grid cols-2" },
      list("Acciones de hoy y vencidas", t.acciones, (x) => `${x.accion || "Sin acción"} · ${x.fecha}`, "Ninguna acción para hoy."),
      list("Seguimientos que tocan hoy", t.seguimientos, (f) => `FU${f.numero_seguimiento} por ${f.canal} · ${f.fecha_programada}`, "Ningún seguimiento para hoy.")),
    h("div", { class: "grid cols-3", style: "margin-top:16px" },
      list("Aprobados por enviar (persona)", t.por_enviar, (x) => `Canal: ${x.canal_preferido || "—"} · revisa las condiciones del borrador antes de enviar`, "Ninguno.", "ok"),
      list("Pendientes de tu aprobación", t.por_aprobar, (x) => `Clase ${x.clasificacion} · ${x.puntaje_total} pts`, "Ninguno.", "warn"),
      list("Activos sin próxima acción", t.sin_accion, () => "Define qué sigue y cuándo", "Todos tienen próxima acción.", "bad")),
    h("div", { class: "card", style: "margin-top:16px" }, h("h3", {}, `Próximos 7 días (${t.proximos.length})`),
      t.proximos.length ? h("div", { class: "table-wrap" }, h("table", {}, h("thead", {}, h("tr", {}, ["Fecha", "Prospecto", "Estado", "Acción"].map((c) => h("th", {}, c)))),
        h("tbody", {}, t.proximos.map((x) => h("tr", { onclick: go(x.lead_id) }, h("td", {}, x.fecha), h("td", {}, x.nombre_negocio), h("td", {}, stateEl(x.estado_pipeline)), h("td", { class: "muted" }, x.accion))))))
        : h("div", { class: "empty" }, "Nada programado en los próximos 7 días.")));
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

views.reportes = async (v) => {
  const r = await api("/api/reports");
  const groupCard = (title, g) => { const tot = Object.values(g).reduce((a, x) => a + x.total, 0);
    return h("div", { class: "card" }, h("h3", {}, title), Object.keys(g).length ? Object.entries(g).sort((a, b) => b[1].total - a[1].total).map(([k, x]) => [hbar(NICHO[k] || k, x.total, tot),
      h("div", { class: "faint", style: "font-size:11px;margin:-4px 0 6px 150px" }, `A ${x.A} · B ${x.B} · C ${x.C} · desc. ${x.descartado} · calificación ${x.total ? Math.round((100 * (x.A + x.B)) / x.total) : 0}%`)]) : h("div", { class: "empty" }, "Sin datos.")); };
  const maxF = Math.max(1, ...r.embudo.map((e) => e.leads));
  const conf = r.calidad_evidencia; const totC = Object.values(conf).reduce((a, b) => a + b, 0);
  v.append(h("div", { class: "page-head" }, h("div", {}, h("h1", {}, "Reportes"), h("p", {}, "Calculados en vivo desde el CRM y la auditoría.")),
      h("button", { class: "btn", onclick: async () => { try { const x = await api("/api/export", {}); toast(`Exportado en ${x.resultado.exportado}`, "ok"); } catch (e) { toast(e.message, "bad"); } } }, "Exportar CRM")),
    h("div", { class: "grid cols-3" }, groupCard("Prospectos por nicho", r.por_nicho), groupCard("Prospectos por ciudad", r.por_ciudad), groupCard("Fuentes más productivas", r.por_fuente)),
    h("div", { class: "grid cols-2", style: "margin-top:16px" },
      h("div", { class: "card" }, h("h3", {}, "Conversión por etapa (leads que alcanzaron cada etapa)"), r.embudo.map((e) => hbar(STATE_LABEL[e.etapa], e.leads, maxF))),
      h("div", { class: "card" }, h("h3", {}, "Calidad de investigación"),
        h("p", { class: "muted" }, `${totC} evidencias registradas.`), ["alta", "media", "baja"].map((c) => hbar(`Confianza ${c}`, conf[c] || 0, totC)),
        h("h3", { style: "margin-top:14px" }, "Datos no encontrados más frecuentes"), Object.entries(r.campos_no_encontrados).sort((a, b) => b[1] - a[1]).map(([k, n]) => hbar(k, n, Object.keys(r.por_nicho).length ? Object.values(r.por_nicho).reduce((a, x) => a + x.total, 0) : 1)),
        h("p", { class: "faint", style: "font-size:12px;margin-top:12px" }, `Tiempo de investigación: ${r.tiempo_investigacion}`))),
    h("div", { class: "grid cols-2", style: "margin-top:16px" },
      h("div", { class: "card" }, h("h3", {}, "Rendimiento diario (registrados)"), Object.entries(r.diario).map(([d, n]) => hbar(d, n, Math.max(...Object.values(r.diario), 1)))),
      h("div", { class: "card" }, h("h3", {}, "Rendimiento semanal"), Object.entries(r.semanal).map(([w, n]) => hbar(w, n, Math.max(...Object.values(r.semanal), 1))),
        h("p", { class: "faint", style: "font-size:12px" }, `Revisión: ${r.revision.pendientes} pendientes · ${r.revision.rechazados} rechazados.`))));
};

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
const TITLES = { hoy: "Hoy", prospeccion: "Prospección", dashboard: "Dashboard", prospectos: "Prospectos", pipeline: "Pipeline", investigacion: "Investigación", mensajes: "Mensajes", seguimientos: "Seguimientos", reportes: "Reportes", configuracion: "Configuración" };
async function route() {
  const [, name = "dashboard", param] = (location.hash.replace(/^#\/?/, "#/").match(/^#\/([^/]*)\/?(.*)$/) || []);
  const key = views[name] ? name : "dashboard";
  document.querySelectorAll("#nav a").forEach((a) => a.classList.toggle("active", a.dataset.route === key));
  $("#page-title").textContent = TITLES[key]; $("#sidebar").classList.remove("open");
  const v = $("#view"); v.replaceChildren(skeleton());
  try {
    const box = h("div"); const add = box.append.bind(box);
    box.append = (...kids) => add(...kids.flat(Infinity).filter((x) => x != null && x !== false));  // nunca "null" en pantalla
    await views[key](box, param ? decodeURIComponent(param) : null); v.replaceChildren(box);
  }
  catch (e) { v.replaceChildren(h("div", { class: "card" }, h("h2", {}, "No se pudo cargar esta sección"), h("p", { class: "muted" }, e.message), h("button", { class: "btn", onclick: route }, "Reintentar"))); }
  refreshCounts();
}
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
    $("#menu-btn").addEventListener("click", () => $("#sidebar").classList.toggle("open"));
    window.addEventListener("hashchange", route);
  }
  route();
}
init().catch((e) => { $("#view").replaceChildren(h("div", { class: "card" }, h("h2", {}, "No se pudo conectar con el servidor local"), h("p", { class: "muted" }, `${e.message}. Inicia el sistema con: python3 app/server.py`))); });
