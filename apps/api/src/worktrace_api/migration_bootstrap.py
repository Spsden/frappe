from __future__ import annotations

from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.pool import NullPool

from worktrace_api.settings import get_settings

BASELINE_REVISION = "20260624_0001"


def _alembic_config() -> Config:
    api_dir = Path(__file__).resolve().parents[2]
    return Config(str(api_dir / "alembic.ini"))


def _engine():
    settings = get_settings()
    connect_args = (
        {"check_same_thread": False}
        if settings.database_url.startswith("sqlite")
        else {}
    )
    return create_engine(
        settings.database_url,
        connect_args=connect_args,
        poolclass=NullPool,
        pool_pre_ping=True,
    )


def main() -> None:
    engine = _engine()
    with engine.begin() as connection:
        inspector = inspect(connection)
        tables = set(inspector.get_table_names())
        if "tenants" in tables:
            if "alembic_version" not in tables:
                connection.execute(
                    text("CREATE TABLE alembic_version (version_num VARCHAR(32) NOT NULL)")
                )
                version = None
            else:
                version = connection.execute(
                    text("SELECT version_num FROM alembic_version")
                ).scalar()
            if not version:
                connection.execute(text("DELETE FROM alembic_version"))
                connection.execute(
                    text("INSERT INTO alembic_version (version_num) VALUES (:revision)"),
                    {"revision": BASELINE_REVISION},
                )
    engine.dispose()

    config = _alembic_config()
    command.upgrade(config, "head")


if __name__ == "__main__":
    main()
