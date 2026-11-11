#!/usr/bin/env python3
"""
guard.py — hook PreToolUse de Web Wizards Sales Agent.

Se ejecuta antes de cada Write/Edit/MultiEdit/NotebookEdit/Bash y de las herramientas de Playwright,
en la sesión principal y en los subagentes. Decide:
  deny  → escritura directa en data/crm/, envío de mensajes/formularios, red saliente por shell,
          quitar la protección de solo-anexado, reactivar bajas por vías no controladas.
  ask   → cambios a las propias protecciones, políticas, esquema y reglas de aprobación (requiere persona).
  (nada)→ el flujo normal de permisos decide.

Si este script falla, settings.json lo declara con onFailure "block": la acción se bloquea.
Es una defensa contra errores del agente, no contra un atacante: ver limitaciones en workflows/guardrails.md.
"""
import json, os, re, shlex, sys

data = json.load(sys.stdin)
tool = data.get("tool_name", "")
inp = data.get("tool_input", {}) or {}
project = os.path.realpath(os.environ.get("CLAUDE_PROJECT_DIR") or data.get("cwd") or os.getcwd())


def decide(kind, reason):
    print(json.dumps({"hookSpecificOutput": {"hookEventName": "PreToolUse",
                                             "permissionDecision": kind,
                                             "permissionDecisionReason": f"[guard] {reason}"}}, ensure_ascii=False))
    sys.exit(0)


def rel(path):
    if not path:
        return ""
    p = os.path.realpath(path if os.path.isabs(path) else os.path.join(data.get("cwd") or project, path))
    return os.path.relpath(p, project) if p == project or p.startswith(project + os.sep) else p


PROTECTED_ASK = (".claude/settings.json", ".claude/settings.local.json", "scripts/", "policies/",
                 "data/schema/", "workflows/approval-rules.md", "workflows/guardrails.md", ".claude/agents/")

# ---------------------------------------------------------------- herramientas de archivos
if tool in ("Write", "Edit", "MultiEdit", "NotebookEdit"):
    r = rel(inp.get("file_path") or inp.get("notebook_path") or "")
    if r.startswith("data/crm/") or r == "data/crm":
        decide("deny", "data/crm/ no se edita directamente. Usa: python3 scripts/crm_tool.py <comando> "
                       "(valida esquema, duplicados, supresión y transiciones).")
    if r.startswith(("data/d1/", "cloudflare/seed/")) or r == ".dev.vars":
        decide("deny", f"{r} contiene datos del CRM o secretos: se genera con scripts/d1_migrate.py o scripts/ww_auth.py, no se edita a mano.")
    if any(r == p or r.startswith(p) for p in PROTECTED_ASK):
        decide("ask", f"{r} es parte de las protecciones/políticas del sistema; requiere aprobación de una persona.")
    sys.exit(0)

# ---------------------------------------------------------------- navegador
if tool.startswith("mcp__playwright__"):
    allowed = ("browser_navigate", "browser_navigate_back", "browser_snapshot", "browser_take_screenshot",
               "browser_resize", "browser_console_messages", "browser_network_requests", "browser_tabs",
               "browser_wait_for", "browser_close", "browser_find", "browser_emulate_media")
    if not tool.endswith(allowed):
        decide("deny", f"{tool} puede interactuar con páginas (clics, escritura, formularios, JS). "
                       "La investigación es solo de lectura; enviar formularios o mensajes está bloqueado.")
    sys.exit(0)

# ---------------------------------------------------------------- Bash
if tool != "Bash":
    sys.exit(0)

cmd = inp.get("command", "") or ""
low = cmd.lower()

# 1) Envío de mensajes / red saliente / automatización de apps: bloqueado en cualquier posición del comando.
NET = r"(\bcurl\b|\bwget\b|\bosascript\b|\bsendmail\b|\bsmtplib\b|\baiosmtplib\b|requests\.(post|put|patch)|\bhttpx\b|" \
      r"urllib\.request|http\.client|socket\.socket|\bnodemailer\b|\baxios\b|graph\.facebook\.com|api\.telegram|" \
      r"\btwilio\b|\bfetch\s*\()"
SAFE_READ = {"grep", "rg", "cat", "head", "tail", "wc", "ls", "less", "diff", "sort", "uniq", "cut", "stat", "file"}
segments = re.split(r"(?:\|\||&&|[;|&\n]|\$\(|`)", cmd)


def first_word(seg):
    try:
        toks = shlex.split(seg, posix=True)
    except ValueError:
        toks = seg.split()
    while toks and (re.match(r"^\w+=", toks[0]) or toks[0] in ("sudo", "env", "command", "exec", "nohup", "time", "nice")):
        toks.pop(0)
    return (os.path.basename(toks[0]) if toks else ""), toks


for seg in segments:
    w, toks = first_word(seg)
    if w in ("curl", "wget", "nc", "ncat", "netcat", "telnet", "ssh", "scp", "sftp", "rsync", "ftp", "sendmail",
             "mail", "mailx", "mutt", "msmtp", "osascript", "open", "xdg-open", "gh", "http", "https"):
        decide("deny", f"'{w}' puede enviar datos o mensajes fuera del equipo. Acciones externas bloqueadas en este proyecto.")
    if w in ("git",) and len(toks) > 1 and toks[1] in ("push", "send-email", "remote"):
        decide("deny", "git push/send-email/remote bloqueados: no hay acciones externas en esta fase.")
    if w in ("pip", "pip3", "npm", "npx", "pnpm", "yarn", "brew", "uv", "pipx") or (w.startswith("python") and "-m pip" in seg):
        decide("deny", "Instalar dependencias o ejecutar paquetes remotos está bloqueado en esta fase.")
if re.search(NET, low) and not re.match(r"^\s*python3 scripts/crm_tool\.py\b", cmd):
    if not all(first_word(s)[0] in SAFE_READ for s in segments if s.strip()):
        decide("deny", "El comando contiene una vía de envío/red saliente (HTTP, SMTP, automatización de apps).")

# 2) Protección de solo-anexado de la lista de exclusión.
if re.search(r"\bchflags\b|\bchattr\b|\bxattr\b", low):
    decide("deny", "Cambiar banderas de archivo está bloqueado (protege data/crm/suppression.csv como solo-anexado).")

# 3) data/crm solo mediante crm_tool.py (lectura permitida con herramientas de solo lectura).
READ_ONLY = {"cat", "head", "tail", "wc", "grep", "rg", "cut", "column", "sort", "uniq", "ls", "stat", "file", "less",
             "diff", "awk", "csvlook", "echo", "printf", "test", "["}
WRITE_HINT = re.compile(r"(>>?|\btee\b|\bsed\b[^|;&]*\s-i|\bperl\b[^|;&]*\s-[a-z]*i|\brm\b|\bmv\b|\bcp\b|\bln\b|"
                        r"\btruncate\b|\bdd\b|\binstall\b|\bchmod\b|\btouch\b|\bunlink\b)")
if re.search(r"data/d1/|local\.sqlite|\.dev\.vars|cloudflare/seed/", cmd) and \
        re.search(r"\bsqlite3\b|\bcat\b.*\.dev\.vars|\brm\b|\bmv\b|\bcp\b|>|\btee\b|\btruncate\b|\bdd\b", cmd) and \
        not re.match(r"^\s*(python3 scripts/(d1_migrate|ww_auth)\.py|bin/ww )", cmd):
    decide("deny", "La base D1 local, el seed y .dev.vars solo se manejan con scripts/d1_migrate.py, scripts/ww_auth.py o bin/ww.")

touches_crm = re.search(r"data/crm\b|suppression\.csv|leads\.csv|interactions\.csv|followups\.csv", cmd) or \
    re.search(r"\bcd\s+[\"']?(\./)?data(/crm)?[\"']?\s*($|[;&|])", cmd)
if touches_crm:
    for seg in segments:
        if not re.search(r"data/crm\b|\.csv\b|\bcd\b", seg):
            continue
        w, toks = first_word(seg)
        if re.match(r"^\s*python3 scripts/crm_tool\.py\b", seg.strip()) and not re.search(r"(?<![0-9&])>", seg):
            continue
        if w == "cd" and len(toks) > 1 and re.search(r"(^|/)data(/crm)?/?$", toks[1]):
            decide("deny", "No se permite cd a data/ o data/crm (evita rutas relativas que eludan el control). Usa rutas desde la raíz.")
        if w in READ_ONLY and not WRITE_HINT.search(seg.replace("2>&1", "").replace("2>/dev/null", "")):
            if w == "awk" and re.search(r"system\(|>\s*\"|print\s*>", seg):
                decide("deny", "awk con escritura sobre archivos del CRM bloqueado.")
            continue
        if w == "" or w == "cd":
            continue
        decide("deny", "Los archivos de data/crm/ solo se modifican con 'python3 scripts/crm_tool.py'. "
                       "Lectura permitida con cat/head/grep/wc/cut/sort/awk sin redirección.")

# 4) Cambios a las protecciones mediante shell → requieren persona.
if re.search(r"(\.claude/settings|scripts/hooks|scripts/crm_tool\.py|data/schema/|policies/|approval-rules\.md)", cmd) \
        and WRITE_HINT.search(cmd.replace("2>&1", "").replace("2>/dev/null", "")) \
        and not re.match(r"^\s*python3 scripts/crm_tool\.py\b", cmd):
    decide("ask", "El comando parece modificar archivos de protección/política; requiere aprobación de una persona.")

sys.exit(0)
