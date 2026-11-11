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

export async function updateLead(env, leadId, changes, actor, nota = "", approverName = null) {
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
  if (changes.aprobacion_estado === "aprobado" || nw === "aprobado") {
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
    M.proximo_seguimiento = "";
    stmts.push(q(env, `UPDATE followups SET estado='cancelado', completado_en=?, notas=trim(notas || ' | cancelado: lead pasó a ' || ?, ' |')
      WHERE lead_id=? AND estado NOT IN ('enviado','cancelado')`, nowIso(), nw, leadId));
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
    stmts.push(q(env, `UPDATE leads SET estado_pipeline=?, opt_out=?, fecha_opt_out=?, proximo_seguimiento='', fecha_actualizacion=? WHERE lead_id=?`,
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
    errs.push(...checkQualification(cal, cand.evidencias || [], cand.descalificadores || []));
    if (["A", "B"].includes(cal.clasificacion) && !CONTACT_FIELDS.some((f) => cand[f]))
      errs.push("PENDIENTE DE REVISIÓN: clase A/B sin ningún canal de contacto verificado en los datos. Un puntaje alto no compensa contacto no verificado.");
  }
  const dup = findDuplicates(cand, leads);
  const hits = suppressedHits(cand, supp);
  return { cand, errs, dup, hits, ok: !!cal && !errs.length && !dup.exact.length && !hits.length };
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
  for (const [k, v] of Object.entries(cal)) if (k in row) row[k] = toCell(v);
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

export async function saveDraft(env, leadId, content, actor) {
  await getLead(env, leadId);
  const path = `data/outreach/${leadId}-inicial.md`;
  await tx(env, [await docStmt(env, path, "borrador", leadId, String(content).slice(0, 50000), actor), auditStmt(env, "borrador.guardado", actor, leadId, { path })]);
  return { guardado: path };
}
