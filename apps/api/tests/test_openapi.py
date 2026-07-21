import json
from pathlib import Path

from worktrace_api.main import app


def test_checked_in_openapi_matches_application():
    checked_in = json.loads(
        (Path(__file__).resolve().parents[1] / "openapi.json").read_text(encoding="utf-8")
    )
    assert checked_in == app.openapi()


def test_openapi_exposes_expected_endpoint_groups():
    document = app.openapi()
    tags = {tag["name"] for tag in document["tags"]}
    assert tags == {
        "analytics",
        "auth",
        "exports",
        "feedback",
        "recordings",
        "sessions",
        "settings",
        "sops",
        "system",
        "walkthroughs",
    }
