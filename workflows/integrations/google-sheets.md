# Integración con Google Sheets (especificación — no implementada)

Google Sheets será la fuente de verdad compartida del CRM para el equipo y para n8n. Los CSV de `data/crm/` son su espejo local: mismas columnas, mismo orden.

## Libro: "WW Sales CRM"

| Pestaña | Origen | Clave única | Editan |
|---|---|---|---|
| `leads` | `data/crm/leads.csv` | `lead_id` | n8n, Claude (vía export), personas (solo columnas de aprobación, responsable y notas) |
| `interacciones` | `data/crm/interactions.csv` | `interaccion_id` | n8n, Claude. Solo anexar, nunca editar. |
| `seguimientos` | `data/crm/followups.csv` | `seguimiento_id` | n8n, Claude |
| `supresion` | `data/crm/suppression.csv` | `valor` + `tipo` | n8n, Claude, personas (solo agregar) |
| `aprobaciones` | vista de leads `pendiente_aprobacion` | `lead_id` | **Personas** |
| `config` | parámetros de `workflows/daily-pipeline.md` | `parametro` | Personas |
| `reporte_diario` | `data/reports/` | `fecha` | n8n |

### Pestaña `aprobaciones`
| lead_id | negocio | clasificacion | canal | gancho | borrador (enlace) | decision (`aprobar`/`cambios`/`rechazar`) | nota | aprobado_por | fecha_decision |

Validación de datos: lista desplegable en `decision`; `aprobado_por` obligatorio si `decision = aprobar`. WF-02 solo acepta cambios hechos por usuarios humanos del dominio de Web Wizards.

## Reglas de la hoja
- Fila 1 = encabezados exactos de los CSV; no renombrar ni reordenar sin actualizar `data/crm-schema.md` y `crm.schema.json`.
- Validación de datos con listas desplegables para todos los enums del catálogo.
- Formato condicional: `opt_out = TRUE` en rojo; `proximo_seguimiento < HOY()` en ámbar.
- Proteger columnas de sistema (`lead_id`, `fecha_registro`, `fuente`, `fuente_url`, puntajes) para que solo la cuenta de servicio las edite.
- Compartir solo con el equipo de Web Wizards; nunca con enlace público.
- Historial de versiones activado (auditoría).

## Operaciones de n8n
- Alta/actualización de leads: Google Sheets **Append or Update Row** con columna de coincidencia `lead_id`.
- Interacciones: **Append Row**.
- Deduplicación: **Get Row(s)** con filtro por `telefono_e164`, `dominio`, `email_publico` antes de insertar.
- Aprobaciones: **Google Sheets Trigger** (fila actualizada) en `aprobaciones`.

## Migración inicial (cuando se autorice)
1. Crear el libro y las pestañas con encabezados.
2. Importar cada CSV en su pestaña.
3. Correr la auditoría de `crm-management` sobre los datos importados.
4. Congelar escritura directa a CSV: desde ese momento Claude exporta cambios para WF-01 y descarga una copia de Sheets como espejo de lectura.
