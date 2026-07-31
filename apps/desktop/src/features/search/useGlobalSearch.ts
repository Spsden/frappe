import { useEffect, useMemo, useRef, useState } from 'react'
import Fuse from 'fuse.js'
import type {
  BackendSOP,
  RecordedSessionSummary
} from '../../../shared/recording'
import type { SearchHit } from './types'
import { useSearchIndex } from './useSearchIndex'

interface Indexable {
  kind: 'sop' | 'session'
  /** Identity for de-duplication: SOP id, or backend session id for sessions. */
  id: string
  title: string
  body: string
  /** Backend WorkflowSessionRecord.id — used to resolve the route id. */
  backendSessionId: string | null
  status: string | null
  createdAt: string | null
}

const CLIENT_LIMIT = 20
const BACKEND_DEBOUNCE_MS = 220

function buildFuse(sops: BackendSOP[], sessions: RecordedSessionSummary[]): Fuse<Indexable> {
  const items: Indexable[] = [
    ...sops.map((sop) => ({
      kind: 'sop' as const,
      id: sop.id,
      title: sop.title,
      body: [
        sop.document ?? '',
        ...sop.steps.map((step) =>
          [step.title, step.instruction, step.warning ?? ''].join(' ')
        )
      ].join('\n'),
      backendSessionId: sop.source_session_id,
      status: sop.status,
      createdAt: sop.created_at
    })),
    ...sessions
      .filter((session) => Boolean(session.remoteSessionId))
      .map((session) => ({
        kind: 'session' as const,
        id: session.remoteSessionId as string,
        title: session.name,
        body: '',
        backendSessionId: session.remoteSessionId,
        status: session.remoteStatus ?? session.localStatus,
        createdAt: session.startedAt
      }))
  ]

  return new Fuse<Indexable>(items, {
    keys: [
      { name: 'title', weight: 0.7 },
      { name: 'body', weight: 0.3 }
    ],
    threshold: 0.4,
    ignoreLocation: true,
    includeScore: true,
    minMatchCharLength: 1
  })
}

/**
 * Build a lookup from the backend session id (WorkflowSessionRecord.id, which is
 * what /search returns and what listSops carries as source_session_id) to the
 * local manifest id (RecordedSessionSummary.id). The detail pages resolve their
 * route param against the manifest id, so every hit must be translated to it
 * before it can be routed to. Hits whose session has no local manifest (e.g.
 * recorded on another device) have no entry and are dropped — the detail pages
 * can't open them anyway.
 */
function buildRouteResolver(
  sessions: RecordedSessionSummary[]
): Map<string, string> {
  const map = new Map<string, string>()
  for (const session of sessions) {
    if (session.remoteSessionId) {
      map.set(session.remoteSessionId, session.id)
    }
  }
  return map
}

function hitKey(hit: SearchHit): string {
  return `${hit.kind}:${hit.id}`
}

function byRecency(a: SearchHit, b: SearchHit): number {
  const timeA = a.createdAt ? Date.parse(a.createdAt) : 0
  const timeB = b.createdAt ? Date.parse(b.createdAt) : 0
  return timeB - timeA
}

function mergeHits(client: SearchHit[], backend: SearchHit[]): SearchHit[] {
  const merged = new Map<string, SearchHit>()
  for (const hit of client) merged.set(hitKey(hit), hit)
  // Backend hits win on collisions — they carry the authoritative matched_field.
  for (const hit of backend) merged.set(hitKey(hit), hit)
  return [...merged.values()].sort(byRecency)
}

export interface GlobalSearchResult {
  sops: SearchHit[]
  sessions: SearchHit[]
  isLoadingIndex: boolean
  isSearching: boolean
}

/**
 * Hybrid global search: an instant client-side fuzzy pass over cached titles,
 * merged with a debounced backend /search call that covers SOP documents, step
 * text, and workflow names. Results are de-duplicated by entity and grouped by
 * kind for the palette. Every surfaced hit is resolvable to a route id the
 * detail pages can actually open.
 */
export function useGlobalSearch(query: string): GlobalSearchResult {
  const { sops, sessions, loaded, loading, load } = useSearchIndex()
  const [clientHits, setClientHits] = useState<SearchHit[]>([])
  const [backendHits, setBackendHits] = useState<SearchHit[]>([])
  const [isSearching, setIsSearching] = useState(false)

  const fuse = useMemo(() => buildFuse(sops, sessions), [sops, sessions])
  const routeResolver = useMemo(() => buildRouteResolver(sessions), [sessions])

  // The backend pass reads the latest resolver when its response arrives
  // (which may be after the index finishes loading), without re-triggering the
  // debounced call on every index update.
  const routeResolverRef = useRef(routeResolver)
  useEffect(() => {
    routeResolverRef.current = routeResolver
  }, [routeResolver])

  useEffect(() => {
    void load()
  }, [load])

  function resolveRouteId(backendSessionId: string | null): string | null {
    if (!backendSessionId) return null
    return routeResolver.get(backendSessionId) ?? null
  }

  // Instant client-side pass.
  useEffect(() => {
    const trimmed = query.trim()
    if (!trimmed || !loaded) {
      setClientHits([])
      return
    }
    const lowered = trimmed.toLowerCase()
    const results = fuse.search(trimmed, { limit: CLIENT_LIMIT })
    const hits: SearchHit[] = []
    for (const { item } of results) {
      const routeId = resolveRouteId(item.backendSessionId)
      if (!routeId) continue
      hits.push({
        id: item.id,
        kind: item.kind,
        title: item.title,
        subtitle: item.status,
        status: item.status,
        routeId,
        matchedField:
          item.kind === 'session'
            ? 'workflow_name'
            : item.title.toLowerCase().includes(lowered)
              ? 'title'
              : 'content',
        createdAt: item.createdAt
      })
    }
    setClientHits(hits)
  }, [query, fuse, loaded, routeResolver])

  // Debounced backend "deep" pass.
  useEffect(() => {
    const trimmed = query.trim()
    if (!trimmed) {
      setBackendHits([])
      setIsSearching(false)
      return
    }
    setIsSearching(true)
    let cancelled = false
    const handle = window.setTimeout(() => {
      window.api.recording
        .search(trimmed)
        .then((response) => {
          if (cancelled) return
          const resolver = routeResolverRef.current
          const hits: SearchHit[] = []
          for (const result of response.results) {
            const backendSessionId =
              result.kind === 'session' ? result.id : result.source_session_id
            const routeId = backendSessionId ? resolver.get(backendSessionId) : null
            if (!routeId) continue
            hits.push({
              id: result.id,
              kind: result.kind,
              title: result.title,
              subtitle: result.subtitle,
              status: result.status,
              routeId,
              matchedField: result.matched_field,
              createdAt: result.created_at
            })
          }
          setBackendHits(hits)
        })
        .catch(() => {
          if (!cancelled) setBackendHits([])
        })
        .finally(() => {
          if (!cancelled) setIsSearching(false)
        })
    }, BACKEND_DEBOUNCE_MS)
    return () => {
      cancelled = true
      window.clearTimeout(handle)
    }
  }, [query])

  const merged = useMemo(() => mergeHits(clientHits, backendHits), [clientHits, backendHits])

  return {
    sops: merged.filter((hit) => hit.kind === 'sop'),
    sessions: merged.filter((hit) => hit.kind === 'session'),
    isLoadingIndex: loading,
    isSearching
  }
}
