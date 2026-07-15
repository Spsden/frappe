import io
from uuid import UUID

from PIL import Image, ImageDraw

from worktrace_api.core.celery_app import celery_app
from worktrace_api.recordings import ChunkStorage
from worktrace_api.settings import get_settings
from worktrace_api.tasks._repo import make_repo


def _draw_annotation_box(image_bytes: bytes, bounds: dict) -> bytes:
    """Draw a visible bounding box on the image based on the provided coordinates."""
    with Image.open(io.BytesIO(image_bytes)) as img:
        img = img.convert("RGBA")

        x, y = bounds["x"], bounds["y"]
        w, h = bounds["width"], bounds["height"]

        draw = ImageDraw.Draw(img)
        outline_color = (255, 0, 0, 255)  # Solid Red
        stroke_width = 4

        draw.rectangle(
            [x, y, x + w, y + h],
            outline=outline_color,
            width=stroke_width
        )

        output = io.BytesIO()
        img.save(output, format="PNG")
        return output.getvalue()


@celery_app.task(bind=True, max_retries=3)
def annotate_screenshots(self, recording_id: str, session_id: str, tenant_id: str) -> None:
    settings = get_settings()
    repo = make_repo(tenant_id)
    storage = ChunkStorage(
        root=settings.recording_storage_path,
        max_chunk_bytes=settings.max_chunk_bytes
    )

    try:
        workflow_session = repo.get_session(UUID(session_id))
        if not workflow_session:
            return

        events = workflow_session.events
        screenshots = repo.get_screenshots_for_recording(UUID(recording_id))

        for screenshot in screenshots:
            if screenshot.redaction_status in ("redacted", "not_required"):
                continue


            # Match events that declare this screenshot as their BEFORE state.
            # pick the LAST such event: when multiple clicks happen on the same
            # screen before it changes, the final click is the one that caused the
            # transition (most meaningful to annotate).
            candidates = [
                e for e in events
                if e.before_screenshot_id == screenshot.id
            ]
            matching_event = candidates[-1] if candidates else None

            if not matching_event:
                repo.update_screenshot_annotation(screenshot.id, None, "not_required")
                continue

            annotation = matching_event.event_data.get("evidenceAnnotation")
            if not annotation or "bounds" not in annotation:
                repo.update_screenshot_annotation(screenshot.id, None, "not_required")
                continue

            bounds = annotation["bounds"]

            try:
                original_bytes = storage.read(screenshot.storage_key)

                annotated_bytes = _draw_annotation_box(original_bytes, bounds)

 
                annotated_key = f"{screenshot.storage_key.rsplit('.', 1)[0]}-annotated.png"
                annotated_path = storage.resolve_storage_key(annotated_key)
                annotated_path.parent.mkdir(parents=True, exist_ok=True)
                temporary = annotated_path.with_suffix(".tmp")
                temporary.write_bytes(annotated_bytes)
                temporary.replace(annotated_path)

                # Update database
                repo.update_screenshot_annotation(screenshot.id, annotated_key, "redacted")

            except Exception:
                repo.update_screenshot_annotation(screenshot.id, None, "failed")

    except Exception as exc:
        raise self.retry(exc=exc, countdown=30) from exc
    finally:
        repo.db.close()
