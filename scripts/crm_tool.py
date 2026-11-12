#!/usr/bin/env python3
"""
crm_tool.py — única vía de escritura al CRM local de Web Wizards (data/crm/*.csv).

Solo biblioteca estándar. Las reglas de máquina vienen de data/schema/crm.schema.json
(enums, estados, transiciones, puntos de señales, reglas de clasificación, días inhábiles extra).
Políticas: policies/opt-out.md, policies/consent.md, policies/contact-cadence.md.

Comandos de lectura:
  validate | transitions | show <lead_id> | check-dup [...] | calendar [--year N] | check-date AAAA-MM-DD
Comandos de escritura (todos auditados en data/crm/audit.jsonl):
  init
  add-lead <staging.json> [--dry-run] [--sucursal-de WW-...] [--por nombre]
  import-candidates <carpeta> [--por nombre]        (nunca sobrescribe: duplicados y bajas se rechazan)
  reject-candidate <staging.json> --motivo "..." [--por nombre]
  update-lead <lead_id> --set campo=valor [...] [--nota "..."] [--por nombre]
  add-interaction --json '{...}' [--por nombre]
  add-followup --json '{...}' [--por nombre]
  update-followup <seguimiento_id> --estado <estado> [--nota "..."] [--por nombre]
  suppress (--lead WW-... | --valor V --tipo T) --motivo M --fuente "..." [--nota "..."] [--por nombre]
  backfill-evidence                                  (crea data/research/<lead_id>.evidence.json faltantes)
  export [--dir ruta]                                (copia CSV y auditoría a data/exports/<fecha-hora>/)
  pull-d1 --sql DUMP.sql [--dry-run]                 (trae a local lo hecho en el dashboard; D1 gana, salvo bajas locales)

Entorno: WW_ROOT apunta a otra raíz de datos (modo demo y pruebas); el esquema siempre es el del repositorio.

Garantías: sin duplicados, supresión solo de anexado, sin reactivación de bajas, transiciones válidas,
aprobación humana obligatoria para 'aprobado', sin seguimientos en domingo ni días inhábiles,
auditoría de cada escritura. Ningún comando envía mensajes ni accede a la red.
"""
import argparse, contextlib, csv, fcntl, json, os, re, shutil, sys, tempfile, unicodedata
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

REPO = Path(__file__).resolve().parent.parent
ROOT = Path(os.environ.get("WW_ROOT") or REPO).resolve()
CRM = ROOT / "data" / "crm"
SCHEMA_PATH = REPO / "data" / "schema" / "crm.schema.json"
DICT_PATH = REPO / "data" / "crm-schema.md"
AUDIT_PATH = CRM / "audit.jsonl"
TZ = ZoneInfo("America/Mexico_City")
ENTORNO = "real" if ROOT == REPO else "demo"

FILES = {"leads": "lead", "interactions": "interaccion", "followups": "seguimiento", "suppression": "supresion"}
ID_FIELD = {"leads": "lead_id", "interactions": "interaccion_id", "followups": "seguimiento_id"}
GENERIC_DOMAINS = {"facebook.com", "instagram.com", "wa.me", "api.whatsapp.com", "whatsapp.com", "linktr.ee",
                   "doctoralia.com.mx", "doctoralia.com", "google.com", "goo.gl", "maps.app.goo.gl", "sites.google.com",
                   "business.site", "wixsite.com", "wordpress.com", "blogspot.com", "tiktok.com", "youtube.com",
                   "seccionamarilla.com.mx", "topdoctors.mx", "linkedin.com", "x.com", "twitter.com"}
AGENT_NAMES = {"claude", "agente", "agent", "lead-researcher", "lead-qualifier", "outreach-writer", "crm-manager",
               "follow-up-manager", "compliance-reviewer", "n8n", "sistema", "bot", "ia", "ai", "cli", "crm_tool",
               "dashboard", "api"}
TZ_BY_STATE = {"sonora": "America/Hermosillo", "baja california": "America/Tijuana", "quintana roo": "America/Cancun",
               "baja california sur": "America/Mazatlan", "sinaloa": "America/Mazatlan", "nayarit": "America/Mazatlan",
               "chihuahua": "America/Chihuahua"}
LEGAL_SUFFIX = re.compile(r"\b(s\.? ?a\.?( de c\.? ?v\.?)?|s\.? de r\.?l\.?( de c\.? ?v\.?)?|s\.?c\.?|a\.?c\.?)\s*$")
READ_ONLY_LEAD_FIELDS = {"lead_id", "fecha_registro", "fuente", "fuente_url", "fecha_fuente", "opt_out", "fecha_opt_out"}
CONTACT_FIELDS = ("telefono_e164", "whatsapp_publico", "email_publico", "instagram_url", "facebook_url")


class CRMError(Exception):
    pass


# ----------------------------------------------------------------------------- utilidades
def now_iso():
    return datetime.now(TZ).replace(microsecond=0).isoformat()


def today():
    return datetime.now(TZ).strftime("%Y%m%d")


def load_schema():
    return json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))


def headers(schema, kind):
    return list(schema["$defs"][FILES[kind]]["properties"].keys())


def strip_accents(s):
    return "".join(c for c in unicodedata.normalize("NFKD", s) if not unicodedata.combining(c))


def normalize_name(s):
    s = strip_accents(s or "").lower().strip()
    s = LEGAL_SUFFIX.sub("", s)
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def domain_of(url):
    if not url:
        return ""
    m = re.match(r"^(?:https?://)?([^/:?#]+)", url.strip().lower())
    d = m.group(1) if m else ""
    return d[4:] if d.startswith("www.") else d


def is_generic(domain):
    return any(domain == g or domain.endswith("." + g) for g in GENERIC_DOMAINS)


@contextlib.contextmanager
def locked():
    CRM.mkdir(parents=True, exist_ok=True)
    with open(CRM / ".lock", "w") as fh:
        fcntl.flock(fh, fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(fh, fcntl.LOCK_UN)


def read_csv(kind):
    path = CRM / f"{kind}.csv"
    if not path.exists():
        raise CRMError(f"No existe {path}. Ejecuta: python3 scripts/crm_tool.py init")
    with open(path, newline="", encoding="utf-8") as fh:
        r = csv.DictReader(fh)
        return r.fieldnames, list(r)


def write_csv(kind, fieldnames, rows):
    """Reescritura atómica. Nunca se usa para suppression.csv (solo anexado)."""
    if kind == "suppression":
        raise CRMError("suppression.csv es solo de anexado; no se reescribe.")
    path = CRM / f"{kind}.csv"
    fd, tmp = tempfile.mkstemp(dir=CRM, prefix=f".{kind}.", suffix=".tmp")
    with os.fdopen(fd, "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=fieldnames, extrasaction="raise")
        w.writeheader()
        for row in rows:
            w.writerow({k: row.get(k, "") for k in fieldnames})
    os.replace(tmp, path)


def append_csv(kind, fieldnames, rows):
    path = CRM / f"{kind}.csv"
    with open(path, "a", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=fieldnames, extrasaction="raise")
        for row in rows:
            w.writerow({k: row.get(k, "") for k in fieldnames})


def to_cell(v):
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, list):
        return ";".join(str(x) for x in v)
    return "" if v is None else str(v)


def audit(evento, actor, entidad, detalle=None):
    """Registro de auditoría y de eventos (fuente del endpoint /api/events). Solo anexado."""
    CRM.mkdir(parents=True, exist_ok=True)
    line = {"ts": now_iso(), "evento": evento, "actor": actor or "cli", "entidad": entidad,
            "entorno": ENTORNO, "detalle": detalle or {}}
    with open(AUDIT_PATH, "a", encoding="utf-8") as fh:
        fh.write(json.dumps(line, ensure_ascii=False) + "\n")


# ----------------------------------------------------------------------------- calendario
def nth_weekday(y, m, weekday, n):
    d = date(y, m, 1)
    return d + timedelta(days=(weekday - d.weekday()) % 7 + 7 * (n - 1))


def mx_holidays(schema, year):
    """Días de descanso obligatorio (LFT art. 74) + días extra declarados en el esquema."""
    h = {date(year, 1, 1): "Año Nuevo", nth_weekday(year, 2, 0, 1): "Día de la Constitución",
         nth_weekday(year, 3, 0, 3): "Natalicio de Benito Juárez", date(year, 5, 1): "Día del Trabajo",
         date(year, 9, 16): "Día de la Independencia", nth_weekday(year, 11, 0, 3): "Día de la Revolución",
         date(year, 12, 25): "Navidad"}
    if (year - 2024) % 6 == 0:
        h[date(year, 10, 1)] = "Transmisión del Poder Ejecutivo Federal"
    for extra in schema.get("x-dias-inhabiles-extra", []):
        d = date.fromisoformat(extra["fecha"])
        if d.year == year:
            h[d] = extra["motivo"]
    return dict(sorted(h.items()))


def contact_day_problem(schema, d):
    if d.weekday() == 6:
        return "domingo"
    hol = mx_holidays(schema, d.year)
    if d in hol:
        return f"día de descanso obligatorio ({hol[d]})"
    return None


# ----------------------------------------------------------------------------- validador (subconjunto de JSON Schema)
def resolve(schema, s):
    while isinstance(s, dict) and "$ref" in s:
        s = schema["$defs"][s["$ref"].split("/")[-1]]
    return s


def allowed_types(schema, s):
    s = resolve(schema, s)
    out = set()
    if "type" in s:
        out |= set(s["type"] if isinstance(s["type"], list) else [s["type"]])
    for sub in s.get("anyOf", []):
        out |= allowed_types(schema, sub)
    if "enum" in s:
        out |= {"string"}
    if "const" in s:
        out |= {"boolean"} if isinstance(s["const"], bool) else {"string"}
    return out or {"string"}


def coerce_row(schema, kind, row):
    """CSV -> objeto: celdas vacías = ausente; números y booleanos según el esquema."""
    props = schema["$defs"][FILES[kind]]["properties"]
    obj = {}
    for k, v in row.items():
        if v is None or v == "":
            continue
        t = allowed_types(schema, props.get(k, {}))
        if "boolean" in t and v in ("true", "false"):
            obj[k] = v == "true"
        elif "integer" in t and re.fullmatch(r"-?\d+", v):
            obj[k] = int(v)
        elif "number" in t and re.fullmatch(r"-?\d+(\.\d+)?", v):
            obj[k] = float(v)
        else:
            obj[k] = v
    return obj


def type_ok(v, t):
    return {"string": isinstance(v, str), "integer": isinstance(v, int) and not isinstance(v, bool),
            "number": isinstance(v, (int, float)) and not isinstance(v, bool), "boolean": isinstance(v, bool),
            "array": isinstance(v, list), "object": isinstance(v, dict), "null": v is None}.get(t, True)


def validate(schema, s, v, path="$"):
    s = resolve(schema, s)
    errs = []
    if "type" in s:
        ts = s["type"] if isinstance(s["type"], list) else [s["type"]]
        if not any(type_ok(v, t) for t in ts):
            return [f"{path}: tipo {type(v).__name__}, se esperaba {ts}"]
    if "const" in s and v != s["const"]:
        errs.append(f"{path}: debe ser {s['const']!r}")
    if "enum" in s and v not in s["enum"]:
        errs.append(f"{path}: {v!r} fuera de catálogo")
    if isinstance(v, str):
        if "pattern" in s and not re.search(s["pattern"], v):
            errs.append(f"{path}: {v!r} no cumple el formato")
        if len(v) < s.get("minLength", 0):
            errs.append(f"{path}: demasiado corto")
        if "maxLength" in s and len(v) > s["maxLength"]:
            errs.append(f"{path}: demasiado largo")
        if s.get("format") == "email" and not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", v):
            errs.append(f"{path}: email inválido")
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        if "minimum" in s and v < s["minimum"]:
            errs.append(f"{path}: menor que {s['minimum']}")
        if "maximum" in s and v > s["maximum"]:
            errs.append(f"{path}: mayor que {s['maximum']}")
    if isinstance(v, list):
        for i, it in enumerate(v):
            errs += validate(schema, s.get("items", {}), it, f"{path}[{i}]")
        if s.get("uniqueItems") and len(set(map(json.dumps, v))) != len(v):
            errs.append(f"{path}: elementos repetidos")
    if isinstance(v, dict):
        for k in s.get("required", []):
            if k not in v:
                errs.append(f"{path}.{k}: obligatorio")
        props = s.get("properties", {})
        for k, val in v.items():
            if k in props:
                errs += validate(schema, props[k], val, f"{path}.{k}")
            elif s.get("additionalProperties") is False:
                errs.append(f"{path}.{k}: campo no permitido")
        for k, deps in s.get("dependentRequired", {}).items():
            if k in v:
                errs += [f"{path}.{d}: obligatorio si existe {k}" for d in deps if d not in v]
    if "anyOf" in s and not any(not validate(schema, sub, v, path) for sub in s["anyOf"]):
        errs.append(f"{path}: {v!r} no cumple ninguna alternativa")
    for sub in s.get("allOf", []):
        if "if" in sub:
            if not validate(schema, sub["if"], v, path):
                errs += validate(schema, sub.get("then", {}), v, path)
        else:
            errs += validate(schema, sub, v, path)
    return errs


# ----------------------------------------------------------------------------- reglas de negocio
def expected_opportunity(schema, senales):
    pts = schema["x-senales-puntos"]
    rules = schema["x-oportunidad-reglas"]
    s = set(senales)
    if "WEB_NONE" in s:
        s -= set(rules["WEB_NONE_excluye"])
    return min(rules["tope"], sum(pts[x] for x in s))


def expected_class(schema, cal, descalificadores):
    r = schema["x-clasificacion"]
    total, n, contacto = cal["puntaje_total"], len(cal["senales_oportunidad"]), cal["puntaje_contacto"]
    if descalificadores or total < r["descartado_si_total_menor_a"]:
        return "descartado"
    for k in ("A", "B"):
        c = r[k]
        if total >= c["total_min"] and n >= c["senales_min"] and contacto >= c["contacto_min"]:
            return k
    return "C"


def evidence_confidence(evidencias, senal):
    """Mejor confianza disponible para una señal: alta > media > baja. Sin campo = media."""
    rank = {"alta": 3, "media": 2, "baja": 1}
    vals = [e.get("confianza", "media") for e in evidencias if e.get("senal") == senal]
    return max(vals, key=lambda x: rank[x]) if vals else None


def check_qualification(schema, cal, evidencias, descalificadores):
    errs = []
    parts = cal["puntaje_icp"] + cal["puntaje_oportunidad"] + cal["puntaje_contacto"] + cal["puntaje_capacidad"]
    if parts != cal["puntaje_total"]:
        errs.append(f"puntaje_total {cal['puntaje_total']} ≠ suma de subpuntajes {parts}")
    missing = [x for x in cal["senales_oportunidad"] if evidence_confidence(evidencias, x) is None]
    if missing:
        errs.append(f"señales sin evidencia: {missing}")
    weak = [x for x in cal["senales_oportunidad"] if evidence_confidence(evidencias, x) == "baja"]
    if weak:
        errs.append(f"PENDIENTE DE REVISIÓN: señales solo con evidencia de confianza baja {weak}; "
                    "verifícalas (o quítalas) antes de registrar")
    exp_op = expected_opportunity(schema, cal["senales_oportunidad"])
    if cal["puntaje_oportunidad"] != exp_op:
        errs.append(f"puntaje_oportunidad {cal['puntaje_oportunidad']} ≠ {exp_op} según catálogo de señales")
    exp = expected_class(schema, cal, descalificadores)
    if cal["clasificacion"] != exp:
        errs.append(f"clasificación {cal['clasificacion']} ≠ {exp} según x-clasificacion")
    return errs


def lead_keys(lead):
    keys = []
    for f in ("telefono_e164", "whatsapp_publico"):
        if lead.get(f):
            keys.append(("telefono_e164", lead[f]))
    if lead.get("email_publico"):
        keys.append(("email", lead["email_publico"].strip().lower()))
    dom = lead.get("dominio") or domain_of(lead.get("sitio_web", ""))
    if dom and not is_generic(dom):
        keys.append(("dominio", dom))
    if lead.get("google_place_id"):
        keys.append(("google_place_id", lead["google_place_id"]))
    nn = lead.get("nombre_normalizado") or normalize_name(lead.get("nombre_negocio", ""))
    if nn and lead.get("ciudad"):
        keys.append(("nombre_ciudad", f"{nn}|{normalize_name(lead['ciudad'])}"))
    return list(dict.fromkeys(keys))  # sin repetidos (p. ej. teléfono = WhatsApp)


def suppressed_hits(lead, supp_rows):
    supp = {(r["tipo"], r["valor"].strip().lower()) for r in supp_rows}
    return [(t, v) for t, v in lead_keys(lead) if (t, v.lower()) in supp]


def find_duplicates(cand, leads, exclude_id=None):
    exact, possible = [], []
    ck = lead_keys(cand)
    maps = cand.get("google_maps_url", "")
    for L in leads:
        if L["lead_id"] == exclude_id:
            continue
        lk = lead_keys(L)
        hard = [k for k in ck if k in lk and k[0] != "nombre_ciudad"]
        if maps and maps == L.get("google_maps_url"):
            hard.append(("google_maps_url", maps))
        if hard:
            exact.append((L["lead_id"], hard))
        elif any(k[0] == "nombre_ciudad" and k in lk for k in ck):
            possible.append((L["lead_id"], normalize_name(L.get("direccion", "")) == normalize_name(cand.get("direccion", ""))))
    return exact, possible


def next_id(prefix, rows, field, width):
    """Rango diario local: 1 … mitad-1 (WW 001–499, INT/FU 0001–4999). El Worker usa de la mitad en adelante
    (cloudflare/src/db.js › nextId), así que los IDs locales y los del dashboard nunca chocan."""
    base, limit = f"{prefix}-{today()}-", 5 * 10 ** (width - 1)
    nums = [int(r[field][len(base):]) for r in rows if r.get(field, "").startswith(base) and r[field][len(base):].isdigit()]
    n = max([x for x in nums if x < limit], default=0) + 1
    if n >= limit:
        raise CRMError(f"Se agotó el consecutivo diario local de {prefix} (rango 1–{limit - 1}; el resto es del Worker)")
    return f"{base}{n:0{width}d}"


def get_lead(leads, lead_id):
    for L in leads:
        if L["lead_id"] == lead_id:
            return L
    raise CRMError(f"No existe el lead {lead_id}")


def assert_not_suppressed_lead(lead, supp_rows, action):
    if lead.get("opt_out") == "true" or lead.get("estado_pipeline") == "no_contactar":
        raise CRMError(f"{lead['lead_id']} está dado de baja / no_contactar: {action} prohibido (policies/opt-out.md §4).")
    hits = suppressed_hits(lead, supp_rows)
    if hits:
        raise CRMError(f"{lead['lead_id']} tiene claves en supresión {hits}: {action} prohibido.")


def validate_row(schema, kind, row):
    return validate(schema, schema["$defs"][FILES[kind]], coerce_row(schema, kind, row), kind)


def log_interaction(schema, rows_int, lead_id, tipo, resumen, canal="interno", direccion="interna", por="crm_tool", **extra):
    row = {"interaccion_id": next_id("INT", rows_int, "interaccion_id", 4), "lead_id": lead_id, "fecha_hora": now_iso(),
           "canal": canal, "direccion": direccion, "tipo": tipo, "resumen": resumen, "enviado_por": "agente",
           "resultado": "n/a", "sentimiento": "n/a", "registrado_por": por}
    row.update({k: to_cell(v) for k, v in extra.items()})
    errs = validate_row(schema, "interactions", row)
    if errs:
        raise CRMError("Interacción inválida: " + "; ".join(errs))
    rows_int.append(row)
    return row


def cancel_followups(fu_rows, lead_id, motivo):
    n = 0
    for f in fu_rows:
        if f["lead_id"] == lead_id and f["estado"] not in ("enviado", "cancelado"):
            f["estado"], f["completado_en"] = "cancelado", now_iso()
            f["notas"] = (f.get("notas", "") + f" | cancelado: {motivo}").strip(" |")
            n += 1
    return n


def write_evidence_sidecar(lead_id, cand, extra=None):
    data = {"lead_id": lead_id, "nombre_negocio": cand.get("nombre_negocio"), "fuente": cand.get("fuente"),
            "fuente_url": cand.get("fuente_url"), "fecha_fuente": cand.get("fecha_fuente"),
            "otras_fuentes": cand.get("otras_fuentes", []), "evidencias": cand.get("evidencias", []),
            "campos_no_encontrados": cand.get("campos_no_encontrados", []),
            "descalificadores": cand.get("descalificadores", []), "investigado_por": cand.get("investigado_por"),
            "calificacion": cand.get("calificacion"), "generado": now_iso()}
    data.update(extra or {})
    p = ROOT / "data" / "research" / f"{lead_id}.evidence.json"
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return p


# ----------------------------------------------------------------------------- comandos
def cmd_init(schema, a):
    CRM.mkdir(parents=True, exist_ok=True)
    for kind in FILES:
        p = CRM / f"{kind}.csv"
        if p.exists():
            print(f"existe   {p.relative_to(ROOT)}")
            continue
        with open(p, "w", newline="", encoding="utf-8") as fh:
            csv.writer(fh).writerow(headers(schema, kind))
        print(f"creado   {p.relative_to(ROOT)}")
    AUDIT_PATH.touch(exist_ok=True)
    print("Recuerda proteger: chflags uappnd data/crm/suppression.csv data/crm/audit.jsonl (lo hace una persona).")


def doc_consistency(schema):
    errs = []
    md = DICT_PATH.read_text(encoding="utf-8")
    pts = {m.group(1): int(m.group(2)) for m in re.finditer(r"^\| `([A-Z_]+)` \| [^|]+\| (\d+) \|", md, re.M)}
    if pts != schema["x-senales-puntos"]:
        errs.append("crm-schema.md (catálogo de señales) ≠ x-senales-puntos del esquema")
    if set(pts) != set(schema["$defs"]["senal"]["enum"]):
        errs.append("crm-schema.md (señales) ≠ $defs.senal.enum")
    sec = md.split("### Estados del pipeline", 1)[-1].split("\n---", 1)[0]
    states = set(re.findall(r"^\| `([a-z_]+)` \|", sec, re.M))
    enum = set(schema["$defs"]["estadoPipeline"]["enum"])
    if states != enum:
        errs.append(f"crm-schema.md (estados) ≠ estadoPipeline.enum: {sorted(states ^ enum)}")
    tr = schema["x-transiciones"]
    if set(tr) != enum or any(t not in enum for v in tr.values() for t in v):
        errs.append("x-transiciones usa estados fuera del enum o le falta alguno")
    for f in schema["x-estados-finales"]:
        if tr.get(f):
            errs.append(f"estado final {f} tiene transiciones de salida")
    return errs


def cmd_validate(schema, a):
    import stat
    errs, warns = [], []
    errs += [f"[docs] {e}" for e in doc_consistency(schema)]
    data = {}
    for kind in FILES:
        fields, rows = read_csv(kind)
        data[kind] = rows
        if fields != headers(schema, kind):
            errs.append(f"[{kind}] encabezados ≠ esquema")
        seen = set()
        for i, row in enumerate(rows, start=2):
            for e in validate_row(schema, kind, row):
                errs.append(f"[{kind} fila {i}] {e}")
            idf = ID_FIELD.get(kind)
            key = row.get(idf) if idf else (row["tipo"], row["valor"].lower())
            if key in seen:
                errs.append(f"[{kind} fila {i}] clave repetida {key}")
            seen.add(key)
    leads, supp, fus, ints = data["leads"], data["suppression"], data["followups"], data["interactions"]
    ids = {L["lead_id"] for L in leads}
    finals = set(schema["x-estados-finales"])
    for L in leads:
        exact, _ = find_duplicates(L, leads, exclude_id=L["lead_id"])
        for other, keys in exact:
            if L["lead_id"] < other:
                errs.append(f"[duplicado] {L['lead_id']} y {other} comparten {keys}")
        if suppressed_hits(L, supp) and L["estado_pipeline"] not in finals:
            errs.append(f"[supresión] {L['lead_id']} tiene claves suprimidas y estado activo {L['estado_pipeline']}")
        if not (ROOT / L.get("evidencias", "")).is_file():
            errs.append(f"[dossier] falta {L.get('evidencias')} de {L['lead_id']}")
    for f in fus:
        if f["lead_id"] not in ids:
            errs.append(f"[followups] {f['seguimiento_id']} apunta a lead inexistente")
        else:
            L = get_lead(leads, f["lead_id"])
            if L["estado_pipeline"] in finals and f["estado"] not in ("enviado", "cancelado"):
                errs.append(f"[followups] {f['seguimiento_id']} activo para lead en estado final {L['estado_pipeline']}")
            if f["estado"] not in ("enviado", "cancelado"):
                prob = contact_day_problem(schema, date.fromisoformat(f["fecha_programada"]))
                if prob:
                    errs.append(f"[followups] {f['seguimiento_id']} programado en {prob}")
    for it in ints:
        if it["lead_id"] and it["lead_id"] not in ids:
            errs.append(f"[interactions] {it['interaccion_id']} apunta a lead inexistente")
    if AUDIT_PATH.exists():
        for n, line in enumerate(AUDIT_PATH.read_text(encoding="utf-8").splitlines(), 1):
            try:
                json.loads(line)
            except ValueError:
                errs.append(f"[audit] línea {n} no es JSON válido")
    for p in (CRM / "suppression.csv", AUDIT_PATH):
        if p.exists() and not (os.stat(p).st_flags & stat.UF_APPEND):
            warns.append(f"{p.relative_to(ROOT)} sin bandera uappnd (solo anexado). Una persona debe ejecutar: chflags uappnd {p.relative_to(ROOT)}")
    for w in warns:
        print("AVISO", w)
    if errs:
        print(f"ERRORES ({len(errs)}):")
        for e in errs:
            print(" -", e)
        sys.exit(1)
    print(f"OK [{ENTORNO}] — leads={len(leads)} interacciones={len(ints)} seguimientos={len(fus)} supresión={len(supp)}; documentación y esquema coherentes.")


def cmd_transitions(schema, a):
    for k, v in schema["x-transiciones"].items():
        print(f"{k:22s} → {', '.join(v) if v else '(final)'}")
    print("cualquier estado no final → no_contactar   (solo con: crm_tool.py suppress)")


def cmd_calendar(schema, a):
    year = a.year or datetime.now(TZ).year
    for d, name in mx_holidays(schema, year).items():
        print(f"{d.isoformat()}  {d.strftime('%a')}  {name}")


def cmd_check_date(schema, a):
    d = date.fromisoformat(a.fecha)
    prob = contact_day_problem(schema, d)
    print(json.dumps({"fecha": a.fecha, "permitido": prob is None, "motivo": prob}, ensure_ascii=False))
    if prob:
        sys.exit(4)


def cmd_check_dup(schema, a):
    cand = {"telefono_e164": a.telefono or "", "whatsapp_publico": a.whatsapp or "", "email_publico": a.email or "",
            "sitio_web": a.sitio or "", "google_maps_url": a.maps or "", "nombre_negocio": a.nombre or "",
            "ciudad": a.ciudad or "", "direccion": a.direccion or ""}
    _, leads = read_csv("leads")
    _, supp = read_csv("suppression")
    hits = suppressed_hits(cand, supp)
    exact, possible = find_duplicates(cand, leads)
    print(json.dumps({"suprimido": hits, "duplicados": exact, "posibles_duplicados": possible}, ensure_ascii=False))


def add_lead(schema, staging, dry_run=False, sucursal_de=None, por="cli"):
    src = Path(staging)
    cand = json.loads(src.read_text(encoding="utf-8"))
    errs = validate(schema, schema["$defs"]["leadCandidate"], cand, "candidato")
    if "calificacion" not in cand:
        errs.append("candidato.calificacion: obligatorio para registrar (ejecuta lead-qualification)")
    if errs:
        raise CRMError("Candidato inválido:\n - " + "\n - ".join(errs))
    cal = cand["calificacion"]
    q = check_qualification(schema, cal, cand["evidencias"], cand.get("descalificadores", []))
    if cal["clasificacion"] in ("A", "B") and not any(cand.get(f) for f in CONTACT_FIELDS):
        q.append("PENDIENTE DE REVISIÓN: clase A/B sin ningún canal de contacto verificado en los datos "
                 "(teléfono, WhatsApp, email o red del negocio). Un puntaje alto no compensa contacto no verificado.")
    if q:
        raise CRMError("Calificación incoherente o incompleta:\n - " + "\n - ".join(q))
    with locked():
        lf, leads = read_csv("leads")
        _, supp = read_csv("suppression")
        hits = suppressed_hits(cand, supp)
        if hits:
            raise CRMError(f"En lista de supresión {hits}: no se registra (policies/opt-out.md).")
        exact, possible = find_duplicates(cand, leads)
        if exact:
            raise CRMError(f"Duplicado de {exact}. Enriquecer el lead existente con update-lead; no se crea otro.")
        nota = ""
        for lid, same_addr in possible:
            if same_addr or sucursal_de != lid:
                raise CRMError(f"Posible duplicado de {lid} (mismo nombre y ciudad; misma dirección={same_addr}). "
                               f"Si es otra sucursal verificada, repite con --sucursal-de {lid}.")
            nota = f"sucursal relacionada: {lid}"
        lead_id = next_id("WW", leads, "lead_id", 3)
        dom = domain_of(cand.get("sitio_web", ""))
        ts = now_iso()
        row = {k: "" for k in lf}
        for k, v in cand.items():
            if k in row:
                row[k] = to_cell(v)
        for k, v in cal.items():
            if k in row:
                row[k] = to_cell(v)
        row.update({
            "lead_id": lead_id, "fecha_registro": ts, "fecha_actualizacion": ts,
            "nombre_normalizado": normalize_name(cand["nombre_negocio"]),
            "dominio": "" if (not dom or is_generic(dom)) else dom,
            "zona_horaria": cand.get("zona_horaria") or TZ_BY_STATE.get(normalize_name(cand["estado_mx"]), "America/Mexico_City"),
            "evidencias": f"data/research/{lead_id}.md",
            "estado_pipeline": "descartado" if cal["clasificacion"] == "descartado" else "calificado",
            "aprobacion_estado": "no_aplica", "num_seguimientos": "0", "consentimiento_whatsapp": "no", "opt_out": "false",
            "notas": "; ".join(x for x in [nota, ("no encontrados: " + ", ".join(cand.get("campos_no_encontrados", []))) if cand.get("campos_no_encontrados") else ""] if x),
        })
        errs = validate_row(schema, "leads", row)
        if errs:
            raise CRMError("Registro inválido:\n - " + "\n - ".join(errs))
        dossier = ROOT / cand["dossier_path"]
        if not dossier.is_file():
            raise CRMError(f"No existe el dossier {cand['dossier_path']}")
        if dry_run:
            return {"dry_run": True, "lead_id": lead_id, "clasificacion": cal["clasificacion"]}
        target = ROOT / row["evidencias"]
        text = dossier.read_text(encoding="utf-8")
        text = re.sub(r"^\| lead_id \|.*$", f"| lead_id | {lead_id} |", text, count=1, flags=re.M)
        target.write_text(text, encoding="utf-8")
        if dossier != target:
            dossier.unlink()
        leads.append(row)
        write_csv("leads", lf, leads)
        write_evidence_sidecar(lead_id, cand)
        done = src.parent / "procesados"
        done.mkdir(exist_ok=True)
        cand_out = dict(cand)
        shutil.move(str(src), done / src.name)
        (done / f"{src.stem}.lead_id").write_text(lead_id + "\n", encoding="utf-8")
        audit("lead.registrado", por, lead_id, {"clasificacion": cal["clasificacion"], "puntaje": cal["puntaje_total"],
                                                "nombre": cand_out["nombre_negocio"], "staging": src.name})
    return {"registrado": lead_id, "clasificacion": cal["clasificacion"], "puntaje": cal["puntaje_total"]}


def cmd_add_lead(schema, a):
    print(json.dumps(add_lead(schema, a.staging, a.dry_run, a.sucursal_de, a.por), ensure_ascii=False))


def cmd_import_candidates(schema, a):
    folder = Path(a.carpeta)
    results = []
    for f in sorted(folder.glob("*.json")):
        try:
            results.append({"archivo": f.name, **add_lead(schema, f, por=a.por)})
        except CRMError as e:
            results.append({"archivo": f.name, "rechazado": str(e).splitlines()[0]})
    print(json.dumps(results, ensure_ascii=False, indent=2))


def cmd_reject_candidate(schema, a):
    src = Path(a.staging)
    if not src.is_file() or src.suffix != ".json":
        raise CRMError(f"No existe el candidato {src}")
    with locked():
        dest = src.parent / "rechazados"
        dest.mkdir(exist_ok=True)
        shutil.move(str(src), dest / src.name)
        (dest / f"{src.stem}.motivo.txt").write_text(f"{now_iso()} {a.por}: {a.motivo}\n", encoding="utf-8")
        audit("candidato.rechazado", a.por, src.name, {"motivo": a.motivo})
    print(json.dumps({"rechazado": src.name, "motivo": a.motivo}, ensure_ascii=False))


def cmd_update_lead(schema, a):
    changes = {}
    for s in a.set or []:
        if "=" not in s:
            raise CRMError(f"--set inválido: {s}")
        k, v = s.split("=", 1)
        changes[k.strip()] = v
    with locked():
        lf, leads = read_csv("leads")
        _, supp = read_csv("suppression")
        ff, fus = read_csv("followups")
        inf, ints = read_csv("interactions")
        L = get_lead(leads, a.lead_id)
        assert_not_suppressed_lead(L, supp, "modificar")
        bad = [k for k in changes if k not in lf or k in READ_ONLY_LEAD_FIELDS]
        if bad:
            raise CRMError(f"Campos no modificables o inexistentes: {bad}. Bajas: usa 'suppress'.")
        before = {k: L.get(k, "") for k in changes}
        old = L["estado_pipeline"]
        new = changes.get("estado_pipeline", old)
        if new != old:
            if new == "no_contactar":
                raise CRMError("A no_contactar solo se llega con 'crm_tool.py suppress'.")
            if new not in schema["x-transiciones"].get(old, []):
                raise CRMError(f"Transición inválida {old} → {new}. Válidas: {schema['x-transiciones'].get(old)}")
        if changes.get("aprobacion_estado") == "aprobado" or new == "aprobado":
            por = changes.get("aprobado_por", L.get("aprobado_por", "")).strip()
            if not por or por.lower() in AGENT_NAMES:
                raise CRMError("'aprobado' exige aprobado_por con el nombre de la persona que aprobó (nunca un agente).")
            changes.setdefault("aprobacion_estado", "aprobado")
            changes.setdefault("fecha_aprobacion", now_iso())
            if L.get("aprobacion_estado") not in ("pendiente", "aprobado"):
                raise CRMError("Solo se aprueba un lead con aprobacion_estado = pendiente.")
        if changes.get("proximo_seguimiento"):
            prob = contact_day_problem(schema, date.fromisoformat(changes["proximo_seguimiento"]))
            if prob:
                raise CRMError(f"proximo_seguimiento cae en {prob}; elige un día hábil (policies/contact-cadence.md §4).")
        score_fields = {"puntaje_icp", "puntaje_oportunidad", "puntaje_contacto", "puntaje_capacidad", "puntaje_total",
                        "clasificacion", "senales_oportunidad"}
        L.update(changes)
        if score_fields & set(changes):
            cal = {k: int(L[k]) for k in ("puntaje_icp", "puntaje_oportunidad", "puntaje_contacto", "puntaje_capacidad", "puntaje_total")}
            cal["clasificacion"] = L["clasificacion"]
            cal["senales_oportunidad"] = [x for x in L["senales_oportunidad"].split(";") if x]
            q = check_qualification(schema, cal, [{"senal": x} for x in cal["senales_oportunidad"]], [])
            if q:
                raise CRMError("Recalificación incoherente:\n - " + "\n - ".join(q))
        if new in schema["x-estados-finales"]:
            L["proximo_seguimiento"] = ""
            cancel_followups(fus, L["lead_id"], f"lead pasó a {new}")
        if a.nota:
            L["notas"] = (L.get("notas", "") + f" | {datetime.now(TZ).date()} {a.nota}").strip(" |")
        L["fecha_actualizacion"] = now_iso()
        errs = validate_row(schema, "leads", L)
        if errs:
            raise CRMError("Resultado inválido:\n - " + "\n - ".join(errs))
        if new != old:
            log_interaction(schema, ints, L["lead_id"], "cambio_estado", f"{old} → {new}. {a.nota or ''}".strip(), por=a.por)
        if changes.get("aprobacion_estado") == "aprobado":
            log_interaction(schema, ints, L["lead_id"], "aprobacion", f"Aprobado por {L['aprobado_por']} (uso humano; no envía)",
                            por=a.por, aprobacion_ref=f"{L['aprobado_por']} {L['fecha_aprobacion']}")
        write_csv("leads", lf, leads)
        write_csv("followups", ff, fus)
        write_csv("interactions", inf, ints)
        if new != old:
            audit("lead.estado_cambiado", a.por, L["lead_id"], {"de": old, "a": new, "nota": a.nota or ""})
            if new == "pendiente_aprobacion":
                audit("borrador.listo", a.por, L["lead_id"], {"mensaje": L.get("mensaje_inicial_id", "")})
        if changes.get("aprobacion_estado") == "aprobado":
            audit("aprobacion.humana", a.por, L["lead_id"], {"aprobado_por": L["aprobado_por"], "envia": False})
        audit("lead.actualizado", a.por, L["lead_id"], {"antes": before, "despues": changes, "nota": a.nota or ""})
    print(json.dumps({"actualizado": a.lead_id, "cambios": changes}, ensure_ascii=False))


def cmd_add_interaction(schema, a):
    obj = json.loads(a.json)
    with locked():
        lf, leads = read_csv("leads")
        _, supp = read_csv("suppression")
        inf, ints = read_csv("interactions")
        L = get_lead(leads, obj.get("lead_id", ""))
        if obj.get("direccion") == "saliente":
            assert_not_suppressed_lead(L, supp, "registrar un envío")
            if obj.get("tipo") == "mensaje_inicial" and L.get("aprobacion_estado") != "aprobado":
                raise CRMError("No hay aprobación humana registrada para el mensaje inicial de este lead.")
        row = {k: "" for k in inf}
        row.update({k: to_cell(v) for k, v in obj.items()})
        row["interaccion_id"] = row["interaccion_id"] or next_id("INT", ints, "interaccion_id", 4)
        row["fecha_hora"] = row["fecha_hora"] or now_iso()
        errs = validate_row(schema, "interactions", row)
        if errs:
            raise CRMError("Interacción inválida:\n - " + "\n - ".join(errs))
        ints.append(row)
        if obj.get("direccion") == "entrante":
            L["fecha_ultima_interaccion"] = row["fecha_hora"]
            if obj.get("canal") == "whatsapp" and L.get("consentimiento_whatsapp") == "no":
                L["consentimiento_whatsapp"], L["fecha_consentimiento"] = "si_inicio_lead", row["fecha_hora"]
            L["fecha_actualizacion"] = now_iso()
            write_csv("leads", lf, leads)
        write_csv("interactions", inf, ints)
        audit("respuesta.recibida" if obj.get("direccion") == "entrante" else "interaccion.registrada", a.por,
              L["lead_id"], {"interaccion_id": row["interaccion_id"], "tipo": row["tipo"], "canal": row["canal"]})
    note = " Si el contenido es una baja, ejecuta 'suppress' ahora (policies/opt-out.md)." if obj.get("direccion") == "entrante" else ""
    print(json.dumps({"registrada": row["interaccion_id"]}, ensure_ascii=False) + note)


def cmd_add_followup(schema, a):
    obj = json.loads(a.json)
    prob = contact_day_problem(schema, date.fromisoformat(obj.get("fecha_programada", "")))
    if prob:
        raise CRMError(f"fecha_programada cae en {prob}; no se contacta ese día (policies/contact-cadence.md §4).")
    with locked():
        _, leads = read_csv("leads")
        _, supp = read_csv("suppression")
        ff, fus = read_csv("followups")
        L = get_lead(leads, obj.get("lead_id", ""))
        assert_not_suppressed_lead(L, supp, "programar seguimientos")
        if L["estado_pipeline"] in schema["x-estados-finales"]:
            raise CRMError(f"Lead en estado final {L['estado_pipeline']}.")
        if any(f["lead_id"] == L["lead_id"] and f["fecha_programada"] == obj.get("fecha_programada")
               and f["estado"] != "cancelado" for f in fus):
            raise CRMError("Ya hay un seguimiento ese día para este lead (máximo 1 mensaje por día).")
        row = {k: "" for k in ff}
        row.update({k: to_cell(v) for k, v in obj.items()})
        row["seguimiento_id"] = row["seguimiento_id"] or next_id("FU", fus, "seguimiento_id", 4)
        row["creado_en"] = row["creado_en"] or now_iso()
        row["estado"] = row["estado"] or "programado"
        row["requiere_aprobacion"] = row["requiere_aprobacion"] or "true"
        errs = validate_row(schema, "followups", row)
        if errs:
            raise CRMError("Seguimiento inválido:\n - " + "\n - ".join(errs))
        fus.append(row)
        write_csv("followups", ff, fus)
        audit("seguimiento.programado", a.por, L["lead_id"], {"seguimiento_id": row["seguimiento_id"],
                                                              "fecha": row["fecha_programada"], "canal": row["canal"]})
    print(json.dumps({"programado": row["seguimiento_id"]}, ensure_ascii=False))


def cmd_update_followup(schema, a):
    with locked():
        _, leads = read_csv("leads")
        _, supp = read_csv("suppression")
        ff, fus = read_csv("followups")
        f = next((x for x in fus if x["seguimiento_id"] == a.seguimiento_id), None)
        if not f:
            raise CRMError(f"No existe {a.seguimiento_id}")
        if f["estado"] in ("enviado", "cancelado"):
            raise CRMError(f"{a.seguimiento_id} ya está {f['estado']}.")
        if a.estado in ("aprobado", "enviado"):
            assert_not_suppressed_lead(get_lead(leads, f["lead_id"]), supp, f"marcar seguimiento como {a.estado}")
        old = f["estado"]
        f["estado"] = a.estado
        if a.estado in ("enviado", "cancelado"):
            f["completado_en"] = now_iso()
        if a.nota:
            f["notas"] = (f.get("notas", "") + " | " + a.nota).strip(" |")
        errs = validate_row(schema, "followups", f)
        if errs:
            raise CRMError("Seguimiento inválido:\n - " + "\n - ".join(errs))
        write_csv("followups", ff, fus)
        audit("seguimiento.actualizado", a.por, f["lead_id"], {"seguimiento_id": f["seguimiento_id"], "de": old, "a": a.estado})
    print(json.dumps({"actualizado": a.seguimiento_id, "estado": a.estado}, ensure_ascii=False))


def cmd_suppress(schema, a):
    with locked():
        lf, leads = read_csv("leads")
        sf, supp = read_csv("suppression")
        ff, fus = read_csv("followups")
        inf, ints = read_csv("interactions")
        if a.lead:
            L = get_lead(leads, a.lead)
            keys = lead_keys(L)
            targets = [L]
        else:
            if not (a.valor and a.tipo):
                raise CRMError("Indica --lead o bien --valor y --tipo.")
            v = a.valor.strip().lower() if a.tipo in ("email", "dominio") else a.valor.strip()
            keys = [(a.tipo, v)]
            targets = [L for L in leads if (a.tipo, v.lower()) in {(t, x.lower()) for t, x in lead_keys(L)}]
        existing = {(r["tipo"], r["valor"].strip().lower()) for r in supp}
        ts = now_iso()
        new_rows = []
        for t, v in keys:
            if (t, v.lower()) in existing:
                continue
            row = {"valor": v, "tipo": t, "lead_id": a.lead or (targets[0]["lead_id"] if len(targets) == 1 else ""),
                   "motivo": a.motivo, "fecha": ts, "fuente": a.fuente, "notas": a.nota or ""}
            errs = validate_row(schema, "suppression", row)
            if errs:
                raise CRMError("Supresión inválida:\n - " + "\n - ".join(errs))
            new_rows.append(row)
        applies_lead = a.motivo in ("opt_out", "solicitud_legal", "repep", "cliente_actual", "competidor", "socio")
        for L in targets if applies_lead else []:
            if L["estado_pipeline"] not in schema["x-estados-finales"] or L["estado_pipeline"] in ("perdido", "descartado"):
                L["estado_pipeline"] = "no_contactar"
            if a.motivo in ("opt_out", "solicitud_legal"):
                L["opt_out"], L["fecha_opt_out"], L["estado_pipeline"] = "true", ts, "no_contactar"
            L["proximo_seguimiento"] = ""
            L["fecha_actualizacion"] = ts
            n = cancel_followups(fus, L["lead_id"], f"supresión ({a.motivo})")
            log_interaction(schema, ints, L["lead_id"], "opt_out" if a.motivo == "opt_out" else "cambio_estado",
                            f"Supresión por {a.motivo}; {n} seguimientos cancelados. Fuente: {a.fuente}", por=a.por)
            errs = validate_row(schema, "leads", L)
            if errs:
                raise CRMError("Lead inválido tras supresión:\n - " + "\n - ".join(errs))
        if new_rows:
            append_csv("suppression", sf, new_rows)
        if targets and applies_lead:
            write_csv("leads", lf, leads)
            write_csv("followups", ff, fus)
            write_csv("interactions", inf, ints)
        audit("baja.registrada" if a.motivo == "opt_out" else "supresion.agregada", a.por,
              a.lead or (targets[0]["lead_id"] if len(targets) == 1 else a.valor),
              {"motivo": a.motivo, "valores": [r["valor"] for r in new_rows], "fuente": a.fuente})
    print(json.dumps({"suprimidos": [r["valor"] for r in new_rows], "leads_afectados": [L["lead_id"] for L in targets]}, ensure_ascii=False))


def cmd_backfill_evidence(schema, a):
    _, leads = read_csv("leads")
    by_key = {(L["nombre_normalizado"], normalize_name(L["ciudad"])): L["lead_id"] for L in leads}
    made = []
    for f in sorted((ROOT / "data" / "staging").glob("*/procesados/*.json")):
        cand = json.loads(f.read_text(encoding="utf-8"))
        idfile = f.with_suffix(".lead_id")
        lid = idfile.read_text().strip() if idfile.exists() else by_key.get((normalize_name(cand["nombre_negocio"]), normalize_name(cand["ciudad"])))
        if not lid or (ROOT / "data" / "research" / f"{lid}.evidence.json").exists():
            continue
        write_evidence_sidecar(lid, cand, {"origen": f"backfill desde {f.relative_to(ROOT)}"})
        made.append(lid)
    if made:
        audit("evidencia.respaldada", a.por, ",".join(made), {"archivos": len(made)})
    print(json.dumps({"creados": made}, ensure_ascii=False))


def cmd_export(schema, a):
    stamp = datetime.now(TZ).strftime("%Y-%m-%d_%H%M%S")
    out = Path(a.dir) if a.dir else ROOT / "data" / "exports" / stamp
    out.mkdir(parents=True, exist_ok=True)
    for kind in FILES:
        shutil.copy2(CRM / f"{kind}.csv", out / f"{kind}.csv")
    if AUDIT_PATH.exists():
        shutil.copy2(AUDIT_PATH, out / "audit.jsonl")
    audit("exportacion", a.por, str(out.relative_to(ROOT)) if out.is_relative_to(ROOT) else str(out), {})
    print(json.dumps({"exportado": str(out)}, ensure_ascii=False))


# ----------------------------------------------------------------------------- sincronización D1 → local
PULL_KEYS = {"leads": ("lead_id",), "interactions": ("interaccion_id",), "followups": ("seguimiento_id",), "suppression": ("tipo", "valor")}
PULL_DOC_DIRS = ("data/research/", "data/outreach/")


def _d1_rows(db, table, fields):
    import sqlite3
    db.row_factory = sqlite3.Row
    cols = {r[1] for r in db.execute(f"PRAGMA table_info({table})")}
    return [{f: to_cell(r[f]) if f in cols else "" for f in fields} for r in db.execute(f"SELECT * FROM {table}")]


def _sha(s):
    import hashlib
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


def pull_plan(schema, db):
    """Compara D1 con los CSV locales. D1 es la fuente principal, salvo que las bajas locales nunca se revierten."""
    plan = {"agregar": {}, "actualizar": {}, "conflictos": [], "solo_local": {}, "documentos": [], "_rows": {}}
    for kind, key in PULL_KEYS.items():
        fields, local = read_csv(kind)
        remote = _d1_rows(db, kind, fields)
        k = lambda r: tuple(r[c] for c in key)
        lo, re_ = {k(r): r for r in local}, {k(r): r for r in remote}
        add, upd = [r for kk, r in re_.items() if kk not in lo], []
        for kk in lo.keys() & re_.keys():
            L, R = lo[kk], re_[kk]
            difs = [f for f in fields if L.get(f, "") != R.get(f, "")]
            if not difs:
                continue
            ident = "|".join(kk)
            if kind in ("interactions", "suppression"):  # historial inmutable / solo anexado
                plan["conflictos"].append({"tabla": kind, "clave": ident, "campos": difs, "motivo": "inmutable: mismo ID con contenido distinto"})
            elif kind == "leads" and (L["opt_out"] == "true" or L["estado_pipeline"] == "no_contactar") and \
                    (R["opt_out"] != "true" or R["estado_pipeline"] != "no_contactar"):
                plan["conflictos"].append({"tabla": kind, "clave": ident, "campos": difs,
                                           "motivo": "baja local: no se revierte (policies/opt-out.md); falta aplicarla en D1"})
            elif kind == "followups" and L["estado"] in ("enviado", "cancelado") and R["estado"] != L["estado"]:
                plan["conflictos"].append({"tabla": kind, "clave": ident, "campos": difs, "motivo": "seguimiento cerrado en local"})
            else:
                upd.append((L, R, difs))
        for r in add:
            errs = validate_row(schema, kind, r)
            if errs:
                plan["conflictos"].append({"tabla": kind, "clave": "|".join(k(r)), "motivo": "inválido: " + "; ".join(errs)})
        add = [r for r in add if not validate_row(schema, kind, r)]
        plan["agregar"][kind] = [ "|".join(k(r)) for r in add]
        plan["actualizar"][kind] = [{"clave": "|".join(k(L)), "campos": d} for L, R, d in upd]
        plan["solo_local"][kind] = sorted("|".join(kk) for kk in lo.keys() - re_.keys())
        plan["_rows"][kind] = (fields, local, add, upd)
    # documentos: última versión de D1 por ruta (solo data/research y data/outreach)
    import sqlite3
    db.row_factory = sqlite3.Row
    latest = {}
    for r in db.execute("SELECT path, version, content, sha256 FROM documents ORDER BY path, version"):
        latest.setdefault(r["path"], []).append(dict(r))
    for path, versions in sorted(latest.items()):
        p = Path(path)
        if p.is_absolute() or ".." in p.parts or not path.startswith(PULL_DOC_DIRS):
            plan["conflictos"].append({"tabla": "documents", "clave": path, "motivo": "ruta fuera de data/research o data/outreach"})
            continue
        last, dest = versions[-1], ROOT / path
        if dest.exists():
            cur = _sha(dest.read_text(encoding="utf-8"))
            if cur == last["sha256"]:
                continue
            if cur not in {v["sha256"] for v in versions[:-1]}:
                plan["conflictos"].append({"tabla": "documents", "clave": path, "motivo": "editado en local y en D1"})
                continue
        plan["documentos"].append({"path": path, "version": last["version"], "content": last["content"]})
    return plan


def cmd_pull_d1(schema, a):
    import sqlite3
    db = sqlite3.connect(":memory:")
    db.executescript(Path(a.sql).read_text(encoding="utf-8"))
    with locked():
        plan = pull_plan(schema, db)
        rows = plan.pop("_rows")
        report = {**plan, "documentos": [d["path"] for d in plan["documentos"]], "dry_run": bool(a.dry_run)}
        if a.dry_run:
            print(json.dumps(report, ensure_ascii=False, indent=2)); return
        for kind, (fields, local, add, upd) in rows.items():
            if not add and not upd:
                continue
            if kind == "suppression":
                append_csv(kind, fields, add)  # solo anexado
                continue
            byid = {id(L): R for L, R, _ in upd}
            write_csv(kind, fields, [byid.get(id(r), r) for r in local] + add)
        for d in plan["documentos"]:
            dest = ROOT / d["path"]
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_text(d["content"], encoding="utf-8")
        audit("sync.d1_a_local", a.por, "crm", {k: {t: len(v) for t, v in plan[k].items()} for k in ("agregar", "actualizar")}
              | {"documentos": len(plan["documentos"]), "conflictos": len(plan["conflictos"])})
    print(json.dumps(report, ensure_ascii=False, indent=2))


def cmd_show(schema, a):
    _, leads = read_csv("leads")
    _, ints = read_csv("interactions")
    _, fus = read_csv("followups")
    L = get_lead(leads, a.lead_id)
    print(json.dumps({"lead": {k: v for k, v in L.items() if v},
                      "interacciones": [i for i in ints if i["lead_id"] == a.lead_id],
                      "seguimientos": [f for f in fus if f["lead_id"] == a.lead_id]}, ensure_ascii=False, indent=2))


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)

    def add(name, **kw):
        c = sub.add_parser(name, **kw)
        c.add_argument("--por", default=os.environ.get("WW_ACTOR", "cli"))
        return c

    add("init"); add("validate"); add("transitions")
    c = add("calendar"); c.add_argument("--year", type=int)
    c = add("check-date"); c.add_argument("fecha")
    c = add("check-dup")
    for f in ("telefono", "whatsapp", "email", "sitio", "maps", "nombre", "ciudad", "direccion"):
        c.add_argument(f"--{f}")
    c = add("add-lead"); c.add_argument("staging"); c.add_argument("--dry-run", action="store_true"); c.add_argument("--sucursal-de")
    c = add("import-candidates"); c.add_argument("carpeta")
    c = add("reject-candidate"); c.add_argument("staging"); c.add_argument("--motivo", required=True)
    c = add("update-lead"); c.add_argument("lead_id"); c.add_argument("--set", action="append"); c.add_argument("--nota")
    c = add("add-interaction"); c.add_argument("--json", required=True)
    c = add("add-followup"); c.add_argument("--json", required=True)
    c = add("update-followup"); c.add_argument("seguimiento_id"); c.add_argument("--estado", required=True,
        choices=["programado", "borrador_listo", "pendiente_aprobacion", "aprobado", "enviado", "cancelado", "vencido"]); c.add_argument("--nota")
    c = add("suppress"); c.add_argument("--lead"); c.add_argument("--valor"); c.add_argument("--tipo")
    c.add_argument("--motivo", required=True); c.add_argument("--fuente", required=True); c.add_argument("--nota")
    add("backfill-evidence")
    c = add("export"); c.add_argument("--dir")
    c = add("show"); c.add_argument("lead_id")
    c = add("pull-d1"); c.add_argument("--sql", required=True); c.add_argument("--dry-run", action="store_true")
    a = p.parse_args()
    schema = load_schema()
    try:
        globals()["cmd_" + a.cmd.replace("-", "_")](schema, a)
    except CRMError as e:
        print(f"RECHAZADO: {e}", file=sys.stderr)
        sys.exit(3)


if __name__ == "__main__":
    main()
