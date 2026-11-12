# Despliegue en Cloudflare

Arquitectura: un Worker (`cloudflare/src/`) que sirve la API y el dashboard (Workers Static Assets, sucesor de Pages; no hay proyecto de Pages) + D1 (`ww-sales`). Plan gratuito, sin costos. Cada paso con `wrangler` lo ejecuta una persona: el proyecto bloquea `wrangler` para Claude (regla `deny` + hook).

## Estado actual (2026-11-11)

| Recurso | Estado |
|---|---|
| Cuenta | `8e4896ac9309fad8549f56a181ba267c` |
| D1 `ww-sales` | Creada, región **WNAM**, `database_id = 5d9a0e11-a098-48ec-ad8c-0bf8a5f3608b`. Migraciones 0001–0003 aplicadas; seed cargado (4 leads, 6 interacciones, 0 bajas). |
| Worker `ww-sales` | **Producción en https://sales.webwizards.click** (dominio personalizado). `workers_dev = false`: la dirección workers.dev responde 404. |
| Zona DNS `webwizards.click` | **Active en Cloudflare** (nameservers `asa`/`kobe.ns.cloudflare.com` puestos en Namecheap, donde sigue registrado el dominio). `@` y `www` en DNS only hacia Vercel (landing). |
| Secretos | `AUTH_USERS` cargado. Faltan `WORKER_TOKEN` (solo investigador), `N8N_TOKEN`, `EVENTS_TOKEN`, `DENUE_TOKEN`, `CF_ACCESS_*` (opcionales). |
| Correo | Pendiente: Cloudflare Email Routing para `contacto@webwizards.click` (sustituye los 5 MX `eforward*` y el SPF de Namecheap) + DMARC `p=none`. |
| Pendientes | Desactivar Cloudflare Web Analytics para `sales` (la CSP bloquea su script; el CRM no debe llevar analítica). Recomendado: Cloudflare Access. |

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

## Dominio (hecho el 2026-11-11)
1. Zona `webwizards.click` activa en Cloudflare: registros de Vercel (`@`, `www`) en **DNS only** antes de cambiar los nameservers en Namecheap; sin DNSSEC durante la transición.
2. `[[routes]] pattern = "sales.webwizards.click"` con `custom_domain = true`; el despliegue creó el DNS y el certificado. **Solo se puede desplegar con la zona Active.**
3. `tests/worker/n8n_security.test.mjs` exige `workers_dev = false` y que la única ruta sea `sales.webwizards.click`: otro dominio requiere nueva autorización.
4. Recomendado: Cloudflare Access (Zero Trust, gratis hasta 50 usuarios) delante del dominio; define `CF_ACCESS_TEAM_DOMAIN` y `CF_ACCESS_AUD` y el Worker validará el JWT.
5. Más adelante: activar DNSSEC en Cloudflare y publicar el DS en Namecheap.

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
- Al activar la zona, Cloudflare Web Analytics inyecta `static.cloudflareinsights.com/beacon.min.js`; la CSP lo bloquea (correcto). Se desactiva en el panel para `sales`, no se relaja la CSP.

## Rollback
- Código: `npx wrangler rollback` (versión anterior) o `npx wrangler rollback <VERSION_ID>`.
- Datos: `npx wrangler d1 time-travel restore ww-sales --timestamp=<RFC3339>` (últimos 30 días).
- Copia antes de cambios: `npx wrangler d1 export ww-sales --remote --output respaldo.sql`, y reversa a CSV: `python3 scripts/d1_migrate.py export-csv --sql respaldo.sql --out data/exports/d1`.
- Los CSV originales y `backups/` nunca se modifican.
