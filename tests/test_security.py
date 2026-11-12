"""Pruebas de seguridad estáticas y de configuración: nada en la app puede enviar mensajes ni salir a internet."""
import json, re, subprocess, sys, unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
SEND = re.compile(r"\b(smtplib|aiosmtplib|sendmail|twilio|nodemailer|requests\.(post|put|patch)|httpx|urllib\.request|http\.client|"
                  r"socket\.socket|osascript|graph\.facebook\.com|api\.whatsapp\.com/v|create_connection)\b")


class StaticChecks(unittest.TestCase):
    def test_app_and_scripts_have_no_network_send_code(self):
        files = list((REPO / "app").rglob("*.py")) + list((REPO / "app").rglob("*.js")) + [REPO / "scripts" / "crm_tool.py"]
        hits = [(str(f.relative_to(REPO)), m.group(0)) for f in files for m in SEND.finditer(f.read_text(encoding="utf-8"))]
        self.assertEqual(hits, [], hits)

    def test_frontend_only_talks_to_own_api(self):
        js = (REPO / "app" / "static" / "app.js").read_text(encoding="utf-8")
        urls = re.findall(r"fetch\(\s*([^,)]+)", js)
        self.assertTrue(urls)
        for u in urls:
            self.assertFalse(re.search(r"https?://", u), u)
        self.assertNotIn("XMLHttpRequest", js); self.assertNotIn("WebSocket", js); self.assertNotIn("sendBeacon", js)

    def test_server_binds_localhost_only(self):
        src = (REPO / "app" / "server.py").read_text(encoding="utf-8")
        self.assertIn('ThreadingHTTPServer(("127.0.0.1", PORT)', src)
        self.assertNotIn("0.0.0.0", src)

    def test_research_network_off_by_default(self):
        src = (REPO / "research" / "fetch.py").read_text(encoding="utf-8")
        self.assertIn('os.environ.get("WW_RESEARCH_NETWORK") == "1"', src)

    def test_settings_keep_protections(self):
        s = json.loads((REPO / ".claude" / "settings.json").read_text())
        deny = set(s["permissions"]["deny"])
        for rule in ("Edit(/data/crm/**)", "Bash(curl *)", "Bash(chflags *)", "mcp__claude_ai_Gmail", "mcp__playwright__browser_fill_form",
                     "mcp__playwright__browser_click", "mcp__playwright__browser_type"):
            self.assertIn(rule, deny)
        hook = s["hooks"]["PreToolUse"][0]["hooks"][0]
        self.assertEqual(hook["onFailure"], "block")

    def test_guard_hook_suite(self):
        r = subprocess.run([sys.executable, str(REPO / "scripts" / "tests" / "test_guard.py")], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stdout[-2000:])

    def test_no_secrets_committed(self):
        pat = re.compile(r"(sk-[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_-]{30,}|EAA[A-Za-z0-9]{30,}|-----BEGIN [A-Z ]*PRIVATE KEY|xox[bp]-[A-Za-z0-9-]{10,})")
        hits = []
        for f in REPO.rglob("*"):
            # .playwright-mcp/: capturas y registros temporales del navegador de verificación (no versionados; pueden traer tokens de páginas públicas)
            if f.is_file() and ".git" not in f.parts and "backups" not in f.parts and ".playwright-mcp" not in f.parts and f.suffix not in (".png", ".tgz"):
                try:
                    if pat.search(f.read_text(encoding="utf-8")):
                        hits.append(str(f.relative_to(REPO)))
                except UnicodeDecodeError:
                    pass
        self.assertEqual(hits, [])
        env = (REPO / ".env.example").read_text()
        filled = [l for l in env.splitlines() if l and not l.startswith("#") and not l.startswith("WW_PORT") and re.search(r"=[ \t]*\S", l)]
        self.assertEqual(filled, [], ".env.example no debe contener valores")


if __name__ == "__main__":
    unittest.main()
