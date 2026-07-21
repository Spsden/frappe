from io import BytesIO

from PIL import Image

from worktrace_api.annotation_render import _load_pointer, render_annotated_png


def _blank_png(width: int = 400, height: int = 400) -> bytes:
    image = Image.new("RGBA", (width, height), (255, 255, 255, 255))
    output = BytesIO()
    image.save(output, format="PNG")
    return output.getvalue()


def test_pointer_asset_is_cropped_and_has_detected_hotspot():
    pointer, hotspot = _load_pointer(64)

    assert pointer.width < 64
    assert pointer.height == 64
    assert hotspot[0] > 0
    assert hotspot[1] == 0
    assert pointer.getpixel(hotspot)[3] >= 64


def test_click_annotation_places_pointer_hotspot_on_click_center():
    annotated = render_annotated_png(
        _blank_png(),
        [
            {
                "type": "click_rectangle",
                "bounds": {"x": 100.0, "y": 100.0, "width": 80.0, "height": 60.0},
            }
        ],
    )

    image = Image.open(BytesIO(annotated)).convert("RGBA")

    # The stored bounds center is the click point: x=140, y=130.
    assert image.getpixel((140, 130)) != (255, 255, 255, 255)
