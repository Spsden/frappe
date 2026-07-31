import { create } from 'zustand'
import type { SearchHit, SearchHitKind } from './types'

const STORAGE_KEY = 'worktrace:recent-items'
const MAX_RECENTS = 8

export interface RecentItem {
  id: string
  kind: SearchHitKind
  title: string
  subtitle: string | null
  sourceSessionId: string | null
  openedAt: number
}

interface RecentItemsState {
  items: RecentItem[]
  loaded: boolean
  load: () => void
  add: (hit: SearchHit) => void
  remove: (id: string, kind: SearchHitKind) => void
  clear: () => void
}

function readStorage(): RecentItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? (parsed as RecentItem[]).slice(0, MAX_RECENTS) : []
  } catch {
    return []
  }
}

function writeStorage(items: RecentItem[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, MAX_RECENTS)))
  } catch {
    // storage unavailable (private mode / disabled) — keep in-memory only
  }
}

export const useRecentItems = create<RecentItemsState>((set, get) => ({
  items: [],
  loaded: false,

  load() {
    if (get().loaded) return
    set({ items: readStorage(), loaded: true })
  },

  add(hit) {
    const without = get().items.filter(
      (item) => !(item.id === hit.id && item.kind === hit.kind)
    )
    const next: RecentItem[] = [
      {
        id: hit.id,
        kind: hit.kind,
        title: hit.title,
        subtitle: hit.subtitle,
        sourceSessionId: hit.sourceSessionId,
        openedAt: Date.now()
      },
      ...without
    ].slice(0, MAX_RECENTS)
    writeStorage(next)
    set({ items: next, loaded: true })
  },

  remove(id, kind) {
    const next = get().items.filter((item) => !(item.id === id && item.kind === kind))
    writeStorage(next)
    set({ items: next })
  },

  clear() {
    writeStorage([])
    set({ items: [] })
  }
}))
