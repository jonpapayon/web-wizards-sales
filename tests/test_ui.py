"""
Pruebas de interfaz con un navegador real en modo headless (Brave/Chrome/Chromium instalados en el equipo).
Solo abre http://127.0.0.1 (servidor local). Comprueba el DOM renderizado y genera capturas de escritorio y móvil
en tests/artifacts/. El servidor se abre con el CRM REAL en modo de solo lectura (solo GET) para verificar que
la interfaz muestra los datos reales, y con datos demo para el resto.
"""
import os, shutil, subprocess, tempfile, unittest
from pathlib import Path
from _util import PILOT, REPO, Server, temp_root

CANDIDATES = ["/Applications/Brave Browser.app/Contents/MacOS/Brave Browser", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
              "/Applications/Chromium.app/Contents/MacOS/Chromium", shutil.which("chromium") or "", shutil.which("google-chrome") or ""]
BROWSER = next((b for b in CANDIDATES if b and os.path.exists(b)), None)
ART = REPO / "tests" / "artifacts"
NODE = shutil.which("node")


def headless_works():
    """En algunos entornos (sandbox sin pantalla) el navegador headless no puede renderizar: se detecta y se omite."""
    if not BROWSER:
        return False
    prof = tempfile.mkdtemp(prefix="ww-probe-")
    try:
        r = subprocess.run([BROWSER, "--headless=new", "--disable-gpu", f"--user-data-dir={prof}", "--dump-dom", "data:text/html,<p>ok</p>"],
                           capture_output=True, text=True, timeout=15)
        return "<p>ok</p>" in r.stdout
    except subprocess.TimeoutExpired:
        return False
    finally:
        shutil.rmtree(prof, ignore_errors=True)


HEADLESS = headless_works()


def browser(url, *extra, budget=6000):
    prof = tempfile.mkdtemp(prefix="ww-ui-")
    try:
        r = subprocess.run([BROWSER, "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
                            "--disable-background-networking", "--disable-component-update", "--disable-sync",
                            "--disable-extensions", f"--user-data-dir={prof}", f"--virtual-time-budget={budget}", *extra, url],
                           capture_output=True, text=True, timeout=90)
        return r.stdout
    finally:
        shutil.rmtree(prof, ignore_errors=True)


@unittest.skipUnless(HEADLESS, "navegador headless no disponible o sin pantalla en este entorno")
class RealCRMUI(unittest.TestCase):
    def test_dashboard_shows_real_pilot_leads(self):
        with Server(REPO) as s:
            dom = browser(f"http://127.0.0.1:{s.port}/#/prospectos", "--dump-dom")
            for lid, (name, _) in PILOT.items():
                self.assertIn(lid, dom); self.assertIn(name.replace("&", "&amp;"), dom)
            self.assertIn("CRM real", dom)
            dom = browser(f"http://127.0.0.1:{s.port}/#/prospectos/WW-20261111-003", "--dump-dom")
            self.assertIn("Oral Health", dom); self.assertIn("Registrar baja", dom)
            ART.mkdir(exist_ok=True)
            for route, name in (("dashboard", "dashboard"), ("prospectos", "prospectos"), ("pipeline", "pipeline"),
                                ("mensajes", "mensajes"), ("investigacion", "investigacion")):
                browser(f"http://127.0.0.1:{s.port}/#/{route}", f"--screenshot={ART / f'real-{name}-desktop.png'}", "--window-size=1440,1000")
                browser(f"http://127.0.0.1:{s.port}/#/{route}", f"--screenshot={ART / f'real-{name}-movil.png'}", "--window-size=390,844")
            self.assertTrue((ART / "real-dashboard-desktop.png").stat().st_size > 10_000)


@unittest.skipUnless(HEADLESS, "navegador headless no disponible o sin pantalla en este entorno")
class DemoUI(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.root = temp_root()

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.root, ignore_errors=True)

    def test_all_sections_render(self):
        with Server(self.root) as s:
            expect = {"hoy": "Activos sin próxima acción", "dashboard": "Objetivo diario", "prospectos": "DEMO Spa Luna", "pipeline": "Demo programada",
                      "investigacion": "Área de revisión", "mensajes": "Aprobar para uso humano", "seguimientos": "Próximas acciones",
                      "reportes": "Conversión por etapa", "configuracion": "Reglas de aprobación automática"}
            for route, text in expect.items():
                dom = browser(f"http://127.0.0.1:{s.port}/#/{route}", "--dump-dom")
                self.assertIn(text, dom, route)
                self.assertNotIn("No se pudo cargar", dom, route)
            dom = browser(f"http://127.0.0.1:{s.port}/#/dashboard", "--dump-dom")
            self.assertIn("MODO DEMOSTRACIÓN", dom)
            browser(f"http://127.0.0.1:{s.port}/#/pipeline", f"--screenshot={ART / 'demo-pipeline-movil.png'}", "--window-size=390,844")


if __name__ == "__main__":
    unittest.main()


@unittest.skipUnless(NODE, "node no instalado")
class RenderWithoutBrowser(unittest.TestCase):
    """Ejecuta app.js real (Node + DOM mínimo) contra el servidor local real. Cubre todas las secciones."""
    def run_render(self, root, checks):
        with Server(root) as s:
            r = subprocess.run([NODE, str(REPO / "tests" / "ui_render.mjs"), str(s.port), *checks], capture_output=True, text=True, timeout=120)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        return r.stdout

    def test_real_crm_rendered(self):
        out = self.run_render(REPO, ["prospectos=WW-20261111-001", "prospectos=Oral Health", "prospectos/WW-20261111-003=Registrar baja",
                                     "pipeline=Pendiente de aprobación", "mensajes=Aprobar para uso humano", "investigacion=Evidencia por prospecto",
                                     "dashboard=Objetivo diario"])
        self.assertIn("CRM real", out)

    def test_demo_all_sections(self):
        root = temp_root()
        try:
            out = self.run_render(root, ["hoy=Por aprobar", "hoy=Próximos 7 días", "dashboard=Objetivo diario", "prospectos=DEMO Spa Luna", "buscar:luna=DEMO Spa Luna", "buscar:0000 0004=DEMO Consultorio", "pipeline=Demo programada",
                                         "investigacion=Área de revisión", "mensajes=Copiar", "seguimientos=Próximas acciones",
                                         "reportes=Conversión por etapa", "configuracion=Reglas de aprobación automática"])
            self.assertIn("MODO DEMOSTRACIÓN", out)
        finally:
            shutil.rmtree(root, ignore_errors=True)


@unittest.skipUnless(NODE, "node no instalado")
class RenderWorkerBackend(unittest.TestCase):
    """La misma interfaz contra el Worker (D1 emulado, copia temporal de los datos reales) con inicio de sesión."""
    def test_worker_sections_with_login(self):
        import json, socket, time, sys as _sys
        _sys.path.insert(0, str(REPO / "scripts"))
        import ww_auth
        tmp = Path(tempfile.mkdtemp(prefix="ww-uiw-"))
        try:
            db = tmp / "ui.sqlite"
            r = subprocess.run([_sys.executable, str(REPO / "scripts" / "d1_migrate.py"), "apply-local", "--db", str(db)], capture_output=True, text=True)
            self.assertEqual(r.returncode, 0, r.stderr)
            vars_ = tmp / "dev.vars"
            vars_.write_text("AUTH_USERS='" + json.dumps([{"usuario": "ana", "nombre": "Ana Revisora", "hash": ww_auth.make_hash("contraseña-de-prueba-123")}]) + "'\n", encoding="utf-8")
            s = socket.socket(); s.bind(("127.0.0.1", 0)); port = s.getsockname()[1]; s.close()
            p = subprocess.Popen([NODE, str(REPO / "dev" / "worker_local.mjs"), "--port", str(port), "--db", str(db), "--vars", str(vars_)],
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            try:
                for _ in range(100):
                    try:
                        socket.create_connection(("127.0.0.1", port), timeout=0.2).close(); break
                    except OSError:
                        time.sleep(0.1)
                checks = ["dashboard=Objetivo diario", "prospectos=Clínica Dental Aiteli", "prospectos/WW-20261111-003=Registrar baja", "pipeline=Pendiente de aprobación",
                          "investigacion=Evidencia por prospecto", "mensajes=Equipo comercial de Web Wizards", "seguimientos=Tareas internas",
                          "reportes=Conversión por etapa", "configuracion=INEGI DENUE", "prospeccion=Nueva solicitud"]
                out = subprocess.run([NODE, str(REPO / "tests" / "ui_render.mjs"), str(port), *checks], capture_output=True, text=True, timeout=120,
                                     env=dict(os.environ, WW_UI_LOGIN="ana:contraseña-de-prueba-123"))
                self.assertEqual(out.returncode, 0, out.stdout + out.stderr)
                self.assertIn("CRM real", out.stdout)
                # sin sesión, la interfaz no obtiene datos
                noauth = subprocess.run([NODE, str(REPO / "tests" / "ui_render.mjs"), str(port), "prospectos=Aiteli"], capture_output=True, text=True, timeout=60)
                self.assertNotEqual(noauth.returncode, 0)
            finally:
                p.terminate(); p.wait(5)
                for st in (p.stdout, p.stderr):
                    st.close()
        finally:
            shutil.rmtree(tmp, ignore_errors=True)
