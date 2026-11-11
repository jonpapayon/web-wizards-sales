# Política de consentimiento por canal — FUENTE ÚNICA DE VERDAD

> Todo documento que trate consentimiento o permisos por canal **remite a este archivo**.
> No es asesoría legal; ver pendientes en `workflows/compliance.md`.

## 1. Campo `consentimiento_whatsapp`

| Valor | Cómo se obtiene | Evidencia obligatoria | Qué permite |
|---|---|---|---|
| `no` | Valor inicial | — | Ningún envío por WhatsApp Cloud API. WhatsApp solo manual por una persona (ver §2). |
| `si_inicio_lead` | El lead escribe por WhatsApp a Web Wizards | Interacción entrante registrada con fecha y hora | Mensajes de servicio dentro de las **24 h** posteriores a su último mensaje (ventana de atención de WhatsApp). |
| `si_explicito` | El lead acepta por escrito recibir mensajes de Web Wizards por WhatsApp | Texto literal de la aceptación + fecha en `interactions.csv` | Plantillas aprobadas por Meta fuera de la ventana, según su categoría. |

Base: la documentación de WhatsApp Business Platform exige opt-in antes de enviar mensajes; dentro de la ventana de 24 h se envían mensajes de servicio, y fuera de ella solo plantillas aprobadas. Revisar la política vigente antes de activar integraciones.

Una baja (ver `policies/opt-out.md`) anula cualquier consentimiento.

## 2. Reglas por canal para el primer contacto

| Canal | ¿Primer contacto permitido? | Condiciones |
|---|---|---|
| Email | Sí, tras aprobación humana | Solo a correos que el negocio publica como contacto. Remitente real, asunto no engañoso, identificación y frase de baja. Nunca correos deducidos. |
| Formulario web | Sí, tras aprobación humana | Lo llena **una persona**, no el agente (bloqueado técnicamente). |
| WhatsApp | Solo manual | Una persona, uno a uno, a un número que el negocio publica como canal de atención, tras aprobación. **Nunca** por Cloud API ni en lote. |
| Instagram / Facebook DM | Solo manual | Una persona, desde la cuenta oficial de Web Wizards, a la cuenta del negocio. |
| Teléfono | Solo una persona | En horario, y tras consultar REPEP cuando aplique (criterio legal pendiente). |

## 3. Datos personales
Solo datos que el negocio publica como contacto comercial. El nombre de un titular solo si el propio negocio lo publica, con URL de origen. Detalle de lo prohibido: `workflows/compliance.md` §1.
