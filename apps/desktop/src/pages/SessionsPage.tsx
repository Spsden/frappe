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
          <h1>Recorded Workflows</h1>
          <p>
            Live processing status at a glance. Click a session for evidence,
            transcript and SOP.
          </p>
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
              No recordings yet. Finished recordings will appear here with
              backend processing stages, evidence counts, audio transcript
              status and SOP readiness.
            </p>

            <div style={{ marginTop: '1.75rem' }}>
              <button
                type="button"
                onClick={onRefresh}
                className="gradient-button"
              >
                Refresh
              </button>
            </div>
          </div>
        </div>
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
  const [busyAction, setBusyAction] = useState<
    'upload' | 'sop' | 'delete' | null
  >(null)
  const [error, setError] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')

  const displaySessions = useMemo(() => {
    const active = activeRecordingSummary(recordingState)

    if (!active) return sessions

    if (!sessions.some((session) => session.id === active.id)) {
      return [active, ...sessions]
    }

    return sessions.map((session) =>
      session.id === active.id ? active : session
    )
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

  const refresh = async (showLoading = false) => {
    if (showLoading) {
      setIsLoading(true)
    }

    setError(null)

    try {
      setSessions(await window.api.recording.listSessions())
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Could not load recorded sessions.'
      )
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
      setSessions((current) =>
        current.filter((item) => item.id !== session.id)
      )
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Could not delete recorded session.'
      )
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

      if (active) {
        timer = window.setTimeout(() => void poll(false), 3000)
      }
    }

    void poll(true)

    return () => {
      active = false

      if (timer) {
        window.clearTimeout(timer)
      }
    }
  }, [])

  if (!isLoading && displaySessions.length === 0) {
    return <EmptyState onRefresh={() => void refresh()} />
  }

  return (
    <section className="dashboard-page">
      <div className="dashboard-container">
        <div className="page-header">
          <h1>Recorded Workflows</h1>
          <p>
            Live processing status at a glance. Click a session for evidence,
            transcript and SOP.
          </p>
        </div>

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
        </div>

        {error && (
          <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
            {error}
          </p>
        )}

        <div className="mt-6 space-y-4">
          {filteredSessions.length === 0 ? (
            <div className="table-card recordings-card">
              <div className="table-card-topline" />

              <div className="empty-table-message">
                <strong>No recordings found</strong>
                <p>Try searching by workflow name or status.</p>
              </div>
            </div>
          ) : (
            filteredSessions.map((session) => {
              const failed = isFailed(session)
              const retryable = canRetrySession(session)
              const sopRetryable = canRetrySop(session)
              const deletable = canDeleteSession(session)
              const isBusy = busyId === session.id

              return (
                <article
                  key={session.id}
                  className="overflow-hidden rounded-2xl border border-white/70 bg-white/80 shadow-[0_16px_45px_rgba(95,60,150,0.10)] backdrop-blur transition hover:-translate-y-0.5 hover:shadow-[0_20px_55px_rgba(95,60,150,0.16)]"
                >
                  <div className="table-card-topline" />

                  <div className="flex items-start gap-5 p-5">
                    <button
                      type="button"
                      onClick={() => navigate(`/sessions/${session.id}`)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <div className="flex items-center gap-3">
                            <span
                              className={`size-2.5 shrink-0 rounded-full ${statusDot(
                                session
                              )}`}
                            />

                            <h3 className="truncate text-lg font-bold text-slate-800">
                              {session.name}
                            </h3>
                          </div>

                          <p className="mt-2 text-sm text-slate-500">
                            {formatDate(session.startedAt)}
                            {' · '}
                            {formatDuration(session.durationMs)}
                          </p>
                        </div>

                        <span className={statusClassName(session)}>
                          {statusLabel(session)}
                        </span>
                      </div>

                       <div className="mt-5">
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
                          className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700 transition hover:bg-amber-100 disabled:cursor-wait disabled:opacity-40"
                        >
                          {isBusy && busyAction === 'sop'
                            ? 'Retrying'
                            : 'Retry SOP'}
                        </button>
                      )}

                      {retryable && (
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => void retrySession(session)}
                          className="rounded-xl border border-purple-200 bg-purple-50 px-3 py-2 text-xs font-bold text-purple-700 transition hover:bg-purple-100 disabled:cursor-wait disabled:opacity-40"
                        >
                          {isBusy && busyAction === 'upload'
                            ? 'Retrying'
                            : 'Retry'}
                        </button>
                      )}

                      <button
                        type="button"
                        disabled={!deletable || isBusy}
                        onClick={() => void deleteSession(session)}
                        className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-600 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {isBusy && busyAction === 'delete'
                          ? 'Deleting'
                          : 'Delete'}
                      </button>
                    </div>
                  </div>
                </article>
              )
            })
          )}
        </div>
      </div>
    </section>
  )
}