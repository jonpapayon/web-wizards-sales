# Herramientas de navegación e investigación (especificación)

Objetivo: verificar señales de oportunidad con evidencia objetiva (vista móvil, HTTPS, rendimiento, formularios visibles) y reducir el trabajo manual de `lead-research`.

## Opciones
| Herramienta | Uso | Estado |
|---|---|---|
| WebSearch / WebFetch | Descubrimiento y lectura de páginas públicas. | Declaradas en `tools` de `lead-researcher`. Disponibilidad real: ver resultado del piloto en `data/reports/piloto-puebla-2026-11-11.md`. |
| Playwright MCP | Abrir el sitio a 375×812 px, captura de pantalla, comprobar HTTPS, CTA, enlaces `wa.me`, `mailto:`, errores de consola. | Disponible en esta máquina como servidor MCP; **no** asignado a subagentes. Las herramientas que interactúan con páginas (clic, escritura, formularios, JS) están bloqueadas por `.claude/settings.json` y el hook (`workflows/guardrails.md`). |
| PageSpeed Insights API | Medición de rendimiento móvil (`WEB_SLOW`) con valor citable. | Requiere clave de API (pendiente). |
| Google Places API | Descubrimiento estructurado (nombre, teléfono, sitio, reseñas, place_id) conforme a términos de Google. | Requiere proyecto de Google Cloud y facturación (pendiente; implica pagos → autorización explícita). |

## Para habilitar Playwright en `lead-researcher` (cuando se autorice)
Añadir al frontmatter de `.claude/agents/lead-researcher.md` las herramientas necesarias, por ejemplo:
```yaml
tools: Read, Write, Glob, Grep, WebSearch, WebFetch, mcp__playwright__browser_navigate, mcp__playwright__browser_resize, mcp__playwright__browser_snapshot, mcp__playwright__browser_take_screenshot, mcp__playwright__browser_console_messages
```
No asignar herramientas de escritura en páginas (`browser_type`, `browser_fill_form`, `browser_click` sobre formularios): la investigación nunca envía formularios ni mensajes.

## Protocolo de verificación con navegador
1. Abrir el sitio en escritorio y registrar si carga, protocolo y año de copyright.
2. Redimensionar a 375×812: comprobar scroll horizontal, tamaño de texto, menú, botón de WhatsApp/llamada visible sin desplazarse.
3. Buscar enlaces `wa.me`, `api.whatsapp.com`, `tel:`, `mailto:` y sistemas de reserva.
4. Guardar captura en `data/research/capturas/<slug>-movil.png` y referenciarla en el dossier.
5. Registrar errores de consola solo si son visibles para el usuario (formulario roto, recursos caídos).

## Límites
- Respetar `robots.txt` y términos de cada sitio; ritmo humano (pausas entre páginas); sin evasión de bloqueos ni CAPTCHAs.
- No iniciar sesión en Google, Facebook o Instagram para extraer datos.
- No guardar capturas que muestren datos personales de terceros (reseñas con fotos de personas, pacientes).
