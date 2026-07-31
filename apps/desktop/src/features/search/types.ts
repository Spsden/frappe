export type SearchHitKind = 'sop' | 'session'

export interface SearchHit {
  id: string
  kind: SearchHitKind
  title: string
  subtitle: string | null
  status: string | null
  /**
   * The id the detail-page routes expect in the URL — the local manifest /
   * recording id (RecordedSessionSummary.id), NOT the backend
   * WorkflowSessionRecord.id. The detail pages resolve the route param against
   * the local session list first, so routing on the backend session id would
   * always miss. This is resolved from the backend session id via the local
   * sessions list before a hit is surfaced.
   */
  routeId: string
  matchedField: string
  createdAt: string | null
}

export interface SearchRouteTarget {
  kind: SearchHitKind
  routeId: string
}

export function hitRoute(target: SearchRouteTarget): string {
  return target.kind === 'sop'
    ? `/sessions/${target.routeId}/sop`
    : `/sessions/${target.routeId}`
}
