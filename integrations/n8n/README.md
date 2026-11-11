# n8n Community (autohospedado) — preparado, sin instancia conectada

Los workflows **solo leen datos, crean tareas internas o registran eventos** en la API de Web Wizards Sales OS. Ninguno envía mensajes, correos, WhatsApp ni formularios (verificado en `tests/worker/n8n_security.test.mjs`). Todos se importan **desactivados**.

## Workflows (`workflows/`)
| Archivo | Disparador | Qué hace |
|---|---|---|
| `01-nuevo-prospecto.json` | cada 15 min, horario laboral | Tarea «Revisar candidato» por cada prospecto que el motor deja en revisión |
| `02-investigacion-pendiente.json` | cada 2 h | Aviso si hay trabajos sin procesar >2 h (Mac apagado o investigador detenido) |
| `03-prospecto-calificado.json` | cada 30 min | Tarea «Preparar borrador» por cada lead A/B registrado |
| `04-borrador-generado.json` | cada 30 min | Tarea «Aprobar o pedir cambios» por cada borrador listo |
| `05-revision-humana.json` | días hábiles 9:00 | Resumen de candidatos pendientes de revisión |
| `06-seguimiento-pendiente.json` | días hábiles 9:00 | Tareas para seguimientos de hoy y vencidos |
| `07-reporte-diario.json` | días hábiles 19:00 | Registra el resumen del día como evento de auditoría |

Se regeneran con `python3 integrations/n8n/build_workflows.py`. Las tareas aparecen en el dashboard › Seguimientos › Tareas internas (las duplicadas abiertas se ignoran).

## Endpoints que usan (token `N8N_TOKEN`, cabecera `Authorization: Bearer …`)
Lectura: `/api/events`, `/api/summary`, `/api/followups`, `/api/review/pending`, `/api/drafts/pending`, `/api/jobs/pending`, `/api/prospecting`.
Escritura limitada: `POST /api/integrations/n8n/tasks`, `POST /api/integrations/n8n/event`.
El token de n8n **no** puede aprobar, dar de baja, registrar leads ni leer el CRM completo.

## Iniciar n8n en este Mac
1. Genera el token: `bin/ww token` → guárdalo como `N8N_TOKEN` en `.dev.vars` (y como secreto en Cloudflare si usas producción).
2. Crea `integrations/n8n/.env` (no versionado) a partir de `.env.example` de esta carpeta.
3. `bin/ww n8n` (Docker) o, sin Docker: `WW_API_BASE=http://127.0.0.1:8787 npx n8n`.
4. Abre http://localhost:5678, crea la credencial **Header Auth** llamada `WW Sales API` con nombre `Authorization` y valor `Bearer <N8N_TOKEN>`.
5. Importa los JSON de `workflows/`, revisa cada uno y actívalos manualmente.

`WW_API_BASE`: `http://host.docker.internal:8787` (n8n en Docker hablando con `bin/ww dev`) o `https://sales.webwizards.click` (producción, si se autoriza el despliegue).

Los archivos `wf-01-eventos-a-resumen.json` y `wf-02-recordatorio-seguimientos.json` de esta carpeta son de la versión anterior (servidor CSV) y se conservan como referencia.
