# research/ — motor de investigación (solo lectura)

| Módulo | Función |
|---|---|
| `fetch.py` | Cliente HTTP GET/HEAD. Desactivado salvo `WW_RESEARCH_NETWORK=1`. robots.txt, límite de frecuencia y tamaño, sin destinos privados, sin credenciales. |
| `site_audit.py` | Analiza el HTML crudo de un sitio y comprueba el estado de sus enlaces: enlaces rotos (incluidos los de cita), dominios que no resuelven, HTTPS, viewport, copyright, WhatsApp que no coincide, ausencia de click-to-chat, formularios (solo presencia). Evidencias con confianza «alta». |
| `discover.py` | Descubre negocios por nicho y ciudad en OpenStreetMap (preparado: DENUE y Google Places). Marca duplicados y exclusiones del CRM. |

Probado sin red con `tests/test_research.py` (fixture `tests/fixtures/sitio_con_problemas.html`). Uso con red: ver `docs/OPERACION.md` §2.
