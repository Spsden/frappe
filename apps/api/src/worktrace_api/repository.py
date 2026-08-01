import hashlib
import json
from collections.abc import Generator, Sequence
from datetime import UTC, datetime
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import Select, case, delete, distinct, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from worktrace_api.database import (
    AIApprovalRecord,
    AnalyticsRunInputRecord,
    AnalyticsRunRecord,
    FeedbackRecord,
    LLMProviderSettingsRecord,
    RecordingChunkRecord,
    RecordingRecord,
    ScreenshotRecord,
    SessionLocal,
    SopLimitsSettingsRecord,
    SOPRecord,
    SOPStepEmbeddingRecord,
    UserRecord,
    WorkflowRecord,
    WorkflowSessionRecord,
)
from worktrace_api.schemas import (
    SOP,
    SOP_LIMIT_FIELDS,
    AnalyticsEligibleRecording,
    AnalyticsResult,
    AnalyticsRun,
    AnalyticsRunInput,
    AnalyticsRunMode,
    AnalyticsRunStatus,
    CaptureSource,
    ChunkContentType,
    ChunkReceipt,
    DashboardSummary,
    Feedback,
    LLMProviderSettings,
    LLMProviderSettingsUpdate,
    Recording,
    RecordingStatus,
    RecordingTranscript,
    Screenshot,
    SearchResponse,
    SearchResult,
    SearchResultKind,
    SopLimitsSettings,
    SopLimitsSettingsUpdate,
    SOPStatus,
    TranscriptSegment,
    Workflow,
    WorkflowRecording,
    WorkflowSession,
)


def get_db() -> Generator[Session, None, None]:
    with SessionLocal() as db:
        yield db


def tenant_query(model: type, tenant_id: UUID) -> Select:
    return select(model).where(model.tenant_id == str(tenant_id))


# Recording statuses that count as "still working" vs "done" for the workflow
# summary cards. Kept as plain strings so they slot into SQL ``IN`` clauses.
PROCESSING_RECORDING_STATUSES = [
    RecordingStatus.RECORDING.value,
    RecordingStatus.UPLOADING.value,
    RecordingStatus.VALIDATING.value,
    RecordingStatus.TRANSCRIBING_AUDIO.value,
    RecordingStatus.PROCESSING_SCREENSHOTS.value,
    RecordingStatus.ALIGNING_EVIDENCE.value,
    RecordingStatus.AWAITING_MANUAL_REVIEW.value,
    RecordingStatus.GENERATING_SOP.value,
    RecordingStatus.SOP_FAILED.value,
]
READY_RECORDING_STATUSES = [
    RecordingStatus.READY_FOR_REVIEW.value,
    RecordingStatus.COMPLETED.value,
]


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
        self,
        workflow_id: UUID,
        workflow_name: str,
        source_type: CaptureSource,
        has_audio: bool,
        recording_id: UUID | None = None,
        manual_mode: bool = False,
        reference: str | None = None,
        recorded_by: UUID | None = None,
    ) -> Recording:
        recording_id = recording_id or uuid4()
        created_at = datetime.now(UTC)
        reference_value = reference.strip() if reference else None
        recorded_by_value = str(recorded_by) if recorded_by else None
        recording = Recording(
            tenant_id=self.tenant_id,
            id=recording_id,
            workflow_id=workflow_id,
            workflow_name=workflow_name,
            reference=reference_value,
            recorded_by=recorded_by_value,
            source_type=source_type,
            status=RecordingStatus.RECORDING,
            uploaded_chunk_count=0,
            uploaded_bytes=0,
            has_audio=has_audio,
            manual_mode=manual_mode,
            created_at=created_at,
        )
        self.db.add(
            RecordingRecord(
                id=str(recording.id),
                tenant_id=str(self.tenant_id),
                workflow_id=str(workflow_id),
                workflow_name=workflow_name,
                reference=reference_value,
                recorded_by=recorded_by_value,
                source_type=source_type,
                status=recording.status,
                uploaded_chunk_count=0,
                uploaded_bytes=0,
                has_audio=has_audio,
                manual_mode=manual_mode,
                created_at=created_at,
            )
        )
        try:
            self.db.commit()
        except IntegrityError as exc:
            self.db.rollback()
            raise ValueError("Recording id already exists") from exc
        return recording

    def get_recording(self, recording_id: UUID) -> Recording | None:
        record = self.db.scalar(
            tenant_query(RecordingRecord, self.tenant_id).where(
                RecordingRecord.id == str(recording_id)
            )
        )
        return self._recording_from_record(record) if record else None

    # ------------------------------------------------------------------ #
    # Workflows: a shared procedure that groups many recordings.          #
    # ------------------------------------------------------------------ #

    def create_workflow(
        self,
        name: str,
        description: str | None = None,
        created_by: UUID | None = None,
    ) -> Workflow:
        now = datetime.now(UTC)
        record = WorkflowRecord(
            id=str(uuid4()),
            tenant_id=str(self.tenant_id),
            name=name,
            description=description,
            created_by=str(created_by) if created_by else None,
            created_at=now,
            updated_at=now,
        )
        self.db.add(record)
        try:
            self.db.commit()
        except IntegrityError as exc:
            self.db.rollback()
            raise ValueError("A workflow with this name already exists") from exc
        return self._workflow_from_record(record)

    def get_workflow(self, workflow_id: UUID) -> Workflow | None:
        row = self.db.execute(
            self._workflow_summary_query(WorkflowRecord.id == str(workflow_id))
        ).first()
        if not row:
            return None
        workflow = self._workflow_from_row(row)
        creator_id = row.WorkflowRecord.created_by
        if creator_id:
            workflow.created_by_email = self._user_email(creator_id)
        return workflow

    def get_workflow_by_name(self, name: str) -> Workflow | None:
        row = self.db.execute(
            self._workflow_summary_query(WorkflowRecord.name == name)
        ).first()
        return self._workflow_from_row(row) if row else None

    def list_workflows(
        self,
        query: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[Workflow]:
        stmt = (
            self._workflow_summary_query()
            .order_by(
                func.coalesce(
                    func.max(RecordingRecord.created_at), WorkflowRecord.created_at
                ).desc(),
                WorkflowRecord.name.asc(),
            )
            .offset(offset)
            .limit(limit)
        )
        if query:
            stmt = stmt.where(WorkflowRecord.name.ilike(f"%{query}%"))
        return [self._workflow_from_row(row) for row in self.db.execute(stmt).all()]

    def list_recordings_for_workflow(self, workflow_id: UUID) -> list[WorkflowRecording]:
        rows = self.db.execute(
            select(
                RecordingRecord,
                WorkflowSessionRecord.duration_ms.label("duration_ms"),
                UserRecord.email.label("recorded_by_email"),
            )
            .outerjoin(
                WorkflowSessionRecord,
                WorkflowSessionRecord.id == RecordingRecord.session_id,
            )
            .outerjoin(UserRecord, UserRecord.id == RecordingRecord.recorded_by)
            .where(
                RecordingRecord.tenant_id == str(self.tenant_id),
                RecordingRecord.workflow_id == str(workflow_id),
            )
            .order_by(RecordingRecord.created_at.desc())
        ).all()
        return [self._workflow_recording_from_row(row) for row in rows]

    def list_analytics_eligible_recordings(
        self, workflow_id: UUID
    ) -> list[AnalyticsEligibleRecording]:
        """Return one row per recording using its latest approved SOP.

        A newer draft does not displace an older approval. This is deliberate:
        analytics only changes after the regenerated SOP is explicitly approved.
        """
        latest_approved = (
            select(
                SOPRecord.source_session_id.label("session_id"),
                func.max(SOPRecord.version).label("sop_version"),
            )
            .where(
                SOPRecord.tenant_id == str(self.tenant_id),
                SOPRecord.status == SOPStatus.APPROVED.value,
            )
            .group_by(SOPRecord.source_session_id)
            .subquery()
        )
        rows = self.db.execute(
            select(
                RecordingRecord,
                WorkflowSessionRecord.duration_ms,
                SOPRecord,
                UserRecord.email.label("recorded_by_email"),
            )
            .join(
                WorkflowSessionRecord,
                WorkflowSessionRecord.id == RecordingRecord.session_id,
            )
            .join(
                latest_approved,
                latest_approved.c.session_id == WorkflowSessionRecord.id,
            )
            .join(
                SOPRecord,
                (SOPRecord.source_session_id == latest_approved.c.session_id)
                & (SOPRecord.version == latest_approved.c.sop_version)
                & (SOPRecord.tenant_id == str(self.tenant_id)),
            )
            .outerjoin(UserRecord, UserRecord.id == RecordingRecord.recorded_by)
            .where(
                RecordingRecord.tenant_id == str(self.tenant_id),
                RecordingRecord.workflow_id == str(workflow_id),
            )
            .order_by(RecordingRecord.created_at.desc())
        ).all()
        return [
            AnalyticsEligibleRecording(
                recording_id=row.RecordingRecord.id,
                session_id=row.RecordingRecord.session_id,
                reference=row.RecordingRecord.reference,
                recorded_by=row.RecordingRecord.recorded_by,
                recorded_by_email=row.recorded_by_email,
                duration_ms=row.duration_ms,
                sop_id=row.SOPRecord.id,
                sop_version=row.SOPRecord.version,
                sop_title=row.SOPRecord.title,
                step_count=len(row.SOPRecord.steps or []),
                approved_sop_created_at=row.SOPRecord.created_at,
            )
            for row in rows
        ]

    def create_analytics_run(
        self,
        workflow_id: UUID,
        recording_ids: Sequence[UUID],
        *,
        created_by: UUID | None,
        embedding_model: str,
        algorithm_version: str,
    ) -> AnalyticsRun:
        if not 2 <= len(recording_ids) <= 5:
            raise ValueError("Select between 2 and 5 recordings")
        if len(set(recording_ids)) != len(recording_ids):
            raise ValueError("Each recording can only be selected once")

        workflow = self.db.scalar(
            tenant_query(WorkflowRecord, self.tenant_id)
            .where(WorkflowRecord.id == str(workflow_id))
            .with_for_update()
        )
        if not workflow:
            raise LookupError("Workflow not found")

        eligible = {
            item.recording_id: item
            for item in self.list_analytics_eligible_recordings(workflow_id)
        }
        missing = [recording_id for recording_id in recording_ids if recording_id not in eligible]
        if missing:
            raise ValueError(
                "Every selected recording must belong to this workflow and have an approved SOP"
            )

        latest_run = self.db.scalar(
            tenant_query(AnalyticsRunRecord, self.tenant_id)
            .where(AnalyticsRunRecord.workflow_id == str(workflow_id))
            .order_by(AnalyticsRunRecord.version.desc())
            .limit(1)
        )
        version = (latest_run.version + 1) if latest_run else 1
        now = datetime.now(UTC)
        run = AnalyticsRunRecord(
            id=str(uuid4()),
            tenant_id=str(self.tenant_id),
            workflow_id=str(workflow_id),
            version=version,
            mode=AnalyticsRunMode.RECORDING_COMPARISON.value,
            status=AnalyticsRunStatus.QUEUED.value,
            input_count=len(recording_ids),
            embedding_model=embedding_model,
            algorithm_version=algorithm_version,
            created_by=str(created_by) if created_by else None,
            supersedes_run_id=latest_run.id if latest_run else None,
            created_at=now,
            updated_at=now,
        )
        self.db.add(run)
        self.db.flush()

        for position, recording_id in enumerate(recording_ids, start=1):
            item = eligible[recording_id]
            sop_record = self.db.scalar(
                tenant_query(SOPRecord, self.tenant_id).where(
                    SOPRecord.id == str(item.sop_id)
                )
            )
            if not sop_record:  # Defensive: eligibility and snapshot share one transaction.
                raise ValueError("An approved SOP changed while analytics was being created")
            sop = self._sop_from_record(sop_record)
            snapshot = sop.model_dump(mode="json")
            content = json.dumps(snapshot, sort_keys=True, separators=(",", ":"))
            self.db.add(
                AnalyticsRunInputRecord(
                    id=str(uuid4()),
                    tenant_id=str(self.tenant_id),
                    run_id=run.id,
                    position=position,
                    recording_id=str(recording_id),
                    session_id=str(item.session_id),
                    sop_id=str(item.sop_id),
                    sop_version=item.sop_version,
                    sop_content_hash=hashlib.sha256(content.encode()).hexdigest(),
                    sop_snapshot=snapshot,
                    recording_reference=item.reference,
                    recorded_by=str(item.recorded_by) if item.recorded_by else None,
                    recorded_by_email=item.recorded_by_email,
                    duration_ms=item.duration_ms,
                    created_at=now,
                )
            )
        self.db.commit()
        created = self.get_analytics_run(UUID(run.id))
        if not created:
            raise RuntimeError("Analytics run was saved but could not be reloaded")
        return created

    def get_analytics_run(self, run_id: UUID) -> AnalyticsRun | None:
        record = self.db.scalar(
            tenant_query(AnalyticsRunRecord, self.tenant_id).where(
                AnalyticsRunRecord.id == str(run_id)
            )
        )
        if not record:
            return None
        workflow = self.db.scalar(
            tenant_query(WorkflowRecord, self.tenant_id).where(
                WorkflowRecord.id == record.workflow_id
            )
        )
        if not workflow:
            return None
        inputs = self.db.scalars(
            tenant_query(AnalyticsRunInputRecord, self.tenant_id)
            .where(AnalyticsRunInputRecord.run_id == record.id)
            .order_by(AnalyticsRunInputRecord.position)
        ).all()
        return self._analytics_run_from_records(record, workflow.name, inputs)

    def list_analytics_runs(self, workflow_id: UUID, limit: int = 25) -> list[AnalyticsRun]:
        runs = self.db.scalars(
            tenant_query(AnalyticsRunRecord, self.tenant_id)
            .where(AnalyticsRunRecord.workflow_id == str(workflow_id))
            .order_by(AnalyticsRunRecord.version.desc())
            .limit(limit)
        ).all()
        if not runs:
            return []
        workflow = self.db.scalar(
            tenant_query(WorkflowRecord, self.tenant_id).where(
                WorkflowRecord.id == str(workflow_id)
            )
        )
        if not workflow:
            return []
        run_ids = [record.id for record in runs]
        inputs = self.db.scalars(
            tenant_query(AnalyticsRunInputRecord, self.tenant_id)
            .where(AnalyticsRunInputRecord.run_id.in_(run_ids))
            .order_by(AnalyticsRunInputRecord.run_id, AnalyticsRunInputRecord.position)
        ).all()
        inputs_by_run: dict[str, list[AnalyticsRunInputRecord]] = {
            run_id: [] for run_id in run_ids
        }
        for item in inputs:
            inputs_by_run[item.run_id].append(item)
        return [
            self._analytics_run_from_records(record, workflow.name, inputs_by_run[record.id])
            for record in runs
        ]

    def get_analytics_input_snapshots(self, run_id: UUID) -> list[dict[str, Any]]:
        run = self.db.scalar(
            tenant_query(AnalyticsRunRecord, self.tenant_id).where(
                AnalyticsRunRecord.id == str(run_id)
            )
        )
        if not run:
            raise LookupError("Analytics run not found")
        inputs = self.db.scalars(
            tenant_query(AnalyticsRunInputRecord, self.tenant_id)
            .where(AnalyticsRunInputRecord.run_id == str(run_id))
            .order_by(AnalyticsRunInputRecord.position)
        ).all()
        return [
            {
                "position": item.position,
                "recording_id": item.recording_id,
                "duration_ms": item.duration_ms,
                "reference": item.recording_reference,
                "recorded_by_email": item.recorded_by_email,
                "sop": item.sop_snapshot,
            }
            for item in inputs
        ]

    def set_analytics_run_status(
        self,
        run_id: UUID,
        status: AnalyticsRunStatus,
        *,
        failure_stage: str | None = None,
        error_message: str | None = None,
    ) -> bool:
        record = self.db.scalar(
            tenant_query(AnalyticsRunRecord, self.tenant_id).where(
                AnalyticsRunRecord.id == str(run_id)
            )
        )
        if not record:
            return False
        now = datetime.now(UTC)
        record.status = status.value
        record.failure_stage = failure_stage
        record.error_message = error_message
        record.updated_at = now
        if status == AnalyticsRunStatus.EMBEDDING and record.started_at is None:
            record.started_at = now
        if status in {
            AnalyticsRunStatus.COMPLETED,
            AnalyticsRunStatus.SUMMARY_FAILED,
            AnalyticsRunStatus.FAILED,
        }:
            record.completed_at = now
        else:
            record.completed_at = None
        self.db.commit()
        return True

    def save_analytics_result(
        self,
        run_id: UUID,
        result: AnalyticsResult,
        executive_summary: list[str] | None,
        status: AnalyticsRunStatus,
    ) -> AnalyticsRun:
        record = self.db.scalar(
            tenant_query(AnalyticsRunRecord, self.tenant_id).where(
                AnalyticsRunRecord.id == str(run_id)
            )
        )
        if not record:
            raise LookupError("Analytics run not found")
        now = datetime.now(UTC)
        record.result_json = result.model_dump(mode="json")
        record.executive_summary = executive_summary
        record.status = status.value
        record.failure_stage = "summary" if status == AnalyticsRunStatus.SUMMARY_FAILED else None
        record.error_message = None
        record.completed_at = now
        record.updated_at = now
        self.db.commit()
        saved = self.get_analytics_run(run_id)
        if not saved:
            raise RuntimeError("Analytics result was saved but could not be reloaded")
        return saved

    def get_step_embeddings(
        self, sop_id: UUID, model: str, content_hashes: Sequence[str]
    ) -> dict[str, list[float]]:
        if not content_hashes:
            return {}
        records = self.db.scalars(
            tenant_query(SOPStepEmbeddingRecord, self.tenant_id).where(
                SOPStepEmbeddingRecord.sop_id == str(sop_id),
                SOPStepEmbeddingRecord.model == model,
                SOPStepEmbeddingRecord.content_hash.in_(content_hashes),
            )
        ).all()
        return {record.content_hash: list(record.embedding) for record in records}

    def save_step_embedding(
        self,
        *,
        sop_id: UUID,
        sop_step_id: UUID,
        model: str,
        content_hash: str,
        embedding: list[float],
    ) -> None:
        self.db.add(
            SOPStepEmbeddingRecord(
                id=str(uuid4()),
                tenant_id=str(self.tenant_id),
                sop_id=str(sop_id),
                sop_step_id=str(sop_step_id),
                model=model,
                dimensions=len(embedding),
                content_hash=content_hash,
                embedding=embedding,
            )
        )
        try:
            self.db.commit()
        except IntegrityError:
            self.db.rollback()

    @staticmethod
    def _analytics_run_from_records(
        record: AnalyticsRunRecord,
        workflow_name: str,
        inputs: Sequence[AnalyticsRunInputRecord],
    ) -> AnalyticsRun:
        return AnalyticsRun.model_validate(
            {
                "schema_version": "1.0",
                "tenant_id": record.tenant_id,
                "id": record.id,
                "workflow_id": record.workflow_id,
                "workflow_name": workflow_name,
                "version": record.version,
                "mode": record.mode,
                "status": record.status,
                "input_count": record.input_count,
                "embedding_model": record.embedding_model,
                "algorithm_version": record.algorithm_version,
                "inputs": [
                    AnalyticsRunInput(
                        position=item.position,
                        recording_id=item.recording_id,
                        session_id=item.session_id,
                        sop_id=item.sop_id,
                        sop_version=item.sop_version,
                        sop_content_hash=item.sop_content_hash,
                        recording_reference=item.recording_reference,
                        recorded_by=item.recorded_by,
                        recorded_by_email=item.recorded_by_email,
                        duration_ms=item.duration_ms,
                    )
                    for item in inputs
                ],
                "result": record.result_json,
                "executive_summary": record.executive_summary,
                "failure_stage": record.failure_stage,
                "error_message": record.error_message,
                "created_by": record.created_by,
                "supersedes_run_id": record.supersedes_run_id,
                "created_at": record.created_at,
                "started_at": record.started_at,
                "completed_at": record.completed_at,
                "updated_at": record.updated_at,
            }
        )

    def create_workflow_and_recording(
        self,
        workflow_name: str,
        source_type: CaptureSource,
        has_audio: bool,
        recording_id: UUID | None = None,
        manual_mode: bool = False,
        reference: str | None = None,
        recorded_by: UUID | None = None,
        description: str | None = None,
    ) -> tuple[Workflow, Recording]:
        """Create a new workflow and the recording in a single transaction.

        If a workflow with the same name already exists (e.g. a resumable retry
        of the upload), it is reused rather than duplicated. Both writes share
        one commit, so a recording failure rolls the new workflow back too —
        the caller can never be left with an empty workflow.
        """
        record = self.db.scalar(
            tenant_query(WorkflowRecord, self.tenant_id).where(
                WorkflowRecord.name == workflow_name
            )
        )
        if record is None:
            now = datetime.now(UTC)
            record = WorkflowRecord(
                id=str(uuid4()),
                tenant_id=str(self.tenant_id),
                name=workflow_name,
                description=description,
                created_by=str(recorded_by) if recorded_by else None,
                created_at=now,
                updated_at=now,
            )
            self.db.add(record)
            try:
                self.db.flush()
            except IntegrityError as exc:
                self.db.rollback()
                record = self.db.scalar(
                    tenant_query(WorkflowRecord, self.tenant_id).where(
                        WorkflowRecord.name == workflow_name
                    )
                )
                if record is None:
                    raise ValueError("Workflow could not be created") from exc
        workflow = self._workflow_from_record(record)
        recording = self.create_recording(
            workflow_id=UUID(record.id),
            workflow_name=record.name,
            source_type=source_type,
            has_audio=has_audio,
            recording_id=recording_id,
            manual_mode=manual_mode,
            reference=reference,
            recorded_by=recorded_by,
        )
        return workflow, recording

    def _workflow_summary_query(self, *extra_filters):
        processing = case(
            (RecordingRecord.status.in_(PROCESSING_RECORDING_STATUSES), 1), else_=0
        )
        ready = case(
            (RecordingRecord.status.in_(READY_RECORDING_STATUSES), 1), else_=0
        )
        stmt = (
            select(
                WorkflowRecord,
                func.count(RecordingRecord.id).label("recording_count"),
                func.count(distinct(RecordingRecord.recorded_by)).label("user_count"),
                func.max(RecordingRecord.created_at).label("last_recording_at"),
                func.coalesce(func.sum(processing), 0).label("processing_count"),
                func.coalesce(func.sum(ready), 0).label("ready_count"),
            )
            .outerjoin(
                RecordingRecord, RecordingRecord.workflow_id == WorkflowRecord.id
            )
            .where(WorkflowRecord.tenant_id == str(self.tenant_id))
            .group_by(WorkflowRecord.id)
        )
        for clause in extra_filters:
            stmt = stmt.where(clause)
        return stmt

    def _user_email(self, user_id: str) -> str | None:
        user = self.db.get(UserRecord, user_id)
        return user.email if user else None

    @staticmethod
    def _workflow_from_record(record: WorkflowRecord) -> Workflow:
        return Workflow(
            tenant_id=record.tenant_id,
            id=record.id,
            name=record.name,
            description=record.description,
            created_by=record.created_by,
            created_by_email=None,
            recording_count=0,
            user_count=0,
            last_recording_at=None,
            processing_count=0,
            ready_count=0,
            created_at=record.created_at,
            updated_at=record.updated_at,
        )

    @staticmethod
    def _workflow_from_row(row) -> Workflow:
        record = row.WorkflowRecord
        return Workflow(
            tenant_id=record.tenant_id,
            id=record.id,
            name=record.name,
            description=record.description,
            created_by=record.created_by,
            created_by_email=None,
            recording_count=int(row.recording_count or 0),
            user_count=int(row.user_count or 0),
            last_recording_at=row.last_recording_at,
            processing_count=int(row.processing_count or 0),
            ready_count=int(row.ready_count or 0),
            created_at=record.created_at,
            updated_at=record.updated_at,
        )

    @staticmethod
    def _workflow_recording_from_row(row) -> WorkflowRecording:
        record: RecordingRecord = row.RecordingRecord
        return WorkflowRecording.model_validate(
            {
                "schema_version": "1.0",
                "tenant_id": record.tenant_id,
                "id": record.id,
                "workflow_id": record.workflow_id,
                "workflow_name": record.workflow_name,
                "reference": record.reference,
                "recorded_by": record.recorded_by,
                "recorded_by_email": row.recorded_by_email,
                "session_id": record.session_id,
                "status": record.status,
                "duration_ms": row.duration_ms,
                "created_at": record.created_at,
                "completed_at": record.completed_at,
            }
        )

    def get_recordings(self, recording_ids: list[UUID]) -> list[Recording]:
        if not recording_ids:
            return []
        records = self.db.scalars(
            tenant_query(RecordingRecord, self.tenant_id).where(
                RecordingRecord.id.in_([str(recording_id) for recording_id in recording_ids])
            )
        ).all()
        return [self._recording_from_record(record) for record in records]

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

    def get_screenshot(self, session_id: UUID, screenshot_id: UUID) -> Screenshot | None:
        record = self.db.scalar(
            tenant_query(ScreenshotRecord, self.tenant_id).where(
                ScreenshotRecord.session_id == str(session_id),
                ScreenshotRecord.id == str(screenshot_id),
            )
        )
        return self._screenshot_from_record(record) if record else None

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

    def set_screenshot_annotations(
        self, screenshot_id: UUID, annotations: list[dict[str, Any]] | None
    ) -> None:
        """Persist the authoritative (user-edited) annotation set for a frame.

        ``None`` resets the frame to event-derived annotations; an empty list
        means the user cleared all highlights."""
        record = self.db.scalar(
            tenant_query(ScreenshotRecord, self.tenant_id)
            .where(ScreenshotRecord.id == str(screenshot_id))
        )
        if record:
            record.annotations = annotations
            self.db.commit()

    def delete_screenshot(self, session_id: UUID, screenshot_id: UUID) -> Screenshot | None:
        record = self.db.scalar(
            tenant_query(ScreenshotRecord, self.tenant_id)
            .where(
                ScreenshotRecord.session_id == str(session_id),
                ScreenshotRecord.id == str(screenshot_id),
            )
        )
        if not record:
            return None
        screenshot = self._screenshot_from_record(record)
        self.db.execute(
            delete(ScreenshotRecord).where(
                ScreenshotRecord.tenant_id == str(self.tenant_id),
                ScreenshotRecord.session_id == str(session_id),
                ScreenshotRecord.id == str(screenshot_id),
            )
        )
        self.db.commit()
        return screenshot

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

    def set_recording_custom_instruction(
        self, recording_id: UUID, custom_instruction: str | None
    ) -> Recording | None:
        record = self.db.scalar(
            tenant_query(RecordingRecord, self.tenant_id).where(
                RecordingRecord.id == str(recording_id)
            )
        )
        if not record:
            return None
        record.custom_sop_instruction = custom_instruction.strip() if custom_instruction else None
        record.error_message = None
        self.db.commit()
        return self._recording_from_record(record)

    def save_manual_review(
        self,
        recording_id: UUID,
        transcript_text: str | None = None,
        custom_instruction: str | None = None,
    ) -> Recording:
        recording = self.db.scalar(
            tenant_query(RecordingRecord, self.tenant_id).where(
                RecordingRecord.id == str(recording_id)
            )
        )
        if not recording:
            raise LookupError("Recording not found")
        if not recording.session_id:
            raise ValueError("Recording has no processed session yet")

        recording.custom_sop_instruction = (
            custom_instruction.strip() if custom_instruction else None
        )

        if transcript_text is not None:
            session = self.db.scalar(
                tenant_query(WorkflowSessionRecord, self.tenant_id).where(
                    WorkflowSessionRecord.id == recording.session_id
                )
            )
            if not session:
                raise LookupError("Session not found")
            current = dict(session.transcript or {})
            text = transcript_text.strip()
            transcript = RecordingTranscript(
                status="completed" if text or current else "not_recorded",
                text=text,
                segments=[
                    TranscriptSegment(
                        start_ms=0,
                        end_ms=max(0, session.duration_ms),
                        text=text,
                    )
                ]
                if text
                else [],
                audio_chunk_count=int(current.get("audio_chunk_count") or 0),
                audio_reference=current.get("audio_reference"),
            )
            session.transcript = transcript.model_dump(mode="json")

        self.db.commit()
        return self._recording_from_record(recording)

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

    def dashboard_summary(self, now: datetime | None = None) -> DashboardSummary:
        now = now or datetime.now(UTC)
        month_start = datetime(now.year, now.month, 1, tzinfo=UTC)
        if now.month == 1:
            previous_month_start = datetime(now.year - 1, 12, 1, tzinfo=UTC)
        else:
            previous_month_start = datetime(now.year, now.month - 1, 1, tzinfo=UTC)

        workflows_recorded = self._count(
            select(func.count()).select_from(WorkflowSessionRecord).where(
                WorkflowSessionRecord.tenant_id == str(self.tenant_id)
            )
        )
        current_month_workflows = self._count(
            select(func.count()).select_from(WorkflowSessionRecord).where(
                WorkflowSessionRecord.tenant_id == str(self.tenant_id),
                WorkflowSessionRecord.created_at >= month_start,
            )
        )
        previous_month_workflows = self._count(
            select(func.count()).select_from(WorkflowSessionRecord).where(
                WorkflowSessionRecord.tenant_id == str(self.tenant_id),
                WorkflowSessionRecord.created_at >= previous_month_start,
                WorkflowSessionRecord.created_at < month_start,
            )
        )
        sops_generated = self._count(
            select(func.count()).select_from(SOPRecord).where(
                SOPRecord.tenant_id == str(self.tenant_id)
            )
        )
        approved_sops = self._count(
            select(func.count()).select_from(SOPRecord).where(
                SOPRecord.tenant_id == str(self.tenant_id),
                SOPRecord.status == SOPStatus.APPROVED.value,
            )
        )
        active_workflows = self._count(
            select(func.count(distinct(WorkflowSessionRecord.workflow_name))).where(
                WorkflowSessionRecord.tenant_id == str(self.tenant_id)
            )
        )
        average_completion = self._average_duration()
        current_month_average = self._average_duration(earliest=month_start)
        previous_month_average = self._average_duration(
            earliest=previous_month_start,
            before=month_start,
        )

        return DashboardSummary(
            tenant_id=self.tenant_id,
            workflows_recorded=workflows_recorded,
            workflows_recorded_this_month=current_month_workflows,
            workflows_recorded_change_percent=percentage_change(
                current_month_workflows,
                previous_month_workflows,
            ),
            sops_generated=sops_generated,
            approved_sops=approved_sops,
            active_workflows=active_workflows,
            average_completion_ms=(
                round(average_completion) if average_completion is not None else None
            ),
            average_completion_delta_ms=(
                round(previous_month_average - current_month_average)
                if previous_month_average is not None and current_month_average is not None
                else None
            ),
        )

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
            document=sop.document,
            steps=[step.model_dump(mode="json") for step in sop.steps],
            created_at=sop.created_at,
        )
        self.db.add(record)
        self.db.commit()
        return sop

    def next_sop_version(self, session_id: UUID) -> int:
        return len(self.list_sops_for_session(session_id)) + 1

    def replace_session_draft_sop(self, session_id: UUID, sop: SOP) -> SOP:
        """Replace any existing DRAFT SOPs for a session with a fresh draft.

        Used by the AI generation pipeline so retries/re-generation never stack
        broken or duplicate drafts. Approved and archived SOPs are preserved so a
        published walkthrough can never disappear. The new draft is versioned
        just above the highest retained (approved/archived) version, which keeps
        versioning meaningful instead of inventing versions per output format.
        """
        self._require_tenant(sop.tenant_id)
        last_error: IntegrityError | None = None
        for attempt in range(2):
            try:
                session_record = self.db.scalar(
                    tenant_query(WorkflowSessionRecord, self.tenant_id)
                    .where(WorkflowSessionRecord.id == str(session_id))
                    .with_for_update()
                )
                if not session_record:
                    raise LookupError("Session not found")

                retained = self.db.scalars(
                    tenant_query(SOPRecord, self.tenant_id)
                    .where(SOPRecord.source_session_id == str(session_id))
                    .where(SOPRecord.status != SOPStatus.DRAFT.value)
                ).all()
                next_version = max((record.version for record in retained), default=0) + 1
                self.db.execute(
                    delete(SOPRecord).where(
                        SOPRecord.tenant_id == str(self.tenant_id),
                        SOPRecord.source_session_id == str(session_id),
                        SOPRecord.status == SOPStatus.DRAFT.value,
                    )
                )
                saved = sop.model_copy(
                    update={"id": uuid4() if attempt else sop.id, "version": next_version}
                )
                record = SOPRecord(
                    id=str(saved.id),
                    tenant_id=str(saved.tenant_id),
                    source_session_id=str(saved.source_session_id),
                    version=saved.version,
                    status=saved.status,
                    title=saved.title,
                    document=saved.document,
                    steps=[step.model_dump(mode="json") for step in saved.steps],
                    created_at=saved.created_at,
                )
                self.db.add(record)
                self.db.commit()
                return saved
            except IntegrityError as exc:
                self.db.rollback()
                last_error = exc
        raise ValueError("Draft SOP changed concurrently; retry SOP generation") from last_error

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

    def list_sops(
        self,
        status: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[SOP]:
        """List all SOPs for the tenant, newest first.

        Optional ``status`` filter narrows the result to a single SOPStatus
        (e.g. ``"approved"``). Used by the SOP library view that spans every
        session in the tenant.
        """
        query = tenant_query(SOPRecord, self.tenant_id)
        if status:
            query = query.where(SOPRecord.status == status)
        query = query.order_by(SOPRecord.created_at.desc()).offset(offset)
        if limit is not None:
            query = query.limit(limit)
        records = self.db.scalars(query).all()
        return [self._sop_from_record(record) for record in records]

    def search(self, query: str, limit: int = 20) -> SearchResponse:
        """Tenant-scoped substring search across SOPs and workflow sessions.

        Title and document hits on SOPs and ``workflow_name`` hits on sessions
        use SQL ``ILIKE`` (case-insensitive). SOP step text lives in a JSON
        column, so steps are scanned in Python over a bounded slice of the
        tenant's SOPs — enough to surface deep "which SOP mentions X" hits
        without a full-table scan on every keystroke. Results are de-duplicated
        by entity id (a SOP that matches on both title and a step is returned
        once, preferring the stronger title hit).
        """
        normalized = query.strip()
        if not normalized:
            return SearchResponse(query=query, results=[])

        pattern = f"%{normalized}%"
        needle = normalized.lower()
        results: list[SearchResult] = []
        seen_sop_ids: set[str] = set()

        # SOPs matching on title or supporting document.
        sop_title_records = self.db.scalars(
            tenant_query(SOPRecord, self.tenant_id)
            .where(or_(SOPRecord.title.ilike(pattern), SOPRecord.document.ilike(pattern)))
            .order_by(SOPRecord.created_at.desc())
            .limit(limit)
        ).all()
        for record in sop_title_records:
            matched_on_title = needle in (record.title or "").lower()
            results.append(
                SearchResult(
                    kind=SearchResultKind.SOP,
                    id=UUID(record.id),
                    title=record.title,
                    subtitle=self._sop_subtitle(record),
                    matched_field="title" if matched_on_title else "document",
                    status=record.status,
                    source_session_id=UUID(record.source_session_id),
                    created_at=record.created_at,
                )
            )
            seen_sop_ids.add(record.id)

        # SOPs whose step text matches (JSON column -> Python scan).
        step_query = tenant_query(SOPRecord, self.tenant_id).order_by(
            SOPRecord.created_at.desc()
        )
        if seen_sop_ids:
            step_query = step_query.where(SOPRecord.id.notin_(seen_sop_ids))
        step_candidate_records = self.db.scalars(step_query.limit(max(limit, 50))).all()
        for record in step_candidate_records:
            if len(results) >= limit:
                break
            for step in record.steps or []:
                haystacks = [
                    (step.get("title") or ""),
                    (step.get("instruction") or ""),
                    (step.get("warning") or ""),
                ]
                if any(needle in (text.lower()) for text in haystacks):
                    results.append(
                        SearchResult(
                            kind=SearchResultKind.SOP,
                            id=UUID(record.id),
                            title=record.title,
                            subtitle=f"step \u00b7 {step.get('title') or 'untitled'}",
                            matched_field="step",
                            status=record.status,
                            source_session_id=UUID(record.source_session_id),
                            created_at=record.created_at,
                        )
                    )
                    seen_sop_ids.add(record.id)
                    break

        # Sessions matching on workflow name.
        session_records = self.db.scalars(
            tenant_query(WorkflowSessionRecord, self.tenant_id)
            .where(WorkflowSessionRecord.workflow_name.ilike(pattern))
            .order_by(WorkflowSessionRecord.created_at.desc())
            .limit(limit)
        ).all()
        for record in session_records:
            if len(results) >= limit:
                break
            results.append(
                SearchResult(
                    kind=SearchResultKind.SESSION,
                    id=UUID(record.id),
                    title=record.workflow_name,
                    subtitle=self._session_subtitle(record),
                    matched_field="workflow_name",
                    status=record.status,
                    source_session_id=None,
                    created_at=record.created_at,
                )
            )

        return SearchResponse(query=query, results=results[:limit])

    @staticmethod
    def _sop_subtitle(record: SOPRecord) -> str:
        step_count = len(record.steps or [])
        return f"{record.status} \u00b7 {step_count} step{'s' if step_count != 1 else ''}"

    @staticmethod
    def _session_subtitle(record: WorkflowSessionRecord) -> str:
        duration_ms = record.duration_ms or 0
        if duration_ms >= 1000:
            seconds = duration_ms / 1000
            if seconds >= 60:
                minutes = int(seconds // 60)
                return f"{record.status} \u00b7 {minutes}m"
            return f"{record.status} \u00b7 {int(seconds)}s"
        return record.status or "session"

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

    def get_llm_provider_settings(
        self,
        default_base_url: str,
        default_model: str,
        default_api_key: str | None,
    ) -> LLMProviderSettings:
        record = self.db.get(LLMProviderSettingsRecord, str(self.tenant_id))
        if not record:
            return LLMProviderSettings(
                base_url=default_base_url,
                model=default_model,
                has_api_key=bool(default_api_key),
                updated_at=None,
            )
        return LLMProviderSettings(
            base_url=record.base_url,
            model=record.model,
            has_api_key=bool(record.api_key or default_api_key),
            updated_at=record.updated_at,
        )

    def get_llm_provider_secret(self) -> LLMProviderSettingsRecord | None:
        return self.db.get(LLMProviderSettingsRecord, str(self.tenant_id))

    def save_llm_provider_settings(
        self,
        payload: LLMProviderSettingsUpdate,
        default_api_key: str | None,
    ) -> LLMProviderSettings:
        record = self.db.get(LLMProviderSettingsRecord, str(self.tenant_id))
        now = datetime.now(UTC)
        api_key = payload.api_key.strip() if payload.api_key else None
        if not record:
            record = LLMProviderSettingsRecord(
                tenant_id=str(self.tenant_id),
                base_url=payload.base_url.strip(),
                model=payload.model.strip(),
                api_key=api_key,
                updated_at=now,
            )
            self.db.add(record)
        else:
            record.base_url = payload.base_url.strip()
            record.model = payload.model.strip()
            if payload.clear_api_key:
                record.api_key = None
            elif api_key:
                record.api_key = api_key
            record.updated_at = now
        self.db.commit()
        return LLMProviderSettings(
            base_url=record.base_url,
            model=record.model,
            has_api_key=bool(record.api_key or default_api_key),
            updated_at=record.updated_at,
        )

    def get_sop_limits(self, defaults: dict[str, int]) -> SopLimitsSettings:
        """Effective SOP guardrails: per-tenant override when set, else env default."""
        record = self.db.get(SopLimitsSettingsRecord, str(self.tenant_id))
        effective: dict[str, int] = {}
        overridden: dict[str, bool] = {}
        for field in SOP_LIMIT_FIELDS:
            override = getattr(record, field, None) if record else None
            overridden[field] = override is not None
            effective[field] = override if override is not None else defaults[field]
        return SopLimitsSettings(
            **effective,
            defaults=dict(defaults),
            overridden=overridden,
            updated_at=record.updated_at if record else None,
        )

    def get_sop_limits_overrides(self) -> SopLimitsSettingsRecord | None:
        """Raw override row for the generation task (NULL fields = use env default)."""
        return self.db.get(SopLimitsSettingsRecord, str(self.tenant_id))

    def save_sop_limits(
        self, payload: SopLimitsSettingsUpdate, defaults: dict[str, int]
    ) -> SopLimitsSettings:
        """Apply a partial update. Only fields present in the request are touched:
        an explicit ``null`` clears an override (revert to default); an int sets
        or replaces it. Omitted fields are left unchanged."""
        provided = payload.model_dump(exclude_unset=True)
        record = self.db.get(SopLimitsSettingsRecord, str(self.tenant_id))
        if not record:
            record = SopLimitsSettingsRecord(tenant_id=str(self.tenant_id))
            self.db.add(record)
        for field, value in provided.items():
            setattr(record, field, value)
        record.updated_at = datetime.now(UTC)
        self.db.commit()
        return self.get_sop_limits(defaults)

    def _require_tenant(self, tenant_id: UUID) -> None:
        if tenant_id != self.tenant_id:
            raise ValueError("Cross-tenant write rejected")

    def _count(self, query: Select) -> int:
        return int(self.db.scalar(query) or 0)

    def _average_duration(
        self,
        earliest: datetime | None = None,
        before: datetime | None = None,
    ) -> float | None:
        query = select(func.avg(WorkflowSessionRecord.duration_ms)).where(
            WorkflowSessionRecord.tenant_id == str(self.tenant_id)
        )
        if earliest:
            query = query.where(WorkflowSessionRecord.created_at >= earliest)
        if before:
            query = query.where(WorkflowSessionRecord.created_at < before)
        result = self.db.scalar(query)
        return float(result) if result is not None else None

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
                "document": getattr(record, "document", None),
                "steps": Repository._normalize_sop_steps(record.steps),
                "created_at": record.created_at,
            }
        )

    @staticmethod
    def _normalize_sop_steps(steps: list[dict[str, Any]]) -> list[dict[str, Any]]:
        normalized: list[dict[str, Any]] = []
        for step in steps:
            current = dict(step)
            legacy_branch = current.pop("decision_branch", None)
            if legacy_branch and not current.get("decision_branches"):
                current["decision_branches"] = [
                    {
                        "condition": "Legacy decision branch",
                        "action": legacy_branch,
                    }
                ]
            normalized.append(current)
        return normalized

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
                "workflow_id": getattr(record, "workflow_id", None),
                "workflow_name": record.workflow_name,
                "reference": getattr(record, "reference", None),
                "recorded_by": getattr(record, "recorded_by", None),
                "source_type": record.source_type,
                "session_id": record.session_id,
                "status": record.status,
                "expected_chunk_count": record.expected_chunk_count,
                "uploaded_chunk_count": record.uploaded_chunk_count,
                "uploaded_bytes": record.uploaded_bytes,
                "has_audio": record.has_audio,
                "manual_mode": getattr(record, "manual_mode", False),
                "custom_sop_instruction": getattr(record, "custom_sop_instruction", None),
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
                "annotations": getattr(record, "annotations", None),
                "redaction_status": record.redaction_status,
                "created_at": record.created_at,
            }
        )


def percentage_change(current: int, previous: int) -> float | None:
    if previous == 0:
        return None if current == 0 else 100.0
    return round(((current - previous) / previous) * 100, 1)
