# Dossier de investigación — {{nombre_negocio}}

> Plantilla de `lead-research`. Guardar como `data/research/<slug>.md`; al registrarse se renombra a `data/research/<lead_id>.md`.
> Regla: todo dato lleva fuente. Lo no encontrado se escribe `no_encontrado`. Nada se deduce.

| Campo | Valor |
|---|---|
| lead_id | {{lead_id o "pendiente"}} |
| slug | {{slug}} |
| Investigado por | {{agente/persona}} |
| Fecha de investigación | {{AAAA-MM-DD}} |
| Fuente de descubrimiento | {{fuente}} — {{fuente_url}} |
| Enriquece a | {{lead_id existente o "—"}} |

---

## 1. Identidad del negocio

| Dato | Valor | Fuente (URL) | Fecha |
|---|---|---|---|
| Nombre publicado | | | |
| Nicho / subnicho | | | |
| Dirección comercial | | | |
| Ciudad / estado | | | |
| Zona horaria | | — | — |
| Sucursales | | | |
| Google Maps | | | |
| Sitio web | | | |
| Instagram | | | |
| Facebook | | | |
| Otras fuentes | | | |

## 2. Canales de contacto empresariales

| Canal | Valor literal publicado | Normalizado | Fuente (URL) | Fecha | Verificado |
|---|---|---|---|---|---|
| Teléfono | | +52 | | | sí/no |
| WhatsApp (publicado como tal) | | +52 | | | sí/no |
| Email (publicado) | | — | | | sí/no |
| Formulario web | | — | | | visible/no |
| DM Instagram/Facebook | | — | | | sí/no |

## 3. Decisor (solo si el negocio lo publica)

| Nombre | Cargo | Fuente (URL) | Fecha |
|---|---|---|---|
| | | | |

## 4. Servicios publicados

| Servicio | Fuente (URL) |
|---|---|
| | |

## 5. Reputación

- Reseñas en Google: {{num}} · Calificación: {{x.x}} · Fecha de consulta: {{AAAA-MM-DD}}
- Reseñas con respuesta del negocio (últimas 20): {{n}}/20
- Citas relevantes (≤20 palabras, sin nombre del autor):
  - "{{cita}}" — {{mes/año}}

## 6. Señales de oportunidad

| Código | Observación concreta | URL | Fecha | Método | Puntos |
|---|---|---|---|---|---|
| | | | | | |

**Señales no verificadas** (no suman): {{lista y motivo}}

## 7. Presencia digital — notas técnicas

- HTTPS: sí/no · Responsive (375 px): sí/no · Copyright: {{año}} · CTA cita/WhatsApp: sí/no
- Agenda en línea: {{dónde / no}} · Click-to-chat WhatsApp: sí/no
- Rendimiento: {{valor}} medido con {{herramienta}} (o "no medido")
- Anuncios activos (Meta Ad Library): sí/no — {{URL}}
- Señales de crecimiento: {{texto + URL}}

## 8. Datos no encontrados vs. no disponibles

**No encontrado** = se consultaron las fuentes accesibles y el dato no aparece publicado (ej. el negocio no publica correo). Va en `campos_no_encontrados` del JSON.

| Campo | Fuentes revisadas |
|---|---|
| {{campo}} | {{URLs}} |

**No disponible** = no se pudo consultar la fuente que lo tendría (bloqueo, error, herramienta no disponible, contenido que requiere iniciar sesión). No implica que el dato no exista. Se anota aquí y en `notas` del CRM.

| Campo / fuente | Motivo (error, bloqueo, herramienta) |
|---|---|
| {{campo}} | {{motivo}} |

## 9. Descalificadores revisados

- [ ] Cerrado / sin actividad 12 meses
- [ ] Cadena corporativa (≥5 sucursales)
- [ ] Fuera de nicho / fuera de México
- [ ] En supresión
- [ ] Ya es cliente / socio / competidor

## 10. Ángulo comercial sugerido

- Problema principal observado: {{1 frase basada en la señal de más peso}}
- Servicio que lo resuelve: {{servicio}}
- Gancho para el mensaje (hecho verificable en 10 segundos): {{hecho}}

## 11. Calificación

> La llena `lead-qualification` con `templates/qualification-scorecard.md`.

## 12. Observaciones del calificador / revisor

-

## 13. Historial

- {{AAAA-MM-DD}} — creado por {{agente}}
