import type {
  BackendRecordingStatus,
  RecordedSessionSummary,
  RecordingState
} from '../../../shared/recording'

export const stageLabels: Record<BackendRecordingStatus, string> = {
  recording: 'Recording',
  uploading: 'Uploading',
  validating: 'Validating',
  transcribing_audio: 'Transcribing',
  processing_screenshots: 'Annotating',
  aligning_evidence: 'Aligning',
  awaiting_manual_review: 'Review evidence',
  generating_sop: 'Creating SOP',
  sop_failed: 'SOP needs retry',
  ready_for_review: 'Ready',
  completed: 'Completed',
  failed: 'Failed'
}

const ACTIVE_LOCAL_STATES = new Set([
  'recording',
  'paused',
  'stopping',
  'awaiting-save',
  'uploading',
  'processing'
])

export function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(value))
}

export function formatDuration(durationMs: number | null) {
  if (durationMs === null) {
    return 'Active'
  }
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}m ${seconds.toString().padStart(2, '0')}s`
}

export function statusForSession(
  session: RecordedSessionSummary
): BackendRecordingStatus | 'local' {
  if (session.backend?.recording.status) {
    return session.backend.recording.status
  }
  if (session.remoteStatus) {
    return session.remoteStatus as BackendRecordingStatus
  }
  return 'local'
}

export function statusLabel(session: RecordedSessionSummary) {
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

export function statusDot(session: RecordedSessionSummary) {
  const status = statusForSession(session)
  if (
    status === 'failed' ||
    status === 'sop_failed' ||
    session.uploadError ||
    session.localStatus === 'error'
  ) {
    return 'bg-red-500 shadow-[0_0_12px_rgba(239,68,68,0.55)]'
  }
  if (status === 'awaiting_manual_review' || status === 'ready_for_review' || status === 'completed') {
    return 'bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.55)]'
  }
  if (status === 'local') {
    if (ACTIVE_LOCAL_STATES.has(session.localStatus)) {
      return 'animate-pulse bg-amber-400 shadow-[0_0_12px_rgba(251,191,36,0.45)]'
    }
    return 'bg-white/35'
  }
  return 'animate-pulse bg-amber-400 shadow-[0_0_12px_rgba(251,191,36,0.45)]'
}

export function isFinished(session: RecordedSessionSummary) {
  const status = statusForSession(session)
  return status === 'ready_for_review' || status === 'completed'
}

export function isFailed(session: RecordedSessionSummary) {
  return (
    statusForSession(session) === 'failed' ||
    statusForSession(session) === 'sop_failed' ||
    session.localStatus === 'error' ||
    Boolean(session.uploadError)
  )
}

export function isActiveSession(session: RecordedSessionSummary) {
  return ACTIVE_LOCAL_STATES.has(session.localStatus)
}

export function canDeleteSession(session: RecordedSessionSummary) {
  return !isActiveSession(session)
}

export function canRetrySession(session: RecordedSessionSummary) {
  // Retryable upload failures re-send raw evidence. SOP failures use server-side retry.
  return statusForSession(session) !== 'sop_failed' && isFailed(session) && !isActiveSession(session)
}

export function canRetrySop(session: RecordedSessionSummary) {
  return statusForSession(session) === 'sop_failed' && !isActiveSession(session)
}

export function activeRecordingSummary(state: RecordingState): RecordedSessionSummary | null {
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
