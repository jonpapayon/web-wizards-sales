#!/usr/bin/env python3
"""
Web Wizards Sales OS — servidor local del dashboard.

    python3 app/server.py            # CRM real   → http://127.0.0.1:8765
    python3 app/server.py --demo     # datos de demostración (carpeta demo/), nunca mezclados con los reales

Solo biblioteca estándar. Escucha únicamente en 127.0.0.1.
Lecturas: directamente de los CSV/archivos. Escrituras: SIEMPRE mediante scripts/crm_tool.py (misma validación,
mismas garantías y auditoría que la línea de comandos). No existe ningún endpoint que envíe mensajes,
llene formularios o haga peticiones a internet: aprobar un borrador solo cambia su estado en el CRM.
"""
import argparse, hmac, json, mimetypes, os, re, secrets, subprocess, sys
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

REPO = Path(__file__).resolve().parent.parent
STATIC = REPO / "app" / "static"
CRM_TOOL = REPO / "scripts" / "crm_tool.py"
VERSION = "1.0.0"
MAX_BODY = 64 * 1024

# ---------------------------------------------------------------- arranque: el entorno se fija antes de importar crm_tool
def configure(demo: bool, data_root=None):
    root = Path(data_root).resolve() if data_root else (REPO / "demo" if demo else REPO)
    os.environ["WW_ROOT"] = str(root)
    sys.path.insert(0, str(REPO / "scripts"))
    import crm_tool  # noqa: E402  (lee WW_ROOT al importar)
    return crm_tool, root


crm = None
ROOT = REPO
SCHEMA = {}
TOKEN = secrets.token_urlsafe(32)
PORT = 8765


# ---------------------------------------------------------------- utilidades de lectura
def rows(kind):
    return crm.read_csv(kind)[1]


def read_text(p: Path):
    return p.read_text(encoding="utf-8") if p.is_file() else None


def audit_lines(limit=None, since=None, entidad=None):
    p = ROOT / "data" / "crm" / "audit.jsonl"
    out = []
    if p.exists():
        for line in p.read_text(encoding="utf-8").splitlines():
            try:
                e = json.loads(line)
            except ValueError:
                continue
            if since and e.get("ts", "") <= since:
                continue
            if entidad and entidad not in str(e.get("entidad", "")):
                continue
            out.append(e)
    return out[-limit:] if limit else out


def parse_frontmatter(text):
    meta, body = {}, text
    m = re.match(r"^---\n(.*?)\n---\n?", text, re.S)
    if m:
        body = text[m.end():]
        for line in m.group(1).splitlines():
            if ":" in line:
                k, v = line.split(":", 1)
                meta[k.strip()] = v.strip().strip('"')
    return meta, body


def split_sections(body):
    secs, cur, buf = {}, "_intro", []
    for line in body.splitlines():
        if line.startswith("## "):
            secs[cur] = "\n".join(buf).strip()
            cur, buf = line[3:].strip(), []
        else:
            buf.append(line)
    secs[cur] = "\n".join(buf).strip()
    return secs


def draft_files(lead_id=None):
    out = []
    for p in sorted((ROOT / "data" / "outreach").glob("WW-*.md")):
        if lead_id and not p.name.startswith(lead_id):
            continue
        meta, body = parse_frontmatter(p.read_text(encoding="utf-8"))
        secs = split_sections(body)
        out.append({"archivo": str(p.relative_to(ROOT)), "lead_id": meta.get("lead_id") or p.name[:15], "meta": meta,
                    "asunto": secs.get("Asunto (solo email)", ""), "mensaje": secs.get("Mensaje", ""),
                    "variante_b": secs.get("Variante B (opcional, otro gancho)", ""),
                    "trazabilidad": secs.get("Trazabilidad", ""), "notas": secs.get("Notas para quien aprueba", ""),
                    "cumplimiento": next((secs[k] for k in reversed(list(secs)) if k.startswith("Revisión de cumplimiento")), ""),
                    "historial": secs.get("Historial", ""),
                    "aviso": secs.get("_intro", ""), "markdown": body})
    return out


NEXT_ACTION = {
    "calificado": "Preparar borrador", "mensaje_borrador": "Revisión de cumplimiento",
    "pendiente_aprobacion": "Aprobar o pedir cambios", "aprobado": "Enviar (persona) y registrar envío",
    "contactado": "Seguimiento", "en_conversacion": "Responder", "interesado": "Proponer demostración",
    "reunion_agendada": "Hacer la demostración", "demo_realizada": "Enviar propuesta",
    "propuesta_enviada": "Dar seguimiento a propuesta", "negociacion": "Cerrar condiciones", "pausado": "Retomar en la fecha pedida",
}
def active_states():  # SCHEMA se carga al arrancar (main), no al importar
    return set(SCHEMA["x-estados-con-seguimiento"])


COMMERCIAL = {"proxima_accion": 300, "motivo_perdida": 40, "fecha_demo": 10, "fecha_propuesta": 10,
              "monto_implementacion": 12, "monto_mensual": 12}


def next_action(L):
    st = L["estado_pipeline"]
    if st in SCHEMA["x-estados-finales"]:
        return "—"
    if st == "calificado" and L["clasificacion"] == "C":
        return "Sin mensaje (clase C)"
    a = L.get("proxima_accion") or NEXT_ACTION.get(st, "—")  # la acción concreta capturada por una persona tiene prioridad
    return f"{a} · {L['proximo_seguimiento']}" if L.get("proximo_seguimiento") else a


def commercial_args(body):
    args = []
    for k, n in COMMERCIAL.items():
        v = str(body.get(k) or "").strip()[:n]
        if v:
            args += ["--set", f"{k}={v}"]
    return args


def api_today():
    """Lo que una persona debe hacer hoy (misma forma que cloudflare/src/views.js › todayView)."""
    leads, fus = rows("leads"), rows("followups")
    today = datetime.now(crm.TZ).date()
    t, in7 = today.isoformat(), (today + timedelta(days=7)).isoformat()
    finals = SCHEMA["x-estados-finales"]
    nombre = {L["lead_id"]: L["nombre_negocio"] for L in leads}
    s2 = lambda L: dict(lead_summary(L), accion=L.get("proxima_accion") or NEXT_ACTION.get(L["estado_pipeline"], ""),
                        fecha=L.get("proximo_seguimiento", ""))
    live = [L for L in leads if L["estado_pipeline"] not in finals and L.get("opt_out") != "true"]
    by_fecha = lambda x: x.get("fecha") or ""
    return {
        "hoy": t,
        "acciones": sorted([dict(s2(L), vencido=L["proximo_seguimiento"] < t) for L in live
                            if L.get("proximo_seguimiento") and L["proximo_seguimiento"] <= t], key=by_fecha),
        "sin_accion": [s2(L) for L in live if L["estado_pipeline"] in active_states() and not (L.get("proxima_accion") and L.get("proximo_seguimiento"))],
        "por_enviar": [s2(L) for L in live if L["estado_pipeline"] == "aprobado"],
        "por_aprobar": [s2(L) for L in live if L["estado_pipeline"] == "pendiente_aprobacion"],
        "proximos": sorted([s2(L) for L in live if t < (L.get("proximo_seguimiento") or "") <= in7], key=by_fecha),
        "seguimientos": [dict(f, negocio=nombre.get(f["lead_id"], ""), vencido=f["fecha_programada"] < t) for f in fus
                         if f["estado"] not in ("enviado", "cancelado") and f["fecha_programada"] <= t],
    }


def lead_summary(L):
    keys = ["lead_id", "nombre_negocio", "nicho", "subnicho", "ciudad", "estado_mx", "sitio_web", "telefono_publico",
            "whatsapp_publico", "email_publico", "puntaje_total", "clasificacion", "estado_pipeline", "fecha_registro",
            "fecha_fuente", "proximo_seguimiento", "aprobacion_estado", "fuente", "opt_out", "canal_preferido",
            "motivo_perdida", "fecha_demo", "fecha_propuesta", "monto_implementacion", "monto_mensual"]
    d = {k: L.get(k, "") for k in keys}
    d["proxima_accion"] = next_action(L)
    return d


def staging_candidates():
    out = []
    base = ROOT / "data" / "staging"
    if not base.exists():
        return out
    leads, supp = rows("leads"), rows("suppression")
    for p in sorted(base.glob("*/*.json")):
        if p.name.startswith("_"):
            continue
        try:
            cand = json.loads(p.read_text(encoding="utf-8"))
        except ValueError:
            out.append({"archivo": str(p.relative_to(ROOT)), "error": "JSON inválido"})
            continue
        errs = crm.validate(SCHEMA, SCHEMA["$defs"]["leadCandidate"], cand, "candidato")
        cal = cand.get("calificacion")
        if cal and not errs:
            errs += crm.check_qualification(SCHEMA, cal, cand.get("evidencias", []), cand.get("descalificadores", []), cand)
        exact, possible = crm.find_duplicates(cand, leads)
        out.append({"archivo": str(p.relative_to(ROOT)), "lote": p.parent.name, "nombre_negocio": cand.get("nombre_negocio"),
                    "nicho": cand.get("nicho"), "ciudad": cand.get("ciudad"), "sitio_web": cand.get("sitio_web", ""),
                    "calificado": bool(cal), "clasificacion": (cal or {}).get("clasificacion"),
                    "puntaje": (cal or {}).get("puntaje_total"), "errores": errs,
                    "suprimido": crm.suppressed_hits(cand, supp), "duplicados": exact, "posibles_duplicados": possible,
                    "evidencias": cand.get("evidencias", []), "campos_no_encontrados": cand.get("campos_no_encontrados", []),
                    "dossier": read_text(ROOT / cand.get("dossier_path", "")) if cand.get("dossier_path") else None,
                    "listo_para_registrar": bool(cal) and not errs and not exact and not crm.suppressed_hits(cand, supp)})
    return out


def counted_rejected():
    base = ROOT / "data" / "staging"
    return len(list(base.glob("*/rechazados/*.json"))) if base.exists() else 0


# ---------------------------------------------------------------- vistas de lectura
def api_summary():
    leads, ints = rows("leads"), rows("interactions")
    today_s = datetime.now(crm.TZ).date().isoformat()
    ab = [L for L in leads if L["clasificacion"] in ("A", "B")]
    contacted_states = active_states() | {"ganado", "perdido"}
    contactados = [L for L in leads if L.get("fecha_primer_contacto") or L["estado_pipeline"] in contacted_states]
    respuestas = [i for i in ints if i["direccion"] == "entrante"]
    reuniones = {L["lead_id"] for L in leads if L["estado_pipeline"] in ("reunion_agendada", "demo_realizada", "propuesta_enviada", "negociacion", "ganado")}
    reuniones |= {i["lead_id"] for i in ints if i["tipo"] == "reunion"}
    ganados = [L for L in leads if L["estado_pipeline"] == "ganado"]
    pend = staging_candidates()
    actividad = Counter(e["ts"][:10] for e in audit_lines())
    days = [(datetime.now(crm.TZ).date() - timedelta(days=i)).isoformat() for i in range(13, -1, -1)]
    calif_hoy = sum(1 for L in ab if L["fecha_registro"][:10] == today_s)
    cfg = load_config()
    return {
        "entorno": crm.ENTORNO,
        "kpis": {"investigados": len(leads) + len(pend) + counted_rejected(), "registrados": len(leads),
                 "calificados": len(ab), "aprobados": sum(1 for L in leads if L["aprobacion_estado"] == "aprobado"),
                 "pendientes_aprobacion": sum(1 for L in leads if L["estado_pipeline"] == "pendiente_aprobacion"),
                 "contactados": len(contactados), "respuestas": len(respuestas), "reuniones": len(reuniones),
                 "ganados": len(ganados), "en_revision": len(pend),
                 "tasa_conversion": round(100 * len(ganados) / len(contactados), 1) if contactados else None,
                 "tasa_respuesta": round(100 * len({i['lead_id'] for i in respuestas}) / len(contactados), 1) if contactados else None},
        "objetivo": {"meta": cfg["objetivo_diario_calificados"], "hoy": calif_hoy},
        "por_estado": Counter(L["estado_pipeline"] for L in leads),
        "por_clase": Counter(L["clasificacion"] for L in leads),
        "actividad": [{"dia": d, "eventos": actividad.get(d, 0),
                       "calificados": sum(1 for L in ab if L["fecha_registro"][:10] == d)} for d in days],
        "recientes": list(reversed(audit_lines(limit=12))),
    }


def api_lead(lead_id):
    leads = rows("leads")
    L = crm.get_lead(leads, lead_id)
    ev = read_text(ROOT / "data" / "research" / f"{lead_id}.evidence.json")
    return {"lead": L, "proxima_accion": next_action(L),
            "transiciones": SCHEMA["x-transiciones"].get(L["estado_pipeline"], []),
            "bloqueado": L.get("opt_out") == "true" or L["estado_pipeline"] == "no_contactar" or bool(crm.suppressed_hits(L, rows("suppression"))),
            "interacciones": [i for i in rows("interactions") if i["lead_id"] == lead_id],
            "seguimientos": [f for f in rows("followups") if f["lead_id"] == lead_id],
            "dossier": read_text(ROOT / L["evidencias"]), "evidencia": json.loads(ev) if ev else None,
            "borradores": draft_files(lead_id), "auditoria": audit_lines(entidad=lead_id)}


def api_research():
    out = []
    for L in rows("leads"):
        ev = read_text(ROOT / "data" / "research" / f"{L['lead_id']}.evidence.json")
        ev = json.loads(ev) if ev else {}
        evid = ev.get("evidencias", [])
        conf = Counter(e.get("confianza", "media") for e in evid)
        nd = re.findall(r"no disponibles?[^.;|]*", L.get("notas", ""), re.I)
        out.append({"lead_id": L["lead_id"], "nombre_negocio": L["nombre_negocio"], "fuente": L["fuente"],
                    "fuente_url": L["fuente_url"], "fecha_fuente": L["fecha_fuente"],
                    "otras_fuentes": [u for u in L.get("otras_fuentes", "").split(";") if u],
                    "senales": [s for s in L["senales_oportunidad"].split(";") if s], "evidencias": evid,
                    "confianza": dict(conf), "campos_no_encontrados": ev.get("campos_no_encontrados", []),
                    "no_disponibles": nd, "clasificacion": L["clasificacion"], "puntaje": L["puntaje_total"]})
    return {"leads": out, "revision": staging_candidates()}


def api_followups():
    fus, leads, ints = rows("followups"), rows("leads"), rows("interactions")
    by = {L["lead_id"]: L for L in leads}
    today_d = datetime.now(crm.TZ).date()
    acts = []
    for L in leads:
        if L.get("proximo_seguimiento") and L["estado_pipeline"] not in SCHEMA["x-estados-finales"]:
            d = date.fromisoformat(L["proximo_seguimiento"])
            acts.append({"lead_id": L["lead_id"], "negocio": L["nombre_negocio"], "estado": L["estado_pipeline"],
                         "fecha": L["proximo_seguimiento"], "vencido": d < today_d, "accion": next_action(L)})
    for f in fus:
        f["negocio"] = by.get(f["lead_id"], {}).get("nombre_negocio", "")
        f["vencido"] = f["estado"] not in ("enviado", "cancelado") and date.fromisoformat(f["fecha_programada"]) < today_d
    return {"proximas": sorted(acts, key=lambda x: x["fecha"]), "seguimientos": fus,
            "historial": sorted([dict(i, negocio=by.get(i["lead_id"], {}).get("nombre_negocio", "")) for i in ints
                                 if i["tipo"] not in ("cambio_estado",)], key=lambda x: x["fecha_hora"], reverse=True),
            "respuestas": [i for i in ints if i["direccion"] == "entrante"],
            "pausados": [lead_summary(L) for L in leads if L["estado_pipeline"] == "pausado"],
            "perdidos": [lead_summary(L) for L in leads if L["estado_pipeline"] in ("perdido", "no_contactar")]}


def api_reports():
    leads = rows("leads")
    def group(key):
        g = defaultdict(lambda: {"total": 0, "A": 0, "B": 0, "C": 0, "descartado": 0})
        for L in leads:
            g[L[key] or "—"]["total"] += 1
            g[L[key] or "—"][L["clasificacion"]] += 1
        return dict(g)
    order = ["calificado", "mensaje_borrador", "pendiente_aprobacion", "aprobado", "contactado", "en_conversacion", "interesado",
             "reunion_agendada", "demo_realizada", "propuesta_enviada", "negociacion", "ganado"]
    reached = Counter()
    for L in leads:
        hist = {i["resumen"].split(" → ")[1].split(".")[0] for i in rows("interactions")
                if i["lead_id"] == L["lead_id"] and i["tipo"] == "cambio_estado" and " → " in i["resumen"]}
        hist.add(L["estado_pipeline"]); hist.add("calificado")
        for st in order:
            if st in hist:
                reached[st] += 1
    calidad = Counter()
    nf = Counter()
    for L in leads:
        ev = read_text(ROOT / "data" / "research" / f"{L['lead_id']}.evidence.json")
        ev = json.loads(ev) if ev else {}
        for e in ev.get("evidencias", []):
            calidad[e.get("confianza", "media")] += 1
        for c in ev.get("campos_no_encontrados", []):
            nf[c] += 1
    weekly = Counter()
    daily = Counter()
    for L in leads:
        d = date.fromisoformat(L["fecha_registro"][:10])
        daily[d.isoformat()] += 1
        weekly[f"{d.isocalendar().year}-S{d.isocalendar().week:02d}"] += 1
    return {"por_nicho": group("nicho"), "por_ciudad": group("ciudad"), "por_fuente": group("fuente"),
            "embudo": [{"etapa": st, "leads": reached.get(st, 0)} for st in order],
            "calidad_evidencia": dict(calidad), "campos_no_encontrados": dict(nf),
            "diario": dict(sorted(daily.items())), "semanal": dict(sorted(weekly.items())),
            "tiempo_investigacion": "No medido: los candidatos actuales no registran hora de inicio y fin de investigación. "
                                    "El motor de investigación (research/) añade 'duracion_s' a cada candidato que genera.",
            "revision": {"pendientes": len(staging_candidates()), "rechazados": counted_rejected()}}


def load_config():
    return json.loads((REPO / "config" / "sales_os.json").read_text(encoding="utf-8"))


def approval_rules():
    t = read_text(REPO / "workflows" / "approval-rules.md") or ""
    return [{"id": m.group(1), "estado": m.group(2), "accion": m.group(3)}
            for m in re.finditer(r"^\| (R-\d+) \| (\w+) \| ([^|]+) \|", t, re.M)]


def api_config():
    env = {k: bool(os.environ.get(k)) for k in ("N8N_BASE_URL", "N8N_API_KEY", "WW_EVENTS_TOKEN", "GOOGLE_PLACES_API_KEY",
                                                 "DENUE_TOKEN", "WHATSAPP_CLOUD_TOKEN", "WW_RESEARCH_NETWORK")}
    year = datetime.now(crm.TZ).year
    return {"config": load_config(),
            "puntuacion": {"senales": SCHEMA["x-senales-puntos"], "clasificacion": SCHEMA["x-clasificacion"],
                           "oportunidad": SCHEMA["x-oportunidad-reglas"]},
            "transiciones": SCHEMA["x-transiciones"],
            "politicas": {n: read_text(REPO / "policies" / f"{n}.md") for n in ("opt-out", "consent", "contact-cadence")},
            "reglas_aprobacion": approval_rules(),
            "dias_inhabiles": [{"fecha": d.isoformat(), "motivo": m} for y in (year, year + 1)
                               for d, m in crm.mx_holidays(SCHEMA, y).items()],
            "integraciones": [
                {"nombre": "CRM local (CSV + crm_tool.py)", "estado": "activo"},
                {"nombre": "Eventos para n8n (GET /api/events)", "estado": "disponible (sin instancia conectada)",
                 "requiere": "WW_EVENTS_TOKEN para acceso desde otra máquina"},
                {"nombre": "n8n", "estado": "no conectado", "requiere": "N8N_BASE_URL, N8N_API_KEY (por autorizar)"},
                {"nombre": "Investigación en vivo con subagente (WebSearch/WebFetch)", "estado": "activo en Claude Code"},
                {"nombre": "Motor research/ (OSM + auditoría de sitios)", "estado": "implementado, red desactivada",
                 "requiere": "autorización de red (ver docs/OPERACION.md)"},
                {"nombre": "Google Places API", "estado": "preparado, no conectado", "requiere": "GOOGLE_PLACES_API_KEY (de pago)"},
                {"nombre": "INEGI DENUE", "estado": "preparado, no conectado", "requiere": "DENUE_TOKEN (gratuito, requiere registro)"},
                {"nombre": "WhatsApp Business Cloud API", "estado": "no conectado", "requiere": "cuenta Meta verificada; solo con consentimiento"},
                {"nombre": "Playwright", "estado": "no disponible", "requiere": "navegador Chrome/Chromium para el servidor MCP"},
            ],
            "variables_entorno": env,
            "automatizaciones": {"envios_automaticos": "desactivados (ninguna regla activa)", "n8n": "sin instancia"}}


# ---------------------------------------------------------------- escrituras (solo vía crm_tool.py)
def run_tool(args, actor):
    env = dict(os.environ, WW_ROOT=str(ROOT), WW_ACTOR=actor)
    r = subprocess.run([sys.executable, str(CRM_TOOL), *args, "--por", actor], capture_output=True, text=True, env=env, timeout=60)
    if r.returncode == 0:
        out = r.stdout.strip()
        try:
            return 200, {"ok": True, "resultado": json.loads(out.splitlines()[0])}
        except (ValueError, IndexError):
            return 200, {"ok": True, "resultado": out}
    msg = (r.stderr or r.stdout).strip().replace("RECHAZADO: ", "")
    return 422, {"ok": False, "error": msg}


def actor_of(body, required=False):
    name = str(body.get("por", "")).strip()[:80]
    if required and (not name or name.lower() in crm.AGENT_NAMES):
        raise ValueError("Escribe tu nombre (persona) para registrar esta acción.")
    return f"dashboard:{name}" if name else "dashboard"


def safe_staging(rel):
    p = (ROOT / rel).resolve()
    base = (ROOT / "data" / "staging").resolve()
    if not str(p).startswith(str(base) + os.sep) or p.suffix != ".json" or p.parent.name in ("procesados", "rechazados"):
        raise ValueError("Ruta de candidato no válida.")
    return p


LEAD_RE = r"(WW-\d{8}-\d{3})"


def mx_e164(raw):  # mismas reglas que cloudflare/src/crm.js › mxE164
    d = re.sub(r"\D", "", str(raw or ""))
    if len(d) == 10:
        return f"+52{d}"
    if len(d) == 12 and d.startswith("52"):
        return f"+{d}"
    if len(d) == 13 and d.startswith("521"):
        return f"+52{d[3:]}"
    return ""


def candidate_from_row(r, actor, today):
    """Mismas reglas que cloudflare/src/crm.js › candidateFromRow."""
    v = lambda k, n=300: str(r.get(k) or "").strip()[:n]
    errs = []
    c = {"nombre_negocio": v("nombre_negocio", 160), "nicho": v("nicho", 30).lower() or "otro", "subnicho": v("subnicho", 60),
         "ciudad": v("ciudad", 80), "estado_mx": v("estado_mx", 60), "direccion": v("direccion"), "telefono_publico": v("telefono_publico", 40),
         "email_publico": v("email_publico", 120).lower(), "sitio_web": v("sitio_web"), "google_maps_url": v("google_maps_url", 600),
         "instagram_url": v("instagram_url"), "facebook_url": v("facebook_url"), "fuente": v("fuente", 30).lower() or "manual",
         "fuente_url": v("fuente_url", 600), "fecha_fuente": today}
    if len(c["nombre_negocio"]) < 2:
        errs.append("falta nombre_negocio")
    if not c["ciudad"]:
        errs.append("falta ciudad")
    if not c["estado_mx"]:
        errs.append("falta estado_mx")
    if c["nicho"] not in SCHEMA["$defs"]["nicho"]["enum"]:
        errs.append(f"nicho inválido ({', '.join(SCHEMA['$defs']['nicho']['enum'])})")
    if c["fuente"] not in SCHEMA["$defs"]["fuente"]["enum"]:
        errs.append(f"fuente inválida ({', '.join(SCHEMA['$defs']['fuente']['enum'])})")
    c["fuente_url"] = c["fuente_url"] or c["google_maps_url"] or c["sitio_web"] or c["instagram_url"] or c["facebook_url"]
    if not re.match(r"^https?://", c["fuente_url"], re.I):
        errs.append("falta una URL de fuente (Google Maps, sitio, Instagram o Facebook)")
    for k in ("sitio_web", "google_maps_url", "instagram_url", "facebook_url"):
        if c[k] and not re.match(r"^https?://", c[k], re.I):
            errs.append(f"{k} debe empezar con http")
    if c["email_publico"] and not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", c["email_publico"]):
        errs.append("email_publico inválido")
    tel, wa = mx_e164(c["telefono_publico"]), mx_e164(v("whatsapp_publico", 40))
    if tel:
        c["telefono_e164"] = tel
    if wa:
        c["whatsapp_publico"] = wa
    elif v("whatsapp_publico"):
        errs.append("whatsapp_publico debe ser un número mexicano completo")
    c = {k: x for k, x in c.items() if x != ""}
    c.update({"evidencias": [], "campos_no_encontrados": [], "investigado_por": f"{actor} (alta manual)", "dossier_path": ""})
    return c, errs, v("notas", 1000)


def import_candidates(body):
    rows_in, origen = body.get("rows"), ("csv" if body.get("origen") == "csv" else "manual")
    if not isinstance(rows_in, list) or not rows_in:
        return 422, {"ok": False, "error": "No hay filas para importar."}
    if len(rows_in) > 100:
        return 422, {"ok": False, "error": "Máximo 100 filas por importación."}
    actor = actor_of(body)
    today = datetime.now(crm.TZ).date().isoformat()
    leads, supp = rows("leads"), rows("suppression")
    pending = []
    for p in sorted((ROOT / "data" / "staging").glob("*/*.json")):
        if not p.name.startswith("_"):
            try:
                pending.append(dict(json.loads(p.read_text(encoding="utf-8")), lead_id=str(p.relative_to(ROOT))))
            except ValueError:
                pass
    out = {"creados": [], "duplicados": [], "excluidos": 0, "invalidos": []}
    folder = ROOT / "data" / "staging" / today
    for i, r in enumerate(rows_in, 1):
        c, errs, notas = candidate_from_row(r if isinstance(r, dict) else {}, actor, today)
        if errs:
            out["invalidos"].append({"fila": i, "nombre": c.get("nombre_negocio", ""), "errores": errs}); continue
        if crm.suppressed_hits(c, supp):
            out["excluidos"] += 1; continue  # lista de exclusión: no se guarda ni se repite el dato
        ex1, pos1 = crm.find_duplicates(c, leads)
        ex2, pos2 = crm.find_duplicates(c, pending)
        if ex1 or ex2:
            out["duplicados"].append({"fila": i, "nombre": c["nombre_negocio"], "de": [x[0] for x in ex1 + ex2]}); continue
        folder.mkdir(parents=True, exist_ok=True)
        slug = re.sub(r"[^a-z0-9]+", "-", crm.normalize_name(c["nombre_negocio"]))[:50].strip("-") or "negocio"
        path = folder / f"{origen}-{slug}-{secrets.token_hex(3)}.json"
        path.write_text(json.dumps(c, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        if notas:
            path.with_suffix(".notas.md").write_text(f"# Notas de alta — {c['nombre_negocio']}\n\n{notas}\n", encoding="utf-8")
        rel = str(path.relative_to(ROOT))
        pending.append(dict(c, lead_id=rel))
        out["creados"].append({"id": rel, "nombre": c["nombre_negocio"], "posibles_duplicados": [x[0] for x in pos1 + pos2]})
    if out["creados"]:
        crm.audit("candidatos.alta", actor, f"{origen}-{today}", {"creados": len(out["creados"]), "duplicados": len(out["duplicados"]),
                                                                  "excluidos": out["excluidos"], "invalidos": len(out["invalidos"])})
    return 200, {"ok": True, "resultado": out}


def post_routes(path, body):
    if path == "/api/candidates":
        return import_candidates(body)
    m = re.fullmatch(rf"/api/leads/{LEAD_RE}/next", path)
    if m:
        args = ["update-lead", m.group(1), *commercial_args(body)]
        if body.get("proximo_seguimiento"):
            args += ["--set", f"proximo_seguimiento={str(body['proximo_seguimiento'])[:10]}"]
        if len(args) == 2:
            return 422, {"ok": False, "error": "Nada que actualizar."}
        if body.get("nota"):
            args += ["--nota", str(body["nota"])[:500]]
        return run_tool(args, actor_of(body))
    m = re.fullmatch(rf"/api/leads/{LEAD_RE}/transition", path)
    if m:
        to = str(body.get("to", ""))
        if to == "no_contactar":
            return 422, {"ok": False, "error": "Para dar de baja usa la acción 'Registrar baja'."}
        if to == "aprobado":
            return 422, {"ok": False, "error": "Para aprobar usa el botón 'Aprobar para uso humano'."}
        args = ["update-lead", m.group(1), "--set", f"estado_pipeline={to}", *commercial_args(body)]
        if body.get("proximo_seguimiento"):
            args += ["--set", f"proximo_seguimiento={body['proximo_seguimiento']}"]
        if to == "pendiente_aprobacion":
            args += ["--set", "aprobacion_estado=pendiente"]
            drafts = draft_files(m.group(1))
            if drafts:
                args += ["--set", f"mensaje_inicial_id={drafts[0]['archivo']}"]
        if body.get("nota"):
            args += ["--nota", str(body["nota"])[:500]]
        return run_tool(args, actor_of(body))
    m = re.fullmatch(rf"/api/leads/{LEAD_RE}/approve", path)
    if m:
        name = str(body.get("aprobado_por", "")).strip()[:80]
        actor = actor_of({"por": name}, required=True)
        args = ["update-lead", m.group(1), "--set", "estado_pipeline=aprobado", "--set", f"aprobado_por={name}"]
        if body.get("proximo_seguimiento"):
            args += ["--set", f"proximo_seguimiento={body['proximo_seguimiento']}"]
        args += ["--nota", "Aprobado en el dashboard para uso humano. No se envía nada automáticamente."]
        return run_tool(args, actor)
    m = re.fullmatch(rf"/api/leads/{LEAD_RE}/request-changes", path)
    if m:
        nota = str(body.get("nota", "")).strip()[:500]
        if not nota:
            return 422, {"ok": False, "error": "Describe los cambios que pides."}
        return run_tool(["update-lead", m.group(1), "--set", "estado_pipeline=mensaje_borrador",
                         "--set", "aprobacion_estado=cambios_solicitados", "--nota", f"Cambios solicitados: {nota}"], actor_of(body))
    m = re.fullmatch(rf"/api/leads/{LEAD_RE}/interaction", path)
    if m:
        allowed = {("entrante", "respuesta_lead"), ("saliente", "mensaje_inicial"), ("saliente", "seguimiento"),
                   ("interna", "nota"), ("saliente", "llamada"), ("interna", "reunion")}
        d, t = body.get("direccion"), body.get("tipo")
        if (d, t) not in allowed:
            return 422, {"ok": False, "error": "Tipo de interacción no permitido desde el dashboard."}
        actor = actor_of(body, required=(d == "saliente"))
        obj = {"lead_id": m.group(1), "canal": body.get("canal") or "interno", "direccion": d, "tipo": t,
               "resumen": str(body.get("resumen", ""))[:500], "registrado_por": actor,
               "enviado_por": {"entrante": "lead", "saliente": "humano"}.get(d, "humano"),
               "resultado": "respondido" if d == "entrante" else ("enviado" if d == "saliente" else "n/a"),
               "sentimiento": body.get("sentimiento") or "n/a"}
        if d == "saliente" and t == "mensaje_inicial":
            obj["aprobacion_ref"] = "aprobación registrada en el CRM"
        return run_tool(["add-interaction", "--json", json.dumps(obj, ensure_ascii=False)], actor)
    m = re.fullmatch(rf"/api/leads/{LEAD_RE}/optout", path)
    if m:
        fuente = str(body.get("fuente", "")).strip()[:300]
        if not fuente:
            return 422, {"ok": False, "error": "Indica de dónde viene la baja (por ejemplo: respuesta por email del 12-nov)."}
        return run_tool(["suppress", "--lead", m.group(1), "--motivo", "opt_out", "--fuente", fuente], actor_of(body))
    if path == "/api/followups":
        obj = {k: body[k] for k in ("lead_id", "fecha_programada", "ventana_horaria", "numero_seguimiento", "canal",
                                    "plantilla_id", "borrador_ref", "notas") if body.get(k) not in (None, "")}
        if "numero_seguimiento" in obj:
            obj["numero_seguimiento"] = int(obj["numero_seguimiento"])
        return run_tool(["add-followup", "--json", json.dumps(obj, ensure_ascii=False)], actor_of(body))
    m = re.fullmatch(r"/api/followups/(FU-\d{8}-\d{4})/status", path)
    if m:
        est = str(body.get("estado", ""))
        args = ["update-followup", m.group(1), "--estado", est]
        if body.get("nota"):
            args += ["--nota", str(body["nota"])[:300]]
        return run_tool(args, actor_of(body, required=(est in ("aprobado", "enviado"))))
    if path == "/api/review/register":
        p = safe_staging(str(body.get("archivo", "")))
        return run_tool(["add-lead", str(p)], actor_of(body))
    if path == "/api/review/reject":
        p = safe_staging(str(body.get("archivo", "")))
        motivo = str(body.get("motivo", "")).strip()[:300]
        if not motivo:
            return 422, {"ok": False, "error": "Indica el motivo del rechazo."}
        return run_tool(["reject-candidate", str(p), "--motivo", motivo], actor_of(body))
    if path == "/api/export":
        return run_tool(["export"], actor_of(body))
    if path == "/api/config":
        cfg = load_config()
        if "objetivo_diario_calificados" in body:
            v = int(body["objetivo_diario_calificados"])
            if not 1 <= v <= 500:
                return 422, {"ok": False, "error": "El objetivo diario debe estar entre 1 y 500."}
            cfg["objetivo_diario_calificados"] = v
        for key in ("nichos", "ciudades"):
            if key in body:
                items = body[key]
                if not isinstance(items, list) or not all(isinstance(x, dict) and x.get("nombre") for x in items):
                    return 422, {"ok": False, "error": f"Formato inválido en {key}."}
                cfg[key] = items
        (REPO / "config" / "sales_os.json").write_text(json.dumps(cfg, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        crm.audit("config.actualizada", actor_of(body), "config/sales_os.json", {k: body[k] for k in body if k != "por"})
        return 200, {"ok": True}
    return 404, {"ok": False, "error": "Ruta no encontrada."}


# ---------------------------------------------------------------- HTTP
class Handler(BaseHTTPRequestHandler):
    server_version = "WWSalesOS/" + VERSION
    sys_version = ""

    def log_message(self, fmt, *args):
        sys.stderr.write("[%s] %s\n" % (datetime.now().strftime("%H:%M:%S"), fmt % args))

    def _headers(self, status, ctype, length):
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(length))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Content-Security-Policy",
                         "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; "
                         "connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'")
        self.end_headers()

    def _json(self, status, obj):
        data = json.dumps(obj, ensure_ascii=False, default=str).encode("utf-8")
        self._headers(status, "application/json; charset=utf-8", len(data))
        self.wfile.write(data)

    def _host_ok(self):
        host = self.headers.get("Host", "")
        return host in (f"127.0.0.1:{PORT}", f"localhost:{PORT}")

    def _origin_ok(self):
        origin = self.headers.get("Origin")
        return origin is None or origin in (f"http://127.0.0.1:{PORT}", f"http://localhost:{PORT}")

    def do_GET(self):
        if not self._host_ok():
            return self._json(421, {"ok": False, "error": "Host no permitido."})
        u = urlparse(self.path)
        path, q = unquote(u.path), parse_qs(u.query)
        try:
            if path == "/api/session":
                return self._json(200, {"token": TOKEN, "entorno": crm.ENTORNO, "version": VERSION})
            if path == "/api/events":
                ev_token = os.environ.get("WW_EVENTS_TOKEN")
                given = self.headers.get("X-WW-Events-Token") or self.headers.get("X-WW-Token") or ""
                if not hmac.compare_digest(given, TOKEN) and not (ev_token and hmac.compare_digest(given, ev_token)):
                    return self._json(401, {"ok": False, "error": "Falta el token de eventos."})
                lim = min(int(q.get("limit", ["200"])[0]), 1000)
                return self._json(200, {"eventos": audit_lines(limit=lim, since=q.get("since", [None])[0])})
            routes = {"/api/summary": api_summary, "/api/research": api_research, "/api/followups": api_followups,
                      "/api/today": api_today, "/api/reports": api_reports, "/api/config": api_config,
                      "/api/leads": lambda: {"leads": [lead_summary(L) for L in rows("leads")]},
                      # Los borradores de leads que viven solo en D1 (IDs 500+) no tienen fila en el CSV local: se omiten
                      # en vez de romper la vista completa.
                      "/api/drafts": lambda: (lambda L: {"borradores": [dict(d, lead=lead_summary(L[d["lead_id"]]))
                                                                        for d in draft_files() if d["lead_id"] in L]})(
                                                 {x["lead_id"]: x for x in rows("leads")}),
                      "/api/pipeline": lambda: {"estados": SCHEMA["$defs"]["estadoPipeline"]["enum"],
                                                "transiciones": SCHEMA["x-transiciones"], "finales": SCHEMA["x-estados-finales"],
                                                "con_seguimiento": SCHEMA["x-estados-con-seguimiento"],
                                                "motivos_perdida": SCHEMA["$defs"]["motivoPerdida"]["enum"],
                                                "leads": [lead_summary(L) for L in rows("leads")]}}
            if path in routes:
                return self._json(200, routes[path]())
            m = re.fullmatch(rf"/api/leads/{LEAD_RE}", path)
            if m:
                return self._json(200, api_lead(m.group(1)))
            if path == "/api/export/leads.csv":
                data = (ROOT / "data" / "crm" / "leads.csv").read_bytes()
                self._headers(200, "text/csv; charset=utf-8", len(data))
                return self.wfile.write(data)
            return self._static(path)
        except crm.CRMError as e:
            return self._json(404, {"ok": False, "error": str(e)})
        except Exception as e:  # error inesperado: mensaje comprensible, detalle en consola
            self.log_message("ERROR %s", repr(e))
            return self._json(500, {"ok": False, "error": "Error interno al leer el CRM. Revisa la consola del servidor."})

    def do_POST(self):
        if not self._host_ok() or not self._origin_ok():
            return self._json(403, {"ok": False, "error": "Origen no permitido."})
        if not hmac.compare_digest(self.headers.get("X-WW-Token", ""), TOKEN):
            return self._json(403, {"ok": False, "error": "Sesión inválida. Recarga la página."})
        if not self.headers.get("Content-Type", "").startswith("application/json"):
            return self._json(415, {"ok": False, "error": "Se esperaba JSON."})
        n = int(self.headers.get("Content-Length") or 0)
        if n > MAX_BODY:
            return self._json(413, {"ok": False, "error": "Solicitud demasiado grande."})
        try:
            body = json.loads(self.rfile.read(n) or b"{}")
            if not isinstance(body, dict):
                raise ValueError("Se esperaba un objeto JSON.")
            status, obj = post_routes(unquote(urlparse(self.path).path), body)
        except (ValueError, KeyError) as e:
            status, obj = 422, {"ok": False, "error": str(e)}
        except subprocess.TimeoutExpired:
            status, obj = 504, {"ok": False, "error": "La operación tardó demasiado."}
        return self._json(status, obj)

    def _method_not_allowed(self):
        return self._json(405, {"ok": False, "error": "Método no permitido. El sistema no borra ni reemplaza registros."})

    do_PUT = do_DELETE = do_PATCH = _method_not_allowed

    def _static(self, path):
        if path in ("/", ""):
            path = "/index.html"
        p = (STATIC / path.lstrip("/")).resolve()
        if not str(p).startswith(str(STATIC.resolve())) or not p.is_file():
            p = STATIC / "index.html"  # rutas de la SPA
        data = p.read_bytes()
        ctype = mimetypes.guess_type(p.name)[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype in ("application/javascript",):
            ctype += "; charset=utf-8"
        self._headers(200, ctype, len(data))
        self.wfile.write(data)


def make_server(port=None, demo=False, data_root=None):
    global crm, ROOT, SCHEMA, PORT
    crm, ROOT = configure(demo, data_root)
    SCHEMA = crm.load_schema()
    PORT = port or int(os.environ.get("WW_PORT", "8765"))
    return ThreadingHTTPServer(("127.0.0.1", PORT), Handler)


def main():
    ap = argparse.ArgumentParser(description="Web Wizards Sales OS — dashboard local")
    ap.add_argument("--demo", action="store_true", help="usar datos de demostración (carpeta demo/)")
    ap.add_argument("--port", type=int)
    ap.add_argument("--data-root", help=argparse.SUPPRESS)  # solo pruebas: copia temporal de datos
    a = ap.parse_args()
    if a.demo and not (REPO / "demo" / "data" / "crm" / "leads.csv").exists():
        sys.exit("No hay datos demo. Genera con: python3 app/seed_demo.py")
    srv = make_server(a.port, a.demo, a.data_root)
    print(f"Web Wizards Sales OS {VERSION} [{crm.ENTORNO}] → http://127.0.0.1:{PORT}  (Ctrl+C para detener)")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
