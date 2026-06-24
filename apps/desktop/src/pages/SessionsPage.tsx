import { useEffect, useMemo, useState } from 'react'
import type {
  BackendRecordingStatus,
  RecordedSessionSummary
} from '../../shared/recording'

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
    return session.uploadError ? 'Upload failed' : 'Local only'
  }
  return stageLabels[status] ?? status
}

function statusDot(session: RecordedSessionSummary) {
  const status = statusForSession(session)
  if (status === 'failed' || session.uploadError) {
    return 'bg-red-500 shadow-[0_0_12px_rgba(239,68,68,0.55)]'
  }
  if (status === 'ready_for_review' || status === 'completed') {
    return 'bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.55)]'
  }
  if (status === 'local') {
    return 'bg-white/35'
  }
  return 'animate-pulse bg-amber-400 shadow-[0_0_12px_rgba(251,191,36,0.45)]'
}

function orderedStages(session: RecordedSessionSummary): BackendRecordingStatus[] {
  if (session.backend?.stages.length) {
    return session.backend.stages
  }
  return session.audioChunkCount > 0
    ? [
        'recording',
        'uploading',
        'validating',
        'transcribing_audio',
        'processing_screenshots',
        'aligning_evidence',
        'generating_sop',
        'ready_for_review'
      ]
    : [
        'recording',
        'uploading',
        'validating',
        'processing_screenshots',
        'aligning_evidence',
        'generating_sop',
        'ready_for_review'
      ]
}

function stageState(stage: BackendRecordingStatus, session: RecordedSessionSummary) {
  const current = statusForSession(session)
  if (current === 'local') {
    return 'pending'
  }
  if (current === 'failed') {
    return stage === 'failed' ? 'failed' : 'done'
  }
  const stages = orderedStages(session)
  const currentIndex = stages.indexOf(current)
  const stageIndex = stages.indexOf(stage)
  if (stageIndex < currentIndex) {
    return 'done'
  }
  if (stageIndex === currentIndex) {
    return current === 'ready_for_review' || current === 'completed' ? 'done' : 'active'
  }
  return 'pending'
}

function EmptyState({ onRefresh }: { onRefresh: () => void }) {
  return (
    <section className="grid h-[calc(100vh-4rem)] place-items-center overflow-hidden px-6 py-16">
      <div className="max-w-lg rounded-2xl border border-white/10 bg-white/[0.03] p-10 text-center shadow-[0_18px_65px_rgba(0,0,0,0.45)]">
        <span className="mx-auto block size-2.5 rounded-full bg-red-500 shadow-[0_0_16px_rgba(239,68,68,0.6)]" />
        <p className="mt-5 font-mono text-xs font-semibold uppercase tracking-[0.25em] text-white/45">
          No traces yet
        </p>
        <h2 className="mt-4 text-4xl font-black tracking-[-0.04em]">Record a workflow</h2>
        <p className="mt-3 text-sm leading-6 text-white/50">
          Finished recordings will appear here with backend processing stages, evidence counts,
          audio transcript status and SOP readiness.
        </p>
        <button
          type="button"
          onClick={onRefresh}
          className="mt-8 rounded-full bg-white px-5 py-3 text-sm font-black text-black transition hover:bg-white/85"
        >
          Refresh Sessions
        </button>
      </div>
    </section>
  )
}

function StageTimeline({ session }: { session: RecordedSessionSummary }) {
  const stages = orderedStages(session)

  return (
    <div className="rounded-2xl border border-white/10 bg-[#090909] p-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="font-mono text-[10px] font-bold uppercase tracking-[0.24em] text-white/45">
            Backend pipeline
          </p>
          <h3 className="mt-2 text-xl font-black tracking-[-0.03em]">
            {statusLabel(session)}
          </h3>
        </div>
        <span className={`size-3 rounded-full ${statusDot(session)}`} />
      </div>

      <div className="mt-6 space-y-4">
        {stages.map((stage, index) => {
          const state = stageState(stage, session)
          return (
            <div key={stage} className="grid grid-cols-[24px_minmax(0,1fr)] gap-3">
              <div className="flex flex-col items-center">
                <span
                  className={[
                    'grid size-6 place-items-center rounded-full border text-[10px] font-black',
                    state === 'done'
                      ? 'border-emerald-400 bg-emerald-400 text-black'
                      : state === 'active'
                        ? 'border-amber-300 bg-amber-300 text-black shadow-[0_0_18px_rgba(251,191,36,0.35)]'
                        : state === 'failed'
                          ? 'border-red-500 bg-red-500 text-white'
                          : 'border-white/15 bg-white/[0.03] text-white/35'
                  ].join(' ')}
                >
                  {state === 'done' ? '✓' : index + 1}
                </span>
                {index < stages.length - 1 && <span className="mt-2 h-8 w-px bg-white/10" />}
              </div>
              <div className="pb-3">
                <p className="text-sm font-bold">{stageLabels[stage]}</p>
                <p className="mt-1 text-xs leading-5 text-white/45">{stageDescriptions[stage]}</p>
              </div>
            </div>
          )
        })}
      </div>

      {(session.backendError || session.uploadError || session.backend?.recording.error_message) && (
        <p className="mt-5 rounded-xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-xs leading-5 text-red-300">
          {session.uploadError || session.backend?.recording.error_message || session.backendError}
        </p>
      )}
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
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <p className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-white/35">
        {label}
      </p>
      <p className="mt-2 text-2xl font-black">{value}</p>
    </div>
  )
}

export function SessionsPage() {
  const [sessions, setSessions] = useState<RecordedSessionSummary[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const selected = useMemo(
    () => sessions.find((session) => session.id === selectedId) ?? sessions[0] ?? null,
    [selectedId, sessions]
  )

  const refresh = async () => {
    setIsLoading(true)
    setError(null)
    try {
      const nextSessions = await window.api.recording.listSessions()
      setSessions(nextSessions)
      setSelectedId((current) =>
        current && nextSessions.some((session) => session.id === current)
          ? current
          : nextSessions[0]?.id ?? null
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
    void refresh()
    const timer = window.setInterval(() => void refresh(), 8000)
    return () => window.clearInterval(timer)
  }, [])

  if (!isLoading && sessions.length === 0) {
    return <EmptyState onRefresh={() => void refresh()} />
  }

  return (
    <section className="flex h-[calc(100vh-4rem)] min-h-0 flex-col overflow-hidden px-5 py-8 md:px-8">
      <div className="shrink-0">
        <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-xs font-bold uppercase tracking-[0.24em] text-emerald-400">
            Session archive
          </p>
          <h2 className="mt-3 text-4xl font-black tracking-[-0.045em]">
            Recorded Workflows
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-white/50">
            Review captured evidence and track backend processing from upload through SOP creation.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={isLoading}
          className="rounded-full border border-white/15 bg-white/[0.04] px-5 py-3 text-sm font-black text-white transition hover:bg-white/10 disabled:cursor-wait disabled:opacity-50"
        >
          {isLoading ? 'Refreshing...' : 'Refresh'}
        </button>
        </div>

        {error && (
          <p className="mt-6 rounded-xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {error}
          </p>
        )}
      </div>

      <div className="mt-8 grid min-h-0 flex-1 gap-6 lg:grid-cols-[minmax(0,0.95fr)_minmax(420px,1.05fr)]">
        <div className="min-h-0 space-y-3 overflow-y-auto pr-2 [scrollbar-color:rgba(255,255,255,0.2)_transparent]">
          {sessions.map((session) => {
            const isSelected = selected?.id === session.id
            return (
              <article
                key={session.id}
                className={[
                  'w-full rounded-2xl border p-5 text-left transition',
                  isSelected
                    ? 'border-white/25 bg-white/[0.08] shadow-[0_16px_50px_rgba(0,0,0,0.32)]'
                    : 'border-white/10 bg-[#0b0b0b] hover:border-white/20 hover:bg-white/[0.05]'
                ].join(' ')}
              >
                <div className="flex items-start gap-4">
                  <button
                    type="button"
                    onClick={() => setSelectedId(session.id)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex items-center gap-3">
                          <span
                            className={`size-2.5 shrink-0 rounded-full ${statusDot(session)}`}
                          />
                          <p className="truncate text-lg font-black tracking-[-0.03em]">
                            {session.name}
                          </p>
                        </div>
                        <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.18em] text-white/35">
                          {formatDate(session.startedAt)} · {formatDuration(session.durationMs)}
                        </p>
                      </div>
                      <span className="shrink-0 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-white/60">
                        {statusLabel(session)}
                      </span>
                    </div>

                    <div className="mt-5 grid grid-cols-3 gap-2 text-center">
                      <div className="rounded-lg bg-white/[0.04] py-3">
                        <p className="text-lg font-black">{session.eventCount}</p>
                        <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.14em] text-white/35">
                          events
                        </p>
                      </div>
                      <div className="rounded-lg bg-white/[0.04] py-3">
                        <p className="text-lg font-black">{session.screenshotCount}</p>
                        <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.14em] text-white/35">
                          shots
                        </p>
                      </div>
                      <div className="rounded-lg bg-white/[0.04] py-3">
                        <p className="text-lg font-black">{session.audioChunkCount}</p>
                        <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.14em] text-white/35">
                          audio
                        </p>
                      </div>
                    </div>
                  </button>

                  <button
                    type="button"
                    disabled={deletingId === session.id}
                    onClick={() => void deleteSession(session)}
                    className="shrink-0 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs font-black text-red-300 transition hover:bg-red-500/18 disabled:cursor-wait disabled:opacity-50"
                  >
                    {deletingId === session.id ? 'Deleting' : 'Delete'}
                  </button>
                </div>
              </article>
            )
          })}
        </div>

        {selected && (
          <aside className="min-h-0 space-y-5 overflow-y-auto pr-2 [scrollbar-color:rgba(255,255,255,0.2)_transparent]">
            <div className="rounded-2xl border border-white/10 bg-[#0c0c0c] p-6 shadow-[0_18px_65px_rgba(0,0,0,0.42)]">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="font-mono text-[10px] font-bold uppercase tracking-[0.24em] text-white/35">
                    Selected recording
                  </p>
                  <h3 className="mt-3 text-3xl font-black tracking-[-0.04em]">
                    {selected.name}
                  </h3>
                  <p className="mt-2 text-sm text-white/45">
                    {selected.outputPath}
                  </p>
                </div>
                <span className="rounded-full bg-white px-4 py-2 text-xs font-black text-black">
                  {statusLabel(selected)}
                </span>
              </div>

              <div className="mt-6 grid gap-3 sm:grid-cols-4">
                <EvidenceMetric label="Duration" value={formatDuration(selected.durationMs)} />
                <EvidenceMetric label="Events" value={selected.eventCount} />
                <EvidenceMetric label="Screenshots" value={selected.screenshotCount} />
                <EvidenceMetric label="Audio" value={selected.audioChunkCount} />
              </div>

              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                  <p className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-white/35">
                    Backend recording
                  </p>
                  <p className="mt-2 break-all font-mono text-xs text-white/65">
                    {selected.remoteRecordingId ?? 'Not uploaded yet'}
                  </p>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                  <p className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-white/35">
                    SOP session
                  </p>
                  <p className="mt-2 break-all font-mono text-xs text-white/65">
                    {selected.remoteSessionId ?? 'Pending'}
                  </p>
                </div>
              </div>
            </div>

            <StageTimeline session={selected} />
          </aside>
        )}
      </div>
    </section>
  )
}
