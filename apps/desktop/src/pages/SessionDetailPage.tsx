import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type {
  BackendTranscript,
  BackendWorkflowSession,
  RecordedSessionSummary
} from '../../shared/recording'
import { useRecording } from '../features/recording/useRecording'
import {
  activeRecordingSummary,
  canDeleteSession,
  canRetrySop,
  canRetrySession,
  formatDate,
  formatDuration,
  isFailed,
  statusDot,
  statusForSession,
  statusLabel
} from '../features/recording/sessionStatus'
import { StepProgress } from '../components/StepProgress'
import { EvidenceGallery } from '../components/EvidenceGallery'

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <p className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-white/35">
        {label}
      </p>
      <p className="mt-2 text-2xl font-black">{value}</p>
    </div>
  )
}

function formatTimestamp(ms: number) {
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  const remainder = seconds % 60
  return `${minutes}:${remainder.toString().padStart(2, '0')}`
}

function TranscriptPanel({
  session,
  editable,
  value,
  onChange
}: {
  session: BackendWorkflowSession | null
  editable?: boolean
  value?: string
  onChange?: (value: string) => void
}) {
  if (!session) {
    return (
      <p className="text-sm text-white/45">
        Transcript is unavailable until the recording finishes uploading.
      </p>
    )
  }

  const transcript: BackendTranscript | null = session.transcript
  if (!transcript || transcript.status === 'not_recorded') {
    if (!editable) {
      return <p className="text-sm text-white/45">No audio narration was recorded.</p>
    }
    return (
      <textarea
        value={value ?? ''}
        onChange={(event) => onChange?.(event.target.value)}
        placeholder="No audio was recorded. Add reviewer notes for the SOP if useful."
        className="min-h-36 w-full resize-y rounded-xl border border-white/10 bg-black/35 px-4 py-3 text-sm leading-6 text-white outline-none transition placeholder:text-white/25 focus:border-white/30"
      />
    )
  }

  return (
    <div className="space-y-3">
      <p className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-white/35">
        Status · {transcript.status}
      </p>
      {transcript.text ? (
        editable ? (
          <textarea
            value={value ?? ''}
            onChange={(event) => onChange?.(event.target.value)}
            className="min-h-44 w-full resize-y rounded-xl border border-white/10 bg-black/35 px-4 py-3 text-sm leading-6 text-white outline-none transition placeholder:text-white/25 focus:border-white/30"
            placeholder="Review and edit the transcript..."
          />
        ) : (
          <p className="text-sm leading-6 text-white/70">{transcript.text}</p>
        )
      ) : (
        editable ? (
          <textarea
            value={value ?? ''}
            onChange={(event) => onChange?.(event.target.value)}
            className="min-h-44 w-full resize-y rounded-xl border border-white/10 bg-black/35 px-4 py-3 text-sm leading-6 text-white outline-none transition placeholder:text-white/25 focus:border-white/30"
            placeholder="Transcript is empty. Add context for the SOP..."
          />
        ) : (
          <p className="text-sm text-white/45">
            {transcript.status === 'pending_transcription'
              ? 'Audio is queued for transcription.'
              : 'No transcript text available.'}
          </p>
        )
      )}
      {!editable && transcript.segments.length > 0 && (
        <ul className="space-y-1.5">
          {transcript.segments.map((segment, index) => (
            <li key={index} className="flex gap-3 text-sm text-white/55">
              <span className="shrink-0 font-mono text-[10px] text-white/35">
                {formatTimestamp(segment.start_ms)}
              </span>
              <span>{segment.text}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function SessionDetailPage() {
  const { id = '' } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { state: recordingState } = useRecording()

  const [session, setSession] = useState<RecordedSessionSummary | null>(null)
  const [backendSession, setBackendSession] = useState<BackendWorkflowSession | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [acting, setActing] = useState<'upload' | 'sop' | 'review' | 'delete' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [transcriptDraft, setTranscriptDraft] = useState('')
  const [customInstruction, setCustomInstruction] = useState('')
  const [reviewDirty, setReviewDirty] = useState(false)

  useEffect(() => {
    let cancelled = false
    let timer: number | undefined

    const load = async () => {
      setError(null)
      try {
        const sessions = await window.api.recording.listSessions()
        if (cancelled) return
        const active = activeRecordingSummary(recordingState)
        const merged = active && !sessions.some((item) => item.id === active.id)
          ? [active, ...sessions]
          : sessions.map((item) => (item.id === active?.id ? active : item))
        const found = merged.find((item) => item.id === id) ?? null
        setSession(found)

        setBackendSession(null)
        if (found?.remoteSessionId) {
          try {
            const backend = await window.api.recording.getSession(found.remoteSessionId)
            if (!cancelled) setBackendSession(backend)
          } catch {
            // Transient/offline — the local summary still renders.
          }
        }
      } catch (caught) {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : 'Could not load session.')
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false)
          timer = window.setTimeout(() => void load(), 3000)
        }
      }
    }

    void load()
    return () => {
      cancelled = true
      if (timer) window.clearTimeout(timer)
    }
  }, [id, recordingState])

  useEffect(() => {
    if (reviewDirty) return
    const transcript = backendSession?.transcript
    const transcriptText =
      transcript?.text ??
      transcript?.segments.map((segment) => segment.text).join('\n') ??
      ''
    setTranscriptDraft(transcriptText)
    setCustomInstruction(session?.backend?.recording.custom_sop_instruction ?? '')
  }, [backendSession, reviewDirty, session?.backend?.recording.custom_sop_instruction])

  const retry = async () => {
    setActing('upload')
    setError(null)
    try {
      await window.api.recording.retry(id, 'upload')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Retry failed.')
    } finally {
      setActing(null)
    }
  }

  const retryServerSop = async () => {
    setActing('sop')
    setError(null)
    try {
      await window.api.recording.retry(id, 'sop')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'SOP retry failed.')
    } finally {
      setActing(null)
    }
  }

  const saveReview = async () => {
    if (!session?.remoteRecordingId) return
    setActing('review')
    setError(null)
    try {
      const recording = await window.api.recording.saveManualReview(
        session.remoteRecordingId,
        transcriptDraft,
        customInstruction
      )
      setSession((current) =>
        current
          ? {
              ...current,
              remoteStatus: recording.status,
              backend: current.backend
                ? { ...current.backend, recording }
                : current.backend
            }
          : current
      )
      setReviewDirty(false)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save review.')
    } finally {
      setActing(null)
    }
  }

  const generateSop = async () => {
    if (!session?.remoteRecordingId) return
    setActing('sop')
    setError(null)
    try {
      if (reviewDirty) {
        await window.api.recording.saveManualReview(
          session.remoteRecordingId,
          transcriptDraft,
          customInstruction
        )
        setReviewDirty(false)
      }
      const recording = await window.api.recording.generateSop(
        session.remoteRecordingId,
        customInstruction
      )
      setSession((current) =>
        current
          ? {
              ...current,
              remoteStatus: recording.status,
              backend: current.backend
                ? { ...current.backend, recording }
                : current.backend
            }
          : current
      )
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not start SOP generation.')
    } finally {
      setActing(null)
    }
  }

  const remove = async () => {
    if (!session) return
    const confirmed = window.confirm(
      `Delete "${session.name}"? This removes the local recording and attempts to remove the backend recording too.`
    )
    if (!confirmed) return
    setActing('delete')
    setError(null)
    try {
      await window.api.recording.deleteSession(id)
      navigate('/sessions')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not delete session.')
      setActing(null)
    }
  }

  if (isLoading && !session) {
    return (
      <main className="grid h-[calc(100vh-4rem)] place-items-center px-6">
        <span className="size-2.5 animate-pulse rounded-full bg-white/45" />
      </main>
    )
  }

  if (!session) {
    return (
      <main className="space-y-5 px-6 py-8 md:px-8">
        <button
          type="button"
          onClick={() => navigate('/sessions')}
          className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-white/45 hover:text-white/70"
        >
          ← Back to sessions
        </button>
        <p className="text-sm text-white/50">
          {error ?? 'This session could not be found.'}
        </p>
      </main>
    )
  }

  const failed = isFailed(session)
  const retryable = canRetrySession(session)
  const sopRetryable = canRetrySop(session)
  const deletable = canDeleteSession(session)
  const backendRecording = session.backend?.recording
  const currentStatus = statusForSession(session)
  const isManualReview =
    Boolean(backendRecording?.manual_mode) &&
    (currentStatus === 'awaiting_manual_review' || currentStatus === 'sop_failed')
  const sopReady = currentStatus === 'ready_for_review' || currentStatus === 'completed'

  return (
    <main className="space-y-6 px-6 py-8 md:px-8">
      <button
        type="button"
        onClick={() => navigate('/sessions')}
        className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-white/45 hover:text-white/70"
      >
        ← Back to sessions
      </button>

      {error && (
        <p className="rounded-xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </p>
      )}

      <section className="rounded-2xl border border-white/10 bg-[#0c0c0c] p-6 shadow-[0_18px_65px_rgba(0,0,0,0.42)]">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="font-mono text-[10px] font-bold uppercase tracking-[0.24em] text-white/35">
              {formatDate(session.startedAt)} · {formatDuration(session.durationMs)}
            </p>
            <h2 className="mt-2 flex items-center gap-3 text-3xl font-black tracking-[-0.035em]">
              <span className={`size-3 shrink-0 rounded-full ${statusDot(session)}`} />
              <span className="truncate">{session.name}</span>
            </h2>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {session.remoteSessionId && sopReady && (
              <button
                type="button"
                onClick={() => navigate(`/sessions/${id}/sop`)}
                className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-xs font-black uppercase tracking-[0.12em] text-emerald-300 transition hover:bg-emerald-500/18"
              >
                View SOP
              </button>
            )}
            {isManualReview && (
              <button
                type="button"
                disabled={acting !== null}
                onClick={() => void generateSop()}
                className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-xs font-black uppercase tracking-[0.12em] text-emerald-300 transition hover:bg-emerald-500/18 disabled:cursor-wait disabled:opacity-40"
              >
                {acting === 'sop' ? 'Starting' : 'Generate SOP'}
              </button>
            )}
            {sopRetryable && !isManualReview && (
              <button
                type="button"
                disabled={acting !== null}
                onClick={() => void retryServerSop()}
                className="rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-2 text-xs font-black uppercase tracking-[0.12em] text-amber-200 transition hover:bg-amber-400/18 disabled:cursor-wait disabled:opacity-40"
              >
                {acting === 'sop' ? 'Retrying' : 'Retry SOP'}
              </button>
            )}
            {retryable && (
              <button
                type="button"
                disabled={acting !== null}
                onClick={() => void retry()}
                className="rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-2 text-xs font-black uppercase tracking-[0.12em] text-amber-200 transition hover:bg-amber-400/18 disabled:cursor-wait disabled:opacity-40"
              >
                {acting === 'upload' ? 'Retrying' : 'Retry'}
              </button>
            )}
            <button
              type="button"
              disabled={!deletable || acting !== null}
              onClick={() => void remove()}
              className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-2 text-xs font-black uppercase tracking-[0.12em] text-red-300 transition hover:bg-red-500/18 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {acting === 'delete' ? 'Deleting' : 'Delete'}
            </button>
          </div>
        </div>

        <div className="mt-6">
          <StepProgress
            status={statusForSession(session)}
            failed={failed}
            hasAudio={session.audioChunkCount > 0}
            barClassName="h-2"
          />
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-4">
          <Metric label="Duration" value={formatDuration(session.durationMs)} />
          <Metric label="Events" value={session.eventCount} />
          <Metric label="Screenshots" value={session.screenshotCount} />
          <Metric label="Audio chunks" value={session.audioChunkCount} />
        </div>

        {session.uploadError && (
          <p className="mt-5 rounded-xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {session.uploadError}
          </p>
        )}

        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <p className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-white/35">
              Backend recording
            </p>
            <p className="mt-2 break-all font-mono text-xs text-white/65">
              {session.remoteRecordingId ?? 'Not uploaded yet'}
            </p>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <p className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-white/35">
              SOP session
            </p>
            <p className="mt-2 break-all font-mono text-xs text-white/65">
              {session.remoteSessionId ?? 'Pending'}
            </p>
          </div>
        </div>
      </section>

      {isManualReview && (
        <section className="rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.045] p-6 shadow-[0_18px_65px_rgba(0,0,0,0.35)]">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="font-mono text-[10px] font-bold uppercase tracking-[0.24em] text-emerald-300">
                Manual review
              </p>
              <h3 className="mt-2 text-2xl font-black tracking-[-0.035em]">
                Evidence is ready for human edits
              </h3>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-white/55">
                Adjust annotations, clean up the transcript, and add a short instruction for the SOP prompt.
                Saving writes the review state back to the backend.
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <button
                type="button"
                disabled={acting !== null || !reviewDirty}
                onClick={() => void saveReview()}
                className="rounded-xl border border-white/12 bg-white/[0.04] px-4 py-2 text-xs font-black uppercase tracking-[0.12em] text-white/75 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {acting === 'review' ? 'Saving' : reviewDirty ? 'Save review' : 'Saved'}
              </button>
              <button
                type="button"
                disabled={acting !== null}
                onClick={() => void generateSop()}
                className="rounded-xl bg-emerald-400 px-4 py-2 text-xs font-black uppercase tracking-[0.12em] text-black transition hover:bg-emerald-300 disabled:cursor-wait disabled:opacity-50"
              >
                {acting === 'sop' ? 'Starting' : 'Generate SOP'}
              </button>
            </div>
          </div>

          <label className="mt-5 block">
            <span className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-white/40">
              Custom SOP instruction
            </span>
            <textarea
              value={customInstruction}
              onChange={(event) => {
                setCustomInstruction(event.target.value)
                setReviewDirty(true)
              }}
              placeholder="Example: make this SOP concise, mention checks before approval, use finance-team wording..."
              className="mt-3 min-h-24 w-full resize-y rounded-xl border border-white/10 bg-black/35 px-4 py-3 text-sm leading-6 text-white outline-none transition placeholder:text-white/25 focus:border-emerald-300/50"
            />
          </label>
        </section>
      )}

      <section className="rounded-2xl border border-white/10 bg-[#090909] p-6">
        <div className="flex items-center justify-between gap-4">
          <h3 className="text-lg font-black tracking-[-0.02em]">Transcript</h3>
          <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-white/60">
            {statusLabel(session)}
          </span>
        </div>
        <div className="mt-5">
          <TranscriptPanel
            session={backendSession}
            editable={isManualReview}
            value={transcriptDraft}
            onChange={(value) => {
              setTranscriptDraft(value)
              setReviewDirty(true)
            }}
          />
        </div>
      </section>

      <section className="rounded-2xl border border-white/10 bg-[#090909] p-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="text-lg font-black tracking-[-0.02em]">Evidence</h3>
            <p className="mt-1 text-xs text-white/40">
              Captured screenshots with click &amp; scroll highlights.
            </p>
          </div>
          {session.remoteSessionId ? (
            <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-white/60">
              {session.screenshotCount} frame{session.screenshotCount === 1 ? '' : 's'}
            </span>
          ) : null}
        </div>
        <div className="mt-5">
          <EvidenceGallery remoteSessionId={session.remoteSessionId} editable={isManualReview} />
        </div>
      </section>
    </main>
  )
}
