import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import type {
  BackendWorkflow,
  BackendWorkflowRecording
} from '../../shared/recording'
import { useTheme } from '../features/theme/ThemeContext'

const WorkflowAnalyticsPanel = lazy(() =>
  import('../features/analytics/WorkflowAnalyticsPanel').then((module) => ({
    default: module.WorkflowAnalyticsPanel
  }))
)

type WorkflowTab = 'overview' | 'recordings' | 'analytics'

const tabs: Array<{ id: WorkflowTab; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'recordings', label: 'Recordings' },
  { id: 'analytics', label: 'Analytics' }
]

function formatDate(value: string | null) {
  if (!value) return 'Not available'
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(new Date(value))
}

function formatDuration(value: number | null) {
  if (value === null) return 'Processing'
  const totalSeconds = Math.max(0, Math.round(value / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`
}

function statusLabel(value: string) {
  return value.replaceAll('_', ' ')
}

function statusTone(value: string, dark: boolean) {
  if (value === 'failed' || value === 'sop_failed') {
    return dark
      ? 'border-red-500/25 bg-red-500/10 text-red-300'
      : 'border-red-200 bg-red-50 text-red-700'
  }
  if (value === 'ready_for_review' || value === 'completed') {
    return dark
      ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-200'
      : 'border-emerald-200 bg-emerald-50 text-emerald-700'
  }
  return dark
    ? 'border-amber-400/20 bg-amber-400/10 text-amber-200'
    : 'border-amber-200 bg-amber-50 text-amber-700'
}

function Metric({
  label,
  value,
  dark
}: {
  label: string
  value: string | number
  dark: boolean
}) {
  return (
    <div
      className={[
        'rounded-2xl border p-5',
        dark
          ? 'border-white/10 bg-white/[0.03]'
          : 'border-slate-200 bg-white shadow-sm'
      ].join(' ')}
    >
      <p className={dark ? 'font-mono text-[9px] font-bold uppercase tracking-[0.2em] text-white/35' : 'text-xs font-bold uppercase tracking-[0.12em] text-slate-400'}>
        {label}
      </p>
      <p className={dark ? 'mt-2 text-2xl font-black text-white' : 'mt-2 text-2xl font-bold text-slate-800'}>
        {value}
      </p>
    </div>
  )
}

export function WorkflowDetailPage() {
  const { workflowId = '' } = useParams()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { theme } = useTheme()
  const isDark = theme === 'dark'

  const requestedTab = searchParams.get('tab')
  const activeTab: WorkflowTab = tabs.some((tab) => tab.id === requestedTab)
    ? requestedTab as WorkflowTab
    : 'overview'

  const [workflow, setWorkflow] = useState<BackendWorkflow | null>(null)
  const [recordings, setRecordings] = useState<BackendWorkflowRecording[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = async (initial = false) => {
    if (!workflowId) return
    if (initial) setIsLoading(true)
    else setIsRefreshing(true)
    setError(null)

    try {
      const [nextWorkflow, nextRecordings] = await Promise.all([
        window.api.recording.getWorkflow(workflowId),
        window.api.recording.listWorkflowRecordings(workflowId)
      ])
      setWorkflow(nextWorkflow)
      setRecordings(nextRecordings)
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Could not load this workflow.'
      )
    } finally {
      setIsLoading(false)
      setIsRefreshing(false)
    }
  }

  useEffect(() => {
    let active = true
    let timer: number | undefined

    const poll = async (initial: boolean) => {
      await load(initial)
      if (active) {
        timer = window.setTimeout(() => void poll(false), 5_000)
      }
    }

    void poll(true)
    return () => {
      active = false
      if (timer) window.clearTimeout(timer)
    }
  }, [workflowId])

  const averageDuration = useMemo(() => {
    const values = recordings
      .map((recording) => recording.duration_ms)
      .filter((value): value is number => value !== null)
    if (values.length === 0) return null
    return values.reduce((total, value) => total + value, 0) / values.length
  }, [recordings])

  const deleteRecording = async (recording: BackendWorkflowRecording) => {
    const label = recording.reference || recording.recorded_by_email || 'this recording'
    if (!window.confirm(`Delete ${label}? This removes the recording and its backend evidence.`)) {
      return
    }

    setDeletingId(recording.id)
    setError(null)
    try {
      await window.api.recording.deleteSession(recording.id)
      setRecordings((current) => current.filter((item) => item.id !== recording.id))
      const nextWorkflow = await window.api.recording.getWorkflow(workflowId)
      setWorkflow(nextWorkflow)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not delete the recording.')
    } finally {
      setDeletingId(null)
    }
  }

  if (isLoading && !workflow) {
    return (
      <main className={isDark ? 'grid h-[calc(100vh-4rem)] place-items-center' : 'grid h-[calc(100vh-4rem)] place-items-center bg-[#fafafb]'}>
        <span className={isDark ? 'size-2.5 animate-pulse rounded-full bg-emerald-400' : 'size-2.5 animate-pulse rounded-full bg-purple-500'} />
      </main>
    )
  }

  if (!workflow) {
    return (
      <main className={isDark ? 'space-y-5 px-6 py-8 md:px-8' : 'dashboard-page'}>
        <div className={isDark ? '' : 'dashboard-container'}>
          <button
            type="button"
            onClick={() => navigate('/sessions')}
            className={isDark ? 'font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-white/45 hover:text-white/70' : 'text-sm font-bold text-purple-700'}
          >
            ← Back to recorded workflows
          </button>
          <p className={isDark ? 'mt-5 text-sm text-white/50' : 'mt-5 text-sm text-slate-500'}>
            {error ?? 'This workflow could not be found.'}
          </p>
        </div>
      </main>
    )
  }

  return (
    <main className={isDark ? 'flex h-[calc(100vh-4rem)] min-h-0 flex-col overflow-hidden px-6 py-5 md:px-8' : 'dashboard-page flex h-[calc(100vh-4rem)] min-h-0 flex-col overflow-hidden'}>
      <div className={isDark ? 'shrink-0' : 'dashboard-container w-full shrink-0 pb-0'}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <button
              type="button"
              onClick={() => navigate('/sessions')}
              className={isDark ? 'font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-white/45 hover:text-white/70' : 'text-sm font-bold text-purple-700 hover:text-purple-500'}
            >
              ← Recorded workflows
            </button>
            <h1 className={isDark ? 'mt-3 truncate text-3xl font-black tracking-[-0.04em] text-white' : 'mt-3 truncate text-3xl font-bold tracking-[-0.03em] text-slate-800'}>
              {workflow.name}
            </h1>
            {workflow.description && (
              <p className={isDark ? 'mt-2 max-w-2xl text-sm leading-6 text-white/45' : 'mt-2 max-w-2xl text-sm leading-6 text-slate-500'}>
                {workflow.description}
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={() => void load(false)}
            disabled={isRefreshing}
            title="Refresh workflow"
            aria-label="Refresh workflow"
            className={[
              'grid size-10 place-items-center rounded-xl border transition disabled:cursor-wait disabled:opacity-50',
              isDark
                ? 'border-white/15 bg-white/[0.04] text-white/60 hover:bg-white/10 hover:text-white'
                : 'border-slate-200 bg-white text-slate-500 shadow-sm hover:text-purple-600'
            ].join(' ')}
          >
            <svg
              viewBox="0 0 24 24"
              aria-hidden="true"
              className={['size-4', isRefreshing ? 'animate-spin' : ''].join(' ')}
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
            >
              <path d="M21 12a9 9 0 0 1-15.4 6.4L3 16M3 16v5h5" />
              <path d="M3 12A9 9 0 0 1 18.4 5.6L21 8M21 8V3h-5" />
            </svg>
          </button>
        </div>

        <div className={isDark ? 'mt-5 flex gap-1 border-b border-white/10' : 'mt-5 flex gap-1 border-b border-slate-200'}>
          {tabs.map((tab) => (
            <button
              type="button"
              key={tab.id}
              onClick={() => setSearchParams(tab.id === 'overview' ? {} : { tab: tab.id }, { replace: true })}
              className={[
                'relative px-4 py-3 text-sm font-bold transition',
                activeTab === tab.id
                  ? isDark
                    ? 'text-white after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:bg-emerald-400'
                    : 'text-purple-700 after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:bg-purple-500'
                  : isDark
                    ? 'text-white/40 hover:text-white/70'
                    : 'text-slate-400 hover:text-slate-700'
              ].join(' ')}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {error && (
          <p className={isDark ? 'mt-4 rounded-xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-300' : 'mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600'}>
            {error}
          </p>
        )}
      </div>

      <div className={[
        'min-h-0 flex-1 overflow-y-auto pb-10',
        isDark
          ? 'mt-5 pr-2 [scrollbar-color:rgba(255,255,255,0.2)_transparent]'
          : 'dashboard-container mt-5 w-full pt-0'
      ].join(' ')}>
        {activeTab === 'overview' && (
          <div className="space-y-5">
            <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Metric label="Recordings" value={workflow.recording_count} dark={isDark} />
              <Metric label="Employees" value={workflow.user_count} dark={isDark} />
              <Metric label="Average duration" value={averageDuration === null ? 'Pending' : formatDuration(averageDuration)} dark={isDark} />
              <Metric label="Ready" value={workflow.ready_count} dark={isDark} />
            </section>

            <section className={isDark ? 'rounded-2xl border border-white/10 bg-[#0b0b0b] p-6' : 'rounded-2xl border border-slate-200 bg-white p-6 shadow-sm'}>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className={isDark ? 'font-mono text-[9px] font-bold uppercase tracking-[0.2em] text-white/35' : 'text-xs font-bold uppercase tracking-[0.12em] text-slate-400'}>
                    Recent executions
                  </p>
                  <h2 className={isDark ? 'mt-2 text-xl font-black text-white' : 'mt-2 text-xl font-bold text-slate-800'}>
                    Latest recordings
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => setSearchParams({ tab: 'recordings' }, { replace: true })}
                  className={isDark ? 'text-xs font-bold uppercase tracking-[0.12em] text-emerald-300 hover:text-emerald-200' : 'text-sm font-bold text-purple-700 hover:text-purple-500'}
                >
                  View all
                </button>
              </div>

              <div className={isDark ? 'mt-5 divide-y divide-white/10' : 'mt-5 divide-y divide-slate-100'}>
                {recordings.length === 0 ? (
                  <p className={isDark ? 'py-6 text-sm text-white/40' : 'py-6 text-sm text-slate-400'}>
                    No recordings have been added to this workflow yet.
                  </p>
                ) : recordings.slice(0, 3).map((recording) => (
                  <button
                    type="button"
                    key={recording.id}
                    onClick={() => navigate(`/sessions/${recording.id}`)}
                    className={isDark ? 'flex w-full items-center gap-4 py-4 text-left hover:text-emerald-200' : 'flex w-full items-center gap-4 py-4 text-left hover:text-purple-700'}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-bold">
                        {recording.reference || 'Unlabelled recording'}
                      </span>
                      <span className={isDark ? 'mt-1 block text-xs text-white/35' : 'mt-1 block text-xs text-slate-400'}>
                        {recording.recorded_by_email || 'Unknown employee'} · {formatDate(recording.created_at)}
                      </span>
                    </span>
                    <span className={isDark ? 'font-mono text-xs text-white/50' : 'text-xs font-medium text-slate-500'}>
                      {formatDuration(recording.duration_ms)}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          </div>
        )}

        {activeTab === 'recordings' && (
          <section className="space-y-3">
            {recordings.length === 0 ? (
              <div className={isDark ? 'rounded-2xl border border-white/10 bg-white/[0.025] p-10 text-center' : 'rounded-2xl border border-slate-200 bg-white p-10 text-center shadow-sm'}>
                <h2 className={isDark ? 'text-xl font-black text-white' : 'text-xl font-bold text-slate-800'}>No recordings yet</h2>
                <p className={isDark ? 'mt-2 text-sm text-white/40' : 'mt-2 text-sm text-slate-500'}>
                  Select this workflow the next time you save a recording.
                </p>
              </div>
            ) : recordings.map((recording) => (
              <article
                key={recording.id}
                className={[
                  'flex items-center gap-4 rounded-2xl border p-5',
                  isDark
                    ? 'border-white/10 bg-[#0b0b0b]'
                    : 'border-slate-200 bg-white shadow-sm'
                ].join(' ')}
              >
                <button
                  type="button"
                  onClick={() => navigate(`/sessions/${recording.id}`)}
                  className="min-w-0 flex-1 text-left"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className={isDark ? 'truncate text-base font-black text-white' : 'truncate text-base font-bold text-slate-800'}>
                        {recording.reference || 'Unlabelled recording'}
                      </h3>
                      <p className={isDark ? 'mt-1.5 text-xs text-white/40' : 'mt-1.5 text-xs text-slate-500'}>
                        {recording.recorded_by_email || 'Unknown employee'} · {formatDate(recording.created_at)} · {formatDuration(recording.duration_ms)}
                      </p>
                    </div>
                    <span className={[
                      'shrink-0 rounded-full border px-3 py-1 font-mono text-[9px] font-bold uppercase tracking-[0.12em]',
                      statusTone(recording.status, isDark)
                    ].join(' ')}>
                      {statusLabel(recording.status)}
                    </span>
                  </div>
                </button>

                <button
                  type="button"
                  disabled={deletingId !== null}
                  onClick={() => void deleteRecording(recording)}
                  className={isDark ? 'shrink-0 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs font-black uppercase tracking-[0.1em] text-red-300 transition hover:bg-red-500/18 disabled:opacity-40' : 'shrink-0 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-600 transition hover:bg-red-100 disabled:opacity-40'}
                >
                  {deletingId === recording.id ? 'Deleting' : 'Delete'}
                </button>
              </article>
            ))}
          </section>
        )}

        {activeTab === 'analytics' && (
          <Suspense fallback={<div className="grid min-h-72 place-items-center"><span className={isDark ? 'size-2.5 animate-pulse rounded-full bg-emerald-400' : 'size-2.5 animate-pulse rounded-full bg-purple-500'} /></div>}>
            <WorkflowAnalyticsPanel workflowId={workflowId} dark={isDark} />
          </Suspense>
        )}
      </div>
    </main>
  )
}
