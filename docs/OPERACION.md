# Operación diaria

## 0. Modo con login (recomendado): Worker + D1
```bash
bin/ww user ana "Ana Apellido"   # una vez
bin/ww dev                       # http://127.0.0.1:8787 (en producción: https://sales.webwizards.click cuando se autorice)
bin/ww investigator              # en otra terminal, si vas a prospectar (el Mac debe quedar encendido)
```
- **Prospección:** indica nicho, estado, municipio, cantidad y criterios. El sistema busca en DENUE (si hay token) y OpenStreetMap, descarta duplicados y exclusiones, encola trabajos para el investigador y deja los candidatos en **Investigación › Área de revisión** con evidencia verificada, inferida (no puntúa) y no encontrada.
- **Aprobar** registra tu nombre de sesión: no se puede aprobar en nombre de otro ni desde integraciones.
- **Tareas internas** (de n8n) en Seguimientos.

Las secciones 1–8 describen el modo clásico sobre CSV (`bin/ww dashboard`), que comparte la misma interfaz.

## 1. Abrir el sistema
```bash
cd ~/Desktop/web-wizards-sales
python3 app/server.py
```
Abre http://127.0.0.1:8765. La primera vez pulsa **«Tú: sin nombre»** (arriba a la derecha) y escribe tu nombre: queda registrado en cada aprobación o acción.
Para practicar sin tocar datos reales: `python3 app/server.py --demo` (banner amarillo «MODO DEMOSTRACIÓN»).

## 2. Investigar prospectos
La investigación en vivo se hace desde Claude Code, que usa herramientas autorizadas de lectura web:

> «Investiga 10 consultorios dentales en Puebla siguiendo el pipeline diario.»

Claude lanza `lead-researcher` (dossier + evidencias con fuente y fecha) y `lead-qualifier` (puntuación). Los candidatos quedan en **Investigación › Área de revisión**: nada entra al CRM sin pasar por ahí.

Distinción obligatoria: **no encontrado** (se buscó y no está publicado) vs **no disponible** (no se pudo consultar la fuente).

### Investigación con red propia (opcional, requiere autorización)
`research/` descubre negocios en OpenStreetMap y audita sitios leyendo HTML crudo (más fiable que los resúmenes). Está **desactivado**. Para usarlo, una persona debe:
1. Añadir en Claude Code el permiso para ese comando concreto (el control de permisos bloquea hoy la red por consola), y
2. Ejecutar con la variable explícita:
```bash
WW_RESEARCH_NETWORK=1 python3 -m research.discover --nicho dentista --ciudad Puebla --limite 30 --auditar
WW_RESEARCH_NETWORK=1 python3 -m research.site_audit https://sitio-del-negocio.mx/
```
Solo GET/HEAD, respeta robots.txt y límites de frecuencia; nunca envía formularios.

## 3. Revisar candidatos
**Investigación › Área de revisión**. Cada tarjeta muestra:
- Errores de validación o «Pendiente de revisión» (evidencia de confianza baja, A/B sin contacto verificado, clase que no cuadra con los puntos).
- Duplicados y exclusiones (bloquean el registro).

**Registrar** vuelve a validar todo con `crm_tool.py`. **Rechazar** pide motivo y conserva el archivo en `rechazados/`.

## 4. Revisar y aprobar borradores
**Mensajes**. Cada borrador muestra canal, estado de aprobación, dictamen de cumplimiento, trazabilidad (cada afirmación ↔ evidencia) y notas.
1. Lee el mensaje y la trazabilidad; abre las fuentes y confirma el gancho en tu navegador.
2. **Copiar** copia asunto y mensaje.
3. **Aprobar para uso humano** exige tu nombre y una casilla de confirmación. **No envía nada.**
4. **Pedir cambios** devuelve el lead a borrador con tu nota.
5. Envía tú el mensaje desde tu cuenta, en día hábil (nunca domingo ni festivo; p. ej. no el 16-nov-2026).
6. En la ficha del prospecto: **Registrar interacción › «Una persona envió el mensaje inicial aprobado»**, y luego **Mover a › Contactado** con la fecha del siguiente seguimiento.

## 5. Seguimientos y respuestas
**Seguimientos** lista próximas acciones (vencidas en rojo), seguimientos programados, historial, pausados y perdidos.
- Respuesta recibida → ficha › **Registrar interacción › Respuesta recibida** y mueve el estado.
- Cualquier rechazo o «no me escriban» → **Registrar baja** (escribe BAJA). Es irreversible: el sistema impide cualquier cambio posterior.
- Programar seguimiento: el sistema rechaza domingos y días inhábiles.

## 6. Administrar el CRM
- No edites los CSV a mano: usa el dashboard o `python3 scripts/crm_tool.py` (`--help` lista los comandos).
- Auditoría diaria: `python3 scripts/crm_tool.py validate`.
- Exportar: Reportes › **Exportar CRM** (copia a `data/exports/<fecha>/`) o **Prospectos › Descargar CSV**.
- Historial de cambios por prospecto: ficha › pestaña **Historial** (interacciones y auditoría).
- Protección recomendada (una vez, la ejecuta una persona): `chflags uappnd data/crm/suppression.csv data/crm/audit.jsonl`.

## 7. Configuración
**Configuración** permite editar objetivo diario, nichos activos y ciudades (auditado). Políticas, puntuación y reglas de aprobación se muestran en solo lectura: se cambian en Claude Code con aprobación de una persona.

## 8. Pruebas
```bash
python3 tests/run_all.py          # todas
python3 tests/run_all.py --sin-ui # sin pruebas de interfaz
```
