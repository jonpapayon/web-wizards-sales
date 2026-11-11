// Motor de prospección: solicitud → búsqueda (DENUE / OSM vía investigador) → deduplicación → trabajos de investigación
// → resultados del investigador → candidato con evidencia separada (verificada / inferida / no encontrada)
// → calificación automática PROPUESTA → área de revisión humana. Nada se registra en el CRM sin revisión.
import { all, first, q, tx, auditStmt } from "./db.js";
import { CRMError, nowIso, todayIso, normalizeName, findDuplicates, suppressedHits, expectedOpportunity, expectedClass, validate, SCHEMA, tzFor, domainOf, isGeneric } from "./rules.js";
import { denuePaged, toBusiness, cveEntidad, KEYWORDS, SCIAN, inMunicipio, pymeFromEstrato, DENUE_PUBLIC } from "./denue.js";

const NICHOS = ["dentista", "clinica", "estetica_spa", "veterinaria"];
const HIGH_TICKET = /(implant|ortodonc|brackets|cirug|endodoncia|blanqueamiento|botox|l[aá]ser|depilaci[oó]n|hospitalizaci[oó]n|rayos x|ultrasonido|maxilofacial|est[eé]tica avanzada|spa de d[ií]a|paquete)/i;

export async function createRequest(env, body, actor, { fetchImpl } = {}) {
  const nicho = String(body.nicho || ""), estado_mx = String(body.estado_mx || "").trim().slice(0, 60);
  const municipio = String(body.municipio || "").trim().slice(0, 80), cantidad = parseInt(body.cantidad, 10);
  if (!NICHOS.includes(nicho)) throw new CRMError("Nicho inválido.");
  if (!estado_mx || !cveEntidad(estado_mx)) throw new CRMError("Estado de México no reconocido (ej. Puebla, Jalisco, Ciudad de México).");
  if (!(cantidad >= 1 && cantidad <= 200)) throw new CRMError("La cantidad objetivo debe estar entre 1 y 200.");
  const criterios = { clases: Array.isArray(body.criterios?.clases) && body.criterios.clases.length ? body.criterios.clases.filter((c) => ["A", "B", "C"].includes(c)) : ["A", "B"],
    puntaje_min: Math.max(0, Math.min(100, parseInt(body.criterios?.puntaje_min ?? 50, 10) || 0)), solo_con_sitio: !!body.criterios?.solo_con_sitio };
  const fuentes = (Array.isArray(body.fuentes) ? body.fuentes : ["denue", "osm"]).filter((f) => ["denue", "osm"].includes(f));
  const ts = nowIso();
  const res = await q(env, `INSERT INTO research_requests (nicho,estado_mx,municipio,cantidad,criterios,fuentes,estado,creado_por,creado_en,actualizado_en)
    VALUES (?,?,?,?,?,?, 'pendiente', ?,?,?) RETURNING id`, nicho, estado_mx, municipio, cantidad, JSON.stringify(criterios), JSON.stringify(fuentes), actor, ts, ts).first();
  const id = res.id;
  await auditStmt(env, "prospeccion.solicitada", actor, `REQ-${id}`, { nicho, estado_mx, municipio, cantidad, criterios, fuentes }).run();
  const msgs = []; let found = [];
  if (fuentes.includes("denue")) {
    if (!env.DENUE_TOKEN) msgs.push("DENUE no conectado (falta DENUE_TOKEN).");
    else {
      try {
        const { datos, consultado_en } = await denuePaged(env, "BuscarEntidad", { condicion: KEYWORDS[nicho], entidad: cveEntidad(estado_mx) }, Math.min(cantidad * 6, 600), { fetchImpl });
        // BuscarEntidad filtra por palabra clave; se conserva la clase de actividad de cada ficha para revisión.
        found = datos.map((e) => toBusiness(e, consultado_en)).filter((b) => inMunicipio(b, municipio));
        msgs.push(`DENUE: ${datos.length} registros consultados (clases SCIAN de referencia ${SCIAN[nicho].join(", ")}), ${found.length} en ${municipio || estado_mx}.`);
      } catch (e) { msgs.push(`DENUE: ${e.message}`); }
    }
  }
  if (fuentes.includes("osm")) {
    await q(env, `INSERT OR IGNORE INTO research_jobs (request_id,tipo,target,business,estado,creado_en,actualizado_en) VALUES (?, 'descubrir_osm', ?, ?, 'pendiente', ?, ?)`,
      id, `osm:${nicho}:${normalizeName(municipio || estado_mx)}`, JSON.stringify({ nicho, ciudad: municipio || estado_mx, estado_mx, limite: Math.min(cantidad * 4, 120) }), ts, ts).run();
    msgs.push("OpenStreetMap: búsqueda encolada para el investigador local.");
  }
  const counts = await enqueueBusinesses(env, id, found.slice(0, cantidad * 4), criterios, actor);
  const estado = counts.jobs > 0 || fuentes.includes("osm") ? "investigando" : (found.length ? "completada" : "sin_fuente");
  await q(env, `UPDATE research_requests SET estado=?, encontrados=encontrados+?, duplicados=duplicados+?, mensaje=?, actualizado_en=? WHERE id=?`,
    estado, found.length, counts.duplicados, msgs.join(" "), nowIso(), id).run();
  return getRequest(env, id);
}

// Deduplica contra CRM, exclusiones, candidatos y trabajos existentes; crea un trabajo por negocio nuevo.
export async function enqueueBusinesses(env, requestId, businesses, criterios, actor) {
  const leads = await all(env, "SELECT lead_id,telefono_e164,whatsapp_publico,email_publico,dominio,sitio_web,google_place_id,google_maps_url,nombre_normalizado,ciudad,direccion FROM leads");
  const supp = await all(env, "SELECT tipo, valor FROM suppression");
  const refs = new Set((await all(env, "SELECT fuente_ref FROM candidates WHERE fuente_ref <> ''")).map((r) => r.fuente_ref));
  let duplicados = 0, jobs = 0; const ts = nowIso(); const stmts = [];
  for (const b of businesses) {
    const probe = { ...b, ciudad: b.municipio || b.ciudad || "" };
    if (findDuplicates(probe, leads).exact.length || suppressedHits(probe, supp).length || refs.has(`${b.fuente}:${b.ref_id}`)) { duplicados++; continue; }
    if (criterios.solo_con_sitio && !b.sitio_web) continue;
    const tipo = b.sitio_web ? "site_audit" : "sin_sitio";
    const target = b.sitio_web || `${b.fuente}:${b.ref_id || normalizeName(b.nombre_negocio)}`;
    stmts.push(q(env, `INSERT OR IGNORE INTO research_jobs (request_id,tipo,target,business,estado,creado_en,actualizado_en) VALUES (?,?,?,?, 'pendiente', ?, ?)`,
      requestId, tipo, target, JSON.stringify(b), ts, ts));
    jobs++;
  }
  if (stmts.length) {
    stmts.push(auditStmt(env, "investigacion.pendiente", actor, `REQ-${requestId}`, { trabajos: jobs, duplicados }));
    await tx(env, stmts);
  }
  return { duplicados, jobs };
}

export async function getRequest(env, id) {
  const r = await first(env, "SELECT * FROM research_requests WHERE id = ?", id);
  if (!r) throw new CRMError("Solicitud no encontrada.", 404);
  const jobs = await all(env, "SELECT estado, COUNT(*) n FROM research_jobs WHERE request_id = ? GROUP BY estado", id);
  return { ...r, criterios: JSON.parse(r.criterios), fuentes: JSON.parse(r.fuentes), trabajos: Object.fromEntries(jobs.map((j) => [j.estado, j.n])) };
}

// ------------------------------------------------------------------ investigador local
export async function claimJob(env, workerId) {
  const stale = new Date(Date.now() - 30 * 60e3).toISOString();
  await q(env, "UPDATE research_jobs SET estado='pendiente', tomado_por='', actualizado_en=? WHERE estado='en_proceso' AND tomado_en < ?", nowIso(), stale).run();
  const j = await q(env, `UPDATE research_jobs SET estado='en_proceso', tomado_por=?, tomado_en=?, intentos=intentos+1, actualizado_en=?
     WHERE id = (SELECT id FROM research_jobs WHERE estado='pendiente' AND intentos < 3 ORDER BY id LIMIT 1) RETURNING *`,
    String(workerId).slice(0, 60), new Date().toISOString(), nowIso()).first();
  return j ? { ...j, business: JSON.parse(j.business) } : null;
}

const MAX_EVID = 40;
function cleanEvidence(list, url) {
  return (Array.isArray(list) ? list : []).slice(0, MAX_EVID).filter((e) => e && SCHEMA.$defs.senal.enum.includes(e.senal))
    .map((e) => ({ senal: e.senal, observacion: String(e.observacion || "").slice(0, 600), url: /^https?:\/\//.test(e.url || "") ? e.url : url,
      fecha_verificacion: /^\d{4}-\d{2}-\d{2}$/.test(e.fecha_verificacion || "") ? e.fecha_verificacion : todayIso(),
      metodo: String(e.metodo || "investigador local").slice(0, 200), confianza: ["alta", "media", "baja"].includes(e.confianza) ? e.confianza : "media" }))
    .filter((e) => e.observacion.length >= 10);
}

// Calificación automática PROPUESTA con la rúbrica real; solo cuenta lo verificado. La revisión humana la confirma o corrige.
export function proposeQualification(nicho, b, evid, datos) {
  const icp = (["dentista", "clinica"].includes(nicho) ? 10 : 9) + (b.direccion ? 5 : 0) + (pymeFromEstrato(b.estrato) ? 5 : 0);
  const senales = [...new Set(evid.filter((e) => e.confianza !== "baja").map((e) => e.senal))];
  const op = expectedOpportunity(senales);
  const canales = new Set();
  if (b.telefono_e164) canales.add("telefono");
  if (b.email_publico) canales.add("email");
  for (const t of datos.tel || []) canales.add("telefono");
  for (const m of datos.mailto || []) canales.add("email");
  if ((datos.whatsapp_enlaces || []).length) canales.add("whatsapp");
  const contacto = (canales.size ? 10 : 0) + (canales.size >= 2 ? 5 : 0);
  const capacidad = HIGH_TICKET.test(JSON.stringify(datos.servicios || datos.texto_servicios || "")) ? 5 : 0;
  const cal = { puntaje_icp: icp, puntaje_oportunidad: op, puntaje_contacto: contacto, puntaje_capacidad: capacidad,
    puntaje_total: icp + op + contacto + capacidad, senales_oportunidad: senales };
  cal.clasificacion = expectedClass(cal, []);
  const servicios = [];
  if (senales.includes("WEB_NONE") || senales.includes("WEB_SOCIAL_ONLY")) servicios.push("sitio_nuevo");
  if (senales.some((s) => s.startsWith("WEB_") && !["WEB_NONE", "WEB_SOCIAL_ONLY"].includes(s)) || senales.includes("FORM_BROKEN")) servicios.push("rediseno_web");
  if (senales.some((s) => s.startsWith("WA_"))) servicios.push("whatsapp_integracion");
  if (senales.some((s) => s.startsWith("BOOK_"))) servicios.push("agenda_en_linea");
  return { ...cal, servicio_recomendado: servicios.length ? servicios.slice(0, 3) : ["rediseno_web"],
    canal_preferido: canales.has("email") ? "email" : canales.has("telefono") ? "telefono" : undefined, calificado_en: nowIso(),
    motivo_clasificacion: `Propuesta automática del motor (${cal.puntaje_total} pts). Señales verificadas: ${senales.join(", ") || "ninguna"}. ` +
      "Reseñas, actividad reciente y anuncios no consultados: valen 0. Requiere revisión humana." };
}

function dossierMd(b, nicho, res, evid, inferidas, noEncontrado, cal) {
  const row = (k, v, src) => `| ${k} | ${v || "no encontrado"} | ${src} |`;
  return [`# Dossier de investigación — ${b.nombre_negocio}`, "", "> Generado automáticamente por el motor de prospección. Revisar antes de registrar.", "",
    "| Campo | Valor |", "|---|---|", "| lead_id | pendiente |", `| Fuente | ${b.fuente.toUpperCase()} ${b.ref_id ? `(id ${b.ref_id})` : ""} · consultado ${b.consultado_en || ""} |`, "",
    "## Identidad y contacto (fuente oficial/directorio)", "", "| Dato | Valor | Fuente |", "|---|---|---|",
    row("Nombre", b.nombre_negocio, b.fuente), row("Actividad", b.clase_actividad, b.fuente), row("Estrato", b.estrato, b.fuente), row("Dirección", b.direccion, b.fuente),
    row("Teléfono", b.telefono_publico, b.fuente), row("Email", b.email_publico, b.fuente), row("Sitio web", b.sitio_web, b.fuente), "",
    "## Evidencia verificada", "", ...(evid.length ? evid.map((e) => `- **${e.senal}** (${e.confianza}): ${e.observacion} — ${e.url} · ${e.metodo}`) : ["- Ninguna."]), "",
    "## Evidencia inferida (no puntúa)", "", ...(inferidas.length ? inferidas.map((e) => `- ${e.senal}: ${e.observacion}`) : ["- Ninguna."]), "",
    "## No encontrado", "", ...(noEncontrado.length ? noEncontrado.map((x) => `- ${x}`) : ["- —"]), "",
    "## Investigación del sitio", "", `- Motor: ${res.motor || "—"} · estado HTTP: ${res.status ?? "—"} · duración: ${res.duracion_s ?? "—"} s`,
    ...(res.capturas || []).map((c) => `- Captura ${c.vista}: ${c.path} (sha256 ${String(c.sha256).slice(0, 12)}…)`), res.robots_bloqueado ? "- robots.txt no permite la consulta: no se investigó el sitio." : "", "",
    "## Calificación propuesta", "", `- ICP ${cal.puntaje_icp} · Oportunidad ${cal.puntaje_oportunidad} · Contacto ${cal.puntaje_contacto} · Capacidad ${cal.puntaje_capacidad} = **${cal.puntaje_total}** → **${cal.clasificacion}**`,
    `- ${cal.motivo_clasificacion}`, ""].join("\n");
}

export async function submitResult(env, jobId, body, actor) {
  const job = await first(env, "SELECT * FROM research_jobs WHERE id = ?", jobId);
  if (!job) throw new CRMError("Trabajo no encontrado.", 404);
  if (job.estado !== "en_proceso") throw new CRMError(`El trabajo está en estado ${job.estado}.`, 409);
  const req = await getRequest(env, job.request_id);
  const b = JSON.parse(job.business);
  const ts = nowIso();
  if (body.estado === "fallido") {
    const estado = job.intentos >= 3 ? "fallido" : "pendiente";
    await tx(env, [q(env, "UPDATE research_jobs SET estado=?, error=?, actualizado_en=? WHERE id=?", estado, String(body.error || "error").slice(0, 500), ts, jobId),
      auditStmt(env, "investigacion.fallida", actor, `JOB-${jobId}`, { error: String(body.error || "").slice(0, 200), reintento: estado === "pendiente" })]);
    return { estado };
  }
  const res = body.resultado || {};
  if (job.tipo === "descubrir_osm") {
    const negocios = (Array.isArray(res.negocios) ? res.negocios : []).slice(0, 300).map((n) => ({ fuente: "osm", ref_id: String(n.ref_id || n.fuente_url || "").slice(0, 120),
      nombre_negocio: String(n.nombre_negocio || "").slice(0, 160), direccion: String(n.direccion || "").slice(0, 200), municipio: b.ciudad, estado_mx: b.estado_mx,
      telefono_publico: String(n.telefono_publico || "").slice(0, 40), telefono_e164: /^\+52\d{10}$/.test(n.telefono_e164 || "") ? n.telefono_e164 : "",
      email_publico: String(n.email_publico || "").slice(0, 120), sitio_web: /^https?:\/\//.test(n.sitio_web || "") ? n.sitio_web : "",
      fuente_url: /^https?:\/\//.test(n.fuente_url || "") ? n.fuente_url : "https://www.openstreetmap.org/", consultado_en: ts, estrato: "", clase_actividad: "" }))
      .filter((n) => n.nombre_negocio.length >= 2);
    const c = await enqueueBusinesses(env, job.request_id, negocios.slice(0, req.cantidad * 4), req.criterios, actor);
    await tx(env, [q(env, "UPDATE research_jobs SET estado='hecho', resultado=?, actualizado_en=? WHERE id=?", JSON.stringify({ negocios: negocios.length }), ts, jobId),
      q(env, "UPDATE research_requests SET encontrados=encontrados+?, duplicados=duplicados+?, actualizado_en=? WHERE id=?", negocios.length, c.duplicados, ts, job.request_id)]);
    await refreshRequest(env, job.request_id);
    return { estado: "hecho", negocios: negocios.length, trabajos: c.jobs };
  }
  // site_audit / sin_sitio → candidato
  const url = b.sitio_web || b.fuente_url;
  const all_ev = cleanEvidence(res.evidencias, url);
  const verificadas = all_ev.filter((e) => e.confianza !== "baja");
  const inferidas = all_ev.filter((e) => e.confianza === "baja");
  if (job.tipo === "sin_sitio") inferidas.push({ senal: "WEB_NONE", observacion: `${b.fuente.toUpperCase()} no registra sitio web; falta confirmar en buscadores que no exista uno propio.`,
    url: b.fuente_url, fecha_verificacion: todayIso(), metodo: `Directorio ${b.fuente}`, confianza: "baja" });
  const datos = res.datos || {};
  const noEnc = [...new Set([...(b.no_encontrado_denue || []), ...(Array.isArray(res.no_encontrado) ? res.no_encontrado.map(String) : [])])].slice(0, 20);
  const cal = proposeQualification(req.nicho, b, verificadas, datos);
  const slug = normalizeName(b.nombre_negocio).replace(/ /g, "-").slice(0, 60) + "-" + normalizeName(b.municipio || req.municipio || req.estado_mx).replace(/ /g, "-");
  const cand = { fuente: b.fuente === "denue" ? "denue" : "osm", fuente_url: b.fuente_url, fecha_fuente: (b.consultado_en || ts).slice(0, 10), nombre_negocio: b.nombre_negocio,
    nicho: req.nicho, ciudad: b.municipio || req.municipio || req.estado_mx, estado_mx: req.estado_mx, zona_horaria: tzFor(req.estado_mx),
    evidencias: [...verificadas, ...inferidas], campos_no_encontrados: noEnc, descalificadores: [], dossier_path: `data/research/${slug}.md`,
    investigado_por: `motor:${res.motor || "investigador"}`, calificacion: cal };
  if (b.direccion) cand.direccion = b.direccion;
  if (b.sitio_web) cand.sitio_web = b.sitio_web;
  if (b.telefono_publico) cand.telefono_publico = b.telefono_publico;
  if (b.telefono_e164) cand.telefono_e164 = b.telefono_e164;
  if (b.email_publico) cand.email_publico = b.email_publico;
  const wa = (datos.whatsapp_enlaces || []).find((d) => /^\d{10}$/.test(d));
  if (wa) cand.whatsapp_publico = "+52" + wa;
  if (!cal.canal_preferido) delete cal.canal_preferido;
  if (b.latitud) cand.otras_fuentes = [];
  const schemaErrs = validate(SCHEMA.$defs.leadCandidate, cand, "candidato");
  const okClass = req.criterios.clases.includes(cal.clasificacion) && cal.puntaje_total >= req.criterios.puntaje_min;
  const estadoCand = cal.clasificacion === "descartado" || !okClass ? "rechazado" : "revision";
  const motivo = estadoCand === "rechazado" ? `Automático: ${cal.clasificacion} (${cal.puntaje_total} pts) fuera de los criterios de la solicitud.` : "";
  const cid = `cand-${job.request_id}-${jobId}`;
  const dossier = dossierMd(b, req.nicho, res, verificadas, inferidas, noEnc, cal);
  await tx(env, [
    q(env, "INSERT INTO candidates (id,lote,request_id,data,dossier,estado,motivo,fuente_ref,creado_en,actualizado_en) VALUES (?,?,?,?,?,?,?,?,?,?)",
      cid, todayIso(), job.request_id, JSON.stringify(cand), dossier, estadoCand, motivo + (schemaErrs.length ? ` Esquema: ${schemaErrs.join("; ")}` : ""), `${b.fuente}:${b.ref_id}`, ts, ts),
    q(env, "UPDATE research_jobs SET estado='hecho', resultado=?, actualizado_en=? WHERE id=?", JSON.stringify({ candidato: cid, clase: cal.clasificacion, motor: res.motor, capturas: res.capturas || [] }).slice(0, 20000), ts, jobId),
    q(env, `UPDATE research_requests SET investigados=investigados+1, descartados=descartados+?, calificados=calificados+?, en_revision=en_revision+?, actualizado_en=? WHERE id=?`,
      estadoCand === "rechazado" ? 1 : 0, ["A", "B"].includes(cal.clasificacion) && estadoCand === "revision" ? 1 : 0, estadoCand === "revision" ? 1 : 0, ts, job.request_id),
    auditStmt(env, "prospecto.nuevo", actor, cid, { nombre: b.nombre_negocio, clase_propuesta: cal.clasificacion, puntaje: cal.puntaje_total, estado: estadoCand }),
  ]);
  await refreshRequest(env, job.request_id);
  return { estado: "hecho", candidato: cid, clasificacion: cal.clasificacion, en_revision: estadoCand === "revision" };
}

async function refreshRequest(env, id) {
  const p = await first(env, "SELECT COUNT(*) n FROM research_jobs WHERE request_id=? AND estado IN ('pendiente','en_proceso')", id);
  if (!p.n) await q(env, "UPDATE research_requests SET estado='completada', actualizado_en=? WHERE id=? AND estado IN ('investigando','buscando','pendiente')", nowIso(), id).run();
}
