# Plantillas de mensaje inicial

> Usadas por `personalized-outreach`. Son **estructuras**, no textos para copiar. Cada `{{variable}}` debe salir del dossier con evidencia. Si una variable no tiene dato verificado, se reescribe la frase sin ella; nunca se rellena.
> Todo mensaje inicial requiere aprobación humana y lo envía una persona. Canales permitidos y modo de envío: `policies/consent.md` §2.

## Variables

| Variable | Origen |
|---|---|
| `{{saludo}}` | "Dra./Dr. {{apellido}}" solo si `decisor_nombre` documentado; si no, "Hola, equipo de {{nombre_negocio}}" |
| `{{hecho_especifico}}` | Observación de la señal de mayor peso (sección 6 del dossier) |
| `{{impacto_cliente}}` | Consecuencia para el paciente/cliente, redactada en neutro, sin cifras inventadas |
| `{{propuesta}}` | Servicio `servicio_recomendado[0]` en lenguaje simple |
| `{{remitente}}` | Identidad del remitente. Por defecto: "el equipo comercial de Web Wizards" (decisión del 2026-11-11). Nunca afirmar experiencia o clientes previos que no estén demostrados. |
| `{{baja}}` | Frase de baja canónica del canal: `policies/opt-out.md` §5 |

## Estructura común (5 bloques)
1. Saludo + quién soy (1 línea).
2. Hecho específico observado (1 línea).
3. Por qué importa a sus pacientes/clientes (1 línea).
4. Qué podríamos hacer (1 línea, un solo servicio).
5. Pregunta de baja fricción + baja.

---

## Clínicas y consultorios

### INI-clinica-email
**Asunto:** {{nombre_negocio}}: citas desde el celular  ·  alternativa: Una idea para {{nombre_negocio}}

> {{saludo}}:
>
> Le escribe {{remitente}}. En Web Wizards desarrollamos sitios web, automatizaciones e integraciones de WhatsApp para negocios.
>
> Revisando su presencia en línea noté que {{hecho_especifico}}. Para un paciente que busca consulta desde el celular, eso {{impacto_cliente}}.
>
> Podríamos {{propuesta}}, sin cambiar su forma de trabajar.
>
> ¿Le comparto en una llamada de 10 minutos tres ideas concretas para {{nombre_negocio}}?
>
> Saludos,
> {{remitente}} · Web Wizards
>
> {{baja}}

### INI-clinica-whatsapp (envío manual)
> {{saludo}}, soy {{remitente}} de Web Wizards. Vi que {{hecho_especifico}}. Podríamos ayudar a que sus pacientes {{beneficio_corto}}. ¿Le puedo enviar 3 ideas concretas por aquí? Si prefiere no recibir mensajes, dígamelo y no vuelvo a escribir.

## Dentistas

### INI-dentista-email
**Asunto:** Agenda en línea para {{nombre_negocio}}  ·  alternativa: Sobre su página de {{subnicho}}

> {{saludo}}:
>
> Le escribe {{remitente}}. En Web Wizards desarrollamos sitios web, automatizaciones e integraciones de WhatsApp para negocios.
>
> Vi que {{hecho_especifico}}. Quien busca {{servicio_publicado_del_negocio}} suele comparar varias clínicas desde el celular, y eso {{impacto_cliente}}.
>
> Podríamos {{propuesta}}.
>
> ¿Le interesa que le muestre en 10 minutos cómo se vería para {{nombre_negocio}}?
>
> {{remitente}} · Web Wizards
>
> {{baja}}

### INI-dentista-whatsapp (envío manual)
> {{saludo}}, le escribe {{remitente}} de Web Wizards. Vi que {{hecho_especifico}}. Podríamos ayudarles a recibir citas por WhatsApp y web de forma ordenada. ¿Le comparto una propuesta breve? Si no le interesa, con gusto no vuelvo a escribir.

## Estéticas y spas

### INI-estetica-email
**Asunto:** Reservas en línea para {{nombre_negocio}}

> {{saludo}}:
>
> Le escribe {{remitente}}. En Web Wizards desarrollamos sitios web, automatizaciones e integraciones de WhatsApp para negocios.
>
> Vi que {{hecho_especifico}}. Muchas clientas descubren el lugar en Instagram y quieren reservar en el momento; {{impacto_cliente}}.
>
> Podríamos {{propuesta}}, conectado con su WhatsApp.
>
> ¿Le muestro un ejemplo en 10 minutos?
>
> {{remitente}} · Web Wizards
>
> {{baja}}

### INI-estetica-dm (Instagram/Facebook de la cuenta del negocio)
> Hola, equipo de {{nombre_negocio}}. Les escribe {{remitente}}. Vi {{detalle_publico_concreto}} en su perfil y noté que {{hecho_especifico}}. Podríamos ayudarles a recibir reservas directo desde Instagram y WhatsApp. ¿Les comparto una idea? Si prefieren no recibir mensajes, me avisan.

## Veterinarias

### INI-veterinaria-email
**Asunto:** {{nombre_negocio}}: citas y urgencias más fáciles

> {{saludo}}:
>
> Le escribe {{remitente}}. En Web Wizards desarrollamos sitios web, automatizaciones e integraciones de WhatsApp para negocios.
>
> Vi que {{hecho_especifico}}. Cuando alguien busca veterinario con prisa, {{impacto_cliente}}.
>
> Podríamos {{propuesta}}.
>
> ¿Le cuento en 10 minutos cómo funcionaría para {{nombre_negocio}}?
>
> {{remitente}} · Web Wizards
>
> {{baja}}

### INI-veterinaria-whatsapp (envío manual)
> {{saludo}}, soy {{remitente}} de Web Wizards. Vi que {{hecho_especifico}}. Podríamos ayudarles a responder y agendar por WhatsApp de forma automática. ¿Le comparto cómo? Si no le interesa, no vuelvo a escribir.

---

## Otros canales (todos los nichos)

### INI-formulario
Mismo contenido que el email, sin asunto, 60–100 palabras, firmando con nombre, "Web Wizards" y un medio de respuesta real de Web Wizards.

### INI-llamada (guion ≤45 s, solo por humano, en horario y tras revisar REPEP cuando aplique)
1. "Buenos días, ¿hablo con {{nombre_negocio}}? Soy {{remitente}}, de Web Wizards."
2. "Le llamo porque vi que {{hecho_especifico}} y en Web Wizards hacemos sitios web y automatizaciones que resuelven eso."
3. "¿Me permite enviarle por correo o WhatsApp tres ideas concretas? Si no le interesa, lo anoto y no volvemos a llamar." (frase canónica de baja)
4. Registrar resultado y, si aplica, permiso explícito para enviar información (`consentimiento_whatsapp = si_explicito` solo si aceptó recibir WhatsApp).

---

## Ejemplos de `{{hecho_especifico}}` bien y mal redactados

| ✅ Bien (hecho verificable, neutro) | ❌ Mal |
|---|---|
| "su ficha de Google enlaza a Facebook en lugar de un sitio propio" | "no tienen página, se ven poco profesionales" |
| "en celular el menú de su sitio se sale de la pantalla" | "su sitio es horrible" |
| "en Google indican que las citas son solo por teléfono" | "pierden muchísimos pacientes" |
| "varias reseñas recientes comentan que es difícil comunicarse" | "Juan Pérez se quejó de que no contestan" |
| "su página muestra 2017 en el pie y no incluye {{servicio_publicado}}" | "su información está mal" |

## Frases de baja (`{{baja}}`)
Se usan las frases canónicas de `policies/opt-out.md` §5, sin variaciones.
