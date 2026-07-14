from celery import Celery

from worktrace_api.settings import get_settings


def broker_available(url: str, timeout: float = 1.0) -> bool:
    """Quick, non-blocking reachability check for the Celery broker/result backend
    (Redis). Used to gate the async dispatch so `/complete` never blocks on
    broker reconnect retries when Redis/worker are not running. A connection
    refusal returns immediately; only a silent host would wait `timeout`."""
    try:
        import redis as redis_lib

        client = redis_lib.from_url(
            url, socket_connect_timeout=timeout, socket_timeout=timeout
        )
        return bool(client.ping())
    except Exception:
        return False


def service_status(redis_url: str, timeout: float = 1.0) -> dict[str, str]:
    """Report the reachability of the async pipeline services. `redis` is the
    Celery broker/result backend; `worker` is probed via a control ping (only
    when the broker is up, since workers talk over it). Used by /health so the
    desktop client can tell the user when transcription/annotation are offline."""
    if not broker_available(redis_url, timeout=timeout):
        return {"redis": "down", "worker": "down"}
    try:
        replies = celery_app.control.ping(timeout=timeout)
        return {"redis": "up", "worker": "up" if replies else "down"}
    except Exception:
        return {"redis": "up", "worker": "unknown"}


def create_celery_app() -> Celery:
    settings = get_settings()
    app = Celery(
        "worktrace",
        broker=settings.redis_url,
        backend=settings.redis_url,
    )
    app.conf.update(
        task_serializer="json",
        result_serializer="json",
        accept_content=["json"],
        task_time_limit=settings.CELERY_TASK_TIME_LIMIT,
        task_soft_time_limit=settings.CELERY_TASK_SOFT_TIME_LIMIT,
        task_acks_late=True,
        worker_prefetch_multiplier=1,
        task_routes={
            "worktrace_api.tasks.transcription.*": {"queue": "audio"},
            "worktrace_api.tasks.annotation.*": {"queue": "vision"},
            "worktrace_api.tasks.sop.*": {"queue": "llm"},
            "worktrace_api.tasks.pipeline.*": {"queue": "default"},
        },
    )
    app.conf.imports = (
        "worktrace_api.tasks.annotation",
        "worktrace_api.tasks.pipeline",
        "worktrace_api.tasks.transcription",
    )
    return app


celery_app = create_celery_app()
