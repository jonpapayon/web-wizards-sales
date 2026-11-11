# Integración con n8n (especificación — no implementada)

n8n será el orquestador de ejecución: mueve datos entre Google Sheets, canales de mensajería y Claude, y aplica las compuertas de aprobación. Claude sigue siendo quien investiga, califica y redacta; n8n nunca decide enviar algo que no esté aprobado.

## Arquitectura objetivo

```
                ┌────────────── Google Sheets "WW Sales CRM" (fuente de verdad) ──────────────┐
                │ leads · interacciones · seguimientos · supresion · config · aprobaciones     │
                └──────▲──────────────────▲─────────────────────▲───────────────────▲─────────┘
                       │                  │                     │                   │
   Claude Code ── export/import ──► WF-01 Ingesta       WF-03 Envío aprobado   WF-05 Respuestas
   (research, qualification,        (staging→Sheets)    (solo aprobado=sí)     (WhatsApp Trigger,
    outreach, follow-up)                                        │               Gmail/IMAP)
                                                                ▼                   │
                                                  Email / WhatsApp Cloud API ◄──────┘
                                                                │
                                                  WF-04 Seguimientos (Schedule)
                                                  WF-06 Reporte diario (Schedule)
```

## Flujos propuestos

| ID | Nombre | Disparador | Qué hace | Compuerta |
|---|---|---|---|---|
| WF-01 | Ingesta de leads | Webhook o carpeta (export de Claude) | Recibe solo filas ya validadas por `crm_tool.py` (esquema, duplicados, supresión); vuelve a comprobar supresión con Lookup y hace **Append or Update Row** por `lead_id`. | Rechaza filas sin `fuente`, `fuente_url`, `fecha_registro`. |
| WF-02 | Cola de aprobación | Google Sheets Trigger (row updated en `aprobaciones`) | Cuando una persona marca `aprobado = sí` y escribe su nombre, copia `aprobado_por`/`fecha_aprobacion` a `leads` y pasa a `aprobado`. | Ignora cambios hechos por la cuenta de servicio (evita autoaprobación). |
| WF-03 | Envío de mensaje inicial aprobado | Schedule (cada 30 min en horario) | Toma leads `aprobado` cuyo canal sea **email**, envía, registra interacción, pasa a `contactado`, crea seguimientos. | Re-verifica supresión y horario justo antes de enviar. WhatsApp inicial: **no** por API (solo manual). |
| WF-04 | Seguimientos | Schedule diario 9:30 local | Lee `seguimientos` del día; si la regla `R-02` está activa envía el borrador aprobado; si no, notifica a la persona. | `approval-rules.md` + `policies/contact-cadence.md` + supresión + "sin respuesta nueva". |
| WF-05 | Respuestas entrantes | WhatsApp Trigger / Gmail Trigger | Registra la interacción, marca `consentimiento_whatsapp = si_inicio_lead` si aplica, cancela seguimientos, pide a Claude clasificar la intención, aplica regla activa o escala. Opt-out → supresión inmediata. | Opt-out se procesa siempre, aunque falle la clasificación. |
| WF-06 | Reporte diario | Schedule 18:30 | Agrega métricas desde Sheets y envía resumen al responsable. | — |
| WF-07 | Errores | Error Trigger | Notifica fallas; nunca reintenta un envío sin verificar que no se haya enviado ya (idempotencia por `interaccion_id`). | — |

## Contrato de datos
- Columnas = encabezados de `data/crm/*.csv` (ver `google-sheets.md`).
- Clave de upsert: `lead_id` (leads), `interaccion_id`, `seguimiento_id`, `valor+tipo` (supresión).
- Fechas ISO 8601 con zona horaria; n8n configurado en `America/Mexico_City` y cálculo de ventana por `zona_horaria` del lead.

## Llamadas de n8n a Claude
Para clasificar respuestas y redactar borradores desde n8n se usará la API de Claude (nodo HTTP Request o nodo de Anthropic) con los mismos prompts de los skills. Definir: modelo, límites de tokens, presupuesto mensual y registro de cada llamada. La clave de API se guarda **solo** en el gestor de credenciales de n8n.

## Requisitos para comenzar (pendientes)
1. **Decidir hosting de n8n**: n8n Cloud o self-hosted (Docker en VPS). Zona horaria `America/Mexico_City`.
2. **Crear el Google Sheet** "WW Sales CRM" con las pestañas de `google-sheets.md` e importar los CSV.
3. **Credenciales en n8n** (las crea una persona, nunca en este repo): Google Sheets OAuth2, Gmail/SMTP del dominio de Web Wizards, WhatsApp Business Cloud (API key para el nodo de envío; OAuth2 para WhatsApp Trigger), API de Claude.
4. **Meta**: Business Manager verificado, WhatsApp Business Account, número dedicado, app de Meta suscrita a la WABA (sin suscripción, el WhatsApp Trigger no recibe mensajes), plantillas aprobadas.
5. **Email**: dominio con SPF/DKIM/DMARC; buzón de envío dedicado.
6. **Legal**: aviso de privacidad publicado; criterio sobre REPEP; validar texto de baja.
7. **Activación de reglas** en `workflows/approval-rules.md` por una persona autorizada.
8. **Entorno de prueba**: Sheet de pruebas, número de prueba de WhatsApp, buzón de prueba; ejecutar cada flujo con datos ficticios antes de producción.
9. **Mecanismo de exportación** desde Claude Code: script local que convierta staging/CSV en payload para WF-01 (por definir; no se crea en esta fase).

## Principios de diseño
- Idempotencia: cada envío lleva `interaccion_id` generado antes de enviar; si existe, no se reenvía.
- Verificación tardía: supresión, opt-out y horario se revisan inmediatamente antes de cada envío.
- Falla cerrada: ante error de lectura de supresión o de aprobación, **no** se envía.
- Trazabilidad: toda acción automática escribe en `interacciones` con `enviado_por = n8n` y la regla aplicada.
