# syntax=docker/dockerfile:1
#
# Backend image for the WorkTrace API.
# Used by TWO compose services (api + worker) so they never drift:
#   - api    -> default CMD (uvicorn)
#   - worker -> command overridden to `celery worker ...`
FROM python:3.12-slim

# uv: drop-in fast replacement for pip (Astral). Pinned image tag for
# reproducible builds; bump deliberately. Binaries copied, not installed,
# so uv is not added to the Python environment.
COPY --from=ghcr.io/astral-sh/uv:0.5.11 /uv /uvx /usr/local/bin/

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    UV_LINK_MODE=copy \
    # Lets `celery -A worktrace_api.core.celery_app ...` resolve tasks
    # the same way `PYTHONPATH=src` does in the README.
    PYTHONPATH=/app/src

WORKDIR /app

# Copy only what's needed to install the package, then install it editable so
# the bind-mounted ./src stays live for `uvicorn --reload` in dev.
COPY pyproject.toml ./
COPY src ./src
COPY alembic.ini ./
COPY migrations ./migrations
# --system installs into system site-packages (no venv). Cache mount lets
# the resolved-wheel cache survive across `docker compose build` runs.
RUN --mount=type=cache,target=/root/.cache/uv \
    uv pip install --system -e . && \
    uv pip install --system "debugpy>=1.8,<2"

EXPOSE 8000

# Default = API server. Worker service overrides `command:`.
CMD ["python", "-m", "uvicorn", "worktrace_api.main:app", \
     "--host", "0.0.0.0", "--port", "8000", \
     "--reload", "--reload-dir", "/app/src"]
