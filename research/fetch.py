"""
Cliente HTTP de SOLO LECTURA para investigación pública.

Garantías (probadas en tests/test_research.py):
- Desactivado por defecto: solo funciona con WW_RESEARCH_NETWORK=1, que una persona habilita explícitamente.
- Solo métodos GET y HEAD; rechaza cuerpos de petición, credenciales en la URL y esquemas que no sean http/https.
- Respeta robots.txt, limita la frecuencia por dominio, el tamaño de respuesta y el número de peticiones.
- Nunca envía formularios, cookies de sesión ni encabezados de autenticación.
- Bloquea destinos privados/locales (evita usarlo contra la red interna).
"""
import ipaddress, os, socket, time, urllib.parse, urllib.request, urllib.robotparser
from dataclasses import dataclass, field
from datetime import datetime, timezone

UA = "WebWizardsSalesOS-Research/1.0 (lectura publica; respeta robots.txt)"
MAX_BYTES = 2_000_000
MIN_INTERVAL_S = 2.0
ALLOWED_METHODS = {"GET", "HEAD"}


class NetworkDisabled(RuntimeError):
    pass


class FetchRefused(ValueError):
    pass


@dataclass
class FetchResult:
    url: str
    final_url: str
    status: int | None
    content_type: str = ""
    text: str = ""
    error: str = ""
    fetched_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat(timespec="seconds"))


def network_enabled():
    return os.environ.get("WW_RESEARCH_NETWORK") == "1"


def check_url(url):
    p = urllib.parse.urlsplit(url)
    if p.scheme not in ("http", "https"):
        raise FetchRefused(f"Esquema no permitido: {p.scheme!r}")
    if p.username or p.password:
        raise FetchRefused("URL con credenciales no permitida")
    host = p.hostname or ""
    if not host or host == "localhost" or host.endswith(".local") or host.endswith(".invalid"):
        raise FetchRefused(f"Host no permitido: {host!r}")
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:  # es un nombre de dominio, no una IP
        ip = None
    if ip is not None and (ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved):
        raise FetchRefused(f"Dirección privada no permitida: {host}")
    return p


class ReadOnlyFetcher:
    def __init__(self, max_requests=200):
        self.max_requests = max_requests
        self.count = 0
        self._last = {}
        self._robots = {}

    def _robots_ok(self, url):
        p = urllib.parse.urlsplit(url)
        base = f"{p.scheme}://{p.netloc}"
        if base not in self._robots:
            rp = urllib.robotparser.RobotFileParser()
            try:
                res = self._raw(base + "/robots.txt", "GET", check_robots=False)
                rp.parse(res.text.splitlines() if res.status == 200 else [])
            except Exception:
                rp.parse([])
            self._robots[base] = rp
        return self._robots[base].can_fetch(UA, url)

    def _throttle(self, host):
        wait = MIN_INTERVAL_S - (time.monotonic() - self._last.get(host, 0))
        if wait > 0:
            time.sleep(wait)
        self._last[host] = time.monotonic()

    def _raw(self, url, method, check_robots=True):
        if not network_enabled():
            raise NetworkDisabled("La red del motor de investigación está desactivada (WW_RESEARCH_NETWORK≠1). "
                                  "Ver docs/OPERACION.md › Investigación con red.")
        method = method.upper()
        if method not in ALLOWED_METHODS:
            raise FetchRefused(f"Método no permitido: {method}")
        p = check_url(url)
        if self.count >= self.max_requests:
            raise FetchRefused("Límite de peticiones alcanzado para esta ejecución")
        if check_robots and not self._robots_ok(url):
            return FetchResult(url, url, None, error="bloqueado por robots.txt (no se consulta)")
        try:
            for info in socket.getaddrinfo(p.hostname, None):
                ip = ipaddress.ip_address(info[4][0])
                if ip.is_private or ip.is_loopback or ip.is_link_local:
                    raise FetchRefused(f"{p.hostname} resuelve a una dirección privada")
        except socket.gaierror as e:
            return FetchResult(url, url, None, error=f"DNS: {e}")
        self._throttle(p.hostname)
        self.count += 1
        req = urllib.request.Request(url, method=method, headers={"User-Agent": UA, "Accept": "text/html,*/*;q=0.5"})
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                body = r.read(MAX_BYTES) if method == "GET" else b""
                charset = r.headers.get_content_charset() or "utf-8"
                return FetchResult(url, r.geturl(), r.status, r.headers.get("Content-Type", ""), body.decode(charset, "replace"))
        except urllib.error.HTTPError as e:
            return FetchResult(url, url, e.code, error=f"HTTP {e.code}")
        except Exception as e:  # certificado vencido, timeout, etc.: se registra literal
            return FetchResult(url, url, None, error=f"{type(e).__name__}: {e}")

    def get(self, url):
        return self._raw(url, "GET")

    def head(self, url):
        r = self._raw(url, "HEAD")
        if r.status in (405, 501):  # algunos servidores no aceptan HEAD
            r = self._raw(url, "GET")
        return r
