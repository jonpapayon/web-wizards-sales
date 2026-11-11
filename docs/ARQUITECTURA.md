# Arquitectura

## Producción (Cloudflare, preparada)

```
 Navegador ──HTTPS──► Worker ww-sales (cloudflare/src) ──► D1 ww-sales (migraciones 0001/0002: reglas en la base)
   (login)             · Static Assets: app/static (run_worker_first)        ▲
                       · /api/* sesión + CSRF + Origin/Host + rate limit       │ trabajos / resultados (WORKER_TOKEN)
                       · DENUE (DENUE_TOKEN, caché en D1)                       │
 Mac ── bin/ww investigator (Playwright solo lectura, OSM) ─────────────────────┘
 Mac ── n8n Community (N8N_TOKEN: lectura + tareas + eventos)
```
- Mismas reglas que `crm_tool.py` (mismo `crm.schema.json`) + segunda barrera en SQL (triggers: bajas irreversibles, exclusión y auditoría solo de anexado, transiciones, identidad inmutable; índices únicos anti-duplicados).
- Local: `bin/ww dev` ejecuta el mismo Worker con D1 emulado (`dev/d1_shim.mjs`, node:sqlite).
- Migración: `scripts/d1_migrate.py` (seed, aplicar, reconciliar, exportar de vuelta a CSV).
- Elegimos Workers Static Assets en lugar de Pages: es el sucesor recomendado por Cloudflare, también gratuito, y permite que la autenticación proteja todo el sitio desde el mismo Worker. Si se prefiere Pages, `app/static` se puede publicar como proyecto de Pages y el Worker en la ruta `/api/*`.

## Modo local clásico (CSV)

```
             Claude Code (investigación y redacción)                       Persona (navegador)
  lead-researcher ─► lead-qualifier ─► outreach-writer ─► compliance-reviewer        │
        │ dossier + JSON en data/staging/         │ borradores en data/outreach/      │ http://127.0.0.1:8765
        ▼                                         ▼                                   ▼
  ┌───────────────────────────────────────────────────────────────────────────────────────────┐
  │ app/server.py  (Python estándar, solo 127.0.0.1)                                           │
  │  · GET: lee CSV, dossiers, evidencias, borradores, auditoría                              │
  │  · POST (token de sesión + Origin/Host): invoca scripts/crm_tool.py — no escribe por su cuenta│
  │  · sin endpoints de envío; DELETE/PUT/PATCH → 405                                          │
  └───────────────────────────────┬───────────────────────────────────────────────────────────┘
                                  ▼
  scripts/crm_tool.py  ── única vía de escritura (CLI, dashboard, subagentes) ──► data/crm/*.csv
     esquema data/schema/crm.schema.json · duplicados · exclusiones · transiciones · aprobación humana
     · días inhábiles · confianza de evidencia · auditoría data/crm/audit.jsonl (= eventos para n8n)

  research/  (motor propio, red desactivada por defecto)  fetch.py (GET/HEAD, robots.txt) · site_audit.py · discover.py (OSM/DENUE/Places)
  integrations/n8n/  workflows importables (solo lectura de /api/events y /api/followups)
```

## Decisiones técnicas

| Decisión | Motivo |
|---|---|
| Python estándar + HTML/CSS/JS propios (sin Next.js/npm) | El proyecto ya era Python estándar; instalar paquetes está bloqueado por las protecciones y añadiría riesgo de cadena de suministro; un solo comando para iniciar. |
| CSV + `crm_tool.py` como fuente de verdad (sin SQLite por ahora) | Conserva las garantías ya probadas, incluida la bandera de sistema operativo «solo anexado» sobre la lista de exclusión, que SQLite no ofrece. Migración posible en la etapa 3 del ROADMAP con las mismas reglas. |
| Escrituras del dashboard vía subproceso `crm_tool.py` | Una sola implementación de las reglas: imposible que el dashboard sea más permisivo que la CLI. |
| Eventos en modo «pull» (`GET /api/events`) | El sistema nunca inicia conexiones salientes; n8n consulta. |
| Modo demo en carpeta separada `demo/` | Datos ficticios jamás mezclados con los reales (otra raíz `WW_ROOT`). |

## Estructura de carpetas

```
app/                 server.py (API + estáticos), seed_demo.py, static/ (index.html, app.js, styles.css)
config/sales_os.json configuración operativa editable (objetivo diario, nichos, ciudades)
data/crm/            leads.csv, interactions.csv, followups.csv, suppression.csv (solo anexado), audit.jsonl
data/research/       <lead_id>.md (dossier) + <lead_id>.evidence.json (evidencia estructurada)
data/staging/<fecha> candidatos en revisión; procesados/ y rechazados/ conservan el historial
data/outreach/       borradores <lead_id>-inicial.md (versionados, con trazabilidad y dictamen)
data/exports/        exportaciones del CRM
data/schema/         crm.schema.json (reglas de máquina)
demo/                datos ficticios (regenerables)
docs/                documentación
integrations/n8n/    workflows importables y guía
policies/            bajas, consentimiento, cadencias (fuentes únicas)
research/            motor de investigación (solo lectura, red desactivada por defecto)
scripts/             crm_tool.py, hooks/guard.py, tests/test_guard.py
templates/           plantillas de dossier, calificación, mensajes y reportes
tests/               pruebas automáticas (CRM, API, investigación, seguridad, interfaz)
workflows/           pipeline diario, reglas de aprobación, protecciones, cumplimiento
backups/             copias locales antes de cambios estructurales
```

## Modelo de datos

Definido en `data/schema/crm.schema.json` (legible en `data/crm-schema.md`): lead, interacción, seguimiento, supresión, candidato y evidencia. Novedades de esta versión:
- `evidencia.confianza` (alta/media/baja). Una señal solo con evidencia «baja» no puntúa: el candidato queda **pendiente de revisión**.
- Clase A/B sin ningún canal de contacto verificado se rechaza (pendiente de revisión).
- `x-dias-inhabiles-extra` para jornadas electorales; domingos y art. 74 LFT se calculan.
- `audit.jsonl`: cada escritura con actor, antes/después y entorno.

## Seguridad (resumen; detalle en workflows/guardrails.md)

| Capa | Qué protege |
|---|---|
| Permisos de Claude Code (`.claude/settings.json`) | Bloquea envío (Gmail, curl, osascript…), formularios (Playwright), escritura directa al CRM; pide aprobación para tocar protecciones, servidor y motor de red. |
| Hook `scripts/hooks/guard.py` | Igual para la sesión y los subagentes, incluso con variantes de comandos. |
| `crm_tool.py` | Reglas de negocio: duplicados, exclusiones, transiciones, aprobación humana, bajas irreversibles, días inhábiles. |
| Servidor | Solo 127.0.0.1, verificación de Host y Origin, token por sesión, CSP estricta, sin endpoints de envío ni de borrado. |
| Sistema operativo | `chflags uappnd` en `suppression.csv` (y recomendado en `audit.jsonl`). |
| `research/fetch.py` | Solo GET/HEAD, robots.txt, sin destinos privados, desactivado por defecto. |
