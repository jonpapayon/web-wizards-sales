# Integración con WhatsApp Business Cloud API (especificación — no implementada)

## Alcance permitido
Lo que se puede enviar por la Cloud API y a quién lo define `policies/consent.md` (fuente única): solo conversaciones con consentimiento (`si_inicio_lead` dentro de la ventana de 24 h, o `si_explicito` con plantilla aprobada). Nunca primer contacto en frío, ni seguimientos a quien no ha escrito, ni envíos masivos.

## Plantillas a someter a aprobación de Meta (propuesta)
| Nombre | Categoría esperada | Uso |
|---|---|---|
| `ww_seguimiento_reunion` | utility | Confirmar o recordar una reunión agendada por el lead. |
| `ww_retomar_conversacion` | marketing | Retomar una conversación con lead con opt-in explícito, fuera de la ventana. |
| `ww_envio_propuesta` | utility | Avisar que la propuesta solicitada está lista. |

Idioma `es_MX`. La categoría final la determina Meta; revisar costos vigentes antes de usarlas.

## Webhook entrante → CRM
1. n8n **WhatsApp Trigger** recibe el mensaje.
2. Buscar el lead por `whatsapp_publico`/`telefono_e164`. Si no existe, escalar (posible lead inbound).
3. Registrar la interacción entrante con la lógica de `crm_tool.py add-interaction` (actualiza `consentimiento_whatsapp` según `policies/consent.md`) y guardar la hora del último mensaje para calcular la ventana.
4. Detectar bajas según `policies/opt-out.md` **antes** de cualquier clasificación por IA y aplicar `suppress`.
5. Clasificar intención (Claude) → regla activa o escalamiento.

## Requisitos previos
- Meta Business Manager verificado y WhatsApp Business Account.
- Número telefónico dedicado (no usado en la app de WhatsApp Business al mismo tiempo, salvo que se use la coexistencia soportada por Meta).
- App de Meta con producto WhatsApp; **app suscrita a la WABA** para que lleguen los webhooks.
- Perfil de negocio completo (nombre visible aprobado, descripción, sitio, aviso de privacidad).
- Credenciales en n8n: API key/token para el nodo WhatsApp Business Cloud; OAuth2 para WhatsApp Trigger. Guardadas solo en n8n.
- Monitoreo de calificación de calidad del número y límites de mensajería.
