from uuid import UUID

from worktrace_api.annotation_render import render_annotated_png
from worktrace_api.core.celery_app import celery_app
from worktrace_api.recordings import ChunkStorage
from worktrace_api.schemas import RecordingStatus
from worktrace_api.settings import get_settings
from worktrace_api.tasks._repo import make_repo


@celery_app.task(bind=True, max_retries=3)
def annotate_screenshots(self, recording_id: str, session_id: str, tenant_id: str) -> None:
    settings = get_settings()
    repo = make_repo(tenant_id)
    storage = ChunkStorage(
        root=settings.recording_storage_path,
        max_chunk_bytes=settings.max_chunk_bytes
    )

    try:
        repo.set_recording_status(UUID(recording_id), RecordingStatus.PROCESSING_SCREENSHOTS)
        workflow_session = repo.get_session(UUID(session_id))
        if not workflow_session:
            return

        events = workflow_session.events
        screenshots = repo.get_screenshots_for_recording(UUID(recording_id))

        ###TODO : Redaction will probablbly happen here -- sps

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
                center_x = bounds["x"] + bounds["width"] / 2
                center_y = bounds["y"] + bounds["height"] / 2
                print(
                    f"Annotating screenshot {screenshot.id} "
                    f"for event {matching_event.id} "
                    f"center=({center_x}, {center_y}) bounds={bounds}"
                )
                annotated_bytes = render_annotated_png(original_bytes, [annotation])

 
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
