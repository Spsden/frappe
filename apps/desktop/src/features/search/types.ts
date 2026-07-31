export type SearchHitKind = 'sop' | 'session'

export interface SearchHit {
  id: string
  kind: SearchHitKind
  title: string
  subtitle: string | null
  status: string | null
  /** For SOP hits, the session the SOP was generated from — the detail page is
   * keyed by session, so routing needs it. Null for sessions. */
  sourceSessionId: string | null
  matchedField: string
  createdAt: string | null
}

export interface SearchRouteTarget {
  kind: SearchHitKind
  id: string
  sourceSessionId: string | null
}

export function hitRoute(target: SearchRouteTarget): string {
  if (target.kind === 'sop') {
    return target.sourceSessionId ? `/sessions/${target.sourceSessionId}/sop` : '/sop-library'
  }
  return `/sessions/${target.id}`
}
