"""Utilidades de prueba: copias temporales de datos para no tocar nunca el CRM real."""
import http.client, json, os, shutil, socket, subprocess, sys, tempfile, time
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
TOOL = REPO / "scripts" / "crm_tool.py"
PILOT = {"WW-20261111-001": ("Clínica Dental Aiteli", "B"), "WW-20261111-002": ("Clínica Dental Biodental", "B"),
         "WW-20261111-003": ("Oral Health", "B"), "WW-20261111-004": ("Jauckens & Castillo Dental", "C")}


def temp_root():
    """Copia de demo/ en un directorio temporal (datos ficticios)."""
    if not (REPO / "demo" / ".demo").exists():
        subprocess.run([sys.executable, str(REPO / "app" / "seed_demo.py")], check=True, capture_output=True)
    d = Path(tempfile.mkdtemp(prefix="ww-test-"))
    shutil.copytree(REPO / "demo", d, dirs_exist_ok=True)
    return d


def tool(root, *args, actor="pruebas"):
    r = subprocess.run([sys.executable, str(TOOL), *args, "--por", actor], capture_output=True, text=True,
                       env=dict(os.environ, WW_ROOT=str(root)))
    return r.returncode, r.stdout, r.stderr


def read_csv(root, kind):
    import csv
    with open(Path(root) / "data" / "crm" / f"{kind}.csv", newline="", encoding="utf-8") as fh:
        return list(csv.DictReader(fh))


def free_port():
    s = socket.socket(); s.bind(("127.0.0.1", 0)); p = s.getsockname()[1]; s.close(); return p


class Server:
    """Arranca app/server.py sobre una raíz temporal, solo en 127.0.0.1."""
    def __init__(self, root):
        self.root, self.port = root, free_port()

    def __enter__(self):
        self.p = subprocess.Popen([sys.executable, str(REPO / "app" / "server.py"), "--port", str(self.port), "--data-root", str(self.root)],
                                  stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        for _ in range(100):
            try:
                self.token = self.get("/api/session")[1]["token"]
                return self
            except OSError:
                time.sleep(0.1)
        raise RuntimeError("el servidor no arrancó: " + (self.p.stderr.read() if self.p.poll() is not None else ""))

    def __exit__(self, *a):
        self.p.terminate(); self.p.wait(5)
        for s in (self.p.stdout, self.p.stderr):
            if s:
                s.close()

    def request(self, method, path, body=None, headers=None):
        c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=30)
        h = {"Host": f"127.0.0.1:{self.port}"}
        if body is not None:
            h.update({"Content-Type": "application/json", "X-WW-Token": getattr(self, "token", "")})
        h.update(headers or {})
        c.request(method, path, body=json.dumps(body) if body is not None else None, headers=h)
        r = c.getresponse()
        raw = r.read()
        try:
            data = json.loads(raw)
        except ValueError:
            data = raw.decode("utf-8", "replace")
        hdrs = dict(r.getheaders())
        c.close()
        return r.status, data, hdrs

    def get(self, path, headers=None):
        s, d, _ = self.request("GET", path, headers=headers)
        return s, d

    def post(self, path, body, headers=None):
        s, d, _ = self.request("POST", path, body, headers)
        return s, d
