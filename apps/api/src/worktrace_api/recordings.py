import hashlib
from collections.abc import Iterable
from pathlib import Path
from uuid import UUID

from worktrace_api.schemas import ChunkContentType


class StoredChunk:
    storage_key: str


class ChunkStorage:
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
        chunks: Iterable[StoredChunk],
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
