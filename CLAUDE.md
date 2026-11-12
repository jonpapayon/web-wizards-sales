# Web Wizards Sales Agent

Sistema de prospección comercial B2B para **Web Wizards**, empresa de servicios digitales en México:

- Desarrollo y rediseño de sitios web.
- Automatización de procesos empresariales.
- Integración de WhatsApp (botones, catálogo, respuestas automáticas, agenda, WhatsApp Business Cloud API).

Mercado inicial: PyMEs en México. Nichos prioritarios, en este orden: clínicas y consultorios, dentistas, estéticas y spas, veterinarias.

Idioma de trabajo: **español de México**, en archivos, mensajes y reportes.

---

## Fuentes únicas de verdad

Cada tema vive en **un solo archivo**. Los demás documentos remiten a él y no repiten sus reglas. Si dos documentos parecen contradecirse, manda la fuente de esta tabla.

| Tema | Fuente única |
|---|---|
| Bajas (opt-out), irreversibilidad, frases de baja | `policies/opt-out.md` |
| Consentimiento y reglas por canal | `policies/consent.md` |
| Cadencia, horarios y límites de contacto | `policies/contact-cadence.md` |
| Estados, transiciones, enums, puntos de señales, reglas A/B/C | `data/schema/crm.schema.json` (legible en `data/crm-schema.md`) |
| Rúbrica de calificación | `.claude/skills/lead-qualification/SKILL.md` |
| Acciones automáticas permitidas | `workflows/approval-rules.md` |
| Protecciones técnicas y sus límites | `workflows/guardrails.md` |
| Privacidad y marco legal | `workflows/compliance.md` |

---

## Objetivo operativo

Meta: **30 leads calificados (A o B) por día**, sin duplicados, con fuente y fecha en cada lead y sin datos inventados. Un lead cuenta como calificado solo si es A o B según `x-clasificacion` del esquema, lo que exige al menos un canal verificado y al menos una señal con evidencia.

## Flujo del sistema

```
lead-research ─► lead-qualification ─► crm_tool add-lead ─► personalized-outreach ─► compliance-reviewer ─► [APROBACIÓN HUMANA] ─► envío por una persona ─► follow-up
   (dossier + staging)     (calificación)      (validación)          (borrador)                                                         (registro con crm_tool)
```

La **sesión principal** orquesta: lanza subagentes, recoge sus resultados y ejecuta `scripts/crm_tool.py`. Los subagentes no se llaman entre sí. El procedimiento diario está en `workflows/daily-pipeline.md`.

## Mapa del proyecto

| Ruta | Contenido |
|---|---|
| `policies/` | Políticas canónicas de bajas, consentimiento y cadencia. |
| `.claude/skills/<skill>/SKILL.md` | Procedimientos de cada etapa (5 skills). |
| `.claude/agents/*.md` | Subagentes especializados. |
| `.claude/settings.json` | Permisos y hook de protección (Claude Code). |
| `scripts/crm_tool.py` | **Única vía de escritura al CRM**; valida esquema, duplicados, supresión, transiciones y aprobaciones. |
| `scripts/hooks/guard.py` | Hook que bloquea envíos, red saliente y escritura directa al CRM. |
| `scripts/tests/test_guard.py` | Pruebas del hook. |
| `data/crm-schema.md`, `data/schema/crm.schema.json` | Diccionario y esquema del CRM. |
| `data/crm/*.csv` | CRM local (leads, interacciones, seguimientos, supresión). |
| `data/staging/AAAA-MM-DD/` | Candidatos investigados pendientes de registrar. |
| `data/research/` | Dossier por lead. |
| `data/outreach/` | Borradores de mensajes. |
| `data/reports/` | Reportes diarios. |
| `templates/` | Plantillas de investigación, calificación, mensajes y reportes. |
| `workflows/` | Pipeline diario, reglas de aprobación, protecciones, cumplimiento e integraciones futuras. |
| `app/` | Dashboard local: `server.py` (API en 127.0.0.1; escribe solo vía `crm_tool.py`), `static/` (interfaz), `seed_demo.py`. |
| `research/` | Motor de investigación de solo lectura (OSM, auditoría de sitios). Red desactivada salvo autorización. |
| `config/sales_os.json` | Objetivo diario, nichos y ciudades (editable desde el dashboard; no son políticas). |
| `data/research/<lead_id>.evidence.json` | Evidencia estructurada con `confianza` y verificaciones. |
| `data/crm/audit.jsonl` | Auditoría de cada escritura; fuente de `GET /api/events`. |
| `demo/` | Datos ficticios para el modo demo (nunca mezclar con `data/`). |
| `integrations/n8n/` | Workflows importables (solo lectura de eventos). |
| `tests/` | Pruebas automáticas: `python3 tests/run_all.py`. |
| `docs/`, `README.md`, `ROADMAP.md` | Operación, arquitectura, integraciones y etapas. |

## Reglas inviolables

1. **No inventar datos.** Todo dato del negocio proviene de una fuente pública con URL y fecha. Si no se encontró, el campo queda vacío y se lista en `campos_no_encontrados`. Nunca se completa un número, se adivina un correo ni se deduce un servicio.
2. **Sin duplicados.** `crm_tool.py add-lead` rechaza duplicados; para datos nuevos de un lead existente se usa `update-lead`.
3. **Fuente y fecha siempre** en cada lead y en cada evidencia.
4. **Solo señales verificables.** Sin evidencia observable, la señal no suma.
5. **Personalización real.** Cada mensaje cita un hecho verificado del negocio y tiene tabla de trazabilidad.
6. **Clasificación A/B/C** según la rúbrica; `crm_tool.py` rechaza clasificaciones que no coinciden con los puntos.
7. **Registrar todo** con `crm_tool.py`: interacciones, cambios de estado, aprobaciones.
8. **Bajas inmediatas e irreversibles** según `policies/opt-out.md`.
9. **Cumplimiento**: `policies/consent.md` y `workflows/compliance.md`.
10. **Sin secretos en el repositorio.** Nunca crear, pedir que se peguen ni guardar tokens, contraseñas o API keys.

## Matriz de autonomía

| Acción | Autonomía | Control técnico |
|---|---|---|
| Investigar, analizar, calificar, redactar borradores | ✅ Sin autorización individual | Permitido en `settings.json` |
| Registrar y actualizar leads | ✅ Con validación | Solo vía `crm_tool.py` |
| Registrar bajas | ✅ Obligatorio, inmediato | `crm_tool.py suppress` |
| Responder o dar seguimiento | ⚠️ Solo con regla activa e integración autorizada | Hoy ninguna regla está activa |
| **Enviar mensajes iniciales o llenar formularios** | ⛔ Solo una persona, tras aprobación | Bloqueado: hook + `deny` |
| Modificar o eliminar la lista de exclusión | ⛔ Prohibido | Bloqueado: hook + `deny` + bandera `uappnd` |
| Reactivar contactos dados de baja | ⛔ Prohibido | `crm_tool.py` lo rechaza |
| Pagos, contrataciones, cambios de cuentas | ⛔ Prohibido sin autorización explícita | MCP de servicios externos denegados |
| Prometer precios, descuentos, plazos o resultados | ⛔ Escalar a una persona | Revisión de cumplimiento |
| Cambiar protecciones, políticas, esquema o reglas de aprobación | ⛔ Requiere persona | Regla `ask` + hook |

Una regla escrita no es una restricción técnica: lo que realmente se bloquea, y sus límites, está en `workflows/guardrails.md`.

## Escalar a una persona cuando

- El lead pide precio, cotización, reunión o llamada.
- Hay una pregunta técnica fuera de `templates/outreach/response-playbook.md`.
- Hay queja, tema legal o mención de datos personales.
- Se detecta que el negocio ya es cliente, socio o competidor.

## Convenciones

- Fechas ISO 8601 con zona horaria; zona del lead en `zona_horaria`.
- Teléfonos: texto literal en `telefono_publico`; E.164 (`+52` + 10 dígitos) en `telefono_e164` solo si el número publicado está completo.
- IDs (`WW-`, `INT-`, `FU-`) los asigna `crm_tool.py`.

## Arquitectura de producción (en producción desde 2026-11-11)

- `cloudflare/` Worker (API + dashboard), `cloudflare/migrations/` esquema D1, `wrangler.toml`. Estado, pasos y lecciones: `docs/DESPLIEGUE.md`. Nunca ejecutar `wrangler` (bloqueado): los comandos los corre una persona.
- CRM en `https://sales.webwizards.click` (Worker, dominio personalizado) con D1 `ww-sales` (WNAM); `workers_dev = false`. La landing `webwizards.click`/`www` es otro proyecto (Next.js en Vercel, repo `web-wizards-v2`): no se toca desde aquí.
- DNS de `webwizards.click` en Cloudflare (dominio registrado en Namecheap). Cualquier cambio DNS, de dominio o de ruta requiere autorización expresa; la prueba de `tests/worker/n8n_security.test.mjs` solo admite la ruta `sales.webwizards.click`.
- D1 es la fuente principal. Sincronización (procedimiento en `docs/DESPLIEGUE.md`): una persona exporta D1 → `crm_tool.py pull-d1` (dashboard → local) → `d1_migrate.py delta` (altas locales → D1) → una persona aplica el delta. Hacer `pull-d1` **antes** de trabajar en local. Rangos de IDs: local WW 001–499 e INT/FU 0001–4999; Worker 500+/5000+.
- D1 limita `LIKE`/`GLOB` a 50 caracteres: toda migración nueva debe pasar `tests/test_migration.py › D1Compat`. La CSP del Worker bloquea atributos `style`: en `app/static/` usar `el.style`, nunca `setAttribute("style")` ni estilos en línea.
- `dev/` ejecuta el Worker en local con D1 emulado: `bin/ww dev`. `data/d1/` y `cloudflare/seed/` contienen datos del CRM: no se editan a mano.
- `research/investigator.py` (Mac, Playwright solo lectura), `cloudflare/src/denue.js` (INEGI), `integrations/n8n/` (7 workflows).
- Pruebas: `bin/ww test` (Python + `node --test tests/worker/`).

## Fase actual

Etapas 1 y 2 del `ROADMAP.md` completadas: CRM validado y dashboard local (`python3 app/server.py`, http://127.0.0.1:8765, o `bin/ww dev`, http://127.0.0.1:8787). CRM en producción en Cloudflare (ver arriba). Sin integraciones externas conectadas ni envíos.

Reglas para trabajar en el sistema:
- Remitente por defecto en borradores: "equipo comercial de Web Wizards". Nunca afirmar experiencia o clientes previos no demostrados.
- Evidencia: indicar `confianza` (alta: HTML crudo o navegador; media: WebFetch; baja: fragmento de buscador). Lo leído con WebFetch es confianza media y requiere confirmación humana en navegador antes de enviar.
- Antes de dar por terminado un cambio de código: `python3 tests/run_all.py`.
- La red por consola está bloqueada; la investigación en vivo usa los subagentes (WebSearch/WebFetch). Activar `research/` con red requiere autorización explícita de una persona.
