"""Pruebas del CRM (crm_tool.py) sobre copias temporales de los datos demo."""
import json, shutil, unittest
from pathlib import Path
from _util import PILOT, REPO, read_csv, temp_root, tool


class CRMTests(unittest.TestCase):
    def setUp(self):
        self.root = temp_root()

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def lead(self, name_part):
        return next(L for L in read_csv(self.root, "leads") if name_part in L["nombre_negocio"])

    def test_validate_ok(self):
        code, out, err = tool(self.root, "validate")
        self.assertEqual(code, 0, out + err)

    def test_duplicate_rejected(self):
        proc = next((self.root / "data" / "staging").glob("*/procesados/sonrisa.json"))
        dup = proc.parent.parent / "dup.json"
        shutil.copy(proc, dup)
        (self.root / "data" / "research" / "sonrisa.md").write_text("# x\n")
        n = len(read_csv(self.root, "leads"))
        code, _, err = tool(self.root, "add-lead", str(dup))
        self.assertEqual(code, 3); self.assertIn("Duplicado", err)
        self.assertEqual(len(read_csv(self.root, "leads")), n)

    def test_invalid_transition_rejected(self):
        L = self.lead("Huellitas")
        code, _, err = tool(self.root, "update-lead", L["lead_id"], "--set", "estado_pipeline=ganado")
        self.assertEqual(code, 3); self.assertIn("Transición inválida", err)

    def test_valid_transition_and_audit(self):
        L = self.lead("Huellitas")
        code, out, err = tool(self.root, "update-lead", L["lead_id"], "--set", "estado_pipeline=mensaje_borrador")
        self.assertEqual(code, 0, err)
        audit = (self.root / "data" / "crm" / "audit.jsonl").read_text().splitlines()
        self.assertTrue(any(json.loads(x)["evento"] == "lead.estado_cambiado" and json.loads(x)["entidad"] == L["lead_id"] for x in audit))

    def test_self_approval_rejected(self):
        L = self.lead("Sonrisa")
        for name in ("claude", "Claude", "dashboard", ""):
            code, _, err = tool(self.root, "update-lead", L["lead_id"], "--set", "estado_pipeline=aprobado", "--set", f"aprobado_por={name}")
            self.assertEqual(code, 3, name)

    def test_optout_irreversible(self):
        L = self.lead("Huellitas")
        code, _, err = tool(self.root, "suppress", "--lead", L["lead_id"], "--motivo", "opt_out", "--fuente", "prueba")
        self.assertEqual(code, 0, err)
        L2 = self.lead("Huellitas")
        self.assertEqual((L2["opt_out"], L2["estado_pipeline"]), ("true", "no_contactar"))
        for args in (["update-lead", L["lead_id"], "--set", "estado_pipeline=mensaje_borrador"],
                     ["update-lead", L["lead_id"], "--set", "opt_out=false"],
                     ["update-lead", L["lead_id"], "--nota", "intento de reactivar"]):
            code, _, err = tool(self.root, *args)
            self.assertEqual(code, 3, args)
        supp = read_csv(self.root, "suppression")
        keys = [(r["tipo"], r["valor"]) for r in supp]
        self.assertEqual(len(keys), len(set(keys)), "filas repetidas en supresión")

    def test_suppressed_cannot_be_reimported(self):
        proc = next((self.root / "data" / "staging").glob("*/procesados/dentalnorte.json"))  # ya dado de baja en demo
        again = proc.parent.parent / "dentalnorte-again.json"
        shutil.copy(proc, again)
        (self.root / "data" / "research" / "dentalnorte.md").write_text("# x\n")
        code, _, err = tool(self.root, "add-lead", str(again))
        self.assertEqual(code, 3); self.assertIn("supresión", err)

    def test_import_never_overwrites(self):
        before = read_csv(self.root, "leads")
        folder = self.root / "data" / "staging" / "import-test"
        folder.mkdir()
        for p in (self.root / "data" / "staging").glob("*/procesados/*.json"):
            shutil.copy(p, folder / p.name)
        for slug in ("sonrisa", "vetfeliz", "spaluna", "medicentro", "dentalnorte", "esteticaroma"):
            (self.root / "data" / "research" / f"{slug}.md").write_text("# x\n")
        code, out, err = tool(self.root, "import-candidates", str(folder))
        self.assertEqual(code, 0, err)
        self.assertTrue(all("rechazado" in r for r in json.loads(out)))
        after = read_csv(self.root, "leads")
        self.assertEqual(before, after, "una importación modificó registros existentes")

    def test_suppression_append_only_in_code(self):
        import importlib, os, sys
        sys.path.insert(0, str(REPO / "scripts"))
        prev = os.environ.get("WW_ROOT")
        os.environ["WW_ROOT"] = str(self.root)
        try:
            crm = importlib.import_module("crm_tool")
            with self.assertRaises(crm.CRMError):
                crm.write_csv("suppression", ["valor"], [])
        finally:  # no contaminar el entorno de las demás pruebas
            if prev is None:
                os.environ.pop("WW_ROOT", None)
            else:
                os.environ["WW_ROOT"] = prev

    def test_holiday_and_sunday_blocked(self):
        L = self.lead("Spa Luna")
        for d in ("2026-11-16", "2026-11-15", "2026-12-25"):
            code, _, err = tool(self.root, "add-followup", "--json", json.dumps({"lead_id": L["lead_id"], "fecha_programada": d, "numero_seguimiento": 2, "canal": "email"}))
            self.assertEqual(code, 3, d); self.assertTrue("descanso" in err or "domingo" in err, err)
        code, _, _ = tool(self.root, "check-date", "2026-11-16")
        self.assertEqual(code, 4)

    def test_low_confidence_pending_review(self):
        p = next((self.root / "data" / "staging").glob("*/ortoplus.json"))
        code, _, err = tool(self.root, "add-lead", str(p))
        self.assertEqual(code, 3); self.assertIn("PENDIENTE DE REVISIÓN", err)

    def test_high_score_without_contact_pending(self):
        p = next((self.root / "data" / "staging").glob("*/vetsur.json"))
        c = json.loads(p.read_text())
        for k in ("telefono_e164", "whatsapp_publico", "email_publico"):
            c.pop(k, None)
        p.write_text(json.dumps(c))
        code, _, err = tool(self.root, "add-lead", str(p))
        self.assertEqual(code, 3); self.assertIn("contacto", err)

    def test_export(self):
        code, out, err = tool(self.root, "export")
        self.assertEqual(code, 0, err)
        d = Path(json.loads(out)["exportado"])
        self.assertTrue((d / "leads.csv").exists() and (d / "audit.jsonl").exists())


class PilotIntact(unittest.TestCase):
    """Lectura del CRM real: los cuatro prospectos del piloto siguen presentes y sin cambios de identidad/clase."""
    def test_pilot_records(self):
        leads = {L["lead_id"]: L for L in read_csv(REPO, "leads")}
        for lid, (name, cls) in PILOT.items():
            self.assertIn(lid, leads)
            self.assertEqual((leads[lid]["nombre_negocio"], leads[lid]["clasificacion"]), (name, cls))
            self.assertTrue((REPO / leads[lid]["evidencias"]).is_file())

    def test_real_crm_valid(self):
        code, out, err = tool(REPO, "validate")
        self.assertEqual(code, 0, out + err)


class PullD1(unittest.TestCase):
    """pull-d1: lo hecho en el dashboard (D1) llega al CRM local; D1 gana salvo bajas locales; IDs sin choques."""

    def setUp(self):
        import os, sqlite3, subprocess, sys
        from datetime import datetime
        from zoneinfo import ZoneInfo
        self.root = temp_root()
        self.day = datetime.now(ZoneInfo("America/Mexico_City")).strftime("%Y%m%d")
        self.remote = self.root / "remote.sqlite"
        r = subprocess.run([sys.executable, str(REPO / "scripts" / "d1_migrate.py"), "apply-local", "--db", str(self.remote)],
                           capture_output=True, text=True, env=dict(os.environ, WW_ROOT=str(self.root)))
        self.assertEqual(r.returncode, 0, r.stderr)
        self.db = sqlite3.connect(self.remote)

    def tearDown(self):
        self.db.close()
        shutil.rmtree(self.root, ignore_errors=True)

    def dump(self):
        self.db.commit()
        p = self.root / "d1.sql"
        p.write_text("\n".join(self.db.iterdump()), encoding="utf-8")
        return str(p)

    def open_lead(self):
        return next(L for L in read_csv(self.root, "leads") if L["opt_out"] == "false" and L["estado_pipeline"] == "calificado")

    def test_dashboard_changes_come_back(self):
        L = self.open_lead()
        self.db.execute("UPDATE leads SET notas = 'nota del dashboard' WHERE lead_id = ?", (L["lead_id"],))
        iid = f"INT-{self.day}-5001"  # rango del Worker
        self.db.execute("""INSERT INTO interactions (interaccion_id,lead_id,fecha_hora,canal,direccion,tipo,resumen,enviado_por,resultado,sentimiento,registrado_por)
                           VALUES (?,?,?,'interno','interna','nota','desde el dashboard','humano','n/a','n/a','dashboard:prueba')""",
                        (iid, L["lead_id"], "2099-01-01T10:00:00-06:00"))
        sql = self.dump()
        code, out, err = tool(self.root, "pull-d1", "--sql", sql, "--dry-run")
        self.assertEqual(code, 0, err)
        self.assertEqual(next(x for x in read_csv(self.root, "leads") if x["lead_id"] == L["lead_id"])["notas"], L["notas"], "dry-run no escribe")
        code, out, err = tool(self.root, "pull-d1", "--sql", sql)
        self.assertEqual(code, 0, err)
        rep = json.loads(out)
        self.assertEqual(rep["agregar"]["interactions"], [iid])
        self.assertEqual(rep["conflictos"], [])
        self.assertEqual(next(x for x in read_csv(self.root, "leads") if x["lead_id"] == L["lead_id"])["notas"], "nota del dashboard")
        self.assertIn(iid, [i["interaccion_id"] for i in read_csv(self.root, "interactions")])
        self.assertEqual(tool(self.root, "validate")[0], 0)
        # segunda vez: nada que hacer
        rep2 = json.loads(tool(self.root, "pull-d1", "--sql", sql)[1])
        self.assertEqual((rep2["agregar"]["interactions"], rep2["actualizar"]["leads"]), ([], []))

    def test_local_optout_is_never_reverted(self):
        L = self.open_lead()
        sql = self.dump()  # D1 sin la baja
        code, out, err = tool(self.root, "suppress", "--lead", L["lead_id"], "--motivo", "opt_out", "--fuente", "prueba: respondió BAJA")
        self.assertEqual(code, 0, out + err)
        code, out, err = tool(self.root, "pull-d1", "--sql", sql)
        self.assertEqual(code, 0, err)
        rep = json.loads(out)
        self.assertTrue(any(c["clave"] == L["lead_id"] and "baja local" in c["motivo"] for c in rep["conflictos"]), rep)
        after = next(x for x in read_csv(self.root, "leads") if x["lead_id"] == L["lead_id"])
        self.assertEqual((after["opt_out"], after["estado_pipeline"]), ("true", "no_contactar"))

    def test_local_ids_stay_below_worker_range(self):
        L = self.open_lead()
        self.db.execute("""INSERT INTO interactions (interaccion_id,lead_id,fecha_hora,canal,direccion,tipo,resumen,enviado_por,resultado,sentimiento,registrado_por)
                           VALUES (?,?,'2099-01-01T10:00:00-06:00','interno','interna','nota','dashboard','humano','n/a','n/a','dashboard:prueba')""",
                        (f"INT-{self.day}-5007", L["lead_id"]))
        self.assertEqual(tool(self.root, "pull-d1", "--sql", self.dump())[0], 0)
        code, out, err = tool(self.root, "add-interaction", "--json", json.dumps(
            {"lead_id": L["lead_id"], "canal": "interno", "direccion": "interna", "tipo": "nota", "resumen": "nota local",
             "enviado_por": "humano", "registrado_por": "pruebas"}))
        self.assertEqual(code, 0, out + err)
        nuevos = [i["interaccion_id"] for i in read_csv(self.root, "interactions") if i["resumen"] == "nota local"]
        self.assertEqual(len(nuevos), 1)
        self.assertLess(int(nuevos[0][-4:]), 5000, "el CRM local no invade el rango del Worker")

    def test_rejects_paths_outside_data_dirs(self):
        self.db.execute("""INSERT INTO documents (path,kind,lead_id,version,content,sha256,creado_en,creado_por)
                           VALUES ('../../etc/x.md','borrador','',1,'x','0','2099','dashboard')""")
        code, out, err = tool(self.root, "pull-d1", "--sql", self.dump())
        self.assertEqual(code, 0, err)
        self.assertTrue(any(c["tabla"] == "documents" for c in json.loads(out)["conflictos"]))
        self.assertFalse((self.root.parent / "etc" / "x.md").exists())


if __name__ == "__main__":
    unittest.main()
