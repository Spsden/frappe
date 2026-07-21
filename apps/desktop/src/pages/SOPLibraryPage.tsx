import { useEffect, useMemo, useState } from 'react'
import type { BackendSOP } from '../../shared/recording'
import { mapWithConcurrency } from '../utils/async'
import { triggerSopPdfExport } from '../utils/sopPdf'

type SopFilter = 'all' | BackendSOP['status']

const filterOptions: Array<{ label: string; value: SopFilter }> = [
  { label: 'All', value: 'all' },
  { label: 'Drafts', value: 'draft' },
  { label: 'Approved', value: 'approved' },
  { label: 'Archived', value: 'archived' }
]

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(value))
}

function statusTone(status: BackendSOP['status']) {
  if (status === 'approved') return 'border-emerald-400/20 bg-emerald-400/8 text-emerald-300'
  if (status === 'archived') return 'border-white/10 bg-white/[0.04] text-white/45'
  return 'border-amber-400/20 bg-amber-400/8 text-amber-200'
}

function sopMatches(sop: BackendSOP, query: string, filter: SopFilter) {
  if (filter !== 'all' && sop.status !== filter) return false
  const haystack = [
    sop.title,
    sop.document ?? '',
    sop.status,
    ...sop.steps.flatMap((step) => [step.title, step.instruction, step.warning ?? ''])
  ].join(' ').toLowerCase()
  return haystack.includes(query.trim().toLowerCase())
}

export function SOPLibraryPage() {
  const [sops, setSops] = useState<BackendSOP[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<SopFilter>('all')
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({})
  const [isLoading, setIsLoading] = useState(true)
  const [isLoadingImages, setIsLoadingImages] = useState(false)
  const [isExportingPdf, setIsExportingPdf] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const visibleSops = useMemo(
    () => sops.filter((sop) => sopMatches(sop, query, filter)),
    [filter, query, sops]
  )
  const selectedSop =
    visibleSops.find((sop) => sop.id === selectedId) ?? visibleSops[0] ?? null

  const loadSops = async () => {
    setIsLoading(true)
    setError(null)
    try {
      const fetched = await window.api.recording.listSops()
      setSops(fetched)
      setSelectedId((current) => current ?? fetched[0]?.id ?? null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load SOP library.')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void loadSops()
  }, [])

  useEffect(() => {
    if (!selectedSop) {
      setImageUrls({})
      return
    }

    const screenshotIds = [
      ...new Set(
        selectedSop.steps
          .map((step) => step.screenshot_reference)
          .filter((id): id is string => Boolean(id))
      )
    ]
    if (screenshotIds.length === 0) {
      setImageUrls({})
      return
    }

    let cancelled = false
    const createdUrls: string[] = []

    const loadImages = async () => {
      setIsLoadingImages(true)
      try {
        const evidence = await window.api.recording.getSessionScreenshots(
          selectedSop.source_session_id
        )
        const mediaUrls = new Map(
          evidence.map((item) => [item.id, item.annotated_media_url ?? item.media_url])
        )
        const entries: Record<string, string> = {}
        await mapWithConcurrency(screenshotIds, 4, async (screenshotId) => {
          const buffer = await window.api.recording.getSopScreenshotImage(
            selectedSop.source_session_id,
            screenshotId,
            mediaUrls.get(screenshotId)
          )
          if (cancelled) return
          const url = URL.createObjectURL(new Blob([buffer], { type: 'image/png' }))
          createdUrls.push(url)
          entries[screenshotId] = url
        })
        if (!cancelled) setImageUrls(entries)
      } catch {
        if (!cancelled) setImageUrls({})
      } finally {
        if (!cancelled) setIsLoadingImages(false)
      }
    }

    void loadImages()
    return () => {
      cancelled = true
      for (const url of createdUrls) URL.revokeObjectURL(url)
    }
  }, [selectedSop])

  const exportPdf = async () => {
    if (!selectedSop) return
    setIsExportingPdf(true)
    setError(null)
    try {
      await triggerSopPdfExport(selectedSop, imageUrls)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'PDF export failed.')
    } finally {
      setIsExportingPdf(false)
    }
  }

  return (
    <section className="flex h-[calc(100vh-4rem)] min-h-0 flex-col overflow-hidden px-5 py-8 md:px-8">
      <div className="shrink-0">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="font-mono text-xs font-bold uppercase tracking-[0.24em] text-emerald-400">
              Documentation
            </p>
            <h2 className="mt-3 text-4xl font-black tracking-[-0.045em]">SOP Library</h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-white/50">
              Review generated procedures across recorded workflows.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadSops()}
            disabled={isLoading}
            className="rounded-full border border-white/15 bg-white/[0.04] px-5 py-3 text-sm font-black text-white transition hover:bg-white/10 disabled:cursor-wait disabled:opacity-50"
          >
            {isLoading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>

        {error && (
          <p className="mt-6 rounded-xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {error}
          </p>
        )}
      </div>

      <div className="mt-8 grid min-h-0 flex-1 gap-5 lg:grid-cols-[360px_minmax(0,1fr)]">
        <aside className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#090909]">
          <div className="shrink-0 border-b border-white/10 p-4">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search SOPs..."
              className="w-full rounded-xl border border-white/10 bg-black/35 px-4 py-3 text-sm text-white outline-none transition placeholder:text-white/25 focus:border-emerald-300/50"
            />
            <div className="mt-3 flex flex-wrap gap-2">
              {filterOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setFilter(option.value)}
                  className={[
                    'rounded-lg px-3 py-2 text-xs font-black uppercase tracking-[0.1em] transition',
                    filter === option.value
                      ? 'bg-white text-black'
                      : 'border border-white/10 bg-white/[0.03] text-white/50 hover:text-white'
                  ].join(' ')}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
            {isLoading && sops.length === 0 ? (
              <div className="grid h-40 place-items-center">
                <span className="size-2.5 animate-pulse rounded-full bg-white/40" />
              </div>
            ) : visibleSops.length === 0 ? (
              <p className="px-2 py-8 text-center text-sm text-white/40">No SOPs found.</p>
            ) : (
              visibleSops.map((sop) => (
                <button
                  key={sop.id}
                  type="button"
                  onClick={() => setSelectedId(sop.id)}
                  className={[
                    'w-full rounded-xl border p-4 text-left transition',
                    selectedSop?.id === sop.id
                      ? 'border-emerald-400/30 bg-emerald-400/[0.08]'
                      : 'border-white/10 bg-white/[0.025] hover:border-white/20 hover:bg-white/[0.05]'
                  ].join(' ')}
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="min-w-0 truncate text-sm font-black">{sop.title}</p>
                    <span
                      className={`shrink-0 rounded-full border px-2 py-1 font-mono text-[9px] font-bold uppercase tracking-[0.12em] ${statusTone(sop.status)}`}
                    >
                      {sop.status}
                    </span>
                  </div>
                  <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.16em] text-white/35">
                    v{sop.version} · {formatDate(sop.created_at)} · {sop.steps.length} steps
                  </p>
                </button>
              ))
            )}
          </div>
        </aside>

        <main className="min-h-0 overflow-y-auto rounded-2xl border border-white/10 bg-[#090909] p-6">
          {!selectedSop ? (
            <div className="grid h-full min-h-80 place-items-center text-center">
              <div>
                <span className="mx-auto block size-2.5 rounded-full bg-white/25" />
                <p className="mt-4 text-sm text-white/40">Select an SOP to review.</p>
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <span
                    className={`inline-flex rounded-full border px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.14em] ${statusTone(selectedSop.status)}`}
                  >
                    {selectedSop.status}
                  </span>
                  <h3 className="mt-4 text-3xl font-black tracking-[-0.04em]">
                    {selectedSop.title}
                  </h3>
                  <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.18em] text-white/35">
                    v{selectedSop.version} · {formatDate(selectedSop.created_at)} ·{' '}
                    {selectedSop.steps.length} steps
                  </p>
                </div>
                <button
                  type="button"
                  disabled={isExportingPdf || isLoadingImages}
                  onClick={() => void exportPdf()}
                  className="rounded-xl border border-white/15 bg-white px-4 py-2.5 text-xs font-black uppercase tracking-[0.1em] text-black transition hover:bg-white/90 disabled:cursor-wait disabled:opacity-50"
                >
                  {isExportingPdf ? 'Exporting' : 'Export PDF'}
                </button>
              </div>

              {selectedSop.document && (
                <section className="rounded-2xl border border-white/10 bg-black/25 p-5">
                  <p className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-white/35">
                    Overview
                  </p>
                  <p className="mt-3 whitespace-pre-line text-sm leading-7 text-white/70">
                    {selectedSop.document}
                  </p>
                </section>
              )}

              <div className="space-y-4">
                {selectedSop.steps.map((step) => (
                  <article
                    key={step.id}
                    className="rounded-2xl border border-white/10 bg-black/25 p-5"
                  >
                    <div className="flex gap-4">
                      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-white/10 font-mono text-xs font-black text-white/70">
                        {step.position}
                      </span>
                      <div className="min-w-0 flex-1">
                        <h4 className="text-lg font-black tracking-[-0.02em]">{step.title}</h4>
                        <p className="mt-2 text-sm leading-7 text-white/70">{step.instruction}</p>
                        {step.warning && (
                          <p className="mt-3 rounded-xl border border-amber-400/20 bg-amber-400/[0.06] px-4 py-3 text-sm text-amber-200">
                            {step.warning}
                          </p>
                        )}
                        {step.screenshot_reference && imageUrls[step.screenshot_reference] && (
                          <img
                            src={imageUrls[step.screenshot_reference]}
                            alt={`${step.title} screenshot`}
                            className="mt-4 rounded-xl border border-white/10"
                          />
                        )}
                        {step.decision_branches.length > 0 && (
                          <div className="mt-4 space-y-2">
                            {step.decision_branches.map((branch, index) => (
                              <p
                                key={`${branch.condition}-${index}`}
                                className="rounded-xl border border-sky-300/15 bg-sky-300/[0.06] px-4 py-3 text-sm text-sky-100/75"
                              >
                                <span className="font-bold">If:</span> {branch.condition}{' '}
                                <span className="font-bold">then:</span> {branch.action}
                              </p>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          )}
        </main>
      </div>
    </section>
  )
}
