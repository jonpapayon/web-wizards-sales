// Autenticación del dashboard: usuarios en el secreto AUTH_USERS (JSON con hashes PBKDF2), sesiones en D1,
// cookie HttpOnly + SameSite=Strict (+ Secure y prefijo __Host- en producción), token CSRF por sesión,
// límite de intentos y, opcionalmente, Cloudflare Access delante (CF_ACCESS_TEAM_DOMAIN + CF_ACCESS_AUD).
import { first, q, run, auditStmt } from "./db.js";
import { nowIso, CRMError } from "./rules.js";

const SESSION_HOURS = 12;
const enc = new TextEncoder();
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const b64url = (buf) => b64(buf).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64 = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
export const randomToken = (n = 32) => b64url(crypto.getRandomValues(new Uint8Array(n)));

async function sha256(s) { return b64url(await crypto.subtle.digest("SHA-256", enc.encode(s))); }
export async function safeEqual(a, b) {  // comparación en tiempo constante vía hash
  if (typeof a !== "string" || typeof b !== "string" || !a || !b) return false;
  const [x, y] = await Promise.all([sha256(a), sha256(b)]);
  let d = x.length ^ y.length; for (let i = 0; i < Math.min(x.length, y.length); i++) d |= x.charCodeAt(i) ^ y.charCodeAt(i); return d === 0;
}

// Formato: pbkdf2_sha256$<iteraciones>$<sal base64>$<hash base64>  (generar con: python3 scripts/ww_auth.py hash)
export async function verifyPassword(password, stored) {
  const [alg, it, salt, hash] = String(stored || "").split("$");
  if (alg !== "pbkdf2_sha256" || !it || !salt || !hash) return false;
  const iterations = Math.min(parseInt(it, 10), 100000);  // límite de PBKDF2 en Workers
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: fromB64(salt), iterations }, key, 256);
  return safeEqual(b64(bits), hash);
}

export function users(env) {
  try { const u = JSON.parse(env.AUTH_USERS || "[]"); return Array.isArray(u) ? u : []; } catch { return []; }
}

export const cookieName = (env) => (env.COOKIE_SECURE === "false" ? "ww_session" : "__Host-ww_session");
function cookie(env, value, maxAge) {
  return `${cookieName(env)}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${env.COOKIE_SECURE === "false" ? "" : "; Secure"}`;
}
const readCookie = (req, name) => (req.headers.get("Cookie") || "").split(/;\s*/).map((c) => c.split("=")).find(([k]) => k === name)?.[1];
export const clientIp = (req) => req.headers.get("CF-Connecting-IP") || req.headers.get("X-Real-IP") || "local";

export async function rateLimit(env, key, limit, windowSec) {
  if (env.RATE_LIMITER && windowSec <= 60) {
    const { success } = await env.RATE_LIMITER.limit({ key });
    if (!success) return false;
  }
  const win = String(Math.floor(Date.now() / 1000 / windowSec));
  const r = await first(env, `INSERT INTO rate_limits (clave, ventana, conteo) VALUES (?, ?, 1)
    ON CONFLICT (clave, ventana) DO UPDATE SET conteo = conteo + 1 RETURNING conteo`, key, win);
  return (r?.conteo || 0) <= limit;
}

export async function login(env, req, body) {
  const ip = clientIp(req);
  const usuario = String(body.usuario || "").trim().toLowerCase().slice(0, 64);
  if (!(await rateLimit(env, `login-ip:${ip}`, 10, 900)) || !(await rateLimit(env, `login-user:${usuario}`, 5, 900)))
    throw new CRMError("Demasiados intentos. Espera 15 minutos.", 429);
  const u = users(env).find((x) => String(x.usuario).toLowerCase() === usuario);
  const ok = u ? await verifyPassword(String(body.password || ""), u.hash) : await verifyPassword("x", "pbkdf2_sha256$1000$AAAA$AAAA");
  if (!u || !ok) {
    await auditStmt(env, "auth.fallo", "anonimo", usuario || "-", { ip }).run();
    throw new CRMError("Usuario o contraseña incorrectos.", 401);
  }
  const sid = randomToken(32), csrf = randomToken(24);
  const exp = new Date(Date.now() + SESSION_HOURS * 3600e3).toISOString();
  await env.DB.batch([
    q(env, "INSERT INTO sessions (id_hash,usuario,nombre,csrf,creado_en,expira_en,ip) VALUES (?,?,?,?,?,?,?)", await sha256(sid), u.usuario, u.nombre || u.usuario, csrf, nowIso(), exp, ip),
    auditStmt(env, "auth.login", u.usuario, u.usuario, { ip }),
  ]);
  return { setCookie: cookie(env, sid, SESSION_HOURS * 3600), session: { usuario: u.usuario, nombre: u.nombre || u.usuario, csrf } };
}

export async function getSession(env, req) {
  const sid = readCookie(req, cookieName(env));
  if (!sid) return null;
  const s = await first(env, "SELECT * FROM sessions WHERE id_hash = ? AND revocada = 0", await sha256(sid));
  if (!s || s.expira_en < new Date().toISOString()) return null;
  return s;
}

export async function logout(env, req) {
  const sid = readCookie(req, cookieName(env));
  if (sid) await run(env, "UPDATE sessions SET revocada = 1 WHERE id_hash = ?", await sha256(sid));
  return cookie(env, "", 0);
}

// Tokens de máquina (investigador, n8n, eventos). Comparación en tiempo constante.
export async function machineScope(env, req) {
  const h = req.headers.get("Authorization") || "";
  const t = h.startsWith("Bearer ") ? h.slice(7) : req.headers.get("X-WW-Events-Token") || "";
  if (!t) return null;
  if (env.WORKER_TOKEN && (await safeEqual(t, env.WORKER_TOKEN))) return "worker";
  if (env.N8N_TOKEN && (await safeEqual(t, env.N8N_TOKEN))) return "n8n";
  if (env.EVENTS_TOKEN && (await safeEqual(t, env.EVENTS_TOKEN))) return "events";
  return null;
}

// Cloudflare Access (opcional): verifica el JWT RS256 de Cf-Access-Jwt-Assertion contra las claves del equipo.
let jwksCache = { at: 0, keys: [] };
export async function verifyAccess(env, req) {
  if (!env.CF_ACCESS_TEAM_DOMAIN || !env.CF_ACCESS_AUD) return true;
  const jwt = req.headers.get("Cf-Access-Jwt-Assertion");
  if (!jwt) return false;
  const [h, p, s] = jwt.split(".");
  if (!s) return false;
  const header = JSON.parse(new TextDecoder().decode(fromB64(h))), payload = JSON.parse(new TextDecoder().decode(fromB64(p)));
  if (Date.now() - jwksCache.at > 3600e3) {
    const r = await fetch(`https://${env.CF_ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`);
    jwksCache = { at: Date.now(), keys: (await r.json()).keys || [] };
  }
  const jwk = jwksCache.keys.find((k) => k.kid === header.kid);
  if (!jwk) return false;
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, fromB64(s), enc.encode(`${h}.${p}`));
  const aud = [].concat(payload.aud || []);
  return ok && aud.includes(env.CF_ACCESS_AUD) && payload.exp * 1000 > Date.now();
}
