# Scorecard de calificación

> Pegar en la sección "11. Calificación" del dossier. Formulario de captura: los criterios, puntos y umbrales canónicos están en `.claude/skills/lead-qualification/SKILL.md` y los puntos de señales en `data/crm-schema.md`. `crm_tool.py add-lead` verifica que el resultado coincida.

**Lead:** {{lead_id / slug}} · **Calificado por:** {{agente}} · **Fecha:** {{AAAA-MM-DDTHH:MM-06:00}}

## 1. Ajuste al ICP (máx. 25)
| Criterio | Evidencia | Puntos |
|---|---|---|
| Nicho (10 dentista/clínica · 9 estética/vet · 0 otro) | | /10 |
| Dirección comercial en México verificable | | /5 |
| PyME 1–4 sucursales | | /5 |
| Actividad en últimos 6 meses | | /5 |
| **Subtotal** | | **/25** |

## 2. Señales de oportunidad (máx. 40)
| Código | Evidencia (resumen + URL) | Puntos catálogo |
|---|---|---|
| | | |
| **Suma** / **Tope aplicado** | | **/40** |

## 3. Contactabilidad (máx. 20)
| Criterio | Evidencia | Puntos |
|---|---|---|
| Canal empresarial verificado | | /10 |
| Segundo canal distinto | | /5 |
| Decisor publicado | | /5 |
| **Subtotal** | | **/20** |

## 4. Capacidad de inversión (máx. 15)
| Criterio | Evidencia | Puntos |
|---|---|---|
| Reseñas (≥50 = 5 · ≥20 = 3) | | /5 |
| Servicios de ticket alto | | /5 |
| Inversión en marketing | | /5 |
| **Subtotal** | | **/15** |

## Resultado
| | |
|---|---|
| **Total** | **/100** |
| Descalificadores | ninguno / {{cuál}} |
| Nº señales verificadas | |
| Canal verificado | sí/no |
| **Clasificación** | A / B / C / descartado |
| Regla aplicada | {{ej. "A: ≥70, 3 señales, email verificado"}} |
| Servicio recomendado | 1. 2. 3. |
| Canal preferido | |
| Motivo (1–2 frases) | |
| Caso límite (±3 de umbral) | sí/no → revisión humana |
