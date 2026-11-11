import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { setup, bearer, REPO } from "./helpers.mjs";

const WF_DIR = join(REPO, "integrations", "n8n", "workflows");
const FORBIDDEN_NODES = /(emailSend|gmail|whatsApp|twilio|telegram|slack|discord|sendGrid|mailgun|smtp|microsoftOutlook|vonage|messageBird|form)/i;

test("n8n: 7 workflows válidos, inactivos, sin nodos de envío y solo contra la API propia", () => {
  const files = readdirSync(WF_DIR).filter((f) => f.endsWith(".json"));
  assert.equal(files.length, 7);
  for (const f of files) {
    const wf = JSON.parse(readFileSync(join(WF_DIR, f), "utf8"));
    assert.equal(wf.active, false, f);
    for (const n of wf.nodes) {
      assert.ok(!FORBIDDEN_NODES.test(n.type), `${f}: nodo prohibido ${n.type}`);
      if (n.type === "n8n-nodes-base.httpRequest") {
        assert.match(n.parameters.url, /^=\{\{ \(\$env\.WW_API_BASE/, `${f}: URL externa`);
        const path = n.parameters.url.split("}}")[1];
        const method = n.parameters.method || "GET";
        assert.ok((method === "GET" && /^\/api\/(events|summary|followups|review\/pending|jobs\/pending|drafts\/pending|prospecting)$/.test(path))
          || (method === "POST" && /^\/api\/integrations\/n8n\/(tasks|event)$/.test(path)), `${f}: ${method} ${path} no permitido`);
      }
    }
  }
});

test("n8n: cada llamada de los workflows funciona contra el Worker con N8N_TOKEN", async () => {
  const { call } = await setup({ seed: "real" });
  const n = bearer(call, "tok-n8n-0123456789abcdef");
  for (const p of ["/api/events?since=&limit=500", "/api/summary", "/api/followups", "/api/review/pending", "/api/jobs/pending", "/api/drafts/pending", "/api/prospecting"])
    assert.equal((await n.get(p)).status, 200, p);
  assert.equal((await n.post("/api/integrations/n8n/event", { evento: "reporte_diario", entidad: "sistema", detalle: { a: 1 } })).status, 200);
  assert.equal((await n.post("/api/integrations/n8n/tasks", { tipo: "revisar_candidato", titulo: "Revisar candidato X" })).status, 200);
});

test("seguridad estática: el Worker solo hace peticiones salientes a DENUE y a las claves de Cloudflare Access", () => {
  const dir = join(REPO, "cloudflare", "src");
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".js"))) {
    const src = readFileSync(join(dir, f), "utf8");
    const fetches = [...src.matchAll(/(?<![.\w])(?<!async )fetch\(/g)].length + [...src.matchAll(/fetchImpl\(/g)].length;
    if (f === "denue.js") assert.ok(src.includes("DENUE_BASE"));
    else if (f === "auth.js") assert.match(src, /cloudflareaccess\.com\/cdn-cgi\/access\/certs|\/cdn-cgi\/access\/certs/);
    else assert.equal(fetches, 0, `${f} no debe hacer peticiones salientes`);
    assert.ok(!/smtp|sendmail|whatsapp\.com\/v|graph\.facebook|twilio|mailchannels|resend\.com|sendgrid/i.test(src), `${f}: integración de envío`);
  }
  const routes = readFileSync(join(dir, "index.js"), "utf8").match(/"\/api\/[^"]+"/g);
  assert.ok(!routes.some((r) => /send|enviar|whatsapp|email|sms|mail/i.test(r)), "ruta de envío");
});

test("seguridad: secretos fuera del repositorio y wrangler.toml sin valores sensibles", () => {
  const w = readFileSync(join(REPO, "cloudflare", "wrangler.toml"), "utf8");
  assert.ok(!/(AUTH_USERS|DENUE_TOKEN|WORKER_TOKEN|N8N_TOKEN)\s*=/.test(w));
  assert.match(w, /workers_dev = false/);
  // Dominio autorizado el 2026-11-11: solo sales.webwizards.click como dominio personalizado. Otro dominio = nueva autorización.
  const rutas = [...w.matchAll(/^\s*pattern\s*=\s*"([^"]+)"/gm)].map((m) => m[1]);
  assert.deepEqual(rutas, ["sales.webwizards.click"], "solo el dominio autorizado puede estar activo");
  assert.match(w, /^\s*custom_domain\s*=\s*true/m);
  assert.doesNotMatch(w, /^\s*zone_name\s*=|^\s*routes\s*=/m, "sin rutas adicionales fuera del bloque autorizado");
});
