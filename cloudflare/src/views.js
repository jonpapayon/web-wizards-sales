// Vistas de lectura. Devuelven las mismas formas que app/server.py para que la interfaz funcione con ambos backends.
import { all, first, docsFor, latestDoc } from "./db.js";
import { FINALS, TRANSITIONS, STATES, HEADERS, SCHEMA, nowIso, todayIso, mxHolidays } from "./rules.js";
import { candidateChecks, isBlocked } from "./crm.js";

const NEXT = { calificado: "Preparar borrador", mensaje_borrador: "Revisión de cumplimiento", pendiente_aprobacion: "Aprobar o pedir cambios",
  aprobado: "Enviar (persona) y registrar envío", contactado: "Seguimiento", en_conversacion: "Responder", interesado: "Proponer demostración",
  reunion_agendada: "Hacer la demostración", demo_realizada: "Enviar propuesta", propuesta_enviada: "Dar seguimiento a propuesta",
  negociacion: "Cerrar condiciones", pausado: "Retomar en la fecha pedida" };
export const ACTIVE = new Set(SCHEMA["x-estados-con-seguimiento"]);
export function nextAction(L) {
  if (FINALS.includes(L.estado_pipeline)) return "—";
  if (L.estado_pipeline === "calificado" && L.clasificacion === "C") return "Sin mensaje (clase C)";
  const a = L.proxima_accion || NEXT[L.estado_pipeline] || "—";  // la acción concreta capturada por una persona tiene prioridad
  return L.proximo_seguimiento ? `${a} · ${L.proximo_seguimiento}` : a;
}
const S = (v) => (v == null ? "" : String(v));
export function leadSummary(L) {
  const keys = ["lead_id", "nombre_negocio", "nicho", "subnicho", "ciudad", "estado_mx", "sitio_web", "telefono_publico", "whatsapp_publico", "email_publico",
    "puntaje_total", "clasificacion", "estado_pipeline", "fecha_registro", "fecha_fuente", "proximo_seguimiento", "aprobacion_estado", "fuente", "opt_out", "canal_preferido",
    "motivo_perdida", "fecha_demo", "fecha_propuesta", "monto_implementacion", "monto_mensual"];
  return { ...Object.fromEntries(keys.map((k) => [k, S(L[k])])), proxima_accion: nextAction(L) };
}
const counter = (arr, f) => arr.reduce((m, x) => ((m[f(x)] = (m[f(x)] || 0) + 1), m), {});
const parseAudit = (r) => ({ ts: r.ts, evento: r.evento, actor: r.actor, entidad: r.entidad, entorno: r.entorno, detalle: JSON.parse(r.detalle || "{}") });

export async function settingsConfig(env) {
  const r = await first(env, "SELECT valor FROM settings WHERE clave='sales_os'");
  return r ? JSON.parse(r.valor) : { objetivo_diario_calificados: 30, nichos: [], ciudades: [] };
}

export async function summary(env) {
  const leads = await all(env, "SELECT * FROM leads");
  const ints = await all(env, "SELECT lead_id, direccion, tipo FROM interactions");
  const ab = leads.filter((L) => ["A", "B"].includes(L.clasificacion));
  const contactedStates = new Set([...ACTIVE, "ganado", "perdido"]);
  const contactados = leads.filter((L) => L.fecha_primer_contacto || contactedStates.has(L.estado_pipeline));
  const respuestas = ints.filter((i) => i.direccion === "entrante");
  const reuniones = new Set([...leads.filter((L) => ["reunion_agendada", "demo_realizada", "propuesta_enviada", "negociacion", "ganado"].includes(L.estado_pipeline)).map((L) => L.lead_id),
    ...ints.filter((i) => i.tipo === "reunion").map((i) => i.lead_id)]);
  const ganados = leads.filter((L) => L.estado_pipeline === "ganado");
  const cands = await all(env, "SELECT estado, COUNT(*) n FROM candidates GROUP BY estado");
  const cc = Object.fromEntries(cands.map((c) => [c.estado, c.n]));
  const days = Array.from({ length: 14 }, (_, i) => new Date(Date.now() - (13 - i) * 864e5)).map((d) => nowIso(d).slice(0, 10));
  const act = await all(env, "SELECT substr(ts,1,10) d, COUNT(*) n FROM audit_log WHERE ts >= ? GROUP BY d", days[0]);
  const actMap = Object.fromEntries(act.map((a) => [a.d, a.n]));
  const cfg = await settingsConfig(env);
  const today = todayIso();
  return {
    entorno: env.WW_ENTORNO || "real",
    kpis: { investigados: leads.length + (cc.revision || 0) + (cc.rechazado || 0), registrados: leads.length, calificados: ab.length,
      aprobados: leads.filter((L) => L.aprobacion_estado === "aprobado").length, pendientes_aprobacion: leads.filter((L) => L.estado_pipeline === "pendiente_aprobacion").length,
      contactados: contactados.length, respuestas: respuestas.length, reuniones: reuniones.size, ganados: ganados.length, en_revision: cc.revision || 0,
      tasa_conversion: contactados.length ? Math.round((1000 * ganados.length) / contactados.length) / 10 : null,
      tasa_respuesta: contactados.length ? Math.round((1000 * new Set(respuestas.map((i) => i.lead_id)).size) / contactados.length) / 10 : null },
    objetivo: { meta: cfg.objetivo_diario_calificados || 30, hoy: ab.filter((L) => L.fecha_registro.slice(0, 10) === today).length },
    por_estado: counter(leads, (L) => L.estado_pipeline), por_clase: counter(leads, (L) => L.clasificacion),
    actividad: days.map((d) => ({ dia: d, eventos: actMap[d] || 0, calificados: ab.filter((L) => L.fecha_registro.slice(0, 10) === d).length })),
    recientes: (await all(env, "SELECT * FROM audit_log ORDER BY id DESC LIMIT 12")).map(parseAudit),
  };
}

export function parseDraft(doc) {
  const text = doc.content; let meta = {}, body = text;
  const m = text.match(/^---\n([\s\S]*?)\n---\n?/);
  if (m) { body = text.slice(m[0].length); for (const line of m[1].split("\n")) { const i = line.indexOf(":"); if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^"|"$/g, ""); } }
  const secs = {}; let cur = "_intro", buf = [];
  for (const line of body.split("\n")) { if (line.startsWith("## ")) { secs[cur] = buf.join("\n").trim(); cur = line.slice(3).trim(); buf = []; } else buf.push(line); }
  secs[cur] = buf.join("\n").trim();
  const comp = Object.keys(secs).reverse().find((k) => k.startsWith("Revisión de cumplimiento"));
  return { archivo: doc.path, lead_id: meta.lead_id || doc.lead_id, meta, version: doc.version, asunto: secs["Asunto (solo email)"] || "", mensaje: secs["Mensaje"] || "",
    variante_b: secs["Variante B (opcional, otro gancho)"] || "", trazabilidad: secs["Trazabilidad"] || "", notas: secs["Notas para quien aprueba"] || "",
    cumplimiento: comp ? secs[comp] : "", historial: secs["Historial"] || "", aviso: secs._intro || "", markdown: body };
}

export async function leadDetail(env, id, L) {
  const ev = await latestDoc(env, `data/research/${id}.evidence.json`);
  const dossier = await latestDoc(env, L.evidencias);
  return { lead: L, proxima_accion: nextAction(L), transiciones: TRANSITIONS[L.estado_pipeline] || [], bloqueado: await isBlocked(env, L),
    interacciones: await all(env, "SELECT * FROM interactions WHERE lead_id=? ORDER BY fecha_hora", id),
    seguimientos: await all(env, "SELECT * FROM followups WHERE lead_id=? ORDER BY fecha_programada", id),
    dossier: dossier?.content || null, evidencia: ev ? JSON.parse(ev.content) : null,
    borradores: (await docsFor(env, id, "borrador")).map(parseDraft),
    auditoria: (await all(env, "SELECT * FROM audit_log WHERE entidad LIKE ? ORDER BY id", `%${id}%`)).map(parseAudit),
    fuentes_oficiales: await all(env, "SELECT * FROM lead_sources WHERE lead_id=?", id) };
}

export async function drafts(env) {
  const docs = await all(env, `SELECT d.* FROM documents d JOIN (SELECT path, MAX(version) v FROM documents WHERE kind='borrador' GROUP BY path) m ON d.path=m.path AND d.version=m.v ORDER BY d.path`);
  const leads = Object.fromEntries((await all(env, "SELECT * FROM leads")).map((L) => [L.lead_id, L]));
  return { borradores: docs.map(parseDraft).filter((d) => leads[d.lead_id]).map((d) => ({ ...d, lead: leadSummary(leads[d.lead_id]) })) };
}

export async function research(env) {
  const leads = await all(env, "SELECT * FROM leads");
  const out = [];
  for (const L of leads) {
    const ev = await latestDoc(env, `data/research/${L.lead_id}.evidence.json`);
    const e = ev ? JSON.parse(ev.content) : {};
    const evid = e.evidencias || [];
    out.push({ lead_id: L.lead_id, nombre_negocio: L.nombre_negocio, fuente: L.fuente, fuente_url: L.fuente_url, fecha_fuente: L.fecha_fuente,
      otras_fuentes: S(L.otras_fuentes).split(";").filter(Boolean), senales: S(L.senales_oportunidad).split(";").filter(Boolean), evidencias: evid,
      confianza: counter(evid, (x) => x.confianza || "media"), campos_no_encontrados: e.campos_no_encontrados || [],
      no_disponibles: (S(L.notas).match(/no disponibles?[^.;|]*/gi) || []), clasificacion: L.clasificacion, puntaje: L.puntaje_total });
  }
  const supp = await all(env, "SELECT tipo, valor FROM suppression");
  const revision = [];
  for (const c of await all(env, "SELECT * FROM candidates WHERE estado='revision' ORDER BY creado_en DESC LIMIT 200")) {
    const { cand, errs, dup, hits, ok } = await candidateChecks(env, c, leads, supp);
    const cal = cand.calificacion || {};
    revision.push({ archivo: c.id, lote: c.lote, request_id: c.request_id, nombre_negocio: cand.nombre_negocio, nicho: cand.nicho, ciudad: cand.ciudad,
      sitio_web: cand.sitio_web || "", calificado: !!cand.calificacion, clasificacion: cal.clasificacion, puntaje: cal.puntaje_total, errores: errs,
      suprimido: hits, duplicados: dup.exact, posibles_duplicados: dup.possible, evidencias: cand.evidencias || [], campos_no_encontrados: cand.campos_no_encontrados || [],
      dossier: c.dossier || null, fuente_ref: c.fuente_ref, listo_para_registrar: ok });
  }
  return { leads: out, revision };
}

export async function followups(env) {
  const leads = await all(env, "SELECT * FROM leads"); const by = Object.fromEntries(leads.map((L) => [L.lead_id, L]));
  const today = todayIso();
  const proximas = leads.filter((L) => L.proximo_seguimiento && !FINALS.includes(L.estado_pipeline))
    .map((L) => ({ lead_id: L.lead_id, negocio: L.nombre_negocio, estado: L.estado_pipeline, fecha: L.proximo_seguimiento, vencido: L.proximo_seguimiento < today, accion: nextAction(L) }))
    .sort((a, b) => a.fecha.localeCompare(b.fecha));
  const fus = (await all(env, "SELECT * FROM followups ORDER BY fecha_programada")).map((f) => ({ ...f, negocio: by[f.lead_id]?.nombre_negocio || "",
    vencido: !["enviado", "cancelado"].includes(f.estado) && f.fecha_programada < today }));
  const ints = await all(env, "SELECT * FROM interactions WHERE tipo <> 'cambio_estado' ORDER BY fecha_hora DESC LIMIT 200");
  return { proximas, seguimientos: fus, historial: ints.map((i) => ({ ...i, negocio: by[i.lead_id]?.nombre_negocio || "" })),
    respuestas: ints.filter((i) => i.direccion === "entrante"),
    pausados: leads.filter((L) => L.estado_pipeline === "pausado").map(leadSummary),
    perdidos: leads.filter((L) => ["perdido", "no_contactar"].includes(L.estado_pipeline)).map(leadSummary),
    tareas: await all(env, "SELECT * FROM tasks WHERE estado='abierta' ORDER BY id DESC LIMIT 100") };
}

export async function reports(env) {
  const leads = await all(env, "SELECT * FROM leads");
  const group = (k) => leads.reduce((g, L) => { const key = L[k] || "—"; g[key] ||= { total: 0, A: 0, B: 0, C: 0, descartado: 0 }; g[key].total++; g[key][L.clasificacion]++; return g; }, {});
  const order = ["calificado", "mensaje_borrador", "pendiente_aprobacion", "aprobado", "contactado", "en_conversacion", "interesado", "reunion_agendada",
    "demo_realizada", "propuesta_enviada", "negociacion", "ganado"];
  const hist = await all(env, "SELECT lead_id, resumen FROM interactions WHERE tipo='cambio_estado'");
  const reached = {};
  for (const L of leads) {
    const s = new Set(hist.filter((h) => h.lead_id === L.lead_id && h.resumen.includes(" → ")).map((h) => h.resumen.split(" → ")[1].split(".")[0]));
    s.add(L.estado_pipeline); s.add("calificado");
    for (const st of order) if (s.has(st)) reached[st] = (reached[st] || 0) + 1;
  }
  const calidad = {}, nf = {};
  for (const d of await all(env, `SELECT d.content FROM documents d JOIN (SELECT path, MAX(version) v FROM documents WHERE kind='evidencia' GROUP BY path) m ON d.path=m.path AND d.version=m.v`)) {
    const e = JSON.parse(d.content);
    for (const x of e.evidencias || []) calidad[x.confianza || "media"] = (calidad[x.confianza || "media"] || 0) + 1;
    for (const c of e.campos_no_encontrados || []) nf[c] = (nf[c] || 0) + 1;
  }
  const daily = {}, weekly = {};
  for (const L of leads) {
    const d = L.fecha_registro.slice(0, 10); daily[d] = (daily[d] || 0) + 1;
    const dt = new Date(d + "T12:00:00Z"); const jan4 = new Date(Date.UTC(dt.getUTCFullYear(), 0, 4));
    const wk = Math.ceil(((dt - jan4) / 864e5 + ((jan4.getUTCDay() + 6) % 7) + 1) / 7);
    weekly[`${dt.getUTCFullYear()}-S${String(wk).padStart(2, "0")}`] = (weekly[`${dt.getUTCFullYear()}-S${String(wk).padStart(2, "0")}`] || 0) + 1;
  }
  const req = await all(env, "SELECT SUM(encontrados) e, SUM(investigados) i, SUM(descartados) d, SUM(calificados) c FROM research_requests");
  const durs = (await all(env, "SELECT resultado FROM research_jobs WHERE estado='hecho' AND resultado LIKE '%duracion%' LIMIT 500"));
  const cands = await all(env, "SELECT estado, COUNT(*) n FROM candidates GROUP BY estado");
  return { por_nicho: group("nicho"), por_ciudad: group("ciudad"), por_fuente: group("fuente"), embudo: order.map((st) => ({ etapa: st, leads: reached[st] || 0 })),
    calidad_evidencia: calidad, campos_no_encontrados: nf, diario: daily, semanal: weekly,
    tiempo_investigacion: durs.length ? `Medido en ${durs.length} trabajos del investigador (ver detalle por solicitud en Prospección).` : "Aún sin trabajos del investigador con duración registrada.",
    prospeccion: req[0] || {}, revision: { pendientes: cands.find((c) => c.estado === "revision")?.n || 0, rechazados: cands.find((c) => c.estado === "rechazado")?.n || 0 } };
}

export async function config(env, POLICIES, APPROVAL_RULES) {
  const year = Number(todayIso().slice(0, 4));
  const vars = ["DENUE_TOKEN", "AUTH_USERS", "WORKER_TOKEN", "N8N_TOKEN", "EVENTS_TOKEN", "CF_ACCESS_AUD", "GOOGLE_PLACES_API_KEY"];
  return { config: await settingsConfig(env), puntuacion: { senales: SCHEMA["x-senales-puntos"], clasificacion: SCHEMA["x-clasificacion"], oportunidad: SCHEMA["x-oportunidad-reglas"] },
    transiciones: TRANSITIONS, politicas: POLICIES, reglas_aprobacion: APPROVAL_RULES,
    dias_inhabiles: [year, year + 1].flatMap((y) => Object.entries(mxHolidays(y)).map(([fecha, motivo]) => ({ fecha, motivo }))),
    integraciones: [
      { nombre: "CRM en Cloudflare D1", estado: "activo" },
      { nombre: "INEGI DENUE", estado: env.DENUE_TOKEN ? "activo (token configurado)" : "preparado, sin token", requiere: env.DENUE_TOKEN ? "" : "secreto DENUE_TOKEN" },
      { nombre: "Investigador local (Mac, Playwright)", estado: env.WORKER_TOKEN ? "habilitado (token configurado)" : "preparado, sin token", requiere: "WORKER_TOKEN + `bin/ww investigator` en el Mac" },
      { nombre: "n8n (autohospedado)", estado: env.N8N_TOKEN ? "habilitado (token configurado)" : "preparado, sin token", requiere: "N8N_TOKEN + instancia local" },
      { nombre: "Cloudflare Access", estado: env.CF_ACCESS_AUD ? "verificado por el Worker" : "no configurado (recomendado)", requiere: "CF_ACCESS_TEAM_DOMAIN, CF_ACCESS_AUD" },
      { nombre: "Google Places API", estado: "no conectado (de pago)", requiere: "autorización explícita" },
      { nombre: "WhatsApp / email saliente", estado: "prohibido en esta fase", requiere: "decisión de negocio y legal" },
    ],
    variables_entorno: Object.fromEntries(vars.map((k) => [k, !!env[k]])),
    automatizaciones: { envios_automaticos: "desactivados (no existe ningún mecanismo de envío)", n8n: env.N8N_TOKEN ? "token configurado (solo lectura y tareas)" : "sin conectar" } };
}

export async function pipeline(env) {
  return { estados: STATES, transiciones: TRANSITIONS, finales: FINALS, con_seguimiento: [...ACTIVE], motivos_perdida: SCHEMA.$defs.motivoPerdida.enum,
    leads: (await all(env, "SELECT * FROM leads")).map(leadSummary) };
}

// "Hoy": lo que una persona debe hacer hoy, para que ningún prospecto activo quede olvidado.
export function todayView(leads, fus, today, in7) {
  const S2 = (L) => ({ ...leadSummary(L), accion: L.proxima_accion || NEXT[L.estado_pipeline] || "", fecha: L.proximo_seguimiento });
  const live = leads.filter((L) => !FINALS.includes(L.estado_pipeline) && L.opt_out !== "true");
  const byFecha = (a, b) => (a.fecha || "").localeCompare(b.fecha || "");
  const nombre = Object.fromEntries(leads.map((L) => [L.lead_id, L.nombre_negocio]));
  return {
    hoy: today,
    acciones: live.filter((L) => L.proximo_seguimiento && L.proximo_seguimiento <= today).map((L) => ({ ...S2(L), vencido: L.proximo_seguimiento < today })).sort(byFecha),
    sin_accion: live.filter((L) => ACTIVE.has(L.estado_pipeline) && (!L.proxima_accion || !L.proximo_seguimiento)).map(S2),
    por_enviar: live.filter((L) => L.estado_pipeline === "aprobado").map(S2),
    por_aprobar: live.filter((L) => L.estado_pipeline === "pendiente_aprobacion").map(S2),
    proximos: live.filter((L) => L.proximo_seguimiento > today && L.proximo_seguimiento <= in7).map(S2).sort(byFecha),
    seguimientos: fus.filter((f) => !["enviado", "cancelado"].includes(f.estado) && f.fecha_programada <= today)
      .map((f) => ({ ...f, negocio: nombre[f.lead_id] || "", vencido: f.fecha_programada < today })),
  };
}
export async function today(env) {
  const t = todayIso(), d = new Date(`${t}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 7);
  return todayView(await all(env, "SELECT * FROM leads"), await all(env, "SELECT * FROM followups"), t, d.toISOString().slice(0, 10));
}

export function toCsv(headers, rows) {
  const esc = (v) => { const s = v == null ? "" : String(v); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [headers.join(","), ...rows.map((r) => headers.map((h) => esc(r[h])).join(","))].join("\r\n") + "\r\n";
}
export const CSV_EXPORTS = { leads: ["leads", HEADERS.lead, "lead_id"], interactions: ["interactions", HEADERS.interaccion, "rowid"],
  followups: ["followups", HEADERS.seguimiento, "rowid"], suppression: ["suppression", HEADERS.supresion, "rowid"] };
