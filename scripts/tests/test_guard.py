#!/usr/bin/env python3
"""Pruebas del hook scripts/hooks/guard.py. Uso: python3 scripts/tests/test_guard.py"""
import json, os, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
GUARD = ROOT / "scripts" / "hooks" / "guard.py"

B = lambda c: {"tool_name": "Bash", "tool_input": {"command": c}}
W = lambda p: {"tool_name": "Write", "tool_input": {"file_path": str(ROOT / p), "content": "x"}}
E = lambda p: {"tool_name": "Edit", "tool_input": {"file_path": str(ROOT / p), "old_string": "a", "new_string": "b"}}
P = lambda t: {"tool_name": f"mcp__playwright__{t}", "tool_input": {}}

CASES = [
    # (descripción, entrada, decisión esperada: deny | ask | pass)
    ("Write directo a leads.csv", W("data/crm/leads.csv"), "deny"),
    ("Edit directo a suppression.csv", E("data/crm/suppression.csv"), "deny"),
    ("Write de dossier permitido", W("data/research/WW-20261111-001.md"), "pass"),
    ("Write de borrador permitido", W("data/outreach/WW-20261111-001-inicial.md"), "pass"),
    ("Write de staging permitido", W("data/staging/2026-11-11/a.json"), "pass"),
    ("Editar settings requiere persona", E(".claude/settings.json"), "ask"),
    ("Editar el hook requiere persona", E("scripts/hooks/guard.py"), "ask"),
    ("Editar política requiere persona", E("policies/opt-out.md"), "ask"),
    ("Activar reglas de aprobación requiere persona", E("workflows/approval-rules.md"), "ask"),
    ("crm_tool permitido", B("python3 scripts/crm_tool.py validate"), "pass"),
    ("crm_tool con JSON whatsapp permitido", B("python3 scripts/crm_tool.py add-interaction --json '{\"canal\":\"whatsapp\"}'"), "pass"),
    ("Lectura de CSV permitida", B("head -5 data/crm/leads.csv"), "pass"),
    ("grep -i sobre CSV permitido", B("grep -i dental data/crm/leads.csv | wc -l"), "pass"),
    ("Anexar con echo a supresión", B("echo 'x' >> data/crm/suppression.csv"), "deny"),
    ("Sobrescribir leads", B("printf '' > data/crm/leads.csv"), "deny"),
    ("sed -i sobre leads", B("sed -i '' 's/true/false/' data/crm/leads.csv"), "deny"),
    ("Python arbitrario sobre CRM", B("python3 -c \"open('data/crm/leads.csv','w')\""), "deny"),
    ("rm del CRM", B("rm data/crm/suppression.csv"), "deny"),
    ("cd a data/crm", B("cd data/crm && ls"), "deny"),
    ("Quitar bandera solo-anexado", B("chflags nouappnd data/crm/suppression.csv"), "deny"),
    ("curl POST", B("curl -X POST https://graph.facebook.com/v1/messages -d x"), "deny"),
    ("curl tras ruta absoluta", B("/usr/bin/curl https://example.com"), "deny"),
    ("wget", B("wget https://example.com"), "deny"),
    ("osascript (Mail/Messages)", B("osascript -e 'tell application \"Messages\" to send'"), "deny"),
    ("open mailto", B("open 'mailto:a@b.com'"), "deny"),
    ("sendmail", B("echo hola | sendmail a@b.com"), "deny"),
    ("smtplib en python", B("python3 -c 'import smtplib'"), "deny"),
    ("requests.post", B("python3 -c 'import requests; requests.post(\"https://x\")'"), "deny"),
    ("gh", B("gh issue create"), "deny"),
    ("git push", B("git push origin main"), "deny"),
    ("pip install", B("pip3 install jsonschema"), "deny"),
    ("grep de la palabra curl en docs permitido", B("grep -rn curl workflows/"), "pass"),
    ("Comando normal permitido", B("ls -la templates"), "pass"),
    ("Playwright navegar permitido", P("browser_navigate"), "pass"),
    ("Playwright captura permitida", P("browser_take_screenshot"), "pass"),
    ("Playwright escribir bloqueado", P("browser_type"), "deny"),
    ("Playwright formulario bloqueado", P("browser_fill_form"), "deny"),
    ("Playwright clic bloqueado", P("browser_click"), "deny"),
    ("Playwright JS bloqueado", P("browser_evaluate"), "deny"),
    ("Editar crm_tool por shell requiere persona", B("sed -i '' 's/a/b/' scripts/crm_tool.py"), "ask"),
    ("Write directo a la base D1 local", W("data/d1/local.sqlite"), "deny"),
    ("Write directo al seed", W("cloudflare/seed/seed_real.sql"), "deny"),
    ("Write a .dev.vars", W(".dev.vars"), "deny"),
    ("sqlite3 sobre la base D1 local", B("sqlite3 data/d1/local.sqlite 'DELETE FROM leads'"), "deny"),
    ("Leer secretos de .dev.vars", B("cat .dev.vars"), "deny"),
    ("Borrar la base D1 local", B("rm data/d1/local.sqlite"), "deny"),
    ("Reconciliar D1 permitido", B("python3 scripts/d1_migrate.py reconcile --db data/d1/local.sqlite"), "pass"),
    ("bin/ww migrate permitido", B("bin/ww migrate"), "pass"),
    ("Desplegar con wrangler requiere persona (deny en settings)", B("npx wrangler deploy"), "deny"),
]


def run(case):
    env = dict(os.environ, CLAUDE_PROJECT_DIR=str(ROOT))
    payload = dict(case, cwd=str(ROOT), hook_event_name="PreToolUse")
    r = subprocess.run([sys.executable, str(GUARD)], input=json.dumps(payload), capture_output=True, text=True, env=env)
    if r.returncode not in (0,):
        return f"error({r.returncode}): {r.stderr.strip()[:120]}"
    if not r.stdout.strip():
        return "pass"
    return json.loads(r.stdout)["hookSpecificOutput"]["permissionDecision"]


fails = 0
for desc, case, exp in CASES:
    got = run(case)
    ok = got == exp
    fails += not ok
    print(f"{'OK ' if ok else 'FALLA'}  {exp:5s} {got:5s}  {desc}")
print(f"\n{len(CASES) - fails}/{len(CASES)} casos correctos")
sys.exit(1 if fails else 0)
