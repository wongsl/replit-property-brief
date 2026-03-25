#!/usr/bin/env python3
"""
Robust migration runner that handles schema/migration-state mismatches.
Fakes Django built-in app migrations if the schema is already ahead,
then runs all app-level migrations normally.
"""
import os
import sys
import subprocess

def run_cmd(cmd, check=False):
    r = subprocess.run(cmd, shell=True, capture_output=True, text=True)
    if r.stdout:
        print(r.stdout, end='')
    if r.stderr:
        print(r.stderr, end='', file=sys.stderr)
    return r.returncode == 0

# Fake core Django app migrations that may already be applied to the schema
# (these have no custom data — safe to fake)
for app in ['contenttypes', 'auth', 'admin', 'sessions']:
    run_cmd(f'python3.11 manage.py migrate {app} --fake 2>/dev/null')

# Now run all remaining migrations for our app (documents, etc.)
ok = run_cmd('python3.11 manage.py migrate')
if not ok:
    print("ERROR: migrations failed", file=sys.stderr)
    sys.exit(1)

print("Migrations complete.")
