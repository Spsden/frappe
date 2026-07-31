import { create } from 'zustand'
import type { BackendSOP, RecordedSessionSummary } from '../../../shared/recording'

interface SearchIndexState {
  sops: BackendSOP[]
  sessions: RecordedSessionSummary[]
  loaded: boolean
  loading: boolean
  error: string | null
  load: () => Promise<void>
}

/**
 * Lazy, in-memory index of the tenant's SOPs plus the locally-recorded
 * sessions. The global search palette uses this for the instant client-side
 * fuzzy pass over titles; the backend /search endpoint handles the "deep"
 * pass (document body, step text) separately. Best-effort: if either source
 * fails to load we keep searching over whatever we have.
 */
export const useSearchIndex = create<SearchIndexState>((set, get) => ({
  sops: [],
  sessions: [],
  loaded: false,
  loading: false,
  error: null,

  async load() {
    if (get().loaded || get().loading) return
    set({ loading: true, error: null })
    try {
      const [sops, sessions] = await Promise.all([
        window.api.recording.listSops().catch(() => [] as BackendSOP[]),
        window.api.recording.listSessions().catch(() => [] as RecordedSessionSummary[])
      ])
      set({ sops, sessions, loaded: true, loading: false })
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : 'Could not load search index.'
      })
    }
  }
}))
