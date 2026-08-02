"""OCR-driven screenshot privacy redaction.

This is the production form of ``notebooks/redaction_pipeline_demo.ipynb``:
RapidOCR locates text, ``openai/privacy-filter`` classifies each OCR region,
regex rules catch common structured secrets, and Pillow blurs every matching
box. Model weights are loaded lazily and cached in the Celery worker process.
"""

from __future__ import annotations

import io
import logging
import re
from collections.abc import Callable
from dataclasses import dataclass
from functools import lru_cache
from typing import Any

from PIL import Image, ImageFilter

logger = logging.getLogger(__name__)

PII_LABELS = {
    "private_email",
    "private_phone",
    "private_person",
    "private_address",
    "private_url",
    "private_date",
    "account_number",
    "secret",
}

RULE_PATTERNS = {
    "email": re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.I),
    "phone": re.compile(r"(?<![A-Za-z0-9])(?:\+?\d[\d\s().-]{7,}\d)(?![A-Za-z0-9])"),
    "api_key": re.compile(r"\b(?:sk|pk|api|token|secret)[-_]?[A-Za-z0-9]{12,}\b", re.I),
}

OCRBox = list[list[float]]
OCRItem = tuple[OCRBox, str, float]
Classifier = Callable[[str], list[dict[str, Any]]]


class RedactionUnavailable(RuntimeError):
    """Raised when screenshots cannot be scanned because OCR is unavailable."""


@dataclass(frozen=True)
class RedactionRegion:
    bounds: tuple[int, int, int, int]
    labels: tuple[str, ...]
    score: float


@dataclass(frozen=True)
class RedactionResult:
    image_bytes: bytes
    regions: tuple[RedactionRegion, ...]
    detector_mode: str
    warning_message: str | None = None


def normalize_ocr_result(raw: Any) -> list[OCRItem]:
    """Normalize RapidOCR's tuple/list variants to notebook-compatible rows."""
    result = raw[0] if isinstance(raw, tuple) else raw
    if not result:
        return []
    normalized: list[OCRItem] = []
    for item in result:
        if not isinstance(item, (list, tuple)) or len(item) < 3:
            continue
        box, text, confidence = item[:3]
        normalized.append((box, str(text), float(confidence)))
    return normalized


def rule_hits(text: str) -> list[dict[str, Any]]:
    """Return rule metadata only; never retain the matching sensitive value."""
    hits: list[dict[str, Any]] = []
    for label, pattern in RULE_PATTERNS.items():
        for _match in pattern.finditer(text):
            hits.append({"entity_group": label, "score": 1.0})
    return hits


def model_hits(
    text: str,
    classifier: Classifier | None,
    score_threshold: float,
) -> list[dict[str, Any]]:
    if classifier is None:
        return []
    return [
        hit
        for hit in classifier(text)
        if str(hit.get("entity_group", "")) in PII_LABELS
        and float(hit.get("score", 0)) >= score_threshold
    ]


def _box_rect(
    box: OCRBox,
    *,
    width: int,
    height: int,
    analysis_scale: float,
) -> tuple[int, int, int, int]:
    xs = [float(point[0]) / analysis_scale for point in box]
    ys = [float(point[1]) / analysis_scale for point in box]
    x0, y0 = int(min(xs)), int(min(ys))
    x1, y1 = int(max(xs)), int(max(ys))
    return max(0, x0), max(0, y0), min(width, x1), min(height, y1)


@lru_cache(maxsize=1)
def load_ocr_engine() -> Any:
    try:
        from rapidocr_onnxruntime import RapidOCR
    except Exception as exc:
        raise RedactionUnavailable("RapidOCR is not installed in the worker") from exc
    return RapidOCR()


@lru_cache(maxsize=4)
def load_pii_classifier(model: str, token: str | None) -> Classifier | None:
    try:
        from transformers import pipeline

        return pipeline(
            "token-classification",
            model=model,
            aggregation_strategy="simple",
            token=token or None,
        )
    except Exception:
        # The notebook deliberately falls back to deterministic rules when the
        # optional classifier cannot be loaded. Do not log OCR text or tokens.
        logger.exception("Privacy classifier unavailable; using regex rules only")
        return None


class PrivacyRedactor:
    def __init__(
        self,
        *,
        model: str,
        hf_token: str | None,
        score_threshold: float,
        blur_radius: int,
        max_dimension_px: int,
        ocr_engine: Any | None = None,
        classifier: Classifier | None = None,
        classifier_supplied: bool = False,
    ):
        self.model = model
        self.hf_token = hf_token
        self.score_threshold = score_threshold
        self.blur_radius = blur_radius
        self.max_dimension_px = max_dimension_px
        self._ocr_engine = ocr_engine
        self._classifier = classifier
        self._classifier_supplied = classifier_supplied

    def redact(self, image_bytes: bytes) -> RedactionResult:
        try:
            with Image.open(io.BytesIO(image_bytes)) as source:
                original = source.convert("RGB")
        except Exception as exc:
            raise ValueError("Could not decode screenshot for redaction") from exc

        analysis = original
        analysis_scale = 1.0
        if max(original.size) > self.max_dimension_px:
            analysis_scale = self.max_dimension_px / max(original.size)
            analysis = original.resize(
                (
                    max(1, round(original.width * analysis_scale)),
                    max(1, round(original.height * analysis_scale)),
                ),
                Image.Resampling.LANCZOS,
            )

        engine = self._ocr_engine or load_ocr_engine()
        try:
            import numpy as np

            ocr_result = normalize_ocr_result(engine(np.array(analysis)))
        except RedactionUnavailable:
            raise
        except Exception as exc:
            raise RedactionUnavailable("RapidOCR could not scan the screenshot") from exc

        classifier = (
            self._classifier
            if self._classifier_supplied
            else load_pii_classifier(self.model, self.hf_token)
        )
        detector_mode = "model_and_rules" if classifier is not None else "rules_only"
        warning = (
            None
            if classifier is not None
            else "Privacy model unavailable; deterministic rules were used instead."
        )

        regions: list[RedactionRegion] = []
        for box, text, _confidence in ocr_result:
            candidate = text.strip()
            if not candidate:
                continue
            try:
                # Union, rather than fallback: rules can catch a token even when
                # the model detects a different entity in the same OCR region.
                hits = model_hits(candidate, classifier, self.score_threshold)
            except Exception:
                logger.exception("Privacy classifier inference failed; applying regex rules")
                hits = []
                detector_mode = "rules_only"
                warning = "Privacy model failed during scanning; deterministic rules were used."
            hits.extend(rule_hits(candidate))
            if not hits:
                continue
            bounds = _box_rect(
                box,
                width=original.width,
                height=original.height,
                analysis_scale=analysis_scale,
            )
            if bounds[2] <= bounds[0] or bounds[3] <= bounds[1]:
                continue
            regions.append(
                RedactionRegion(
                    bounds=bounds,
                    labels=tuple(sorted({str(hit["entity_group"]) for hit in hits})),
                    score=max(float(hit.get("score", 0)) for hit in hits),
                )
            )

        redacted = original.copy()
        for region in regions:
            crop = redacted.crop(region.bounds).filter(
                ImageFilter.GaussianBlur(radius=self.blur_radius)
            )
            redacted.paste(crop, (region.bounds[0], region.bounds[1]))

        output = io.BytesIO()
        redacted.save(output, format="PNG")
        return RedactionResult(
            image_bytes=output.getvalue(),
            regions=tuple(regions),
            detector_mode=detector_mode,
            warning_message=warning,
        )
