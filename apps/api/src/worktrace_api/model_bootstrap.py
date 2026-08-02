"""Download and verify heavyweight models used by background workers."""

from __future__ import annotations

import logging
import time

from worktrace_api.redaction import (
    load_pii_classifier,
    mark_redaction_model_ready,
    redaction_model_ready,
)
from worktrace_api.settings import get_settings

logger = logging.getLogger(__name__)


def warm_redaction_model(attempts: int = 3) -> None:
    settings = get_settings()
    if redaction_model_ready(settings.redaction_model):
        logger.info("Redaction model is already cached: %s", settings.redaction_model)
        return

    for attempt in range(1, attempts + 1):
        logger.info(
            "Downloading redaction model %s (attempt %s/%s)",
            settings.redaction_model,
            attempt,
            attempts,
        )
        classifier = load_pii_classifier(settings.redaction_model, settings.hf_token)
        if classifier is not None:
            mark_redaction_model_ready(settings.redaction_model)
            logger.info("Redaction model is ready")
            return
        load_pii_classifier.cache_clear()
        if attempt < attempts:
            time.sleep(attempt * 2)

    raise RuntimeError(
        f"Could not download redaction model {settings.redaction_model!r} after {attempts} attempts"
    )


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    warm_redaction_model()
