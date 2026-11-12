// Reglas del CRM para el Worker. Fuente: data/schema/crm.schema.json (el mismo esquema que usa scripts/crm_tool.py).
// Paridad con crm_tool.py verificada en tests/worker/parity.test.mjs.
import SCHEMA from "../../data/schema/crm.schema.json" with { type: "json" };

export { SCHEMA };
export const FINALS = SCHEMA["x-estados-finales"];
export const NEEDS_FOLLOWUP = SCHEMA["x-estados-con-seguimiento"];
export const TRANSITIONS = SCHEMA["x-transiciones"];
export const STATES = SCHEMA.$defs.estadoPipeline.enum;
export const AGENT_NAMES = new Set(["claude", "agente", "agent", "lead-researcher", "lead-qualifier", "outreach-writer", "crm-manager",
  "follow-up-manager", "compliance-reviewer", "n8n", "sistema", "bot", "ia", "ai", "cli", "crm_tool", "dashboard", "api", "worker", "investigador"]);
export const GENERIC_DOMAINS = ["facebook.com", "instagram.com", "wa.me", "api.whatsapp.com", "whatsapp.com", "linktr.ee", "doctoralia.com.mx",
  "doctoralia.com", "google.com", "goo.gl", "maps.app.goo.gl", "sites.google.com", "business.site", "wixsite.com", "wordpress.com",
  "blogspot.com", "tiktok.com", "youtube.com", "seccionamarilla.com.mx", "topdoctors.mx", "linkedin.com", "x.com", "twitter.com"];
export const HEADERS = Object.fromEntries(["lead", "interaccion", "seguimiento", "supresion"].map((k) => [k, Object.keys(SCHEMA.$defs[k].properties)]));
export const CONTACT_FIELDS = ["telefono_e164", "whatsapp_publico", "email_publico", "instagram_url", "facebook_url"];
const TZ_BY_STATE = { sonora: "America/Hermosillo", "baja california": "America/Tijuana", "quintana roo": "America/Cancun",
  "baja california sur": "America/Mazatlan", sinaloa: "America/Mazatlan", nayarit: "America/Mazatlan", chihuahua: "America/Chihuahua" };

export class CRMError extends Error { constructor(msg, status = 422) { super(msg); this.status = status; } }

// ------------------------------------------------------------------ texto
export const stripAccents = (s) => (s || "").normalize("NFKD").replace(/[̀-ͯ]/g, "");
export function normalizeName(s) {
  let t = stripAccents(s).toLowerCase().trim();
  t = t.replace(/\b(s\.? ?a\.?( de c\.? ?v\.?)?|s\.? de r\.?l\.?( de c\.? ?v\.?)?|s\.?c\.?|a\.?c\.?)\s*$/, "");
  return t.replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}
export function domainOf(url) {
  if (!url) return "";
  const m = url.trim().toLowerCase().match(/^(?:https?:\/\/)?([^/:?#]+)/);
  const d = m ? m[1] : "";
  return d.startsWith("www.") ? d.slice(4) : d;
}
export const isGeneric = (d) => GENERIC_DOMAINS.some((g) => d === g || d.endsWith("." + g));
export const tzFor = (estado) => TZ_BY_STATE[normalizeName(estado)] || "America/Mexico_City";

// ------------------------------------------------------------------ fechas (America/Mexico_City)
export function nowIso(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}-06:00`;
}
export const todayIso = () => nowIso().slice(0, 10);
const nthWeekday = (y, m, wd, n) => { const d = new Date(Date.UTC(y, m - 1, 1)); const off = (wd - d.getUTCDay() + 7) % 7; return new Date(Date.UTC(y, m - 1, 1 + off + 7 * (n - 1))); };
const iso = (d) => d.toISOString().slice(0, 10);
export function mxHolidays(year) {
  const h = { [`${year}-01-01`]: "Año Nuevo", [iso(nthWeekday(year, 2, 1, 1))]: "Día de la Constitución", [iso(nthWeekday(year, 3, 1, 3))]: "Natalicio de Benito Juárez",
    [`${year}-05-01`]: "Día del Trabajo", [`${year}-09-16`]: "Día de la Independencia", [iso(nthWeekday(year, 11, 1, 3))]: "Día de la Revolución", [`${year}-12-25`]: "Navidad" };
  if ((year - 2024) % 6 === 0) h[`${year}-10-01`] = "Transmisión del Poder Ejecutivo Federal";
  for (const e of SCHEMA["x-dias-inhabiles-extra"] || []) if (e.fecha.startsWith(String(year))) h[e.fecha] = e.motivo;
  return Object.fromEntries(Object.entries(h).sort());
}
export function contactDayProblem(dateStr) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr || "")) return "fecha inválida";
  const d = new Date(dateStr + "T12:00:00Z");
  if (d.getUTCDay() === 0) return "domingo";
  const hol = mxHolidays(d.getUTCFullYear())[dateStr];
  return hol ? `día de descanso obligatorio (${hol})` : null;
}

// ------------------------------------------------------------------ validador (mismo subconjunto de JSON Schema que crm_tool.py)
const resolve = (s) => { while (s && s.$ref) s = SCHEMA.$defs[s.$ref.split("/").pop()]; return s; };
const typeOk = (v, t) => ({ string: typeof v === "string", integer: Number.isInteger(v), number: typeof v === "number", boolean: typeof v === "boolean",
  array: Array.isArray(v), object: v !== null && typeof v === "object" && !Array.isArray(v), null: v === null })[t] ?? true;
export function validate(s, v, path = "$") {
  s = resolve(s); const errs = [];
  if (s.type) { const ts = [].concat(s.type); if (!ts.some((t) => typeOk(v, t))) return [`${path}: tipo inválido, se esperaba ${ts.join("|")}`]; }
  if ("const" in s && v !== s.const) errs.push(`${path}: debe ser ${JSON.stringify(s.const)}`);
  if (s.enum && !s.enum.includes(v)) errs.push(`${path}: ${JSON.stringify(v)} fuera de catálogo`);
  if (typeof v === "string") {
    if (s.pattern && !new RegExp(s.pattern).test(v)) errs.push(`${path}: ${JSON.stringify(v)} no cumple el formato`);
    if (v.length < (s.minLength || 0)) errs.push(`${path}: demasiado corto`);
    if (s.maxLength != null && v.length > s.maxLength) errs.push(`${path}: demasiado largo`);
    if (s.format === "email" && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) errs.push(`${path}: email inválido`);
  }
  if (typeof v === "number") {
    if (s.minimum != null && v < s.minimum) errs.push(`${path}: menor que ${s.minimum}`);
    if (s.maximum != null && v > s.maximum) errs.push(`${path}: mayor que ${s.maximum}`);
  }
  if (Array.isArray(v)) {
    v.forEach((it, i) => errs.push(...validate(s.items || {}, it, `${path}[${i}]`)));
    if (s.uniqueItems && new Set(v.map((x) => JSON.stringify(x))).size !== v.length) errs.push(`${path}: elementos repetidos`);
  }
  if (v && typeof v === "object" && !Array.isArray(v)) {
    for (const k of s.required || []) if (!(k in v)) errs.push(`${path}.${k}: obligatorio`);
    for (const [k, val] of Object.entries(v)) {
      if (s.properties && k in s.properties) errs.push(...validate(s.properties[k], val, `${path}.${k}`));
      else if (s.additionalProperties === false) errs.push(`${path}.${k}: campo no permitido`);
    }
    for (const [k, deps] of Object.entries(s.dependentRequired || {})) if (k in v) for (const d of deps) if (!(d in v)) errs.push(`${path}.${d}: obligatorio si existe ${k}`);
  }
  if (s.anyOf && !s.anyOf.some((sub) => validate(sub, v, path).length === 0)) errs.push(`${path}: ${JSON.stringify(v)} no cumple ninguna alternativa`);
  for (const sub of s.allOf || []) {
    if (sub.if) { if (validate(sub.if, v, path).length === 0) errs.push(...validate(sub.then || {}, v, path)); }
    else errs.push(...validate(sub, v, path));
  }
  return errs;
}
const allowedTypes = (s) => { s = resolve(s); const out = new Set(); if (s.type) [].concat(s.type).forEach((t) => out.add(t));
  (s.anyOf || []).forEach((x) => allowedTypes(x).forEach((t) => out.add(t))); if (s.enum) out.add("string");
  if ("const" in s) out.add(typeof s.const === "boolean" ? "boolean" : "string"); if (!out.size) out.add("string"); return out; };
export function coerceRow(defName, row) {
  const props = SCHEMA.$defs[defName].properties; const obj = {};
  for (const [k, v] of Object.entries(row)) {
    if (v == null || v === "") continue;
    const t = allowedTypes(props[k] || {}); const sv = String(v);
    if (t.has("boolean") && (sv === "true" || sv === "false")) obj[k] = sv === "true";
    else if (t.has("integer") && /^-?\d+$/.test(sv)) obj[k] = parseInt(sv, 10);
    else if (t.has("number") && /^-?\d+(\.\d+)?$/.test(sv)) obj[k] = parseFloat(sv);
    else obj[k] = sv;
  }
  return obj;
}
export const validateRow = (defName, row) => validate(SCHEMA.$defs[defName], coerceRow(defName, row), defName);

// ------------------------------------------------------------------ calificación
export function expectedOpportunity(senales) {
  const pts = SCHEMA["x-senales-puntos"], r = SCHEMA["x-oportunidad-reglas"]; let s = new Set(senales);
  if (s.has("WEB_NONE")) r.WEB_NONE_excluye.forEach((x) => s.delete(x));
  return Math.min(r.tope, [...s].reduce((a, x) => a + (pts[x] || 0), 0));
}
export function expectedClass(cal, descalificadores = []) {
  const r = SCHEMA["x-clasificacion"];
  if (descalificadores.length || cal.puntaje_total < r.descartado_si_total_menor_a) return "descartado";
  for (const k of ["A", "B"]) { const c = r[k]; if (cal.puntaje_total >= c.total_min && cal.senales_oportunidad.length >= c.senales_min && cal.puntaje_contacto >= c.contacto_min) return k; }
  return "C";
}
export function evidenceConfidence(evid, senal) {
  const rank = { alta: 3, media: 2, baja: 1 }; const vals = evid.filter((e) => e.senal === senal).map((e) => e.confianza || "media");
  return vals.length ? vals.sort((a, b) => rank[b] - rank[a])[0] : null;
}
// Rúbrica v2 (x-rubrica-v2): mismas reglas que scripts/crm_tool.py › check_qualification_v2.
export function expectedClassV2(cal, descalificadores = []) {
  const r = SCHEMA["x-rubrica-v2"];
  if (descalificadores.length || cal.puntaje_total < r.descartado_si_total_menor_a) return "descartado";
  for (const k of ["A", "B"]) { const c = r[k]; if (cal.puntaje_total >= c.total_min && cal.senales_oportunidad.length >= c.senales_min && cal.criterios.contacto >= c.contacto_min) return k; }
  return "C";
}
export function checkQualificationV2(cal, evid, descalificadores = [], rec = {}) {
  const r = SCHEMA["x-rubrica-v2"], crit = cal.criterios, errs = [];
  for (const [k, mx] of Object.entries(r.maximos)) if (!Number.isInteger(crit[k]) || crit[k] < 0 || crit[k] > mx) errs.push(`criterios.${k} debe ser entero entre 0 y ${mx}`);
  if (errs.length) return errs;
  for (const [b, keys] of Object.entries(r.bloques)) { const s = keys.reduce((a, k) => a + crit[k], 0); if (cal[b] !== s) errs.push(`${b} ${cal[b]} ≠ ${keys.join(" + ")} = ${s}`); }
  const sum = Object.values(crit).reduce((a, x) => a + x, 0); if (cal.puntaje_total !== sum) errs.push(`puntaje_total ${cal.puntaje_total} ≠ suma de criterios ${sum}`);
  const missing = cal.senales_oportunidad.filter((x) => evidenceConfidence(evid, x) === null); if (missing.length) errs.push(`señales sin evidencia: ${missing}`);
  const weak = cal.senales_oportunidad.filter((x) => evidenceConfidence(evid, x) === "baja");
  if (weak.length) errs.push(`PENDIENTE DE REVISIÓN: señales solo con evidencia de confianza baja ${weak}; verifícalas (o quítalas) antes de registrar`);
  if (crit.problema && !cal.senales_oportunidad.length) errs.push("criterios.problema > 0 exige al menos una señal del catálogo con evidencia");
  if (crit.whatsapp > 8 && !rec.whatsapp_publico) errs.push("criterios.whatsapp > 8 exige whatsapp_publico verificado");
  if (crit.contacto && !CONTACT_FIELDS.some((f) => rec[f])) errs.push("criterios.contacto > 0 exige al menos un canal de contacto verificado");
  const nr = String(rec.num_resenas ?? "").trim();
  const expVol = /^\d+$/.test(nr) ? r.volumen_por_resenas.find((x) => +nr >= x.min).puntos : 0;
  if (crit.volumen !== expVol) errs.push(`criterios.volumen ${crit.volumen} ≠ ${expVol} según num_resenas=${nr || "desconocido"} (sin dato = 0)`);
  const exp = expectedClassV2(cal, descalificadores); if (cal.clasificacion !== exp) errs.push(`clasificación ${cal.clasificacion} ≠ ${exp} según x-rubrica-v2`);
  return errs;
}
export function checkQualification(cal, evid, descalificadores = [], rec = {}) {
  if (cal.criterios) return checkQualificationV2(cal, evid, descalificadores, rec);
  const errs = []; const parts = cal.puntaje_icp + cal.puntaje_oportunidad + cal.puntaje_contacto + cal.puntaje_capacidad;
  if (parts !== cal.puntaje_total) errs.push(`puntaje_total ${cal.puntaje_total} ≠ suma de subpuntajes ${parts}`);
  const missing = cal.senales_oportunidad.filter((x) => evidenceConfidence(evid, x) === null); if (missing.length) errs.push(`señales sin evidencia: ${missing}`);
  const weak = cal.senales_oportunidad.filter((x) => evidenceConfidence(evid, x) === "baja");
  if (weak.length) errs.push(`PENDIENTE DE REVISIÓN: señales solo con evidencia de confianza baja ${weak}; verifícalas (o quítalas) antes de registrar`);
  const op = expectedOpportunity(cal.senales_oportunidad); if (cal.puntaje_oportunidad !== op) errs.push(`puntaje_oportunidad ${cal.puntaje_oportunidad} ≠ ${op} según catálogo de señales`);
  const exp = expectedClass(cal, descalificadores); if (cal.clasificacion !== exp) errs.push(`clasificación ${cal.clasificacion} ≠ ${exp} según x-clasificacion`);
  return errs;
}

// ------------------------------------------------------------------ claves de duplicados / exclusión
export function leadKeys(L) {
  const keys = [];
  for (const f of ["telefono_e164", "whatsapp_publico"]) if (L[f]) keys.push(["telefono_e164", L[f]]);
  if (L.email_publico) keys.push(["email", L.email_publico.trim().toLowerCase()]);
  const dom = L.dominio || domainOf(L.sitio_web || ""); if (dom && !isGeneric(dom)) keys.push(["dominio", dom]);
  if (L.google_place_id) keys.push(["google_place_id", L.google_place_id]);
  const nn = L.nombre_normalizado || normalizeName(L.nombre_negocio || ""); if (nn && L.ciudad) keys.push(["nombre_ciudad", `${nn}|${normalizeName(L.ciudad)}`]);
  const seen = new Set(); return keys.filter((k) => { const s = k.join("\u0000"); if (seen.has(s)) return false; seen.add(s); return true; });
}
export function findDuplicates(cand, leads, excludeId = null) {
  const exact = [], possible = []; const ck = leadKeys(cand); const maps = cand.google_maps_url || "";
  for (const L of leads) {
    if (L.lead_id === excludeId) continue;
    const lk = new Set(leadKeys(L).map((k) => k.join("\u0000")));
    const hard = ck.filter((k) => k[0] !== "nombre_ciudad" && lk.has(k.join("\u0000")));
    if (maps && maps === L.google_maps_url) hard.push(["google_maps_url", maps]);
    if (hard.length) exact.push([L.lead_id, hard]);
    else if (ck.some((k) => k[0] === "nombre_ciudad" && lk.has(k.join("\u0000")))) possible.push([L.lead_id, normalizeName(L.direccion || "") === normalizeName(cand.direccion || "")]);
  }
  return { exact, possible };
}
export function suppressedHits(L, supp) {
  const s = new Set(supp.map((r) => `${r.tipo}\u0000${r.valor.trim().toLowerCase()}`));
  return leadKeys(L).filter(([t, v]) => s.has(`${t}\u0000${v.toLowerCase()}`));
}
export const toCell = (v) => (typeof v === "boolean" ? String(v) : Array.isArray(v) ? v.join(";") : v == null ? "" : String(v));
