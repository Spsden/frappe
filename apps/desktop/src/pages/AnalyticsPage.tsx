import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import type { BackendWorkflow } from '../../shared/recording'
import { useTheme } from '../features/theme/ThemeContext'

const WorkflowAnalyticsPanel = lazy(() =>
  import('../features/analytics/WorkflowAnalyticsPanel').then((module) => ({
    default: module.WorkflowAnalyticsPanel
  }))
)

const lastWorkflowKey = 'worktrace.analytics.workflowId'

function plural(count: number, singular: string) {
  return `${count} ${count === 1 ? singular : `${singular}s`}`
}

function WorkflowListItem({
  workflow,
  selected,
  dark,
  onSelect
}: {
  workflow: BackendWorkflow
  selected: boolean
  dark: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={[
        'w-full rounded-xl border p-4 text-left transition',
        selected
          ? dark
            ? 'border-emerald-400/35 bg-emerald-400/[0.09]'
            : 'border-purple-300 bg-purple-50 shadow-sm'
          : dark
            ? 'border-white/10 bg-white/[0.025] hover:border-white/20 hover:bg-white/[0.05]'
            : 'border-slate-200 bg-white hover:border-purple-200 hover:bg-purple-50/40'
      ].join(' ')}
    >
      <div className="flex items-start gap-3">
        <span
          className={[
            'mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg border',
            selected
              ? dark
                ? 'border-emerald-300/25 bg-emerald-300/10 text-emerald-200'
                : 'border-purple-200 bg-white text-purple-600'
              : dark
                ? 'border-white/10 bg-white/[0.04] text-white/40'
                : 'border-slate-200 bg-slate-50 text-slate-400'
          ].join(' ')}
        >
          <svg
            viewBox="0 0 24 24"
            aria-hidden="true"
            className="size-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinecap="round"
          >
            <path d="M4 19V11M10 19V5M16 19v-4M22 19V8" />
          </svg>
        </span>

        <span className="min-w-0 flex-1">
          <span
            className={
              dark
                ? 'block truncate text-sm font-black text-white'
                : 'block truncate text-sm font-bold text-slate-800'
            }
          >
            {workflow.name}
          </span>
          <span
            className={
              dark
                ? 'mt-1.5 block text-[11px] text-white/35'
                : 'mt-1.5 block text-[11px] text-slate-500'
            }
          >
            {plural(workflow.recording_count, 'recording')} ·{' '}
            {plural(workflow.user_count, 'employee')}
          </span>
        </span>
      </div>

      {(workflow.ready_count > 0 || workflow.processing_count > 0) && (
        <div className="mt-3 flex flex-wrap gap-1.5 pl-12">
          {workflow.ready_count > 0 && (
            <span
              className={
                dark
                  ? 'rounded-full border border-emerald-400/15 bg-emerald-400/[0.07] px-2 py-1 font-mono text-[8px] font-bold uppercase tracking-[0.1em] text-emerald-200/70'
                  : 'rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-[9px] font-bold text-emerald-700'
              }
            >
              {workflow.ready_count} ready
            </span>
          )}
          {workflow.processing_count > 0 && (
            <span
              className={
                dark
                  ? 'rounded-full border border-amber-400/15 bg-amber-400/[0.07] px-2 py-1 font-mono text-[8px] font-bold uppercase tracking-[0.1em] text-amber-200/70'
                  : 'rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-[9px] font-bold text-amber-700'
              }
            >
              {workflow.processing_count} processing
            </span>
          )}
        </div>
      )}
    </button>
  )
}

export function AnalyticsPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { theme } = useTheme()
  const dark = theme === 'dark'

  const [workflows, setWorkflows] = useState<BackendWorkflow[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const requestedWorkflowId = searchParams.get('workflow')
  const selectedWorkflow = workflows.find(
    (workflow) => workflow.id === requestedWorkflowId
  ) ?? null

  const visibleWorkflows = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    if (!needle) return workflows
    return workflows.filter((workflow) =>
      [workflow.name, workflow.description, workflow.created_by_email]
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase()
        .includes(needle)
    )
  }, [query, workflows])

  const loadWorkflows = async (initial: boolean) => {
    if (initial) setLoading(true)
    else setRefreshing(true)
    setError(null)
    try {
      setWorkflows(await window.api.recording.listWorkflows())
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Could not load workflow analytics.'
      )
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => {
    void loadWorkflows(true)
  }, [])

  useEffect(() => {
    if (workflows.length === 0 || selectedWorkflow) return
    const remembered = window.sessionStorage.getItem(lastWorkflowKey)
    const fallback = workflows.find((workflow) => workflow.id === remembered) ?? workflows[0]
    setSearchParams({ workflow: fallback.id }, { replace: true })
  }, [selectedWorkflow, setSearchParams, workflows])

  const selectWorkflow = (workflowId: string) => {
    window.sessionStorage.setItem(lastWorkflowKey, workflowId)
    setSearchParams({ workflow: workflowId }, { replace: true })
  }

  return (
    <section
      className={[
        'grid h-[calc(100vh-4rem)] min-h-0 grid-cols-[310px_minmax(0,1fr)] gap-5 overflow-hidden px-5 py-4 md:px-8',
        dark ? 'text-white' : 'bg-[#fafafb] text-slate-900'
      ].join(' ')}
    >
      <aside
        className={[
          'flex min-h-0 flex-col overflow-hidden rounded-2xl border',
          dark
            ? 'border-white/10 bg-[#090909]'
            : 'border-slate-200 bg-white shadow-[0_16px_45px_rgba(95,60,150,0.08)]'
        ].join(' ')}
      >
        <div
          className={
            dark
              ? 'shrink-0 border-b border-white/10 p-3'
              : 'shrink-0 border-b border-slate-100 p-3'
          }
        >
          <div className="flex gap-2">
            <label
              className={
                dark
                  ? 'flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3'
                  : 'flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3'
              }
            >
              <svg
                viewBox="0 0 24 24"
                aria-hidden="true"
                className={dark ? 'size-4 shrink-0 text-white/30' : 'size-4 shrink-0 text-slate-400'}
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-4-4" />
              </svg>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Find a workflow…"
                className={
                  dark
                    ? 'h-10 min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-white/25'
                    : 'h-10 min-w-0 flex-1 bg-transparent text-sm text-slate-700 outline-none placeholder:text-slate-400'
                }
              />
            </label>

            <button
              type="button"
              onClick={() => void loadWorkflows(false)}
              disabled={refreshing}
              title="Refresh workflows"
              aria-label="Refresh workflows"
              className={[
                'grid size-10 shrink-0 place-items-center rounded-xl border transition disabled:cursor-wait disabled:opacity-50',
                dark
                  ? 'border-white/15 bg-white/[0.04] text-white/60 hover:bg-white/10 hover:text-white'
                  : 'border-slate-200 bg-white text-slate-500 hover:border-purple-200 hover:text-purple-600'
              ].join(' ')}
            >
              <svg
                viewBox="0 0 24 24"
                aria-hidden="true"
                className={['size-4', refreshing ? 'animate-spin' : ''].join(' ')}
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
        </div>

        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
          {loading ? (
            <div className="grid h-40 place-items-center">
              <span className={dark ? 'size-2.5 animate-pulse rounded-full bg-emerald-400' : 'size-2.5 animate-pulse rounded-full bg-purple-500'} />
            </div>
          ) : visibleWorkflows.length === 0 ? (
            <p className={dark ? 'px-3 py-8 text-center text-sm text-white/35' : 'px-3 py-8 text-center text-sm text-slate-400'}>
              {workflows.length === 0 ? 'No recorded workflows yet.' : 'No workflows match your search.'}
            </p>
          ) : (
            visibleWorkflows.map((workflow) => (
              <WorkflowListItem
                key={workflow.id}
                workflow={workflow}
                selected={workflow.id === selectedWorkflow?.id}
                dark={dark}
                onSelect={() => selectWorkflow(workflow.id)}
              />
            ))
          )}
        </div>
      </aside>

      <main className="min-h-0 overflow-y-auto pr-1">
        {error && (
          <p className={dark ? 'mb-4 rounded-xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-300' : 'mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600'}>
            {error}
          </p>
        )}

        {!loading && workflows.length === 0 ? (
          <div className={dark ? 'grid min-h-80 place-items-center rounded-2xl border border-white/10 bg-[#090909] p-8 text-center' : 'grid min-h-80 place-items-center rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm'}>
            <div>
              <h2 className={dark ? 'text-xl font-black text-white' : 'text-xl font-bold text-slate-800'}>
                Record a workflow first
              </h2>
              <p className={dark ? 'mt-2 text-sm text-white/40' : 'mt-2 text-sm text-slate-500'}>
                Analytics compares approved SOPs from recordings of the same workflow.
              </p>
              <button
                type="button"
                onClick={() => navigate('/sessions')}
                className={dark ? 'mt-5 rounded-xl bg-white px-4 py-2.5 text-xs font-black uppercase tracking-[0.1em] text-black' : 'mt-5 rounded-xl bg-purple-600 px-4 py-2.5 text-sm font-bold text-white'}
              >
                View recorded workflows
              </button>
            </div>
          </div>
        ) : selectedWorkflow ? (
          <div className="space-y-4 pb-10">
            <header
              className={
                dark
                  ? 'flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-white/10 bg-[#090909] px-5 py-4'
                  : 'flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm'
              }
            >
              <div className="min-w-0">
                <p className={dark ? 'font-mono text-[9px] font-bold uppercase tracking-[0.2em] text-emerald-300/70' : 'text-[10px] font-bold uppercase tracking-[0.13em] text-purple-500'}>
                  Workflow comparison
                </p>
                <h2 className={dark ? 'mt-1.5 truncate text-xl font-black text-white' : 'mt-1.5 truncate text-xl font-bold text-slate-800'}>
                  {selectedWorkflow.name}
                </h2>
                <p className={dark ? 'mt-1 text-xs text-white/35' : 'mt-1 text-xs text-slate-500'}>
                  {plural(selectedWorkflow.recording_count, 'recording')} across{' '}
                  {plural(selectedWorkflow.user_count, 'employee')}
                </p>
              </div>
              <button
                type="button"
                onClick={() => navigate(`/workflows/${selectedWorkflow.id}?tab=analytics`)}
                className={dark ? 'rounded-xl border border-white/12 bg-white/[0.04] px-4 py-2.5 font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-white/50 transition hover:border-emerald-400/30 hover:text-emerald-200' : 'rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-xs font-bold text-slate-500 transition hover:border-purple-200 hover:text-purple-600'}
              >
                Open workflow
              </button>
            </header>

            <Suspense
              fallback={
                <div className="grid min-h-72 place-items-center">
                  <span className={dark ? 'size-2.5 animate-pulse rounded-full bg-emerald-400' : 'size-2.5 animate-pulse rounded-full bg-purple-500'} />
                </div>
              }
            >
              <WorkflowAnalyticsPanel workflowId={selectedWorkflow.id} dark={dark} />
            </Suspense>
          </div>
        ) : (
          <div className="grid min-h-72 place-items-center">
            <span className={dark ? 'size-2.5 animate-pulse rounded-full bg-emerald-400' : 'size-2.5 animate-pulse rounded-full bg-purple-500'} />
          </div>
        )}
      </main>
    </section>
  )
}
