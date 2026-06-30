export interface DashboardMetric {
  label: string
  value: string
  detail: string
  accent?: string
}

interface StatCardProps {
  metric: DashboardMetric
}

export function StatCard({ metric }: StatCardProps) {
  return (
    <article className="overview-stat-card">
      <div className="overview-stat-topline" />

      <div className="overview-stat-body">
        <p className="overview-stat-label">{metric.label}</p>

        <div className="overview-stat-content">
          <strong className="overview-stat-value">{metric.value}</strong>

          <span className="overview-stat-detail">
            {metric.accent && <span className="overview-stat-accent">{metric.accent}</span>}
            {metric.detail}
          </span>
        </div>
      </div>
    </article>
  )
}