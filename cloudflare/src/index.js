// Web Wizards Sales OS — Cloudflare Worker (API + dashboard protegido).
// No existe ninguna ruta que envíe mensajes, correos, WhatsApp o formularios. Aprobar = autorizar uso manual del borrador.
import { CRMError, HEADERS, nowIso } from "./rules.js";
import { all, first, q, run, tx, auditStmt } from "./db.js";
import { login, logout, getSession, machineScope, rateLimit, verifyAccess, clientIp } from "./auth.js";
import * as crm from "./crm.js";
import * as views from "./views.js";
import * as engine from "./engine.js";
import { denueCall, toBusiness } from "./denue.js";
import { POLICIES, APPROVAL_RULES } from "./generated/content.js";

export const VERSION = "2.0.0";
const MAX_BODY = 64 * 1024;
const LEAD = "(WW-\\d{8}-\\d{3})";
const SEC = {
  "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY", "Referrer-Policy": "no-referrer",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains", "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
  "Content-Security-Policy": "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
};
const json = (status, obj, extra = {}) => new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...SEC, ...extra } });
const withSec = (res) => { const r = new Response(res.body, res); for (const [k, v] of Object.entries(SEC)) r.headers.set(k, v); return r; };

function hostAllowed(env, req) {
  const host = new URL(req.url).host;
  const allowed = String(env.ALLOWED_HOSTS || "").split(",").map((s) => s.trim()).filter(Boolean);
  return !allowed.length || allowed.includes(host);
}
function originOk(env, req) {
  const o = req.headers.get("Origin");
  if (!o) return req.method === "GET";  // los POST del navegador siempre envían Origin
  const host = new URL(req.url).host;
  try { return new URL(o).host === host; } catch { return false; }
}
async function body(req) {
  const len = parseInt(req.headers.get("Content-Length") || "0", 10);
  if (len > MAX_BODY) throw new CRMError("Solicitud demasiado grande.", 413);
  if (!(req.headers.get("Content-Type") || "").startsWith("application/json")) throw new CRMError("Se esperaba JSON.", 415);
  const text = await req.text();
  if (text.length > MAX_BODY) throw new CRMError("Solicitud demasiado grande.", 413);
  const b = text ? JSON.parse(text) : {};
  if (!b || typeof b !== "object" || Array.isArray(b)) throw new CRMError("Se esperaba un objeto JSON.");
  return b;
}
const str = (v, n = 500) => String(v ?? "").trim().slice(0, n);

export default {
  async fetch(req, env, ctx) {
    try { return await handle(req, env, ctx); }
    catch (e) {
      if (e instanceof CRMError) return json(e.status || 422, { ok: false, error: e.message });
      if (e instanceof SyntaxError) return json(400, { ok: false, error: "JSON inválido." });
      console.error("ERROR", e && e.stack || e);
      return json(500, { ok: false, error: "Error interno. Revisa los registros del Worker." });
    }
  },
  async scheduled(event, env, ctx) { ctx.waitUntil(housekeeping(env)); },
};

export async function housekeeping(env) {
  const now = new Date().toISOString();
  await run(env, "UPDATE research_jobs SET estado='pendiente', tomado_por='' WHERE estado='en_proceso' AND tomado_en < ?", new Date(Date.now() - 30 * 60e3).toISOString());
  await run(env, "DELETE FROM sessions WHERE expira_en < ? OR revocada = 1", now);
  await run(env, "DELETE FROM rate_limits WHERE CAST(ventana AS INTEGER) < ?", String(Math.floor(Date.now() / 1000 / 900) - 8));
  await run(env, "DELETE FROM source_cache WHERE expira_en < ?", nowIso());
  const s = await views.summary(env);
  await auditStmt(env, "reporte.diario", "cron", "sistema", { kpis: s.kpis, objetivo: s.objetivo }).run();
}

async function handle(req, env, ctx) {
  const url = new URL(req.url); const path = url.pathname;
  if (!hostAllowed(env, req)) return json(421, { ok: false, error: "Host no permitido." });
  if (!(await verifyAccess(env, req))) return json(403, { ok: false, error: "Acceso no autorizado (Cloudflare Access)." });
  if (!path.startsWith("/api/")) {
    if (!env.ASSETS) return json(404, { ok: false, error: "No encontrado." });
    return withSec(await env.ASSETS.fetch(req));  // la interfaz no contiene datos; todo dato exige sesión
  }
  if (path === "/api/health") return json(200, { ok: true, version: VERSION, servicio: "ww-sales" });
  if (["PUT", "DELETE", "PATCH"].includes(req.method)) return json(405, { ok: false, error: "Método no permitido. El sistema no borra ni reemplaza registros." });

  if (path === "/api/login" && req.method === "POST") {
    if (!originOk(env, req)) return json(403, { ok: false, error: "Origen no permitido." });
    const r = await login(env, req, await body(req));
    return json(200, { ok: true, usuario: r.session.usuario, nombre: r.session.nombre }, { "Set-Cookie": r.setCookie });
  }

  // ---------------------------------------------------------------- tokens de máquina (investigador, n8n, eventos)
  const scope = await machineScope(env, req);
  if (scope) {
    if (!(await rateLimit(env, `tok:${scope}`, 600, 60))) return json(429, { ok: false, error: "Límite de frecuencia." });
    return machineRoutes(env, req, path, url, scope);
  }

  // ---------------------------------------------------------------- sesión de persona
  const s = await getSession(env, req);
  if (!s) return json(401, { ok: false, error: "Inicia sesión.", login: true });
  if (!(await rateLimit(env, `ses:${s.id_hash}`, 600, 60))) return json(429, { ok: false, error: "Demasiadas solicitudes; espera un momento." });
  const actor = `dashboard:${s.nombre}`;
  if (req.method === "GET") return getRoutes(env, path, url, s);
  if (req.method !== "POST") return json(405, { ok: false, error: "Método no permitido." });
  if (!originOk(env, req)) return json(403, { ok: false, error: "Origen no permitido." });
  if (req.headers.get("X-WW-Token") !== s.csrf) return json(403, { ok: false, error: "Sesión inválida (CSRF). Recarga la página." });
  if (path === "/api/logout") return json(200, { ok: true }, { "Set-Cookie": await logout(env, req) });
  return json(200, { ok: true, resultado: await postRoutes(env, path, await body(req), s, actor) });
}

async function getRoutes(env, path, url, s) {
  if (path === "/api/session") return json(200, { token: s.csrf, entorno: env.WW_ENTORNO || "real", version: VERSION, backend: "worker", usuario: s.usuario, nombre: s.nombre });
  const simple = { "/api/summary": views.summary, "/api/pipeline": views.pipeline, "/api/drafts": views.drafts, "/api/research": views.research,
    "/api/followups": views.followups, "/api/today": views.today, "/api/reports": views.reports, "/api/config": (e) => views.config(e, POLICIES, APPROVAL_RULES),
    "/api/leads": async (e) => ({ leads: (await all(e, "SELECT * FROM leads ORDER BY lead_id")).map(views.leadSummary) }),
    "/api/prospecting": async (e) => ({ solicitudes: await Promise.all((await all(e, "SELECT id FROM research_requests ORDER BY id DESC LIMIT 50")).map((r) => engine.getRequest(e, r.id))),
      denue: !!e.DENUE_TOKEN, investigador: !!e.WORKER_TOKEN }) };
  if (simple[path]) return json(200, await simple[path](env));
  let m = path.match(new RegExp(`^/api/leads/${LEAD}$`));
  if (m) return json(200, await views.leadDetail(env, m[1], await crm.getLead(env, m[1])));
  m = path.match(/^\/api\/prospecting\/(\d+)$/);
  if (m) return json(200, await engine.getRequest(env, parseInt(m[1], 10)));
  m = path.match(/^\/api\/export\/(leads|interactions|followups|suppression)\.csv$/);
  if (m) {
    const [table, headers, order] = views.CSV_EXPORTS[m[1]];
    const rows = await all(env, `SELECT ${headers.join(",")} FROM ${table} ORDER BY ${order}`);
    await auditStmt(env, "exportacion", `dashboard:${s.nombre}`, m[1], { filas: rows.length }).run();
    return new Response(views.toCsv(headers, rows), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${m[1]}.csv"`, ...SEC } });
  }
  if (path === "/api/events") return json(200, await events(env, url));
  if (path === "/api/denue/ficha") {
    const id = str(url.searchParams.get("id"), 40);
    if (!/^\d+$/.test(id)) throw new CRMError("Id DENUE inválido.");
    const r = await denueCall(env, "Ficha", { id });
    return json(200, { negocio: r.datos[0] ? toBusiness(r.datos[0], r.consultado_en) : null, cache: r.cache, consultado_en: r.consultado_en });
  }
  return json(404, { ok: false, error: "Ruta no encontrada." });
}

async function events(env, url) {
  const since = str(url.searchParams.get("since"), 40);
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "200", 10) || 200, 1000);
  const rows = since ? await all(env, "SELECT * FROM audit_log WHERE ts > ? ORDER BY id LIMIT ?", since, limit)
    : await all(env, "SELECT * FROM (SELECT * FROM audit_log ORDER BY id DESC LIMIT ?) ORDER BY id", limit);
  return { eventos: rows.map((r) => ({ id: r.id, ts: r.ts, evento: r.evento, actor: r.actor, entidad: r.entidad, entorno: r.entorno, detalle: JSON.parse(r.detalle || "{}") })) };
}

async function postRoutes(env, path, b, s, actor) {
  let m = path.match(new RegExp(`^/api/leads/${LEAD}/(transition|approve|request-changes|interaction|optout|draft|next)$`));
  if (m) {
    const [, id, op] = m;
    const commercial = (ch) => {  // campos del pipeline comercial que una persona captura al mover o editar el lead
      for (const [k, n] of [["proxima_accion", 300], ["motivo_perdida", 40], ["fecha_demo", 10], ["fecha_propuesta", 10], ["monto_implementacion", 12], ["monto_mensual", 12]])
        if (b[k] !== undefined && b[k] !== null && String(b[k]).trim() !== "") ch[k] = str(b[k], n);
      return ch;
    };
    if (op === "next") {
      const ch = commercial({});
      if (b.proximo_seguimiento) ch.proximo_seguimiento = str(b.proximo_seguimiento, 10);
      if (!Object.keys(ch).length) throw new CRMError("Nada que actualizar.");
      return crm.updateLead(env, id, ch, actor, str(b.nota));
    }
    if (op === "transition") {
      const to = str(b.to, 40);
      if (to === "no_contactar") throw new CRMError("Para dar de baja usa la acción «Registrar baja».");
      if (to === "aprobado") throw new CRMError("Para aprobar usa el botón «Aprobar para uso humano».");
      const ch = commercial({ estado_pipeline: to });
      if (b.proximo_seguimiento) ch.proximo_seguimiento = str(b.proximo_seguimiento, 10);
      if (to === "pendiente_aprobacion") { ch.aprobacion_estado = "pendiente"; const d = await first(env, "SELECT path FROM documents WHERE lead_id=? AND kind='borrador' ORDER BY path LIMIT 1", id); if (d) ch.mensaje_inicial_id = d.path; }
      return crm.updateLead(env, id, ch, actor, str(b.nota));
    }
    if (op === "approve") {  // el aprobador es la persona de la sesión: no se acepta un nombre arbitrario
      const ch = { estado_pipeline: "aprobado" };
      if (b.proximo_seguimiento) ch.proximo_seguimiento = str(b.proximo_seguimiento, 10);
      return crm.updateLead(env, id, ch, actor, "Aprobado en el dashboard para uso humano. No se envía nada automáticamente.", s.nombre);
    }
    if (op === "request-changes") {
      if (!str(b.nota)) throw new CRMError("Describe los cambios que pides.");
      return crm.updateLead(env, id, { estado_pipeline: "mensaje_borrador", aprobacion_estado: "cambios_solicitados" }, actor, `Cambios solicitados: ${str(b.nota)}`);
    }
    if (op === "interaction") {
      const allowed = new Set(["entrante|respuesta_lead", "saliente|mensaje_inicial", "saliente|seguimiento", "interna|nota", "saliente|llamada", "interna|reunion"]);
      if (!allowed.has(`${b.direccion}|${b.tipo}`)) throw new CRMError("Tipo de interacción no permitido desde el dashboard.");
      const obj = { lead_id: id, canal: str(b.canal, 30) || "interno", direccion: b.direccion, tipo: b.tipo, resumen: str(b.resumen), registrado_por: actor,
        enviado_por: { entrante: "lead", saliente: "humano" }[b.direccion] || "humano", resultado: b.direccion === "entrante" ? "respondido" : b.direccion === "saliente" ? "enviado" : "n/a",
        sentimiento: str(b.sentimiento, 20) || "n/a" };
      if (b.direccion === "saliente" && b.tipo === "mensaje_inicial") obj.aprobacion_ref = "aprobación registrada en el CRM";
      return crm.addInteraction(env, obj, actor);
    }
    if (op === "optout") {
      if (!str(b.fuente)) throw new CRMError("Indica de dónde viene la baja.");
      return crm.suppressLead(env, id, "opt_out", str(b.fuente, 300), actor);
    }
    if (op === "draft") return crm.saveDraft(env, id, b.contenido, actor);
  }
  if (path === "/api/followups") return crm.addFollowup(env, { lead_id: str(b.lead_id, 20), fecha_programada: str(b.fecha_programada, 10), ventana_horaria: str(b.ventana_horaria, 11),
    numero_seguimiento: parseInt(b.numero_seguimiento, 10), canal: str(b.canal, 30), plantilla_id: str(b.plantilla_id, 40), borrador_ref: str(b.borrador_ref, 120), notas: str(b.notas, 300) }, actor);
  m = path.match(/^\/api\/followups\/(FU-\d{8}-\d{4})\/status$/);
  if (m) return crm.followupStatus(env, m[1], str(b.estado, 30), str(b.nota, 300), actor);
  if (path === "/api/candidates") return crm.importCandidates(env, b.rows, actor, b.origen === "csv" ? "csv" : "manual");
  if (path === "/api/review/register") return crm.registerCandidate(env, str(b.archivo, 200), actor, b.sucursal_de ? str(b.sucursal_de, 20) : null);
  if (path === "/api/review/reject") return crm.rejectCandidate(env, str(b.archivo, 200), str(b.motivo, 300), actor);
  if (path === "/api/prospecting") return engine.createRequest(env, b, actor);
  m = path.match(/^\/api\/tasks\/(\d+)\/status$/);
  if (m) {
    const est = str(b.estado, 20); if (!["hecha", "descartada"].includes(est)) throw new CRMError("Estado de tarea inválido.");
    await tx(env, [q(env, "UPDATE tasks SET estado=?, cerrado_en=? WHERE id=? AND estado='abierta'", est, nowIso(), parseInt(m[1], 10)), auditStmt(env, "tarea.cerrada", actor, `TASK-${m[1]}`, { estado: est })]);
    return { actualizada: parseInt(m[1], 10) };
  }
  if (path === "/api/export") return { exportado: "Descarga cada tabla en /api/export/<leads|interactions|followups|suppression>.csv" };
  if (path === "/api/config") {
    const cfg = await views.settingsConfig(env);
    if ("objetivo_diario_calificados" in b) { const v = parseInt(b.objetivo_diario_calificados, 10); if (!(v >= 1 && v <= 500)) throw new CRMError("El objetivo diario debe estar entre 1 y 500."); cfg.objetivo_diario_calificados = v; }
    for (const k of ["nichos", "ciudades"]) if (k in b) { if (!Array.isArray(b[k]) || !b[k].every((x) => x && typeof x === "object" && x.nombre)) throw new CRMError(`Formato inválido en ${k}.`); cfg[k] = b[k].slice(0, 100); }
    await tx(env, [q(env, "INSERT OR REPLACE INTO settings (clave,valor,actualizado_en,actualizado_por) VALUES ('sales_os',?,?,?)", JSON.stringify(cfg), nowIso(), actor),
      auditStmt(env, "config.actualizada", actor, "settings", Object.fromEntries(Object.entries(b).filter(([k]) => k !== "por")))]);
    return { ok: true };
  }
  throw new CRMError("Ruta no encontrada.", 404);
}

// Ámbitos: worker (investigador) · n8n (lectura + tareas internas) · events (solo eventos). Ninguno puede aprobar, dar de baja ni registrar leads.
// Campos de lead que el agente puede leer (para deduplicar y trabajar) y modificar (calificación y borradores).
const AGENT_READ = ["lead_id", "nombre_negocio", "nombre_normalizado", "nicho", "subnicho", "ciudad", "estado_mx", "direccion", "sitio_web", "dominio",
  "telefono_e164", "whatsapp_publico", "email_publico", "google_place_id", "google_maps_url", "instagram_url", "facebook_url", "clasificacion",
  "puntaje_total", "estado_pipeline", "aprobacion_estado", "canal_preferido", "fecha_registro", "fecha_actualizacion", "opt_out"];
const AGENT_SET = new Set(["puntaje_icp", "puntaje_oportunidad", "puntaje_contacto", "puntaje_capacidad", "puntaje_total", "clasificacion",
  "motivo_clasificacion", "senales_oportunidad", "servicio_recomendado", "canal_preferido", "num_resenas", "calificacion_google", "google_maps_url",
  "google_place_id", "instagram_url", "facebook_url", "decisor_nombre", "decisor_cargo", "decisor_fuente_url", "notas", "estado_pipeline",
  "aprobacion_estado", "mensaje_inicial_id"]);
const AGENT_STATES = new Set(["mensaje_borrador", "pendiente_aprobacion", "descartado"]);  // nunca aprobado, contactado ni posteriores

async function agentRoutes(env, req, path, url, actor) {
  const b = req.method === "POST" ? await body(req) : {};
  if (req.method === "GET" && path === "/api/agent/leads")
    return json(200, { leads: (await all(env, "SELECT * FROM leads ORDER BY lead_id")).map((L) => Object.fromEntries(AGENT_READ.map((k) => [k, L[k] ?? ""]))) });
  let m = path.match(new RegExp(`^/api/agent/leads/${LEAD}$`));
  if (req.method === "GET" && m) {
    const L = await crm.getLead(env, m[1]);
    const d = await views.leadDetail(env, m[1], L);
    return json(200, { lead: L, dossier: d.dossier, evidencia: d.evidencia, borradores: d.borradores, transiciones: d.transiciones, bloqueado: d.bloqueado });
  }
  if (req.method === "GET" && path === "/api/agent/candidates")
    return json(200, { candidatos: (await all(env, "SELECT id, lote, data, dossier, creado_en FROM candidates WHERE estado='revision' ORDER BY creado_en"))
      .map((c) => ({ id: c.id, lote: c.lote, creado_en: c.creado_en, data: JSON.parse(c.data), dossier: c.dossier })) });
  if (req.method === "POST" && path === "/api/agent/candidates") return json(200, { ok: true, resultado: await crm.submitAgentCandidate(env, b, actor) });
  m = path.match(/^\/api\/agent\/candidates\/([A-Za-z0-9._\/-]{3,200})\/(register|reject)$/);
  if (req.method === "POST" && m) {
    if (m[2] === "register") return json(200, { ok: true, resultado: await crm.registerCandidate(env, m[1], actor, b.sucursal_de ? str(b.sucursal_de, 20) : null) });
    return json(200, { ok: true, resultado: await crm.rejectCandidate(env, m[1], str(b.motivo, 500) || "rechazado por el agente", actor) });
  }
  m = path.match(new RegExp(`^/api/agent/leads/${LEAD}/(draft|doc|update)$`));
  if (req.method === "POST" && m) {
    const [, id, op] = m;
    if (op === "draft") return json(200, { ok: true, resultado: await crm.saveDraft(env, id, str(b.content, 50000), actor) });
    if (op === "doc") {
      const kind = str(b.kind, 20);
      if (!["dossier", "evidencia"].includes(kind)) throw new CRMError("kind debe ser dossier o evidencia.");
      return json(200, { ok: true, resultado: await crm.saveLeadDoc(env, id, kind, str(b.content, 200000), actor) });
    }
    const set = b.set && typeof b.set === "object" ? b.set : {};
    const bad = Object.keys(set).filter((k) => !AGENT_SET.has(k));
    if (bad.length) throw new CRMError(`El agente no puede modificar: ${bad.join(", ")}.`);
    if (set.estado_pipeline && !AGENT_STATES.has(set.estado_pipeline)) throw new CRMError("El agente solo mueve a borrador, pendiente de aprobación o descartado. Aprobar y contactar son decisiones humanas.");
    if (set.aprobacion_estado && set.aprobacion_estado !== "pendiente") throw new CRMError("El agente solo puede marcar la aprobación como pendiente.");
    const ch = Object.fromEntries(Object.entries(set).map(([k, v]) => [k, str(v, 2000)]));
    return json(200, { ok: true, resultado: await crm.updateLead(env, id, ch, actor, str(b.nota), null, { recalificar: true }) });
  }
  return json(403, { ok: false, error: "Ruta no permitida para el agente." });
}

async function machineRoutes(env, req, path, url, scope) {
  const actor = scope === "worker" ? "investigador" : scope;
  if (scope === "agente") return agentRoutes(env, req, path, url, "agente:claude");  // sin acceso a /api/events (auditoría con IPs)
  if (req.method === "GET" && path === "/api/events") return json(200, await events(env, url));
  if (scope === "events") return json(403, { ok: false, error: "El token de eventos solo puede leer /api/events." });
  if (scope === "worker") {
    if (req.method === "POST" && path === "/api/worker/claim") {
      const b = await body(req);
      const job = await engine.claimJob(env, str(b.worker_id, 60) || "mac");
      return job ? json(200, { trabajo: job }) : json(200, { trabajo: null });
    }
    const m = path.match(/^\/api\/worker\/jobs\/(\d+)\/result$/);
    if (req.method === "POST" && m) return json(200, { ok: true, resultado: await engine.submitResult(env, parseInt(m[1], 10), await body(req), actor) });
    return json(403, { ok: false, error: "Ruta no permitida para el investigador." });
  }
  // n8n
  if (req.method === "GET") {
    const reads = { "/api/summary": views.summary, "/api/followups": views.followups,
      "/api/prospecting": async (e) => ({ solicitudes: await all(e, "SELECT * FROM research_requests ORDER BY id DESC LIMIT 50") }),
      "/api/review/pending": async (e) => ({ candidatos: await all(e, "SELECT id, lote, request_id, creado_en FROM candidates WHERE estado='revision' ORDER BY creado_en") }),
      "/api/drafts/pending": async (e) => ({ leads: (await all(e, "SELECT * FROM leads WHERE estado_pipeline='pendiente_aprobacion'")).map(views.leadSummary) }),
      "/api/jobs/pending": async (e) => ({ trabajos: await all(e, "SELECT id, request_id, tipo, estado, creado_en FROM research_jobs WHERE estado IN ('pendiente','en_proceso') ORDER BY id") }) };
    if (reads[path]) return json(200, await reads[path](env));
  }
  if (req.method === "POST" && path === "/api/integrations/n8n/tasks") {
    const b = await body(req);
    const tipo = str(b.tipo, 30), titulo = str(b.titulo, 200), leadId = str(b.lead_id, 20);
    if (!["revisar_candidato", "aprobar_borrador", "seguimiento", "investigacion", "reporte", "otro"].includes(tipo)) throw new CRMError("Tipo de tarea inválido.");
    if (leadId && !/^WW-\d{8}-\d{3}$/.test(leadId)) throw new CRMError("lead_id inválido.");
    const dup = await first(env, "SELECT id FROM tasks WHERE estado='abierta' AND tipo=? AND titulo=? AND lead_id=?", tipo, titulo, leadId);
    if (dup) return json(200, { ok: true, tarea: dup.id, duplicada: true });
    const r = await q(env, "INSERT INTO tasks (tipo,lead_id,titulo,detalle,origen,creado_en) VALUES (?,?,?,?,?,?) RETURNING id", tipo, leadId, titulo, str(b.detalle, 2000), "n8n", nowIso()).first();
    await auditStmt(env, "n8n.tarea", "n8n", `TASK-${r.id}`, { tipo, lead_id: leadId, titulo }).run();
    return json(200, { ok: true, tarea: r.id });
  }
  if (req.method === "POST" && path === "/api/integrations/n8n/event") {
    const b = await body(req);
    const ev = str(b.evento, 60);
    if (!/^[a-z0-9_.-]{3,60}$/.test(ev)) throw new CRMError("Nombre de evento inválido.");
    await auditStmt(env, `n8n.${ev}`, "n8n", str(b.entidad, 60) || "n8n", typeof b.detalle === "object" && b.detalle ? b.detalle : {}).run();
    return json(200, { ok: true });
  }
  return json(403, { ok: false, error: "Ruta no permitida para n8n." });
}
