# Web Wizards Sales OS

Sistema de prospección comercial para Web Wizards: investigación con evidencia, calificación A/B/C explicable, CRM validado, borradores con aprobación humana, seguimiento y motor de prospección. **Nunca envía mensajes ni llena formularios.**

## Iniciar (local)

```bash
bin/ww user ana "Ana Apellido"   # primera vez: crea tu usuario (pide contraseña)
bin/ww dev                       # dashboard + API con login y D1 local → http://127.0.0.1:8787
```

Sin dependencias de npm: Python 3.11+ y Node 22+ (usa `node:sqlite`). El dashboard clásico sobre CSV sigue disponible con `bin/ww dashboard` (http://127.0.0.1:8765).

## Comandos

| Para | Comando |
|---|---|
| Dashboard con login (Worker + D1 local) | `bin/ww dev` |
| Investigador del Mac (bucle) / una pasada | `bin/ww investigator` / `bin/ww sync` |
| n8n local | `bin/ww n8n` |
| Pruebas | `bin/ww test` |
| Verificar requisitos y conexiones | `bin/ww check` |
| CSV → D1 local + reconciliación | `bin/ww migrate` |
| Usuarios y tokens | `bin/ww user <u> "Nombre"`, `bin/ww token` |

**Requieren el Mac encendido:** `bin/ww dev` (si usas el modo local), `bin/ww investigator` y n8n local. En producción el dashboard y la API viven en Cloudflare; solo el investigador y n8n dependen del Mac.

## Documentación
- [docs/DESPLIEGUE.md](docs/DESPLIEGUE.md) — Cloudflare (Workers + D1), DNS, secretos y rollback.
- [docs/OPERACION.md](docs/OPERACION.md) — uso diario.
- [docs/ARQUITECTURA.md](docs/ARQUITECTURA.md) — componentes y seguridad.
- [docs/INTEGRACIONES.md](docs/INTEGRACIONES.md) — DENUE, OSM, n8n, servicios de pago.
- [integrations/n8n/README.md](integrations/n8n/README.md) — workflows.
- [ROADMAP.md](ROADMAP.md) · [CLAUDE.md](CLAUDE.md) · [workflows/guardrails.md](workflows/guardrails.md)
