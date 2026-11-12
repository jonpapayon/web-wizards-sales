// Operaciones de escritura del CRM en D1. Equivalentes a scripts/crm_tool.py (mismas reglas, mismo esquema),
// con la base como segunda barrera (restricciones y triggers). Cada operación es una transacción (batch).
import { all, first, q, tx, auditStmt, nextId, docStmt } from "./db.js";
import { CRMError, nowIso, todayIso, TRANSITIONS, FINALS, AGENT_NAMES, HEADERS, CONTACT_FIELDS, validate, validateRow, checkQualification,
  findDuplicates, suppressedHits, leadKeys, contactDayProblem, normalizeName, domainOf, isGeneric, tzFor, toCell, SCHEMA } from "./rules.js";

const READ_ONLY = new Set(["lead_id", "fecha_registro", "fuente", "fuente_url", "fecha_fuente", "opt_out", "fecha_opt_out"]);
const strRow = (L) => Object.fromEntries(HEADERS.lead.map((k) => [k, L[k] == null ? "" : String(L[k])]));

export async function getLead(env, id) {
  const L = await first(env, "SELECT * FROM leads WHERE lead_id = ?", id);
  if (!L) throw new CRMError(`No existe el lead ${id}`, 404);
  return strRow(L);
}
export async function isBlocked(env, L) {
  if (L.opt_out === "true" || L.estado_pipeline === "no_contactar") return true;
  return suppressedHits(L, await all(env, "SELECT tipo, valor FROM suppression")).length > 0;
}
async function assertNotBlocked(env, L, action) {
  if (await isBlocked(env, L)) throw new CRMError(`${L.lead_id} está dado de baja / no_contactar o en la lista de exclusión: ${action} prohibido (policies/opt-out.md §4).`);
}

async function intIds(env, n) {
  const first_ = await nextId(env, "INT", "interactions", "interaccion_id", 4);
  const base = first_.slice(0, -4), start = parseInt(first_.slice(-4), 10);
  return Array.from({ length: n }, (_, i) => base + String(start + i).padStart(4, "0"));
}
function intStmt(env, id, leadId, tipo, resumen, actor, extra = {}) {
  const row = { interaccion_id: id, lead_id: leadId, fecha_hora: nowIso(), canal: "interno", direccion: "interna", tipo, resumen, contenido_ref: "", plantilla_id: "",
    enviado_por: "agente", aprobacion_ref: "", resultado: "n/a", sentimiento: "n/a", siguiente_accion: "", fecha_siguiente_accion: "", registrado_por: actor, ...extra };
  const errs = validateRow("interaccion", row);
  if (errs.length) throw new CRMError("Interacción inválida: " + errs.join("; "));
  return q(env, `INSERT INTO interactions (${HEADERS.interaccion.join(",")}) VALUES (${HEADERS.interaccion.map(() => "?").join(",")})`, ...HEADERS.interaccion.map((k) => row[k]));
}

const QUAL_FIELDS = ["puntaje_icp", "puntaje_oportunidad", "puntaje_contacto", "puntaje_capacidad", "puntaje_total", "clasificacion", "senales_oportunidad"];
export async function updateLead(env, leadId, changes, actor, nota = "", approverName = null, _opts = {}) {
  const L = await getLead(env, leadId);
  await assertNotBlocked(env, L, "modificar");
  const bad = Object.keys(changes).filter((k) => !HEADERS.lead.includes(k) || READ_ONLY.has(k));
  if (bad.length) throw new CRMError(`Campos no modificables o inexistentes: ${bad}. Bajas: usa «Registrar baja».`);
  const before = Object.fromEntries(Object.keys(changes).map((k) => [k, L[k]]));
  const old = L.estado_pipeline, nw = changes.estado_pipeline ?? old;
  if (nw !== old) {
    if (nw === "no_contactar") throw new CRMError("A no_contactar solo se llega registrando una baja.");
    if (!(TRANSITIONS[old] || []).includes(nw)) throw new CRMError(`Transición inválida ${old} → ${nw}. Válidas: ${(TRANSITIONS[old] || []).join(", ") || "ninguna"}`);
  }
  // solo al APROBAR (pasar a aprobado); editar un lead que ya estaba aprobado no es una nueva aprobación
  if ((changes.aprobacion_estado === "aprobado" && L.aprobacion_estado !== "aprobado") || (nw === "aprobado" && old !== "aprobado")) {
    const por = String(approverName ?? changes.aprobado_por ?? "").trim();
    if (!por || AGENT_NAMES.has(por.toLowerCase())) throw new CRMError("«aprobado» exige el nombre de la persona que aprueba (nunca un agente o integración).");
    if (!["pendiente", "aprobado"].includes(L.aprobacion_estado)) throw new CRMError("Solo se aprueba un lead con aprobación pendiente.");
    changes.aprobado_por = por; changes.aprobacion_estado = "aprobado"; changes.fecha_aprobacion = changes.fecha_aprobacion || nowIso();
  }
  if (changes.proximo_seguimiento) {
    const p = contactDayProblem(changes.proximo_seguimiento);
    if (p) throw new CRMError(`proximo_seguimiento cae en ${p}; elige un día hábil (policies/contact-cadence.md §4).`);
  }
  const M = { ...L, ...Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, toCell(v)])) };
  const stmts = [];
  if (FINALS.includes(nw)) {
    M.proximo_seguimiento = ""; M.proxima_accion = "";
    stmts.push(q(env, `UPDATE followups SET estado='cancelado', completado_en=?, notas=trim(notas || ' | cancelado: lead pasó a ' || ?, ' |')
      WHERE lead_id=? AND estado NOT IN ('enviado','cancelado')`, nowIso(), nw, leadId));
  }
  if (QUAL_FIELDS.some((k) => k in changes)) {  // recalificación: misma coherencia que crm_tool.py (suma, catálogo y x-clasificacion)
    const senales = String(M.senales_oportunidad || "").split(";").filter(Boolean);
    const cal = { puntaje_icp: +M.puntaje_icp, puntaje_oportunidad: +M.puntaje_oportunidad, puntaje_contacto: +M.puntaje_contacto,
      puntaje_capacidad: +M.puntaje_capacidad, puntaje_total: +M.puntaje_total, clasificacion: M.clasificacion, senales_oportunidad: senales };
    if (M.criterios) { try { cal.criterios = JSON.parse(M.criterios); } catch { throw new CRMError("criterios debe ser JSON."); } }
    const q2 = checkQualification(cal, senales.map((s) => ({ senal: s, confianza: "media" })), [], M);
    if (q2.length) throw new CRMError("Recalificación incoherente:\n - " + q2.join("\n - "));
  }
  if (nota) M.notas = `${M.notas ? M.notas + " | " : ""}${todayIso()} ${String(nota).slice(0, 500)}`;
  M.fecha_actualizacion = nowIso();
  const errs = validateRow("lead", M);
  if (errs.length) throw new CRMError("Resultado inválido: " + errs.join("; "));
  const cols = HEADERS.lead.filter((k) => !READ_ONLY.has(k));
  stmts.unshift(q(env, `UPDATE leads SET ${cols.map((k) => `${k}=?`).join(",")} WHERE lead_id=?`, ...cols.map((k) => M[k]), leadId));
  const ids = await intIds(env, 2);
  if (nw !== old) {
    stmts.push(intStmt(env, ids[0], leadId, "cambio_estado", `${old} → ${nw}. ${nota || ""}`.trim(), actor));
    stmts.push(auditStmt(env, "lead.estado_cambiado", actor, leadId, { de: old, a: nw, nota }));
    if (nw === "pendiente_aprobacion") stmts.push(auditStmt(env, "borrador.listo", actor, leadId, { mensaje: M.mensaje_inicial_id }));
  }
  if (changes.aprobacion_estado === "aprobado") {
    stmts.push(intStmt(env, ids[1], leadId, "aprobacion", `Aprobado por ${M.aprobado_por} (uso humano; no envía)`, actor, { aprobacion_ref: `${M.aprobado_por} ${M.fecha_aprobacion}` }));
    stmts.push(auditStmt(env, "aprobacion.humana", actor, leadId, { aprobado_por: M.aprobado_por, envia: false }));
  }
  stmts.push(auditStmt(env, "lead.actualizado", actor, leadId, { antes: before, despues: changes, nota }));
  await tx(env, stmts);
  return { actualizado: leadId, cambios: changes };
}

export async function suppressLead(env, leadId, motivo, fuente, actor) {
  if (!["opt_out", "solicitud_legal", "repep", "cliente_actual", "competidor", "socio", "rebote_permanente"].includes(motivo)) throw new CRMError("Motivo de exclusión inválido.");
  const L = await getLead(env, leadId);
  const supp = await all(env, "SELECT tipo, valor FROM suppression");
  const existing = new Set(supp.map((r) => `${r.tipo}\u0000${r.valor.toLowerCase()}`));
  const ts = nowIso(); const stmts = [];
  const finalAlready = L.estado_pipeline === "no_contactar" || L.opt_out === "true";
  if (!finalAlready) {
    const estado = FINALS.includes(L.estado_pipeline) && !["perdido", "descartado"].includes(L.estado_pipeline) ? L.estado_pipeline : "no_contactar";
    const optout = ["opt_out", "solicitud_legal"].includes(motivo);
    stmts.push(q(env, `UPDATE leads SET estado_pipeline=?, opt_out=?, fecha_opt_out=?, proximo_seguimiento='', proxima_accion='', fecha_actualizacion=? WHERE lead_id=?`,
      optout ? "no_contactar" : estado, optout ? "true" : L.opt_out, optout ? ts : L.fecha_opt_out, ts, leadId));
    stmts.push(q(env, `UPDATE followups SET estado='cancelado', completado_en=?, notas=trim(notas || ' | cancelado: supresión (' || ? || ')', ' |') WHERE lead_id=? AND estado NOT IN ('enviado','cancelado')`, ts, motivo, leadId));
    const [id] = await intIds(env, 1);
    stmts.push(intStmt(env, id, leadId, motivo === "opt_out" ? "opt_out" : "cambio_estado", `Supresión por ${motivo}. Fuente: ${fuente}`, actor));
  }
  const nuevos = leadKeys(L).filter(([t, v]) => !existing.has(`${t}\u0000${v.toLowerCase()}`));
  for (const [t, v] of nuevos) stmts.push(q(env, "INSERT INTO suppression (valor,tipo,lead_id,motivo,fecha,fuente,notas) VALUES (?,?,?,?,?,?,'')", v, t, leadId, motivo, ts, String(fuente).slice(0, 300)));
  stmts.push(auditStmt(env, motivo === "opt_out" ? "baja.registrada" : "supresion.agregada", actor, leadId, { motivo, valores: nuevos.map((k) => k[1]), fuente }));
  await tx(env, stmts);
  return { suprimidos: nuevos.map((k) => k[1]), leads_afectados: [leadId] };
}

export async function addInteraction(env, obj, actor) {
  const L = await getLead(env, obj.lead_id);
  if (obj.direccion === "saliente") {
    await assertNotBlocked(env, L, "registrar un envío");
    if (obj.tipo === "mensaje_inicial" && L.aprobacion_estado !== "aprobado") throw new CRMError("No hay aprobación humana registrada para el mensaje inicial de este lead.");
  }
  const [id] = await intIds(env, 1);
  const row = Object.fromEntries(HEADERS.interaccion.map((k) => [k, toCell(obj[k])]));
  row.interaccion_id = id; row.fecha_hora = row.fecha_hora || nowIso(); row.registrado_por = row.registrado_por || actor;
  const errs = validateRow("interaccion", row);
  if (errs.length) throw new CRMError("Interacción inválida: " + errs.join("; "));
  const stmts = [q(env, `INSERT INTO interactions (${HEADERS.interaccion.join(",")}) VALUES (${HEADERS.interaccion.map(() => "?").join(",")})`, ...HEADERS.interaccion.map((k) => row[k]))];
  if (obj.direccion === "entrante") {
    const wa = obj.canal === "whatsapp" && L.consentimiento_whatsapp === "no";
    stmts.push(q(env, `UPDATE leads SET fecha_ultima_interaccion=?, consentimiento_whatsapp=?, fecha_consentimiento=?, fecha_actualizacion=? WHERE lead_id=?`,
      row.fecha_hora, wa ? "si_inicio_lead" : L.consentimiento_whatsapp, wa ? row.fecha_hora : L.fecha_consentimiento, nowIso(), L.lead_id));
  }
  stmts.push(auditStmt(env, obj.direccion === "entrante" ? "respuesta.recibida" : "interaccion.registrada", actor, L.lead_id, { interaccion_id: id, tipo: row.tipo, canal: row.canal }));
  await tx(env, stmts);
  return { registrada: id };
}

export async function addFollowup(env, obj, actor) {
  const p = contactDayProblem(obj.fecha_programada);
  if (p) throw new CRMError(`fecha_programada cae en ${p}; no se contacta ese día (policies/contact-cadence.md §4).`);
  const L = await getLead(env, obj.lead_id);
  await assertNotBlocked(env, L, "programar seguimientos");
  if (FINALS.includes(L.estado_pipeline)) throw new CRMError(`Lead en estado final ${L.estado_pipeline}.`);
  if (await first(env, "SELECT 1 FROM followups WHERE lead_id=? AND fecha_programada=? AND estado<>'cancelado'", L.lead_id, obj.fecha_programada))
    throw new CRMError("Ya hay un seguimiento ese día para este lead (máximo 1 mensaje por día).");
  const row = Object.fromEntries(HEADERS.seguimiento.map((k) => [k, toCell(obj[k])]));
  row.seguimiento_id = await nextId(env, "FU", "followups", "seguimiento_id", 4); row.creado_en = nowIso();
  row.estado = row.estado || "programado"; row.requiere_aprobacion = row.requiere_aprobacion || "true";
  const errs = validateRow("seguimiento", row);
  if (errs.length) throw new CRMError("Seguimiento inválido: " + errs.join("; "));
  await tx(env, [q(env, `INSERT INTO followups (${HEADERS.seguimiento.join(",")}) VALUES (${HEADERS.seguimiento.map(() => "?").join(",")})`, ...HEADERS.seguimiento.map((k) => row[k])),
    auditStmt(env, "seguimiento.programado", actor, L.lead_id, { seguimiento_id: row.seguimiento_id, fecha: row.fecha_programada, canal: row.canal })]);
  return { programado: row.seguimiento_id };
}

export async function followupStatus(env, id, estado, nota, actor) {
  const f = await first(env, "SELECT * FROM followups WHERE seguimiento_id=?", id);
  if (!f) throw new CRMError(`No existe ${id}`, 404);
  if (["enviado", "cancelado"].includes(f.estado)) throw new CRMError(`${id} ya está ${f.estado}.`);
  if (!SCHEMA.$defs.seguimiento.properties.estado.enum.includes(estado)) throw new CRMError("Estado de seguimiento inválido.");
  if (["aprobado", "enviado"].includes(estado)) await assertNotBlocked(env, await getLead(env, f.lead_id), `marcar seguimiento como ${estado}`);
  await tx(env, [q(env, "UPDATE followups SET estado=?, completado_en=?, notas=? WHERE seguimiento_id=?", estado, ["enviado", "cancelado"].includes(estado) ? nowIso() : "",
    nota ? `${f.notas ? f.notas + " | " : ""}${String(nota).slice(0, 300)}` : f.notas, id),
  auditStmt(env, "seguimiento.actualizado", actor, f.lead_id, { seguimiento_id: id, de: f.estado, a: estado })]);
  return { actualizado: id, estado };
}

// ------------------------------------------------------------------ área de revisión
export async function candidateChecks(env, c, leads, supp) {
  const cand = JSON.parse(c.data);
  const errs = validate(SCHEMA.$defs.leadCandidate, cand, "candidato");
  const cal = cand.calificacion;
  if (!cal) errs.push("candidato.calificacion: obligatorio para registrar (calificar primero)");
  else if (!errs.length) {
    errs.push(...checkQualification(cal, cand.evidencias || [], cand.descalificadores || [], cand));
    if (["A", "B"].includes(cal.clasificacion) && !CONTACT_FIELDS.some((f) => cand[f]))
      errs.push("PENDIENTE DE REVISIÓN: clase A/B sin ningún canal de contacto verificado en los datos. Un puntaje alto no compensa contacto no verificado.");
  }
  const dup = findDuplicates(cand, leads);
  const hits = suppressedHits(cand, supp);
  return { cand, errs, dup, hits, ok: !!cal && !errs.length && !dup.exact.length && !hits.length };
}

// ------------------------------------------------------------------ alta manual e importación CSV → candidatos "por investigar"
// No crean leads: entran a la cola de revisión sin calificar. Se califican con evidencia y luego una persona los registra.
export const IMPORT_FIELDS = ["nombre_negocio", "nicho", "subnicho", "ciudad", "estado_mx", "direccion", "telefono_publico", "whatsapp_publico",
  "email_publico", "sitio_web", "google_maps_url", "instagram_url", "facebook_url", "fuente", "fuente_url", "notas"];
const MAX_IMPORT = 100;  // por petición (límite de 64 KB); el dashboard envía el CSV en lotes
export function mxE164(raw) {  // solo números mexicanos completos: 10 dígitos, o 52 + 10 dígitos
  const d = String(raw || "").replace(/\D/g, "");
  if (d.length === 10) return `+52${d}`;
  if (d.length === 12 && d.startsWith("52")) return `+${d}`;
  if (d.length === 13 && d.startsWith("521")) return `+52${d.slice(3)}`;
  return "";
}
export function candidateFromRow(r, actor, today) {
  const v = (k, n = 300) => String(r[k] ?? "").trim().slice(0, n);
  const errs = [];
  const c = { nombre_negocio: v("nombre_negocio", 160), nicho: v("nicho", 30).toLowerCase() || "otro", subnicho: v("subnicho", 60), ciudad: v("ciudad", 80),
    estado_mx: v("estado_mx", 60), direccion: v("direccion"), telefono_publico: v("telefono_publico", 40), email_publico: v("email_publico", 120).toLowerCase(),
    sitio_web: v("sitio_web"), google_maps_url: v("google_maps_url", 600), instagram_url: v("instagram_url"), facebook_url: v("facebook_url"),
    fuente: v("fuente", 30).toLowerCase() || "manual", fuente_url: v("fuente_url", 600), fecha_fuente: today };
  if (c.nombre_negocio.length < 2) errs.push("falta nombre_negocio");
  if (!c.ciudad) errs.push("falta ciudad");
  if (!c.estado_mx) errs.push("falta estado_mx");
  if (!SCHEMA.$defs.nicho.enum.includes(c.nicho)) errs.push(`nicho inválido (${SCHEMA.$defs.nicho.enum.join(", ")})`);
  if (!SCHEMA.$defs.fuente.enum.includes(c.fuente)) errs.push(`fuente inválida (${SCHEMA.$defs.fuente.enum.join(", ")})`);
  c.fuente_url ||= c.google_maps_url || c.sitio_web || c.instagram_url || c.facebook_url;  // regla: todo dato con fuente
  if (!/^https?:\/\//i.test(c.fuente_url)) errs.push("falta una URL de fuente (Google Maps, sitio, Instagram o Facebook)");
  for (const k of ["sitio_web", "google_maps_url", "instagram_url", "facebook_url"]) if (c[k] && !/^https?:\/\//i.test(c[k])) errs.push(`${k} debe empezar con http`);
  if (c.email_publico && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c.email_publico)) errs.push("email_publico inválido");
  const tel = mxE164(c.telefono_publico), wa = mxE164(v("whatsapp_publico", 40));
  if (tel) c.telefono_e164 = tel;
  if (wa) c.whatsapp_publico = wa; else if (v("whatsapp_publico")) errs.push("whatsapp_publico debe ser un número mexicano completo");
  for (const k of Object.keys(c)) if (c[k] === "") delete c[k];
  Object.assign(c, { evidencias: [], campos_no_encontrados: [], investigado_por: `${actor} (alta manual)`, dossier_path: "" });
  return { c, errs, notas: v("notas", 1000) };
}
export async function importCandidates(env, rows, actor, origen = "manual") {
  if (!Array.isArray(rows) || !rows.length) throw new CRMError("No hay filas para importar.");
  if (rows.length > MAX_IMPORT) throw new CRMError(`Máximo ${MAX_IMPORT} filas por importación.`);
  const ts = nowIso(), today = todayIso();
  const leads = await all(env, "SELECT * FROM leads"), supp = await all(env, "SELECT tipo, valor FROM suppression");
  const pending = (await all(env, "SELECT id, data FROM candidates WHERE estado='revision'")).map((x) => ({ lead_id: x.id, ...JSON.parse(x.data) }));
  const out = { creados: [], duplicados: [], excluidos: 0, invalidos: [] }, stmts = [];
  rows.forEach((r, i) => {
    const fila = i + 1, { c, errs, notas } = candidateFromRow(r || {}, actor, today);
    if (errs.length) return out.invalidos.push({ fila, nombre: c.nombre_negocio || "", errores: errs });
    if (suppressedHits(c, supp).length) return out.excluidos++;  // lista de exclusión: no se guarda ni se repite el dato
    const dup = findDuplicates(c, leads), dupC = findDuplicates(c, pending);
    const ex = [...dup.exact.map((x) => x[0]), ...dupC.exact.map((x) => x[0])];
    if (ex.length) return out.duplicados.push({ fila, nombre: c.nombre_negocio, de: ex });
    const posibles = [...dup.possible, ...dupC.possible].map((x) => x[0]);
    const id = `${origen}-${today.replaceAll("-", "")}-${crypto.randomUUID().slice(0, 8)}`;
    const dossier = `# ${c.nombre_negocio}\n\nAlta ${origen === "csv" ? "por importación CSV" : "manual"} por ${actor} el ${today}. **Por investigar:** sin calificar ni evidencia.\n`
      + (posibles.length ? `\nPosible duplicado (mismo nombre y ciudad): ${posibles.join(", ")}.\n` : "") + (notas ? `\n## Notas de alta\n\n${notas}\n` : "");
    stmts.push(q(env, "INSERT INTO candidates (id,lote,data,dossier,estado,creado_en,actualizado_en) VALUES (?,?,?,?, 'revision', ?, ?)",
      id, `${origen}-${today}`, JSON.stringify(c), dossier, ts, ts));
    pending.push({ lead_id: id, ...c });
    out.creados.push({ id, nombre: c.nombre_negocio, posibles_duplicados: posibles });
  });
  if (stmts.length) {
    stmts.push(auditStmt(env, "candidatos.alta", actor, `${origen}-${today}`, { creados: out.creados.length, duplicados: out.duplicados.length, excluidos: out.excluidos, invalidos: out.invalidos.length }));
    await tx(env, stmts);
  }
  return out;
}

export async function registerCandidate(env, cid, actor, sucursalDe = null) {
  const c = await first(env, "SELECT * FROM candidates WHERE id=?", cid);
  if (!c) throw new CRMError("Candidato no encontrado.", 404);
  if (c.estado !== "revision") throw new CRMError(`El candidato ya está ${c.estado}.`);
  const leads = await all(env, "SELECT * FROM leads"), supp = await all(env, "SELECT tipo, valor FROM suppression");
  const { cand, errs, dup, hits } = await candidateChecks(env, c, leads, supp);
  if (errs.length) throw new CRMError("Candidato incompleto o incoherente:\n - " + errs.join("\n - "));
  if (hits.length) throw new CRMError("En lista de exclusión: no se registra (policies/opt-out.md).");
  if (dup.exact.length) throw new CRMError(`Duplicado de ${dup.exact.map((x) => x[0]).join(", ")}: no se crea otro lead.`);
  let nota = "";
  for (const [lid, sameAddr] of dup.possible) {
    if (sameAddr || sucursalDe !== lid) throw new CRMError(`Posible duplicado de ${lid} (mismo nombre y ciudad). Si es otra sucursal verificada, indícalo.`);
    nota = `sucursal relacionada: ${lid}`;
  }
  const cal = cand.calificacion, ts = nowIso();
  const leadId = await nextId(env, "WW", "leads", "lead_id", 3);
  const dom = domainOf(cand.sitio_web || "");
  const row = Object.fromEntries(HEADERS.lead.map((k) => [k, ""]));
  for (const [k, v] of Object.entries(cand)) if (k in row) row[k] = toCell(v);
  for (const [k, v] of Object.entries(cal)) if (k in row) row[k] = v && typeof v === "object" && !Array.isArray(v) ? JSON.stringify(v) : toCell(v);
  Object.assign(row, { lead_id: leadId, fecha_registro: ts, fecha_actualizacion: ts, nombre_normalizado: normalizeName(cand.nombre_negocio),
    dominio: !dom || isGeneric(dom) ? "" : dom, zona_horaria: cand.zona_horaria || tzFor(cand.estado_mx), evidencias: `data/research/${leadId}.md`,
    estado_pipeline: cal.clasificacion === "descartado" ? "descartado" : "calificado", aprobacion_estado: "no_aplica", num_seguimientos: "0",
    consentimiento_whatsapp: "no", opt_out: "false",
    notas: [nota, cand.campos_no_encontrados?.length ? "no encontrados: " + cand.campos_no_encontrados.join(", ") : ""].filter(Boolean).join("; ") });
  const e2 = validateRow("lead", row);
  if (e2.length) throw new CRMError("Registro inválido: " + e2.join("; "));
  const dossier = (c.dossier || "").replace(/^\| lead_id \|.*$/m, `| lead_id | ${leadId} |`);
  const evidence = JSON.stringify({ lead_id: leadId, nombre_negocio: cand.nombre_negocio, fuente: cand.fuente, fuente_url: cand.fuente_url, fecha_fuente: cand.fecha_fuente,
    otras_fuentes: cand.otras_fuentes || [], evidencias: cand.evidencias || [], campos_no_encontrados: cand.campos_no_encontrados || [], descalificadores: cand.descalificadores || [],
    investigado_por: cand.investigado_por, calificacion: cal, generado: ts, origen: `candidato ${cid}` }, null, 2);
  const stmts = [q(env, `INSERT INTO leads (${HEADERS.lead.join(",")}) VALUES (${HEADERS.lead.map(() => "?").join(",")})`, ...HEADERS.lead.map((k) => row[k])),
    q(env, "UPDATE candidates SET estado='registrado', lead_id=?, actualizado_en=? WHERE id=?", leadId, ts, cid),
    await docStmt(env, `data/research/${leadId}.md`, "dossier", leadId, dossier || `# ${cand.nombre_negocio}\n`, actor),
    await docStmt(env, `data/research/${leadId}.evidence.json`, "evidencia", leadId, evidence, actor),
    auditStmt(env, "lead.registrado", actor, leadId, { clasificacion: cal.clasificacion, puntaje: cal.puntaje_total, nombre: cand.nombre_negocio, candidato: cid })];
  if (c.fuente_ref && c.fuente_ref.includes(":")) {
    const [fuente, ref] = c.fuente_ref.split(/:(.*)/s);
    if (ref) stmts.push(q(env, "INSERT OR IGNORE INTO lead_sources (lead_id,fuente,ref_id,url,consultado_en) VALUES (?,?,?,?,?)", leadId, fuente, ref, cand.fuente_url, cand.fecha_fuente));
  }
  if (c.request_id) stmts.push(q(env, "UPDATE research_requests SET en_revision=MAX(en_revision-1,0), actualizado_en=? WHERE id=?", ts, c.request_id));
  await tx(env, stmts);
  return { registrado: leadId, clasificacion: cal.clasificacion, puntaje: cal.puntaje_total };
}

export async function rejectCandidate(env, cid, motivo, actor) {
  if (!motivo) throw new CRMError("Indica el motivo del rechazo.");
  const c = await first(env, "SELECT * FROM candidates WHERE id=?", cid);
  if (!c) throw new CRMError("Candidato no encontrado.", 404);
  const ts = nowIso();
  const stmts = [q(env, "UPDATE candidates SET estado='rechazado', motivo=?, actualizado_en=? WHERE id=?", `${ts} ${actor}: ${String(motivo).slice(0, 300)}`, ts, cid),
    auditStmt(env, "candidato.rechazado", actor, cid, { motivo })];
  if (c.request_id) stmts.push(q(env, "UPDATE research_requests SET en_revision=MAX(en_revision-1,0), descartados=descartados+1, actualizado_en=? WHERE id=?", ts, c.request_id));
  await tx(env, stmts);
  return { rechazado: cid, motivo };
}

// ------------------------------------------------------------------ agente (scripts/ww_remote.py con AGENT_TOKEN)
export async function submitAgentCandidate(env, b, actor) {
  const cand = b.candidato;
  if (!cand || typeof cand !== "object" || Array.isArray(cand)) throw new CRMError("Falta el objeto «candidato».");
  if (String(cand.nombre_negocio || "").trim().length < 2) throw new CRMError("candidato.nombre_negocio es obligatorio.");
  const data = JSON.stringify(cand);
  if (data.length > 200000) throw new CRMError("Candidato demasiado grande.");
  const dossier = String(b.dossier || "").slice(0, 200000), ts = nowIso(), today = todayIso();
  let id = String(b.id || "").trim();
  if (id) {
    const c = await first(env, "SELECT estado FROM candidates WHERE id=?", id);
    if (!c) throw new CRMError("Candidato no encontrado.", 404);
    if (c.estado !== "revision") throw new CRMError(`El candidato ya está ${c.estado}: no se modifica.`);
    await tx(env, [q(env, "UPDATE candidates SET data=?, dossier=CASE WHEN ?<>'' THEN ? ELSE dossier END, actualizado_en=? WHERE id=?", data, dossier, dossier, ts, id),
      auditStmt(env, "candidato.actualizado", actor, id, { nombre: cand.nombre_negocio })]);
  } else {
    id = `agente-${today.replaceAll("-", "")}-${crypto.randomUUID().slice(0, 8)}`;
    await tx(env, [q(env, "INSERT INTO candidates (id,lote,data,dossier,estado,creado_en,actualizado_en) VALUES (?,?,?,?, 'revision', ?, ?)",
      id, String(b.lote || `agente-${today}`).slice(0, 80), data, dossier, ts, ts), auditStmt(env, "candidato.subido", actor, id, { nombre: cand.nombre_negocio })]);
  }
  const c = await first(env, "SELECT * FROM candidates WHERE id=?", id);
  const leads = await all(env, "SELECT * FROM leads"), supp = await all(env, "SELECT tipo, valor FROM suppression");
  const chk = await candidateChecks(env, c, leads, supp);
  return { id, listo_para_registrar: chk.ok, errores: chk.errs, duplicados: chk.dup.exact.map((x) => x[0]), posibles_duplicados: chk.dup.possible.map((x) => x[0]),
    en_lista_de_exclusion: chk.hits.length > 0 };
}
export async function saveLeadDoc(env, leadId, kind, content, actor) {
  await getLead(env, leadId);
  if (kind === "evidencia") { try { JSON.parse(content); } catch { throw new CRMError("La evidencia debe ser JSON válido."); } }
  const path = kind === "dossier" ? `data/research/${leadId}.md` : `data/research/${leadId}.evidence.json`;
  await tx(env, [await docStmt(env, path, kind, leadId, content, actor), auditStmt(env, "documento.actualizado", actor, leadId, { path })]);
  return { guardado: path };
}

export async function saveDraft(env, leadId, content, actor) {
  await getLead(env, leadId);
  const path = `data/outreach/${leadId}-inicial.md`;
  await tx(env, [await docStmt(env, path, "borrador", leadId, String(content).slice(0, 50000), actor), auditStmt(env, "borrador.guardado", actor, leadId, { path })]);
  return { guardado: path };
}
