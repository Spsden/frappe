"""OCR extraction for recording screenshots.

Standalone module: given raw image bytes, returns the text detected in the
image via Tesseract OCR (through the ``pytesseract`` wrapper). Deliberately
has no dependency on the rest of the app (no DB, no schemas) so it can be
used from a Celery task, a one-off script, or a REPL without side effects.

Requires the ``tesseract`` binary to be installed on the host/image
(see Dockerfile: `apt-get install tesseract-ocr`) plus the
``pytesseract`` + ``Pillow`` Python packages.
"""

from __future__ import annotations

import io
import logging

from PIL import Image

logger = logging.getLogger(__name__)


class OCRUnavailable(RuntimeError):
    """Raised when the tesseract binary/pytesseract package is not available."""


def extract_text(image_bytes: bytes, lang: str = "eng") -> str:
    """Run OCR on an in-memory image and return the detected text.

    Args:
        image_bytes: Raw image bytes (PNG/JPEG/WEBP — anything Pillow can open).
        lang: Tesseract language code(s), e.g. "eng" or "eng+fra".

    Returns:
        The extracted text, stripped of leading/trailing whitespace. Returns
        an empty string if no text is detected.

    Raises:
        OCRUnavailable: if pytesseract or the tesseract binary is missing.
        ValueError: if the bytes are not a decodable image.
    """
    try:
        import pytesseract
    except ImportError as exc:
        raise OCRUnavailable(
            "pytesseract is not installed. Add it to pyproject.toml dependencies."
        ) from exc

    try:
        image = Image.open(io.BytesIO(image_bytes))
        image.load()
    except Exception as exc:
        raise ValueError("Could not decode image bytes for OCR") from exc

    try:
        text = pytesseract.image_to_string(image, lang=lang)
    except pytesseract.TesseractNotFoundError as exc:
        raise OCRUnavailable(
            "The tesseract binary is not installed on this host. "
            "Install it with `apt-get install tesseract-ocr` (Linux) or "
            "`brew install tesseract` (macOS)."
        ) from exc

    return text.strip()
