import { useEffect, useMemo, useState } from 'react'
import Fuse from 'fuse.js'
import type {
  BackendSearchResult,
  BackendSOP,
  RecordedSessionSummary
} from '../../../shared/recording'
import type { SearchHit } from './types'
import { useSearchIndex } from './useSearchIndex'

interface Indexable {
  kind: 'sop' | 'session'
  id: string
  title: string
  body: string
  sourceSessionId: string | null
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
      sourceSessionId: sop.source_session_id,
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
        sourceSessionId: null,
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

function backendToSearchHit(result: BackendSearchResult): SearchHit {
  return {
    id: result.id,
    kind: result.kind,
    title: result.title,
    subtitle: result.subtitle,
    status: result.status,
    sourceSessionId: result.source_session_id,
    matchedField: result.matched_field,
    createdAt: result.created_at
  }
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
 * kind for the palette.
 */
export function useGlobalSearch(query: string): GlobalSearchResult {
  const { sops, sessions, loaded, loading, load } = useSearchIndex()
  const [clientHits, setClientHits] = useState<SearchHit[]>([])
  const [backendHits, setBackendHits] = useState<SearchHit[]>([])
  const [isSearching, setIsSearching] = useState(false)

  const fuse = useMemo(() => buildFuse(sops, sessions), [sops, sessions])

  useEffect(() => {
    void load()
  }, [load])

  // Instant client-side pass.
  useEffect(() => {
    const trimmed = query.trim()
    if (!trimmed || !loaded) {
      setClientHits([])
      return
    }
    const lowered = trimmed.toLowerCase()
    const results = fuse.search(trimmed, { limit: CLIENT_LIMIT })
    setClientHits(
      results.map(({ item }) => ({
        id: item.id,
        kind: item.kind,
        title: item.title,
        subtitle: item.status,
        status: item.status,
        sourceSessionId: item.sourceSessionId,
        matchedField:
          item.kind === 'session'
            ? 'workflow_name'
            : item.title.toLowerCase().includes(lowered)
              ? 'title'
              : 'content',
        createdAt: item.createdAt
      }))
    )
  }, [query, fuse, loaded])

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
          setBackendHits(response.results.map(backendToSearchHit))
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
