---
name: personalized-outreach
description: Redacta mensajes iniciales de prospección personalizados (email, WhatsApp manual, formulario, DM, guion de llamada) para leads A y B usando solo hechos verificados del dossier, y los deja en estado pendiente de aprobación humana. Nunca envía mensajes. Úsalo para preparar el primer contacto de leads calificados.
when_to_use: Frases como "prepara mensajes para los leads A", "redacta el correo para WW-...", "borradores de hoy", reescribir un mensaje rechazado o con cambios solicitados.
argument-hint: "[lead_id | 'lote' | 'A' | 'B']"
---

# Personalized Outreach

Prepara borradores de primer contacto que demuestren que investigamos al negocio, ofrezcan una mejora concreta y pidan un siguiente paso de baja fricción.

**Este skill nunca envía nada.** Deja borradores en `data/outreach/` y el lead en `pendiente_aprobacion`. Enviar un mensaje inicial requiere autorización explícita de una persona (ver `CLAUDE.md` → Matriz de autonomía).

**Entradas:** lead A o B en `data/crm/leads.csv` (`estado_pipeline = calificado`), su dossier `data/research/<lead_id>.md`, plantillas de `templates/outreach/initial-messages.md`.
**Salida:** `data/outreach/<lead_id>-inicial.md` con el formato de la sección "Formato del borrador".

Prioridad: todos los A del día primero, luego B por puntaje descendente. Los C no reciben mensaje inicial (quedan para nutrición futura).

---

## Principios de redacción

1. **Un hecho real y específico en la primera línea.** Sacado del dossier, con su evidencia. Ej.: "Vi que en su ficha de Google tienen 112 reseñas y varias mencionan que es difícil agendar por teléfono."
2. **Un solo problema, un solo beneficio.** Basado en `servicio_recomendado[0]`. No listar todo el catálogo.
3. **Tono:** cordial, profesional, de usted, español de México, sin tecnicismos ("que sus pacientes agenden desde el celular", no "booking engine").
4. **Sin halagos vacíos ni urgencia falsa.** Prohibido: "¡Oferta por tiempo limitado!", "su sitio es terrible", cifras de resultados no comprobables ("triplicará sus citas").
5. **Sin precios, descuentos ni plazos.** Eso lo maneja un humano.
6. **CTA de baja fricción:** una pregunta de sí/no o propuesta de 15 minutos. Ej.: "¿Le comparto 3 ideas concretas en un audio/llamada de 10 minutos?"
7. **Identificación clara:** remitente "equipo comercial de Web Wizards" (identidad aprobada por la persona responsable el 2026-11-11; si se aprueba un nombre personal, usarlo) y la frase de baja canónica del canal (`policies/opt-out.md` §5). Nunca afirmar experiencia, clientes o resultados previos que no estén demostrados.
8. **Longitud:** email 70–120 palabras + asunto ≤7 palabras; WhatsApp/DM 40–70 palabras; formulario 60–100 palabras; guion de llamada ≤45 segundos.
9. **Cuidado con la crítica:** describir el hecho de forma neutral y orientada al paciente/cliente ("en celular el menú se corta"), nunca juzgar al negocio.
10. **Nicho:** usar el vocabulario del nicho (pacientes / clientas / dueños de mascotas; citas / consultas / tratamientos).

## Prohibiciones absolutas
- Usar cualquier dato que no esté en el dossier con evidencia.
- Inventar nombres de decisores; si no hay `decisor_nombre`, saludar al equipo ("Hola, equipo de Clínica Sonrisa").
- Mencionar datos de pacientes, reseñas con nombre de autor o información sensible de salud.
- Afirmar que somos clientes, pacientes o que alguien nos recomendó si no es cierto.
- Preparar mensajes para leads dados de baja, suprimidos o en estado final (`policies/opt-out.md`).
- Elegir un canal o modo de envío que `policies/consent.md` §2 no permita. Todo borrador lleva `envio: manual_humano`.

## Procedimiento

1. Seleccionar leads elegibles: `clasificacion ∈ {A,B}`, `estado_pipeline = calificado`, `opt_out = false`, no en supresión.
2. Leer el dossier y elegir:
   - **Gancho**: la evidencia más específica y visible (preferir algo que el dueño pueda comprobar en 10 segundos).
   - **Ángulo**: `servicio_recomendado[0]`.
   - **Canal**: `canal_preferido`; si se elige otro, justificar.
3. Partir de la plantilla del nicho/canal en `templates/outreach/initial-messages.md` y reescribir; la plantilla es estructura, no texto para copiar.
4. Llenar la tabla de trazabilidad: cada afirmación del mensaje → evidencia del dossier.
5. Autorrevisión con la checklist. La **sesión principal** lanza después al subagente `compliance-reviewer` sobre el borrador (un subagente no puede lanzar otro).
6. Guardar `data/outreach/<lead_id>-inicial.md`.
7. Actualizar el lead con `crm_tool.py` (lo ejecuta la sesión principal; el subagente `outreach-writer` devuelve los comandos):
   ```bash
   python3 scripts/crm_tool.py update-lead <lead_id> --set estado_pipeline=mensaje_borrador
   python3 scripts/crm_tool.py update-lead <lead_id> --set estado_pipeline=pendiente_aprobacion --set aprobacion_estado=pendiente --set mensaje_inicial_id=data/outreach/<lead_id>-inicial.md
   ```
8. Generar al final del lote `data/outreach/_pendientes-aprobacion-AAAA-MM-DD.md`: tabla con lead_id, negocio, clase, canal, gancho (1 línea) y ruta del borrador, para que la persona apruebe en bloque o individualmente.

## Formato del borrador

```markdown
---
lead_id: WW-AAAAMMDD-NNN
negocio: <nombre_negocio>
clasificacion: A
canal: email | whatsapp | formulario_web | instagram_dm | facebook_messenger | telefono
envio: manual_humano
plantilla_base: INI-<nicho>-<canal>
servicio_angulo: <servicio>
estado: pendiente_aprobacion
compliance: aprobado | observaciones
creado: AAAA-MM-DDTHH:MM:SS-06:00
---

## Asunto (solo email)
...

## Mensaje
...

## Variante B (opcional, otro gancho)
...

## Trazabilidad
| Afirmación en el mensaje | Evidencia (dossier) | URL | Fecha |
|---|---|---|---|

## Notas para quien aprueba
- Por qué este gancho / riesgos / dato a confirmar.
```

## Checklist antes de marcar pendiente_aprobacion
- [ ] Cada afirmación factual tiene fila en Trazabilidad.
- [ ] El primer renglón contiene un hecho específico del negocio.
- [ ] No hay precios, promesas de resultados ni urgencia falsa.
- [ ] Incluye identificación de Web Wizards y forma de no recibir más mensajes.
- [ ] Longitud dentro de rango para el canal.
- [ ] El mensaje no serviría sin cambios para otro negocio.
- [ ] Revisión de cumplimiento registrada.

## Cambios solicitados / rechazos
Si la persona marca `cambios_solicitados`, reescribir atendiendo la nota, conservar la versión anterior al final del archivo bajo "Historial" y volver a `pendiente_aprobacion`. Si marca `rechazado`, no reintentar salvo instrucción; el lead pasa a `descartado` o se mantiene `calificado` según indique la persona.

## Después de la aprobación
Fase actual: una persona envía el mensaje manualmente y lo informa; `crm-management` registra la interacción (`tipo = mensaje_inicial`, `aprobacion_ref = <aprobado_por> <fecha>`), cambia a `contactado` y `follow-up` programa la cadencia.
Fase n8n: el flujo de envío solo toma leads con `aprobacion_estado = aprobado` (ver `workflows/integrations/n8n.md`).
