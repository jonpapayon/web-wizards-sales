"""Investigador local sin red: fetcher simulado con fixtures + extremo a extremo contra el Worker local (node:sqlite)."""
import http.client, json, os, shutil, socket, subprocess, sys, tempfile, time, unittest
from datetime import date
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO))
from research.fetch import FetchResult  # noqa: E402
from research import investigator as inv  # noqa: E402

FIX = (REPO / "tests" / "fixtures" / "sitio_con_problemas.html").read_text(encoding="utf-8")
OVERPASS = {"elements": [
    {"type": "node", "id": 111, "tags": {"name": "Consultorio OSM Con Sitio", "website": "http://consultorio-ejemplo.mx/", "phone": "+52 222 000 1111", "addr:street": "Calle 1"}},
    {"type": "node", "id": 222, "tags": {"name": "Clínica OSM Sin Sitio", "phone": "222 000 2222"}},
    {"type": "node", "id": 333, "tags": {"amenity": "dentist"}},  # sin nombre: se ignora
]}


class FakeFetcher:
    """Simula la red: HTML del fixture para el sitio, 404 para enlaces rotos, Overpass desde JSON."""
    def __init__(self):
        self.calls = []

    def _r(self, url, status, text=""):
        return FetchResult(url, url, status, "text/html", text, "" if status and status < 400 else f"HTTP {status}" if status else "DNS: no resuelve")

    def get(self, url):
        self.calls.append(("GET", url))
        if "overpass-api.de" in url:
            return FetchResult(url, url, 200, "application/json", json.dumps(OVERPASS))
        if url.rstrip("/") == "http://consultorio-ejemplo.mx":
            return self._r(url, 200, FIX)
        return self.head(url)

    def head(self, url):
        self.calls.append(("HEAD", url))
        if "dominio-que-no-existe" in url:
            return self._r(url, None)
        if url.endswith(("/consultorio-mirador/", "/cirugias.html")):
            return self._r(url, 404)
        return self._r(url, 200, "<html></html>")


class ProcessJob(unittest.TestCase):
    def test_site_job_separates_verified_and_inferred(self):
        f = FakeFetcher()
        r = inv.process_job({"id": 1, "tipo": "site_audit", "target": "http://consultorio-ejemplo.mx/", "business": {}}, f, use_browser=False)
        by = {(e["senal"], e["confianza"]) for e in r["evidencias"]}
        self.assertIn(("WEB_BROKEN", "alta"), by)
        self.assertIn(("INFO_INCONSISTENT", "alta"), by)
        self.assertIn(("WEB_NOT_MOBILE", "baja"), by, "sin navegador, la falta de viewport es inferencia")
        self.assertTrue(all(e["tipo"] == ("inferida" if e["confianza"] == "baja" else "verificada") for e in r["evidencias"]))
        broken = [e["observacion"] for e in r["evidencias"] if e["senal"] == "WEB_BROKEN"]
        self.assertTrue(any("/consultorio-mirador/" in o and "404" in o for o in broken), broken)
        self.assertTrue(any("dominio-que-no-existe" in o for o in broken), broken)
        self.assertIn("enlace de WhatsApp", r["no_encontrado"]) if not r["datos"]["whatsapp_enlaces"] else None
        self.assertEqual(r["motor"], "http")
        self.assertTrue(all(m in ("GET", "HEAD") for m, _ in f.calls))

    def test_osm_job(self):
        r = inv.process_job({"id": 2, "tipo": "descubrir_osm", "target": "osm", "business": {"nicho": "dentista", "ciudad": "Puebla", "limite": 10}}, FakeFetcher())
        self.assertEqual([n["nombre_negocio"] for n in r["negocios"]], ["Consultorio OSM Con Sitio", "Clínica OSM Sin Sitio"])
        self.assertEqual(r["negocios"][0]["telefono_e164"], "+522220001111")
        self.assertIn("ODbL", r["fuente"])

    def test_api_client_rejects_insecure_remote(self):
        with self.assertRaises(ValueError):
            inv.ApiClient("http://sales.webwizards.click", "x")
        with self.assertRaises(ValueError):
            inv.ApiClient("https://sales.webwizards.click", "")


def free_port():
    s = socket.socket(); s.bind(("127.0.0.1", 0)); p = s.getsockname()[1]; s.close(); return p


@unittest.skipUnless(shutil.which("node"), "node no instalado")
class EndToEnd(unittest.TestCase):
    """Worker local real + investigador: solicitud OSM → descubrimiento → auditorías → candidatos en revisión."""
    def test_flow(self):
        tmp = Path(tempfile.mkdtemp(prefix="ww-e2e-"))
        port = free_port()
        vars_ = tmp / "dev.vars"
        # usuario de prueba con hash generado aquí (contraseña solo en memoria de la prueba)
        sys.path.insert(0, str(REPO / "scripts"))
        import ww_auth
        users = [{"usuario": "ana", "nombre": "Ana Revisora", "hash": ww_auth.make_hash("contraseña-de-prueba-123")}]
        vars_.write_text(f"AUTH_USERS='{json.dumps(users)}'\nWORKER_TOKEN=tok-worker-e2e-123456\n", encoding="utf-8")
        db = tmp / "e2e.sqlite"
        r = subprocess.run([sys.executable, str(REPO / "scripts" / "d1_migrate.py"), "apply-local", "--db", str(db)], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        p = subprocess.Popen(["node", str(REPO / "dev" / "worker_local.mjs"), "--port", str(port), "--db", str(db), "--vars", str(vars_)],
                             stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        try:
            for _ in range(100):
                try:
                    socket.create_connection(("127.0.0.1", port), timeout=0.2).close(); break
                except OSError:
                    time.sleep(0.1)
            host = f"127.0.0.1:{port}"

            def req(method, path, body=None, headers=None):
                c = http.client.HTTPConnection("127.0.0.1", port, timeout=30)
                h = {"Host": host, "Origin": f"http://{host}", **(headers or {})}
                if body is not None:
                    h["Content-Type"] = "application/json"
                c.request(method, path, body=json.dumps(body) if body is not None else None, headers=h)
                resp = c.getresponse(); data = resp.read(); out = (resp.status, json.loads(data or b"{}"), resp.getheader("Set-Cookie")); c.close(); return out

            st, _, cookie = req("POST", "/api/login", {"usuario": "ana", "password": "contraseña-de-prueba-123"})
            self.assertEqual(st, 200)
            ck = {"Cookie": cookie.split(";")[0]}
            csrf = req("GET", "/api/session", headers=ck)[1]["token"]
            st, body, _ = req("POST", "/api/prospecting", {"nicho": "dentista", "estado_mx": "Puebla", "municipio": "Puebla", "cantidad": 5, "fuentes": ["osm"],
                                                          "criterios": {"clases": ["A", "B", "C"], "puntaje_min": 0}}, {**ck, "X-WW-Token": csrf})
            self.assertEqual(st, 200, body)
            api = inv.ApiClient(f"http://{host}", "tok-worker-e2e-123456")
            n = inv.run(api, FakeFetcher(), "mac-e2e", once=True, log=lambda *_: None)
            self.assertEqual(n, 3, "1 descubrimiento OSM + 2 negocios")
            sol = req("GET", "/api/prospecting", headers=ck)[1]["solicitudes"][0]
            self.assertEqual((sol["encontrados"], sol["investigados"], sol["estado"]), (2, 2, "completada"))
            rev = req("GET", "/api/research", headers=ck)[1]["revision"]
            nombres = {c["nombre_negocio"] for c in rev}
            self.assertIn("Consultorio OSM Con Sitio", nombres)
            c1 = next(c for c in rev if c["nombre_negocio"] == "Consultorio OSM Con Sitio")
            self.assertTrue(any(e["senal"] == "WEB_BROKEN" and e["confianza"] == "alta" for e in c1["evidencias"]))
            import csv as _csv
            with open(REPO / "data" / "crm" / "leads.csv", encoding="utf-8") as fh:
                en_crm = len(list(_csv.DictReader(fh)))  # la base de prueba se creó desde estos CSV
            leads_after = len(req("GET", "/api/leads", headers=ck)[1]["leads"])
            self.assertEqual(leads_after, en_crm, "nada se registra sin revisión humana")
        finally:
            p.terminate(); p.wait(5)
            for s in (p.stdout, p.stderr):
                s.close()
            shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
