#!/usr/bin/env python3
"""
Investigador local (Mac). Toma trabajos pendientes de la API, investiga páginas públicas en SOLO LECTURA y devuelve evidencia.

    WW_RESEARCH_NETWORK=1 WORKER_TOKEN=... python3 -m research.investigator --api https://sales.webwizards.click
    bin/ww investigator            # equivalente, leyendo .dev.vars / variables de entorno
    bin/ww sync                    # procesa los trabajos pendientes y termina (--once)

Garantías:
- Solo GET/HEAD. Con Playwright, toda petición con otro método se ABORTA en el navegador (formularios imposibles de enviar);
  no hace clics, no escribe en campos, descarta diálogos, bloquea descargas y service workers.
- Respeta robots.txt (si lo prohíbe, no visita y lo registra), límite de frecuencia por dominio, sin CAPTCHAs ni cuentas.
- Separa evidencia VERIFICADA (observada en HTML crudo o navegador, confianza alta), INFERIDA (confianza baja, no puntúa)
  y NO ENCONTRADA. Las capturas quedan en este Mac (data/research/capturas/) y se reporta su ruta y sha256.
Playwright es opcional:  pip install playwright && python -m playwright install chromium   (lo instala una persona)
"""
import argparse, hashlib, http.client, json, os, re, socket, sys, time
from datetime import date
from pathlib import Path
from urllib.parse import urlsplit

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))
from research.fetch import NetworkDisabled, ReadOnlyFetcher  # noqa: E402
from research.site_audit import analyze_html, CITA  # noqa: E402

CAPTURAS = REPO / "data" / "research" / "capturas"
HIGH_TICKET = re.compile(r"(implant\w*|ortodonc\w*|brackets|cirug\w*|endodoncia|blanqueamiento|botox|l[aá]ser|depilaci[oó]n|hospitalizaci[oó]n|rayos x|ultrasonido|maxilofacial)", re.I)


# ------------------------------------------------------------------ cliente de la API (solo nuestra propia API)
class ApiClient:
    def __init__(self, base, token, timeout=30):
        u = urlsplit(base)
        if u.scheme not in ("http", "https") or (u.scheme == "http" and u.hostname not in ("127.0.0.1", "localhost")):
            raise ValueError("La API debe ser https (o http solo en 127.0.0.1/localhost).")
        if not token:
            raise ValueError("Falta WORKER_TOKEN.")
        self.u, self.token, self.timeout = u, token, timeout

    def _post(self, path, payload):
        conn = (http.client.HTTPSConnection if self.u.scheme == "https" else http.client.HTTPConnection)(self.u.hostname, self.u.port, timeout=self.timeout)
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        conn.request("POST", path, body=body, headers={"Authorization": f"Bearer {self.token}", "Content-Type": "application/json",
                                                       "Host": self.u.netloc, "User-Agent": "WWSalesOS-Investigador/1.0"})
        r = conn.getresponse(); data = r.read(); conn.close()
        try:
            out = json.loads(data or b"{}")
        except ValueError:
            out = {"error": data[:200].decode("utf-8", "replace")}
        if r.status >= 400:
            raise RuntimeError(f"API {path} → HTTP {r.status}: {out.get('error')}")
        return out

    def claim(self, worker_id):
        return self._post("/api/worker/claim", {"worker_id": worker_id}).get("trabajo")

    def result(self, job_id, payload):
        return self._post(f"/api/worker/jobs/{job_id}/result", payload)


# ------------------------------------------------------------------ navegador (opcional)
def browser_available():
    try:
        import playwright.sync_api  # noqa: F401
        return True
    except ImportError:
        return False


def browser_check(url, job_id):
    """Abre la página en Chromium headless en solo lectura: capturas escritorio/móvil, desbordamiento horizontal a 375 px,
    formularios y botones (sin interactuar). Devuelve hallazgos verificados."""
    from playwright.sync_api import sync_playwright
    CAPTURAS.mkdir(parents=True, exist_ok=True)
    out = {"capturas": [], "evidencias": [], "datos": {}}
    blocked = []

    def guard(route):
        if route.request.method not in ("GET", "HEAD"):
            blocked.append(route.request.method)
            return route.abort()
        return route.continue_()

    with sync_playwright() as p:
        b = p.chromium.launch(headless=True)
        for vista, vp in (("escritorio", {"width": 1366, "height": 900}), ("movil", {"width": 375, "height": 812})):
            ctx = b.new_context(viewport=vp, accept_downloads=False, service_workers="block", java_script_enabled=True,
                                user_agent="Mozilla/5.0 (compatible; WWSalesOS-Investigador/1.0; lectura publica)")
            page = ctx.new_page()
            page.route("**/*", guard)
            page.on("dialog", lambda d: d.dismiss())
            resp = page.goto(url, wait_until="domcontentloaded", timeout=30000)
            page.wait_for_timeout(1500)
            shot = CAPTURAS / f"job{job_id}-{vista}.png"
            page.screenshot(path=str(shot), full_page=False)
            out["capturas"].append({"vista": vista, "path": str(shot.relative_to(REPO)), "sha256": hashlib.sha256(shot.read_bytes()).hexdigest()})
            if vista == "escritorio":
                out["datos"]["titulo"] = page.title()
                out["datos"]["status_navegador"] = resp.status if resp else None
                out["html_renderizado"] = page.content()
                out["datos"]["formularios_dom"] = page.eval_on_selector_all("form", "fs => fs.map(f => ({action: f.getAttribute('action') || '', method: (f.getAttribute('method') || 'get').toLowerCase(), campos: f.querySelectorAll('input,select,textarea').length}))")
                out["datos"]["botones_cita"] = page.eval_on_selector_all("a,button", "els => els.filter(e => /cita|agenda|reserv/i.test(e.innerText)).slice(0, 20).map(e => ({texto: e.innerText.trim().slice(0, 80), href: e.getAttribute('href') || ''}))")
            else:
                over = page.evaluate("() => ({sw: document.documentElement.scrollWidth, iw: window.innerWidth})")
                out["datos"]["movil_ancho"] = over
                if over["sw"] > over["iw"] + 8:
                    out["evidencias"].append({"senal": "WEB_NOT_MOBILE", "confianza": "alta", "url": url,
                                              "observacion": f"En vista móvil de 375 px el contenido mide {over['sw']} px de ancho: hay desplazamiento horizontal.",
                                              "metodo": "Playwright Chromium headless, viewport 375×812, captura " + out["capturas"][-1]["path"]})
            ctx.close()
        b.close()
    out["datos"]["peticiones_no_get_bloqueadas"] = len(blocked)
    return out


# ------------------------------------------------------------------ procesamiento
def _ev(e, metodo, confianza=None):
    c = confianza or e.get("confianza", "alta")
    return {"senal": e["senal"], "observacion": e["observacion"], "url": e.get("url", ""), "confianza": c,
            "tipo": "verificada" if c in ("alta", "media") else "inferida", "metodo": metodo, "fecha_verificacion": date.today().isoformat()}


def process_site(job, fetcher, use_browser):
    from research.site_audit import audit
    url = job["target"]
    t0 = time.monotonic()
    res = {"url": url, "motor": "http", "evidencias": [], "no_encontrado": [], "datos": {}, "capturas": []}
    a = audit(url, fetcher, max_links=25)
    res["status"] = a.get("status")
    if a.get("error", "").startswith("bloqueado por robots.txt"):
        res["robots_bloqueado"] = True
        res["no_encontrado"].append("sitio no consultado: robots.txt lo prohíbe")
        res["duracion_s"] = round(time.monotonic() - t0, 1)
        return res
    for e in a.get("evidencias", []):
        if e["senal"] == "WEB_NOT_MOBILE":  # ausencia de viewport en HTML: inferencia, no observación
            res["evidencias"].append(_ev(e, "HTML crudo: falta <meta name=viewport> (inferencia; confirmar en vista móvil)", "baja"))
        else:
            res["evidencias"].append(_ev(e, "research.site_audit: HTML crudo y estado HTTP de cada enlace", "alta"))
    datos = a.get("datos", {})
    res["datos"] = {k: datos.get(k) for k in ("copyright", "whatsapp_enlaces", "telefonos_visibles", "tel", "mailto", "formularios", "reserva_en_linea")}
    page = fetcher.get(url)
    text = re.sub(r"<[^>]+>", " ", page.text or "")
    res["datos"]["servicios"] = sorted({m.group(1).lower() for m in HIGH_TICKET.finditer(text)})[:15]
    if use_browser:
        try:
            br = browser_check(url, job["id"])
            res["motor"] = "playwright"
            res["capturas"] = br["capturas"]
            res["datos"].update(br["datos"])
            if br["evidencias"]:
                res["evidencias"] = [e for e in res["evidencias"] if e["senal"] != "WEB_NOT_MOBILE"] + [_ev(e, e["metodo"], "alta") for e in br["evidencias"]]
        except Exception as e:  # el navegador falla: se conserva la investigación HTTP y se informa
            res["datos"]["navegador_error"] = f"{type(e).__name__}: {str(e)[:200]}"
    if not res["datos"].get("mailto"):
        res["no_encontrado"].append("email en el sitio")
    if not (res["datos"].get("tel") or res["datos"].get("telefonos_visibles")):
        res["no_encontrado"].append("teléfono en el sitio")
    if not res["datos"].get("whatsapp_enlaces"):
        res["no_encontrado"].append("enlace de WhatsApp")
    if not res["datos"].get("reserva_en_linea"):
        res["no_encontrado"].append("sistema de reserva en línea")
    res["duracion_s"] = round(time.monotonic() - t0, 1)
    return res


def process_osm(job, fetcher):
    from research.discover import osm_query, from_osm
    b = job["business"]
    r = fetcher.get(osm_query(b["nicho"], b["ciudad"], int(b.get("limite", 60))))
    if r.status != 200:
        raise RuntimeError(f"Overpass: {r.error or r.status}")
    negocios = from_osm(json.loads(r.text), b["ciudad"])
    for n in negocios:
        d = re.sub(r"\D", "", n.get("telefono_publico") or "")[-10:]
        n["telefono_e164"] = "+52" + d if len(d) == 10 else ""
        n["ref_id"] = n["fuente_url"].rsplit("/", 2)[-2] + "/" + n["fuente_url"].rsplit("/", 1)[-1]
    return {"negocios": negocios, "fuente": "OpenStreetMap (© OpenStreetMap contributors, ODbL)"}


def process_job(job, fetcher, use_browser=False):
    if job["tipo"] == "descubrir_osm":
        return process_osm(job, fetcher)
    if job["tipo"] == "sin_sitio":
        return {"motor": "ninguno", "evidencias": [], "no_encontrado": ["sitio web (el directorio no registra uno)"], "datos": {}, "capturas": []}
    return process_site(job, fetcher, use_browser)


def run(api, fetcher, worker_id, once=False, max_jobs=None, use_browser=False, idle_s=60, log=print):
    done = 0
    while max_jobs is None or done < max_jobs:
        job = api.claim(worker_id)
        if not job:
            if once:
                break
            time.sleep(idle_s)
            continue
        try:
            payload = {"estado": "hecho", "resultado": process_job(job, fetcher, use_browser)}
        except NetworkDisabled:
            raise
        except Exception as e:
            payload = {"estado": "fallido", "error": f"{type(e).__name__}: {e}"[:400]}
        out = api.result(job["id"], payload)
        log(f"trabajo {job['id']} ({job['tipo']}) → {payload['estado']} · {json.dumps(out.get('resultado', out), ensure_ascii=False)[:160]}")
        done += 1
    return done


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--api", default=os.environ.get("WW_API_BASE", "http://127.0.0.1:8787"))
    ap.add_argument("--once", action="store_true", help="procesar lo pendiente y terminar")
    ap.add_argument("--max", type=int)
    ap.add_argument("--no-browser", action="store_true", help="no usar Playwright aunque esté instalado")
    a = ap.parse_args()
    use_browser = browser_available() and not a.no_browser
    print(f"Investigador · API {a.api} · navegador: {'Playwright' if use_browser else 'no (solo HTML)'} · red: {'activada' if os.environ.get('WW_RESEARCH_NETWORK') == '1' else 'DESACTIVADA'}")
    try:
        n = run(ApiClient(a.api, os.environ.get("WORKER_TOKEN", "")), ReadOnlyFetcher(max_requests=5000), f"mac-{socket.gethostname()}"[:60],
                once=a.once, max_jobs=a.max, use_browser=use_browser)
    except NetworkDisabled as e:
        sys.exit(str(e))
    print(f"{n} trabajos procesados.")


if __name__ == "__main__":
    main()
