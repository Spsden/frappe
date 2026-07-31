#!/usr/bin/env sh

set -eu

cat <<'WORKTRACE_BANNER'
 ____            _           _     _____ ___
|  _ \ _ __ ___ (_) ___  ___| |_  |___  / _ \
| |_) | '__/ _ \| |/ _ \/ __| __|    / / (_) |
|  __/| | | (_) | |  __/ (__| |_    / / \__, |
|_|   |_|  \___// |\___|\___|\__|  /_/    /_/
              |__/
WORKTRACE_BANNER

python -m worktrace_api.migration_bootstrap
exec python -m uvicorn worktrace_api.main:app --host 0.0.0.0 --port 8000 --reload --reload-dir /app/src
