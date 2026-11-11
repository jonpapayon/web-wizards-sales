import { test } from "node:test";
import assert from "node:assert/strict";
import { setup, loginAs, bearer } from "./helpers.mjs";
import { buildUrl, denueCall, toBusiness, phoneE164, normalizeSite } from "../../cloudflare/src/denue.js";
import * as engine from "../../cloudflare/src/engine.js";

const DENUE_FIXTURE = [
  { CLEE: "21114621211000011000000000U1", Id: "9001", Nombre: "CONSULTORIO DENTAL PRUEBA UNO", Razon_social: "", Clase_actividad: "Consultorios dentales del sector privado",
    Estrato: "0 a 5 personas", Tipo_vialidad: "CALLE", Calle: "5 SUR", Num_Exterior: "100", Num_Interior: "", Colonia: "CENTRO", CP: "72000",
    Ubicacion: "PUEBLA, Puebla, PUEBLA", Telefono: "2220000001", Correo_e: "", Sitio_internet: "www.prueba-uno.mx", Tipo: "Fijo", Longitud: "-98.2", Latitud: "19.04" },
  { CLEE: "x2", Id: "9002", Nombre: "CLINICA DENTAL SIN SITIO", Clase_actividad: "Consultorios dentales del sector privado", Estrato: "6 a 10 personas",
    Calle: "REFORMA", Num_Exterior: "20", Colonia: "LA PAZ", CP: "72160", Ubicacion: "PUEBLA, Puebla, PUEBLA", Telefono: "222 000 0002", Correo_e: "citas@sinsitio.mx", Sitio_internet: "" },
  { CLEE: "x3", Id: "9003", Nombre: "DUPLICADO DE AITELI", Clase_actividad: "Consultorios dentales del sector privado", Estrato: "0 a 5 personas",
    Ubicacion: "PUEBLA, Puebla, PUEBLA", Telefono: "2222661237", Sitio_internet: "" },
  { CLEE: "x4", Id: "9004", Nombre: "DENTISTA EN OTRO MUNICIPIO", Ubicacion: "CHOLULA, San Andrés Cholula, PUEBLA", Telefono: "2220000004" },
];
const mockFetch = (calls) => async (url) => { calls.push(url); return new Response(JSON.stringify(DENUE_FIXTURE), { status: 200, headers: { "Content-Type": "application/json" } }); };

test("DENUE: plantillas de URL oficiales y el token nunca en la clave de caché", () => {
  assert.equal(buildUrl("Ficha", { id: "34185" }, "T0K"), "https://www.inegi.org.mx/app/api/denue/v1/consulta/Ficha/34185/T0K");
  assert.equal(buildUrl("Buscar", { condicion: "dental", lat: 19.04, lon: -98.2, metros: 9000 }, "T"), "https://www.inegi.org.mx/app/api/denue/v1/consulta/Buscar/dental/19.04,-98.2/5000/T");
  assert.equal(buildUrl("BuscarEntidad", { condicion: "dental", entidad: "21", ini: 1, fin: 100 }, "T"), "https://www.inegi.org.mx/app/api/denue/v1/consulta/BuscarEntidad/dental/21/1/100/T");
  assert.match(buildUrl("BuscarAreaAct", { entidad: "21", municipio: "114", clase: "621211" }, "T"), /BuscarAreaAct\/21\/114\/0\/0\/0\/0\/0\/0\/621211\/0\/1\/100\/0\/T$/);
  assert.ok(!buildUrl("Ficha", { id: "1" }, null).includes("T0K"));
});

test("DENUE: sin token → preparado pero no conectado (503), sin inventar datos", async () => {
  const { env } = await setup({ seed: null });
  await assert.rejects(denueCall(env, "Ficha", { id: "1" }), (e) => e.status === 503 && /no configurado/.test(e.message));
});

test("DENUE: caché, errores HTTP y respuestas no JSON", async () => {
  const { env } = await setup({ seed: null, extraVars: { DENUE_TOKEN: "secreto-denue" } });
  const calls = [];
  const r1 = await denueCall(env, "Ficha", { id: "9001" }, { fetchImpl: mockFetch(calls) });
  const r2 = await denueCall(env, "Ficha", { id: "9001" }, { fetchImpl: mockFetch(calls) });
  assert.equal(calls.length, 1); assert.equal(r1.cache, false); assert.equal(r2.cache, true);
  const cached = (await env.DB.prepare("SELECT clave, respuesta FROM source_cache").all()).results;
  assert.ok(cached.every((c) => !c.clave.includes("secreto-denue") && !c.respuesta.includes("secreto-denue")));
  await assert.rejects(denueCall(env, "Ficha", { id: "1" }, { fetchImpl: async () => new Response("no autorizado", { status: 401 }) }), /HTTP 401/);
  await assert.rejects(denueCall(env, "Ficha", { id: "2" }, { fetchImpl: async () => new Response("<html>error</html>", { status: 200 }) }), /no JSON/);
});

test("DENUE: mapeo de fichas sin completar datos faltantes", () => {
  const b = toBusiness(DENUE_FIXTURE[0], "2026-11-11T10:00:00-06:00");
  assert.equal(b.ref_id, "9001"); assert.equal(b.telefono_e164, "+522220000001"); assert.equal(b.sitio_web, "http://www.prueba-uno.mx");
  assert.equal(b.municipio, "Puebla"); assert.ok(b.no_encontrado_denue.includes("email_publico"));
  assert.equal(phoneE164("22200"), ""); assert.equal(normalizeSite("0"), "");
});

test("motor: solicitud con DENUE → deduplica (piloto), filtra municipio y encola trabajos", async () => {
  const { env, call } = await setup({ seed: "real", extraVars: { DENUE_TOKEN: "secreto-denue" } });
  const calls = [];
  const r = await engine.createRequest(env, { nicho: "dentista", estado_mx: "Puebla", municipio: "Puebla", cantidad: 5, fuentes: ["denue"] }, "dashboard:Ana Revisora", { fetchImpl: mockFetch(calls) });
  assert.equal(r.encontrados, 3, "3 en el municipio de Puebla");
  assert.equal(r.duplicados, 1, "el teléfono de Aiteli ya está en el CRM");
  const jobs = (await env.DB.prepare("SELECT tipo, target FROM research_jobs ORDER BY id").all()).results;
  assert.deepEqual(jobs.map((j) => j.tipo), ["site_audit", "sin_sitio"]);
  assert.match(calls[0], /BuscarEntidad\/dental\/21\//);
});

test("motor + investigador: trabajo → evidencia verificada/inferida → candidato en revisión → registro con id DENUE", async () => {
  const { env, call } = await setup({ seed: "real", extraVars: { DENUE_TOKEN: "secreto-denue" } });
  const s = await loginAs(call);
  await engine.createRequest(env, { nicho: "dentista", estado_mx: "Puebla", municipio: "Puebla", cantidad: 5, fuentes: ["denue"], criterios: { clases: ["A", "B", "C"], puntaje_min: 0 } }, "dashboard:Ana", { fetchImpl: mockFetch([]) });
  const w = bearer(call, "tok-worker-0123456789abcdef");
  const j1 = (await w.post("/api/worker/claim", { worker_id: "mac-test" })).body.trabajo;
  assert.equal(j1.tipo, "site_audit");
  const res = await w.post(`/api/worker/jobs/${j1.id}/result`, { estado: "hecho", resultado: { motor: "playwright", status: 200, duracion_s: 4.2,
    evidencias: [
      { senal: "WEB_BROKEN", confianza: "alta", url: "http://www.prueba-uno.mx/citas", observacion: "El enlace 'Agenda tu cita' (href /citas) devuelve HTTP 404.", metodo: "HTML crudo + HEAD" },
      { senal: "WEB_NOT_MOBILE", confianza: "alta", url: "http://www.prueba-uno.mx/", observacion: "En vista móvil de 375 px el contenido mide 980 px: desplazamiento horizontal.", metodo: "Playwright 375×812" },
      { senal: "WEB_OUTDATED", confianza: "baja", url: "http://www.prueba-uno.mx/", observacion: "Inferencia: el diseño parece antiguo (sin fecha visible).", metodo: "inferencia" }],
    datos: { tel: ["2220000001"], mailto: ["hola@prueba-uno.mx"], servicios: ["implantes"] }, no_encontrado: ["enlace de WhatsApp"],
    capturas: [{ vista: "movil", path: "data/research/capturas/job1-movil.png", sha256: "ab".repeat(32) }] } });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const cand = res.body.resultado;
  const c = await env.DB.prepare("SELECT * FROM candidates WHERE id=?").bind(cand.candidato).first();
  const data = JSON.parse(c.data);
  assert.deepEqual(data.calificacion.senales_oportunidad.sort(), ["WEB_BROKEN", "WEB_NOT_MOBILE"], "la evidencia inferida no puntúa");
  assert.ok(data.evidencias.some((e) => e.confianza === "baja" && e.senal === "WEB_OUTDATED"), "la inferida se conserva como tal");
  assert.ok(c.dossier.includes("Evidencia inferida") && c.dossier.includes("No encontrado"));
  const j2 = (await w.post("/api/worker/claim", { worker_id: "mac-test" })).body.trabajo;
  assert.equal(j2.tipo, "sin_sitio");
  const r2 = await w.post(`/api/worker/jobs/${j2.id}/result`, { estado: "hecho", resultado: { motor: "ninguno", evidencias: [], no_encontrado: ["sitio web"] } });
  const c2 = JSON.parse((await env.DB.prepare("SELECT data FROM candidates WHERE id=?").bind(r2.body.resultado.candidato).first()).data);
  assert.ok(c2.evidencias.some((e) => e.senal === "WEB_NONE" && e.confianza === "baja"), "WEB_NONE desde directorio es inferida");
  assert.ok(!c2.calificacion.senales_oportunidad.includes("WEB_NONE"));
  const rev = await s.get("/api/research");
  const item = rev.body.revision.find((x) => x.archivo === cand.candidato);
  assert.ok(item, "en el área de revisión");
  assert.equal(item.listo_para_registrar, true, JSON.stringify(item.errores));
  assert.equal(item.clasificacion, "B");
  const reg = await s.post("/api/review/register", { archivo: cand.candidato });
  assert.equal(reg.status, 200, JSON.stringify(reg.body));
  const lid = reg.body.resultado.registrado;
  const src = await env.DB.prepare("SELECT * FROM lead_sources WHERE lead_id=?").bind(lid).first();
  assert.equal(src.ref_id, "9001"); assert.equal(src.fuente, "denue");
  const det = await s.get(`/api/leads/${lid}`);
  assert.ok(det.body.dossier.includes(`| lead_id | ${lid} |`)); assert.equal(det.body.evidencia.evidencias.length, 3);
  const req = (await s.get("/api/prospecting")).body.solicitudes[0];
  assert.equal(req.investigados, 2); assert.equal(req.estado, "completada");
});

test("ámbitos de tokens: investigador, n8n y eventos no pueden aprobar, dar de baja ni leer el CRM completo", async () => {
  const { call } = await setup({ seed: "real" });
  const w = bearer(call, "tok-worker-0123456789abcdef"), n = bearer(call, "tok-n8n-0123456789abcdef"), e = bearer(call, "tok-events-0123456789abcdef");
  assert.equal((await w.get("/api/leads")).status, 403);
  assert.equal((await w.post("/api/leads/WW-20261111-001/approve", {})).status, 403);
  assert.equal((await n.post("/api/leads/WW-20261111-001/optout", { fuente: "x" })).status, 403);
  assert.equal((await n.get("/api/leads")).status, 403);
  assert.equal((await e.get("/api/summary")).status, 403);
  assert.equal((await e.get("/api/events")).status, 200);
  assert.equal((await bearer(call, "token-falso").get("/api/events")).status, 401);
  const t = await n.post("/api/integrations/n8n/tasks", { tipo: "seguimiento", titulo: "Llamar mañana", lead_id: "WW-20261111-003" });
  assert.equal(t.status, 200);
  const dup = await n.post("/api/integrations/n8n/tasks", { tipo: "seguimiento", titulo: "Llamar mañana", lead_id: "WW-20261111-003" });
  assert.equal(dup.body.duplicada, true);
  assert.equal((await n.post("/api/integrations/n8n/tasks", { tipo: "enviar_whatsapp", titulo: "x y z" })).status, 422);
});
