import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { BackendSOP, BackendSOPStep } from '../../../shared/recording'

export interface SopDraftContent {
  title: string
  document: string
  steps: BackendSOPStep[]
}

interface SopEditorDraft {
  baseRevision: number
  content: SopDraftContent
  past: SopDraftContent[]
  future: SopDraftContent[]
  dirty: boolean
  lastChangeKey: string | null
  lastChangeAt: number
}

interface SopEditorStore {
  drafts: Record<string, SopEditorDraft>
  begin: (sop: BackendSOP) => void
  change: (sopId: string, content: SopDraftContent, historyKey: string) => void
  undo: (sopId: string) => void
  redo: (sopId: string) => void
  markSaved: (sop: BackendSOP) => void
  discard: (sopId: string) => void
}

const HISTORY_LIMIT = 100
const TYPING_BURST_MS = 750

function contentFromSop(sop: BackendSOP): SopDraftContent {
  return {
    title: sop.title,
    document: sop.document ?? '',
    steps: structuredClone(sop.steps)
  }
}

function freshDraft(sop: BackendSOP): SopEditorDraft {
  return {
    baseRevision: sop.revision,
    content: contentFromSop(sop),
    past: [],
    future: [],
    dirty: false,
    lastChangeKey: null,
    lastChangeAt: 0
  }
}

export const useSopEditorStore = create<SopEditorStore>()(
  persist(
    (set, get) => ({
      drafts: {},

      begin(sop) {
        const existing = get().drafts[sop.id]
        if (existing?.dirty || existing?.baseRevision === sop.revision) return
        set((state) => ({
          drafts: { ...state.drafts, [sop.id]: freshDraft(sop) }
        }))
      },

      change(sopId, content, historyKey) {
        const current = get().drafts[sopId]
        if (!current) return
        const now = Date.now()
        const sameBurst =
          current.lastChangeKey === historyKey && now - current.lastChangeAt < TYPING_BURST_MS
        const past = sameBurst
          ? current.past
          : [...current.past, structuredClone(current.content)].slice(-HISTORY_LIMIT)
        set((state) => ({
          drafts: {
            ...state.drafts,
            [sopId]: {
              ...current,
              content: structuredClone(content),
              past,
              future: [],
              dirty: true,
              lastChangeKey: historyKey,
              lastChangeAt: now
            }
          }
        }))
      },

      undo(sopId) {
        const current = get().drafts[sopId]
        const previous = current?.past.at(-1)
        if (!current || !previous) return
        set((state) => ({
          drafts: {
            ...state.drafts,
            [sopId]: {
              ...current,
              content: structuredClone(previous),
              past: current.past.slice(0, -1),
              future: [structuredClone(current.content), ...current.future].slice(0, HISTORY_LIMIT),
              dirty: true,
              lastChangeKey: null,
              lastChangeAt: 0
            }
          }
        }))
      },

      redo(sopId) {
        const current = get().drafts[sopId]
        const next = current?.future[0]
        if (!current || !next) return
        set((state) => ({
          drafts: {
            ...state.drafts,
            [sopId]: {
              ...current,
              content: structuredClone(next),
              past: [...current.past, structuredClone(current.content)].slice(-HISTORY_LIMIT),
              future: current.future.slice(1),
              dirty: true,
              lastChangeKey: null,
              lastChangeAt: 0
            }
          }
        }))
      },

      markSaved(sop) {
        set((state) => ({
          drafts: { ...state.drafts, [sop.id]: freshDraft(sop) }
        }))
      },

      discard(sopId) {
        set((state) => {
          const drafts = { ...state.drafts }
          delete drafts[sopId]
          return { drafts }
        })
      }
    }),
    {
      name: 'worktrace.sop-editor-drafts',
      partialize: (state) => ({ drafts: state.drafts })
    }
  )
)
