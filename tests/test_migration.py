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
        self.assertEqual(rows, {"WW-20261111-001": "Clínica Dental Aiteli|B|52", "WW-20261111-002": "Clínica Dental Biodental|B|52",
                                "WW-20261111-003": "Oral Health|B|58", "WW-20261111-004": "Jauckens & Castillo Dental|C|48"})
        self.assertEqual(db.execute("SELECT COUNT(*) FROM documents WHERE kind='borrador'").fetchone()[0], 4)

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
