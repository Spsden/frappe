import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type {
  BackendRecordingStatus,
  RecordingState,
  RecordedSessionSummary
} from '../../shared/recording'
import { useRecording } from '../features/recording/useRecording'

const PAGE_SIZE = 5

const stageLabels: Record<BackendRecordingStatus, string> = {
  recording: 'Recording',
  uploading: 'Uploading',
  validating: 'Validating',
  transcribing_audio: 'Transcribing',
  processing_screenshots: 'Annotating',
  aligning_evidence: 'Aligning',
  generating_sop: 'Creating SOP',
  ready_for_review: 'Ready',
  completed: 'Completed',
  failed: 'Failed'
}

const stageDescriptions: Record<BackendRecordingStatus, string> = {
  recording: 'Desktop app is still capturing local evidence.',
  uploading: 'Raw events, screenshots and audio are moving to the backend.',
  validating: 'Backend is checking chunk order, hashes and metadata.',
  transcribing_audio: 'Audio narration is queued for transcript generation.',
  processing_screenshots: 'Screenshots are being indexed and prepared for highlights.',
  aligning_evidence: 'Clicks, keys, screenshots and transcript are being lined up.',
  generating_sop: 'SOP draft is being created from the aligned evidence.',
  ready_for_review: 'Draft SOP and evidence are ready for human review.',
  completed: 'Processing has completed.',
  failed: 'Backend processing failed.'
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(value))
}

function formatDuration(durationMs: number | null) {
  if (durationMs === null) {
    return 'Active'
  }

  const totalSeconds = Math.max(0, Math.round(durationMs / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60

  return `${minutes}m ${seconds.toString().padStart(2, '0')}s`
}

function activeRecordingSummary(state: RecordingState): RecordedSessionSummary | null {
  if (
    !state.sessionId ||
    !state.outputPath ||
    !state.startedAt ||
    state.status === 'idle' ||
    state.status === 'completed'
  ) {
    return null
  }

  return {
    id: state.sessionId,
    name: state.sessionName || 'Untitled workflow',
    platform:
      navigator.platform.toLowerCase().includes('win')
        ? 'win32'
        : navigator.platform.toLowerCase().includes('mac')
          ? 'darwin'
          : 'linux',
    startedAt: state.startedAt,
    endedAt: null,
    durationMs: Math.max(0, Date.now() - new Date(state.startedAt).getTime()),
    localStatus: state.status,
    eventCount: state.eventCount,
    screenshotCount: state.screenshotCount,
    audioChunkCount: state.audioChunkCount,
    outputPath: state.outputPath,
    remoteRecordingId: state.remoteRecordingId,
    remoteSessionId: state.remoteSessionId,
    remoteStatus: null,
    uploadedAt: null,
    uploadError: state.error,
    backend: null,
    backendError: null
  }
}

function statusForSession(session: RecordedSessionSummary): BackendRecordingStatus | 'local' {
  if (session.backend?.recording.status) {
    return session.backend.recording.status
  }

  if (session.remoteStatus) {
    return session.remoteStatus as BackendRecordingStatus
  }

  return 'local'
}

function statusLabel(session: RecordedSessionSummary) {
  const status = statusForSession(session)

  if (status === 'local') {
    if (session.uploadError || session.localStatus === 'error') {
      return 'Upload failed'
    }

    if (session.localStatus === 'awaiting-save') {
      return 'Waiting to save'
    }

    if (session.localStatus === 'paused') {
      return 'Paused'
    }

    if (session.localStatus === 'uploading') {
      return 'Uploading'
    }

    if (session.localStatus === 'processing') {
      return 'Processing'
    }

    return 'Local only'
  }

  return stageLabels[status] ?? status
}

function statusDot(session: RecordedSessionSummary) {
  const status = statusForSession(session)

  if (status === 'failed' || session.uploadError || session.localStatus === 'error') {
    return 'bg-red-500 shadow-[0_0_12px_rgba(239,68,68,0.55)]'
  }

  if (status === 'ready_for_review' || status === 'completed') {
    return 'bg-purple-400 shadow-[0_0_12px_rgba(168,85,247,0.5)]'
  }

  if (status === 'local') {
    if (
      session.localStatus === 'recording' ||
      session.localStatus === 'paused' ||
      session.localStatus === 'stopping' ||
      session.localStatus === 'awaiting-save' ||
      session.localStatus === 'uploading' ||
      session.localStatus === 'processing'
    ) {
      return 'animate-pulse bg-amber-400 shadow-[0_0_12px_rgba(251,191,36,0.45)]'
    }

    return 'bg-zinc-300'
  }

  return 'animate-pulse bg-amber-400 shadow-[0_0_12px_rgba(251,191,36,0.45)]'
}

function statusDescriptionForSession(session: RecordedSessionSummary) {
  const status = statusForSession(session)

  if (session.uploadError) {
    return session.uploadError
  }

  if (session.backend?.recording.error_message) {
    return session.backend.recording.error_message
  }

  if (session.backendError) {
    return session.backendError
  }

  if (status !== 'local') {
    return stageDescriptions[status] ?? 'Backend is processing this recording.'
  }

  if (session.localStatus === 'awaiting-save') {
    return 'Recording is captured locally. Save it to start backend processing.'
  }

  if (session.localStatus === 'uploading') {
    return 'Electron is uploading raw events, screenshots and audio chunks.'
  }

  if (session.localStatus === 'processing') {
    return 'Backend processing has been requested and status will sync shortly.'
  }

  if (session.localStatus === 'recording' || session.localStatus === 'paused') {
    return 'Desktop app is still capturing local evidence.'
  }

  return 'This recording is saved locally and has not been uploaded yet.'
}

function isFinished(session: RecordedSessionSummary) {
  const status = statusForSession(session)
  return status === 'ready_for_review' || status === 'completed'
}

function isFailed(session: RecordedSessionSummary) {
  return (
    statusForSession(session) === 'failed' ||
    session.localStatus === 'error' ||
    Boolean(session.uploadError)
  )
}

function canDeleteSession(session: RecordedSessionSummary) {
  return ![
    'recording',
    'paused',
    'stopping',
    'awaiting-save',
    'uploading',
    'processing'
  ].includes(session.localStatus)
}

function statusClassName(session: RecordedSessionSummary) {
  const label = statusLabel(session).toLowerCase()

  if (label.includes('fail') || label.includes('error')) {
    return 'status status-failed'
  }

  if (
    label.includes('ready') ||
    label.includes('complete') ||
    label.includes('approved') ||
    label.includes('published')
  ) {
    return 'status status-ready'
  }

  if (
    label.includes('process') ||
    label.includes('upload') ||
    label.includes('record') ||
    label.includes('waiting') ||
    label.includes('paused')
  ) {
    return 'status status-processing'
  }

  return 'status status-local'
}

function EmptyState({ onRefresh }: { onRefresh: () => void }) {
  const navigate = useNavigate()

  return (
    <section className="dashboard-page">
      <div className="dashboard-container">
        <div className="page-header">
          <h1>Recordings</h1>
          <p>Track recorded workflows.</p>
        </div>

        <div className="list-controls">
          <input
            className="search-input"
            type="text"
            placeholder="Search recordings..."
            disabled
          />
        </div>

        <div className="table-card recordings-card">
          <div className="table-card-topline" />

          <div className="empty-table-message">
            <button
              type="button"
              onClick={() => navigate('/dashboard')}
              className="record-workflow-link"
            >
              <span>Record a workflow</span>
              <span className="record-workflow-plus">+</span>
            </button>

            <p>
              No recordings yet. Finished recordings will appear here with backend processing
              stages, evidence counts, audio transcript status and SOP readiness.
            </p>

            <div style={{ marginTop: '1.75rem' }}>
              <button type="button" onClick={onRefresh} className="gradient-button">
                Refresh
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

function ProcessingStatusCard({ session }: { session: RecordedSessionSummary }) {
  const failed = isFailed(session)
  const finished = isFinished(session)

  return (
    <div className="processing-card">
      <div className="selected-card-header">
        <div>
          <p className="section-label">Processing status</p>
          <h3 className="selected-title">{statusLabel(session)}</h3>
        </div>

        <span className={`size-3 rounded-full ${statusDot(session)}`} />
      </div>

      <div className="processing-visual">
        <div className="processing-circle-wrap">
          <span
            className={[
              'processing-ring',
              failed ? 'failed' : finished ? 'finished' : 'processing'
            ].join(' ')}
          />

          <span
            className={[
              'processing-icon',
              failed ? 'failed' : finished ? 'finished' : ''
            ].join(' ')}
          >
            {failed ? '!' : finished ? '✓' : '●'}
          </span>
        </div>
      </div>

      <p className="processing-description">{statusDescriptionForSession(session)}</p>

      {!failed && !finished && (
        <div className="processing-dots">
          {[0, 1, 2].map((dot) => (
            <span key={dot} style={{ animationDelay: `${dot * 180}ms` }} />
          ))}
        </div>
      )}

      <div className="status-detail-grid">
        <div className="status-detail-box">
          <p className="evidence-label">Backend status</p>
          <p className="status-detail-text">
            {session.backend?.recording.status ?? session.remoteStatus ?? 'not uploaded'}
          </p>
        </div>

        <div className="status-detail-box">
          <p className="evidence-label">Local status</p>
          <p className="status-detail-text">{session.localStatus}</p>
        </div>
      </div>
    </div>
  )
}

function EvidenceMetric({
  label,
  value
}: {
  label: string
  value: string | number
}) {
  return (
    <div className="evidence-metric">
      <p className="evidence-label">{label}</p>
      <p className="evidence-value">{value}</p>
    </div>
  )
}

export function SessionsPage() {
  const { state: recordingState } = useRecording()
  const [sessions, setSessions] = useState<RecordedSessionSummary[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [currentPage, setCurrentPage] = useState(1)

  const selected = useMemo(
    () => {
      const active = activeRecordingSummary(recordingState)
      const merged =
        active && !sessions.some((session) => session.id === active.id)
          ? [active, ...sessions]
          : sessions.map((session) => (active?.id === session.id ? active : session))

      return merged.find((session) => session.id === selectedId) ?? merged[0] ?? null
    },
    [recordingState, selectedId, sessions]
  )

  const displaySessions = useMemo(() => {
    const active = activeRecordingSummary(recordingState)

    if (!active) {
      return sessions
    }

    if (!sessions.some((session) => session.id === active.id)) {
      return [active, ...sessions]
    }

    return sessions.map((session) => (session.id === active.id ? active : session))
  }, [recordingState, sessions])

  const filteredSessions = useMemo(() => {
    const keyword = searchTerm.trim().toLowerCase()

    return displaySessions
      .filter((session) => {
        const searchableText = [
          session.name,
          session.outputPath,
          session.localStatus,
          session.remoteStatus,
          session.backend?.recording.status,
          statusLabel(session)
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()

        return searchableText.includes(keyword)
      })
      .sort((a, b) => {
        const dateA = new Date(a.startedAt).getTime()
        const dateB = new Date(b.startedAt).getTime()

        return dateB - dateA
      })
  }, [displaySessions, searchTerm])

  const totalPages = Math.max(1, Math.ceil(filteredSessions.length / PAGE_SIZE))

  const paginatedSessions = useMemo(() => {
    const safePage = Math.min(currentPage, totalPages)
    const startIndex = (safePage - 1) * PAGE_SIZE

    return filteredSessions.slice(startIndex, startIndex + PAGE_SIZE)
  }, [filteredSessions, currentPage, totalPages])

  const refresh = async (showLoading = false) => {
    if (showLoading) {
      setIsLoading(true)
    }

    setError(null)

    try {
      const nextSessions = await window.api.recording.listSessions()
      setSessions(nextSessions)
      setSelectedId((current) =>
        current && nextSessions.some((session) => session.id === current)
          ? current
          : activeRecordingSummary(recordingState)?.id ?? nextSessions[0]?.id ?? null
      )
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load recorded sessions.')
    } finally {
      setIsLoading(false)
    }
  }

  const deleteSession = async (session: RecordedSessionSummary) => {
    const confirmed = window.confirm(
      `Delete "${session.name}"? This removes the local recording and attempts to remove the backend recording too.`
    )

    if (!confirmed) {
      return
    }

    setDeletingId(session.id)
    setError(null)

    try {
      await window.api.recording.deleteSession(session.id)
      setSessions((current) => current.filter((item) => item.id !== session.id))
      setSelectedId((current) => (current === session.id ? null : current))
      void refresh()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not delete recorded session.')
    } finally {
      setDeletingId(null)
    }
  }

  useEffect(() => {
    void refresh(true)

    const timer = window.setInterval(() => void refresh(false), 3000)

    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    setCurrentPage(1)
  }, [searchTerm])

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages)
    }
  }, [currentPage, totalPages])

  if (!isLoading && displaySessions.length === 0) {
    return <EmptyState onRefresh={() => void refresh()} />
  }

  return (
    <section className="dashboard-page">
      <div className="dashboard-container">
        <div className="page-header">
          <h1>Recordings</h1>
          <p>Track recorded workflows.</p>
        </div>

        {error && (
          <p className="mt-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
            {error}
          </p>
        )}

        <div className="list-controls recordings-list-controls">
          <input
            className="search-input"
            type="text"
            placeholder="Search recordings..."
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
          />

          <button
            type="button"
            onClick={() => void refresh(true)}
            disabled={isLoading}
            className="gradient-button"
          >
            {isLoading ? 'Refreshing...' : 'Refresh'}
          </button>

          {filteredSessions.length > PAGE_SIZE && (
            <div className="pagination-inline">
              <button
                type="button"
                className="pagination-button"
                disabled={currentPage === 1}
                onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
              >
                Previous
              </button>

              <span className="pagination-text">
                Page {currentPage} of {totalPages}
              </span>

              <button
                type="button"
                className="pagination-button"
                disabled={currentPage === totalPages}
                onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
              >
                Next
              </button>
            </div>
          )}
        </div>

        <div className="table-card recordings-card">
          <div className="table-card-topline" />

          <div className="table-scroll">
            <div className="recordings-table table-row table-head">
              <span>Workflow</span>
              <span>Duration</span>
              <span>Events</span>
              <span>Screenshots</span>
              <span>Processing Status</span>
              <span>Action</span>
            </div>

            {filteredSessions.length === 0 ? (
              <div className="empty-table-message">
                <strong>No recordings found</strong>
                <p>Try searching by workflow name, location, or status.</p>
              </div>
            ) : (
              paginatedSessions.map((session) => {
                const isSelected = selected?.id === session.id
                const canDelete = canDeleteSession(session)

                return (
                  <div
                    key={session.id}
                    className={[
                      'recordings-table table-row',
                      isSelected ? 'selected' : ''
                    ].join(' ')}
                  >
                    <button
                      type="button"
                      onClick={() => setSelectedId(session.id)}
                      className="workflow-button"
                    >
                      <div className="workflow-title-line">
                        <span
                          className={`size-2.5 shrink-0 rounded-full ${statusDot(session)}`}
                        />
                        <strong className="workflow-title">{session.name}</strong>
                      </div>

                      <p className="muted-text">
                        {formatDate(session.startedAt)} · {session.outputPath}
                      </p>
                    </button>

                    <span>{formatDuration(session.durationMs)}</span>
                    <span>{session.eventCount}</span>
                    <span>{session.screenshotCount}</span>

                    <span className={statusClassName(session)}>
                      {statusLabel(session)}
                    </span>

                    <div className="action-group">
                      <button
                        type="button"
                        onClick={() => setSelectedId(session.id)}
                        className="action-button"
                      >
                        View
                      </button>

                      <button
                        type="button"
                        disabled={!canDelete || deletingId === session.id}
                        onClick={() => void deleteSession(session)}
                        className="delete-button"
                      >
                        {deletingId === session.id ? 'Deleting' : 'Delete'}
                      </button>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>

        
        {selected && (
          <div className="selected-recording-grid">
            <div className="selected-card">
              <div className="selected-card-header">
                <div>
                  <p className="section-label">Selected recording</p>
                  <h3 className="selected-title">{selected.name}</h3>
                  <p className="selected-path">{selected.outputPath}</p>
                </div>

                <span className="selected-status-pill">{statusLabel(selected)}</span>
              </div>

              <div className="metric-grid">
                <EvidenceMetric label="Duration" value={formatDuration(selected.durationMs)} />
                <EvidenceMetric label="Events" value={selected.eventCount} />
                <EvidenceMetric label="Screenshots" value={selected.screenshotCount} />
                <EvidenceMetric label="Audio" value={selected.audioChunkCount} />
              </div>

              <div className="status-detail-grid">
                <div className="status-detail-box">
                  <p className="evidence-label">Backend recording</p>
                  <p className="status-detail-text">
                    {selected.remoteRecordingId ?? 'Not uploaded yet'}
                  </p>
                </div>

                <div className="status-detail-box">
                  <p className="evidence-label">SOP session</p>
                  <p className="status-detail-text">
                    {selected.remoteSessionId ?? 'Pending'}
                  </p>
                </div>
              </div>
            </div>

            <ProcessingStatusCard session={selected} />
          </div>
        )}
      </div>
    </section>
  )
}