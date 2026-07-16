"""Screenshot annotation rendering.

Re-bakes a screenshot PNG so the stored image reflects the on-screen overlays
shown by the evidence editor. Each annotation type renders distinctly:

* ``click_rectangle`` -> a hand-drawn-style arrow pointing at the target.
* ``scroll_focus`` / ``pointer_focus`` -> a soft glow box (rounded, tinted).
* ``manual_box`` -> a crisp user-drawn rectangle (emerald).

The raw screenshot is never modified; the rendered bytes are written to the
separate ``*-annotated.png`` artifact.
"""

from __future__ import annotations

import io
import math
from typing import Any

from PIL import Image, ImageDraw

_ANNOTATION_RGB: dict[str, tuple[int, int, int]] = {
    "click_rectangle": (239, 68, 68),
    "scroll_focus": (56, 189, 248),
    "pointer_focus": (251, 191, 36),
    "manual_box": (16, 185, 129),
}


def _rgba(rgb: tuple[int, int, int], alpha: int) -> tuple[int, int, int, int]:
    return (rgb[0], rgb[1], rgb[2], alpha)


def _clamp(value: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, value))


def _arrow_origin(
    tx: float, ty: float, width: int, height: int
) -> tuple[float, float]:
    """Pick an on-frame origin to the lower-left of the target, flipping if it
    would collide. Keeps the arrow's tail inside the screenshot."""
    margin = 30
    ox = _clamp(tx - 150, margin, width - margin)
    oy = _clamp(ty + 120, margin, height - margin)
    if math.hypot(tx - ox, ty - oy) < 70:
        ox = _clamp(tx + 150, margin, width - margin)
        oy = _clamp(ty - 120, margin, height - margin)
    return ox, oy


def _head_points(
    ox: float, oy: float, tx: float, ty: float
) -> list[tuple[float, float]]:
    dx = tx - ox
    dy = ty - oy
    length = math.hypot(dx, dy) or 1.0
    ux = dx / length
    uy = dy / length
    size = max(16.0, min(30.0, length * 0.18))
    base_x = tx - ux * size
    base_y = ty - uy * size
    perp_x = -uy
    perp_y = ux
    half = size * 0.6
    return [
        (tx, ty),
        (base_x + perp_x * half, base_y + perp_y * half),
        (base_x - perp_x * half, base_y - perp_y * half),
    ]


def _draw_arrow(
    draw: ImageDraw.ImageDraw,
    bounds: dict[str, Any],
    rgb: tuple[int, int, int],
    width: int,
    height: int,
) -> None:
    tx = bounds.get("x", 0) + bounds.get("width", 0) / 2
    ty = bounds.get("y", 0) + bounds.get("height", 0) / 2
    ox, oy = _arrow_origin(tx, ty, width, height)
    # wide translucent bleed behind a crisp shaft for a marker feel
    draw.line([(ox, oy), (tx, ty)], fill=_rgba(rgb, 70), width=12)
    draw.line([(ox, oy), (tx, ty)], fill=_rgba(rgb, 255), width=5)
    draw.polygon(_head_points(ox, oy, tx, ty), fill=_rgba(rgb, 255))


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
                _draw_arrow(draw, bounds, rgb, width, height)
            else:
                _draw_box(draw, bounds, rgb, rounded=ann_type != "manual_box")
        output = io.BytesIO()
        img.save(output, format="PNG")
        return output.getvalue()
