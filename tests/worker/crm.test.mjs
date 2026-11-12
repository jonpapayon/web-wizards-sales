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
