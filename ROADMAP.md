# ROADMAP — Web Wizards Sales OS

## Etapa 1 · Sistema local operativo — ✅
CRM con escritura validada (`crm_tool.py`), protecciones técnicas, pruebas, piloto de 4 prospectos de Puebla.

## Etapa 2 · Dashboard conectado al CRM — ✅
Dashboard completo (8 secciones + Prospección), modo demo separado, API sin endpoints de envío.

## Etapa 2b · Arquitectura de producción — ✅ desplegada en prueba (2026-11-11) · ⛔ dominio pendiente de autorización
- Worker de Cloudflare (API + dashboard protegido), D1 con reglas en la base (triggers y restricciones), autenticación con sesiones, CSRF, límites de frecuencia, Cloudflare Access opcional.
- Migración CSV → D1 reversible y reconciliada (`scripts/d1_migrate.py`).
- Hecho: D1 `ww-sales` (WNAM) con migraciones 0001–0003 y los 4 prospectos del piloto; Worker en `https://ww-sales.whyjonpapayon.workers.dev` (temporal); secreto `AUTH_USERS` cargado; `/api/health` 200 y rutas sin sesión 401 verificados.
- Corregido en el despliegue: patrones `LIKE`/`GLOB` incompatibles con D1 (migración 0003) y estilos bloqueados por la CSP en el dashboard.
- Pendiente de ti: confirmar con sesión que el dashboard muestra gráficas y los 4 prospectos; autorizar el dominio `sales.webwizards.click` (revierte `workers_dev` y `ALLOWED_HOSTS` temporales); opcional: Cloudflare Access y `WORKER_TOKEN` (docs/DESPLIEGUE.md).

## Etapa 3 · Investigación comercial ampliada — 🟡 implementada, falta conectar
- Conector DENUE (INEGI) con caché y paginación → falta `DENUE_TOKEN`.
- Investigador del Mac con Playwright (solo lectura, peticiones no-GET abortadas) → falta instalar Playwright y Chromium.
- Adaptador OpenStreetMap vía investigador → listo (respeta las reglas de uso de Overpass).
- Motor de prospección con contadores y área de revisión → listo.
- Pendiente: validar códigos SCIAN y la primera respuesta real del DENUE; medir rendimiento real.

## Etapa 4 · Integración con n8n — 🟡 preparada
7 workflows importables (solo lectura, tareas y eventos). Falta: instancia local (Docker o `npx n8n`) y `N8N_TOKEN`.

## Etapa 5 · Integraciones comerciales autorizadas — ⛔
Aviso de privacidad, criterio REPEP, SPF/DKIM/DMARC, WhatsApp Cloud API solo con consentimiento, activación individual de reglas de aprobación.

## Etapa 6 · 30 prospectos calificados diarios — 📈
Con DENUE + investigador encendido en el Mac: ~200 negocios descubiertos y auditados por día de forma automática (segundos por sitio); la persona revisa candidatos y aprueba borradores (~1–1.5 h diarias). Google Places (de pago) sumaría reseñas a la puntuación.
