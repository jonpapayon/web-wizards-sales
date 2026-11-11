---
name: lead-research
description: Investiga PyMEs mexicanas (clínicas, dentistas, estéticas/spas, veterinarias) en fuentes públicas, verifica datos de contacto empresariales y documenta señales de oportunidad con evidencia (URL + fecha). Produce un dossier y un candidato en staging. Úsalo para encontrar nuevos prospectos o enriquecer uno existente.
when_to_use: Frases como "buscar prospectos", "encontrar dentistas en Puebla", "investiga esta clínica", "consigue leads de veterinarias", lote diario de prospección, enriquecer un lead incompleto.
argument-hint: "[nicho] [ciudad] [cantidad]  o  [url del negocio]"
---

# Lead Research

Encuentra negocios del ICP de Web Wizards y documenta, con evidencia verificable, por qué podrían necesitar un sitio web, automatización o integración de WhatsApp.

**Salidas por negocio:**
1. Dossier: `data/research/<slug>.md` usando `templates/research-dossier.md` (se renombra a `<lead_id>.md` al registrarse).
2. Candidato: `data/staging/AAAA-MM-DD/<slug>.json` conforme a `$defs/leadCandidate` de `data/schema/crm.schema.json`.

`<slug>` = `nombre_normalizado` con guiones + `-` + ciudad normalizada. Ej. `clinica-dental-sonrisa-puebla`.

Este skill **no** escribe en `data/crm/`. El registro lo hace `crm-management`.

---

## Parámetros

- **Nicho**: `clinica`, `dentista`, `estetica_spa`, `veterinaria`. Si no se indica, rotar en el orden de prioridad.
- **Ciudad / zona**: si no se indica, usar la lista de zonas activas de `workflows/daily-pipeline.md`.
- **Cantidad**: para alcanzar 30 calificados (A+B) al día se estima investigar ~50–60 candidatos (tasa esperada de calificación 50–60 %). Ajustar con la tasa real del reporte diario.

## Procedimiento

### Paso 0 — Preparación
1. Leer `data/crm/leads.csv` y `data/crm/suppression.csv` (solo lectura) y tener a mano las claves de deduplicación: teléfonos E.164, dominios, URLs de Maps, correos, `nombre_normalizado+ciudad`.
2. Revisar `data/staging/<hoy>/` para no repetir candidatos ya investigados hoy.

### Paso 1 — Descubrimiento (amplitud)
Buscar con consultas como:
- `"dentista" + "<colonia/ciudad>"`, `"clínica dental <ciudad>"`, `"consultorio <especialidad> <ciudad>"`
- `"spa <ciudad>"`, `"estética facial <ciudad>"`, `"veterinaria <ciudad>"`, `"hospital veterinario <ciudad>"`

Fuentes permitidas (consulta pública, respetando términos de uso y sin evadir bloqueos):
- Resultados de búsqueda y fichas públicas de Google Maps / Perfil de Negocio.
- Sitio web propio del negocio.
- Perfiles públicos de Facebook e Instagram del negocio.
- Directorios públicos (Doctoralia, Sección Amarilla, directorios locales).
- Biblioteca de anuncios de Meta (`meta_ad_library`).

Prohibido: iniciar sesión con cuentas para extraer datos, extracción masiva automatizada contra términos de uso, saltar CAPTCHAs, comprar o usar bases de datos de origen dudoso, enviar formularios o mensajes de prueba, llamar al negocio.

Para cada resultado, **antes de profundizar**, comprobar duplicado/supresión con los datos visibles (teléfono, dominio, nombre+ciudad). Si es duplicado: no investigar de nuevo; anotar en el resumen del lote como `duplicado: <lead_id>` (si hay datos nuevos verificados, crear un candidato de enriquecimiento con `"enriquece": "<lead_id>"` en `notas` del dossier).

### Paso 2 — Filtro rápido de descalificadores
Descartar sin investigar a fondo si:
- Cerrado permanentemente o sin actividad verificable en los últimos 12 meses (sin reseñas, publicaciones ni cambios).
- Cadena nacional, franquicia corporativa u hospital grande con área de marketing propia (≥5 sucursales).
- Está en la lista de supresión.
- No es del nicho (ej. distribuidora de insumos dentales).
- Fuera de México.

Registrar el descarte en el resumen del lote con el motivo (no se crea candidato).

### Paso 3 — Verificación de datos (profundidad)
Recopilar únicamente datos publicados por el propio negocio o en su ficha pública:

| Dato | Regla |
|---|---|
| Nombre | Tal como aparece. |
| Teléfono | Copiar literal; normalizar a `+52` + 10 dígitos solo si está completo. Si hay varios, registrar el principal y los demás en el dossier. |
| WhatsApp | Solo si se publica explícitamente como WhatsApp (enlace `wa.me`, botón o texto). Un teléfono fijo no es WhatsApp. |
| Correo | Solo si aparece escrito o en un enlace `mailto:`. **Nunca** suponer `contacto@`, `info@`, etc. |
| Decisor | Solo si el sitio o perfil del negocio lo presenta (ej. "Dra. X, directora"). Registrar URL. No buscar datos personales en otras fuentes. No registrar celulares personales ni redes personales. |
| Servicios | Solo los listados por el negocio; citar la URL. |
| Reseñas | Número, calificación y, si aplica, citas breves (≤20 palabras) de reseñas relevantes con fecha. Sin nombres de los autores. |

Si un dato no se encuentra: dejarlo vacío y añadirlo a `campos_no_encontrados`.

### Paso 4 — Señales de oportunidad
Evaluar el catálogo de señales de `data/crm-schema.md`. Para cada señal detectada registrar en el dossier y en `evidencias`:
- `observacion`: hecho concreto y medible ("El sitio muestra 'Copyright 2016' en el pie", "A 375 px de ancho el menú se desborda y aparece scroll horizontal").
- `url`, `fecha_verificacion`, `metodo`.

Verificaciones recomendadas:
- **Sitio**: ¿carga? ¿HTTPS? ¿vista móvil? ¿botón de cita/WhatsApp? ¿año de copyright? ¿formulario visible con error? Tiempo de carga si hay herramienta disponible (registrar el valor y la herramienta).
- **Agenda**: ¿existe reserva en línea (sitio, Doctoralia, Google "Reservar")? ¿texto "citas solo por teléfono"?
- **WhatsApp**: ¿publica número? ¿tiene enlace click-to-chat?
- **Reseñas**: últimas 20 reseñas: menciones de "no contestan", "difícil agendar"; proporción con respuesta del dueño.
- **Perfil de Google**: ¿tiene sitio, horario, fotos recientes? ¿datos coinciden con el sitio?
- **Anuncios**: búsqueda del nombre en la Biblioteca de anuncios de Meta.
- **Crecimiento**: nueva sucursal, vacantes, nuevos servicios.

Nunca registrar una señal por suposición. Si no se pudo verificar (sitio caído temporalmente, contenido bloqueado), anotarlo como "no verificado" y no sumarla.

### Paso 5 — Salidas
1. Llenar `templates/research-dossier.md` → `data/research/<slug>.md`.
2. Escribir el JSON del candidato en `data/staging/<hoy>/<slug>.json` (sin `lead_id`, sin `calificacion`).
3. Al terminar el lote, añadir `data/staging/<hoy>/_resumen-research.md` con: consultas usadas, candidatos creados, duplicados, descartes y motivos, fuentes con problemas de acceso.

## Criterios de calidad (autoverificación antes de entregar)
- [ ] Cada dato de contacto tiene URL de origen en el dossier.
- [ ] Ningún correo/teléfono fue deducido o completado.
- [ ] Cada señal tiene observación concreta, URL, fecha y método.
- [ ] Se comprobó duplicado y supresión.
- [ ] El JSON valida contra `leadCandidate` (campos obligatorios presentes, enums correctos).
- [ ] No se guardaron datos personales innecesarios (celulares personales, direcciones particulares, datos de pacientes, nombres de autores de reseñas).

## Integraciones futuras
Con herramientas de navegación (ver `workflows/integrations/browser-tools.md`) el Paso 4 se hará con capturas de vista móvil y medición de rendimiento. Con Google Places API autorizada, el Paso 1 usará la API en lugar de navegación. El formato de salida no cambia.
