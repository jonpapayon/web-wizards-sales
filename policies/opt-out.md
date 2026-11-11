# Política de bajas (opt-out) — FUENTE ÚNICA DE VERDAD

> Todo documento, skill, plantilla o subagente que trate bajas **remite a este archivo** y no repite sus reglas.
> Cumplimiento técnico: `scripts/crm_tool.py` (comando `suppress`) y el hook `scripts/hooks/guard.py`.

## 1. Qué cuenta como baja

Es baja cualquier mensaje, en cualquier canal, que exprese que el negocio **no quiere ser contactado o no tiene interés** en la etapa de prospección (estados `aprobado` y `contactado`):

- Rechazo: "no", "no gracias", "no me interesa", "no nos interesa", "ya tenemos quien nos haga eso", "ya tenemos proveedor".
- Petición de no contacto: "baja", "stop", "alto", "no me escriban", "no me contacten", "quítenme", "dejen de escribir", "borren mis datos".
- Molestia, insultos, reporte de spam o bloqueo detectado.
- Solicitud legal, mención de PROFECO, de la autoridad de protección de datos o de un abogado.
- Respuesta de un tercero que indica que la persona no desea contacto.

**Regla de duda:** si no está claro si es baja, **es baja**.

**Única excepción — "ahora no" con fecha:** si el lead pide expresamente ser contactado más adelante y da o acepta una fecha concreta ("escríbanme en enero"), no es baja: el lead pasa a `pausado` con esa fecha (ver `policies/contact-cadence.md`). Un "ahorita no" sin fecha es baja.

En fase de negociación (`en_conversacion`, `reunion_agendada`, `propuesta_enviada`), declinar la propuesta sin pedir que no le contacten lleva a `perdido` (estado final, sin más prospección). Si pide no ser contactado, es baja.

## 2. Qué se hace (inmediatamente, sin aprobación)

Un solo comando aplica todo:

```bash
python3 scripts/crm_tool.py suppress --lead WW-AAAAMMDD-NNN --motivo opt_out --fuente "INT-... respuesta por <canal>"
```

Efectos (garantizados por la herramienta):
1. Lead: `opt_out = true`, `fecha_opt_out`, `estado_pipeline = no_contactar`, `proximo_seguimiento` vacío.
2. `suppression.csv`: una fila por cada clave conocida del lead (teléfono, WhatsApp, email, dominio, place_id).
3. Seguimientos pendientes → `cancelado`.
4. Interacción `tipo = opt_out` registrada.

## 3. Confirmación al lead
Se permite **una** confirmación breve, en el mismo canal en el que llegó la baja, solo si el lead no pidió expresamente que no se le responda. Texto canónico:

> Entendido, disculpe la molestia. No volveremos a contactarle. Que tenga excelente día.

Mientras la regla R-01 de `workflows/approval-rules.md` no esté activa, la envía una persona.

## 4. Irreversibilidad
- Una baja **no se revierte** dentro del sistema. `crm_tool.py` rechaza cualquier cambio de `opt_out` a `false`, cualquier salida del estado `no_contactar` y cualquier alta o actualización de un lead cuya clave esté en supresión.
- Las filas de `suppression.csv` **no se modifican ni se eliminan**: el archivo es solo de anexado (bandera de sistema `uappnd` + hook + herramienta).
- Si el negocio vuelve a escribir por iniciativa propia, lo atiende una persona fuera del pipeline de prospección; el agente no reabre el lead.
- Única excepción legal: una solicitud de supresión de datos (derechos ARCO) la ejecuta manualmente una persona autorizada; ver `workflows/compliance.md`.

## 5. Frases de baja que van en los mensajes

| Canal | Frase canónica |
|---|---|
| Email | "Si prefiere no recibir más correos, responda 'baja' y no volveremos a escribirle." |
| WhatsApp / DM | "Si prefiere no recibir mensajes, dígamelo y no vuelvo a escribir." |
| Formulario web | "Si no le interesa, responda 'no' y no volveremos a escribirle." |
| Llamada | "Si no le interesa, lo anoto y no volvemos a llamar." |

## 6. Rebotes
Un rebote permanente de email no es baja: se suprime ese valor (`--motivo rebote_permanente --valor <email> --tipo email`). Si el lead no tiene otro canal verificado, pasa a `perdido`.
