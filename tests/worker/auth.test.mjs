import { test } from "node:test";
import assert from "node:assert/strict";
import { setup, loginAs, HOST, PASSWORD } from "./helpers.mjs";

test("sin sesión no hay datos: todo /api/* devuelve 401 salvo /api/health", async () => {
  const { call } = await setup({ seed: "real" });
  for (const p of ["/api/summary", "/api/leads", "/api/leads/WW-20261111-001", "/api/research", "/api/drafts", "/api/export/leads.csv", "/api/events", "/api/config"])
    assert.equal((await call(p)).status, 401, p);
  const h = await call("/api/health");
  assert.equal(h.status, 200); assert.equal(Object.keys(h.body).includes("leads"), false);
});

test("login: credenciales incorrectas → 401, correctas → cookie HttpOnly SameSite=Strict", async () => {
  const { call } = await setup({ seed: null });
  assert.equal((await loginAs(call, "ana", "mala")).status, 401);
  assert.equal((await loginAs(call, "nadie", PASSWORD)).status, 401);
  const s = await loginAs(call);
  assert.equal(s.status, 200);
  assert.match(s.setCookie, /HttpOnly/); assert.match(s.setCookie, /SameSite=Strict/);
  assert.equal(s.session.nombre, "Ana Revisora");
});

test("cookie Secure y prefijo __Host- en producción", async () => {
  const { call } = await setup({ seed: null, extraVars: { COOKIE_SECURE: "true" } });
  const r = await call("/api/login", { method: "POST", headers: { "Content-Type": "application/json", Origin: HOST }, body: JSON.stringify({ usuario: "ana", password: PASSWORD }) });
  assert.match(r.headers.get("set-cookie"), /^__Host-ww_session=.*; Secure/);
});

test("límite de intentos de login → 429", async () => {
  const { call } = await setup({ seed: null });
  let last;
  for (let i = 0; i < 7; i++) last = await loginAs(call, "ana", "incorrecta" + i);
  assert.equal(last.status, 429);
});

test("CSRF, origen y host: POST sin token, con origen ajeno o host no permitido se rechaza", async () => {
  const { call } = await setup({ seed: "demo" });
  const s = await loginAs(call);
  const p = "/api/config";
  assert.equal((await s.post(p, { objetivo_diario_calificados: 31 }, { "X-WW-Token": "malo" })).status, 403);
  assert.equal((await s.post(p, { objetivo_diario_calificados: 31 }, { Origin: "https://atacante.example" })).status, 403);
  const r = await call(p, { method: "POST", headers: { Cookie: s.cookie, "X-WW-Token": s.csrf, "Content-Type": "application/json" }, body: "{}" });
  assert.equal(r.status, 403, "POST sin Origin");
  const bad = await (await import("../../cloudflare/src/index.js")).default.fetch(new Request("http://evil.example/api/summary", { headers: { Cookie: s.cookie } }), (await setup({ seed: null })).env, { waitUntil() {} });
  assert.equal(bad.status, 421);
  assert.equal((await s.post(p, { objetivo_diario_calificados: 31 }, { "Content-Type": "text/plain" })).status, 415);
});

test("logout revoca la sesión", async () => {
  const { call } = await setup({ seed: null });
  const s = await loginAs(call);
  assert.equal((await s.post("/api/logout", {})).status, 200);
  assert.equal((await s.get("/api/session")).status, 401);
});

test("cabeceras de seguridad en API y dashboard", async () => {
  const { call } = await setup({ seed: null });
  for (const p of ["/api/health", "/", "/app.js"]) {
    const r = await call(p);
    assert.match(r.headers.get("content-security-policy"), /default-src 'self'/, p);
    assert.equal(r.headers.get("x-frame-options"), "DENY", p);
    assert.match(r.headers.get("strict-transport-security"), /max-age/, p);
  }
});

test("métodos de borrado/reemplazo → 405", async () => {
  const { call } = await setup({ seed: null });
  for (const m of ["DELETE", "PUT", "PATCH"]) assert.equal((await call("/api/leads", { method: m })).status, 405);
});
