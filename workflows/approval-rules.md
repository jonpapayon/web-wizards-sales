# Reglas de aprobación previa

Define qué acciones de seguimiento o respuesta puede ejecutar el agente **sin aprobación individual**. Para que una acción se ejecute así deben cumplirse las tres condiciones:

1. La regla está en estado `activa`. Solo la cambia una persona autorizada, con nombre y fecha en el historial; editar este archivo requiere aprobación (`workflows/guardrails.md`).
2. Hay una integración autorizada y conectada para ese canal.
3. Se cumplen todas las condiciones de la regla en el momento de la acción.

Si falta cualquiera, la acción queda como borrador pendiente de aprobación humana.

**Estado general: `propuesta`. Ninguna regla está activa.**

## Condiciones comunes
- Cumplir `policies/opt-out.md`, `policies/consent.md` y `policies/contact-cadence.md` (horario, límites, un mensaje por lead por día).
- Contenido tomado de una plantilla de `templates/outreach/`, con variables respaldadas por el dossier.
- Sin precios, descuentos, plazos ni compromisos.
- Interacción registrada con `crm_tool.py` (`enviado_por = n8n`, `aprobacion_ref = R-xx`).

## Reglas

| ID | Estado | Acción permitida | Condiciones específicas | Canales |
|---|---|---|---|---|
| R-01 | propuesta | Confirmación única de baja (texto de `policies/opt-out.md` §3) | Baja ya aplicada con `suppress`; una sola vez; mismo canal | email; WhatsApp dentro de la ventana de 24 h |
| R-02 | propuesta | Enviar FU1–FU3 por email | Mensaje inicial aprobado y enviado; sin respuesta; borrador con dictamen `aprobado` de `compliance-reviewer` | email |
| R-03 | propuesta | Responder `quien_eres` con R-quien_eres | Intención clara; sin otra intención mezclada | email; WhatsApp dentro de la ventana de 24 h |
| R-04 | propuesta | Responder `pregunta_info` con R-pregunta_info | Pregunta cubierta por la guía de respuestas; sin pedir precio | email; WhatsApp dentro de la ventana de 24 h |
| R-05 | propuesta | Responder `pausa_con_fecha` con R-pausa_con_fecha y pausar | Fecha concreta dada por el lead | email; WhatsApp dentro de la ventana de 24 h |
| R-06 | propuesta | Acuse con R-acuse_escalamiento | Respuestas `interesado` o `pide_precio`; se escala a una persona al mismo tiempo | email; WhatsApp dentro de la ventana de 24 h |

### Nunca se automatiza
- Mensajes iniciales.
- Mensajes por WhatsApp a quien no ha escrito.
- Respuestas a quejas, temas legales, datos personales, precios o negociación.
- El mensaje del día pedido por un lead `pausado`.
- Pagos, contratos o cambios de cuentas.

## Activación (para la persona autorizada)
1. Cambiar `propuesta` → `activa` en la tabla.
2. Añadir una línea al historial.
3. Verificar que la integración del canal esté conectada y probada en modo de prueba.

## Historial
| Fecha | Regla | Cambio | Autorizó |
|---|---|---|---|
| 2026-11-11 | todas | Creadas en estado `propuesta` | — |
| 2026-11-11 | R-05, R-06 | Ajustadas a la política de bajas unificada (antes `no_ahora` y `ya_tiene_proveedor`) | — |
