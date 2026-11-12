#!/usr/bin/env python3
"""
Genera datos de DEMOSTRACIÓN en demo/ (nunca toca data/ real).
Todos los negocios son ficticios: nombres con prefijo "DEMO", dominios .invalid, teléfonos +5200...
Los registros se crean con scripts/crm_tool.py, así que pasan por las mismas validaciones que los reales.

    python3 app/seed_demo.py          # regenera demo/
"""
import json, os, shutil, subprocess, sys
from datetime import date, timedelta
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DEMO = REPO / "demo"
TOOL = REPO / "scripts" / "crm_tool.py"
os.environ["WW_ROOT"] = str(DEMO)
sys.path.insert(0, str(REPO / "scripts"))
import crm_tool as crm  # noqa: E402

SCHEMA = crm.load_schema()
TODAY = date.today().isoformat()


def tool(*args, ok=True):
    r = subprocess.run([sys.executable, str(TOOL), *args, "--por", "seed-demo"], capture_output=True, text=True,
                       env=dict(os.environ, WW_ROOT=str(DEMO)))
    if ok and r.returncode != 0:
        raise SystemExit(f"crm_tool {' '.join(args[:2])} falló: {r.stderr.strip()}")
    return r


def next_business_day(start, n=1):
    d = start
    while n:
        d += timedelta(days=1)
        if not crm.contact_day_problem(SCHEMA, d):
            n -= 1
    return d.isoformat()


BUSINESSES = [
    # slug, nombre, nicho, ciudad, estado, señales [(código, confianza)], contacto(email?, wa?), servicios_alto, reseñas
    ("sonrisa", "DEMO Clínica Dental Sonrisa Ficticia", "dentista", "Puebla", "Puebla", [("WEB_BROKEN", "alta"), ("BOOK_PHONE_ONLY", "alta")], True, True, True, 80),
    ("vetfeliz", "DEMO Veterinaria Huellitas Ficticia", "veterinaria", "Querétaro", "Querétaro", [("WEB_NONE", "alta"), ("WA_NO_LINK", "media")], False, True, False, 40),
    ("spaluna", "DEMO Spa Luna Ficticio", "estetica_spa", "Guadalajara", "Jalisco", [("WEB_NOT_MOBILE", "alta"), ("BOOK_NONE", "media"), ("WEB_NO_CTA", "alta")], True, True, True, 120),
    ("medicentro", "DEMO Consultorio Médico Centro Ficticio", "clinica", "Ciudad de México", "Ciudad de México", [("WEB_OUTDATED", "media"), ("FORM_BROKEN", "alta"), ("REV_CONTACT_ISSUES", "media")], True, False, True, 60),
    ("dentalnorte", "DEMO Dental Norte Ficticio", "dentista", "Monterrey", "Nuevo León", [("WEB_NO_HTTPS", "alta"), ("WEB_SLOW", "alta")], True, True, True, 55),
    ("esteticaroma", "DEMO Estética Aroma Ficticia", "estetica_spa", "Puebla", "Puebla", [("WEB_SOCIAL_ONLY", "media")], False, False, False, 10),
    ("vetsur", "DEMO Veterinaria Sur Ficticia", "veterinaria", "Puebla", "Puebla", [("WEB_BROKEN", "alta"), ("GBP_INCOMPLETE", "media")], True, True, False, 25),
    ("ortoplus", "DEMO Ortodoncia Plus Ficticia", "dentista", "Guadalajara", "Jalisco", [("WEB_NONE", "baja")], True, True, True, 90),
]


def build(i, slug, nombre, nicho, ciudad, estado, senales, email, wa, alto, resenas):
    site = None if any(s == "WEB_NONE" for s, _ in senales) else f"https://{slug}.demo.invalid/"
    phone = f"+52000000{i:04d}"
    evid = [{"senal": s, "observacion": f"[DEMO] Observación ficticia para la señal {s} en {nombre}.",
             "url": site or f"https://directorio.demo.invalid/{slug}", "fecha_verificacion": TODAY,
             "metodo": "Dato de demostración (no es una verificación real)", "confianza": c} for s, c in senales]
    codes = [s for s, c in senales if c != "baja"]
    icp = 10 + 5 + 5 + (5 if resenas >= 20 else 0) if nicho in ("dentista", "clinica") else 9 + 5 + 5 + (5 if resenas >= 20 else 0)
    contacto = 10 + (5 if (email and wa) else 0)
    capacidad = (5 if resenas >= 50 else 3 if resenas >= 20 else 0) + (5 if alto else 0)
    senales_cal = [s for s, _ in senales]
    op = crm.expected_opportunity(SCHEMA, senales_cal)
    cal = {"puntaje_icp": icp, "puntaje_oportunidad": op, "puntaje_contacto": contacto, "puntaje_capacidad": capacidad,
           "puntaje_total": icp + op + contacto + capacidad, "senales_oportunidad": senales_cal,
           "servicio_recomendado": ["rediseno_web" if site else "sitio_nuevo", "agenda_en_linea"],
           "canal_preferido": "email" if email else "telefono", "calificado_en": f"{TODAY}T10:00:00-06:00",
           "motivo_clasificacion": "[DEMO] Calificación de demostración calculada con la rúbrica real."}
    cal["clasificacion"] = crm.expected_class(SCHEMA, cal, [])
    cand = {"fuente": "manual", "fuente_url": site or f"https://directorio.demo.invalid/{slug}", "fecha_fuente": TODAY,
            "nombre_negocio": nombre, "nicho": nicho, "ciudad": ciudad, "estado_mx": estado, "zona_horaria": "America/Mexico_City",
            "direccion": f"Calle Ficticia {100 + i}, {ciudad}", "telefono_publico": f"00 0000 {i:04d}", "telefono_e164": phone,
            "num_resenas": resenas, "evidencias": evid, "campos_no_encontrados": [] if email else ["email_publico"],
            "descalificadores": [], "dossier_path": f"data/research/{slug}.md", "investigado_por": "seed-demo", "calificacion": cal}
    if site:
        cand["sitio_web"] = site
    if email:
        cand["email_publico"] = f"contacto@{slug}.demo.invalid"
    if wa:
        cand["whatsapp_publico"] = phone
    dossier = (f"# Dossier de investigación — {nombre}\n\n> **DATOS DE DEMOSTRACIÓN.** Negocio ficticio.\n\n| Campo | Valor |\n|---|---|\n| lead_id | pendiente |\n"
               f"| Fuente | manual (demo) |\n\n## Señales\n\n" + "\n".join(f"- {e['senal']} ({e['confianza']}): {e['observacion']}" for e in evid) + "\n")
    (DEMO / "data" / "research" / f"{slug}.md").write_text(dossier, encoding="utf-8")
    return cand


def main():
    if DEMO.exists():
        if not (DEMO / ".demo").exists():
            raise SystemExit("demo/ existe pero no tiene el marcador .demo; no se borra por seguridad.")
        shutil.rmtree(DEMO)
    for sub in ("data/crm", "data/research", "data/outreach", "data/reports"):
        (DEMO / sub).mkdir(parents=True, exist_ok=True)
    (DEMO / ".demo").write_text("Carpeta de datos de demostración. Se puede regenerar con app/seed_demo.py\n")
    (DEMO / "README.md").write_text("# Datos de demostración\n\nTodo lo que hay aquí es ficticio. Se usa con `python3 app/server.py --demo`.\n")
    tool("init")
    batch = DEMO / "data" / "staging" / TODAY
    batch.mkdir(parents=True, exist_ok=True)
    ids = {}
    for i, b in enumerate(BUSINESSES, 1):
        cand = build(i, *b)
        p = batch / f"{b[0]}.json"
        p.write_text(json.dumps(cand, ensure_ascii=False, indent=2), encoding="utf-8")
        if b[0] in ("vetsur", "ortoplus"):
            continue  # se quedan en el área de revisión (ortoplus: evidencia baja → pendiente de revisión)
        out = json.loads(tool("add-lead", str(p)).stdout)
        ids[b[0]] = out["registrado"]
    d1, d2 = next_business_day(date.today()), next_business_day(date.today(), 3)
    # sonrisa: borrador pendiente de aprobación
    L = ids["sonrisa"]
    (DEMO / "data" / "outreach" / f"{L}-inicial.md").write_text(
        f"---\nlead_id: {L}\nnegocio: DEMO Clínica Dental Sonrisa Ficticia\nclasificacion: A\ncanal: email\nenvio: manual_humano\nestado: pendiente_aprobacion\ncompliance: aprobado\n---\n\n"
        "## Asunto (solo email)\nEl enlace de citas de su sitio (DEMO)\n\n## Mensaje\nHola, equipo de DEMO Clínica Dental Sonrisa Ficticia:\n\n"
        "Le escribe el equipo comercial de Web Wizards. Desarrollamos sitios web, automatizaciones e integraciones de WhatsApp para negocios.\n\n"
        "[DEMO] Noté que el enlace de citas de su sitio abre una página de error.\n\n¿Le comparto tres ideas en una llamada de 10 minutos?\n\nEquipo comercial de Web Wizards\n\n"
        "Si prefiere no recibir más correos, responda 'baja' y no volveremos a escribirle.\n\n## Trazabilidad\n| Afirmación | Evidencia |\n|---|---|\n| Enlace de citas roto | [DEMO] evidencia ficticia |\n\n"
        "## Notas para quien aprueba\n- Datos de demostración.\n\n## Revisión de cumplimiento\n- Resultado: aprobado (demo)\n", encoding="utf-8")
    tool("update-lead", L, "--set", "estado_pipeline=mensaje_borrador")
    tool("update-lead", L, "--set", "estado_pipeline=pendiente_aprobacion", "--set", "aprobacion_estado=pendiente",
         "--set", f"mensaje_inicial_id=data/outreach/{L}-inicial.md")
    # spaluna: aprobado → contactado con seguimiento
    L = ids["spaluna"]
    tool("update-lead", L, "--set", "estado_pipeline=mensaje_borrador")
    tool("update-lead", L, "--set", "estado_pipeline=pendiente_aprobacion", "--set", "aprobacion_estado=pendiente")
    tool("update-lead", L, "--set", "estado_pipeline=aprobado", "--set", "aprobado_por=Persona Demo", "--set", f"proximo_seguimiento={d1}")
    tool("add-interaction", "--json", json.dumps({"lead_id": L, "canal": "email", "direccion": "saliente", "tipo": "mensaje_inicial",
         "resumen": "[DEMO] Enviado manualmente por una persona.", "enviado_por": "humano", "aprobacion_ref": "Persona Demo", "registrado_por": "seed-demo"}))
    tool("update-lead", L, "--set", "estado_pipeline=contactado", "--set", f"proximo_seguimiento={d2}", "--set", f"fecha_primer_contacto={TODAY}T11:00:00-06:00",
         "--set", "proxima_accion=[DEMO] Enviar seguimiento 1 por email")
    tool("add-followup", "--json", json.dumps({"lead_id": L, "fecha_programada": d2, "ventana_horaria": "10:00-13:00", "numero_seguimiento": 1, "canal": "email", "plantilla_id": "FU1-email"}))
    # medicentro: respondió y tiene reunión
    L = ids["medicentro"]
    for st in ("mensaje_borrador", "pendiente_aprobacion"):
        tool("update-lead", L, "--set", f"estado_pipeline={st}", *(["--set", "aprobacion_estado=pendiente"] if st == "pendiente_aprobacion" else []))
    tool("update-lead", L, "--set", "estado_pipeline=aprobado", "--set", "aprobado_por=Persona Demo", "--set", f"proximo_seguimiento={d1}")
    tool("update-lead", L, "--set", "estado_pipeline=contactado", "--set", f"proximo_seguimiento={d1}", "--set", f"fecha_primer_contacto={TODAY}T09:30:00-06:00",
         "--set", "proxima_accion=[DEMO] Revisar si respondió")
    tool("add-interaction", "--json", json.dumps({"lead_id": L, "canal": "email", "direccion": "entrante", "tipo": "respuesta_lead",
         "resumen": "[DEMO] Pide una llamada la próxima semana.", "enviado_por": "lead", "resultado": "respondido", "sentimiento": "positivo", "registrado_por": "seed-demo"}))
    tool("update-lead", L, "--set", "estado_pipeline=en_conversacion", "--set", f"proximo_seguimiento={d1}", "--set", "proxima_accion=[DEMO] Proponer horario de llamada")
    tool("update-lead", L, "--set", "estado_pipeline=reunion_agendada", "--set", f"proximo_seguimiento={d2}", "--set", "proxima_accion=[DEMO] Preparar demo de confirmación de citas")
    # dentalnorte: baja (demuestra exclusión irreversible)
    tool("suppress", "--lead", ids["dentalnorte"], "--motivo", "opt_out", "--fuente", "[DEMO] respondió 'no me interesa'")
    print(json.dumps({"demo": str(DEMO), "leads": ids, "en_revision": ["vetsur", "ortoplus"]}, ensure_ascii=False, indent=2))
    print(tool("validate", ok=False).stdout.strip())


if __name__ == "__main__":
    main()
