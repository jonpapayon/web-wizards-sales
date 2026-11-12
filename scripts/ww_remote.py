#!/usr/bin/env python3
"""
Cliente del CRM en línea para el agente (Claude). ÚNICA vía de red autorizada desde la consola.

Usa AGENT_TOKEN (permiso «agente» del Worker): leer leads para deduplicar, subir y registrar candidatos, subir
dossiers y borradores, recalificar y mover a borrador / pendiente de aprobación. NO puede aprobar, enviar,
registrar contactos ni bajas, ni leer la lista de exclusión o la auditoría (lo rechaza el Worker).

    python3 scripts/ww_remote.py ping
    python3 scripts/ww_remote.py leads [--buscar texto]
    python3 scripts/ww_remote.py lead WW-AAAAMMDD-NNN
    python3 scripts/ww_remote.py candidates
    python3 scripts/ww_remote.py submit data/staging/AAAA-MM-DD/slug.json [--dossier data/research/slug.md] [--id CANDIDATO] [--lote NOMBRE]
    python3 scripts/ww_remote.py register CANDIDATO [--sucursal-de WW-...]
    python3 scripts/ww_remote.py reject CANDIDATO --motivo "..."
    python3 scripts/ww_remote.py doc WW-... dossier|evidencia data/research/archivo
    python3 scripts/ww_remote.py draft WW-... data/outreach/WW-...-inicial.md
    python3 scripts/ww_remote.py update WW-... --set campo=valor [...] [--nota "..."]

Configuración: AGENT_TOKEN y WW_API_BASE (por defecto https://sales.webwizards.click) desde el entorno o .dev.vars.
El token nunca se imprime. Solo se suben archivos de data/staging, data/research y data/outreach.
"""
import argparse, json, os, sys, urllib.error, urllib.request
from pathlib import Path
from urllib.parse import urlparse

REPO = Path(__file__).resolve().parent.parent
ROOT = Path(os.environ.get("WW_ROOT") or REPO).resolve()  # raíz de datos (pruebas: copia temporal)
DEFAULT_BASE = "https://sales.webwizards.click"
ALLOWED_HOSTS = {"sales.webwizards.click", "127.0.0.1", "localhost"}
UPLOAD_DIRS = [ROOT / "data" / d for d in ("staging", "research", "outreach")]


class RemoteError(Exception):
    pass


def config():
    vals = {}
    f = REPO / ".dev.vars"
    if f.exists():
        for line in f.read_text(encoding="utf-8").splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                k, v = line.split("=", 1)
                vals[k.strip()] = v.strip().strip("'").strip('"')
    token = os.environ.get("AGENT_TOKEN") or vals.get("AGENT_TOKEN", "")
    base = (os.environ.get("WW_API_BASE") or vals.get("WW_API_BASE") or DEFAULT_BASE).rstrip("/")
    u = urlparse(base)
    if u.hostname not in ALLOWED_HOSTS:
        raise RemoteError(f"Host no permitido: {u.hostname}. Solo {sorted(ALLOWED_HOSTS)}.")
    if u.scheme != "https" and u.hostname not in ("127.0.0.1", "localhost"):
        raise RemoteError("Solo HTTPS hacia el CRM en línea.")
    if not token:
        raise RemoteError("Falta AGENT_TOKEN (en .dev.vars o en el entorno). Lo crea una persona: ver docs/DESPLIEGUE.md.")
    return base, token


def call(method, path, body=None):
    base, token = config()
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(base + path, data=data, method=method,
                                 headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json",
                                          "User-Agent": "ww-remote/1"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as e:
        try:
            msg = json.loads(e.read().decode("utf-8")).get("error", "")
        except ValueError:
            msg = ""
        raise RemoteError(f"HTTP {e.code}: {msg or e.reason}")
    except urllib.error.URLError as e:
        raise RemoteError(f"Sin conexión con el CRM: {e.reason}")


def local_file(p, exts):
    path = (ROOT / p).resolve() if not Path(p).is_absolute() else Path(p).resolve()
    if not any(path.is_relative_to(d.resolve()) for d in UPLOAD_DIRS):
        raise RemoteError(f"Solo se suben archivos de data/staging, data/research o data/outreach: {p}")
    if path.suffix not in exts:
        raise RemoteError(f"Extensión no permitida ({path.suffix}); se esperaba {exts}.")
    if not path.exists():
        raise RemoteError(f"No existe {p}")
    return path.read_text(encoding="utf-8")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("ping")
    c = sub.add_parser("leads"); c.add_argument("--buscar")
    c = sub.add_parser("lead"); c.add_argument("lead_id")
    sub.add_parser("candidates")
    c = sub.add_parser("submit"); c.add_argument("staging"); c.add_argument("--dossier"); c.add_argument("--id"); c.add_argument("--lote")
    c = sub.add_parser("register"); c.add_argument("candidato"); c.add_argument("--sucursal-de")
    c = sub.add_parser("reject"); c.add_argument("candidato"); c.add_argument("--motivo", required=True)
    c = sub.add_parser("doc"); c.add_argument("lead_id"); c.add_argument("kind", choices=["dossier", "evidencia"]); c.add_argument("archivo")
    c = sub.add_parser("draft"); c.add_argument("lead_id"); c.add_argument("archivo")
    c = sub.add_parser("update"); c.add_argument("lead_id"); c.add_argument("--set", action="append", default=[]); c.add_argument("--nota")
    a = ap.parse_args()
    try:
        if a.cmd == "ping":
            n = len(call("GET", "/api/agent/leads")["leads"])
            out = {"ok": True, "base": config()[0], "leads": n}
        elif a.cmd == "leads":
            leads = call("GET", "/api/agent/leads")["leads"]
            if a.buscar:
                q = a.buscar.lower()
                leads = [L for L in leads if q in json.dumps(L, ensure_ascii=False).lower()]
            out = {"leads": leads}
        elif a.cmd == "lead":
            out = call("GET", f"/api/agent/leads/{a.lead_id}")
        elif a.cmd == "candidates":
            out = call("GET", "/api/agent/candidates")
        elif a.cmd == "submit":
            cand = json.loads(local_file(a.staging, {".json"}))
            body = {"candidato": cand, "dossier": local_file(a.dossier, {".md"}) if a.dossier else ""}
            if a.id:
                body["id"] = a.id
            if a.lote:
                body["lote"] = a.lote
            out = call("POST", "/api/agent/candidates", body)
        elif a.cmd == "register":
            out = call("POST", f"/api/agent/candidates/{a.candidato}/register", {"sucursal_de": a.sucursal_de} if a.sucursal_de else {})
        elif a.cmd == "reject":
            out = call("POST", f"/api/agent/candidates/{a.candidato}/reject", {"motivo": a.motivo})
        elif a.cmd == "doc":
            out = call("POST", f"/api/agent/leads/{a.lead_id}/doc",
                       {"kind": a.kind, "content": local_file(a.archivo, {".md"} if a.kind == "dossier" else {".json"})})
        elif a.cmd == "draft":
            out = call("POST", f"/api/agent/leads/{a.lead_id}/draft", {"content": local_file(a.archivo, {".md"})})
        else:
            sets = {}
            for s in a.set:
                if "=" not in s:
                    raise RemoteError(f"--set inválido: {s}")
                k, v = s.split("=", 1)
                sets[k.strip()] = v
            if not sets:
                raise RemoteError("Indica al menos un --set campo=valor.")
            out = call("POST", f"/api/agent/leads/{a.lead_id}/update", {"set": sets, "nota": a.nota or ""})
    except (RemoteError, ValueError) as e:
        print(f"RECHAZADO: {e}", file=sys.stderr)
        sys.exit(3)
    print(json.dumps(out, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
