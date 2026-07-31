import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTheme } from '../features/theme/ThemeContext'
import { useGlobalSearch } from '../features/search/useGlobalSearch'
import { useRecentItems } from '../features/search/useRecentItems'
import type { RecentItem } from '../features/search/useRecentItems'
import { type SearchHit, hitRoute } from '../features/search/types'

const SOP_CAP = 6
const SESSION_CAP = 6

interface PaletteProps {
  open: boolean
  onClose: () => void
}

interface Section {
  label: string
  empty: string
  hits: SearchHit[]
}

function keyOf(hit: SearchHit): string {
  return `${hit.kind}:${hit.id}`
}

function recentToHit(item: RecentItem): SearchHit {
  return {
    id: item.id,
    kind: item.kind,
    title: item.title,
    subtitle: item.subtitle,
    status: null,
    sourceSessionId: item.sourceSessionId,
    matchedField: 'recent',
    createdAt: null
  }
}

function fieldBadge(field: string): string | null {
  if (field === 'title' || field === 'workflow_name' || field === 'recent') {
    return null
  }
  if (field === 'document') return 'document'
  if (field === 'step') return 'step'
  if (field === 'content') return 'content'
  return null
}

export function SearchPalette({ open, onClose }: PaletteProps) {
  const { theme } = useTheme()
  const navigate = useNavigate()
  const { items: recents, load: loadRecents, add: addRecent } = useRecentItems()

  const [query, setQuery] = useState('')
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const { sops, sessions, isLoadingIndex, isSearching } = useGlobalSearch(query)

  useEffect(() => {
    if (open) {
      loadRecents()
      setQuery('')
      setActiveKey(null)
      // Focus on next tick so the input is mounted.
      const id = window.setTimeout(() => inputRef.current?.focus(), 0)
      return () => window.clearTimeout(id)
    }
  }, [open, loadRecents])

  // Close on Escape is handled in onKeyDown; also reset query when dismissed.
  useEffect(() => {
    if (!open) setQuery('')
  }, [open])

  const sections = useMemo<Section[]>(() => {
    const trimmed = query.trim()
    if (!trimmed) {
      return [
        {
          label: 'Recent',
          empty: 'Open a SOP or workflow and it will show up here.',
          hits: recents.map(recentToHit)
        }
      ]
    }
    return [
      {
        label: 'SOPs',
        empty: 'No matching SOPs.',
        hits: sops.slice(0, SOP_CAP)
      },
      {
        label: 'Workflows',
        empty: 'No matching workflows.',
        hits: sessions.slice(0, SESSION_CAP)
      }
    ]
  }, [query, recents, sops, sessions])

  const flatKeys = useMemo(
    () => sections.flatMap((section) => section.hits.map(keyOf)),
    [sections]
  )

  // Keep the active row valid as results change.
  useEffect(() => {
    if (flatKeys.length === 0) {
      setActiveKey(null)
      return
    }
    setActiveKey((current) => (current && flatKeys.includes(current) ? current : flatKeys[0]))
  }, [flatKeys])

  function select(hit: SearchHit) {
    addRecent(hit)
    navigate(hitRoute(hit))
    onClose()
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (flatKeys.length === 0) return
      const currentIndex = activeKey ? flatKeys.indexOf(activeKey) : -1
      const delta = event.key === 'ArrowDown' ? 1 : -1
      const nextIndex =
        currentIndex === -1
          ? event.key === 'ArrowDown'
            ? 0
            : flatKeys.length - 1
          : (currentIndex + delta + flatKeys.length) % flatKeys.length
      setActiveKey(flatKeys[nextIndex])
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      if (!activeKey) return
      const hit = sections.flatMap((section) => section.hits).find(
        (item) => keyOf(item) === activeKey
      )
      if (hit) select(hit)
    }
  }

  if (!open) return null

  const isDark = theme === 'dark'
  const trimmed = query.trim()
  const hasAnyHit = flatKeys.length > 0
  const showEmptyState = trimmed.length > 0 && !hasAnyHit && !isSearching

  return (
    <div
      className={[
        'fixed inset-0 z-50 flex items-start justify-center px-4 pt-[12vh]',
        isDark ? 'bg-black/60' : 'bg-slate-900/30'
      ].join(' ')}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search"
        onClick={(event) => event.stopPropagation()}
        className={[
          'flex w-full max-w-xl flex-col overflow-hidden rounded-2xl border shadow-2xl',
          isDark
            ? 'border-white/10 bg-[#1b1b1b] text-white'
            : 'border-slate-200 bg-white text-slate-900'
        ].join(' ')}
      >
        {/* Input */}

        <div
          className={[
            'flex items-center gap-3 border-b px-4',
            isDark ? 'border-white/10' : 'border-slate-200'
          ].join(' ')}
        >
          <svg
            viewBox="0 0 24 24"
            aria-hidden="true"
            className="size-4 shrink-0"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>

          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search SOPs and workflows…"
            className={[
              'h-12 min-w-0 flex-1 bg-transparent text-sm outline-none',
              isDark
                ? 'text-white placeholder:text-white/40'
                : 'text-slate-900 placeholder:text-slate-400'
            ].join(' ')}
          />

          {isSearching && (
            <span
              className={[
                'size-3.5 shrink-0 animate-spin rounded-full border-2 border-t-transparent',
                isDark ? 'border-white/40' : 'border-slate-400'
              ].join(' ')}
            />
          )}
        </div>

        {/* Results */}

        <div
          className={[
            'max-h-[55vh] overflow-y-auto py-2',
            isDark ? 'scrollbar-dark' : 'scrollbar-light'
          ].join(' ')}
        >
          {isLoadingIndex && !hasAnyHit && trimmed.length > 0 && (
            <p
              className={[
                'px-4 py-6 text-center text-xs',
                isDark ? 'text-white/40' : 'text-slate-400'
              ].join(' ')}
            >
              Loading library…
            </p>
          )}

          {showEmptyState && (
            <p
              className={[
                'px-4 py-6 text-center text-xs',
                isDark ? 'text-white/40' : 'text-slate-400'
              ].join(' ')}
            >
              No matches for “{trimmed}”.
            </p>
          )}

          {hasAnyHit &&
            sections.map((section) => {
              if (section.hits.length === 0) return null
              return (
                <div key={section.label}>
                  <p
                    className={[
                      'px-4 pb-1 pt-2 font-mono text-[9px] font-bold uppercase tracking-[0.18em]',
                      isDark ? 'text-white/35' : 'text-slate-400'
                    ].join(' ')}
                  >
                    {section.label}
                  </p>

                  {section.hits.map((hit) => {
                    const key = keyOf(hit)
                    const active = key === activeKey
                    const badge = fieldBadge(hit.matchedField)
                    return (
                      <button
                        key={key}
                        type="button"
                        onMouseEnter={() => setActiveKey(key)}
                        onClick={() => select(hit)}
                        className={[
                          'flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition',
                          active
                            ? isDark
                              ? 'bg-white/[0.08]'
                              : 'bg-purple-50'
                            : ''
                        ].join(' ')}
                      >
                        <span
                          className={[
                            'grid size-7 shrink-0 place-items-center rounded-lg text-[10px] font-black',
                            hit.kind === 'sop'
                              ? isDark
                                ? 'bg-white/10 text-white/70'
                                : 'bg-purple-100 text-purple-700'
                              : isDark
                                ? 'bg-white/10 text-white/70'
                                : 'bg-pink-100 text-pink-700'
                          ].join(' ')}
                        >
                          {hit.kind === 'sop' ? 'S' : 'W'}
                        </span>

                        <span className="min-w-0 flex-1">
                          <span
                            className={[
                              'block truncate text-xs font-bold',
                              isDark ? 'text-white' : 'text-slate-900'
                            ].join(' ')}
                          >
                            {hit.title}
                          </span>

                          {hit.subtitle && (
                            <span
                              className={[
                                'mt-0.5 block truncate text-[11px]',
                                isDark ? 'text-white/40' : 'text-slate-400'
                              ].join(' ')}
                            >
                              {hit.subtitle}
                            </span>
                          )}
                        </span>

                        {badge && (
                          <span
                            className={[
                              'shrink-0 rounded-md px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wide',
                              isDark
                                ? 'bg-white/10 text-white/50'
                                : 'bg-slate-100 text-slate-500'
                            ].join(' ')}
                          >
                            {badge}
                          </span>
                        )}

                        {active && (
                          <svg
                            viewBox="0 0 24 24"
                            aria-hidden="true"
                            className="size-4 shrink-0"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                          >
                            <path d="m9 18 6-6-6-6" />
                          </svg>
                        )}
                      </button>
                    )
                  })}
                </div>
              )
            })}

          {!trimmed && recents.length === 0 && (
            <p
              className={[
                'px-4 py-6 text-center text-xs',
                isDark ? 'text-white/40' : 'text-slate-400'
              ].join(' ')}
            >
              Search across every SOP and recorded workflow.
            </p>
          )}
        </div>

        {/* Footer */}

        <div
          className={[
            'flex items-center justify-between border-t px-4 py-2 font-mono text-[9px] font-bold uppercase tracking-[0.14em]',
            isDark ? 'border-white/10 text-white/40' : 'border-slate-200 text-slate-400'
          ].join(' ')}
        >
          <span className="flex items-center gap-3">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd>
            <span>navigate</span>
            <Kbd>↵</Kbd>
            <span>open</span>
            <Kbd>esc</Kbd>
            <span>close</span>
          </span>

          <span className={isDark ? 'text-white/30' : 'text-slate-300'}>⌘K</span>
        </div>
      </div>
    </div>
  )
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-current px-1 py-0.5 text-[9px] leading-none opacity-50">
      {children}
    </kbd>
  )
}
