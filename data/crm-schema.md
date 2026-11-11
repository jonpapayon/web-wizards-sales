# Diccionario de datos del CRM

Diccionario legible de campos, formatos y valores permitidos. Reglas de máquina (enums, estados, transiciones, validaciones): `data/schema/crm.schema.json`. `python3 scripts/crm_tool.py validate` comprueba que ambos coincidan y que los CSV cumplan el esquema.

**Escritura:** los CSV de `data/crm/` solo se modifican con `scripts/crm_tool.py`; la edición directa está bloqueada técnicamente (ver `.claude/settings.json`). Bajas: `policies/opt-out.md`. Consentimiento: `policies/consent.md`. Cadencia y límites: `policies/contact-cadence.md`.
Los archivos CSV de `data/crm/` usan exactamente estos encabezados, UTF-8, separador coma, comillas dobles cuando un valor contenga comas o saltos de línea. Las listas dentro de una celda se separan con `;`.

Cuando se migre a Google Sheets, cada CSV será una pestaña con las mismas columnas en el mismo orden (ver `workflows/integrations/google-sheets.md`).

---

## 1. `leads.csv` — un registro por negocio

| Campo | Tipo | Obligatorio | Descripción / formato |
|---|---|---|---|
| `lead_id` | texto | sí | `WW-AAAAMMDD-NNN` (fecha de registro + consecutivo del día, 001–999). Inmutable. |
| `fecha_registro` | fecha-hora ISO | sí | Momento en que se registró en el CRM. |
| `fuente` | enum | sí | Ver catálogo **Fuentes**. Fuente principal donde se descubrió el negocio. |
| `fuente_url` | URL | sí | URL exacta donde se encontró. |
| `fecha_fuente` | fecha | sí | Fecha en que se consultó la fuente. |
| `nombre_negocio` | texto | sí | Tal como aparece publicado. |
| `nombre_normalizado` | texto | sí | Minúsculas, sin acentos, sin signos, sin sufijos legales (`sa de cv`, `s de rl`), espacios simples. |
| `nicho` | enum | sí | `clinica`, `dentista`, `estetica_spa`, `veterinaria`, `otro`. |
| `subnicho` | texto | no | Ej. `ortodoncia`, `dermatologia`, `spa_dia`, `hospital_veterinario`. |
| `ciudad` | texto | sí | |
| `estado_mx` | texto | sí | Entidad federativa. |
| `zona_horaria` | texto | sí | IANA, ej. `America/Mexico_City`. |
| `direccion` | texto | no | Dirección comercial publicada. |
| `google_maps_url` | URL | no | |
| `google_place_id` | texto | no | Solo si se obtiene de forma legítima (URL o API autorizada). |
| `sitio_web` | URL | no | URL principal. Vacío si no tiene. |
| `dominio` | texto | no | Dominio raíz sin `www.` ni protocolo, en minúsculas. |
| `telefono_publico` | texto | no | Tal como aparece publicado. |
| `telefono_e164` | texto | no | `+52XXXXXXXXXX`. Solo si el número publicado está completo. |
| `whatsapp_publico` | texto | no | Número E.164 publicado explícitamente como WhatsApp (enlace wa.me, botón o texto "WhatsApp"). |
| `email_publico` | email | no | Solo si aparece publicado. Nunca deducido. |
| `instagram_url` | URL | no | |
| `facebook_url` | URL | no | |
| `otras_fuentes` | lista URL | no | Otras URLs consultadas (`;`). |
| `decisor_nombre` | texto | no | Solo si se publica en el sitio/perfil del negocio como dueño, director o responsable. |
| `decisor_cargo` | texto | no | |
| `decisor_fuente_url` | URL | condicional | Obligatorio si hay `decisor_nombre`. |
| `num_resenas` | entero | no | Reseñas en Google al momento de la consulta. |
| `calificacion_google` | decimal | no | 1.0–5.0. |
| `senales_oportunidad` | lista enum | sí* | Códigos del catálogo **Señales** (`;`). *Puede estar vacío solo si es C o descartado. |
| `evidencias` | ruta | sí | `data/research/<lead_id>.md`. |
| `servicio_recomendado` | lista enum | sí | `sitio_nuevo`, `rediseno_web`, `whatsapp_integracion`, `agenda_en_linea`, `automatizacion`, `seo_local`. |
| `puntaje_icp` | entero 0–25 | sí | |
| `puntaje_oportunidad` | entero 0–40 | sí | |
| `puntaje_contacto` | entero 0–20 | sí | |
| `puntaje_capacidad` | entero 0–15 | sí | |
| `puntaje_total` | entero 0–100 | sí | Suma de los cuatro. |
| `clasificacion` | enum | sí | `A`, `B`, `C`, `descartado`. |
| `motivo_clasificacion` | texto | sí | 1–2 frases con los hechos que justifican la clase. |
| `estado_pipeline` | enum | sí | Ver **Estados del pipeline**. |
| `canal_preferido` | enum | no | Ver catálogo **Canales**. |
| `mensaje_inicial_id` | texto | no | Ruta del borrador aprobado, ej. `data/outreach/WW-20261111-004-inicial.md`. |
| `aprobacion_estado` | enum | sí | `no_aplica`, `pendiente`, `aprobado`, `rechazado`, `cambios_solicitados`. |
| `aprobado_por` | texto | condicional | Nombre de la persona que aprobó. Obligatorio si `aprobado`. |
| `fecha_aprobacion` | fecha-hora | condicional | Obligatorio si `aprobado`. |
| `fecha_primer_contacto` | fecha-hora | no | |
| `fecha_ultima_interaccion` | fecha-hora | no | |
| `proximo_seguimiento` | fecha | condicional | Obligatorio en estados activos (ver abajo). |
| `num_seguimientos` | entero | sí | Seguimientos enviados sin respuesta. Inicia en 0. |
| `consentimiento_whatsapp` | enum | sí | `no`, `si_inicio_lead` (el lead escribió primero), `si_explicito` (aceptó por escrito recibir mensajes). |
| `fecha_consentimiento` | fecha-hora | condicional | |
| `opt_out` | booleano | sí | `true`/`false`. |
| `fecha_opt_out` | fecha-hora | condicional | |
| `responsable` | texto | no | Persona de Web Wizards a cargo. |
| `notas` | texto | no | |
| `fecha_actualizacion` | fecha-hora | sí | Última modificación del registro. |

### Estados del pipeline (`estado_pipeline`)

**Fuente única de estados y transiciones:** `data/schema/crm.schema.json` → `$defs.estadoPipeline`, `x-transiciones`, `x-estados-finales`, `x-estados-con-seguimiento`. `scripts/crm_tool.py` aplica esas transiciones y rechaza las demás. Para verlas: `python3 scripts/crm_tool.py transitions`.

Significado de cada estado (descriptivo):

| Estado | Significado |
|---|---|
| `calificado` | Registrado y puntuado A/B/C. Estado inicial. |
| `descartado` | No cumple el ICP o tiene un descalificador. Final. |
| `mensaje_borrador` | Borrador inicial en preparación. |
| `pendiente_aprobacion` | Borrador revisado por cumplimiento; espera aprobación humana. |
| `aprobado` | Aprobado por una persona; aún no enviado. |
| `contactado` | Mensaje inicial enviado; corre la cadencia (`policies/contact-cadence.md`). |
| `en_conversacion` | El lead respondió y hay diálogo activo. |
| `reunion_agendada` | Hay fecha de llamada o reunión. |
| `propuesta_enviada` | Una persona envió una propuesta o cotización. |
| `ganado` | Cliente. Final. |
| `perdido` | Cadencia completa sin respuesta, o declinó en negociación sin pedir que no se le contacte. Final; sin más prospección. |
| `pausado` | El lead pidió ser contactado en una fecha concreta (`policies/contact-cadence.md` §2). |
| `no_contactar` | Baja o restricción legal (`policies/opt-out.md`). Final e irreversible en el sistema. Solo se llega mediante `crm_tool.py suppress`. |

`proximo_seguimiento` es obligatorio en los estados de `x-estados-con-seguimiento`.

---

## 2. `interactions.csv` — una fila por evento

| Campo | Tipo | Descripción |
|---|---|---|
| `interaccion_id` | texto | `INT-AAAAMMDD-NNNN`. |
| `lead_id` | texto | FK a leads. |
| `fecha_hora` | fecha-hora ISO | Momento del evento. |
| `canal` | enum | Catálogo **Canales**, o `interno` para eventos internos (`direccion = interna`: cambios de estado, aprobaciones, notas). |
| `direccion` | enum | `saliente`, `entrante`, `interna`. |
| `tipo` | enum | `mensaje_inicial`, `seguimiento`, `respuesta_lead`, `respuesta_ww`, `llamada`, `reunion`, `nota`, `opt_out`, `rebote`, `aprobacion`, `cambio_estado`. |
| `resumen` | texto | 1–3 frases, sin copiar datos sensibles. |
| `contenido_ref` | ruta | Archivo con el texto completo (borrador o transcripción). |
| `plantilla_id` | texto | ID de plantilla usada, si aplica. |
| `enviado_por` | enum | `humano`, `n8n`, `agente`, `lead`. |
| `aprobacion_ref` | texto | Quién/cuándo aprobó, o regla de `approval-rules.md` aplicada (ej. `R-03`). |
| `resultado` | enum | `enviado`, `entregado`, `leido`, `respondido`, `sin_respuesta`, `rebotado`, `fallido`, `n/a`. |
| `sentimiento` | enum | `positivo`, `neutral`, `negativo`, `opt_out`, `n/a`. |
| `siguiente_accion` | texto | |
| `fecha_siguiente_accion` | fecha | |
| `registrado_por` | texto | Agente o persona que registró. |

## 3. `followups.csv` — tareas de seguimiento

| Campo | Tipo | Descripción |
|---|---|---|
| `seguimiento_id` | texto | `FU-AAAAMMDD-NNNN`. |
| `lead_id` | texto | FK. |
| `fecha_programada` | fecha | Día hábil en hora local del lead. |
| `ventana_horaria` | texto | Ej. `10:00-13:00`. |
| `numero_seguimiento` | entero | 1, 2 o 3 (máximo 3 sin respuesta). |
| `canal` | enum | |
| `plantilla_id` | texto | Ej. `FU1-email`. |
| `borrador_ref` | ruta | `data/outreach/<lead_id>-fu<N>.md`. |
| `estado` | enum | `programado`, `borrador_listo`, `pendiente_aprobacion`, `aprobado`, `enviado`, `cancelado`, `vencido`. |
| `requiere_aprobacion` | booleano | `true` mientras las reglas no estén activas. |
| `regla_aplicada` | texto | ID de regla (`R-xx`) o vacío. |
| `creado_en` | fecha-hora | |
| `completado_en` | fecha-hora | |
| `notas` | texto | Motivo de cancelación, etc. |

## 4. `suppression.csv` — nunca contactar

| Campo | Tipo | Descripción |
|---|---|---|
| `valor` | texto | Valor normalizado bloqueado. |
| `tipo` | enum | `telefono_e164`, `email`, `dominio`, `google_place_id`, `nombre_ciudad`. |
| `lead_id` | texto | Si existe. |
| `motivo` | enum | `opt_out`, `cliente_actual`, `competidor`, `socio`, `solicitud_legal`, `rebote_permanente`, `repep`. |
| `fecha` | fecha-hora | |
| `fuente` | texto | Cómo se originó (ej. `respuesta WhatsApp INT-...`). |
| `notas` | texto | |

La lista de supresión **se consulta antes** de investigar, de registrar y de cada envío. Un registro en supresión prevalece sobre cualquier otro estado. El archivo es **solo de anexado**: sus filas no se modifican ni se eliminan (ver `policies/opt-out.md` §4).

---

## Claves de deduplicación

Un candidato es duplicado si coincide **cualquiera** de estas claves con un lead existente o con la lista de supresión:

1. `telefono_e164` (o `whatsapp_publico`) idéntico.
2. `dominio` idéntico (excepto dominios genéricos: `facebook.com`, `instagram.com`, `wa.me`, `linktr.ee`, `doctoralia.com.mx`, `google.com`, `sites.google.com`, `wixsite.com` sin subdominio propio, etc.).
3. `google_place_id` o `google_maps_url` idéntico.
4. `email_publico` idéntico.
5. `nombre_normalizado` + `ciudad` idénticos → **posible duplicado**: revisar dirección; si es otra sucursal, registrar como lead distinto y anotar `sucursal de WW-...` en `notas`.

Acción ante duplicado: actualizar campos vacíos del registro existente con datos nuevos verificados (añadiendo la URL a `otras_fuentes`), actualizar `fecha_actualizacion`, nunca sobrescribir datos verificados con datos no verificados, y no cambiar `lead_id` ni `fecha_registro`.

---

## Catálogos

### Fuentes (`fuente`)
`google_maps`, `google_busqueda`, `sitio_web`, `doctoralia`, `seccion_amarilla`, `directorio_otro`, `instagram`, `facebook`, `meta_ad_library`, `referido`, `evento`, `manual`, `denue` (INEGI, identificador oficial en `lead_sources` de D1), `osm` (OpenStreetMap, ODbL).

### Canales (`canal`, `canal_preferido`)
`email`, `whatsapp`, `telefono`, `formulario_web`, `instagram_dm`, `facebook_messenger`, `linkedin`, `presencial`.

### Señales de oportunidad (`senales_oportunidad`)

Cada señal debe tener evidencia en el dossier: qué se observó, URL, fecha y método.

| Código | Señal verificable | Puntos | Servicio asociado |
|---|---|---|---|
| `WEB_NONE` | No tiene sitio web propio (solo redes/directorios). | 15 | `sitio_nuevo` |
| `WEB_SOCIAL_ONLY` | El "sitio" en Google Maps apunta a Facebook/Instagram/Linktree. | 5 | `sitio_nuevo` |
| `WEB_BROKEN` | El sitio no carga, da error, dominio vencido o páginas rotas. | 12 | `rediseno_web` |
| `WEB_NOT_MOBILE` | No es responsive (texto diminuto, scroll horizontal a 375 px). | 10 | `rediseno_web` |
| `WEB_NO_HTTPS` | Sin certificado o advertencia "No seguro". | 5 | `rediseno_web` |
| `WEB_OUTDATED` | Copyright ≥3 años atrás, info desactualizada, tecnologías obsoletas (Flash, etc.). | 5 | `rediseno_web` |
| `WEB_SLOW` | Carga notablemente lenta (medida con herramienta, registrar valor). | 4 | `rediseno_web` |
| `WEB_NO_CTA` | Sin botón visible de cita, llamada o WhatsApp en la página principal. | 5 | `rediseno_web`, `whatsapp_integracion` |
| `BOOK_NONE` | No ofrece agenda/cita en línea en ningún canal. | 8 | `agenda_en_linea` |
| `BOOK_PHONE_ONLY` | Publica explícitamente "citas solo por teléfono". | 6 | `agenda_en_linea`, `automatizacion` |
| `WA_NO_LINK` | Publica número de WhatsApp como texto sin enlace click-to-chat. | 4 | `whatsapp_integracion` |
| `WA_NONE` | No publica WhatsApp en ningún canal. | 4 | `whatsapp_integracion` |
| `FORM_BROKEN` | Formulario de contacto visible que no funciona (error visible al cargar; **no** enviar formularios de prueba). | 5 | `rediseno_web` |
| `REV_CONTACT_ISSUES` | Reseñas públicas recientes (≤12 meses) mencionan que no contestan, difícil agendar, etc. | 7 | `automatizacion`, `whatsapp_integracion` |
| `REV_UNANSWERED` | La mayoría de reseñas recientes sin respuesta del negocio. | 3 | `automatizacion` |
| `GBP_INCOMPLETE` | Perfil de Google sin sitio, sin horario o con datos inconsistentes. | 4 | `seo_local` |
| `INFO_INCONSISTENT` | Teléfonos/horarios/direcciones distintos entre fuentes. | 3 | `rediseno_web`, `seo_local` |
| `ADS_WEAK_LANDING` | Anuncios activos (Meta Ad Library) que llevan a perfil o sitio deficiente. | 6 | `rediseno_web` |
| `GROWTH_SIGNAL` | Nueva sucursal, apertura reciente, contratando personal, nuevos servicios anunciados. | 5 | todos |

El puntaje de oportunidad se limita a 40 aunque la suma de señales sea mayor. `WEB_NONE` excluye las demás señales `WEB_*` excepto `WEB_SOCIAL_ONLY`.
