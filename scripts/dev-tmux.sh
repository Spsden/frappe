#!/usr/bin/env bash

set -Eeuo pipefail

SESSION_NAME="${WORKTRACE_TMUX_SESSION:-worktrace-dev}"
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
API_DIR="${REPO_ROOT}/apps/api"
DESKTOP_DIR="${REPO_ROOT}/apps/desktop"
API_DATA_DIR="${API_DIR}/data"
REDIS_CONTAINER_NAME="${WORKTRACE_REDIS_CONTAINER_NAME:-worktrace-redis-dev}"
ATTACH="true"
OPEN_GHOSTTY="false"
KILL_EXISTING="false"

usage() {
  cat <<EOF
Usage: scripts/dev-tmux.sh [options]

Starts a local WorkTrace development tmux session with windows for:
  redis, api, celery, desktop

Options:
  --no-attach       Create/update the tmux session but do not attach.
  --ghostty         Attach in a new Ghostty window if the ghostty CLI is available.
  --kill            Kill any existing session with the same name before starting.
  -h, --help        Show this help.

Environment overrides:
  WORKTRACE_TMUX_SESSION          tmux session name, default: worktrace-dev
  WORKTRACE_API_HOST             FastAPI host, default: 127.0.0.1
  WORKTRACE_API_PORT             FastAPI port, default: 8000
  WORKTRACE_REDIS_URL            Redis URL, default: redis://127.0.0.1:6379/0
  WORKTRACE_DATABASE_URL         SQLite URL, default: apps/api/data/worktrace.sqlite3
  WORKTRACE_RECORDING_STORAGE_PATH
  WORKTRACE_REDIS_CONTAINER_NAME Docker Redis fallback container name
EOF
}

while (($#)); do
  case "$1" in
    --no-attach)
      ATTACH="false"
      ;;
    --ghostty)
      OPEN_GHOSTTY="true"
      ;;
    --kill)
      KILL_EXISTING="true"
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
  shift
done

if ! command -v tmux >/dev/null 2>&1; then
  echo "tmux is required. Install it with: brew install tmux" >&2
  exit 1
fi

find_api_python() {
  local candidate
  for candidate in \
    "${API_DIR}/.venv/bin/python" \
    "${REPO_ROOT}/.venv/bin/python" \
    "${REPO_ROOT}/apps/.venv/bin/python" \
    "${API_DIR}/.venv/Scripts/python.exe" \
    "${REPO_ROOT}/.venv/Scripts/python.exe" \
    "${REPO_ROOT}/apps/.venv/Scripts/python.exe"; do
    if [[ -x "${candidate}" ]]; then
      printf '%s\n' "${candidate}"
      return
    fi
  done

  if command -v python3 >/dev/null 2>&1; then
    command -v python3
    return
  fi

  if command -v python >/dev/null 2>&1; then
    command -v python
    return
  fi

  echo "Python was not found. Create apps/api/.venv first." >&2
  exit 1
}

quote() {
  printf '%q' "$1"
}

API_PYTHON="${WORKTRACE_PYTHON:-$(find_api_python)}"
API_HOST="${WORKTRACE_API_HOST:-127.0.0.1}"
API_PORT="${WORKTRACE_API_PORT:-8000}"
REDIS_URL="${WORKTRACE_REDIS_URL:-redis://127.0.0.1:6379/0}"
DATABASE_URL="${WORKTRACE_DATABASE_URL:-sqlite:///${API_DATA_DIR}/worktrace.sqlite3}"
RECORDING_STORAGE_PATH="${WORKTRACE_RECORDING_STORAGE_PATH:-${API_DATA_DIR}/recordings}"
ALLOWED_ORIGINS="${WORKTRACE_ALLOWED_ORIGINS:-http://localhost:5173,http://localhost:8000}"
WHISPER_MODEL_SIZE="${WORKTRACE_WHISPER_MODEL_SIZE:-tiny}"

mkdir -p "${API_DATA_DIR}" "${RECORDING_STORAGE_PATH}" "${API_DATA_DIR}/redis"

COMMON_ENV=$(
  cat <<EOF
export WORKTRACE_ENV=development
export WORKTRACE_REDIS_URL=$(quote "${REDIS_URL}")
export WORKTRACE_DATABASE_URL=$(quote "${DATABASE_URL}")
export WORKTRACE_RECORDING_STORAGE_PATH=$(quote "${RECORDING_STORAGE_PATH}")
export WORKTRACE_ALLOWED_ORIGINS=$(quote "${ALLOWED_ORIGINS}")
export WORKTRACE_WHISPER_MODEL_SIZE=$(quote "${WHISPER_MODEL_SIZE}")
export PYTHONPATH=$(quote "${API_DIR}/src")
EOF
)

REDIS_CMD=$(
  cat <<EOF
${COMMON_ENV}
cd $(quote "${REPO_ROOT}")
echo "Redis -> \${WORKTRACE_REDIS_URL}"
if command -v redis-cli >/dev/null 2>&1 && redis-cli -u "\${WORKTRACE_REDIS_URL}" ping >/dev/null 2>&1; then
  echo "Redis is already running. Keeping this pane open."
  while true; do
    redis-cli -u "\${WORKTRACE_REDIS_URL}" ping
    sleep 10
  done
elif command -v redis-server >/dev/null 2>&1; then
  exec redis-server --port 6379 --appendonly yes --dir $(quote "${API_DATA_DIR}/redis")
elif command -v docker >/dev/null 2>&1; then
  if ! docker ps -a --format '{{.Names}}' | grep -qx $(quote "${REDIS_CONTAINER_NAME}"); then
    docker create --name $(quote "${REDIS_CONTAINER_NAME}") -p 6379:6379 redis:7-alpine redis-server --appendonly yes
  fi
  docker start $(quote "${REDIS_CONTAINER_NAME}") >/dev/null
  docker logs -f $(quote "${REDIS_CONTAINER_NAME}")
else
  echo "Could not start Redis. Install redis-server or Docker." >&2
  exit 1
fi
EOF
)

API_CMD=$(
  cat <<EOF
${COMMON_ENV}
cd $(quote "${REPO_ROOT}")
echo "FastAPI -> http://${API_HOST}:${API_PORT}"
exec $(quote "${API_PYTHON}") -m uvicorn worktrace_api.main:app --app-dir $(quote "${API_DIR}/src") --host $(quote "${API_HOST}") --port $(quote "${API_PORT}") --reload --reload-dir $(quote "${API_DIR}/src")
EOF
)

CELERY_CMD=$(
  cat <<EOF
${COMMON_ENV}
cd $(quote "${API_DIR}")
echo "Celery queues -> default,audio,vision,llm,celery"
exec $(quote "${API_PYTHON}") -m celery -A worktrace_api.core.celery_app worker --loglevel=info -P solo -Q default,audio,vision,llm,celery
EOF
)

DESKTOP_CMD=$(
  cat <<EOF
cd $(quote "${DESKTOP_DIR}")
echo "Electron desktop -> npm run dev"
if [[ ! -d node_modules ]]; then
  echo "node_modules is missing. Run npm install in apps/desktop first." >&2
  exit 1
fi
exec npm run dev
EOF
)

if [[ "${KILL_EXISTING}" == "true" ]] && tmux has-session -t "${SESSION_NAME}" 2>/dev/null; then
  tmux kill-session -t "${SESSION_NAME}"
fi

if tmux has-session -t "${SESSION_NAME}" 2>/dev/null; then
  echo "tmux session '${SESSION_NAME}' already exists."
else
  tmux new-session -d -s "${SESSION_NAME}" -n redis "bash -lc $(quote "${REDIS_CMD}")"
  tmux new-window -t "${SESSION_NAME}:" -n api "bash -lc $(quote "${API_CMD}")"
  tmux new-window -t "${SESSION_NAME}:" -n celery "bash -lc $(quote "${CELERY_CMD}")"
  tmux new-window -t "${SESSION_NAME}:" -n desktop "bash -lc $(quote "${DESKTOP_CMD}")"
  tmux select-window -t "${SESSION_NAME}:api"
fi

echo "Session ready: ${SESSION_NAME}"
echo "Windows: redis | api | celery | desktop"

if [[ "${ATTACH}" != "true" ]]; then
  exit 0
fi

if [[ "${OPEN_GHOSTTY}" == "true" ]] && command -v ghostty >/dev/null 2>&1; then
  exec ghostty -e tmux attach-session -t "${SESSION_NAME}"
fi

exec tmux attach-session -t "${SESSION_NAME}"
