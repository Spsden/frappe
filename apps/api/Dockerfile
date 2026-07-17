# syntax=docker/dockerfile:1
#
# Backend image for the WorkTrace API.
# Used by TWO compose services (api + worker) so they never drift:
#   - api    -> default CMD (uvicorn)
#   - worker -> command overridden to `celery worker ...`
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
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
RUN pip install -e .

EXPOSE 8000

# Default = API server. Worker service overrides `command:`.
CMD ["python", "-m", "uvicorn", "worktrace_api.main:app", \
     "--host", "0.0.0.0", "--port", "8000", \
     "--reload", "--reload-dir", "/app/src"]
