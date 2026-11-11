---
name: lead-qualification
description: Califica prospectos investigados con una rúbrica de 100 puntos (ajuste al ICP, señales de oportunidad, contactabilidad, capacidad de inversión), los clasifica en A, B, C o descartado y recomienda servicio y canal. Úsalo después de lead-research y antes de registrar en el CRM, o para recalificar un lead.
when_to_use: Frases como "califica estos leads", "clasifica A/B/C", "puntúa el staging de hoy", "recalifica WW-...", revisar por qué un lead es B y no A.
argument-hint: "[ruta de staging | lead_id]"
---

# Lead Qualification

Convierte candidatos con evidencia en leads puntuados y clasificados de forma reproducible. Dos personas que apliquen esta rúbrica al mismo dossier deben llegar a la misma clase.

**Entrada:** `data/staging/AAAA-MM-DD/*.json` + dossier en `data/research/`. (Para recalificar: registro de `data/crm/leads.csv` + dossier.)
**Salida:** el mismo JSON con el objeto `calificacion` completo (ver `$defs/calificacion` en `data/schema/crm.schema.json`) y la sección "Calificación" del dossier llenada con `templates/qualification-scorecard.md`.

Solo cuentan los hechos documentados en el dossier. Si una señal no tiene evidencia, vale 0.

---

## Rúbrica (0–100)

### 1. Ajuste al ICP — máximo 25
| Criterio | Puntos |
|---|---|
| Nicho prioritario: dentista o clínica/consultorio = 10; estética/spa o veterinaria = 9; otro = 0 | 0–10 |
| Ubicación en México con dirección comercial verificable | 5 |
| Tamaño PyME: 1–4 sucursales, no cadena corporativa | 5 |
| Actividad verificable en últimos 6 meses (reseñas, publicaciones, cambios en ficha) | 5 |

### 2. Señales de oportunidad — máximo 40
Sumar los puntos de cada señal verificada según el catálogo de `data/crm-schema.md`. Tope 40. `WEB_NONE` excluye otras señales `WEB_*` salvo `WEB_SOCIAL_ONLY`.

### 3. Contactabilidad — máximo 20
| Criterio | Puntos |
|---|---|
| Al menos un canal empresarial publicado y verificado (email, WhatsApp publicado, formulario funcional o teléfono) | 10 |
| Un segundo canal empresarial distinto verificado | 5 |
| Nombre y cargo de decisor publicados por el negocio | 5 |

### 4. Capacidad de inversión — máximo 15
| Criterio | Puntos |
|---|---|
| ≥50 reseñas en Google (≥20 = 3 puntos) | 0–5 |
| Servicios de ticket alto publicados (implantes, ortodoncia, estética avanzada, cirugía, hospitalización veterinaria, paquetes de spa) | 5 |
| Invierte en marketing: anuncios activos o publicaciones constantes (≥4 al mes) | 5 |

## Reglas de clasificación

Aplicar en este orden:

1. **descartado** si hay cualquier descalificador: en supresión, cerrado, cadena corporativa, fuera de nicho/país, ya es cliente, sin ningún dato verificable, o `puntaje_total < 30`.
2. **A** si `puntaje_total ≥ 70` **y** ≥2 señales de oportunidad verificadas **y** ≥1 canal verificado (contactabilidad ≥10).
3. **B** si `puntaje_total ≥ 50` **y** ≥1 señal verificada **y** ≥1 canal verificado. (Incluye ≥70 que no cumple requisitos de A.)
4. **C** en el resto (30–49, o sin canal verificado, o sin señales).

"Calificado" para la meta diaria = **A + B**.

Los umbrales de esta sección están replicados en `x-clasificacion` y los puntos de señales en `x-senales-puntos` de `data/schema/crm.schema.json`; `crm_tool.py add-lead` recalcula la clase y el puntaje de oportunidad y rechaza cualquier discrepancia. Si se cambia la rúbrica, se cambian ambos (cambio que requiere aprobación de una persona).

## Servicio y canal recomendados

- `servicio_recomendado`: unión de servicios asociados a las señales, ordenados por puntos. Máximo 3. El primero define el ángulo del mensaje.
- `canal_preferido` (en orden, solo canales verificados):
  1. `email` publicado.
  2. `formulario_web` funcional del negocio.
  3. `whatsapp` publicado por el negocio como canal de contacto (modo de envío según `policies/consent.md` §2).
  4. `instagram_dm` / `facebook_messenger` de la cuenta del negocio.
  5. `telefono` (llamada por humano).

## Procedimiento

1. Leer el JSON y el dossier completo.
2. Verificar que cada señal tenga evidencia completa; eliminar las que no.
3. Calcular los 4 subpuntajes mostrando el cálculo en el scorecard.
4. Aplicar reglas de clasificación en orden.
5. Redactar `motivo_clasificacion` en 1–2 frases con hechos ("Sin sitio web; solo Facebook. 87 reseñas, ofrece ortodoncia. WhatsApp publicado.").
6. Escribir `calificacion` en el JSON con `calificado_en`.
7. Al terminar el lote, crear `data/staging/<hoy>/_resumen-qualification.md`: conteo A/B/C/descartado, puntaje promedio, señales más frecuentes, casos límite (±3 puntos de un umbral) para revisión humana.

## Casos límite
- Puntaje a ±3 de un umbral: marcar `revision_humana` en las notas del dossier; mantener la clase calculada.
- Negocio con múltiples sucursales del mismo dueño: un lead por sucursal solo si cada una tiene contacto propio; si no, un lead con nota de sucursales.
- Datos contradictorios entre fuentes: usar el más reciente del propio negocio y sumar `INFO_INCONSISTENT` si está documentado.

## Recalificación
Recalificar cuando: hay nuevas evidencias, pasaron >60 días desde la calificación, o se reactiva un lead `pausado`. Conservar el puntaje anterior en `notas` (`recalificado AAAA-MM-DD: B(58) → A(72)`).
