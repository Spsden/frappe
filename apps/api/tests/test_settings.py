import pytest
from pydantic import ValidationError

from worktrace_api.settings import Settings


def test_production_rejects_development_security_defaults():
    with pytest.raises(ValidationError):
        Settings(
            env="production",
            allowed_domains=[],
        )

def test_production_rejects_default_media_secret():
    with pytest.raises(ValidationError):
        Settings(
            env="production",
            allowed_domains=["example.com"],
            media_token_secret="worktrace-dev-media-token-secret-change-me",
        )
