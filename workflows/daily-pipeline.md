# Pipeline diario

Procedimiento para alcanzar la meta diaria de leads calificados. Lo ejecuta la **sesión principal**: lanza los subagentes (que no se llaman entre sí) y ejecuta `scripts/crm_tool.py`. Ninguna etapa envía mensajes.

Metas y límites (volumen, mensajes por persona, horarios): `policies/contact-cadence.md` §4–§5.

## Parámetros configurables

| Parámetro | Valor inicial | Notas |
|---|---|---|
| Reparto por nicho | dentista 35 % · clínica 30 % · estética/spa 20 % · veterinaria 15 % | Revisar cada semana según la tasa de respuesta |
| Zonas activas | CDMX, Guadalajara (ZMG), Monterrey (ZMM), Puebla, Querétaro | Rotar colonias y municipios |
| Lotes de investigación en paralelo | 4 (uno por nicho) | Cada `lead-researcher` recibe nicho, zona y cantidad |
| Hora de corte | 18:00 hora de CDMX | |

## Secuencia

1. **Arranque.** Leer el reporte anterior. Ejecutar la rutina de `follow-up` (`hoy`): las respuestas y bajas pendientes tienen prioridad. Ejecutar `python3 scripts/crm_tool.py validate`.
2. **Investigación.** Lanzar `lead-researcher` por nicho y zona → dossiers y JSON en `data/staging/<hoy>/`.
3. **Calificación.** Lanzar `lead-qualifier` sobre el staging. Si falta para la meta y hay tiempo, otra ronda en las combinaciones con mejor tasa.
4. **Registro (en línea).** Antes de investigar, `python3 scripts/ww_remote.py leads` para deduplicar. Por candidato: `ww_remote.py submit <staging.json> --dossier <dossier.md>` y, si queda `listo_para_registrar`, `ww_remote.py register <id>` (el Worker valida esquema, duplicados, exclusiones y calificación). Los rechazos se reportan; no se buscan otras vías. Modo local/respaldo: `crm_tool.py add-lead`.
5. **Borradores.** Lanzar `outreach-writer` sobre los A y B registrados hoy (lee el lead con `ww_remote.py lead <id>`). Después lanzar `compliance-reviewer` sobre cada borrador. Subir con `ww_remote.py draft <id> <archivo>` y pasar a `pendiente_aprobacion` con `ww_remote.py update <id> --set estado_pipeline=mensaje_borrador` y luego `--set estado_pipeline=pendiente_aprobacion --set aprobacion_estado=pendiente`.
6. **Aprobación humana.** Entregar `data/outreach/_pendientes-aprobacion-<hoy>.md`. La persona responde `aprobar WW-...`, `cambios WW-...: <nota>` o `rechazar WW-...`. Se registra con `update-lead ... --set aprobado_por="<nombre>"`.
7. **Envío (manual).** Una persona envía cada mensaje aprobado y confirma `enviado WW-...`. Se registra con `add-interaction` (`tipo = mensaje_inicial`), se pasa a `contactado` y `follow-up` programa la cadencia.
8. **Cierre.** `crm_tool.py validate` y reporte en `data/reports/<hoy>.md`.

## Capacidad
- Si no se alcanza la meta, **no** se baja el estándar de evidencia ni se reclasifica un C como B (`crm_tool.py` lo rechazaría). Se reporta el déficit y su causa.
- Los C quedan registrados, sin mensaje inicial.

## Indicadores semanales
Tasa de calificación, tasa de borradores aprobados sin cambios, tasa de respuesta por canal y nicho, tasa de bajas (si supera 5 %, revisar mensajes y segmentación) y reuniones por cada 100 contactados.
