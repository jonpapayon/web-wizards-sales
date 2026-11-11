#!/usr/bin/env python3
"""
Gestión de usuarios del dashboard (sin guardar contraseñas en claro en ningún archivo del repositorio).

    python3 scripts/ww_auth.py hash                       # pide contraseña y muestra el hash PBKDF2
    python3 scripts/ww_auth.py add-user jon "Jon Apellido" # añade/actualiza usuario en .dev.vars (local, no versionado)
    python3 scripts/ww_auth.py token                      # genera un token aleatorio (WORKER_TOKEN, N8N_TOKEN, EVENTS_TOKEN)

En producción el JSON resultante se carga como secreto:  npx wrangler secret put AUTH_USERS  (lo pega una persona).
"""
import base64, getpass, hashlib, json, re, secrets, sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
ITER = 100_000  # límite de PBKDF2 en Cloudflare Workers


def make_hash(pw):
    salt = secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac("sha256", pw.encode("utf-8"), salt, ITER, 32)
    return f"pbkdf2_sha256${ITER}${base64.b64encode(salt).decode()}${base64.b64encode(dk).decode()}"


def ask_pw():
    pw = getpass.getpass("Contraseña (mín. 12 caracteres): ")
    if len(pw) < 12:
        sys.exit("La contraseña debe tener al menos 12 caracteres.")
    if pw != getpass.getpass("Repite la contraseña: "):
        sys.exit("No coinciden.")
    return pw


def main():
    if len(sys.argv) < 2 or sys.argv[1] not in ("hash", "add-user", "token"):
        sys.exit(__doc__)
    if sys.argv[1] == "token":
        print(secrets.token_urlsafe(32)); return
    if sys.argv[1] == "hash":
        print(make_hash(ask_pw())); return
    if len(sys.argv) < 4:
        sys.exit('Uso: python3 scripts/ww_auth.py add-user <usuario> "Nombre Apellido"')
    user, name = sys.argv[2].strip().lower(), sys.argv[3].strip()
    if not re.fullmatch(r"[a-z0-9._-]{3,32}", user):
        sys.exit("Usuario inválido (3-32 caracteres: a-z, 0-9, . _ -).")
    f = REPO / ".dev.vars"
    lines = f.read_text(encoding="utf-8").splitlines() if f.exists() else []
    users = []
    for l in lines:
        if l.startswith("AUTH_USERS="):
            users = json.loads(l.split("=", 1)[1].strip().strip("'"))
    users = [u for u in users if u["usuario"] != user] + [{"usuario": user, "nombre": name, "hash": make_hash(ask_pw())}]
    lines = [l for l in lines if not l.startswith("AUTH_USERS=")] + [f"AUTH_USERS='{json.dumps(users, ensure_ascii=False)}'"]
    f.write_text("\n".join(lines) + "\n", encoding="utf-8")
    f.chmod(0o600)
    print(f"Usuario {user} guardado en .dev.vars (permisos 600). Para producción: npx wrangler secret put AUTH_USERS y pega el JSON.")


if __name__ == "__main__":
    main()
