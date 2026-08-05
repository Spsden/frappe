import hashlib
import io
from collections.abc import Iterable
from pathlib import Path
from typing import TYPE_CHECKING
from uuid import UUID

from worktrace_api.schemas import ChunkContentType

if TYPE_CHECKING:
    from worktrace_api.settings import Settings


# ---------------------------------------------------------------------------
# Local filesystem backend (original implementation, renamed)
# ---------------------------------------------------------------------------


class LocalChunkStorage:
    def __init__(self, root: Path, max_chunk_bytes: int):
        self.root = root
        self.max_chunk_bytes = max_chunk_bytes

    def write(
        self,
        tenant_id: UUID,
        recording_id: UUID,
        chunk_index: int,
        content_type: ChunkContentType,
        media_type: str,
        original_filename: str | None,
        payload: bytes,
        expected_checksum: str,
    ) -> tuple[str, int]:
        payload_size = self.validate(payload, expected_checksum)

        directory = self.root / str(tenant_id) / str(recording_id)
        directory.mkdir(parents=True, exist_ok=True)
        destination = directory / (
            f"{chunk_index:08d}-{content_type.value}"
            f"{chunk_extension(content_type, media_type, original_filename)}"
        )
        temporary = destination.with_suffix(".tmp")
        temporary.write_bytes(payload)
        temporary.replace(destination)
        return destination.relative_to(self.root).as_posix(), payload_size

    def validate(self, payload: bytes, expected_checksum: str) -> int:
        if not payload:
            raise ValueError("Chunk payload cannot be empty")
        if len(payload) > self.max_chunk_bytes:
            raise ValueError(f"Chunk exceeds maximum size of {self.max_chunk_bytes} bytes")
        actual_checksum = hashlib.sha256(payload).hexdigest()
        if actual_checksum != expected_checksum:
            raise ValueError("Chunk checksum does not match payload")
        return len(payload)

    def delete_recording(self, tenant_id: UUID, recording_id: UUID) -> None:
        directory = self.root / str(tenant_id) / str(recording_id)
        if not directory.exists():
            return
        for file in directory.iterdir():
            if file.is_file():
                file.unlink()
        directory.rmdir()

    def read(self, storage_key: str) -> bytes:
        return self.resolve_storage_key(storage_key).read_bytes()

    def exists(self, storage_key: str) -> bool:
        return self.resolve_storage_key(storage_key).exists()

    def delete(self, storage_key: str) -> None:
        # Idempotent: a missing file is not an error (e.g. re-run after cleanup).
        path = self.resolve_storage_key(storage_key)
        if path.exists():
            path.unlink()

    def resolve_storage_key(self, storage_key: str) -> Path:
        path = (self.root / storage_key).resolve()
        root = self.root.resolve()
        if root not in path.parents:
            raise ValueError("Chunk storage key escapes the recording root")
        return path

    def assemble(
        self,
        tenant_id: UUID,
        recording_id: UUID,
        chunks: Iterable,
        filename: str,
    ) -> tuple[str, int, str]:
        directory = self.root / str(tenant_id) / str(recording_id) / "assembled"
        directory.mkdir(parents=True, exist_ok=True)
        destination = directory / filename
        temporary = destination.with_suffix(".tmp")
        digest = hashlib.sha256()
        payload_size = 0

        with temporary.open("wb") as output:
            for chunk in chunks:
                payload = self.read(chunk.storage_key)
                output.write(payload)
                digest.update(payload)
                payload_size += len(payload)

        temporary.replace(destination)
        return destination.relative_to(self.root).as_posix(), payload_size, digest.hexdigest()

    def write_bytes(
        self, storage_key: str, payload: bytes, content_type: str = "application/octet-stream"
    ) -> None:
        """Atomic write of raw bytes to a storage key.

        Provided for call-site symmetry with S3ChunkStorage.write_bytes().
        Uses the same tmp-then-rename pattern as the rest of this backend.
        """
        destination = self.resolve_storage_key(storage_key)
        destination.parent.mkdir(parents=True, exist_ok=True)
        temporary = destination.with_suffix(f"{destination.suffix}.tmp")
        temporary.write_bytes(payload)
        temporary.replace(destination)


# ---------------------------------------------------------------------------
# S3 backend
# ---------------------------------------------------------------------------


class S3ChunkStorage:
    """S3-backed storage.

    Storage key format: ``<tenant_id>/<recording_id>/<filename>`` — identical
    to LocalChunkStorage so all keys stored in the database are backend-agnostic
    and can be moved between backends without a migration.

    Authentication uses the standard boto3 credential chain (environment
    variables, ~/.aws/credentials, or — on EC2/ECS — the instance/task IAM
    role). Do NOT hardcode credentials.
    """

    def __init__(
        self,
        bucket: str,
        max_chunk_bytes: int,
        region: str | None = None,
        endpoint_url: str | None = None,
    ):
        import boto3

        self.bucket = bucket
        self.max_chunk_bytes = max_chunk_bytes
        self._s3 = boto3.client(
            "s3",
            region_name=region,
            endpoint_url=endpoint_url,  # None = real AWS; set for MiniStack/LocalStack
        )

    # ------------------------------------------------------------------
    # Public interface (mirrors LocalChunkStorage)
    # ------------------------------------------------------------------

    def validate(self, payload: bytes, expected_checksum: str) -> int:
        if not payload:
            raise ValueError("Chunk payload cannot be empty")
        if len(payload) > self.max_chunk_bytes:
            raise ValueError(f"Chunk exceeds maximum size of {self.max_chunk_bytes} bytes")
        actual_checksum = hashlib.sha256(payload).hexdigest()
        if actual_checksum != expected_checksum:
            raise ValueError("Chunk checksum does not match payload")
        return len(payload)

    def write(
        self,
        tenant_id: UUID,
        recording_id: UUID,
        chunk_index: int,
        content_type: ChunkContentType,
        media_type: str,
        original_filename: str | None,
        payload: bytes,
        expected_checksum: str,
    ) -> tuple[str, int]:
        payload_size = self.validate(payload, expected_checksum)
        key = (
            f"{tenant_id}/{recording_id}/"
            f"{chunk_index:08d}-{content_type.value}"
            f"{chunk_extension(content_type, media_type, original_filename)}"
        )
        self._s3.put_object(Bucket=self.bucket, Key=key, Body=payload, ContentType=media_type)
        return key, payload_size

    def read(self, storage_key: str) -> bytes:
        resp = self._s3.get_object(Bucket=self.bucket, Key=storage_key)
        return resp["Body"].read()

    def exists(self, storage_key: str) -> bool:
        from botocore.exceptions import ClientError

        try:
            self._s3.head_object(Bucket=self.bucket, Key=storage_key)
            return True
        except ClientError as exc:
            if exc.response["Error"]["Code"] in {"404", "NoSuchKey"}:
                return False
            raise

    def delete(self, storage_key: str) -> None:
        # S3 delete_object on a missing key is a no-op — inherently idempotent.
        self._s3.delete_object(Bucket=self.bucket, Key=storage_key)

    def delete_recording(self, tenant_id: UUID, recording_id: UUID) -> None:
        prefix = f"{tenant_id}/{recording_id}/"
        paginator = self._s3.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=self.bucket, Prefix=prefix):
            objects = [{"Key": obj["Key"]} for obj in page.get("Contents", [])]
            if objects:
                self._s3.delete_objects(Bucket=self.bucket, Delete={"Objects": objects})

    def assemble(
        self,
        tenant_id: UUID,
        recording_id: UUID,
        chunks: Iterable,
        filename: str,
    ) -> tuple[str, int, str]:
        """Download all chunks, concatenate in memory, upload the assembled file."""
        buffer = io.BytesIO()
        digest = hashlib.sha256()
        total = 0
        for chunk in chunks:
            data = self.read(chunk.storage_key)
            buffer.write(data)
            digest.update(data)
            total += len(data)
        buffer.seek(0)
        dest_key = f"{tenant_id}/{recording_id}/assembled/{filename}"
        self._s3.put_object(Bucket=self.bucket, Key=dest_key, Body=buffer.read())
        return dest_key, total, digest.hexdigest()

    def write_bytes(
        self, storage_key: str, payload: bytes, content_type: str = "application/octet-stream"
    ) -> None:
        """Write raw bytes directly to a storage key.

        This is the S3 equivalent of the tmp→rename atomic write pattern used
        by LocalChunkStorage. S3 put_object is inherently atomic.
        """
        self._s3.put_object(
            Bucket=self.bucket, Key=storage_key, Body=payload, ContentType=content_type
        )

    def generate_presigned_get_url(self, storage_key: str, media_type: str, ttl: int) -> str:
        """Return a short-lived presigned GET URL for the object.

        Used by the media-serving endpoint so the API redirects the client
        directly to S3 instead of proxying the bytes through the API process.
        """
        return self._s3.generate_presigned_url(
            "get_object",
            Params={
                "Bucket": self.bucket,
                "Key": storage_key,
                "ResponseContentType": media_type,
            },
            ExpiresIn=ttl,
        )


# ---------------------------------------------------------------------------
# Union type alias — keeps all existing `ChunkStorage` type hints valid
# ---------------------------------------------------------------------------

type ChunkStorage = LocalChunkStorage | S3ChunkStorage


# ---------------------------------------------------------------------------
# Factory — the single place that decides which backend to use
# ---------------------------------------------------------------------------


def get_chunk_storage(settings: "Settings") -> ChunkStorage:
    """Return the configured storage backend.

    - ``WORKTRACE_STORAGE_BACKEND=local`` (default) → LocalChunkStorage
    - ``WORKTRACE_STORAGE_BACKEND=s3``              → S3ChunkStorage

    Import this function and call it instead of constructing storage directly.
    """
    if settings.storage_backend == "s3":
        if not settings.s3_bucket:
            raise RuntimeError(
                "WORKTRACE_S3_BUCKET must be set when WORKTRACE_STORAGE_BACKEND=s3"
            )
        return S3ChunkStorage(
            bucket=settings.s3_bucket,
            max_chunk_bytes=settings.max_chunk_bytes,
            region=settings.s3_region,
            endpoint_url=settings.s3_endpoint_url,
        )
    return LocalChunkStorage(settings.recording_storage_path, settings.max_chunk_bytes)


# ---------------------------------------------------------------------------
# Shared helpers (unchanged from original)
# ---------------------------------------------------------------------------


def chunk_extension(
    content_type: ChunkContentType,
    media_type: str,
    original_filename: str | None = None,
) -> str:
    preserved_extension = safe_original_extension(content_type, original_filename)
    if preserved_extension:
        return preserved_extension

    normalized = media_type.split(";", 1)[0].strip().lower()

    if content_type == ChunkContentType.SCREENSHOTS:
        if normalized == "image/jpeg":
            return ".jpg"
        if normalized == "image/webp":
            return ".webp"
        return ".png"

    if content_type == ChunkContentType.EVENTS:
        if normalized == "application/json":
            return ".json"
        return ".jsonl"

    if content_type == ChunkContentType.AUDIO:
        return {
            "audio/mpeg": ".mp3",
            "audio/mp3": ".mp3",
            "audio/wav": ".wav",
            "audio/x-wav": ".wav",
            "audio/webm": ".webm",
            "audio/ogg": ".ogg",
            "audio/mp4": ".m4a",
        }.get(normalized, ".audio")

    return ".bin"


def safe_original_extension(
    content_type: ChunkContentType, original_filename: str | None
) -> str | None:
    if not original_filename:
        return None

    extension = Path(original_filename).suffix.lower()
    if not extension:
        return None

    allowed_extensions = {
        ChunkContentType.SCREENSHOTS: {".png", ".jpg", ".jpeg", ".webp"},
        ChunkContentType.EVENTS: {".jsonl", ".ndjson", ".json"},
        ChunkContentType.AUDIO: {".webm", ".ogg", ".wav", ".mp3", ".m4a", ".mp4"},
    }
    if extension not in allowed_extensions.get(content_type, set()):
        return None
    return extension
