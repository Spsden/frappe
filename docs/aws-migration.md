# AWS Migration — Planning Notes

> Working notes for moving WorkTrace from local `docker-compose` to AWS.
> Status: **planning**. Last updated: 2026-08-01.

## Resume here — next steps checklist

- [ ] Production `Dockerfile` (multi-stage, non-root, healthcheck, no `debugpy`/editable install).
- [ ] Alembic deploy entrypoint (`alembic upgrade head` as a one-shot task); dev-gate `create_tables()` in `main.py:97`.
- [ ] Terraform skeleton targeting MiniStack (`localhost:4566`) first, real AWS via a variable.
- [ ] `ChunkStorage` interface → `LocalChunkStorage` / `S3ChunkStorage` behind `WORKTRACE_STORAGE_BACKEND`.
- [ ] Land redaction pipeline deps + worker model-cache volume (`apps/api/notebooks/redaction_pipeline_demo.ipynb` is the validated prototype).

---

## 1. Current architecture (what we have)

- `apps/api` — FastAPI + Celery worker, **same image, different command** (`docker-compose.yml`).
- Postgres 17 (SQLAlchemy + psycopg), Redis 7 (Celery broker + result backend).
- Celery queues: `default, audio, vision, llm, celery`. Worker runs `-P solo`.
- Transcription: `faster-whisper` (CTranslate2 — **no torch**). LLM: OpenAI client. Imaging: Pillow.
- Recording files: `ChunkStorage` (local FS) at `WORKTRACE_RECORDING_STORAGE_PATH=/data/recordings`.
- Model caches: `whisper-cache` volume; planned `models-cache` for OCR / privacy-filter.
- Multi-tenant via `tenant_id`; auth exists (`users`, `access_tokens`).
- Desktop (Electron) talks to the API over a configurable URL (`ConnectionSettingsStore`).
- Config is env-driven: `settings.py` (pydantic-settings, `WORKTRACE_` prefix, reads `.env`).

## 2. Target AWS topology

```
                 Desktop app (Electron)
                        │ HTTPS
                   Route 53 + ACM
                        │
                  ALB (public, TLS)            ← only public entry
                        │
   ┌────────────────────┴───────────────────────────┐
   │  VPC (private subnets below)                   │
   │                                                 │
   │  ECS / Fargate  ── API task(s)                 │  stateless web
   │       │                                         │
   │  ECS / EC2      ── Celery workers              │  heavy CPU (vision/audio/llm)
   │                                                 │
   │  RDS Postgres  ── ElastiCache Redis            │  managed, multi-AZ
   └────────────────┬────────────────────────────────┘
                   │
     S3 (recordings)  +  EFS (model cache)          ← shared state/artifacts
                   │
          OpenAI API (only redacted content egresses)
```

## 3. How the API and worker communicate (key concept)

**They never talk directly.** Both connect to the same Redis (Celery broker):

```
api  ──►  redis (queue)  ◄──  worker
```

- API calls `process_recording.delay(...)` / `generate_sop_with_ai.delay(...)` (see `processing.py`) → message lands on a Redis queue, returns instantly.
- Worker consumes `-Q default,audio,vision,llm,celery` → executes → writes results to DB/S3 → may enqueue follow-up tasks back onto Redis.
- Desktop **polls** `GET /sessions/{id}` → API reads status from RDS → returns.

On AWS the only change: Redis becomes **ElastiCache**. Same `WORKTRACE_REDIS_URL`. The Celery code is identical. There is **no API↔worker network rule** — no direct connection exists.

## 4. Service mapping (compose → AWS)

| Compose now | AWS target | Notes |
|---|---|---|
| `api` | ECS **Fargate** behind ALB | Stateless, autoscale on request/CPU |
| `worker` | ECS on **EC2** (c7i) / Spot | Heavy CPU + resident models; cheaper than Fargate |
| `postgres` | **RDS Postgres** (Multi-AZ) | Secrets in Secrets Manager |
| `redis` | **ElastiCache (Redis)** | Broker + results |
| `pg-data` volume | RDS | — |
| `data/recordings` bind mount | **S3** (target) / EFS (interim) | biggest item — see §6 |
| `whisper-cache` volume | **EFS** shared cache (`HF_HOME`) | pull once, share across tasks |

## 5. The three AWS-specific challenges

1. **Shared recording storage.** `ChunkStorage` is local-FS only → breaks with >1 host. **Interim:** mount EFS at the storage path (zero code change). **Target:** S3-native `ChunkStorage` + presigned desktop uploads (offloads API bandwidth).
2. **Heavy workers + model artifacts.** Worker loads whisper + (planned) rapidocr + privacy-filter (~0.7–2 GB resident), CPU-bound for minutes. Use **EC2-backed ECS, not Fargate**; keep `task_acks_late=True` + per-frame resumable redaction → unlocks **Spot**; models on **EFS** (not baked into image); separate worker services per queue profile (big for `vision`/`audio`, small for `llm`/`default`); `-P solo` ⇒ scale by task count, not threads.
3. **PII egress control.** **VPC endpoints** for S3/ECR/Secrets/HF (free S3 gateway, keeps data off public path); restrict worker egress to OpenAI + HF only; the OpenAI call must carry only **redacted** artifacts; encrypt RDS/EFS/S3 (KMS) + ALB TLS.

## 6. Worker autoscaling (the fiddly bit)

ECS scales on CPU/RAM/ALB metrics — **not** Celery queue depth. Options:
- Publish `redis llen <queue>` as a CloudWatch custom metric (tiny Lambda/sidecar) → target-tracking.
- Or start with a fixed worker count + Spot for spikes; build the custom-metric scaler when load justifies it.

## 7. MiniStack decision

`ministack.org` — free MIT LocalStack alternative; emulates 60+ AWS services locally on `localhost:4566` with real Postgres/Redis/Docker behind RDS/ElastiCache/ECS APIs.

**Use it as a free sandbox to:**
- learn the AWS APIs / IaC without bill anxiety,
- iterate on Terraform (apply/destroy in seconds, $0),
- develop/test the S3 `ChunkStorage` + presigned-upload glue and ECS task defs.

**Do NOT** use it as a substitute for `docker-compose` for app dev (compose's Postgres/Redis are identical and faster-feedback). And budget **one real-AWS smoke test** — emulators differ from real AWS at IAM / Fargate ENI networking / autoscaling / cost edges.

## 8. Changes needed for AWS compatibility

### A. Config-only (no code change) — set in ECS task definition
`WORKTRACE_DATABASE_URL`, `WORKTRACE_REDIS_URL`, `WORKTRACE_RECORDING_STORAGE_PATH`, `WORKTRACE_ALLOWED_ORIGINS`, `WORKTRACE_OPENAI_API_KEY`, `media_token_secret` (rotate the dev default!), `WORKTRACE_WHISPER_MODEL_SIZE`.

### B. Code changes (ranked)
1. **Storage abstraction → S3** (the big one). `ChunkStorage` (`recordings.py`) is local-FS only. Interface + `Local`/`S3` backends selected by `WORKTRACE_STORAGE_BACKEND`. Add `boto3`. Deferrable with EFS.
2. **Migrations on deploy.** `main.py:97` still calls `create_tables()` in lifespan; Alembic exists (`alembic.ini`, `migrations/`). Run `alembic upgrade head` as a one-shot pre-deploy task; dev-gate the lifespan call.
3. **Secrets loading** — already env-driven; only add a Secrets Manager reader if you want non-env rotation.
4. **(Redaction)** add `rapidocr-onnxruntime` + `onnxruntime` + privacy-filter ONNX loader to `pyproject.toml`; `WORKTRACE_REDACT_*` + `HF_HOME` model cache for the worker image. Not yet in deps.

### C. Container / build
Current `Dockerfile` is dev-shaped (editable install, `debugpy`, no healthcheck/non-root). Prod variant needs: install built package (not `-e .`), drop `debugpy`, **non-root user**, `HEALTHCHECK`, uvicorn without `--reload` (gunicorn/uvicorn-workers), no secrets baked in. Keep API image lean; let worker image carry the heavy models.

### D. Infra artifacts to create (not code)
- **Terraform/CDK**: VPC (public/private + NAT), SGs, RDS, ElastiCache, S3 (+ gateway endpoint), EFS, ALB + ACM, Route53.
- **ECS**: cluster + 2 services (API Fargate, Worker EC2/Spot) with task defs (env + secrets + EFS mounts; worker `command` override).
- **CI**: GitHub Actions → build → ECR → new task-def revision → service update; migration task first.

### E. Hardening before public exposure
Verify auth middleware covers all tenant routes; CORS = desktop/web origin only; correlation logging → CloudWatch; Celery `result_expires`; deeper readiness check; restrict worker egress.

## 9. Phased rollout

- **Phase 1 (smallest delta, get live):** prod `Dockerfile` + env → RDS/ElastiCache + **EFS** for recordings & model cache + ALB + Alembic deploy task. Almost no app code change.
- **Phase 2:** `S3ChunkStorage` (+ presigned uploads) → drop EFS for recordings.
- **Phase 3:** Spot workers, queue-depth autoscaling, GPU only if needed, redaction live.

## 10. Open decisions

1. ECS vs EKS → lean **ECS** (simpler at this scale).
2. EFS-interim vs straight-to-S3 → depends on appetite to refactor `ChunkStorage`.
3. CPU vs GPU workers → CPU (faster-whisper CTranslate2 + ONNX) likely enough to start.
4. AWS region (close to users + OpenAI egress path).

## 11. Related: redaction pipeline (designed, not yet wired)

- **Pipeline:** PaddleOCR (`rapidocr-onnxruntime`) → `openai/privacy-filter` (ONNX, **no torch** — consistent with faster-whisper) → span→box alignment → deterministic blur via `redact` annotations, baked into the annotated PNG. Worker-side (Celery `vision` queue), per-frame resumable.
- **Plug point:** `tasks/annotation.py:29` (`# TODO: Redaction will probably happen here`).
- **Runtime/format:** ONNX for both OCR + privacy-filter. **GGUF is out** (token-classification + custom Viterbi span decoder; PaddleOCR isn't an LLM). Native HF transformers+torch is the fallback if porting the Viterbi decoder is too much.
- **Overhead:** OCR dominates (~1–3 s/frame CPU). Biggest lever: redact only the evidence-frame budget (`sop_max_vision_frames`), not every captured frame; downscale before OCR; q4 privacy-filter.
- **Prototype notebook:** `apps/api/notebooks/redaction_pipeline_demo.ipynb` (demo uses transformers+torch; production ports to ONNX).

## 12. Useful code references

- `apps/api/src/worktrace_api/settings.py` — all `WORKTRACE_*` knobs.
- `apps/api/src/worktrace_api/recordings.py` — `ChunkStorage` (the storage refactor point).
- `apps/api/src/worktrace_api/tasks/annotation.py:29` — redaction plug point.
- `apps/api/src/worktrace_api/processing.py` — `.delay()` enqueue calls.
- `apps/api/src/worktrace_api/core/celery_app.py` — broker/queues/routes.
- `apps/api/src/worktrace_api/main.py:96` — lifespan `create_tables()` (→ Alembic).
- `apps/api/Dockerfile` — needs prod variant.
- `docker-compose.yml` — reference topology.
