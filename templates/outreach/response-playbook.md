# Guía de respuestas

> Usada por `follow-up` para clasificar respuestas entrantes y proponer contestaciones.
> **Paso 0, siempre:** comprobar si la respuesta es una baja según `policies/opt-out.md` §1. Si lo es, se aplica esa política y esta guía no se usa.
> Las respuestas marcadas **ESCALAR** las decide una persona. Las demás quedan como borrador mientras la regla de `workflows/approval-rules.md` no esté activa.

## Clasificación (solo para respuestas que no son baja)

| Intención | Señales típicas | Estado resultante | ¿Escalar? |
|---|---|---|---|
| `interesado` | "sí", "me interesa", "cuéntame", "¿cuándo podemos hablar?" | `en_conversacion` | **Sí**, para agendar |
| `pide_precio` | "¿cuánto cuesta?", "precio", "cotización" | `en_conversacion` | **Sí** |
| `pregunta_info` | "¿qué hacen?", "¿tienen ejemplos?", "¿cómo funciona?" | `en_conversacion` | Solo si no hay respuesta base abajo |
| `pausa_con_fecha` | "escríbanme en enero", "después del 15 de diciembre" (con fecha concreta) | `pausado` con esa fecha | No |
| `quien_eres` | "¿quién eres?", "¿de dónde sacaste mi número?" | `en_conversacion` | No (respuesta de transparencia) |
| `deriva_a_otro` | "escríbale a la doctora a ...", "mande correo a ..." | `en_conversacion` | Sí, si implica un dato personal nuevo |
| `ambigua` / `fuera_de_alcance` | Emojis sueltos, temas no relacionados | sin cambio | **Sí** |

"Ahora no" sin fecha, "ya tenemos proveedor" y cualquier rechazo son bajas (`policies/opt-out.md` §1).

## Respuestas base

### R-quien_eres
> Claro. Soy {{remitente}}, de Web Wizards, una empresa mexicana de desarrollo web y automatización. Encontré el contacto de {{nombre_negocio}} publicado en {{fuente_publica}} y le escribí porque {{hecho_especifico}}. Si prefiere que no le contactemos, lo respetamos de inmediato.

### R-pregunta_info
> Con gusto. En Web Wizards hacemos tres cosas: sitios web para negocios, automatización (como agenda y recordatorios) e integración de WhatsApp para responder y agendar. Para {{nombre_negocio}} lo más útil sería {{propuesta}}. ¿Le parece una llamada de 10 minutos para mostrarle un ejemplo?

### R-interesado (borrador; una persona confirma horarios reales)
> ¡Gracias por responder! ¿Le acomoda una llamada de 10–15 minutos el {{opcion_1}} o el {{opcion_2}}? Si prefiere otro horario, dígame cuál.

### R-pide_precio (borrador; nunca incluir cifras)
> Gracias por su interés. El costo depende de lo que necesite {{nombre_negocio}} (por ejemplo, {{alcance_posible}}). Para darle una cotización precisa, ¿le parece una llamada breve de 10 minutos? Así le envío una propuesta clara.

### R-pausa_con_fecha
> Perfecto, gracias por avisar. Le escribo el {{fecha_acordada}}. Si antes cambia de opinión y prefiere que no, dígamelo y no le escribo.

### R-acuse_escalamiento
> Gracias por su mensaje. Una persona de nuestro equipo le responde a la brevedad.

La confirmación de baja está en `policies/opt-out.md` §3.

## Lo que el agente nunca responde sin una persona
Precios, descuentos, plazos de entrega, garantías, referencias de clientes, información contractual, compromisos de resultados y datos técnicos no documentados.
