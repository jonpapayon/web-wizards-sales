# Protecciones técnicas — qué se bloquea de verdad y qué no

Fuente única sobre las restricciones técnicas del proyecto. Una regla escrita en un documento **no** es una restricción. Aquí se distingue lo que el sistema impide de lo que depende del comportamiento del modelo.

Probado en Claude Code **2.1.322** (`claude --version`).

## Capas

| Capa | Archivo | Qué hace | Fuerza |
|---|---|---|---|
| 1. Permisos | `.claude/settings.json` → `permissions` | `deny`, `ask` y `allow` que evalúa Claude Code antes de cada herramienta (orden: deny → ask → allow). | Alta para herramientas integradas y MCP. Para Bash solo compara el texto del comando. |
| 2. Hook PreToolUse | `scripts/hooks/guard.py`, declarado en `settings.json` con `onFailure: "block"` | Inspecciona cada Write/Edit/Bash/Playwright, en la sesión principal **y en los subagentes**, y decide deny o ask. Si el hook falla, la acción se bloquea. | Media-alta: cubre variantes que las reglas de texto no ven (rutas absolutas, `python -c`, redirecciones, `cd`). |
| 3. Herramienta del CRM | `scripts/crm_tool.py` | Única vía de escritura: esquema, duplicados, supresión, transiciones, aprobación humana, coherencia de la calificación, sin reactivación de bajas. | Alta para todo lo que pase por ella. |
| 4. Sistema operativo | `chflags uappnd data/crm/suppression.csv` | macOS solo permite anexar: no se puede sobrescribir, truncar, renombrar ni borrar el archivo. | Alta: aplica a cualquier proceso del usuario hasta que alguien quite la bandera (y `chflags` está bloqueado para el agente). Recomendado también para `data/crm/audit.jsonl` (lo ejecuta una persona). |
| 5. Dashboard y API (`app/server.py`) | Servidor local | Solo 127.0.0.1; verificación de Host (anti DNS-rebinding) y Origin; token por sesión en cada POST; CSP `default-src 'self'`; sin endpoints de envío ni de borrado (DELETE/PUT/PATCH → 405); toda escritura vía `crm_tool.py`; aprobar exige nombre de persona y nunca crea interacciones salientes. Editar el servidor requiere aprobación (`ask`). | Alta para la interfaz. Cualquier proceso local puede leer los GET (sin datos secretos). |
| 6. Motor de investigación (`research/fetch.py`) | Cliente HTTP | Desactivado salvo `WW_RESEARCH_NETWORK=1`; solo GET/HEAD; robots.txt; sin destinos privados ni credenciales en la URL. Además, Claude Code bloquea ejecutar red por consola sin permiso explícito (comprobado: el clasificador de permisos denegó una prueba de red el 2026-11-11). Editarlo requiere aprobación. | Alta mientras siga desactivado. |

| 7. Worker + D1 (`cloudflare/`) | Producción (`sales.webwizards.click`) | Login obligatorio (PBKDF2, sesión HttpOnly/SameSite=Strict/Secure, CSRF, Origin/Host, límites de intentos), tokens de máquina con ámbito (investigador, n8n, eventos, agente) sin permiso para aprobar, enviar ni dar de baja; reglas duplicadas en SQL (triggers). Única salida de red: DENUE y claves de Cloudflare Access. | Alta; verificado con `node --test tests/worker/`. |
| 7b. Agente remoto (`scripts/ww_remote.py` + `AGENT_TOKEN`) | Única vía de red autorizada para Claude desde la consola (autorizada por el usuario el 2026-11-11) | Solo HTTPS a `sales.webwizards.click` (o 127.0.0.1 en pruebas); solo sube archivos de `data/staging`, `data/research`, `data/outreach`; nunca imprime el token. El Worker limita el ámbito «agente»: lee campos de leads para deduplicar, sube/registra candidatos validados, sube dossiers y borradores, recalifica con la misma coherencia que `crm_tool.py` y mueve solo a `mensaje_borrador`, `pendiente_aprobacion` o `descartado`. No puede aprobar, registrar contactos ni bajas, ni leer exclusiones, sesiones o auditoría. | Alta en el Worker (pruebas `agente` en `tests/worker/` y `RemoteAgent` en `tests/test_investigator.py`). El token lo crea una persona. |
| 8. Investigador del Mac (`research/investigator.py`) | Playwright | Aborta en el navegador toda petición que no sea GET/HEAD; sin clics ni escritura; respeta robots.txt. | Alta para formularios; depende de que se ejecute la versión del repositorio. |
| 9. Datos locales de producción | `data/d1/`, `cloudflare/seed/`, `.dev.vars` | `deny` de edición y lectura de secretos + hook; despliegue con `wrangler` bloqueado para el agente. | Alta. |

Pruebas que lo verifican: `python3 tests/run_all.py` (CRM, API, seguridad estática, motor sin red, renderizado de la interfaz) y `python3 scripts/tests/test_guard.py` (hook).

## Matriz de requisitos

| Requisito | Estado | Cómo |
|---|---|---|
| Investigar, calificar, redactar borradores | ✅ Permitido | `allow`: WebSearch, WebFetch, edición en `data/research`, `data/staging`, `data/outreach`, `data/reports`. |
| Registrar leads con validación | ✅ Permitido solo validado | En producción: `ww_remote.py register` (el Worker valida esquema, duplicados, exclusiones y calificación). Local: `Edit(/data/crm/**)` en `deny` + hook; `crm_tool.py add-lead` valida. |
| Enviar mensajes | ⛔ Bloqueado | No hay herramientas de envío conectadas; Gmail MCP en `deny`; el hook bloquea curl, wget, sendmail, mail, osascript (Mail/Messages), open (mailto, whatsapp://), gh, git push, smtplib y requests.post. El dashboard tiene «Abrir en WhatsApp» (desde 2026-11-13, autorizado por una persona): solo para leads `aprobado` con `whatsapp_publico` completo, pide confirmar la verificación previa y abre un enlace `wa.me` con el texto escrito; la persona revisa y presiona Enviar en su WhatsApp y después registra el envío con «Marcar como enviado». El sistema no envía ni confirma el envío. |
| Llenar formularios | ⛔ Bloqueado | Playwright: clic, escritura, formularios, selección, teclas, subida de archivos, diálogos y JS en `deny` + hook. Solo navegación, captura y lectura. |
| Modificar o eliminar la lista de exclusión | ⛔ Bloqueado | Capas 1, 2 y 4; `crm_tool.py` solo anexa. |
| Reactivar contactos dados de baja | ⛔ Bloqueado | `crm_tool.py` rechaza cualquier cambio a leads con `opt_out` o claves suprimidas, y su nuevo registro. |
| Cambiar protecciones, políticas, esquema o reglas de aprobación | ⚠️ Requiere persona | `ask` en `.claude/**`, `scripts/**`, `policies/**`, `data/schema/**`, `workflows/approval-rules.md`, este archivo y `CLAUDE.md`; el hook también responde `ask`. |
| Acciones en servicios externos (Cloudflare, Vercel, Figma, Calendar) | ⛔ Bloqueado | Servidores MCP en `deny`. |
| Instalar dependencias | ⛔ Bloqueado | Hook + `deny` (pip, npm, brew, etc.). |

## Verificación
- `python3 scripts/tests/test_guard.py` — 40 casos del hook (deny, ask y permitido).
- `python3 scripts/crm_tool.py validate` — integridad del CRM y presencia de la bandera `uappnd`.
- Pruebas en vivo hechas en esta sesión: ver el informe del piloto, `data/reports/piloto-puebla-2026-11-11.md`.

## Limitaciones conocidas (riesgo residual)
1. **Bash no es analizable por completo.** El hook usa patrones: un comando ofuscado a propósito (codificado en base64, construido por concatenación) podría eludirlo. La defensa es contra errores del agente, no contra un atacante. La lista de exclusión queda protegida aun así por la capa 4.
2. **Las páginas que ya visitó WebFetch o Playwright son solo de lectura**, pero navegar a una URL con parámetros podría disparar una acción en un sitio mal diseñado. Mitigación: la investigación solo abre URLs públicas de fichas y sitios.
3. **Las protecciones viven en este proyecto.** Una sesión de Claude Code abierta en otra carpeta, o con `--dangerously-skip-permissions`/`bypassPermissions`, no las tiene. Los hooks siguen activos en modo bypass, pero los `ask` no.
4. **Una persona puede quitar la bandera** (`chflags nouappnd`), lo cual es necesario para atender una solicitud ARCO.
5. **La aprobación humana se registra por texto.** `crm_tool.py` rechaza nombres de agentes en `aprobado_por`, pero no puede verificar identidad. La garantía real es que el envío lo hace una persona.
6. **El Artifact tool y Claude Docs** (publicar páginas y documentos privados) no están bloqueados; no envían mensajes a prospectos.
