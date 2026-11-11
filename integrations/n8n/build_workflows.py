#!/usr/bin/env python3
"""Genera los workflows importables de n8n (integrations/n8n/workflows/*.json).
Todos usan la credencial "WW Sales API" (Header Auth: Authorization = Bearer <N8N_TOKEN>) y la variable WW_API_BASE.
Solo LEEN datos, CREAN TAREAS internas o REGISTRAN EVENTOS. Ningún nodo envía mensajes, correos ni formularios.
    python3 integrations/n8n/build_workflows.py"""
import json
from pathlib import Path

OUT = Path(__file__).resolve().parent / "workflows"
BASE = "={{ ($env.WW_API_BASE || 'http://host.docker.internal:8787') }}"
CRED = {"httpHeaderAuth": {"id": "", "name": "WW Sales API"}}


def sched(cron, name):
    return {"parameters": {"rule": {"interval": [{"field": "cronExpression", "expression": cron}]}}, "name": name,
            "type": "n8n-nodes-base.scheduleTrigger", "typeVersion": 1.2, "position": [0, 0]}


def get(name, path, x, query=None):
    p = {"url": f"{BASE}{path}", "authentication": "genericCredentialType", "genericAuthType": "httpHeaderAuth", "options": {}}
    if query:
        p["sendQuery"] = True
        p["queryParameters"] = {"parameters": [{"name": k, "value": v} for k, v in query.items()]}
    return {"parameters": p, "name": name, "type": "n8n-nodes-base.httpRequest", "typeVersion": 4.2, "position": [x, 0], "credentials": CRED}


def post(name, path, x, body_expr):
    return {"parameters": {"method": "POST", "url": f"{BASE}{path}", "authentication": "genericCredentialType", "genericAuthType": "httpHeaderAuth",
                           "sendBody": True, "specifyBody": "json", "jsonBody": body_expr, "options": {}},
            "name": name, "type": "n8n-nodes-base.httpRequest", "typeVersion": 4.2, "position": [x, 0], "credentials": CRED}


def code(name, js, x):
    return {"parameters": {"jsCode": js}, "name": name, "type": "n8n-nodes-base.code", "typeVersion": 2, "position": [x, 0]}


def chain(name, nodes, note):
    conns = {nodes[i]["name"]: {"main": [[{"node": nodes[i + 1]["name"], "type": "main", "index": 0}]]} for i in range(len(nodes) - 1)}
    return {"name": name, "nodes": nodes, "connections": conns, "settings": {"timezone": "America/Mexico_City", "executionOrder": "v1"},
            "active": False, "meta": {"nota": note}}


CURSOR = "const s = $getWorkflowStaticData('global'); return [{ json: { since: s.cursor || '' } }];"
SAVE = ("const ev = $json.eventos || []; const s = $getWorkflowStaticData('global'); if (ev.length) s.cursor = ev[ev.length-1].ts;\n"
        "const want = new Set(%s);\nreturn ev.filter(e => want.has(e.evento)).map(e => ({ json: e }));")
TASK = "={{ JSON.stringify({ tipo: '%s', lead_id: $json.lead_id || '', titulo: %s, detalle: %s }) }}"

WF = {
    "01-nuevo-prospecto": chain("WW · 01 · Nuevo prospecto → tarea de revisión", [
        sched("*/15 9-18 * * 1-6", "Cada 15 min (horario laboral)"), code("Cursor", CURSOR, 200),
        get("Eventos", "/api/events", 400, {"since": "={{ $json.since }}", "limit": "500"}),
        code("Prospectos nuevos en revisión", SAVE % "['prospecto.nuevo']" + ".filter(i => i.json.detalle.estado === 'revision')", 600),
        post("Crear tarea", "/api/integrations/n8n/tasks", 800, TASK % ("revisar_candidato", "'Revisar candidato: ' + $json.detalle.nombre", "'Clase propuesta ' + $json.detalle.clase_propuesta + ' (' + $json.detalle.puntaje + ' pts). Candidato ' + $json.entidad")),
    ], "Crea una tarea interna por cada prospecto que el motor deja en revisión."),
    "02-investigacion-pendiente": chain("WW · 02 · Investigación pendiente → aviso interno", [
        sched("0 */2 * * 1-6", "Cada 2 h"), get("Trabajos pendientes", "/api/jobs/pending", 200),
        code("¿Atascados?", "const t = $json.trabajos || []; const viejos = t.filter(j => j.estado === 'pendiente' && (Date.now() - new Date(j.creado_en.replace(/-06:00$/, '-06:00')).getTime()) > 2*3600e3);\nreturn viejos.length ? [{ json: { n: viejos.length } }] : [];", 400),
        post("Crear tarea", "/api/integrations/n8n/tasks", 600, TASK % ("investigacion", "'Hay ' + $json.n + ' trabajos de investigación esperando al investigador del Mac'", "'Enciende el Mac y ejecuta: bin/ww investigator'")),
    ], "Avisa si hay trabajos de investigación sin procesar hace más de 2 horas (el Mac está apagado o el investigador detenido)."),
    "03-prospecto-calificado": chain("WW · 03 · Prospecto calificado → preparar borrador", [
        sched("*/30 9-18 * * 1-6", "Cada 30 min"), code("Cursor", CURSOR, 200),
        get("Eventos", "/api/events", 400, {"since": "={{ $json.since }}", "limit": "500"}),
        code("Registrados A/B", SAVE % "['lead.registrado']" + ".filter(i => ['A','B'].includes(i.json.detalle.clasificacion)).map(i => ({ json: { ...i.json, lead_id: i.json.entidad } }))", 600),
        post("Crear tarea", "/api/integrations/n8n/tasks", 800, TASK % ("otro", "'Preparar borrador: ' + $json.detalle.nombre", "'Lead ' + $json.entidad + ' clase ' + $json.detalle.clasificacion + ' (' + $json.detalle.puntaje + ' pts). Pedir a Claude Code: prepara el borrador de ' + $json.entidad")),
    ], "Tarea para preparar el borrador de cada lead A/B recién registrado."),
    "04-borrador-generado": chain("WW · 04 · Borrador listo → aprobación humana", [
        sched("*/30 9-18 * * 1-6", "Cada 30 min"), code("Cursor", CURSOR, 200),
        get("Eventos", "/api/events", 400, {"since": "={{ $json.since }}", "limit": "500"}),
        code("Borradores listos", SAVE % "['borrador.listo']" + ".map(i => ({ json: { ...i.json, lead_id: i.json.entidad } }))", 600),
        post("Crear tarea", "/api/integrations/n8n/tasks", 800, TASK % ("aprobar_borrador", "'Aprobar o pedir cambios: ' + $json.entidad", "'Dashboard › Mensajes. Aprobar NO envía: autoriza el uso manual del borrador.'")),
    ], "Tarea de aprobación humana por cada borrador que pasa a pendiente de aprobación."),
    "05-revision-humana": chain("WW · 05 · Resumen de revisión humana (9:00)", [
        sched("0 9 * * 1-6", "Días hábiles 9:00"), get("Candidatos en revisión", "/api/review/pending", 200),
        code("Resumen", "const c = ($json.candidatos || []).length; return c ? [{ json: { c } }] : [];", 400),
        post("Crear tarea", "/api/integrations/n8n/tasks", 600, TASK % ("revisar_candidato", "'Revisión del día: ' + $json.c + ' candidatos esperan'", "'Dashboard › Investigación › Área de revisión'")),
    ], "Una tarea diaria con el número de candidatos pendientes de revisión."),
    "06-seguimiento-pendiente": chain("WW · 06 · Seguimientos de hoy y vencidos (9:00)", [
        sched("0 9 * * 1-6", "Días hábiles 9:00"), get("Seguimientos", "/api/followups", 200),
        code("Hoy y vencidos", "const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });\nreturn ($json.proximas || []).filter(a => a.vencido || a.fecha === hoy).map(a => ({ json: a }));", 400),
        post("Crear tarea", "/api/integrations/n8n/tasks", 600, TASK % ("seguimiento", "($json.vencido ? 'VENCIDO: ' : 'Hoy: ') + $json.negocio + ' — ' + $json.accion", "'Lo realiza una persona. El sistema no envía mensajes.'")),
    ], "Tareas de seguimiento para hoy y vencidos. Las tareas duplicadas abiertas se ignoran en la API."),
    "07-reporte-diario": chain("WW · 07 · Reporte diario (19:00)", [
        sched("0 19 * * 1-6", "Días hábiles 19:00"), get("Resumen", "/api/summary", 200),
        post("Registrar evento", "/api/integrations/n8n/event", 400, "={{ JSON.stringify({ evento: 'reporte_diario', entidad: 'sistema', detalle: { kpis: $json.kpis, objetivo: $json.objetivo } }) }}"),
    ], "Registra el resumen del día como evento de auditoría (visible en el dashboard)."),
}

OUT.mkdir(parents=True, exist_ok=True)
for name, wf in WF.items():
    (OUT / f"{name}.json").write_text(json.dumps(wf, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(f"{len(WF)} workflows en {OUT}")
