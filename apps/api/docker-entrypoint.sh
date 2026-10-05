#!/usr/bin/env sh

set -eu

python -m worktrace_api.migration_bootstrap

if [ "${UVICORN_RELOAD:-0}" = "1" ]; then
    exec python -m uvicorn worktrace_api.main:app --host 0.0.0.0 --port 8000 --reload --reload-dir /app/src
else
    exec python -m uvicorn worktrace_api.main:app --host 0.0.0.0 --port 8000
fi
