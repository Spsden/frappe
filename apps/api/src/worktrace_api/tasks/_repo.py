from uuid import UUID

from worktrace_api.database import SessionLocal
from worktrace_api.repository import Repository


def make_repo(tenant_id: str) -> Repository:
    """Open a fresh DB session for use inside a Celery worker process."""
    db = SessionLocal()
    return Repository(db=db, tenant_id=UUID(tenant_id))
