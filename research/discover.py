#!/usr/bin/env python3
"""
Descubrimiento de negocios en fuentes públicas (solo lectura) → candidatos para el área de revisión.

    WW_RESEARCH_NETWORK=1 python3 -m research.discover --nicho dentista --ciudad Puebla [--limite 30] [--auditar]

Fuentes:
  osm    OpenStreetMap (Overpass API). Gratuita, licencia ODbL (citar "© OpenStreetMap contributors"). Cobertura parcial.
  denue  INEGI DENUE (directorio oficial de unidades económicas). Gratuita; requiere DENUE_TOKEN (registro).
  places Google Places API. De pago; requiere GOOGLE_PLACES_API_KEY y autorización. Solo preparado.

Salida: data/staging/<fecha>/_descubrimiento-<fuente>-<nicho>-<ciudad>.json con la lista de negocios, marcando
duplicados y exclusiones del CRM. No crea candidatos completos: cada negocio necesita dossier, evidencias y
calificación (subagentes lead-researcher / lead-qualifier) antes de pasar a revisión.
"""
import argparse, json, os, sys, urllib.parse
from datetime import date
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "scripts"))

OSM_TAGS = {
    "dentista": ['["amenity"="dentist"]', '["healthcare"="dentist"]'],
    "clinica": ['["amenity"="doctors"]', '["amenity"="clinic"]', '["healthcare"="doctor"]'],
    "estetica_spa": ['["shop"="beauty"]', '["leisure"="spa"]', '["amenity"="spa"]'],
    "veterinaria": ['["amenity"="veterinary"]'],
}
DENUE_SCIAN = {"dentista": "621211", "clinica": "621111", "estetica_spa": "812110", "veterinaria": "541941"}


def osm_query(nicho, ciudad, limite):
    parts = "".join(f"nwr(area.a){t};" for t in OSM_TAGS[nicho])
    q = f'[out:json][timeout:30];area["name"="{ciudad}"]["boundary"="administrative"]->.a;({parts});out center tags {limite};'
    return "https://overpass-api.de/api/interpreter?" + urllib.parse.urlencode({"data": q})


def from_osm(data, ciudad):
    out = []
    for e in data.get("elements", []):
        t = e.get("tags", {})
        if not t.get("name"):
            continue
        addr = " ".join(x for x in [t.get("addr:street"), t.get("addr:housenumber"), t.get("addr:suburb"), t.get("addr:postcode")] if x)
        out.append({"nombre_negocio": t["name"], "ciudad": ciudad, "direccion": addr or None,
                    "sitio_web": t.get("website") or t.get("contact:website"), "telefono_publico": t.get("phone") or t.get("contact:phone"),
                    "email_publico": t.get("email") or t.get("contact:email"),
                    "fuente": "directorio_otro", "fuente_url": f"https://www.openstreetmap.org/{e['type']}/{e['id']}",
                    "licencia": "© OpenStreetMap contributors (ODbL)",
                    "aviso": "Dato de directorio colaborativo: verificar en el sitio o ficha del propio negocio antes de usarlo."})
    return out


def mark_crm(items):
    import crm_tool as crm
    _, leads = crm.read_csv("leads")
    _, supp = crm.read_csv("suppression")
    for it in items:
        c = {"nombre_negocio": it["nombre_negocio"], "ciudad": it["ciudad"], "sitio_web": it.get("sitio_web") or "",
             "telefono_e164": "", "email_publico": it.get("email_publico") or "", "direccion": it.get("direccion") or ""}
        exact, possible = crm.find_duplicates(c, leads)
        it["en_crm"] = [x[0] for x in exact] + [x[0] for x in possible]
        it["suprimido"] = bool(crm.suppressed_hits(c, supp))
    return items


def main():
    from research.fetch import ReadOnlyFetcher, NetworkDisabled
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--nicho", required=True, choices=list(OSM_TAGS)); ap.add_argument("--ciudad", required=True)
    ap.add_argument("--fuente", default="osm", choices=["osm", "denue", "places"]); ap.add_argument("--limite", type=int, default=50)
    ap.add_argument("--auditar", action="store_true", help="auditar el sitio web de cada negocio (research.site_audit)")
    a = ap.parse_args()
    if a.fuente == "places":
        sys.exit("Google Places API es de pago: requiere GOOGLE_PLACES_API_KEY y autorización explícita. Ver docs/INTEGRACIONES.md.")
    if a.fuente == "denue" and not os.environ.get("DENUE_TOKEN"):
        sys.exit("DENUE requiere DENUE_TOKEN (gratuito, registro en INEGI). Ver docs/INTEGRACIONES.md.")
    f = ReadOnlyFetcher(max_requests=a.limite * 45 + 5)
    try:
        if a.fuente == "osm":
            r = f.get(osm_query(a.nicho, a.ciudad, a.limite))
            if r.status != 200:
                sys.exit(f"Overpass no respondió correctamente: {r.error or r.status}")
            items = from_osm(json.loads(r.text), a.ciudad)
        else:
            url = (f"https://www.inegi.org.mx/app/api/denue/v1/consulta/BuscarAreaActEstr/00/0/0/0/0/0/0/0/0/0/1/{a.limite}/0/"
                   f"{DENUE_SCIAN[a.nicho]}/{os.environ['DENUE_TOKEN']}")
            sys.exit("DENUE: integración preparada; validar el endpoint y la entidad/municipio antes del primer uso. URL base: " + url.split("/BuscarAreaActEstr")[0])
        items = mark_crm(items)
        if a.auditar:
            from research.site_audit import audit
            for it in items:
                if it.get("sitio_web") and not it["en_crm"] and not it["suprimido"]:
                    it["auditoria"] = audit(it["sitio_web"], f, max_links=25)
    except NetworkDisabled as e:
        sys.exit(str(e))
    out_dir = REPO / "data" / "staging" / date.today().isoformat()
    out_dir.mkdir(parents=True, exist_ok=True)
    slug = f"{a.fuente}-{a.nicho}-{a.ciudad}".lower().replace(" ", "-")
    out = out_dir / f"_descubrimiento-{slug}.json"
    out.write_text(json.dumps({"fuente": a.fuente, "nicho": a.nicho, "ciudad": a.ciudad, "fecha": date.today().isoformat(),
                               "negocios": items}, ensure_ascii=False, indent=2), encoding="utf-8")
    nuevos = [i for i in items if not i["en_crm"] and not i["suprimido"]]
    print(f"{len(items)} negocios encontrados · {len(nuevos)} nuevos · guardado en {out.relative_to(REPO)}")


if __name__ == "__main__":
    main()
