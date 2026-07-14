from collections.abc import Generator
from datetime import UTC, datetime
from uuid import UUID, uuid4

from sqlalchemy import Select, delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from worktrace_api.database import (
    AIApprovalRecord,
    FeedbackRecord,
    RecordingChunkRecord,
    RecordingRecord,
    ScreenshotRecord,
    SessionLocal,
    SOPRecord,
    WorkflowSessionRecord,
)
from worktrace_api.schemas import (
    SOP,
    CaptureSource,
    ChunkContentType,
    ChunkReceipt,
    Feedback,
    Recording,
    RecordingStatus,
    Screenshot,
    WorkflowSession,
)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def tenant_query(model: type, tenant_id: UUID) -> Select:
    return select(model).where(model.tenant_id == str(tenant_id))


class Repository:
    def __init__(self, db: Session, tenant_id: UUID):
        self.db = db
        self.tenant_id = tenant_id

    def save_session(self, session: WorkflowSession) -> WorkflowSession:
        self._require_tenant(session.tenant_id)
        record = WorkflowSessionRecord(
            id=str(session.id),
            tenant_id=str(session.tenant_id),
            recording_id=str(session.recording_id) if session.recording_id else None,
            source_type=session.source_type,
            workflow_name=session.workflow_name,
            status=session.status,
            typed_text_consent=session.typed_text_consent,
            consent_actor=session.consent_actor,
            consent_statement_version=session.consent_statement_version,
            consented_at=session.consented_at,
            external_ai_approved=session.external_ai_approved,
            external_ai_approved_at=session.external_ai_approved_at,
            external_ai_payload_hash=session.external_ai_payload_hash,
            duration_ms=session.duration_ms,
            transcript=session.transcript.model_dump(mode="json") if session.transcript else None,
            events=[event.model_dump(mode="json") for event in session.events],
            created_at=session.created_at,
        )
        self.db.add(record)
        self.db.commit()
        return session

    def create_recording(
        self, workflow_name: str, source_type: CaptureSource, has_audio: bool
    ) -> Recording:
        recording = Recording(
            tenant_id=self.tenant_id,
            id=uuid4(),
            workflow_name=workflow_name,
            source_type=source_type,
            status=RecordingStatus.RECORDING,
            uploaded_chunk_count=0,
            uploaded_bytes=0,
            has_audio=has_audio,
            created_at=datetime.now(UTC),
        )
        self.db.add(
            RecordingRecord(
                id=str(recording.id),
                tenant_id=str(self.tenant_id),
                source_type=source_type,
                workflow_name=workflow_name,
                status=recording.status,
                uploaded_chunk_count=0,
                uploaded_bytes=0,
                has_audio=has_audio,
                created_at=recording.created_at,
            )
        )
        self.db.commit()
        return recording

    def get_recording(self, recording_id: UUID) -> Recording | None:
        record = self.db.scalar(
            tenant_query(RecordingRecord, self.tenant_id).where(
                RecordingRecord.id == str(recording_id)
            )
        )
        return self._recording_from_record(record) if record else None

    def delete_recording(self, recording_id: UUID) -> bool:
        if not self.get_recording(recording_id):
            return False
        self.db.execute(
            delete(RecordingChunkRecord).where(
                RecordingChunkRecord.tenant_id == str(self.tenant_id),
                RecordingChunkRecord.recording_id == str(recording_id),
            )
        )
        self.db.execute(
            delete(RecordingRecord).where(
                RecordingRecord.tenant_id == str(self.tenant_id),
                RecordingRecord.id == str(recording_id),
            )
        )
        self.db.commit()
        return True

    def save_chunk(
        self,
        recording_id: UUID,
        chunk_index: int,
        content_type: ChunkContentType,
        media_type: str,
        timestamp_start_ms: int,
        timestamp_end_ms: int,
        checksum_sha256: str,
        idempotency_key: str,
        payload_size: int,
        storage_key: str,
        metadata_json: dict | None = None,
    ) -> ChunkReceipt:
        existing = self.db.scalar(
            tenant_query(RecordingChunkRecord, self.tenant_id).where(
                RecordingChunkRecord.recording_id == str(recording_id),
                RecordingChunkRecord.chunk_index == chunk_index,
            )
        )
        if existing:
            if (
                existing.checksum_sha256 != checksum_sha256
                or existing.idempotency_key != idempotency_key
            ):
                raise ValueError("Chunk index already exists with different content")
            return ChunkReceipt(
                recording_id=recording_id,
                chunk_index=chunk_index,
                checksum_sha256=checksum_sha256,
                payload_size=existing.payload_size,
                duplicate=True,
            )

        recording = self.db.scalar(
            tenant_query(RecordingRecord, self.tenant_id).where(
                RecordingRecord.id == str(recording_id)
            )
        )
        if not recording:
            raise LookupError("Recording not found")
        if recording.status not in {RecordingStatus.RECORDING, RecordingStatus.UPLOADING}:
            raise ValueError("Recording no longer accepts chunks")
        if self.db.scalar(
            tenant_query(RecordingChunkRecord, self.tenant_id).where(
                RecordingChunkRecord.idempotency_key == idempotency_key
            )
        ):
            raise ValueError("Chunk idempotency key already exists with different content")

        self.db.add(
            RecordingChunkRecord(
                recording_id=str(recording_id),
                chunk_index=chunk_index,
                tenant_id=str(self.tenant_id),
                content_type=content_type,
                media_type=media_type,
                timestamp_start_ms=timestamp_start_ms,
                timestamp_end_ms=timestamp_end_ms,
                checksum_sha256=checksum_sha256,
                idempotency_key=idempotency_key,
                payload_size=payload_size,
                storage_key=storage_key,
                metadata_json=metadata_json or {},
            )
        )
        recording.status = RecordingStatus.UPLOADING
        recording.uploaded_chunk_count = RecordingRecord.uploaded_chunk_count + 1
        recording.uploaded_bytes = RecordingRecord.uploaded_bytes + payload_size
        try:
            self.db.commit()
        except IntegrityError as exc:
            self.db.rollback()
            raise ValueError("Chunk violates recording uniqueness constraints") from exc
        return ChunkReceipt(
            recording_id=recording_id,
            chunk_index=chunk_index,
            checksum_sha256=checksum_sha256,
            payload_size=payload_size,
        )

    def get_matching_chunk_receipt(
        self,
        recording_id: UUID,
        chunk_index: int,
        content_type: ChunkContentType,
        timestamp_start_ms: int,
        timestamp_end_ms: int,
        checksum_sha256: str,
        idempotency_key: str,
        metadata_json: dict | None = None,
    ) -> ChunkReceipt | None:
        record = self.db.scalar(
            tenant_query(RecordingChunkRecord, self.tenant_id).where(
                RecordingChunkRecord.recording_id == str(recording_id),
                RecordingChunkRecord.chunk_index == chunk_index,
            )
        )
        if not record:
            return None
        if (
            record.content_type != content_type
            or record.timestamp_start_ms != timestamp_start_ms
            or record.timestamp_end_ms != timestamp_end_ms
            or record.checksum_sha256 != checksum_sha256
            or record.idempotency_key != idempotency_key
            or record.metadata_json != (metadata_json or {})
        ):
            raise ValueError("Chunk index already exists with different content or metadata")
        return ChunkReceipt(
            recording_id=recording_id,
            chunk_index=chunk_index,
            checksum_sha256=record.checksum_sha256,
            payload_size=record.payload_size,
            duplicate=True,
        )

    def complete_recording(self, recording_id: UUID, expected_chunk_count: int) -> Recording:
        record = self.db.scalar(
            tenant_query(RecordingRecord, self.tenant_id).where(
                RecordingRecord.id == str(recording_id)
            )
        )
        if not record:
            raise LookupError("Recording not found")
        indexes = self.db.scalars(
            select(RecordingChunkRecord.chunk_index)
            .where(
                RecordingChunkRecord.tenant_id == str(self.tenant_id),
                RecordingChunkRecord.recording_id == str(recording_id),
            )
            .order_by(RecordingChunkRecord.chunk_index)
        ).all()
        expected_indexes = list(range(expected_chunk_count))
        if list(indexes) != expected_indexes:
            missing = sorted(set(expected_indexes) - set(indexes))
            raise ValueError(f"Recording has missing chunks: {missing}")
        record.expected_chunk_count = expected_chunk_count
        record.status = RecordingStatus.VALIDATING
        record.completed_at = datetime.now(UTC)
        self.db.commit()
        return self._recording_from_record(record)

    def list_recording_chunks(self, recording_id: UUID) -> list[RecordingChunkRecord]:
        return list(
            self.db.scalars(
                tenant_query(RecordingChunkRecord, self.tenant_id)
                .where(RecordingChunkRecord.recording_id == str(recording_id))
                .order_by(RecordingChunkRecord.chunk_index)
            ).all()
        )

    def delete_audio_chunks(self, recording_id: UUID) -> list[str]:
        # Drops ONLY audio chunks for a recording (rows first, then the caller
        # deletes the files using the returned storage_keys). Screenshots/events
        # chunks are left intact. Idempotent: a second call returns [].
        audio_chunks = self.db.scalars(
            tenant_query(RecordingChunkRecord, self.tenant_id)
            .where(
                RecordingChunkRecord.recording_id == str(recording_id),
                RecordingChunkRecord.content_type == ChunkContentType.AUDIO.value,
            )
        ).all()
        storage_keys = [chunk.storage_key for chunk in audio_chunks]
        if storage_keys:
            self.db.execute(
                delete(RecordingChunkRecord).where(
                    RecordingChunkRecord.tenant_id == str(self.tenant_id),
                    RecordingChunkRecord.recording_id == str(recording_id),
                    RecordingChunkRecord.content_type == ChunkContentType.AUDIO.value,
                )
            )
            self.db.commit()
        return storage_keys

    def save_screenshots(self, screenshots: list[Screenshot]) -> list[Screenshot]:
        for screenshot in screenshots:
            self._require_tenant(screenshot.tenant_id)
            self.db.add(
                ScreenshotRecord(
                    id=str(screenshot.id),
                    tenant_id=str(screenshot.tenant_id),
                    recording_id=str(screenshot.recording_id),
                    session_id=str(screenshot.session_id) if screenshot.session_id else None,
                    sequence=screenshot.sequence,
                    captured_at=screenshot.captured_at,
                    storage_key=screenshot.storage_key,
                    media_type=screenshot.media_type,
                    width=screenshot.width,
                    height=screenshot.height,
                    change_score=screenshot.change_score,
                    content_hash=screenshot.content_hash,
                    redaction_status=screenshot.redaction_status,
                    created_at=screenshot.created_at,
                )
            )
        self.db.commit()
        return screenshots

    def get_screenshots_for_recording(self, recording_id: UUID) -> list[Screenshot]:
        records = self.db.scalars(
            tenant_query(ScreenshotRecord, self.tenant_id)
            .where(ScreenshotRecord.recording_id == str(recording_id))
            .order_by(ScreenshotRecord.sequence)
        ).all()
        return [self._screenshot_from_record(r) for r in records]

    def get_screenshots_for_session(self, session_id: UUID) -> list[Screenshot]:
        records = self.db.scalars(
            tenant_query(ScreenshotRecord, self.tenant_id)
            .where(ScreenshotRecord.session_id == str(session_id))
            .order_by(ScreenshotRecord.sequence)
        ).all()
        return [self._screenshot_from_record(r) for r in records]

    def update_screenshot_annotation(
        self, screenshot_id: UUID, annotated_key: str | None, status: str
    ) -> None:
        record = self.db.scalar(
            tenant_query(ScreenshotRecord, self.tenant_id)
            .where(ScreenshotRecord.id == str(screenshot_id))
        )
        if record:
            record.annotated_storage_key = annotated_key
            record.redaction_status = status
            self.db.commit()

    def link_recording_session(
        self, recording_id: UUID, session_id: UUID, status: RecordingStatus
    ) -> Recording:
        record = self.db.scalar(
            tenant_query(RecordingRecord, self.tenant_id).where(
                RecordingRecord.id == str(recording_id)
            )
        )
        if not record:
            raise LookupError("Recording not found")
        record.session_id = str(session_id)
        record.status = status
        record.error_message = None
        self.db.commit()
        return self._recording_from_record(record)

    def set_recording_status(
        self, recording_id: UUID, status: RecordingStatus, error_message: str | None = None
    ) -> Recording | None:
        record = self.db.scalar(
            tenant_query(RecordingRecord, self.tenant_id).where(
                RecordingRecord.id == str(recording_id)
            )
        )
        if not record:
            return None
        record.status = status
        record.error_message = error_message
        self.db.commit()
        return self._recording_from_record(record)

    def get_session(self, session_id: UUID) -> WorkflowSession | None:
        record = self.db.scalar(
            tenant_query(WorkflowSessionRecord, self.tenant_id).where(
                WorkflowSessionRecord.id == str(session_id)
            )
        )
        return self._session_from_record(record) if record else None

    def list_sessions(
        self, workflow_name: str | None = None, limit: int | None = None, offset: int = 0
    ) -> list[WorkflowSession]:
        query = tenant_query(WorkflowSessionRecord, self.tenant_id)
        if workflow_name:
            query = query.where(WorkflowSessionRecord.workflow_name == workflow_name)
        query = query.order_by(WorkflowSessionRecord.created_at).offset(offset)
        if limit is not None:
            query = query.limit(limit)
        records = self.db.scalars(query).all()
        return [self._session_from_record(record) for record in records]

    def delete_session(self, session_id: UUID) -> bool:
        session = self.get_session(session_id)
        if not session:
            return False
        session_key = str(session_id)
        self.db.execute(
            delete(AIApprovalRecord).where(
                AIApprovalRecord.tenant_id == str(self.tenant_id),
                AIApprovalRecord.session_id == session_key,
            )
        )
        self.db.execute(
            delete(FeedbackRecord).where(
                FeedbackRecord.tenant_id == str(self.tenant_id),
                FeedbackRecord.session_id == session_key,
            )
        )
        self.db.execute(
            delete(SOPRecord).where(
                SOPRecord.tenant_id == str(self.tenant_id),
                SOPRecord.source_session_id == session_key,
            )
        )
        self.db.execute(
            delete(WorkflowSessionRecord).where(
                WorkflowSessionRecord.tenant_id == str(self.tenant_id),
                WorkflowSessionRecord.id == session_key,
            )
        )
        self.db.commit()
        return True

    def save_sop(self, sop: SOP) -> SOP:
        self._require_tenant(sop.tenant_id)
        record = SOPRecord(
            id=str(sop.id),
            tenant_id=str(sop.tenant_id),
            source_session_id=str(sop.source_session_id),
            version=sop.version,
            status=sop.status,
            title=sop.title,
            steps=[step.model_dump(mode="json") for step in sop.steps],
            created_at=sop.created_at,
        )
        self.db.add(record)
        self.db.commit()
        return sop

    def next_sop_version(self, session_id: UUID) -> int:
        return len(self.list_sops_for_session(session_id)) + 1

    def get_sop(self, sop_id: UUID) -> SOP | None:
        record = self.db.scalar(
            tenant_query(SOPRecord, self.tenant_id).where(SOPRecord.id == str(sop_id))
        )
        return self._sop_from_record(record) if record else None

    def list_sops_for_session(self, session_id: UUID) -> list[SOP]:
        records = self.db.scalars(
            tenant_query(SOPRecord, self.tenant_id)
            .where(SOPRecord.source_session_id == str(session_id))
            .order_by(SOPRecord.version)
        ).all()
        return [self._sop_from_record(record) for record in records]

    def set_sop_status(self, sop_id: UUID, status: str) -> SOP | None:
        record = self.db.scalar(
            tenant_query(SOPRecord, self.tenant_id).where(SOPRecord.id == str(sop_id))
        )
        if not record:
            return None
        record.status = status
        self.db.commit()
        return self._sop_from_record(record)

    def save_feedback(self, feedback: Feedback) -> Feedback:
        self._require_tenant(feedback.tenant_id)
        record = FeedbackRecord(
            id=str(feedback.id),
            tenant_id=str(feedback.tenant_id),
            session_id=str(feedback.session_id),
            sop_step_id=str(feedback.sop_step_id) if feedback.sop_step_id else None,
            transcript=feedback.transcript,
            classification=feedback.classification,
            audio_reference=str(feedback.audio_reference) if feedback.audio_reference else None,
            created_at=feedback.created_at,
        )
        self.db.add(record)
        self.db.commit()
        return feedback

    def list_feedback_for_session(self, session_id: UUID) -> list[Feedback]:
        records = self.db.scalars(
            tenant_query(FeedbackRecord, self.tenant_id)
            .where(FeedbackRecord.session_id == str(session_id))
            .order_by(FeedbackRecord.created_at)
        ).all()
        return [self._feedback_from_record(record) for record in records]

    def sop_step_belongs_to_session(self, session_id: UUID, step_id: UUID) -> bool:
        return any(
            step.id == step_id
            for sop in self.list_sops_for_session(session_id)
            for step in sop.steps
        )

    def record_ai_approval(
        self, session_id: UUID, actor: str, payload_hash: str, approved: bool
    ) -> WorkflowSession | None:
        record = self.db.scalar(
            tenant_query(WorkflowSessionRecord, self.tenant_id).where(
                WorkflowSessionRecord.id == str(session_id)
            )
        )
        if not record:
            return None
        now = datetime.now(UTC)
        record.external_ai_approved = approved
        record.external_ai_approved_at = now
        record.external_ai_payload_hash = payload_hash if approved else None
        self.db.add(
            AIApprovalRecord(
                id=str(uuid4()),
                tenant_id=str(self.tenant_id),
                session_id=str(session_id),
                actor=actor,
                payload_hash=payload_hash,
                approved=approved,
                created_at=now,
            )
        )
        self.db.commit()
        return self._session_from_record(record)

    def _require_tenant(self, tenant_id: UUID) -> None:
        if tenant_id != self.tenant_id:
            raise ValueError("Cross-tenant write rejected")

    @staticmethod
    def _session_from_record(record: WorkflowSessionRecord) -> WorkflowSession:
        return WorkflowSession.model_validate(
            {
                "schema_version": "1.0",
                "tenant_id": record.tenant_id,
                "id": record.id,
                "recording_id": record.recording_id,
                "source_type": record.source_type,
                "workflow_name": record.workflow_name,
                "status": record.status,
                "typed_text_consent": record.typed_text_consent,
                "consent_actor": record.consent_actor,
                "consent_statement_version": record.consent_statement_version,
                "consented_at": record.consented_at,
                "external_ai_approved": record.external_ai_approved,
                "external_ai_approved_at": record.external_ai_approved_at,
                "external_ai_payload_hash": record.external_ai_payload_hash,
                "duration_ms": record.duration_ms,
                "transcript": record.transcript,
                "events": record.events,
                "created_at": record.created_at,
            }
        )

    @staticmethod
    def _sop_from_record(record: SOPRecord) -> SOP:
        return SOP.model_validate(
            {
                "schema_version": "1.0",
                "tenant_id": record.tenant_id,
                "id": record.id,
                "source_session_id": record.source_session_id,
                "version": record.version,
                "status": record.status,
                "title": record.title,
                "steps": record.steps,
                "created_at": record.created_at,
            }
        )

    @staticmethod
    def _feedback_from_record(record: FeedbackRecord) -> Feedback:
        return Feedback.model_validate(
            {
                "schema_version": "1.0",
                "tenant_id": record.tenant_id,
                "id": record.id,
                "session_id": record.session_id,
                "sop_step_id": record.sop_step_id,
                "transcript": record.transcript,
                "classification": record.classification,
                "audio_reference": record.audio_reference,
                "created_at": record.created_at,
            }
        )

    @staticmethod
    def _recording_from_record(record: RecordingRecord) -> Recording:
        return Recording.model_validate(
            {
                "schema_version": "1.0",
                "tenant_id": record.tenant_id,
                "id": record.id,
                "workflow_name": record.workflow_name,
                "source_type": record.source_type,
                "session_id": record.session_id,
                "status": record.status,
                "expected_chunk_count": record.expected_chunk_count,
                "uploaded_chunk_count": record.uploaded_chunk_count,
                "uploaded_bytes": record.uploaded_bytes,
                "has_audio": record.has_audio,
                "error_message": record.error_message,
                "created_at": record.created_at,
                "completed_at": record.completed_at,
            }
        )

    @staticmethod
    def _screenshot_from_record(record: ScreenshotRecord) -> Screenshot:
        return Screenshot.model_validate(
            {
                "schema_version": "1.0",
                "id": record.id,
                "tenant_id": record.tenant_id,
                "recording_id": record.recording_id,
                "session_id": record.session_id,
                "sequence": record.sequence,
                "captured_at": record.captured_at,
                "storage_key": record.storage_key,
                "media_type": record.media_type,
                "width": record.width,
                "height": record.height,
                "change_score": record.change_score,
                "content_hash": record.content_hash,
                "annotated_storage_key": getattr(record, "annotated_storage_key", None),
                "redaction_status": record.redaction_status,
                "created_at": record.created_at,
            }
        )
