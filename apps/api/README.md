# WorkTrace API

The API owns tenant-scoped persistence, privacy filtering, SOP generation,
feedback classification, approved walkthrough publication, export bundles, and
conservative analytics.

## Local Development

```powershell
python -m venv .venv
.\.venv\Scripts\pip install -e "apps/api[dev]"
.\.venv\Scripts\pytest apps/api
.\.venv\Scripts\uvicorn worktrace_api.main:app --app-dir apps/api/src --reload
```

From Bash, the API can be started from any directory with:

```bash
./apps/api/run.sh
```

The launcher uses the repository virtual environment when available and runs
the API at `http://127.0.0.1:8000` with reload enabled. Override its development
defaults with `WORKTRACE_API_HOST`, `WORKTRACE_API_PORT`,
`WORKTRACE_API_RELOAD=false`, or `WORKTRACE_PYTHON`.

Swagger UI is available at `http://localhost:8000/docs`. The checked-in
[`openapi.json`](openapi.json) can be regenerated with:

```powershell
.\.venv\Scripts\python apps/api/scripts/export_openapi.py
```

Run database migrations from the repository root with:

```bash
./.venv/bin/python -m alembic -c apps/api/alembic.ini upgrade head
```

Create future migrations after editing the SQLAlchemy models with:

```bash
./.venv/bin/python -m alembic -c apps/api/alembic.ini revision --autogenerate -m "describe change"
```

Create the first company owner with `/auth/signup`, then use the returned
opaque Bearer token for protected requests. Tokens are stored hashed in the
database and can be revoked with `/auth/logout`. The API derives tenant scope
from the authenticated token. `X-Tenant-ID` is optional and, when supplied,
must match the token tenant.

## Endpoint Groups

- `/auth`: create a tenant owner account, log in, inspect the current account,
  and revoke the active access token.
- `/recordings`: create recording drafts, upload idempotent chunks, complete
  ingestion, and poll read-only processing status.
- `/sessions`: ingest, list, inspect, delete, preview AI payloads, approve AI
  payloads, and generate SOPs.
- `/sops`: inspect and approve SOP versions.
- `/walkthroughs`: retrieve approved SOPs for onboarding.
- `/feedback`: classify and store workflow feedback.
- `/analytics`: compare observed paths and friction evidence.
- `/exports`: export one sanitized session with its SOPs and feedback.

## Intentional Prototype Boundaries

- Recording chunks use tenant-scoped local object storage. Replace the storage
  adapter with MinIO/S3 and enqueue workers after completion for multi-instance
  deployment.
- Completing a recording runs the local processing service synchronously;
  status GET requests are read-only. Move that service behind a durable worker
  queue before multi-instance deployment.
- The local deterministic SOP generator is an adapter placeholder for approved
  external-AI calls.
- Slow work currently runs synchronously; its service boundary is ready to move
  behind Redis/RQ without changing route contracts.
- Email verification, password reset, account invitations, rate limiting, and
  production migrations remain required before a public deployment.
