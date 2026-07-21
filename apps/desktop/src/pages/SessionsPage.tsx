import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { RecordedSessionSummary } from '../../shared/recording'
import { useRecording } from '../features/recording/useRecording'
import { StepProgress } from '../components/StepProgress'
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
          Finished recordings will appear here with live processing status. Click one for the
          full evidence breakdown and transcript.
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

export function SessionsPage() {
  const navigate = useNavigate()
  const { state: recordingState } = useRecording()
  const [sessions, setSessions] = useState<RecordedSessionSummary[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [busyAction, setBusyAction] = useState<'upload' | 'sop' | 'delete' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const displaySessions = useMemo(() => {
    const active = activeRecordingSummary(recordingState)
    if (!active) return sessions
    if (!sessions.some((session) => session.id === active.id)) return [active, ...sessions]
    return sessions.map((session) => (session.id === active.id ? active : session))
  }, [recordingState, sessions])

  const refresh = async (showLoading = false) => {
    if (showLoading) setIsLoading(true)
    setError(null)
    try {
      setSessions(await window.api.recording.listSessions())
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load recorded sessions.')
    } finally {
      setIsLoading(false)
    }
  }

  const retrySession = async (session: RecordedSessionSummary) => {
    setBusyId(session.id)
    setBusyAction('upload')
    setError(null)
    try {
      await window.api.recording.retry(session.id, 'upload')
      void refresh()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Retry failed.')
    } finally {
      setBusyId(null)
      setBusyAction(null)
    }
  }

  const retryServerSop = async (session: RecordedSessionSummary) => {
    setBusyId(session.id)
    setBusyAction('sop')
    setError(null)
    try {
      await window.api.recording.retry(session.id, 'sop')
      void refresh()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'SOP retry failed.')
    } finally {
      setBusyId(null)
      setBusyAction(null)
    }
  }

  const deleteSession = async (session: RecordedSessionSummary) => {
    const confirmed = window.confirm(
      `Delete "${session.name}"? This removes the local recording and attempts to remove the backend recording too.`
    )
    if (!confirmed) return
    setBusyId(session.id)
    setBusyAction('delete')
    setError(null)
    try {
      await window.api.recording.deleteSession(session.id)
      setSessions((current) => current.filter((item) => item.id !== session.id))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not delete recorded session.')
    } finally {
      setBusyId(null)
      setBusyAction(null)
    }
  }

  useEffect(() => {
    let active = true
    let timer: number | undefined

    const poll = async (showLoading: boolean) => {
      await refresh(showLoading)
      if (active) timer = window.setTimeout(() => void poll(false), 3000)
    }

    void poll(true)
    return () => {
      active = false
      if (timer) window.clearTimeout(timer)
    }
  }, [])

  if (!isLoading && displaySessions.length === 0) {
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
            <h2 className="mt-3 text-4xl font-black tracking-[-0.045em]">Recorded Workflows</h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-white/50">
              Live processing status at a glance. Click a session for evidence, transcript and SOP.
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

      <div className="mt-8 min-h-0 flex-1 space-y-3 overflow-y-auto pr-2 [scrollbar-color:rgba(255,255,255,0.2)_transparent]">
        {displaySessions.map((session) => {
          const failed = isFailed(session)
          const retryable = canRetrySession(session)
          const sopRetryable = canRetrySop(session)
          const deletable = canDeleteSession(session)
          const isBusy = busyId === session.id
          return (
            <article
              key={session.id}
              className="w-full rounded-2xl border border-white/10 bg-[#0b0b0b] p-5 text-left transition hover:border-white/20 hover:bg-white/[0.05]"
            >
              <div className="flex items-center gap-4">
                <button
                  type="button"
                  onClick={() => navigate(`/sessions/${session.id}`)}
                  className="min-w-0 flex-1 text-left"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-3">
                        <span className={`size-2.5 shrink-0 rounded-full ${statusDot(session)}`} />
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

                  <div className="mt-4">
                    <StepProgress
                      status={statusForSession(session)}
                      failed={failed}
                      hasAudio={session.audioChunkCount > 0}
                    />
                  </div>
                </button>

                <div className="flex shrink-0 flex-col gap-2">
                  {sopRetryable && (
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => void retryServerSop(session)}
                      className="rounded-xl border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs font-black uppercase tracking-[0.12em] text-amber-200 transition hover:bg-amber-400/18 disabled:cursor-wait disabled:opacity-40"
                    >
                      {isBusy && busyAction === 'sop' ? 'Retrying' : 'Retry SOP'}
                    </button>
                  )}
                  {retryable && (
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => void retrySession(session)}
                      className="rounded-xl border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs font-black uppercase tracking-[0.12em] text-amber-200 transition hover:bg-amber-400/18 disabled:cursor-wait disabled:opacity-40"
                    >
                      {isBusy && busyAction === 'upload' ? 'Retrying' : 'Retry'}
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={!deletable || isBusy}
                    onClick={() => void deleteSession(session)}
                    className="rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs font-black uppercase tracking-[0.12em] text-red-300 transition hover:bg-red-500/18 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {isBusy && busyAction === 'delete' ? 'Deleting' : 'Delete'}
                  </button>
                </div>
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}
