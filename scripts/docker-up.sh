#!/usr/bin/env sh

set -eu

REPO_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$REPO_ROOT"

printf '\nWELCOME TO\n\n'
cat <<'PROJECT_79'
 ____            _           _     _____ ___
|  _ \ _ __ ___ (_) ___  ___| |_  |___  / _ \
| |_) | '__/ _ \| |/ _ \/ __| __|    / / (_) |
|  __/| | | (_) | |  __/ (__| |_    / / \__, |
|_|   |_|  \___// |\___|\___|\__|  /_/    /_/
              |__/
PROJECT_79
printf '\n'

exec docker compose up "$@"
