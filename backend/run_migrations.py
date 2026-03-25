#!/usr/bin/env python3
"""
Robust migration runner for production.

Verified production DB state (25 Mar 2026):
- django_migrations tracks documents 0001-0005
- documents 0006/0007/0008 schema changes EXIST (tables/columns are there)
  but were never recorded because a previous attempt crashed mid-way
- Solution: fake 0006-0008 to sync the record, then run any remaining work
"""
import subprocess
import sys
import os

os.chdir(os.path.dirname(os.path.abspath(__file__)))


def run(cmd, check=True):
    print(f">>> {cmd}", flush=True)
    r = subprocess.run(cmd, shell=True, text=True)
    if check and r.returncode != 0:
        print(f"FAILED (exit {r.returncode})", file=sys.stderr, flush=True)
        sys.exit(r.returncode)
    return r.returncode == 0


# Bring the migration record up to date with the real schema.
# All documents migrations 0001-0008 are already applied to the DB schema;
# we just need Django to know that so it stops trying to re-run them.
run("python3.11 manage.py migrate documents 0008 --fake", check=False)

# Run anything else that is genuinely pending (should be nothing at this point,
# but this keeps the script correct for future migrations too).
run("python3.11 manage.py migrate")

print("All migrations complete.", flush=True)
