# Integraciones, fuentes de datos y servicios de pago

## Estado (actualizado: arquitectura Cloudflare)

| Integración | Estado real | Falta |
|---|---|---|
| Cloudflare Workers + D1 | Código, migraciones y configuración listos; probado localmente con D1 emulado | Login de wrangler, crear D1, secretos, autorización de despliegue |
| Dominio `sales.webwizards.click` | Ruta comentada en `wrangler.toml` | Autorización expresa (crea DNS) |
| INEGI DENUE | Conector implementado y probado con respuestas simuladas | `DENUE_TOKEN`; validar SCIAN y primera respuesta real |
| Investigador del Mac | Implementado; probado sin red y de extremo a extremo con red simulada | Instalar Playwright + Chromium; `WORKER_TOKEN`; ejecutar `bin/ww investigator` |
| OpenStreetMap | Adaptador vía investigador | Nada (respeta límites de Overpass; atribución ODbL) |
| n8n Community | 7 workflows + Docker Compose | Docker o `npx n8n`; `N8N_TOKEN` |
| Cloudflare Access | Verificación de JWT implementada | Configurar en Zero Trust (gratis ≤50 usuarios) |

Tabla anterior (modo CSV):

| Integración | Estado | Requiere | Costo |
|---|---|---|---|
| CRM local + dashboard | Activo | — | — |
| Eventos para n8n (`GET /api/events`) | Disponible | `WW_EVENTS_TOKEN` para clientes externos al navegador | — |
| n8n | Preparado (`integrations/n8n/`), sin instancia | Instancia + `N8N_BASE_URL`/`N8N_API_KEY`; decisión de túnel si es remota | n8n self-hosted gratis; n8n Cloud de pago |
| Subagente de investigación (WebSearch/WebFetch) | Activo en Claude Code | — | Consumo de tokens |
| Motor `research/` (OpenStreetMap + auditoría de sitios) | Implementado y probado sin red; **red desactivada** | Autorización de red (ver docs/OPERACION.md §2) | Gratis (OSM: citar © OpenStreetMap contributors, ODbL) |
| INEGI DENUE (directorio oficial de unidades económicas) | Preparado en `research/discover.py` | `DENUE_TOKEN` (registro gratuito en INEGI); validar endpoint en el primer uso | Gratis |
| Google Places API | Preparado (bloqueado en código hasta autorización) | `GOOGLE_PLACES_API_KEY`, proyecto de Google Cloud con facturación | De pago por solicitud; revisar la tarifa vigente de Google Maps Platform antes de activar |
| Playwright (MCP) | No disponible | Chrome/Chromium para el servidor MCP (configuración de usuario fuera del proyecto) | Gratis |
| WhatsApp Business Cloud API | No conectado | Cuenta Meta verificada, número dedicado; solo con consentimiento (`policies/consent.md`) | Por conversación/mensaje según Meta |
| Email saliente | No conectado (prohibido en esta fase) | Dominio con SPF/DKIM/DMARC; decisión explícita | — |

## Fuentes de descubrimiento (legales y técnicamente viables)

| Fuente | Cómo | Calidad esperada |
|---|---|---|
| Sitio propio del negocio | Lectura pública (subagente o `research/site_audit`) | La mejor para evidencia de problemas |
| INEGI DENUE | API oficial con token | Cobertura amplia de negocios formales; datos de contacto a veces desactualizados |
| OpenStreetMap | Overpass API | Gratuita; cobertura parcial en México |
| Directorios (Doctoralia, Top Doctors, Sección Amarilla) | Lectura pública respetando sus términos; sin extracción masiva | Útiles para identidad y teléfono; confirmar en el sitio del negocio |
| Colegios y asociaciones (p. ej. colegios de cirujanos dentistas estatales) | Lectura pública de padrones publicados | Identidad del profesional, no del negocio |
| Google Maps | Solo mediante Places API autorizada; no se extrae la web de Maps | Reseñas y calificación (suman puntos de capacidad) |

No se usa scraping que evada CAPTCHAs, inicios de sesión o límites de uso.

## n8n
Guía y workflows: `integrations/n8n/README.md`. El sistema no hace llamadas salientes: n8n consulta los eventos.

## Variables de entorno
Plantilla sin valores: `.env.example`. Nunca guardar valores reales en el proyecto.

| Variable | Uso |
|---|---|
| `WW_PORT` | Puerto local (8765) |
| `WW_EVENTS_TOKEN` | Acceso de n8n a `/api/events` |
| `WW_RESEARCH_NETWORK` | `1` activa la red del motor `research/` (requiere autorización) |
| `N8N_BASE_URL`, `N8N_API_KEY` | Futuro: administración de workflows |
| `DENUE_TOKEN` | INEGI DENUE |
| `GOOGLE_PLACES_API_KEY` | Google Places (de pago) |
| `WHATSAPP_CLOUD_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` | Futuro, solo con consentimiento |
| `WW_ROOT` | Raíz alternativa de datos (demo/pruebas) |
| `WW_ACTOR` | Nombre del actor por defecto para `crm_tool.py` |
