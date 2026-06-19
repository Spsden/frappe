import pytest
from pydantic import ValidationError

from worktrace_api.settings import Settings


def test_production_rejects_development_security_defaults():
    with pytest.raises(ValidationError):
        Settings(
            env="production",
            allowed_domains=[],
        )
