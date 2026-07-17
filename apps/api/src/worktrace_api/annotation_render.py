"""Screenshot annotation rendering.

Re-bakes a screenshot PNG so the stored image reflects the on-screen overlays
shown by the evidence editor. Each annotation type renders distinctly:

* ``click_rectangle`` -> the branded pointer asset (``assets/pointer.png``)
  pasted at the click target, anchored top-left so the arrow tip lands on
  the exact click coordinate.
* ``scroll_focus`` / ``pointer_focus`` -> a soft glow box (rounded, tinted).
* ``manual_box`` -> a crisp user-drawn rectangle (emerald).

The raw screenshot is never modified; the rendered bytes are written to the
separate ``*-annotated.png`` artifact.
"""

from __future__ import annotations

import io
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw

_ANNOTATION_RGB: dict[str, tuple[int, int, int]] = {
    "click_rectangle": (239, 68, 68),
    "scroll_focus": (56, 189, 248),
    "pointer_focus": (251, 191, 36),
    "manual_box": (16, 185, 129),
}

_ASSETS_DIR = Path(__file__).parent / "assets"
_POINTER_PATH = _ASSETS_DIR / "pointer.png"

# Pointer overlay cache keyed by edge size. The PNG is decoded once per size
# and reused for every subsequent render in the process.
_pointer_cache: dict[int, Image.Image] = {}


def _rgba(rgb: tuple[int, int, int], alpha: int) -> tuple[int, int, int, int]:
    return (rgb[0], rgb[1], rgb[2], alpha)


def _load_pointer(size: int) -> Image.Image:
    """Load pointer.png downscaled to ``size``x``size`` (cached per size)."""
    cached = _pointer_cache.get(size)
    if cached is None:
        with Image.open(_POINTER_PATH) as img:
            cached = img.convert("RGBA").resize((size, size), Image.Resampling.LANCZOS)
        _pointer_cache[size] = cached
    return cached


def _paste_pointer(
    base: Image.Image, bounds: dict[str, Any], width: int, height: int
) -> None:
    """Paste the pointer asset onto ``base`` at the click target.

    Size scales with the screenshot's shorter edge so the pointer stays
    visible across resolutions (~75px on 1080p, ~120px on 1440p, ~180px on 4K).
    The tip is anchored at the target's center, matching a standard arrow
    cursor hotspot. The paste position is clamped to keep the whole pointer
    inside the frame.
    """
    size = max(64, min(width, height) // 12)
    pointer = _load_pointer(size)
    tx = int(bounds.get("x", 0) + bounds.get("width", 0) / 2)
    ty = int(bounds.get("y", 0) + bounds.get("height", 0) / 2)
    paste_x = min(max(tx, 0), width - size)
    paste_y = min(max(ty, 0), height - size)
    # Third arg = alpha mask; required so transparent pixels in the PNG stay
    # transparent instead of being painted as solid black.
    base.paste(pointer, (paste_x, paste_y), pointer)


def _draw_box(
    draw: ImageDraw.ImageDraw,
    bounds: dict[str, Any],
    rgb: tuple[int, int, int],
    *,
    rounded: bool,
) -> None:
    x = float(bounds.get("x", 0))
    y = float(bounds.get("y", 0))
    w = float(bounds.get("width", 0))
    h = float(bounds.get("height", 0))
    box = [x, y, x + w, y + h]
    halo = [x - 6, y - 6, x + w + 6, y + h + 6]
    fill = _rgba(rgb, 45)
    outline = _rgba(rgb, 225)
    halo_outline = _rgba(rgb, 60)
    if rounded:
        draw.rounded_rectangle(halo, radius=12, outline=halo_outline, width=3)
        draw.rounded_rectangle(box, radius=8, fill=fill, outline=outline, width=3)
    else:
        draw.rectangle(halo, outline=halo_outline, width=3)
        draw.rectangle(box, fill=fill, outline=outline, width=3)


def render_annotated_png(image_bytes: bytes, annotations: list[dict[str, Any]]) -> bytes:
    """Render every annotation onto a copy of ``image_bytes`` and return PNG bytes."""
    with Image.open(io.BytesIO(image_bytes)) as img:
        img = img.convert("RGBA")
        draw = ImageDraw.Draw(img, "RGBA")
        width, height = img.size
        for annotation in annotations:
            ann_type = annotation.get("type", "click_rectangle")
            rgb = _ANNOTATION_RGB.get(ann_type, _ANNOTATION_RGB["click_rectangle"])
            bounds = annotation.get("bounds") or {}
            if ann_type == "click_rectangle":
                _paste_pointer(img, bounds, width, height)
            else:
                _draw_box(draw, bounds, rgb, rounded=ann_type != "manual_box")
        output = io.BytesIO()
        img.save(output, format="PNG")
        return output.getvalue()
