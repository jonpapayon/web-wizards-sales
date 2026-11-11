// Utilidades para probar el Worker real en Node (D1 emulado en memoria). Nunca usa la red.
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { makeEnv } from "../../dev/worker_local.mjs";
import worker from "../../cloudflare/src/index.js";

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const HOST = "http://127.0.0.1:8787";
export const PASSWORD = "contraseña-de-prueba-123";

export async function pbkdf2(pw, iterations = 100000) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pw), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
  return `pbkdf2_sha256$${iterations}$${Buffer.from(salt).toString("base64")}$${Buffer.from(bits).toString("base64")}`;
}

// seed: "real" (copia en memoria de los 4 prospectos del piloto, solo lectura del archivo) | "demo" | null
export async function setup({ seed = "demo", extraVars = {} } = {}) {
  const vars = { AUTH_USERS: JSON.stringify([{ usuario: "ana", nombre: "Ana Revisora", hash: await pbkdf2(PASSWORD) }]),
    WORKER_TOKEN: "tok-worker-0123456789abcdef", N8N_TOKEN: "tok-n8n-0123456789abcdef", EVENTS_TOKEN: "tok-events-0123456789abcdef", ...extraVars };
  const env = makeEnv({ dbPath: ":memory:", port: 8787, vars });
  if (seed) env.DB.db.exec(readFileSync(join(REPO, "cloudflare", "seed", `seed_${seed}.sql`), "utf8"));
  const ctx = { waitUntil() {} };
  const call = async (path, opt = {}) => {
    const r = await worker.fetch(new Request(HOST + path, opt), env, ctx);
    const text = await r.text(); let body; try { body = JSON.parse(text); } catch { body = text; }
    return { status: r.status, body, headers: r.headers };
  };
  return { env, call, worker, ctx };
}

export async function loginAs(call, usuario = "ana", password = PASSWORD) {
  const r = await call("/api/login", { method: "POST", headers: { "Content-Type": "application/json", Origin: HOST }, body: JSON.stringify({ usuario, password }) });
  if (r.status !== 200) return { status: r.status, body: r.body };
  const cookie = r.headers.get("set-cookie").split(";")[0];
  const s = await call("/api/session", { headers: { Cookie: cookie } });
  const get = (p) => call(p, { headers: { Cookie: cookie } });
  const post = (p, b, h = {}) => call(p, { method: "POST", headers: { Cookie: cookie, Origin: HOST, "X-WW-Token": s.body.token, "Content-Type": "application/json", ...h }, body: JSON.stringify(b) });
  return { status: 200, cookie, csrf: s.body.token, session: s.body, get, post, setCookie: r.headers.get("set-cookie") };
}

export const bearer = (call, token) => ({
  get: (p) => call(p, { headers: { Authorization: `Bearer ${token}` } }),
  post: (p, b) => call(p, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(b) }),
});
