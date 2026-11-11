#!/usr/bin/env python3
"""Genera cloudflare/src/generated/content.js con las políticas y reglas de aprobación (solo lectura en el dashboard).
Se ejecuta antes de desplegar y antes de las pruebas: python3 scripts/build_worker_content.py"""
import json, re
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
pol = {n: (REPO / "policies" / f"{n}.md").read_text(encoding="utf-8") for n in ("opt-out", "consent", "contact-cadence")}
rules_md = (REPO / "workflows" / "approval-rules.md").read_text(encoding="utf-8")
rules = [{"id": m.group(1), "estado": m.group(2), "accion": m.group(3).strip()}
         for m in re.finditer(r"^\| (R-\d+) \| (\w+) \| ([^|]+) \|", rules_md, re.M)]
out = REPO / "cloudflare" / "src" / "generated" / "content.js"
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text("// Generado por scripts/build_worker_content.py — no editar a mano.\n"
               f"export const POLICIES = {json.dumps(pol, ensure_ascii=False)};\n"
               f"export const APPROVAL_RULES = {json.dumps(rules, ensure_ascii=False)};\n", encoding="utf-8")
print(f"generado {out.relative_to(REPO)} ({len(pol)} políticas, {len(rules)} reglas)")
