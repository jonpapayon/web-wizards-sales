---
name: lead-qualification
description: Califica prospectos investigados con la rúbrica v2 de 100 puntos (citas, WhatsApp, anuncios, volumen, tamaño, problema operativo, presencia digital, contacto), los clasifica en A, B, C o descartado y recomienda servicio y canal. Úsalo después de lead-research y antes de registrar en el CRM, o para recalificar un lead.
when_to_use: Frases como "califica estos leads", "clasifica A/B/C", "puntúa el staging de hoy", "recalifica WW-...", revisar por qué un lead es B y no A.
argument-hint: "[ruta de staging | lead_id]"
---

# Lead Qualification (rúbrica v2)

Convierte candidatos con evidencia en leads puntuados y clasificados de forma reproducible. Dos personas que apliquen esta rúbrica al mismo dossier deben llegar a la misma clase.

**Entrada:** `data/staging/AAAA-MM-DD/*.json` + dossier en `data/research/`. Para recalificar: el lead (`python3 scripts/ww_remote.py lead WW-...`) + dossier.
**Salida:** el mismo JSON con el objeto `calificacion` completo, **incluido `criterios`** (ver `$defs/calificacion` y `$defs/criteriosV2` en `data/schema/crm.schema.json`), y la sección "Calificación" del dossier llenada con `templates/qualification-scorecard.md`.

Solo cuentan los hechos documentados en el dossier, con URL y fecha. Si un criterio no tiene evidencia, vale 0. La puntuación ordena la investigación; **no** es probabilidad de compra.

---

## Rúbrica v2 (0–100)

| Criterio (`criterios.*`) | Máx. | Cómo se puntúa (con evidencia) |
|---|---|---|
| `citas` — trabaja con citas o reservaciones recurrentes | 20 | 20: el negocio publica que agenda citas/reservaciones (botón o texto "agenda tu cita", reserva en línea, Doctoralia, "previa cita"). 12: es de un nicho que opera por citas pero no se encontró la evidencia explícita. 0: no aplica. |
| `whatsapp` — WhatsApp comercial público | 15 | 15: número de WhatsApp publicado por el negocio (wa.me, botón o texto con número) → `whatsapp_publico`. 8: hay botón o mención de WhatsApp sin número verificable. 0: sin WhatsApp. |
| `anuncios` — actividad publicitaria comprobable | 15 | 15: anuncios activos en Meta Ads Library (URL de la biblioteca y fecha), idealmente con objetivo de mensajes. 8: publicaciones constantes (≥4 al mes) sin anuncios. 0: nada comprobable. |
| `volumen` — clientes o reseñas visibles | 10 | Por `num_resenas` de Google: ≥50 = 10; ≥20 = 6; menos o sin dato = 0. (El CRM lo verifica.) |
| `tamano` — varias sucursales o personal | 10 | 10: 2–4 sucursales o equipo de 3+ profesionales visible. 5: una sede con equipo pequeño. 0–3: consultorio individual. Cadena de 5+ sucursales o corporativo = descalificador. |
| `problema` — problema operativo identificable | 15 | 15: al menos una señal del catálogo de `data/crm-schema.md` con evidencia que indique fricción en citas, contacto o seguimiento (p. ej. `BOOK_PHONE_ONLY`, `BOOK_NONE`, `FORM_BROKEN`, `WA_NO_LINK`, `REV_CONTACT_ISSUES`, `INFO_INCONSISTENT` en teléfonos/horarios), o 2+ señales. 8: una sola señal débil. 0: ninguna. |
| `presencia` — sitio o presencia digital mejorable | 5 | 5: sin sitio, solo redes, o alguna señal `WEB_*` documentada. 0: presencia sólida. |
| `contacto` — datos de contacto verificables | 10 | 10: dos o más canales empresariales verificados. 7: uno. 0: ninguno. |

**Bloques del CRM** (columnas existentes; el CRM comprueba que cuadren): `puntaje_icp` = citas + presencia (25) · `puntaje_oportunidad` = problema + whatsapp + volumen (40) · `puntaje_contacto` = contacto + tamano (20) · `puntaje_capacidad` = anuncios (15) · `puntaje_total` = suma de los 8.

## Reglas de clasificación (x-rubrica-v2)

Aplicar en este orden:

1. **descartado** si hay cualquier descalificador (en supresión, cerrado, cadena corporativa o 5+ sucursales, fuera de país, ya es cliente, competidor, sin ningún dato verificable) o `puntaje_total < 40`.
2. **A** si `puntaje_total ≥ 80` **y** ≥1 señal con evidencia **y** `criterios.contacto ≥ 7`.
3. **B** si `puntaje_total ≥ 60` **y** ≥1 señal con evidencia **y** `criterios.contacto ≥ 7`.
4. **C** en el resto (40–59, o sin canal verificado, o sin señales).

"Calificado" para la meta diaria = **A + B** (60 puntos o más). Interpretación: 80–100 prioridad alta · 60–79 media · 40–59 investigar más · <40 baja.

El CRM (`crm_tool.py` y el Worker) recalcula y **rechaza**: bloques que no suman sus criterios, total distinto de la suma, `volumen` que no corresponde a `num_resenas`, `whatsapp > 8` sin `whatsapp_publico`, `contacto > 0` sin canal, `problema > 0` sin señal con evidencia, señales sin evidencia o solo con confianza baja, y clase que no cuadra con los umbrales. Cambiar la rúbrica requiere aprobación de una persona (esquema + este archivo).

Leads sin `criterios` están calificados con la rúbrica v1 (heredada, `x-clasificacion`); se recalifican con v2.

## Servicio y canal recomendados

`servicio_recomendado` (máximo 3; el primero define el ángulo del mensaje), según el catálogo de Web Wizards:

| Servicio | Cuándo |
|---|---|
| `citas_whatsapp` | Negocio con citas (`citas ≥ 12`) que atiende por WhatsApp o teléfono: confirmaciones, recordatorios, reagendamiento. **Prioritario.** |
| `seguimiento_comercial` | Recibe prospectos o cotizaciones (inmobiliarias, autos, solar, construcción, educación, industrial) o anuncia con objetivo de mensajes. |
| `agente_ia` | Alto volumen de preguntas repetitivas visibles (reseñas, comentarios, FAQ extensas). |
| `web_conversion` | Sin sitio, sitio roto o que no lleva a contacto (`presencia = 5` o señales `WEB_*`, `FORM_BROKEN`, `WEB_NO_CTA`). |
| `sistema_interno` | Señales de procesos en Excel/WhatsApp, inventarios o pedidos (retail, distribución). Requiere diagnóstico. |
| `reputacion` | Reseñas sin responder o calificación baja con volumen (`REV_UNANSWERED`, `REV_CONTACT_ISSUES`). |
| `integraciones` | Herramientas desconectadas documentadas (formularios a correo, agendas separadas). |

Los valores v1 (`sitio_nuevo`, `rediseno_web`, `whatsapp_integracion`, `agenda_en_linea`, `automatizacion`, `seo_local`) siguen siendo válidos solo para leads históricos.

`canal_preferido` (en orden, solo canales verificados): `email` publicado · `formulario_web` funcional · `whatsapp` publicado como canal de atención (envío según `policies/consent.md` §2) · `instagram_dm` / `facebook_messenger` del negocio · `telefono`.

## Procedimiento

1. Leer el JSON y el dossier completo (incluida la verificación en Google Maps y Meta Ads Library, si existe).
2. Verificar que cada señal tenga evidencia completa; eliminar las que no.
3. Puntuar los 8 criterios mostrando la evidencia de cada uno en el scorecard; calcular bloques y total.
4. Aplicar las reglas de clasificación en orden.
5. Redactar `motivo_clasificacion` en 1–2 frases con hechos ("Agenda citas por WhatsApp (botón wa.me). 120 reseñas, anuncios activos en Meta desde oct-2026. Formulario roto.").
6. Escribir `calificacion` en el JSON con `criterios` y `calificado_en`.
7. Al terminar el lote, crear `data/staging/<hoy>/_resumen-qualification-<lote>.md`: conteo A/B/C/descartado, puntaje promedio, criterios que más faltan, casos límite (±3 puntos de un umbral) para revisión humana.

## Casos límite
- Puntaje a ±3 de un umbral: marcar `revision_humana` en las notas del dossier; mantener la clase calculada.
- Negocio con varias sucursales del mismo dueño: un lead por sucursal solo si cada una tiene contacto propio; si no, un lead con nota de sucursales.
- Datos contradictorios entre fuentes: usar el más reciente del propio negocio y documentar `INFO_INCONSISTENT`.
- Sin acceso a Google Maps o Meta Ads Library: `volumen` y `anuncios` valen 0 y se anota como "no verificado" (no se infiere).

## Recalificación
Recalificar cuando: hay nuevas evidencias, pasaron >60 días, se reactiva un lead `pausado`, o el lead aún está en rúbrica v1. Conservar el puntaje anterior en `notas` (`recalificado AAAA-MM-DD: v1 B(58) → v2 B(64)`). En línea: `python3 scripts/ww_remote.py update WW-... --set criterios='{...}' --set puntaje_icp=... --set clasificacion=...`.
