// Acceso a D1. Toda escritura de varias tablas usa env.DB.batch(), que D1 ejecuta como una transacción.
import { CRMError, nowIso } from "./rules.js";

export const q = (env, sql, ...p) => env.DB.prepare(sql).bind(...p);
export async function all(env, sql, ...p) { return (await q(env, sql, ...p).all()).results || []; }
export async function first(env, sql, ...p) { return (await q(env, sql, ...p).first()) ?? null; }
export async function run(env, sql, ...p) { return q(env, sql, ...p).run(); }

// Traduce errores de restricciones/triggers de la base a mensajes comprensibles.
export async function tx(env, stmts) {
  try { return await env.DB.batch(stmts); }
  catch (e) {
    const m = String(e && e.message || e);
    if (/(inmutable|anexado|no se modifica|no se borra|no permitida|exclusión|resuelto|cerrado|versionado|reactiva|se cancelan|se rechazan|se cierran)/i.test(m))
      throw new CRMError(m.replace(/^.*?D1_ERROR:\s*/i, "").replace(/:\s*SQLITE_[A-Z_]+.*$/, "").replace(/^Error:\s*/, "").trim());
    if (/UNIQUE constraint failed: leads\./i.test(m) || /ux_leads_/i.test(m)) throw new CRMError("Duplicado: ya existe un lead con el mismo teléfono, email, dominio o place_id.");
    if (/CHECK constraint failed/i.test(m)) throw new CRMError("Datos inválidos según las restricciones del CRM: " + m.replace(/^.*CHECK constraint failed:?\s*/i, "").slice(0, 200));
    throw e;
  }
}

export const auditStmt = (env, evento, actor, entidad, detalle = {}) =>
  q(env, "INSERT INTO audit_log (ts,evento,actor,entidad,entorno,detalle) VALUES (?,?,?,?,?,?)",
    nowIso(), evento, actor || "api", String(entidad), env.WW_ENTORNO || "real", JSON.stringify(detalle));

export async function nextId(env, prefix, table, col, width) {
  const day = nowIso().slice(0, 10).replaceAll("-", "");
  const base = `${prefix}-${day}-`;
  const r = await first(env, `SELECT MAX(CAST(substr(${col}, ${base.length + 1}) AS INTEGER)) AS n FROM ${table} WHERE ${col} LIKE ?`, base + "%");
  const n = (r?.n || 0) + 1;
  if (n >= 10 ** width) throw new CRMError(`Se agotó el consecutivo diario de ${prefix}`);
  return base + String(n).padStart(width, "0");
}

export async function latestDoc(env, path) {
  return first(env, "SELECT * FROM documents WHERE path = ? ORDER BY version DESC LIMIT 1", path);
}
export async function docsFor(env, leadId, kind) {
  return all(env, `SELECT d.* FROM documents d JOIN (SELECT path, MAX(version) v FROM documents WHERE lead_id = ? AND kind = ? GROUP BY path) m
                   ON d.path = m.path AND d.version = m.v ORDER BY d.path`, leadId, kind);
}
export async function sha256Hex(text) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
export async function docStmt(env, path, kind, leadId, content, actor) {
  const r = await first(env, "SELECT COALESCE(MAX(version),0) AS v FROM documents WHERE path = ?", path);
  return q(env, "INSERT INTO documents (path,kind,lead_id,version,content,sha256,creado_en,creado_por) VALUES (?,?,?,?,?,?,?,?)",
    path, kind, leadId, (r?.v || 0) + 1, content, await sha256Hex(content), nowIso(), actor);
}
