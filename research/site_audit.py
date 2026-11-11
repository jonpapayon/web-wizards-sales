#!/usr/bin/env python3
"""
Auditoría de solo lectura de un sitio web: produce evidencias con confianza "alta" (HTML crudo, no resumido).

    WW_RESEARCH_NETWORK=1 python3 -m research.site_audit https://ejemplo.com.mx/ [--max-links 40] [--out archivo.json]

Detecta (sin enviar nada): enlaces internos rotos, botones de cita/WhatsApp que llevan a error, dominios que no
resuelven, falta de HTTPS, falta de etiqueta viewport (no adaptado a móvil), año de copyright antiguo, WhatsApp
cuyo número visible no coincide con su enlace, ausencia de enlace click-to-chat, formularios (solo presencia y
destino; nunca se envían) y presencia de sistemas de reserva.
La función analyze_html() es pura (sin red) y es la que se prueba con fixtures.
"""
import argparse, json, re, sys, time
from datetime import date
from html.parser import HTMLParser
from urllib.parse import urljoin, urlsplit

CITA = re.compile(r"\b(cita|agenda|agendar|reserv|book|appointment)", re.I)
WA_HREF = re.compile(r"(?:wa\.me/|api\.whatsapp\.com/send\?phone=|whatsapp://send\?phone=)(\+?\d{8,15})", re.I)
PHONE_TXT = re.compile(r"(?:\+?52[\s.-]?)?\(?\d{2,3}\)?[\s.-]?\d{3,4}[\s.-]?\d{2}[\s.-]?\d{2}")
BOOKING = re.compile(r"(calendly|doctoralia|agendapro|simplybook|setmore|booksy|fresha|reservio|google\.com/maps/reserve)", re.I)


class _Parser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.links, self.forms, self.meta, self.text, self._a = [], [], {}, [], None

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "a":
            self._a = {"href": a.get("href", ""), "text": ""}
        elif tag == "meta" and a.get("name"):
            self.meta[a["name"].lower()] = a.get("content", "")
        elif tag == "form":
            self.forms.append({"action": a.get("action", ""), "method": (a.get("method") or "get").lower()})

    def handle_endtag(self, tag):
        if tag == "a" and self._a is not None:
            self._a["text"] = re.sub(r"\s+", " ", self._a["text"]).strip()
            self.links.append(self._a)
            self._a = None

    def handle_data(self, data):
        self.text.append(data)
        if self._a is not None:
            self._a["text"] += data


def digits(s):
    return re.sub(r"\D", "", s or "")[-10:]


def analyze_html(url, html, today=None):
    """Análisis sin red. Devuelve hallazgos y enlaces a comprobar."""
    today = today or date.today()
    p = _Parser()
    p.feed(html)
    text = " ".join(p.text)
    host = urlsplit(url).hostname or ""
    out = {"url": url, "hallazgos": [], "datos": {}, "enlaces_internos": [], "enlaces_cita": [], "enlaces_externos_cita": []}
    if urlsplit(url).scheme != "https":
        out["hallazgos"].append({"senal": "WEB_NO_HTTPS", "observacion": f"La página se sirve por HTTP sin cifrar: {url}"})
    if "viewport" not in p.meta:
        out["hallazgos"].append({"senal": "WEB_NOT_MOBILE", "observacion": "El HTML no declara <meta name=\"viewport\">; "
                                 "la página no está preparada para pantallas móviles (confirmar con vista a 375 px)."})
    years = [int(y) for y in re.findall(r"(?:©|&copy;|copyright)\s*(?:\D{0,15})?((?:19|20)\d{2})", text, re.I)]
    if years:
        out["datos"]["copyright"] = max(years)
        if today.year - max(years) >= 3:
            out["hallazgos"].append({"senal": "WEB_OUTDATED", "observacion": f"El pie de página muestra copyright {max(years)} "
                                     f"({today.year - max(years)} años antes de la verificación)."})
    wa_links = [(l, WA_HREF.search(l["href"])) for l in p.links if WA_HREF.search(l["href"])]
    out["datos"]["whatsapp_enlaces"] = sorted({digits(m.group(1)) for _, m in wa_links})
    visible = {digits(x) for x in PHONE_TXT.findall(text) if len(digits(x)) == 10}
    out["datos"]["telefonos_visibles"] = sorted(visible)
    for l, m in wa_links:
        lt = digits(l["text"])
        if len(lt) == 10 and lt != digits(m.group(1)):
            out["hallazgos"].append({"senal": "INFO_INCONSISTENT", "observacion": f"El enlace de WhatsApp muestra el texto "
                                     f"'{l['text']}' pero apunta a {m.group(1)} (dígitos distintos)."})
    if not wa_links and re.search(r"whats\s*app", text, re.I):
        out["hallazgos"].append({"senal": "WA_NO_LINK", "observacion": "La página menciona WhatsApp pero no tiene enlace "
                                 "click-to-chat (wa.me / api.whatsapp.com)."})
    out["datos"]["tel"] = sorted({l["href"][4:] for l in p.links if l["href"].startswith("tel:")})
    out["datos"]["mailto"] = sorted({l["href"][7:].split("?")[0] for l in p.links if l["href"].startswith("mailto:")})
    out["datos"]["formularios"] = p.forms
    out["datos"]["reserva_en_linea"] = sorted({m.group(1).lower() for l in p.links for m in [BOOKING.search(l["href"])] if m})
    seen = set()
    for l in p.links:
        href = l["href"].strip()
        if not href or href.startswith(("#", "mailto:", "tel:", "javascript:", "whatsapp:")):
            continue
        absu = urljoin(url, href).split("#")[0]
        h = urlsplit(absu).hostname or ""
        entry = {"texto": l["text"][:80], "href": href, "url": absu}
        if CITA.search(l["text"]) and not WA_HREF.search(href):
            (out["enlaces_cita"] if h.endswith(host) or host.endswith(h) else out["enlaces_externos_cita"]).append(entry)
        if (h == host or h.endswith("." + host)) and absu not in seen:
            seen.add(absu)
            out["enlaces_internos"].append(entry)
    if not any(CITA.search(l["text"]) or WA_HREF.search(l["href"]) or l["href"].startswith("tel:") for l in p.links):
        out["hallazgos"].append({"senal": "WEB_NO_CTA", "observacion": "No hay enlaces de cita, WhatsApp ni teléfono en la página."})
    return out


def audit(url, fetcher, max_links=40):
    t0 = time.monotonic()
    home = fetcher.get(url)
    res = {"url": url, "status": home.status, "error": home.error, "fetched_at": home.fetched_at, "evidencias": []}
    if home.status is None or home.status >= 400:
        res["evidencias"].append({"senal": "WEB_BROKEN", "observacion": f"La página principal no carga: {home.error or home.status}",
                                  "url": url, "confianza": "alta"})
        return res
    a = analyze_html(home.final_url, home.text)
    res["datos"] = a["datos"]
    for f in a["hallazgos"]:
        res["evidencias"].append(dict(f, url=home.final_url, confianza="alta" if f["senal"] != "WEB_NOT_MOBILE" else "media"))
    checked = {}
    for e in (a["enlaces_cita"] + a["enlaces_externos_cita"] + a["enlaces_internos"])[:max_links]:
        if e["url"] in checked:
            continue
        r = fetcher.head(e["url"])
        checked[e["url"]] = r
        if r.status is None or r.status >= 400:
            kind = "botón/enlace de cita" if CITA.search(e["texto"]) else "enlace interno"
            res["evidencias"].append({"senal": "WEB_BROKEN", "url": e["url"], "confianza": "alta",
                                      "observacion": f"El {kind} '{e['texto'] or e['href']}' (href {e['href']}) devuelve: {r.error or r.status}"})
    res["enlaces_comprobados"] = len(checked)
    res["duracion_s"] = round(time.monotonic() - t0, 1)
    return res


def main():
    from research.fetch import ReadOnlyFetcher, NetworkDisabled
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("url"); ap.add_argument("--max-links", type=int, default=40); ap.add_argument("--out")
    a = ap.parse_args()
    try:
        res = audit(a.url, ReadOnlyFetcher(max_requests=a.max_links + 5), a.max_links)
    except NetworkDisabled as e:
        sys.exit(str(e))
    today = date.today().isoformat()
    for e in res["evidencias"]:
        e.update(fecha_verificacion=today, metodo="research.site_audit v1: HTML crudo y estado HTTP de cada enlace")
    txt = json.dumps(res, ensure_ascii=False, indent=2)
    if a.out:
        open(a.out, "w", encoding="utf-8").write(txt)
    print(txt)


if __name__ == "__main__":
    main()
