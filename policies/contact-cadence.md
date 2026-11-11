# Cadencia, horarios y límites de contacto — FUENTE ÚNICA DE VERDAD

> Todo documento que trate frecuencia, horarios o límites de contacto **remite a este archivo**.

## 1. Cadencia estándar (días hábiles, hora local del lead)

| Paso | Día | Contenido (plantillas en `templates/outreach/`) |
|---|---|---|
| Inicial | D0 | Primer contacto aprobado por una persona |
| FU1 | D+3 | Recordatorio breve + un hecho nuevo verificado |
| FU2 | D+7 | Idea concreta ligada a las señales del lead |
| FU3 | D+14 | Cierre cordial: se compromete a no volver a escribir |
| Cierre | FU3 + 2 días hábiles sin respuesta | `estado_pipeline = perdido` (motivo `sin_respuesta`) |

- **Máximo 4 mensajes sin respuesta** (1 inicial + 3 seguimientos) por lead, en total y en todos los canales.
- **No hay reactivación** de leads que nunca respondieron: el FU3 promete no volver a escribir y esa promesa se cumple.
- Si el lead responde en cualquier momento, la cadencia se detiene y se pasa a conversación.

### Variaciones por canal
| Canal | Seguimientos | Nota |
|---|---|---|
| Email | FU1–FU3 | Respondiendo en el mismo hilo. |
| Formulario web | FU1–FU3 | Por el mismo formulario, llenado por una persona. Si el negocio respondió por otro canal, continuar por ese. |
| WhatsApp (sin consentimiento) | Máximo FU1 y FU3 | Manual por una persona. Nunca por Cloud API. |
| Instagram/Facebook DM | Máximo FU1 y FU3 | Manual. |
| Teléfono | Máximo 2 llamadas en total sin contacto | Después, `perdido`. |

## 2. Lead `pausado` (solo a petición del lead)
- Solo cuando el lead pidió ser contactado en una fecha concreta (ver `policies/opt-out.md` §1).
- `proximo_seguimiento` = esa fecha. Ese día se prepara **un** mensaje (requiere aprobación). Sin respuesta en 5 días hábiles → `perdido`.
- Se puede pausar una sola vez por lead.

## 3. Conversación activa
- Responder en ≤1 día hábil; `proximo_seguimiento` ≤2 días hábiles.
- Si el lead deja de responder en conversación: máximo 2 recordatorios (D+3 y D+7) y después `perdido`.

## 4. Horarios
- Lunes a viernes de 9:00 a 19:00 y sábado de 9:00 a 14:00, **hora local del lead** (`zona_horaria`).
- Nunca en domingo ni en día de descanso obligatorio (LFT art. 74): 1 ene, primer lunes de feb, tercer lunes de mar, 1 may, 16 sep, tercer lunes de nov, 25 dic, 1 oct cada 6 años (transmisión del Ejecutivo federal) y jornadas electorales federales y locales.

## 5. Límites
| Límite | Valor |
|---|---|
| Mensajes por lead por día | 1 |
| Canales distintos por lead por día | 1 |
| Mensajes iniciales manuales por persona remitente por día | 30 (escalonados) |
| Envíos automáticos por día (fase n8n, solo con reglas activas) | 50 en total |
| Meta de leads calificados (A+B) por día | 30 |
| Candidatos a investigar por día | ~55 (ajustar con la tasa real de calificación) |

Los límites de cada plataforma (Meta, proveedor de email) prevalecen si son más estrictos.
