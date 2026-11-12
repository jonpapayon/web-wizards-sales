"""Migración CSV → D1 (SQLite): reconciliación con los CSV reales, ida y vuelta y reglas en la base. No modifica data/."""
import csv, io, json, os, shutil, sqlite3, subprocess, sys, tempfile, unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
MIG = REPO / "scripts" / "d1_migrate.py"


def run(*args, root=None):
    env = {k: v for k, v in os.environ.items() if k != "WW_ROOT"}
    if root:
        env["WW_ROOT"] = str(root)
    return subprocess.run([sys.executable, str(MIG), *args], capture_output=True, text=True, env=env)


class MigrationReal(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = Path(tempfile.mkdtemp(prefix="ww-mig-"))
        cls.db = cls.tmp / "real.sqlite"
        r = run("apply-local", "--db", str(cls.db))
        assert r.returncode == 0, r.stderr

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def test_reconcile_ok(self):
        r = run("reconcile", "--db", str(self.db))
        self.assertEqual(r.returncode, 0, r.stdout)
        self.assertEqual(json.loads(r.stdout)["diferencias"], [])

    def test_pilot_preserved(self):
        db = sqlite3.connect(self.db)
        rows = dict(db.execute("SELECT lead_id, nombre_negocio || '|' || clasificacion || '|' || puntaje_total FROM leads").fetchall())
        piloto = {"WW-20261111-001": "Clínica Dental Aiteli|B|52", "WW-20261111-002": "Clínica Dental Biodental|B|52",
                  "WW-20261111-003": "Oral Health|B|58", "WW-20261111-004": "Jauckens & Castillo Dental|C|48"}
        self.assertEqual({k: rows.get(k) for k in piloto}, piloto)  # el piloto se conserva; el CRM puede crecer
        borradores = {r[0] for r in db.execute("SELECT path FROM documents WHERE kind='borrador'")}
        self.assertTrue({f"data/outreach/WW-20261111-00{i}-{s}.md" for i, s in ((1, "inicial"), (2, "inicial"), (3, "inicial"), (4, "referencia"))} <= borradores)

    def test_round_trip_csv(self):
        out = self.tmp / "rt"
        r = run("export-csv", "--db", str(self.db), "--out", str(out))
        self.assertEqual(r.returncode, 0, r.stderr)
        for k in ("leads", "interactions", "followups", "suppression"):
            a = list(csv.reader(io.StringIO((out / f"{k}.csv").read_text(encoding="utf-8"))))
            b = list(csv.reader(io.StringIO((REPO / "data" / "crm" / f"{k}.csv").read_text(encoding="utf-8"))))
            self.assertEqual(sorted(map(tuple, a)), sorted(map(tuple, b)), k)

    def test_apply_refuses_existing_db(self):
        r = run("apply-local", "--db", str(self.db))
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("no sobrescribe", r.stderr)

    def test_db_rules(self):
        db = sqlite3.connect(":memory:")
        for m in sorted((REPO / "cloudflare" / "migrations").glob("*.sql")):
            db.executescript(m.read_text(encoding="utf-8"))
        db.executescript((REPO / "cloudflare" / "seed" / "seed_real.sql").read_text(encoding="utf-8"))
        for sql, msg in [("UPDATE leads SET estado_pipeline='ganado' WHERE lead_id='WW-20261111-004'", "transición"),
                         ("DELETE FROM leads", "no se borran"), ("DELETE FROM audit_log", "anexado"), ("UPDATE audit_log SET actor='x'", "anexado"),
                         ("DELETE FROM interactions", "inmutable"), ("UPDATE leads SET lead_id='WW-20261111-999' WHERE lead_id='WW-20261111-001'", "inmutables")]:
            with self.assertRaises(sqlite3.DatabaseError, msg=sql) as cm:
                db.execute(sql)
            self.assertIn(msg, str(cm.exception))


class MigrationDemo(unittest.TestCase):
    def test_demo_with_suppression_and_audit(self):
        tmp = Path(tempfile.mkdtemp(prefix="ww-mig-demo-"))
        try:
            db = tmp / "demo.sqlite"
            self.assertEqual(run("apply-local", "--db", str(db), root=REPO / "demo").returncode, 0)
            r = run("reconcile", "--db", str(db), root=REPO / "demo")
            self.assertEqual(r.returncode, 0, r.stdout)
            c = sqlite3.connect(db)
            self.assertGreater(c.execute("SELECT COUNT(*) FROM suppression").fetchone()[0], 0)
            self.assertEqual(c.execute("SELECT estado_pipeline FROM leads WHERE opt_out='true'").fetchone()[0], "no_contactar")
            with self.assertRaises(sqlite3.DatabaseError):
                c.execute("DELETE FROM suppression")
        finally:
            shutil.rmtree(tmp, ignore_errors=True)


class SyncDelta(unittest.TestCase):
    """delta: solo altas locales que faltan en D1; conflictos reportados y nunca emitidos; carga válida en D1."""

    @classmethod
    def setUpClass(cls):
        cls.tmp = Path(tempfile.mkdtemp(prefix="ww-delta-"))

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def delta(self, remote, name):
        out = self.tmp / f"{name}.sql"
        r = run("delta", "--remote-db", str(remote), "--out", str(out))
        self.assertEqual(r.returncode, 0, r.stderr + r.stdout)
        return json.loads(r.stdout), out

    def full_remote(self, name):
        db = self.tmp / f"{name}.sqlite"
        r = run("apply-local", "--db", str(db))
        self.assertEqual(r.returncode, 0, r.stderr)
        return db

    def empty_remote(self, name):
        path = self.tmp / f"{name}.sqlite"
        db = sqlite3.connect(path)
        for m in sorted((REPO / "cloudflare" / "migrations").glob("*.sql")):
            db.executescript(m.read_text(encoding="utf-8"))
        db.close()
        return path

    def test_sin_cambios_no_genera_nada(self):
        rep, out = self.delta(self.full_remote("igual"), "igual")
        self.assertEqual(rep["total_sentencias"], 0, rep)
        self.assertEqual(rep["conflictos"], [])
        self.assertIsNone(rep["archivo"])
        self.assertFalse(out.exists())

    def test_d1_vacia_recibe_todo_y_cuadra_con_los_csv(self):
        remote = self.empty_remote("vacia")
        rep, out = self.delta(remote, "vacia")
        with open(REPO / "data" / "crm" / "leads.csv", encoding="utf-8") as fh:
            csv_leads = len(list(csv.DictReader(fh)))
        self.assertEqual(rep["insertar"]["leads"], csv_leads)
        # Carga como en D1: llaves foráneas activas y límite de patrones de 50 caracteres
        db = sqlite3.connect(remote, isolation_level=None)
        db.execute("PRAGMA foreign_keys = ON")
        db.setlimit(sqlite3.SQLITE_LIMIT_LIKE_PATTERN_LENGTH, 50)
        db.executescript("BEGIN;" + out.read_text(encoding="utf-8") + "COMMIT;")
        db.close()
        rec = run("reconcile", "--db", str(remote))
        diffs = [d for d in json.loads(rec.stdout)["diferencias"] if d.get("tabla") != "audit_log"]
        self.assertEqual(diffs, [], rec.stdout)  # audit_log no se sincroniza: cada entorno lleva el suyo
        # Segunda aplicación: falla completa (sin duplicados)
        db = sqlite3.connect(remote, isolation_level=None)
        with self.assertRaises(sqlite3.IntegrityError):
            db.executescript("BEGIN;" + out.read_text(encoding="utf-8") + "COMMIT;")
        db.execute("ROLLBACK") if db.in_transaction else None
        self.assertEqual(db.execute("SELECT COUNT(*) FROM leads").fetchone()[0], csv_leads)

    def test_conflicto_se_reporta_y_gana_d1(self):
        remote = self.full_remote("conflicto")
        db = sqlite3.connect(remote)
        lead = db.execute("SELECT lead_id FROM leads WHERE opt_out='false' ORDER BY lead_id LIMIT 1").fetchone()[0]
        db.execute("UPDATE leads SET notas = notas || ' (editado en el dashboard)' WHERE lead_id = ?", (lead,))
        db.execute("INSERT INTO audit_log (ts,evento,actor,entidad,entorno,detalle) VALUES ('2099-01-01','auth.login','x','x','real','{}')")
        db.commit(); db.close()
        rep, out = self.delta(remote, "conflicto")
        self.assertEqual(rep["total_sentencias"], 0, rep)
        self.assertEqual([(c["tabla"], c["clave"], c["campos"]) for c in rep["conflictos"]], [("leads", lead, ["notas"])])


class D1Compat(unittest.TestCase):
    """Cloudflare D1 limita los patrones LIKE/GLOB a 50 caracteres; el SQLite local no. Emula ese límite."""
    MIGS = sorted((REPO / "cloudflare" / "migrations").glob("*.sql"))

    def d1(self):
        db = sqlite3.connect(":memory:", isolation_level=None)
        db.execute("PRAGMA foreign_keys = ON")
        db.setlimit(sqlite3.SQLITE_LIMIT_LIKE_PATTERN_LENGTH, 50)
        for m in self.MIGS:
            db.executescript(m.read_text(encoding="utf-8"))
        return db

    def test_esquema_final_sin_patrones_largos(self):
        import re
        sql = " ".join(r[0] for r in self.d1().execute("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL"))
        largos = [p for p in re.findall(r"(?:LIKE|GLOB)\s+'([^']*)'", sql) if len(p) > 50]
        self.assertEqual(largos, [], "patrón LIKE/GLOB > 50 caracteres: D1 rechazará los INSERT")

    def test_datos_reales_se_insertan_con_limite_d1(self):
        tmp = Path(tempfile.mkdtemp(prefix="ww-d1-"))
        try:
            src = tmp / "src.sqlite"
            r = run("apply-local", "--db", str(src))
            self.assertEqual(r.returncode, 0, r.stderr)
            db = self.d1()
            db.execute("ATTACH DATABASE ? AS src", (str(src),))
            for t in ("leads", "interactions", "followups"):
                db.execute(f"INSERT INTO main.{t} SELECT * FROM src.{t}")
                self.assertEqual(db.execute(f"SELECT COUNT(*) FROM main.{t}").fetchone(),
                                 db.execute(f"SELECT COUNT(*) FROM src.{t}").fetchone())
            db.execute("DETACH DATABASE src")
        finally:
            shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
