# Despliegue en Cloudflare

Arquitectura: un Worker (`cloudflare/src/`) que sirve la API y el dashboard (Workers Static Assets, sucesor de Pages; no hay proyecto de Pages) + D1 (`ww-sales`). Plan gratuito, sin costos. Cada paso con `wrangler` lo ejecuta una persona: el proyecto bloquea `wrangler` para Claude (regla `deny` + hook).

## Estado actual (2026-11-11)

| Recurso | Estado |
|---|---|
| Cuenta | `8e4896ac9309fad8549f56a181ba267c` |
| D1 `ww-sales` | Creada, región **WNAM**, `database_id = 5d9a0e11-a098-48ec-ad8c-0bf8a5f3608b`. Migraciones 0001–0003 aplicadas; seed cargado (4 leads, 6 interacciones, 0 bajas). |
| Worker `ww-sales` | Desplegado en **https://ww-sales.whyjonpapayon.workers.dev** (temporal). |
| Secretos | `AUTH_USERS` cargado. Faltan `WORKER_TOKEN` (solo investigador), `N8N_TOKEN`, `EVENTS_TOKEN`, `DENUE_TOKEN`, `CF_ACCESS_*` (opcionales). |
| Dominio `sales.webwizards.click` | **No conectado.** Sin cambios de DNS. |

Mientras dure la prueba en workers.dev, `wrangler.toml` tiene dos cambios temporales que se revierten al conectar el dominio (ver «Conectar el dominio»):
- `workers_dev = true`
- `ALLOWED_HOSTS` incluye `ww-sales.whyjonpapayon.workers.dev`

La prueba `tests/worker/n8n_security.test.mjs` (exige `workers_dev = false`) falla a propósito mientras tanto: es el recordatorio de revertir.

## Local primero
```bash
python3 scripts/build_worker_content.py           # políticas → cloudflare/src/generated/content.js
python3 scripts/d1_migrate.py build-seed           # cloudflare/seed/seed_real.sql (NO versionar: datos de contacto)
python3 scripts/d1_migrate.py apply-local          # data/d1/local.sqlite (solo si no existe)
python3 scripts/d1_migrate.py reconcile --db data/d1/local.sqlite
python3 scripts/ww_auth.py add-user <usuario> "Nombre Apellido"   # pide la contraseña (oculta, mín. 12); guarda solo el hash en .dev.vars (600)
echo "WORKER_TOKEN=$(python3 scripts/ww_auth.py token)" >> .dev.vars   # opcional (investigador); `token` solo imprime, no guarda
node dev/worker_local.mjs                          # http://127.0.0.1:8787 (Worker real, D1 emulado; aplica migraciones pendientes)
```

Usuarios: no hay roles; todos los usuarios de `AUTH_USERS` tienen los mismos permisos.

## Producción (requiere tu sesión e intervención)
Todos los comandos desde `cloudflare/`.

1. `npx wrangler login` y `npx wrangler whoami` — **abre el navegador: intervención humana.** Confirma la cuenta.
2. Comprueba que no exista nada con el nombre: `npx wrangler deployments list --name ww-sales` (error 10007 = no existe) y `npx wrangler d1 list`.
3. `npx wrangler d1 create ww-sales` → copia **solo** el `database_id` en `wrangler.toml`. Si Wrangler ofrece añadirlo a la configuración, responde **No**: su fragmento sugiere `binding = "ww_sales"`, pero el código usa `binding = "DB"`. **La región no se puede cambiar después.**
4. `npx wrangler d1 migrations apply ww-sales --remote`
5. `npx wrangler d1 execute ww-sales --remote --file seed/seed_real.sql` (una sola vez; si falla, D1 revierte todo).
6. `npx wrangler deploy --secrets-file ../.dev.vars` — sube los secretos de `.dev.vars` (`AUTH_USERS`, `WORKER_TOKEN`, …) junto con el despliegue sin mostrarlos. Los despliegues posteriores no necesitan `--secrets-file`: los secretos nunca se borran al desplegar. Para añadir uno suelto: `npx wrangler secret put NOMBRE`. Comprobar nombres (no valores): `npx wrangler secret list`.
   - **No despliegues con el `database_id` de ejemplo:** Wrangler puede aprovisionar recursos por su cuenta.
   - Con `workers_dev = false` y sin rutas, el Worker queda sin URL pública. Para probar en `*.workers.dev`, activa `workers_dev = true` y añade el host a `ALLOWED_HOSTS` (si no, el Worker rechaza esas peticiones).

## Conectar el dominio (solo con autorización expresa)
1. En `wrangler.toml`: `workers_dev = false`, quita el host workers.dev de `ALLOWED_HOSTS` y descomenta `[[routes]] pattern = "sales.webwizards.click"`.
2. Actualiza la prueba de `tests/worker/n8n_security.test.mjs` que exige las rutas comentadas, con autorización (es una protección).
3. `npx wrangler deploy` — Cloudflare crea el registro DNS en la zona `webwizards.click`.
4. Recomendado: Cloudflare Access (Zero Trust, gratis hasta 50 usuarios) delante del dominio; define `CF_ACCESS_TEAM_DOMAIN` y `CF_ACCESS_AUD` y el Worker validará el JWT. También puede activarse para workers.dev desde el panel durante la prueba.

## Verificación tras desplegar
- `GET /api/health` → `200 {"ok":true,"version":…,"servicio":"ww-sales"}`.
- `GET /api/session` y `GET /api/leads` sin sesión → `401`.
- `/` muestra «Iniciar sesión»; la consola del navegador solo debe mostrar el 401 de `/api/session` (ningún error de CSP).
- Con sesión: el dashboard muestra gráficas y los prospectos esperados.

## Lecciones aprendidas (despliegue del 2026-11-11)
- **D1 limita los patrones `LIKE`/`GLOB` a 50 caracteres** (`LIKE or GLOB pattern too complex: SQLITE_ERROR`). El SQLite local no tiene ese límite, así que las pruebas locales pasaban y D1 rechazaba todos los `INSERT` en `leads`, `interactions` y `followups`. Corregido en `cloudflare/migrations/0003_d1_patrones.sql` (mismas reglas como largo + prefijo + `NOT GLOB '*[^0-9]*'`). `tests/test_migration.py › D1Compat` emula el límite: toda migración nueva debe pasarla.
- **La CSP del Worker (`style-src 'self'`) bloquea los atributos `style`.** El dashboard aplicaba estilos con `setAttribute("style")` y las gráficas se rompían solo en Cloudflare (el servidor Python local usa otra CSP). `app/static/app.js` usa ahora `el.style.cssText`, que la CSP permite. No relajar la CSP; revisar la consola en Cloudflare tras cada cambio de interfaz.
- `cloudflare/package.json` tiene `"deploy": "bash ./deploy.sh"`, pero `deploy.sh` no existe: usa `npx wrangler deploy`.
- `npx wrangler` no tiene versión fijada (desplegado con 4.160.1).

## Rollback
- Código: `npx wrangler rollback` (versión anterior) o `npx wrangler rollback <VERSION_ID>`.
- Datos: `npx wrangler d1 time-travel restore ww-sales --timestamp=<RFC3339>` (últimos 30 días).
- Copia antes de cambios: `npx wrangler d1 export ww-sales --remote --output respaldo.sql`, y reversa a CSV: `python3 scripts/d1_migrate.py export-csv --sql respaldo.sql --out data/exports/d1`.
- Los CSV originales y `backups/` nunca se modifican.
