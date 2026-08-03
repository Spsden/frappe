import { useEffect, useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts'
import type {
  AnalyticsRetryTarget,
  AnalyticsRunStatus,
  BackendAnalyticsEligibleRecording,
  BackendAnalyticsRun,
  BackendAnalyticsRunInput
} from '../../../shared/recording'

const activeStatuses = new Set<AnalyticsRunStatus>([
  'queued',
  'embedding',
  'aligning',
  'calculating',
  'summarizing'
])

const stageCopy: Record<AnalyticsRunStatus, { label: string; detail: string }> = {
  queued: {
    label: 'Waiting for the worker',
    detail: 'The approved SOP versions are locked in and ready to compare.'
  },
  embedding: {
    label: 'Reading step meaning',
    detail: 'Equivalent steps are being recognised even when their wording differs.'
  },
  aligning: {
    label: 'Lining up the paths',
    detail: 'Shared, optional and path-specific steps are being mapped in order.'
  },
  calculating: {
    label: 'Measuring the difference',
    detail: 'Completion time and fastest-versus-average comparisons are being calculated.'
  },
  summarizing: {
    label: 'Writing the executive brief',
    detail: 'The finished metrics are being turned into three plain-English sentences.'
  },
  completed: { label: 'Analysis ready', detail: 'The comparison is complete.' },
  summary_failed: {
    label: 'Charts ready, summary paused',
    detail: 'The deterministic comparison is safe; only the executive summary needs a retry.'
  },
  failed: {
    label: 'Analysis paused',
    detail: 'The run can be retried with the same locked SOP versions.'
  }
}

const chartColours = ['#34d399', '#38bdf8', '#fbbf24', '#a78bfa', '#fb7185', '#2dd4bf']

interface WorkflowAnalyticsPanelProps {
  workflowId: string
  dark: boolean
}

function formatDuration(milliseconds: number) {
  const seconds = Math.max(0, milliseconds) / 1000
  if (seconds < 60) return `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)}s`
  const minutes = Math.floor(seconds / 60)
  const remainder = Math.round(seconds % 60)
  return `${minutes}m ${remainder}s`
}

function recordingLabel(recording: BackendAnalyticsEligibleRecording) {
  return recording.reference?.trim() || 'Unlabelled recording'
}

function inputLabel(input: BackendAnalyticsRunInput) {
  return input.recording_reference?.trim() || 'Unlabelled recording'
}

function savedRunLabel(run: BackendAnalyticsRun) {
  const references = run.inputs.map(inputLabel)
  const visible = references.slice(0, 2).join(', ') || `${run.input_count} recordings`
  const remainder = references.length > 2 ? ` +${references.length - 2}` : ''
  return `Version ${run.version} · ${visible}${remainder} · ${run.status.replaceAll('_', ' ')}`
}

function Card({
  children,
  dark,
  className = ''
}: {
  children: React.ReactNode
  dark: boolean
  className?: string
}) {
  return (
    <section
      className={[
        'rounded-2xl border',
        dark ? 'border-white/10 bg-[#0b0b0b]' : 'border-slate-200 bg-white shadow-sm',
        className
      ].join(' ')}
    >
      {children}
    </section>
  )
}

function ProcessingCard({ run, dark }: { run: BackendAnalyticsRun; dark: boolean }) {
  const copy = stageCopy[run.status]
  return (
    <Card dark={dark} className="grid min-h-72 place-items-center p-10 text-center">
      <div className="max-w-lg">
        <span className="relative mx-auto grid size-20 place-items-center">
          <span className={dark ? 'absolute inset-0 animate-ping rounded-full border border-emerald-400/20' : 'absolute inset-0 animate-ping rounded-full border border-purple-400/25'} />
          <span className={dark ? 'absolute inset-3 animate-pulse rounded-full border border-emerald-300/35 bg-emerald-400/5' : 'absolute inset-3 animate-pulse rounded-full border border-purple-300 bg-purple-50'} />
          <span className={dark ? 'size-2.5 rounded-full bg-emerald-300 shadow-[0_0_18px_rgba(52,211,153,0.8)]' : 'size-2.5 rounded-full bg-purple-500 shadow-[0_0_16px_rgba(168,85,247,0.5)]'} />
        </span>
        <p className={dark ? 'mt-6 font-mono text-[9px] font-bold uppercase tracking-[0.22em] text-emerald-300' : 'mt-6 text-xs font-bold uppercase tracking-[0.14em] text-purple-600'}>
          Version {run.version} · {run.status.replaceAll('_', ' ')}
        </p>
        <h2 className={dark ? 'mt-3 text-2xl font-black text-white' : 'mt-3 text-2xl font-bold text-slate-800'}>
          {copy.label}
        </h2>
        <p className={dark ? 'mt-3 text-sm leading-6 text-white/45' : 'mt-3 text-sm leading-6 text-slate-500'}>
          {copy.detail}
        </p>
      </div>
    </Card>
  )
}

function RecordingPicker({
  recordings,
  selected,
  onToggle,
  onGenerate,
  generating,
  dark
}: {
  recordings: BackendAnalyticsEligibleRecording[]
  selected: string[]
  onToggle: (recordingId: string) => void
  onGenerate: () => void
  generating: boolean
  dark: boolean
}) {
  const [query, setQuery] = useState('')
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return recordings
    return recordings.filter((recording) =>
      [recording.reference, recording.recorded_by_email, recording.sop_title]
        .filter(Boolean)
        .some((value) => value?.toLowerCase().includes(needle))
    )
  }, [query, recordings])

  return (
    <Card dark={dark}>
      <div className={dark ? 'border-b border-white/10 p-5' : 'border-b border-slate-100 p-5'}>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className={dark ? 'font-mono text-[9px] font-bold uppercase tracking-[0.2em] text-white/35' : 'text-xs font-bold uppercase tracking-[0.12em] text-slate-400'}>
              New comparison
            </p>
            <h2 className={dark ? 'mt-2 text-xl font-black text-white' : 'mt-2 text-xl font-bold text-slate-800'}>
              Choose 2–5 approved recordings
            </h2>
            <p className={dark ? 'mt-1 text-xs text-white/40' : 'mt-1 text-xs text-slate-500'}>
              Each selection uses its latest approved SOP. Draft regenerations are ignored.
            </p>
          </div>
          <button
            type="button"
            onClick={onGenerate}
            disabled={selected.length < 2 || generating}
            className={[
              'rounded-xl px-5 py-3 text-xs font-black uppercase tracking-[0.12em] transition disabled:cursor-not-allowed disabled:opacity-35',
              dark
                ? 'bg-white text-black hover:bg-emerald-200'
                : 'bg-purple-600 text-white shadow-sm hover:bg-purple-500'
            ].join(' ')}
          >
            {generating ? 'Queuing…' : `Generate analytics${selected.length ? ` · ${selected.length}` : ''}`}
          </button>
        </div>
        {recordings.length > 5 && (
          <label className={dark ? 'mt-4 flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3' : 'mt-4 flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3'}>
            <svg viewBox="0 0 24 24" aria-hidden="true" className={dark ? 'size-4 text-white/35' : 'size-4 text-slate-400'} fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-4-4" />
            </svg>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search reference, employee or SOP…"
              className={dark ? 'min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-white/25' : 'min-w-0 flex-1 bg-transparent text-sm text-slate-700 outline-none placeholder:text-slate-400'}
            />
          </label>
        )}
      </div>

      <div className="grid gap-2 p-3 md:grid-cols-2">
        {filtered.map((recording) => {
          const checked = selected.includes(recording.recording_id)
          const disabled = !checked && selected.length >= 5
          return (
            <button
              type="button"
              key={recording.recording_id}
              disabled={disabled}
              onClick={() => onToggle(recording.recording_id)}
              className={[
                'flex items-center gap-3 rounded-xl border p-4 text-left transition disabled:cursor-not-allowed disabled:opacity-35',
                checked
                  ? dark
                    ? 'border-emerald-400/45 bg-emerald-400/10'
                    : 'border-purple-300 bg-purple-50'
                  : dark
                    ? 'border-white/8 bg-white/[0.02] hover:border-white/20'
                    : 'border-slate-200 hover:border-purple-200 hover:bg-slate-50'
              ].join(' ')}
            >
              <span className={[
                'grid size-5 shrink-0 place-items-center rounded-md border text-[11px] font-black',
                checked
                  ? dark
                    ? 'border-emerald-300 bg-emerald-300 text-black'
                    : 'border-purple-500 bg-purple-500 text-white'
                  : dark
                    ? 'border-white/20 text-transparent'
                    : 'border-slate-300 text-transparent'
              ].join(' ')}>
                ✓
              </span>
              <span className="min-w-0 flex-1">
                <span className={dark ? 'block truncate text-sm font-black text-white' : 'block truncate text-sm font-bold text-slate-800'}>
                  {recordingLabel(recording)}
                </span>
                <span className={dark ? 'mt-1 block truncate text-[11px] text-white/35' : 'mt-1 block truncate text-[11px] text-slate-500'}>
                  {recording.recorded_by_email || 'Recorder unavailable'}
                </span>
                <span className={dark ? 'mt-1 block truncate font-mono text-[9px] uppercase tracking-[0.08em] text-white/25' : 'mt-1 block truncate text-[10px] font-medium text-slate-400'}>
                  SOP v{recording.sop_version} · {recording.step_count} steps · {formatDuration(recording.duration_ms)}
                </span>
              </span>
            </button>
          )
        })}
        {recordings.length === 0 && (
          <div className="col-span-full p-7 text-center">
            <p className={dark ? 'text-sm font-bold text-white/65' : 'text-sm font-bold text-slate-700'}>
              No recordings are ready for comparison
            </p>
            <p className={dark ? 'mt-2 text-xs leading-5 text-white/35' : 'mt-2 text-xs leading-5 text-slate-500'}>
              Generate and approve an SOP for at least two recordings in this workflow.
            </p>
          </div>
        )}
      </div>
    </Card>
  )
}

function RunInputs({ run, dark }: { run: BackendAnalyticsRun; dark: boolean }) {
  if (run.inputs.length === 0) return null

  return (
    <Card dark={dark}>
      <div className={dark ? 'flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-5 py-4' : 'flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4'}>
        <div>
          <p className={dark ? 'font-mono text-[9px] font-bold uppercase tracking-[0.2em] text-white/35' : 'text-[10px] font-bold uppercase tracking-[0.13em] text-slate-400'}>
            Compared evidence
          </p>
          <p className={dark ? 'mt-1 text-sm font-black text-white' : 'mt-1 text-sm font-bold text-slate-800'}>
            References and SOP versions used in analysis version {run.version}
          </p>
        </div>
        <span className={dark ? 'rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 font-mono text-[8px] uppercase tracking-[0.14em] text-white/35' : 'rounded-full border border-purple-100 bg-purple-50 px-3 py-1.5 text-[10px] font-bold text-purple-600'}>
          Locked snapshot
        </span>
      </div>

      <div className="grid gap-2 p-3 sm:grid-cols-2 xl:grid-cols-3">
        {run.inputs.map((input) => (
          <div
            key={input.recording_id}
            className={dark ? 'flex min-w-0 gap-3 rounded-xl border border-white/8 bg-white/[0.02] p-4' : 'flex min-w-0 gap-3 rounded-xl border border-slate-200 bg-slate-50/70 p-4'}
          >
            <span className={dark ? 'grid size-7 shrink-0 place-items-center rounded-full bg-emerald-400/10 font-mono text-[10px] font-black text-emerald-300' : 'grid size-7 shrink-0 place-items-center rounded-full bg-purple-100 text-[11px] font-black text-purple-600'}>
              {input.position}
            </span>
            <div className="min-w-0">
              <p className={dark ? 'truncate text-sm font-black text-white' : 'truncate text-sm font-bold text-slate-800'} title={inputLabel(input)}>
                {inputLabel(input)}
              </p>
              <p className={dark ? 'mt-1 truncate text-[11px] text-white/35' : 'mt-1 truncate text-[11px] text-slate-500'} title={input.recorded_by_email ?? undefined}>
                {input.recorded_by_email || 'Recorder unavailable'}
              </p>
              <p className={dark ? 'mt-2 font-mono text-[9px] uppercase tracking-[0.1em] text-white/25' : 'mt-2 text-[10px] font-semibold text-slate-400'}>
                SOP v{input.sop_version} · {formatDuration(input.duration_ms)}
              </p>
            </div>
          </div>
        ))}
      </div>
    </Card>
  )
}

function Results({ run, dark }: { run: BackendAnalyticsRun; dark: boolean }) {
  const result = run.result
  if (!result) return null
  const tooltipStyle = dark
    ? { background: '#111', border: '1px solid rgba(255,255,255,.14)', borderRadius: 12 }
    : { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12 }
  const textColour = dark ? '#8d8d8d' : '#64748b'
  const gridColour = dark ? 'rgba(255,255,255,.08)' : '#e2e8f0'
  const rankingData = result.completion_ranking.map((item) => ({
    name: item.label,
    seconds: Number((item.total_duration_ms / 1000).toFixed(1))
  }))
  const comparisonData = [...result.fastest_vs_average]
    .sort((left, right) => {
      const leftDifference = Math.abs((left.fastest_duration_ms ?? 0) - left.average_duration_ms)
      const rightDifference = Math.abs((right.fastest_duration_ms ?? 0) - right.average_duration_ms)
      return rightDifference - leftDifference
    })
    .slice(0, 12)
    .map((item) => ({
      name: item.label,
      average: Number((item.average_duration_ms / 1000).toFixed(1)),
      fastest: item.fastest_duration_ms === null
        ? null
        : Number((item.fastest_duration_ms / 1000).toFixed(1))
    }))
  const allGroups = Array.from(
    new Map(
      result.path_timelines.flatMap((path) =>
        path.steps.map((step) => [step.group_id, step.label] as const)
      )
    )
  )
  const timelineData = result.path_timelines.map((path) => {
    const row: Record<string, string | number> = { name: path.label }
    for (const step of path.steps) row[step.group_id] = step.duration_ms / 1000
    row.unallocated = path.unallocated_duration_ms / 1000
    return row
  })

  return (
    <div className="space-y-4">
      {run.executive_summary && (
        <Card dark={dark} className={dark ? 'border-emerald-400/20 p-6' : 'border-purple-200 p-6'}>
          <p className={dark ? 'font-mono text-[9px] font-bold uppercase tracking-[0.2em] text-emerald-300' : 'text-xs font-bold uppercase tracking-[0.12em] text-purple-600'}>
            Executive insight · Version {run.version}
          </p>
          <div className="mt-4 grid gap-3 lg:grid-cols-3">
            {run.executive_summary.map((sentence, index) => (
              <p key={sentence} className={dark ? 'border-l border-white/15 pl-4 text-sm leading-6 text-white/65' : 'border-l border-slate-200 pl-4 text-sm leading-6 text-slate-600'}>
                <span className={dark ? 'mr-2 font-mono text-[10px] text-emerald-300' : 'mr-2 text-xs font-bold text-purple-500'}>0{index + 1}</span>
                {sentence}
              </p>
            ))}
          </div>
        </Card>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ['Compared', `${result.overview.recording_count} recordings`],
          ['Observed paths', result.overview.distinct_path_count],
          ['Fastest completion', formatDuration(result.overview.fastest_duration_ms)],
          ['Potential time saved', formatDuration(result.overview.potential_time_saved_ms)]
        ].map(([label, value]) => (
          <Card key={label} dark={dark} className="p-5">
            <p className={dark ? 'font-mono text-[9px] font-bold uppercase tracking-[0.18em] text-white/35' : 'text-xs font-bold uppercase tracking-[0.1em] text-slate-400'}>{label}</p>
            <p className={dark ? 'mt-2 text-xl font-black text-white' : 'mt-2 text-xl font-bold text-slate-800'}>{value}</p>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card dark={dark} className="min-w-0 p-5">
          <h3 className={dark ? 'text-base font-black text-white' : 'text-base font-bold text-slate-800'}>Completion-time ranking</h3>
          <p className={dark ? 'mt-1 text-xs text-white/35' : 'mt-1 text-xs text-slate-500'}>Total recorded duration; shortest approved path first.</p>
          <div className="mt-5 h-64 min-w-0">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rankingData} layout="vertical" margin={{ left: 10, right: 22 }}>
                <CartesianGrid stroke={gridColour} horizontal={false} />
                <XAxis type="number" unit="s" tick={{ fill: textColour, fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="name" width={100} tick={{ fill: textColour, fontSize: 10 }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={tooltipStyle} formatter={(value) => [`${value}s`, 'Duration']} />
                <Bar dataKey="seconds" fill={dark ? '#34d399' : '#8b5cf6'} radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card dark={dark} className="min-w-0 p-5">
          <h3 className={dark ? 'text-base font-black text-white' : 'text-base font-bold text-slate-800'}>Fastest path vs average</h3>
          <p className={dark ? 'mt-1 text-xs text-white/35' : 'mt-1 text-xs text-slate-500'}>Up to 12 steps with the largest timing difference.</p>
          <div className="mt-5 h-64 min-w-0">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={comparisonData} margin={{ left: 0, right: 12 }}>
                <CartesianGrid stroke={gridColour} vertical={false} />
                <XAxis dataKey="name" tick={{ fill: textColour, fontSize: 9 }} axisLine={false} tickLine={false} interval={0} angle={-18} textAnchor="end" height={55} />
                <YAxis unit="s" tick={{ fill: textColour, fontSize: 10 }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={tooltipStyle} formatter={(value) => [`${value}s`]} />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                <Bar dataKey="fastest" name="Fastest path" fill={dark ? '#34d399' : '#8b5cf6'} radius={[5, 5, 0, 0]} />
                <Bar dataKey="average" name="Selected average" fill={dark ? '#38bdf8' : '#38bdf8'} radius={[5, 5, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <Card dark={dark} className="min-w-0 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className={dark ? 'text-base font-black text-white' : 'text-base font-bold text-slate-800'}>Path comparison timeline</h3>
            <p className={dark ? 'mt-1 text-xs text-white/35' : 'mt-1 text-xs text-slate-500'}>Aligned SOP steps in execution order. Grey time was recorded outside timed SOP steps.</p>
          </div>
          <div className={dark ? 'flex gap-3 font-mono text-[8px] uppercase tracking-[0.1em] text-white/35' : 'flex gap-3 text-[10px] font-bold uppercase text-slate-400'}>
            <span>{result.overview.shared_step_count} shared</span>
            <span>{result.overview.optional_step_count} optional</span>
            <span>{result.overview.path_specific_step_count} path-specific</span>
          </div>
        </div>
        <div className="mt-5 h-72 min-w-0">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={timelineData} layout="vertical" margin={{ left: 16, right: 24 }}>
              <CartesianGrid stroke={gridColour} horizontal={false} />
              <XAxis type="number" unit="s" tick={{ fill: textColour, fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="name" width={105} tick={{ fill: textColour, fontSize: 10 }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={tooltipStyle} formatter={(value, name) => [`${Number(value).toFixed(1)}s`, name]} />
              {allGroups.map(([groupId, label], index) => (
                <Bar key={groupId} dataKey={groupId} name={label} stackId="path" fill={chartColours[index % chartColours.length]} />
              ))}
              <Bar dataKey="unallocated" name="Unallocated recorded time" stackId="path" fill={dark ? '#333' : '#cbd5e1'} radius={[0, 5, 5, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className={dark ? 'mt-3 border-t border-white/10 pt-3' : 'mt-3 border-t border-slate-100 pt-3'}>
          {result.alignment_notes.map((note) => (
            <p key={note} className={dark ? 'mt-1 text-[11px] leading-5 text-white/30' : 'mt-1 text-[11px] leading-5 text-slate-400'}>· {note}</p>
          ))}
        </div>
      </Card>
    </div>
  )
}

export function WorkflowAnalyticsPanel({ workflowId, dark }: WorkflowAnalyticsPanelProps) {
  const [eligible, setEligible] = useState<BackendAnalyticsEligibleRecording[]>([])
  const [runs, setRuns] = useState<BackendAnalyticsRun[]>([])
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [currentRun, setCurrentRun] = useState<BackendAnalyticsRun | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    void Promise.all([
      window.api.recording.listAnalyticsEligibleRecordings(workflowId),
      window.api.recording.listAnalyticsRuns(workflowId)
    ])
      .then(([nextEligible, nextRuns]) => {
        if (!active) return
        setEligible(nextEligible)
        setRuns(nextRuns)
        setCurrentRun(nextRuns[0] ?? null)
      })
      .catch((caught) => {
        if (active) setError(caught instanceof Error ? caught.message : 'Could not load analytics.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => { active = false }
  }, [workflowId])

  useEffect(() => {
    if (!currentRun || !activeStatuses.has(currentRun.status)) return
    let active = true
    const timer = window.setInterval(() => {
      void window.api.recording.getAnalyticsRun(currentRun.id)
        .then((next) => {
          if (!active) return
          setCurrentRun(next)
          setRuns((existing) => [next, ...existing.filter((run) => run.id !== next.id)])
        })
        .catch((caught) => {
          if (active) setError(caught instanceof Error ? caught.message : 'Could not refresh analytics.')
        })
    }, 3_000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [currentRun?.id, currentRun?.status])

  const toggleRecording = (recordingId: string) => {
    setSelectedIds((current) => current.includes(recordingId)
      ? current.filter((id) => id !== recordingId)
      : current.length < 5 ? [...current, recordingId] : current)
  }

  const generate = async () => {
    setSubmitting(true)
    setError(null)
    try {
      const run = await window.api.recording.createAnalyticsRun(
        workflowId,
        'selected_comparison',
        selectedIds
      )
      setCurrentRun(run)
      setRuns((current) => [run, ...current])
      setSelectedIds([])
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not start analytics.')
    } finally {
      setSubmitting(false)
    }
  }

  const retry = async (target: AnalyticsRetryTarget) => {
    if (!currentRun) return
    setRetrying(true)
    setError(null)
    try {
      const run = await window.api.recording.retryAnalyticsRun(currentRun.id, target)
      setCurrentRun(run)
      setRuns((current) => [run, ...current.filter((item) => item.id !== run.id)])
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not retry analytics.')
    } finally {
      setRetrying(false)
    }
  }

  if (loading) {
    return <div className="grid min-h-72 place-items-center"><span className={dark ? 'size-2.5 animate-pulse rounded-full bg-emerald-400' : 'size-2.5 animate-pulse rounded-full bg-purple-500'} /></div>
  }

  return (
    <div className="space-y-4">
      {error && (
        <p className={dark ? 'rounded-xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-300' : 'rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600'}>{error}</p>
      )}

      <RecordingPicker
        recordings={eligible}
        selected={selectedIds}
        onToggle={toggleRecording}
        onGenerate={() => void generate()}
        generating={submitting}
        dark={dark}
      />

      {runs.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <label className={dark ? 'flex items-center gap-3 text-xs text-white/40' : 'flex items-center gap-3 text-xs text-slate-500'}>
            Saved analysis
            <select
              value={currentRun?.id ?? ''}
              onChange={(event) => setCurrentRun(runs.find((run) => run.id === event.target.value) ?? null)}
              className={dark ? 'rounded-xl border border-white/12 bg-[#0b0b0b] px-3 py-2 text-xs font-bold text-white outline-none' : 'rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 outline-none'}
            >
              {runs.map((run) => (
                <option key={run.id} value={run.id}>{savedRunLabel(run)}</option>
              ))}
            </select>
          </label>
          {currentRun && (
            <p className={dark ? 'font-mono text-[9px] uppercase tracking-[0.12em] text-white/30' : 'text-[10px] font-bold uppercase tracking-[0.08em] text-slate-400'}>
              {currentRun.input_count} approved SOPs · {currentRun.algorithm_version}
            </p>
          )}
        </div>
      )}

      {currentRun && <RunInputs run={currentRun} dark={dark} />}

      {currentRun && activeStatuses.has(currentRun.status) && (
        <ProcessingCard run={currentRun} dark={dark} />
      )}

      {currentRun?.status === 'failed' && (
        <Card dark={dark} className="p-6">
          <h3 className={dark ? 'text-lg font-black text-white' : 'text-lg font-bold text-slate-800'}>{stageCopy.failed.label}</h3>
          <p className={dark ? 'mt-2 text-sm text-red-300/80' : 'mt-2 text-sm text-red-600'}>{currentRun.error_message || stageCopy.failed.detail}</p>
          <button type="button" disabled={retrying} onClick={() => void retry('full_run')} className={dark ? 'mt-5 rounded-xl bg-white px-4 py-2.5 text-xs font-black uppercase tracking-[0.1em] text-black disabled:opacity-40' : 'mt-5 rounded-xl bg-purple-600 px-4 py-2.5 text-xs font-bold text-white disabled:opacity-40'}>
            {retrying ? 'Retrying…' : 'Retry analysis'}
          </button>
        </Card>
      )}

      {currentRun?.status === 'summary_failed' && (
        <div className={dark ? 'flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-400/20 bg-amber-400/8 px-4 py-3' : 'flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3'}>
          <p className={dark ? 'text-xs text-amber-200/80' : 'text-xs text-amber-700'}>{currentRun.error_message || stageCopy.summary_failed.detail}</p>
          <button type="button" disabled={retrying} onClick={() => void retry('summary')} className={dark ? 'text-xs font-black uppercase tracking-[0.1em] text-amber-200 disabled:opacity-40' : 'text-xs font-bold text-amber-800 disabled:opacity-40'}>{retrying ? 'Retrying…' : 'Retry summary'}</button>
        </div>
      )}

      {currentRun && (currentRun.status === 'completed' || currentRun.status === 'summary_failed') && (
        <Results run={currentRun} dark={dark} />
      )}
    </div>
  )
}
