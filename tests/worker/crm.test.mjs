import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { setup, loginAs, REPO } from "./helpers.mjs";

const PILOT = { "WW-20261111-001": ["Clínica Dental Aiteli", "B", 52], "WW-20261111-002": ["Clínica Dental Biodental", "B", 52],
  "WW-20261111-003": ["Oral Health", "B", 58], "WW-20261111-004": ["Jauckens & Castillo Dental", "C", 48] };
const parseCsv = (t) => { const rows = []; let row = [], f = "", q = false;
  for (let i = 0; i < t.length; i++) { const c = t[i];
    if (q) { if (c === '"' && t[i + 1] === '"') { f += '"'; i++; } else if (c === '"') q = false; else f += c; }
    else if (c === '"') q = true; else if (c === ",") { row.push(f); f = ""; } else if (c === "\n") { row.push(f.replace(/\r$/, "")); rows.push(row); row = []; f = ""; } else f += c; }
  if (f || row.length) { row.push(f); rows.push(row); } return rows; };

test("los 4 prospectos originales están en D1 con identidad, clase y puntaje", async () => {
  const { call } = await setup({ seed: "real" });
  const s = await loginAs(call);
  const { body } = await s.get("/api/leads");
  const crm = parseCsv(readFileSync(join(REPO, "data", "crm", "leads.csv"), "utf8")).length - 1;
  assert.equal(body.leads.length, crm);  // D1 refleja el CRM completo; el piloto se conserva intacto
  for (const id of Object.keys(PILOT)) {
    const L = body.leads.find((x) => x.lead_id === id);
    assert.deepEqual([L.nombre_negocio, L.clasificacion, +L.puntaje_total], PILOT[id]);
  }
  const d = await s.get("/api/leads/WW-20261111-001");
  assert.ok(d.body.dossier.includes("Aiteli")); assert.ok(d.body.evidencia.evidencias.length >= 1); assert.ok(d.body.borradores.length >= 1);
  assert.equal(d.body.borradores[0].meta.version, "2");
});

test("reconciliación: la exportación CSV desde D1 coincide fila a fila con los CSV originales", async () => {
  const { call } = await setup({ seed: "real" });
  const s = await loginAs(call);
  for (const k of ["leads", "interactions", "followups", "suppression"]) {
    const exp = await s.get(`/api/export/${k}.csv`);
    const a = parseCsv(exp.body), b = parseCsv(readFileSync(join(REPO, "data", "crm", `${k}.csv`), "utf8"));
    assert.deepEqual(a.map((r) => JSON.stringify(r)).sort(), b.map((r) => JSON.stringify(r)).sort(), k);
  }
});

test("transiciones: inválida rechazada por API y por la base; válida auditada", async () => {
  const { call, env } = await setup({ seed: "demo" });
  const s = await loginAs(call);
  const { body } = await s.get("/api/leads");
  const L = body.leads.find((x) => x.estado_pipeline === "calificado" && x.opt_out === "false");
  assert.equal((await s.post(`/api/leads/${L.lead_id}/transition`, { to: "ganado" })).status, 422);
  await assert.rejects(env.DB.prepare("UPDATE leads SET estado_pipeline='ganado' WHERE lead_id=?").bind(L.lead_id).run(), /transición/);
  const ok = await s.post(`/api/leads/${L.lead_id}/transition`, { to: "mensaje_borrador", nota: "prueba" });
  assert.equal(ok.status, 200);
  const ev = await s.get("/api/events?limit=20");
  assert.ok(ev.body.eventos.some((e) => e.evento === "lead.estado_cambiado" && e.entidad === L.lead_id));
});

test("aprobación: el aprobador es la persona de la sesión, nunca envía, sin interacción saliente", async () => {
  const { call, env } = await setup({ seed: "demo" });
  const s = await loginAs(call);
  const { body } = await s.get("/api/leads");
  const L = body.leads.find((x) => x.estado_pipeline === "pendiente_aprobacion");
  const r = await s.post(`/api/leads/${L.lead_id}/approve`, { aprobado_por: "claude" });  // el nombre enviado se ignora
  assert.equal(r.status, 200);
  const d = await s.get(`/api/leads/${L.lead_id}`);
  assert.equal(d.body.lead.aprobado_por, "Ana Revisora");
  assert.ok(!d.body.interacciones.some((i) => i.direccion === "saliente"));
  const ev = await s.get("/api/events?limit=50");
  assert.equal(ev.body.eventos.find((e) => e.evento === "aprobacion.humana" && e.entidad === L.lead_id).detalle.envia, false);
  await assert.rejects(env.DB.prepare("UPDATE leads SET aprobado_por='claude' WHERE lead_id=?").bind(L.lead_id).run(), /CHECK/);
});

test("bajas irreversibles y exclusión solo de anexado (API + triggers)", async () => {
  const { call, env } = await setup({ seed: "demo" });
  const s = await loginAs(call);
  const { body } = await s.get("/api/leads");
  const L = body.leads.find((x) => x.estado_pipeline === "calificado" && x.opt_out === "false");
  assert.equal((await s.post(`/api/leads/${L.lead_id}/optout`, { fuente: "" })).status, 422);
  assert.equal((await s.post(`/api/leads/${L.lead_id}/optout`, { fuente: "respuesta de prueba" })).status, 200);
  const t = await s.post(`/api/leads/${L.lead_id}/transition`, { to: "mensaje_borrador" });
  assert.equal(t.status, 422); assert.match(t.body.error, /baja|exclusión/);
  // la base bloquea la reactivación (lo detiene el trigger de bajas o el de transiciones, según el orden de SQLite)
  await assert.rejects(env.DB.prepare("UPDATE leads SET opt_out='false', estado_pipeline='calificado' WHERE lead_id=?").bind(L.lead_id).run(), /baja|transición/);
  await assert.rejects(env.DB.prepare("UPDATE leads SET notas='reactivar' WHERE lead_id=?").bind(L.lead_id).run(), /baja/);
  await assert.rejects(env.DB.prepare("DELETE FROM suppression").run(), /anexado/);
  await assert.rejects(env.DB.prepare("UPDATE suppression SET motivo='socio'").run(), /anexado/);
  await assert.rejects(env.DB.prepare("DELETE FROM audit_log").run(), /anexado/);
  await assert.rejects(env.DB.prepare("DELETE FROM interactions").run(), /inmutable/);
  await assert.rejects(env.DB.prepare("DELETE FROM leads").run(), /no se borran/);
  const supp = (await env.DB.prepare("SELECT tipo, valor FROM suppression").all()).results;
  assert.equal(new Set(supp.map((r) => r.tipo + r.valor)).size, supp.length);
});

test("duplicados: índice único en la base y rechazo en el registro de candidatos", async () => {
  const { env } = await setup({ seed: "real" });
  const L = (await env.DB.prepare("SELECT * FROM leads WHERE lead_id='WW-20261111-001'").first());
  const cols = Object.keys(L);
  const copy = { ...L, lead_id: "WW-20261111-099" };
  await assert.rejects(env.DB.prepare(`INSERT INTO leads (${cols}) VALUES (${cols.map(() => "?")})`).bind(...cols.map((c) => copy[c])).run(), /UNIQUE/);
});

test("candidato duplicado de un lead del piloto → no se registra", async () => {
  const { call, env } = await setup({ seed: "real" });
  const s = await loginAs(call);
  const cand = JSON.parse((await env.DB.prepare("SELECT data FROM candidates WHERE lead_id='WW-20261111-001'").first()).data);
  await env.DB.prepare("INSERT INTO candidates (id,lote,data,estado,creado_en,actualizado_en) VALUES ('dup-test','x',?, 'revision','x','x')").bind(JSON.stringify(cand)).run();
  const r = await s.post("/api/review/register", { archivo: "dup-test" });
  assert.equal(r.status, 422); assert.match(r.body.error, /Duplicado|duplicado|incoherente/);
});

test("días inhábiles: no se programan seguimientos el 16-nov-2026 ni en domingo", async () => {
  const { call } = await setup({ seed: "demo" });
  const s = await loginAs(call);
  const { body } = await s.get("/api/leads");
  const L = body.leads.find((x) => x.estado_pipeline === "contactado");
  for (const d of ["2026-11-16", "2026-11-15"]) {
    const r = await s.post("/api/followups", { lead_id: L.lead_id, fecha_programada: d, numero_seguimiento: 2, canal: "email" });
    assert.equal(r.status, 422, d); assert.match(r.body.error, /descanso|domingo/);
  }
});

test("persistencia: los datos sobreviven al reabrir la base (archivo)", async () => {
  const { mkdtempSync } = await import("node:fs"); const { tmpdir } = await import("node:os");
  const { makeEnv } = await import("../../dev/worker_local.mjs");
  const path = join(mkdtempSync(join(tmpdir(), "ww-d1-")), "t.sqlite");
  const e1 = makeEnv({ dbPath: path, vars: {} });
  e1.DB.db.exec(readFileSync(join(REPO, "cloudflare", "seed", "seed_real.sql"), "utf8"));
  e1.DB.close();
  const e2 = makeEnv({ dbPath: path, vars: {} });
  const crm = parseCsv(readFileSync(join(REPO, "data", "crm", "leads.csv"), "utf8")).length - 1;
  assert.equal((await e2.DB.prepare("SELECT COUNT(*) n FROM leads").first()).n, crm);
});

test("IDs: el Worker numera en su rango (WW 500+, INT/FU 5000+) y no choca con el CRM local", async () => {
  const { env } = await setup({ seed: "demo" });
  const { nextId } = await import("../../cloudflare/src/db.js");
  const lead = await nextId(env, "WW", "leads", "lead_id", 3), int = await nextId(env, "INT", "interactions", "interaccion_id", 4);
  assert.ok(+lead.slice(-3) >= 500, lead);
  assert.ok(+int.slice(-4) >= 5000, int);
  const day = int.slice(4, 12);
  await env.DB.prepare(`INSERT INTO interactions (interaccion_id,lead_id,fecha_hora,canal,direccion,tipo,resumen,enviado_por,registrado_por)
    SELECT ?, lead_id, '2099-01-01', 'interno', 'interna', 'nota', 'local', 'humano', 'local' FROM leads LIMIT 1`).bind(`INT-${day}-4999`).run();
  assert.equal(await nextId(env, "INT", "interactions", "interaccion_id", 4), int, "los IDs locales (<5000) no mueven el contador del Worker");
});

test("pipeline comercial: perdido exige motivo, activos exigen próxima acción, /next y /api/today", async () => {
  const { call } = await setup({ seed: "demo" });
  const s = await loginAs(call);
  const leads = (await s.get("/api/leads")).body.leads;
  const L = leads.find((x) => x.estado_pipeline === "reunion_agendada");
  assert.ok(L, "el demo tiene un lead con demo programada");
  // demo realizada exige fecha_demo y próxima acción
  assert.equal((await s.post(`/api/leads/${L.lead_id}/transition`, { to: "demo_realizada", proximo_seguimiento: "2026-11-18" })).status, 422);
  const ok = await s.post(`/api/leads/${L.lead_id}/transition`, { to: "demo_realizada", fecha_demo: "2026-11-11", proxima_accion: "Enviar propuesta", proximo_seguimiento: "2026-11-18" });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  // perdido sin motivo se rechaza; con motivo se acepta y limpia la próxima acción
  assert.equal((await s.post(`/api/leads/${L.lead_id}/transition`, { to: "perdido" })).status, 422);
  assert.equal((await s.post(`/api/leads/${L.lead_id}/transition`, { to: "perdido", motivo_perdida: "precio" })).status, 200);
  const d = (await s.get(`/api/leads/${L.lead_id}`)).body.lead;
  assert.deepEqual([d.estado_pipeline, d.motivo_perdida, d.proxima_accion], ["perdido", "precio", ""]);
  // /next actualiza la próxima acción de un lead activo
  const C = leads.find((x) => x.estado_pipeline === "contactado");
  assert.equal((await s.post(`/api/leads/${C.lead_id}/next`, { proxima_accion: "Llamar a recepción", proximo_seguimiento: "2026-11-18" })).status, 200);
  assert.equal((await s.post(`/api/leads/${C.lead_id}/next`, {})).status, 422);
  const t = (await s.get("/api/today")).body;
  for (const k of ["hoy", "acciones", "sin_accion", "por_enviar", "por_aprobar", "proximos", "seguimientos"]) assert.ok(k in t, k);
  assert.ok(![...t.acciones, ...t.proximos].some((x) => x.lead_id === L.lead_id), "un lead perdido no aparece en Hoy");
});

test("alta manual e importación CSV: candidatos por investigar, sin duplicados ni excluidos", async () => {
  const { call, env } = await setup({ seed: "demo" });
  const s = await loginAs(call);
  const lead = (await env.DB.prepare("SELECT * FROM leads WHERE telefono_e164 <> '' AND opt_out='false' LIMIT 1").first());
  const supp = (await env.DB.prepare("SELECT valor FROM suppression WHERE tipo='telefono_e164' LIMIT 1").first());
  const rows = [
    { nombre_negocio: "Clínica Nueva Prueba", nicho: "dentista", ciudad: "Morelia", estado_mx: "Michoacán", telefono_publico: "443 111 2233", google_maps_url: "https://maps.google.com/?cid=1", notas: "vista en Maps" },
    { nombre_negocio: "Duplicado del CRM", nicho: "dentista", ciudad: "X", estado_mx: "Y", telefono_publico: lead.telefono_e164, sitio_web: "https://dup.invalid" },
    { nombre_negocio: "Excluido", nicho: "dentista", ciudad: "X", estado_mx: "Y", telefono_publico: supp ? supp.valor : "", sitio_web: "https://excluido.invalid" },
    { nombre_negocio: "Sin fuente", nicho: "dentista", ciudad: "Morelia", estado_mx: "Michoacán" },
    { nombre_negocio: "Clínica Nueva Prueba", nicho: "dentista", ciudad: "Morelia", estado_mx: "Michoacán", telefono_publico: "4431112233", sitio_web: "https://otra.invalid" },
  ];
  const r0 = await s.post("/api/candidates", { rows, origen: "csv" });
  assert.equal(r0.status, 200, JSON.stringify(r0.body));
  const r = { body: r0.body.resultado };
  assert.equal(r.body.creados.length, 1);
  assert.deepEqual(r.body.duplicados.map((d) => d.fila).sort(), [2, 5]);
  assert.equal(r.body.excluidos, supp ? 1 : 0);
  assert.deepEqual(r.body.invalidos.map((d) => d.fila), supp ? [4] : [3, 4].filter((f) => f === 4));
  const c = await env.DB.prepare("SELECT * FROM candidates WHERE id=?").bind(r.body.creados[0].id).first();
  const data = JSON.parse(c.data);
  assert.deepEqual([c.estado, data.telefono_e164, data.fuente_url], ["revision", "+524431112233", "https://maps.google.com/?cid=1"]);
  assert.ok(c.dossier.includes("vista en Maps"));
  const rev = (await s.get("/api/research")).body.revision.find((x) => x.archivo === c.id);
  assert.equal(rev.calificado, false); assert.equal(rev.listo_para_registrar, false);
  if (supp) assert.ok(!(await env.DB.prepare("SELECT data FROM candidates WHERE lote LIKE 'csv-%'").all()).results.some((x) => x.data.includes(supp.valor)), "el dato excluido no se guarda");
  assert.equal((await s.post("/api/candidates", { rows: Array.from({ length: 101 }, () => rows[0]) })).status, 422);
});

test("agente (AGENT_TOKEN): sube y registra candidatos, redacta y recalifica; nunca aprueba, envía, da de baja ni lee exclusiones", async () => {
  const AG = "tok-agente-0123456789abcdef";
  const { call, env } = await setup({ seed: "demo", extraVars: { AGENT_TOKEN: AG } });
  const H = { Authorization: `Bearer ${AG}`, "Content-Type": "application/json" };
  const get = (p) => call(p, { headers: H });
  const post = (p, b) => call(p, { method: "POST", headers: H, body: JSON.stringify(b) });
  // lectura limitada
  const ls = await get("/api/agent/leads");
  assert.equal(ls.status, 200);
  assert.ok(ls.body.leads.length > 0 && !("notas" in ls.body.leads[0]) && !("evidencias" in ls.body.leads[0]));
  for (const p of ["/api/export/suppression.csv", "/api/leads", "/api/summary", "/api/events?limit=5"]) assert.notEqual((await get(p)).status, 200, p);
  // candidato calificado del demo → reenviado por el agente → registrado
  const cands = (await env.DB.prepare("SELECT * FROM candidates WHERE estado='revision' AND data LIKE '%calificacion%'").all()).results;
  let up = null, bad = null;
  for (const c0 of cands) {
    const r = await post("/api/agent/candidates", { candidato: JSON.parse(c0.data), dossier: c0.dossier || "# dossier" });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    if (r.body.resultado.listo_para_registrar && !up) up = r; else if (!r.body.resultado.listo_para_registrar) bad = r;
  }
  assert.ok(up, "el demo tiene al menos un candidato listo para registrar");
  if (bad) assert.notEqual((await post(`/api/agent/candidates/${bad.body.resultado.id}/register`, {})).status, 200, "uno incoherente no se registra");
  const reg = await post(`/api/agent/candidates/${up.body.resultado.id}/register`, {});
  assert.equal(reg.status, 200, JSON.stringify(reg.body));
  const leadId = reg.body.resultado.registrado;
  // borrador y paso a pendiente de aprobación
  assert.equal((await post(`/api/agent/leads/${leadId}/draft`, { content: "---\nestado: mensaje_borrador\n---\nHola" })).status, 200);
  assert.equal((await post(`/api/agent/leads/${leadId}/update`, { set: { estado_pipeline: "mensaje_borrador" } })).status, 200);
  assert.equal((await post(`/api/agent/leads/${leadId}/update`, { set: { estado_pipeline: "pendiente_aprobacion", aprobacion_estado: "pendiente" } })).status, 200);
  // prohibido: aprobar, tocar la baja, clasificación incoherente, rutas de sesión
  assert.notEqual((await post(`/api/agent/leads/${leadId}/update`, { set: { estado_pipeline: "aprobado" } })).status, 200);
  assert.notEqual((await post(`/api/agent/leads/${leadId}/update`, { set: { aprobacion_estado: "aprobado", aprobado_por: "Ana" } })).status, 200);
  assert.notEqual((await post(`/api/agent/leads/${leadId}/update`, { set: { opt_out: "true" } })).status, 200);
  assert.notEqual((await post(`/api/agent/leads/${leadId}/update`, { set: { clasificacion: "A" } })).status, 200);
  assert.equal((await post(`/api/leads/${leadId}/approve`, {})).status, 403);
  assert.equal((await post(`/api/leads/${leadId}/optout`, { fuente: "x" })).status, 403);
  assert.equal((await post(`/api/leads/${leadId}/interaction`, { direccion: "saliente", tipo: "mensaje_inicial", canal: "email", resumen: "x" })).status, 403);
  const L = await env.DB.prepare("SELECT estado_pipeline, aprobacion_estado, opt_out FROM leads WHERE lead_id=?").bind(leadId).first();
  assert.deepEqual([L.estado_pipeline, L.aprobacion_estado, L.opt_out], ["pendiente_aprobacion", "pendiente", "false"]);
  const ints = (await env.DB.prepare("SELECT direccion FROM interactions WHERE lead_id=?").bind(leadId).all()).results;
  assert.ok(!ints.some((i) => i.direccion === "saliente"), "el agente nunca genera interacciones salientes");
});
