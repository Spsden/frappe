#!/usr/bin/env bash
#
# Reset WorkTrace to a blank state.
#
# Clears:
#   1. Local desktop recordings        ~/Library/Application Support/electron-app/recordings
#   2. Backend recording files         apps/api/data/recordings
#   3. Backend database                drops & recreates the schema; api rebuilds tables on startup
#
# Preserves whisper-cache (model weights), redis data, and your desktop
# connection/experimental settings. Quit the desktop app before running.
#
#   ./clean.sh
#
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE=(docker compose)

DESKTOP_RECORDINGS="$HOME/Library/Application Support/electron-app/recordings"
BACKEND_RECORDINGS="$ROOT_DIR/apps/api/data/recordings"

PG_USER="worktrace"
PG_DB="worktrace"

echo "This will delete ALL local + backend recordings and reset the database."
echo "  desktop: $DESKTOP_RECORDINGS"
echo "  backend: $BACKEND_RECORDINGS"
read -rp "Continue? [y/N] " confirm
[[ "$confirm" =~ ^[Yy]$ ]] || { echo "Aborted."; exit 0; }

echo
echo "==> Bringing up postgres + redis (idempotent)..."
"${COMPOSE[@]}" up -d postgres redis >/dev/null

echo "==> Stopping api + worker..."
"${COMPOSE[@]}" stop api worker >/dev/null 2>&1 || true

echo "==> Clearing local desktop recordings..."
if [[ -d "$DESKTOP_RECORDINGS" ]]; then
  find "$DESKTOP_RECORDINGS" -mindepth 1 -delete
  echo "    cleared"
else
  echo "    (nothing to clear)"
fi

echo "==> Clearing backend recording storage..."
if [[ -d "$BACKEND_RECORDINGS" ]]; then
  find "$BACKEND_RECORDINGS" -mindepth 1 -delete
  echo "    cleared"
else
  echo "    (nothing to clear)"
fi

echo "==> Resetting database (drop & recreate schema)..."
"${COMPOSE[@]}" exec -T postgres psql -U "$PG_USER" -d "$PG_DB" \
  -c "DROP SCHEMA public CASCADE;" \
  -c "CREATE SCHEMA public;" \
  -c "GRANT ALL ON SCHEMA public TO ${PG_USER};" \
  -c "GRANT ALL ON SCHEMA public TO public;" >/dev/null

echo "==> Restarting api + worker (rebuilds schema on startup)..."
"${COMPOSE[@]}" up -d api worker >/dev/null

echo
echo "Done — WorkTrace is blank. Relaunch the desktop app and sign up again."
