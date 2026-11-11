---
name: follow-up
description: Gestiona los seguimientos de leads contactados - programa la cadencia, prepara borradores de seguimiento, clasifica respuestas entrantes, propone contestaciones, aplica bajas y escala a una persona. No envía nada mientras no haya reglas activas e integraciones autorizadas. Úsalo para la rutina diaria de seguimiento y para procesar respuestas de prospectos.
when_to_use: Frases como "seguimientos de hoy", "programa la cadencia de WW-...", "respondió este lead, ¿qué le contesto?", "procesa las respuestas", "qué leads están vencidos".
argument-hint: "[hoy | programar <lead_id> | respuesta <lead_id> | vencidos]"
---

# Follow-up

Fuentes que este skill aplica, sin repetirlas:
- Cadencia, horarios, límites y cierre: `policies/contact-cadence.md`.
- Bajas: `policies/opt-out.md`.
- Consentimiento por canal: `policies/consent.md`.
- Acciones automáticas permitidas: `workflows/approval-rules.md` (hoy ninguna regla está activa).
- Textos: `templates/outreach/follow-up-messages.md` y `templates/outreach/response-playbook.md`.

Todas las escrituras del CRM se hacen con `scripts/crm_tool.py` (ver skill `crm-management`). Si este skill corre dentro del subagente `follow-up-manager`, el subagente no tiene Bash: devuelve los comandos a la sesión principal para que los ejecute.

## Modo de envío
| Situación | Acción |
|---|---|
| Ninguna regla activa (fase actual) | Borrador → seguimiento en `pendiente_aprobacion` → una persona aprueba y envía. |
| Regla activa que cubre exactamente el caso **e** integración autorizada | Envío por la integración, registrado con `regla_aplicada`. |
| Caso no cubierto | Borrador y escalamiento a una persona. |

## 1. Programar cadencia (`programar <lead_id>`)
Cuando se registra un `mensaje_inicial` enviado, crear los seguimientos que correspondan al canal según `policies/contact-cadence.md` §1 (fechas en días hábiles, hora local, sin festivos) con `add-followup`. Actualizar `proximo_seguimiento` del lead con la fecha del primero.

## 2. Rutina diaria (`hoy`)
1. Listar seguimientos con `fecha_programada ≤ hoy` y estado `programado` o `borrador_listo`.
2. Antes de redactar, comprobar en el CRM: sin baja, sin supresión, sin respuesta nueva desde el último envío y lead todavía `contactado`. Si algo falla, `update-followup <id> --estado cancelado --nota "<motivo>"`.
3. Redactar `data/outreach/<lead_id>-fu<N>.md` desde la plantilla, con un hecho nuevo verificado del dossier.
4. `update-followup <id> --estado pendiente_aprobacion`.
5. Cuando una persona confirme el envío: `update-followup <id> --estado enviado`, registrar la interacción y actualizar `num_seguimientos` y `proximo_seguimiento`.
6. Aplicar el cierre por falta de respuesta y los vencidos según `policies/contact-cadence.md`.

## 3. Procesar respuesta (`respuesta <lead_id>`)
1. Registrar la interacción entrante (`add-interaction`). Cancelar los seguimientos programados restantes.
2. **Primero comprobar si es baja** según `policies/opt-out.md` §1, antes de cualquier otra clasificación. Si lo es → `suppress` inmediatamente.
3. Si no lo es, clasificar la intención con `templates/outreach/response-playbook.md` y preparar la respuesta o escalar.
4. Programar `proximo_seguimiento` según `policies/contact-cadence.md` §3.

## 4. Leads `pausado`
Solo existen a petición del lead, con fecha (`policies/contact-cadence.md` §2). En esa fecha se prepara **un** mensaje con `personalized-outreach`, que requiere aprobación. No hay reactivación de leads que nunca respondieron.

## Salida diaria
`data/outreach/_seguimientos-AAAA-MM-DD.md`: seguimientos preparados, respuestas clasificadas, escalamientos con motivo, cancelaciones y cierres, y los comandos `crm_tool.py` ejecutados o pendientes.
