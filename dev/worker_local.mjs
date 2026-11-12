#!/usr/bin/env node
// Ejecuta el Worker REAL (cloudflare/src/index.js) en local, sin wrangler: D1 emulado con node:sqlite, assets desde app/static.
//   node dev/worker_local.mjs [--port 8787] [--db data/d1/local.sqlite] [--vars .dev.vars]
// Solo escucha en 127.0.0.1. Secretos: archivo .dev.vars (no versionado) o variables de entorno.
import http from "node:http";
import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { dirname, extname, join, resolve, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { D1Shim, applyMigrations } from "./d1_shim.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const PORT = parseInt(arg("port", process.env.WW_DEV_PORT || "8787"), 10);
const DB_PATH = resolve(REPO, arg("db", "data/d1/local.sqlite"));
const VARS = resolve(REPO, arg("vars", ".dev.vars"));
const STATIC = join(REPO, "app", "static");
const MIME = { ".html": "text/html; charset=utf-8", ".js": "application/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };
const KEYS = ["AUTH_USERS", "DENUE_TOKEN", "WORKER_TOKEN", "AGENT_TOKEN", "N8N_TOKEN", "EVENTS_TOKEN", "CF_ACCESS_TEAM_DOMAIN", "CF_ACCESS_AUD", "WW_ENTORNO"];

export function loadVars(file) {
  const v = {};
  if (existsSync(file)) for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (!m) continue;
    let val = m[2]; if (/^(['"]).*\1$/.test(val)) val = val.slice(1, -1); v[m[1]] = val;
  }
  for (const k of KEYS) if (process.env[k] && !v[k]) v[k] = process.env[k];
  return v;
}

export function makeEnv({ dbPath = DB_PATH, port = PORT, vars = loadVars(VARS) } = {}) {
  if (dbPath !== ":memory:") mkdirSync(dirname(dbPath), { recursive: true });
  const DB = new D1Shim(dbPath);
  applyMigrations(DB, join(REPO, "cloudflare", "migrations"));
  const ASSETS = { async fetch(req) {
    let p = normalize(decodeURIComponent(new URL(req.url).pathname)).replace(/^(\.\.[/\\])+/, "");
    let file = join(STATIC, p === "/" ? "index.html" : p);
    if (!file.startsWith(STATIC) || !existsSync(file) || !extname(file)) file = join(STATIC, "index.html");
    return new Response(readFileSync(file), { headers: { "Content-Type": MIME[extname(file)] || "application/octet-stream" } });
  } };
  return { DB, ASSETS, COOKIE_SECURE: "false", ALLOWED_HOSTS: `127.0.0.1:${port},localhost:${port}`, WW_ENTORNO: vars.WW_ENTORNO || "real", ...vars };
}

export async function serve({ port = PORT, env } = {}) {
  const worker = (await import("../cloudflare/src/index.js")).default;
  const srv = http.createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c);
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) if (!["host", "connection", "content-length", "transfer-encoding"].includes(k)) headers.set(k, Array.isArray(v) ? v.join(", ") : v);
    const r = new Request(`http://${req.headers.host || `127.0.0.1:${port}`}${req.url}`, { method: req.method, headers,
      body: ["GET", "HEAD"].includes(req.method) ? undefined : Buffer.concat(chunks) });
    try {
      const resp = await worker.fetch(r, env, { waitUntil() {} });
      const out = {}; resp.headers.forEach((v, k) => { out[k] = v; });
      const cookies = resp.headers.getSetCookie ? resp.headers.getSetCookie() : [];
      if (cookies.length) out["set-cookie"] = cookies;
      res.writeHead(resp.status, out);
      res.end(Buffer.from(await resp.arrayBuffer()));
    } catch (e) { console.error(e); res.writeHead(500); res.end("error"); }
  });
  await new Promise((ok) => srv.listen(port, "127.0.0.1", ok));
  return srv;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const env = makeEnv();
  const n = (await env.DB.prepare("SELECT COUNT(*) n FROM leads").first()).n;
  if (!env.AUTH_USERS) console.warn("AVISO: AUTH_USERS no definido en .dev.vars → nadie puede iniciar sesión. Crea uno con: python3 scripts/ww_auth.py add-user <usuario> \"Nombre\"");
  await serve({ port: PORT, env });
  console.log(`Web Wizards Sales OS (Worker local, D1 emulado) → http://127.0.0.1:${PORT}  · base: ${DB_PATH} · leads: ${n}`);
}
