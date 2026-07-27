"""OCR extraction — standalone Celery task (not wired into the main pipeline).

Reads every screenshot for a recording, runs OCR on the raw PNG/JPEG bytes,
and writes the detected text as a ".txt" sidecar file next to the image in
the existing recording storage (via ``ChunkStorage``). No database schema
changes and no edits to the existing pipeline/chord — this task is invoked
on demand, either directly (sync, for scripts/tests) or via Celery.

Usage
-----
Sync, no worker required (handy for a quick manual run)::

    python -m worktrace_api.tasks.ocr_extraction <recording_id> <tenant_id>

Async, via Celery (worker must be running and consuming the "vision" queue)::

    from worktrace_api.tasks.ocr_extraction import extract_screenshot_text
    extract_screenshot_text.delay(recording_id, tenant_id)
"""

from __future__ import annotations

import logging
import sys
from uuid import UUID

from worktrace_api.core.celery_app import celery_app
from worktrace_api.ocr import OCRUnavailable, extract_text
from worktrace_api.recordings import ChunkStorage
from worktrace_api.settings import get_settings
from worktrace_api.tasks._repo import make_repo

logger = logging.getLogger(__name__)


def _txt_sidecar_key(storage_key: str) -> str:
    """``.../00000001-screenshots.png`` -> ``.../00000001-screenshots.txt``."""
    return f"{storage_key.rsplit('.', 1)[0]}.txt"


def run_ocr_for_recording(recording_id: str, tenant_id: str) -> dict[str, int]:
    """Core logic, callable synchronously (used by both the Celery task and
    the CLI entry point) so it can run with no broker/worker at all."""
    settings = get_settings()
    repo = make_repo(tenant_id)
    storage = ChunkStorage(
        root=settings.recording_storage_path,
        max_chunk_bytes=settings.max_chunk_bytes,
    )

    processed = 0
    skipped = 0
    failed = 0

    try:
        screenshots = repo.get_screenshots_for_recording(UUID(recording_id))
        for screenshot in screenshots:
            try:
                sidecar_key = _txt_sidecar_key(screenshot.storage_key)
                sidecar_path = storage.resolve_storage_key(sidecar_key)

                if sidecar_path.exists():
                    skipped += 1
                    continue

                image_bytes = storage.read(screenshot.storage_key)
                text = extract_text(image_bytes)

                sidecar_path.parent.mkdir(parents=True, exist_ok=True)
                temporary = sidecar_path.with_suffix(".tmp")
                temporary.write_text(text, encoding="utf-8")
                temporary.replace(sidecar_path)
                processed += 1
            except OCRUnavailable:
                raise
            except Exception:
                logger.exception(
                    "OCR failed for screenshot %s (recording %s)",
                    screenshot.id,
                    recording_id,
                )
                failed += 1

        return {"processed": processed, "skipped": skipped, "failed": failed}
    finally:
        repo.db.close()


@celery_app.task(bind=True, max_retries=3, queue="vision")
def extract_screenshot_text(self, recording_id: str, tenant_id: str) -> dict[str, int]:
    try:
        return run_ocr_for_recording(recording_id, tenant_id)
    except OCRUnavailable as exc:
        # Config problem (missing tesseract binary) — not worth retrying blindly.
        logger.error("OCR unavailable: %s", exc)
        raise
    except Exception as exc:
        raise self.retry(exc=exc, countdown=30) from exc


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: python -m worktrace_api.tasks.ocr_extraction <recording_id> <tenant_id>")
        sys.exit(1)
    result = run_ocr_for_recording(sys.argv[1], sys.argv[2])
    print(result)
