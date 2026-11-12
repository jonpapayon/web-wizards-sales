"""Pruebas de la API local (app/server.py) sobre una copia temporal de los datos demo."""
import re, shutil, unittest
from _util import Server, read_csv, temp_root


class APITests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.root = temp_root()
        cls.srv = Server(cls.root).__enter__()

    @classmethod
    def tearDownClass(cls):
        cls.srv.__exit__()
        shutil.rmtree(cls.root, ignore_errors=True)

    def lead_id(self, part):
        return next(L["lead_id"] for L in read_csv(self.root, "leads") if part in L["nombre_negocio"])

    def test_reads(self):
        for path in ("/api/summary", "/api/leads", "/api/pipeline", "/api/drafts", "/api/research", "/api/followups", "/api/reports", "/api/config"):
            s, d = self.srv.get(path)
            self.assertEqual(s, 200, path)
        s, d = self.srv.get("/api/leads")
        self.assertEqual(len(d["leads"]), len(read_csv(self.root, "leads")))
        s, d = self.srv.get(f"/api/leads/{self.lead_id('Sonrisa')}")
        self.assertEqual(d["lead"]["nombre_negocio"], "DEMO Clínica Dental Sonrisa Ficticia")
        self.assertTrue(d["dossier"] and d["evidencia"] and d["borradores"])
        s, d = self.srv.get("/api/research")
        self.assertEqual(len([x for x in d["revision"] if not re.search(r"/(csv|manual)-", x["archivo"])]), 2)  # los del demo

    def test_security_headers_and_static(self):
        s, body, h = self.srv.request("GET", "/")
        self.assertEqual(s, 200); self.assertIn("Web Wizards Sales OS", body)
        self.assertIn("default-src 'self'", h["Content-Security-Policy"]); self.assertEqual(h["X-Frame-Options"], "DENY")

    def test_post_requires_token_origin_host_json(self):
        lid = self.lead_id("Huellitas")
        p = f"/api/leads/{lid}/transition"
        self.assertEqual(self.srv.post(p, {"to": "mensaje_borrador"}, {"X-WW-Token": "malo"})[0], 403)
        self.assertEqual(self.srv.post(p, {"to": "mensaje_borrador"}, {"Origin": "https://sitio-malicioso.example"})[0], 403)
        self.assertEqual(self.srv.post(p, {"to": "mensaje_borrador"}, {"Host": "evil.example:80"})[0], 403)
        self.assertEqual(self.srv.request("GET", "/api/summary", headers={"Host": "attacker.example"})[0], 421)
        self.assertEqual(self.srv.post(p, {"to": "mensaje_borrador"}, {"Content-Type": "text/plain"})[0], 415)

    def test_methods_not_allowed(self):
        for m in ("DELETE", "PUT", "PATCH"):
            self.assertEqual(self.srv.request(m, "/api/leads")[0], 405)

    def test_transitions_through_api(self):
        lid = self.lead_id("Estética Aroma")
        s, d = self.srv.post(f"/api/leads/{lid}/transition", {"to": "ganado"})
        self.assertEqual(s, 422)
        s, d = self.srv.post(f"/api/leads/{lid}/transition", {"to": "no_contactar"})
        self.assertEqual(s, 422)

    def test_pipeline_comercial_y_hoy(self):
        s, d = self.srv.get("/api/today")
        self.assertEqual(s, 200)
        for k in ("hoy", "acciones", "sin_accion", "por_enviar", "por_aprobar", "proximos", "seguimientos"):
            self.assertIn(k, d)
        s, p = self.srv.get("/api/pipeline")
        self.assertIn("interesado", p["estados"]); self.assertIn("precio", p["motivos_perdida"]); self.assertIn("negociacion", p["con_seguimiento"])
        lid = next(L["lead_id"] for L in read_csv(self.root, "leads") if L["estado_pipeline"] == "contactado")
        s, d = self.srv.post(f"/api/leads/{lid}/next", {"proxima_accion": "Llamar a recepción", "proximo_seguimiento": "2026-11-18", "por": "Ana Revisora"})
        self.assertEqual(s, 200, d)
        L = next(x for x in read_csv(self.root, "leads") if x["lead_id"] == lid)
        self.assertEqual((L["proxima_accion"], L["proximo_seguimiento"]), ("Llamar a recepción", "2026-11-18"))
        s, d = self.srv.post(f"/api/leads/{lid}/transition", {"to": "perdido", "por": "Ana Revisora"})
        self.assertEqual(s, 422, "perdido sin motivo se rechaza")
        s, d = self.srv.post(f"/api/leads/{lid}/transition", {"to": "perdido", "motivo_perdida": "sin_respuesta", "por": "Ana Revisora"})
        self.assertEqual(s, 200, d)
        L = next(x for x in read_csv(self.root, "leads") if x["lead_id"] == lid)
        self.assertEqual((L["estado_pipeline"], L["motivo_perdida"], L["proxima_accion"]), ("perdido", "sin_respuesta", ""))

    def test_alta_manual_e_importacion_csv(self):
        lead = next(L for L in read_csv(self.root, "leads") if L["telefono_e164"] and L["opt_out"] == "false")
        rows = [{"nombre_negocio": "Spa Nuevo Prueba", "nicho": "estetica_spa", "ciudad": "Zamora", "estado_mx": "Michoacán",
                 "whatsapp_publico": "351 222 3344", "google_maps_url": "https://maps.google.com/?cid=2", "notas": "anuncia en Meta"},
                {"nombre_negocio": "Duplicado", "nicho": "dentista", "ciudad": "X", "estado_mx": "Y", "telefono_publico": lead["telefono_e164"], "sitio_web": "https://d.invalid"},
                {"nombre_negocio": "Sin fuente", "nicho": "dentista", "ciudad": "Zamora", "estado_mx": "Michoacán"}]
        s, d = self.srv.post("/api/candidates", {"rows": rows, "origen": "csv", "por": "Ana Revisora"})
        self.assertEqual(s, 200, d)
        r = d["resultado"]
        self.assertEqual((len(r["creados"]), [x["fila"] for x in r["duplicados"]], [x["fila"] for x in r["invalidos"]]), (1, [2], [3]))
        path = self.root / r["creados"][0]["id"]
        import json
        c = json.loads(path.read_text(encoding="utf-8"))
        self.assertEqual((c["whatsapp_publico"], c["fuente_url"]), ("+523512223344", "https://maps.google.com/?cid=2"))
        self.assertTrue(path.with_suffix(".notas.md").exists())
        s, d = self.srv.get("/api/research")
        cand = next(x for x in d["revision"] if x["archivo"] == r["creados"][0]["id"])
        self.assertFalse(cand["calificado"])
        s, d = self.srv.post("/api/candidates", {"rows": rows[:1], "origen": "manual", "por": "Ana Revisora"})
        self.assertEqual([x["fila"] for x in d["resultado"]["duplicados"]], [1], "un segundo alta del mismo negocio se detecta contra la cola")

    def test_approval_requires_person_and_never_sends(self):
        lid = self.lead_id("Sonrisa")
        s, d = self.srv.post(f"/api/leads/{lid}/approve", {"aprobado_por": "claude"})
        self.assertEqual(s, 422)
        s, d = self.srv.post(f"/api/leads/{lid}/approve", {"aprobado_por": "Ana Revisora"})
        self.assertEqual(s, 200, d)
        L = next(x for x in read_csv(self.root, "leads") if x["lead_id"] == lid)
        self.assertEqual((L["estado_pipeline"], L["aprobado_por"]), ("aprobado", "Ana Revisora"))
        ints = [i for i in read_csv(self.root, "interactions") if i["lead_id"] == lid]
        self.assertFalse(any(i["direccion"] == "saliente" for i in ints), "aprobar generó una interacción saliente")
        s, ev = self.srv.get("/api/events", {"X-WW-Token": self.srv.token})
        ap = [e for e in ev["eventos"] if e["evento"] == "aprobacion.humana" and e["entidad"] == lid]
        self.assertTrue(ap and ap[-1]["detalle"]["envia"] is False)

    def test_optout_blocks_further_changes(self):
        lid = self.lead_id("Huellitas")
        self.assertEqual(self.srv.post(f"/api/leads/{lid}/optout", {"fuente": ""})[0], 422)
        s, d = self.srv.post(f"/api/leads/{lid}/optout", {"fuente": "prueba API"})
        self.assertEqual(s, 200, d)
        s, d = self.srv.post(f"/api/leads/{lid}/transition", {"to": "mensaje_borrador"})
        self.assertEqual(s, 422); self.assertIn("baja", d["error"])
        s, d = self.srv.get(f"/api/leads/{lid}")
        self.assertTrue(d["bloqueado"])

    def test_review_path_traversal_rejected(self):
        for bad in ("../../data/crm/leads.csv", "data/crm/leads.csv", "/etc/passwd", "data/staging/x/procesados/a.json"):
            s, d = self.srv.post("/api/review/register", {"archivo": bad})
            self.assertEqual(s, 422, bad)

    def test_events_require_token(self):
        self.assertEqual(self.srv.get("/api/events")[0], 401)
        s, d = self.srv.get("/api/events?limit=5", {"X-WW-Token": self.srv.token})
        self.assertEqual(s, 200); self.assertLessEqual(len(d["eventos"]), 5)

    def test_followup_holiday_rejected_via_api(self):
        lid = self.lead_id("Spa Luna")
        s, d = self.srv.post("/api/followups", {"lead_id": lid, "fecha_programada": "2026-11-16", "numero_seguimiento": 2, "canal": "email"})
        self.assertEqual(s, 422); self.assertIn("descanso", d["error"])

    def test_no_send_endpoints(self):
        src = (self.root.parent if False else __import__("pathlib").Path(__file__).resolve().parents[1] / "app" / "server.py").read_text()
        routes = re.findall(r'"/api/[^"]+"|rf?"/api/[^"]+"', src)
        self.assertFalse([r for r in routes if re.search(r"send|enviar|whatsapp|email|sms|mail", r, re.I)], routes)

    def test_persistence_across_restart(self):
        lid = self.lead_id("Estética Aroma")
        s, d = self.srv.post(f"/api/leads/{lid}/interaction", {"direccion": "interna", "tipo": "nota", "resumen": "nota persistente"})
        self.assertEqual(s, 200, d)
        with Server(self.root) as s2:
            s, d = s2.get(f"/api/leads/{lid}")
            self.assertTrue(any(i["resumen"] == "nota persistente" for i in d["interacciones"]))


if __name__ == "__main__":
    unittest.main()
