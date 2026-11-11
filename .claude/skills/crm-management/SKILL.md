---
name: crm-management
description: Administra el CRM local de Web Wizards (data/crm/*.csv) exclusivamente mediante scripts/crm_tool.py - registra candidatos calificados con deduplicación y validación, actualiza estados, registra interacciones y aprobaciones, aplica bajas, audita la calidad de datos y genera el reporte diario. Úsalo para cualquier lectura o escritura del CRM.
when_to_use: Frases como "registra el staging de hoy", "actualiza el estado de WW-...", "registra que respondió", "marca como no contactar", "¿cuántos leads A tenemos?", "reporte del día", "busca duplicados", aprobar o rechazar borradores.
argument-hint: "[registrar | actualizar <lead_id> | interaccion | baja | reporte | auditar]"
---

# CRM Management

Toda escritura en `data/crm/` pasa por `scripts/crm_tool.py`. La edición directa de los CSV está bloqueada técnicamente (`workflows/guardrails.md`). La herramienta aplica el esquema (`data/schema/crm.schema.json`): duplicados, supresión, transiciones, aprobación humana y coherencia de la calificación.

Políticas que se aplican sin repetirlas aquí: `policies/opt-out.md`, `policies/consent.md`, `policies/contact-cadence.md`.

Si `crm_tool.py` rechaza una operación (`RECHAZADO:`), **no se busca otra vía**: se corrige el dato o se escala a una persona.

## Operaciones

### Registrar candidatos (`registrar`)
Para cada `data/staging/<fecha>/*.json` con `calificacion` completa:

```bash
python3 scripts/crm_tool.py add-lead data/staging/<fecha>/<slug>.json --dry-run   # comprobar
python3 scripts/crm_tool.py add-lead data/staging/<fecha>/<slug>.json             # registrar
```

La herramienta: valida el candidato, recalcula la clasificación esperada, rechaza duplicados y claves suprimidas, asigna `lead_id`, renombra el dossier a `data/research/<lead_id>.md` y mueve el JSON a `procesados/`.

- **Duplicado:** no se crea otro lead. Se enriquece el existente con `update-lead <id> --set campo=valor` (solo campos vacíos o con evidencia más reciente) y se anexan las evidencias a su dossier.
- **Posible duplicado (mismo nombre y ciudad):** si es otra sucursal verificada con dirección distinta, se repite con `--sucursal-de <lead_id>`.

### Actualizar (`actualizar <lead_id>`)
```bash
python3 scripts/crm_tool.py update-lead WW-... --set estado_pipeline=mensaje_borrador --nota "motivo"
python3 scripts/crm_tool.py transitions   # transiciones válidas
```
- **Aprobación:** `--set estado_pipeline=aprobado --set aprobado_por="<nombre de la persona>"`, solo cuando una persona lo indicó explícitamente en la conversación. La herramienta rechaza nombres de agentes. El agente **nunca** se autoaprueba.
- Los estados finales cancelan los seguimientos automáticamente.

### Registrar interacción (`interaccion`)
```bash
python3 scripts/crm_tool.py add-interaction --json '{"lead_id":"WW-...","canal":"email","direccion":"entrante","tipo":"respuesta_lead","resumen":"...","enviado_por":"lead","registrado_por":"<agente>"}'
```
- El texto completo va en `data/outreach/<lead_id>-hilo.md` (`contenido_ref`); el `resumen` no lleva datos sensibles.
- Un `mensaje_inicial` saliente solo se acepta si el lead tiene aprobación registrada.
- Una entrada por WhatsApp actualiza el consentimiento según `policies/consent.md`.
- Si la respuesta es una baja → operación siguiente, inmediatamente.

### Baja / supresión (`baja`)
```bash
python3 scripts/crm_tool.py suppress --lead WW-... --motivo opt_out --fuente "INT-... respuesta por <canal>"
python3 scripts/crm_tool.py suppress --valor correo@dominio.mx --tipo email --motivo rebote_permanente --fuente "rebote INT-..."
```
Cuándo y qué efectos tiene: `policies/opt-out.md`. La supresión es solo de anexado; no existe comando para borrar ni editar filas.

### Seguimientos
```bash
python3 scripts/crm_tool.py add-followup --json '{"lead_id":"WW-...","fecha_programada":"AAAA-MM-DD","ventana_horaria":"10:00-13:00","numero_seguimiento":1,"canal":"email","plantilla_id":"FU1-email","borrador_ref":"data/outreach/WW-...-fu1.md"}'
python3 scripts/crm_tool.py update-followup FU-... --estado enviado
```

### Reporte diario (`reporte`)
Leer los CSV (lectura permitida con `cat`, `grep`, `awk`, etc., sin redirección) y generar `data/reports/AAAA-MM-DD.md` con `templates/daily-report.md`.

### Auditoría (`auditar`) — al final de cada día
```bash
python3 scripts/crm_tool.py validate
```
Comprueba encabezados, esquema, duplicados, leads activos con claves suprimidas, dossiers faltantes, seguimientos activos de leads finales, coherencia entre `crm-schema.md` y el esquema, y la bandera de solo anexado. Si hay errores, se reportan; las correcciones pasan por `update-lead` o se escalan.

### Consultas
`python3 scripts/crm_tool.py show <lead_id>` muestra el lead, sus interacciones y sus seguimientos. Para conteos, leer los CSV.
