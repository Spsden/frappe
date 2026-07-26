import { useEffect, useMemo, useState } from 'react'
import type { BackendDashboardSummary } from '../../shared/recording'
import { RecorderCard } from '../components/RecorderCard'
import { StatCard, type DashboardMetric } from '../components/StatCard'

const emptyMetrics: DashboardMetric[] = [
  { label: 'Workflows recorded', value: '0', detail: 'this month' },
  { label: 'SOPs generated', value: '0', detail: 'approved' },
  { label: 'Active workflows', value: '0', detail: 'recorded groups' },
  { label: 'Avg. completion time', value: '0s', detail: 'No sessions yet' }
]

export function DashboardPage() {
  const [summary, setSummary] = useState<BackendDashboardSummary | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    const loadSummary = async () => {
      setIsLoading(true)
      setError(null)
      try {
        const next = await window.api.recording.getDashboardSummary()
        if (!cancelled) setSummary(next)
      } catch (caught) {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : 'Could not load dashboard.')
          setSummary(null)
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    void loadSummary()
    return () => {
      cancelled = true
    }
  }, [])

  const dashboardMetrics = useMemo(
    () => (summary ? metricsFromSummary(summary) : emptyMetrics),
    [summary]
  )

  return (
    <section className="px-5 py-6 md:px-8">
      <RecorderCard />
      {error && (
        <div className="mb-3 border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
          {error}
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {dashboardMetrics.map((metric) => (
          <StatCard
            key={metric.label}
            metric={isLoading && !summary ? { ...metric, detail: 'Loading' } : metric}
          />
        ))}
      </div>
    </section>
  )
}

function metricsFromSummary(summary: BackendDashboardSummary): DashboardMetric[] {
  return [
    {
      label: 'Workflows recorded',
      value: formatCount(summary.workflows_recorded),
      accent: formatPercent(summary.workflows_recorded_change_percent),
      detail: `${formatCount(summary.workflows_recorded_this_month)} this month`
    },
    {
      label: 'SOPs generated',
      value: formatCount(summary.sops_generated),
      detail: `${formatCount(summary.approved_sops)} approved`
    },
    {
      label: 'Active workflows',
      value: formatCount(summary.active_workflows),
      detail: 'recorded groups'
    },
    {
      label: 'Avg. completion time',
      value: formatDuration(summary.average_completion_ms),
      detail: formatDurationDelta(summary.average_completion_delta_ms)
    }
  ]
}

function formatCount(value: number): string {
  return new Intl.NumberFormat().format(value)
}

function formatPercent(value: number | null): string | undefined {
  if (value === null) return undefined
  return `${value > 0 ? '+' : ''}${value}%`
}

function formatDuration(value: number | null): string {
  if (!value) return '0s'
  const totalSeconds = Math.max(0, Math.round(value / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`
}

function formatDurationDelta(value: number | null): string {
  if (value === null) return 'No prior period'
  if (value === 0) return 'No change'
  return `${formatDuration(Math.abs(value))} ${value > 0 ? 'faster' : 'slower'}`
}
