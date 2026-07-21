from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
from dataclasses import dataclass
from typing import Any


class MediaTokenError(ValueError):
    pass


@dataclass(frozen=True)
class MediaTokenPayload:
    storage_key: str
    media_type: str
    expires_at: int


def _b64encode(payload: bytes) -> str:
    return base64.urlsafe_b64encode(payload).decode("ascii").rstrip("=")


def _b64decode(payload: str) -> bytes:
    padding = "=" * (-len(payload) % 4)
    return base64.urlsafe_b64decode(f"{payload}{padding}".encode("ascii"))


def create_media_token(
    *,
    storage_key: str,
    media_type: str,
    secret: str,
    ttl_seconds: int,
) -> str:
    expires_at = int(time.time()) + ttl_seconds
    payload = {
        "exp": expires_at,
        "media_type": media_type,
        "storage_key": storage_key,
    }
    payload_b64 = _b64encode(
        json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    )
    signature = hmac.new(
        secret.encode("utf-8"),
        payload_b64.encode("ascii"),
        hashlib.sha256,
    ).digest()
    return f"{payload_b64}.{_b64encode(signature)}"


def parse_media_token(token: str, *, secret: str) -> MediaTokenPayload:
    try:
        payload_b64, signature_b64 = token.split(".", 1)
    except ValueError as exc:
        raise MediaTokenError("Malformed media token") from exc

    expected_signature = hmac.new(
        secret.encode("utf-8"),
        payload_b64.encode("ascii"),
        hashlib.sha256,
    ).digest()
    try:
        actual_signature = _b64decode(signature_b64)
    except (ValueError, TypeError) as exc:
        raise MediaTokenError("Malformed media token signature") from exc
    if not hmac.compare_digest(actual_signature, expected_signature):
        raise MediaTokenError("Invalid media token signature")

    try:
        raw_payload: dict[str, Any] = json.loads(_b64decode(payload_b64))
    except (json.JSONDecodeError, ValueError, TypeError) as exc:
        raise MediaTokenError("Malformed media token payload") from exc

    storage_key = raw_payload.get("storage_key")
    media_type = raw_payload.get("media_type")
    expires_at = raw_payload.get("exp")
    if not isinstance(storage_key, str) or not storage_key:
        raise MediaTokenError("Media token is missing storage key")
    if not isinstance(media_type, str) or not media_type:
        raise MediaTokenError("Media token is missing media type")
    if not isinstance(expires_at, int):
        raise MediaTokenError("Media token is missing expiry")
    if expires_at < int(time.time()):
        raise MediaTokenError("Media token expired")

    return MediaTokenPayload(
        storage_key=storage_key,
        media_type=media_type,
        expires_at=expires_at,
    )
