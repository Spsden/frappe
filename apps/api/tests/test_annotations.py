"""Phase 2 annotation logic: accessibility element bounds take precedence over
the coordinate box, with a clean fallback chain. Unit-tested directly against
processing._pointer_annotation (no Redis/Celery needed)."""

from uuid import uuid4

from worktrace_api.processing import _pointer_annotation
from worktrace_api.schemas import EventType

META = {
    "capture": {
        "imageSize": {"width": 1280, "height": 720},
        "display": {
            "id": "1",
            "scaleFactor": 1,
            "bounds": {"x": 0, "y": 0, "width": 1280, "height": 720},
        },
    }
}


def test_accessibility_bounds_are_preferred_over_coordinate_box():
    data = {
        "targetBounds": {"x": 100.0, "y": 50.0, "width": 200.0, "height": 80.0},
        "targetRole": "AXButton",
        "targetLabel": "Save",
        "pointer": {
            "coordinateSpace": "global-screen",
            "x": 480,
            "y": 320,
            "displayId": "1",
            "displayScaleFactor": 1,
            "pointOnDisplay": {"x": 480, "y": 320},
        },
    }
    annotation = _pointer_annotation(
        EventType.CLICK, uuid4(), uuid4(), 480, 320, data, META
    )

    assert annotation["source"] == "accessibility"
    assert annotation["coordinate_space"] == "screenshot_pixels"
    assert annotation["confidence"] == 0.95
    assert annotation["bounds"] == {"x": 100.0, "y": 50.0, "width": 200.0, "height": 80.0}


def test_coordinate_box_used_when_no_accessibility_bounds():
    data = {
        "pointer": {
            "coordinateSpace": "global-screen",
            "x": 480,
            "y": 320,
            "displayId": "1",
            "displayScaleFactor": 1,
            "pointOnDisplay": {"x": 480, "y": 320},
        }
    }
    annotation = _pointer_annotation(EventType.CLICK, uuid4(), None, 480, 320, data, META)

    assert annotation["source"] == "event_pointer"
    assert annotation["coordinate_space"] == "screenshot_pixels"
    assert annotation["bounds"] == {"x": 432.0, "y": 284.0, "width": 96.0, "height": 72.0}


def test_retina_display_points_are_scaled_to_screenshot_pixels():
    retina_meta = {
        "capture": {
            "imageSize": {"width": 2940, "height": 1912},
            "display": {
                "id": "1",
                "scaleFactor": 2,
                "bounds": {"x": 0, "y": 0, "width": 1470, "height": 956},
            },
        }
    }
    data = {
        "pointer": {
            "coordinateSpace": "global-screen",
            "x": 337,
            "y": 395,
            "displayId": "1",
            "displayScaleFactor": 2,
            "pointOnDisplay": {"x": 337, "y": 395},
        }
    }
    annotation = _pointer_annotation(
        EventType.CLICK, uuid4(), None, 337, 395, data, retina_meta
    )

    assert annotation["source"] == "event_pointer"
    assert annotation["coordinate_space"] == "screenshot_pixels"
    assert annotation["bounds"] == {"x": 626.0, "y": 754.0, "width": 96.0, "height": 72.0}


def test_fallback_when_no_pointer_and_no_bounds():
    annotation = _pointer_annotation(EventType.CLICK, uuid4(), None, 480, 320, {}, None)

    assert annotation["source"] == "fallback_coordinate"
    assert annotation["coordinate_space"] == "global_screen"


def test_invalid_accessibility_bounds_fall_back():
    data = {"targetBounds": {"x": "nope", "y": 1, "width": 2, "height": 3}}
    annotation = _pointer_annotation(EventType.CLICK, uuid4(), None, 10, 10, data, None)

    assert annotation["source"] == "fallback_coordinate"


def test_offscreen_accessibility_bounds_rejected():
    data = {"targetBounds": {"x": 5000.0, "y": 50.0, "width": 10.0, "height": 10.0}}
    annotation = _pointer_annotation(EventType.CLICK, uuid4(), None, 10, 10, data, META)

    assert annotation["source"] == "fallback_coordinate"
