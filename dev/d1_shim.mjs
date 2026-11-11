// Emulación local de la API de Cloudflare D1 sobre node:sqlite (Node ≥ 22). Solo para desarrollo y pruebas.
// prepare().bind().all()/first()/run() y batch() transaccional, como D1.
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

class Stmt {
  constructor(db, sql, params = []) { this.db = db; this.sql = sql; this.params = params; }
  bind(...p) { return new Stmt(this.db, this.sql, p.map((v) => (v === undefined ? null : typeof v === "boolean" ? (v ? 1 : 0) : v))); }
  _st() { return this.db.prepare(this.sql); }
  async all() { return { results: this._st().all(...this.params).map((r) => ({ ...r })), success: true, meta: {} }; }
  async first(col) { const r = this._st().get(...this.params); if (r == null) return null; return col ? r[col] : { ...r }; }
  async run() { return this._runSync(); }
  async raw() { return this._st().all(...this.params).map((r) => Object.values(r)); }
  _runSync() {
    const st = this._st();
    if (/\breturning\b/i.test(this.sql)) return { results: st.all(...this.params).map((r) => ({ ...r })), success: true, meta: {} };
    const r = st.run(...this.params);
    return { success: true, meta: { changes: r.changes, last_row_id: Number(r.lastInsertRowid) } };
  }
}

export class D1Shim {
  constructor(path = ":memory:") { this.db = new DatabaseSync(path); this.db.exec("PRAGMA foreign_keys = ON"); }
  prepare(sql) { return new Stmt(this.db, sql); }
  async batch(stmts) {
    this.db.exec("BEGIN");
    try { const out = stmts.map((s) => s._runSync()); this.db.exec("COMMIT"); return out; }
    catch (e) { this.db.exec("ROLLBACK"); throw e; }
  }
  async exec(sql) { this.db.exec(sql); return { count: 1 }; }
  close() { this.db.close(); }
}

// Aplica cloudflare/migrations/*.sql con el mismo registro que usa scripts/d1_migrate.py (tabla d1_migrations).
export function applyMigrations(shim, dir) {
  shim.db.exec("CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TEXT)");
  const done = new Set(shim.db.prepare("SELECT name FROM d1_migrations").all().map((r) => r.name));
  const applied = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
    if (done.has(f)) continue;
    shim.db.exec(readFileSync(join(dir, f), "utf8"));
    shim.db.prepare("INSERT INTO d1_migrations (name, applied_at) VALUES (?, datetime('now'))").run(f);
    applied.push(f);
  }
  return applied;
}
