#!/usr/bin/env python3
"""Ejecuta todas las pruebas: python3 tests/run_all.py [--sin-ui]"""
import sys, unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
mods = ["test_crm", "test_api", "test_research", "test_security", "test_migration", "test_investigator"] + ([] if "--sin-ui" in sys.argv else ["test_ui"])
suite = unittest.TestSuite(unittest.defaultTestLoader.loadTestsFromName(m) for m in mods)
res = unittest.TextTestRunner(verbosity=2).run(suite)
print(f"\nRESUMEN: {res.testsRun} pruebas · {len(res.failures)} fallos · {len(res.errors)} errores · {len(res.skipped)} omitidas")
sys.exit(0 if res.wasSuccessful() else 1)
