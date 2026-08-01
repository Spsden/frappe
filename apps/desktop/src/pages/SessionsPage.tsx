import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { BackendWorkflow } from '../../shared/recording'
import { useRecording } from '../features/recording/useRecording'
import { useTheme } from '../features/theme/ThemeContext'

function plural(count: number, singular: string) {
  return `${count} ${count === 1 ? singular : `${singular}s`}`
}

function relativeDate(value: string | null) {
  if (!value) {
    return 'No recordings yet'
  }

  const date = new Date(value)
  const elapsedMs = Date.now() - date.getTime()
  const elapsedMinutes = Math.max(0, Math.floor(elapsedMs / 60_000))

  if (elapsedMinutes < 1) return 'Updated just now'
  if (elapsedMinutes < 60) return `Updated ${elapsedMinutes}m ago`

  const elapsedHours = Math.floor(elapsedMinutes / 60)
  if (elapsedHours < 24) return `Updated ${elapsedHours}h ago`

  const elapsedDays = Math.floor(elapsedHours / 24)
  if (elapsedDays < 7) return `Updated ${elapsedDays}d ago`

  return `Updated ${new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric'
  }).format(date)}`
}

function FolderIcon({ dark }: { dark: boolean }) {
  return (
    <span
      className={[
        'grid size-11 shrink-0 place-items-center rounded-xl border',
        dark
          ? 'border-white/10 bg-white/[0.05] text-emerald-300'
          : 'border-purple-100 bg-purple-50 text-purple-600'
      ].join(' ')}
    >
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        className="size-5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H10l2 2h6.5A2.5 2.5 0 0 1 21 9.5v7A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5Z" />
      </svg>
    </span>
  )
}

export function SessionsPage() {
  const navigate = useNavigate()
  const { theme } = useTheme()
  const { state: recordingState } = useRecording()
  const isDark = theme === 'dark'

  const [workflows, setWorkflows] = useState<BackendWorkflow[]>([])
  const [searchTerm, setSearchTerm] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const visibleWorkflows = useMemo(() => {
    const query = searchTerm.trim().toLocaleLowerCase()
    if (!query) return workflows

    return workflows.filter((workflow) =>
      [workflow.name, workflow.description, workflow.created_by_email]
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase()
        .includes(query)
    )
  }, [searchTerm, workflows])

  const refresh = async (initial = false) => {
    if (initial) setIsLoading(true)
    else setIsRefreshing(true)
    setError(null)

    try {
      setWorkflows(await window.api.recording.listWorkflows())
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Could not load recorded workflows.'
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
      await refresh(initial)
      if (active) {
        timer = window.setTimeout(() => void poll(false), 5_000)
      }
    }

    void poll(true)
    return () => {
      active = false
      if (timer) window.clearTimeout(timer)
    }
  }, [])

  const recordingInProgress = [
    'requesting-permissions',
    'starting',
    'recording',
    'paused',
    'stopping',
    'awaiting-save',
    'uploading'
  ].includes(recordingState.status)

  return (
    <section
      className={
        isDark
          ? 'flex h-[calc(100vh-4rem)] min-h-0 flex-col overflow-hidden px-5 py-4 md:px-8'
          : 'dashboard-page flex h-[calc(100vh-4rem)] min-h-0 flex-col overflow-hidden'
      }
    >
      <div className={isDark ? 'shrink-0' : 'dashboard-container w-full shrink-0 pb-0'}>
        <div className="flex items-center gap-3">
          <div className="relative min-w-0 flex-1">
            <svg
              viewBox="0 0 24 24"
              aria-hidden="true"
              className={[
                'pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2',
                isDark ? 'text-white/35' : 'text-slate-400'
              ].join(' ')}
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            <input
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Search workflows..."
              className={
                isDark
                  ? 'h-11 w-full rounded-xl border border-white/10 bg-white/[0.035] pl-11 pr-4 text-sm text-white outline-none transition placeholder:text-white/30 focus:border-white/25'
                  : 'h-11 w-full rounded-xl border border-slate-200 bg-white pl-11 pr-4 text-sm text-slate-800 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-purple-300'
              }
            />
          </div>

          <button
            type="button"
            onClick={() => void refresh(false)}
            disabled={isRefreshing}
            title={isRefreshing ? 'Refreshing' : 'Refresh workflows'}
            aria-label={isRefreshing ? 'Refreshing workflows' : 'Refresh workflows'}
            className={[
              'grid size-11 shrink-0 place-items-center rounded-xl border transition disabled:cursor-wait disabled:opacity-50',
              isDark
                ? 'border-white/15 bg-white/[0.04] text-white/65 hover:bg-white/10 hover:text-white'
                : 'border-slate-200 bg-white text-slate-500 shadow-sm hover:border-purple-200 hover:text-purple-600'
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
              strokeLinejoin="round"
            >
              <path d="M21 12a9 9 0 0 1-15.4 6.4L3 16" />
              <path d="M3 16v5h5" />
              <path d="M3 12A9 9 0 0 1 18.4 5.6L21 8" />
              <path d="M21 8V3h-5" />
            </svg>
          </button>
        </div>

        {recordingInProgress && (
          <button
            type="button"
            onClick={() => navigate('/dashboard')}
            className={[
              'mt-3 flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left text-sm transition',
              isDark
                ? 'border-emerald-400/20 bg-emerald-400/[0.06] text-emerald-200 hover:bg-emerald-400/10'
                : 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
            ].join(' ')}
          >
            <span className="flex items-center gap-3 font-bold">
              <span className="size-2 animate-pulse rounded-full bg-emerald-400" />
              Recording is {recordingState.status.replaceAll('-', ' ')}
            </span>
            <span className="text-xs font-bold uppercase tracking-[0.12em]">Open capture</span>
          </button>
        )}

        {error && (
          <p
            className={
              isDark
                ? 'mt-3 rounded-xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-300'
                : 'mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600'
            }
          >
            {error}
          </p>
        )}
      </div>

      <div
        className={[
          'min-h-0 flex-1 overflow-y-auto pb-8',
          isDark
            ? 'mt-4 space-y-3 pr-2 [scrollbar-color:rgba(255,255,255,0.2)_transparent]'
            : 'dashboard-container mt-4 w-full space-y-4 pt-0'
        ].join(' ')}
      >
        {isLoading && workflows.length === 0 ? (
          <div className="grid min-h-64 place-items-center">
            <div className="text-center">
              <span className={isDark ? 'mx-auto block size-2.5 animate-pulse rounded-full bg-emerald-400' : 'mx-auto block size-2.5 animate-pulse rounded-full bg-purple-500'} />
              <p className={isDark ? 'mt-4 font-mono text-[10px] uppercase tracking-[0.2em] text-white/35' : 'mt-4 text-sm font-medium text-slate-400'}>
                Loading workflows
              </p>
            </div>
          </div>
        ) : visibleWorkflows.length === 0 ? (
          <div
            className={[
              'grid min-h-64 place-items-center rounded-2xl border p-8 text-center',
              isDark
                ? 'border-white/10 bg-white/[0.025]'
                : 'border-slate-200 bg-white shadow-sm'
            ].join(' ')}
          >
            <div className="max-w-md">
              <FolderIcon dark={isDark} />
              <h2 className={isDark ? 'mt-5 text-2xl font-black text-white' : 'mt-5 text-2xl font-bold text-slate-800'}>
                {searchTerm ? 'No matching workflows' : 'Record your first workflow'}
              </h2>
              <p className={isDark ? 'mt-2 text-sm leading-6 text-white/45' : 'mt-2 text-sm leading-6 text-slate-500'}>
                {searchTerm
                  ? 'Try a different workflow name or clear the search.'
                  : 'Saved recordings are grouped here by workflow so different executions stay together.'}
              </p>
              {!searchTerm && (
                <button
                  type="button"
                  onClick={() => navigate('/dashboard')}
                  className={
                    isDark
                      ? 'mt-6 rounded-full bg-white px-5 py-3 text-sm font-black text-black transition hover:bg-white/85'
                      : 'mt-6 rounded-full bg-purple-600 px-5 py-3 text-sm font-bold text-white transition hover:bg-purple-500'
                  }
                >
                  Start recording
                </button>
              )}
            </div>
          </div>
        ) : (
          visibleWorkflows.map((workflow) => (
            <button
              type="button"
              key={workflow.id}
              onClick={() => navigate(`/workflows/${workflow.id}`)}
              className={[
                'group flex w-full items-center gap-4 rounded-2xl border p-5 text-left transition',
                isDark
                  ? 'border-white/10 bg-[#0b0b0b] hover:border-white/20 hover:bg-white/[0.05]'
                  : 'border-slate-200 bg-white shadow-sm hover:-translate-y-0.5 hover:border-purple-200 hover:shadow-lg'
              ].join(' ')}
            >
              <FolderIcon dark={isDark} />

              <span className="min-w-0 flex-1">
                <span className={isDark ? 'block truncate text-lg font-black tracking-[-0.03em] text-white' : 'block truncate text-lg font-bold text-slate-800'}>
                  {workflow.name}
                </span>
                <span className={isDark ? 'mt-1.5 block font-mono text-[10px] uppercase tracking-[0.15em] text-white/35' : 'mt-1.5 block text-sm text-slate-500'}>
                  {plural(workflow.recording_count, 'recording')} ·{' '}
                  {plural(workflow.user_count, 'employee')} ·{' '}
                  {relativeDate(workflow.last_recording_at)}
                </span>
              </span>

              <span className="hidden shrink-0 items-center gap-2 sm:flex">
                {workflow.processing_count > 0 && (
                  <span className={isDark ? 'rounded-full border border-amber-400/20 bg-amber-400/10 px-3 py-1 font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-amber-200' : 'rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-bold text-amber-700'}>
                    {workflow.processing_count} processing
                  </span>
                )}
                {workflow.ready_count > 0 && (
                  <span className={isDark ? 'rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-emerald-200' : 'rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700'}>
                    {workflow.ready_count} ready
                  </span>
                )}
              </span>

              <svg
                viewBox="0 0 20 20"
                aria-hidden="true"
                className={isDark ? 'size-5 shrink-0 text-white/25 transition group-hover:translate-x-0.5 group-hover:text-white/60' : 'size-5 shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-purple-500'}
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
              >
                <path d="m7 4 6 6-6 6" />
              </svg>
            </button>
          ))
        )}
      </div>
    </section>
  )
}
