"""Pruebas del motor de investigación SIN red: análisis de HTML con fixtures y garantías del cliente HTTP."""
import os, sys, unittest
from datetime import date
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO))
from research.fetch import FetchRefused, NetworkDisabled, ReadOnlyFetcher, check_url  # noqa: E402
from research.site_audit import analyze_html  # noqa: E402

FIX = (REPO / "tests" / "fixtures" / "sitio_con_problemas.html").read_text(encoding="utf-8")


class SiteAudit(unittest.TestCase):
    def setUp(self):
        self.r = analyze_html("http://consultorio-ejemplo.mx/", FIX, today=date(2026, 11, 11))
        self.sig = {h["senal"] for h in self.r["hallazgos"]}

    def test_detects_problems(self):
        self.assertTrue({"WEB_NO_HTTPS", "WEB_NOT_MOBILE", "WEB_OUTDATED", "INFO_INCONSISTENT"} <= self.sig, self.sig)
        self.assertEqual(self.r["datos"]["copyright"], 2019)

    def test_whatsapp_mismatch_literal(self):
        obs = next(h["observacion"] for h in self.r["hallazgos"] if h["senal"] == "INFO_INCONSISTENT")
        self.assertIn("5212227940917", obs)

    def test_collects_appointment_links_and_forms(self):
        self.assertIn("Agenda una cita", [e["texto"] for e in self.r["enlaces_externos_cita"]])
        internos = [e["href"] for e in self.r["enlaces_internos"]]
        self.assertIn("/consultorio-mirador/", internos)  # "Click aquí" bajo "Solicite una cita": se comprueba como enlace interno
        self.assertIn("cirugias.html", internos)
        self.assertEqual(self.r["datos"]["formularios"][0]["method"], "post")
        self.assertIn("contacto@consultorio-ejemplo.mx", self.r["datos"]["mailto"])

    def test_clean_page_has_no_false_positives(self):
        html = ('<html><head><meta name="viewport" content="width=device-width"></head><body>'
                '<a href="https://wa.me/522221234567">222 123 4567</a><a href="/citas">Agenda tu cita</a>© 2026</body></html>')
        r = analyze_html("https://ok.mx/", html, today=date(2026, 11, 11))
        self.assertEqual(r["hallazgos"], [])


class FetcherGuarantees(unittest.TestCase):
    def test_disabled_by_default(self):
        os.environ.pop("WW_RESEARCH_NETWORK", None)
        with self.assertRaises(NetworkDisabled):
            ReadOnlyFetcher().get("https://example.com/")

    def test_refuses_unsafe_targets_and_methods(self):
        for u in ("ftp://x.mx/", "file:///etc/passwd", "http://localhost:8765/", "http://127.0.0.1/", "http://192.168.1.10/",
                  "https://user:pass@x.mx/", "https://algo.demo.invalid/"):
            with self.assertRaises(FetchRefused, msg=u):
                check_url(u)
        os.environ["WW_RESEARCH_NETWORK"] = "1"
        try:
            with self.assertRaises(FetchRefused):
                ReadOnlyFetcher()._raw("https://example.com/", "POST")
        finally:
            os.environ.pop("WW_RESEARCH_NETWORK", None)

    def test_no_write_methods_in_source(self):
        src = (REPO / "research" / "fetch.py").read_text()
        self.assertEqual(src.count('ALLOWED_METHODS = {"GET", "HEAD"}'), 1)
        self.assertNotIn("data=", src.split("urllib.request.Request(")[1].split(")")[0])


if __name__ == "__main__":
    unittest.main()
