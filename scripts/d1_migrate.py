#!/usr/bin/env python3
"""
Migración controlada CSV → D1 (SQLite), reversible y verificable. No modifica ni borra los CSV ni las copias.

    python3 scripts/d1_migrate.py build-seed              # genera cloudflare/seed/seed_real.sql + manifest
    python3 scripts/d1_migrate.py apply-local [--db RUTA]  # crea data/d1/local.sqlite (vacía) con migraciones + seed
    python3 scripts/d1_migrate.py reconcile --db RUTA      # compara fila a fila la base con los CSV y archivos
    python3 scripts/d1_migrate.py export-csv --db RUTA --out DIR    # reversa: base → CSV con los mismos encabezados
    python3 scripts/d1_migrate.py export-csv --sql DUMP.sql --out DIR  # reversa desde `wrangler d1 export`

Remoto (lo ejecuta una persona, con sesión de Cloudflare):
    npx wrangler d1 migrations apply ww-sales --remote
    npx wrangler d1 execute ww-sales --remote --file cloudflare/seed/seed_real.sql
Variables: WW_ROOT para usar otra raíz de datos (pruebas).
"""
import argparse, csv, hashlib, json, os, sqlite3, sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

REPO = Path(__file__).resolve().parent.parent
ROOT = Path(os.environ.get("WW_ROOT") or REPO).resolve()
MIGRATIONS = sorted((REPO / "cloudflare" / "migrations").glob("*.sql"))
SEED_DIR = REPO / "cloudflare" / "seed"
TABLES = {"leads": "leads", "interactions": "interactions", "followups": "followups", "suppression": "suppression"}
ORDER = ["leads", "interactions", "followups", "suppression"]  # supresión al final: el trigger impide insertar leads suprimidos
TZ = ZoneInfo("America/Mexico_City")


def sha(s):
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


def read_csv(kind):
    with open(ROOT / "data" / "crm" / f"{kind}.csv", newline="", encoding="utf-8") as fh:
        r = csv.DictReader(fh)
        return r.fieldnames, list(r)


def schema_db():
    db = sqlite3.connect(":memory:")
    db.execute("PRAGMA foreign_keys = ON")
    for m in MIGRATIONS:
        db.executescript(m.read_text(encoding="utf-8"))
    return db


def documents():
    docs = []
    for p in sorted((ROOT / "data" / "research").glob("WW-*.md")):
        docs.append((str(p.relative_to(ROOT)), "dossier", p.name[:15], p.read_text(encoding="utf-8")))
    for p in sorted((ROOT / "data" / "research").glob("WW-*.evidence.json")):
        docs.append((str(p.relative_to(ROOT)), "evidencia", p.name[:15], p.read_text(encoding="utf-8")))
    for p in sorted((ROOT / "data" / "outreach").glob("WW-*.md")):
        docs.append((str(p.relative_to(ROOT)), "borrador", p.name[:15], p.read_text(encoding="utf-8")))
    return docs


def candidates():
    out = []
    base = ROOT / "data" / "staging"
    for p in sorted(base.glob("*/*.json")) + sorted(base.glob("*/procesados/*.json")) + sorted(base.glob("*/rechazados/*.json")):
        if p.name.startswith("_"):
            continue
        estado = {"procesados": "registrado", "rechazados": "rechazado"}.get(p.parent.name, "revision")
        lote = p.parent.parent.name if estado != "revision" else p.parent.name
        lead_id = ""
        if estado == "registrado":
            idf = p.with_suffix(".lead_id")
            lead_id = idf.read_text().strip() if idf.exists() else ""
            if not lead_id:  # piloto: buscar por evidencia respaldada
                for ev in (ROOT / "data" / "research").glob("WW-*.evidence.json"):
                    d = json.loads(ev.read_text())
                    if d.get("origen", "").endswith(p.name):
                        lead_id = d["lead_id"]
        motivo = ""
        if estado == "rechazado":
            mf = p.with_suffix(".motivo.txt")
            motivo = mf.read_text().strip() if mf.exists() else ""
        out.append((str(p.relative_to(ROOT)), lote, p.read_text(encoding="utf-8"), estado, lead_id, motivo))
    return out


def fill(db):
    now = datetime.now(TZ).replace(microsecond=0).isoformat()
    for kind in ORDER:
        fields, rows = read_csv(kind)
        q = f"INSERT INTO {TABLES[kind]} ({','.join(fields)}) VALUES ({','.join('?' * len(fields))})"
        db.executemany(q, [[r[f] for f in fields] for r in rows])
    audit = ROOT / "data" / "crm" / "audit.jsonl"
    if audit.exists():
        for line in audit.read_text(encoding="utf-8").splitlines():
            e = json.loads(line)
            db.execute("INSERT INTO audit_log (ts,evento,actor,entidad,entorno,detalle) VALUES (?,?,?,?,?,?)",
                       (e["ts"], e["evento"], e["actor"], str(e["entidad"]), e.get("entorno", "real"), json.dumps(e.get("detalle", {}), ensure_ascii=False)))
    for path, kind, lead, content in documents():
        db.execute("INSERT INTO documents (path,kind,lead_id,version,content,sha256,creado_en,creado_por) VALUES (?,?,?,1,?,?,?,?)",
                   (path, kind, lead, content, sha(content), now, "migracion-csv"))
    for cid, lote, data, estado, lead_id, motivo in candidates():
        db.execute("INSERT INTO candidates (id,lote,data,estado,lead_id,motivo,creado_en,actualizado_en) VALUES (?,?,?,?,?,?,?,?)",
                   (cid, lote, data, estado, lead_id, motivo, now, now))
    cfg = REPO / "config" / "sales_os.json"
    if cfg.exists():
        db.execute("INSERT INTO settings (clave,valor,actualizado_en,actualizado_por) VALUES ('sales_os',?,?,?)",
                   (cfg.read_text(encoding="utf-8"), now, "migracion-csv"))
    db.execute("INSERT INTO audit_log (ts,evento,actor,entidad,entorno,detalle) VALUES (?,?,?,?,?,?)",
               (now, "migracion.csv_a_d1", "migracion", "crm", "real" if ROOT == REPO else "demo",
                json.dumps(manifest_counts(), ensure_ascii=False)))
    db.commit()


def manifest_counts():
    m = {k: len(read_csv(k)[1]) for k in ORDER}
    audit = ROOT / "data" / "crm" / "audit.jsonl"
    m["audit_log"] = len(audit.read_text().splitlines()) if audit.exists() else 0
    m["documents"] = len(documents())
    m["candidates"] = len(candidates())
    return m


def cmd_build_seed(a):
    db = schema_db()
    fill(db)
    SEED_DIR.mkdir(parents=True, exist_ok=True)
    lines = [l for l in db.iterdump() if l.startswith("INSERT INTO") and not l.startswith('INSERT INTO "sqlite_sequence"')
             and not l.startswith('INSERT INTO "allowed_transitions"')]
    order = ["leads", "interactions", "followups", "suppression", "audit_log", "documents", "candidates", "settings"]
    lines.sort(key=lambda l: next((i for i, t in enumerate(order) if l.startswith(f'INSERT INTO "{t}"')), 99))
    out = SEED_DIR / ("seed_real.sql" if ROOT == REPO else "seed_demo.sql")
    header = (f"-- Seed generado por scripts/d1_migrate.py el {datetime.now(TZ).isoformat(timespec='seconds')}\n"
              f"-- Fuente: {ROOT}/data (CSV originales, sin modificar). Contiene datos de contacto: NO versionar.\n")
    out.write_text(header + "\n".join(lines) + "\n", encoding="utf-8")
    man = {"generado": datetime.now(TZ).isoformat(timespec="seconds"), "seed": str(out.relative_to(REPO)),
           "sha256_seed": sha(out.read_text(encoding="utf-8")), "conteos": manifest_counts(),
           "sha256_csv": {k: sha((ROOT / "data" / "crm" / f"{k}.csv").read_text(encoding="utf-8")) for k in ORDER}}
    (SEED_DIR / (out.stem + ".manifest.json")).write_text(json.dumps(man, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(man, ensure_ascii=False, indent=2))


def apply_migrations(db):
    db.execute("CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TEXT)")
    done = {r[0] for r in db.execute("SELECT name FROM d1_migrations")}
    for m in MIGRATIONS:
        if m.name not in done:
            db.executescript(m.read_text(encoding="utf-8"))
            db.execute("INSERT INTO d1_migrations (name, applied_at) VALUES (?, datetime('now'))", (m.name,))
    db.commit()


def cmd_apply_local(a):
    path = Path(a.db or REPO / "data" / "d1" / "local.sqlite")
    if path.exists():
        sys.exit(f"{path} ya existe. La migración solo se aplica sobre una base vacía (no sobrescribe). "
                 "Respáldala o usa otra ruta con --db.")
    path.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(path)
    db.execute("PRAGMA foreign_keys = ON")
    apply_migrations(db)
    fill(db)
    db.close()
    print(json.dumps({"base": str(path), "conteos": manifest_counts()}, ensure_ascii=False))


def table_rows(db, table, fields):
    db.row_factory = sqlite3.Row
    return [{f: ("" if r[f] is None else str(r[f])) for f in fields} for r in db.execute(f"SELECT {','.join(fields)} FROM {table}")]


def reconcile(db):
    """Devuelve lista de diferencias (vacía = base y CSV coinciden)."""
    diffs = []
    for kind in ORDER:
        fields, rows = read_csv(kind)
        key = lambda r: json.dumps(r, sort_keys=True, ensure_ascii=False)
        a, b = sorted(map(key, rows)), sorted(map(key, table_rows(db, TABLES[kind], fields)))
        if a != b:
            sa, sb = set(a), set(b)
            diffs.append({"tabla": kind, "solo_csv": len(sa - sb), "solo_db": len(sb - sa), "csv": len(a), "db": len(b)})
    audit = ROOT / "data" / "crm" / "audit.jsonl"
    if audit.exists():
        src = [json.loads(l) for l in audit.read_text(encoding="utf-8").splitlines()]
        got = [dict(ts=r["ts"], evento=r["evento"], actor=r["actor"], entidad=r["entidad"], detalle=json.loads(r["detalle"]))
               for r in db.execute("SELECT ts,evento,actor,entidad,detalle FROM audit_log WHERE evento NOT LIKE 'migracion.%' ORDER BY id")][:len(src)]
        want = [dict(ts=e["ts"], evento=e["evento"], actor=e["actor"], entidad=str(e["entidad"]), detalle=e.get("detalle", {})) for e in src]
        if got != want:
            diffs.append({"tabla": "audit_log", "csv": len(want), "db": len(got)})
    for path, kind, lead, content in documents():
        r = db.execute("SELECT sha256 FROM documents WHERE path=? ORDER BY version LIMIT 1", (path,)).fetchone()
        if not r or r[0] != sha(content):
            diffs.append({"documento": path, "estado": "falta" if not r else "distinto"})
    return diffs


def cmd_reconcile(a):
    db = sqlite3.connect(a.db)
    d = reconcile(db)
    print(json.dumps({"diferencias": d, "ok": not d, "conteos_csv": manifest_counts()}, ensure_ascii=False, indent=2))
    sys.exit(0 if not d else 1)


def cmd_export_csv(a):
    if a.sql:
        db = sqlite3.connect(":memory:")
        db.executescript(Path(a.sql).read_text(encoding="utf-8"))
    else:
        db = sqlite3.connect(a.db)
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    sys.path.insert(0, str(REPO / "scripts"))
    os.environ.setdefault("WW_ROOT", str(ROOT))
    import crm_tool
    schema = crm_tool.load_schema()
    for kind in ORDER:
        fields = crm_tool.headers(schema, kind)
        with open(out / f"{kind}.csv", "w", newline="", encoding="utf-8") as fh:
            w = csv.DictWriter(fh, fieldnames=fields)
            w.writeheader()
            order = {"leads": "lead_id", "interactions": "rowid", "followups": "rowid", "suppression": "rowid"}[kind]
            db.row_factory = sqlite3.Row
            for r in db.execute(f"SELECT {','.join(fields)} FROM {TABLES[kind]} ORDER BY {order}"):
                w.writerow({f: ("" if r[f] is None else str(r[f])) for f in fields})
    with open(out / "audit.jsonl", "w", encoding="utf-8") as fh:
        for r in db.execute("SELECT ts,evento,actor,entidad,entorno,detalle FROM audit_log ORDER BY id"):
            fh.write(json.dumps({"ts": r[0], "evento": r[1], "actor": r[2], "entidad": r[3], "entorno": r[4], "detalle": json.loads(r[5])}, ensure_ascii=False) + "\n")
    print(json.dumps({"exportado": str(out)}, ensure_ascii=False))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("build-seed")
    c = sub.add_parser("apply-local"); c.add_argument("--db")
    c = sub.add_parser("reconcile"); c.add_argument("--db", required=True)
    c = sub.add_parser("export-csv"); c.add_argument("--db"); c.add_argument("--sql"); c.add_argument("--out", required=True)
    a = ap.parse_args()
    {"build-seed": cmd_build_seed, "apply-local": cmd_apply_local, "reconcile": cmd_reconcile, "export-csv": cmd_export_csv}[a.cmd](a)


if __name__ == "__main__":
    main()
