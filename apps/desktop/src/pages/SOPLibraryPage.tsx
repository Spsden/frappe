import { useEffect, useMemo, useState } from 'react'
import type { BackendSOP } from '../../shared/recording'
import { mapWithConcurrency } from '../utils/async'
import { triggerSopPdfExport } from '../utils/sopPdf'

type SopFilter = 'all' | BackendSOP['status']

const filterOptions: Array<{
  label: string
  value: SopFilter
}> = [
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

function formatStatus(status: BackendSOP['status']) {
  if (status === 'draft') return 'Draft'
  if (status === 'approved') return 'Approved'
  if (status === 'archived') return 'Archived'

  return status
}

function statusTone(status: BackendSOP['status']) {
  if (status === 'approved') {
    return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  }

  if (status === 'archived') {
    return 'border-slate-200 bg-slate-100 text-slate-500'
  }

  return 'border-amber-200 bg-amber-50 text-amber-700'
}

function sopMatches(
  sop: BackendSOP,
  query: string,
  filter: SopFilter
) {
  if (filter !== 'all' && sop.status !== filter) {
    return false
  }

  const haystack = [
    sop.title,
    sop.document ?? '',
    sop.status,
    ...sop.steps.flatMap((step) => [
      step.title,
      step.instruction,
      step.warning ?? ''
    ])
  ]
    .join(' ')
    .toLowerCase()

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
    visibleSops.find((sop) => sop.id === selectedId) ??
    visibleSops[0] ??
    null

  const loadSops = async () => {
    setIsLoading(true)
    setError(null)

    try {
      const fetched = await window.api.recording.listSops()

      setSops(fetched)
        setSelectedId(
          (current) => current ?? fetched[0]?.id ?? null
        )
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Could not load SOP library.'
      )
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
      setIsLoadingImages(false)
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
      setIsLoadingImages(false)
      return
    }

    let cancelled = false
    const createdUrls: string[] = []

    const loadImages = async () => {
      setIsLoadingImages(true)

      try {
        const evidence =
          await window.api.recording.getSessionScreenshots(
            selectedSop.source_session_id
          )

        const mediaUrls = new Map(
          evidence.map((item) => [
            item.id,
            item.annotated_media_url ?? item.media_url
          ])
        )

        const entries: Record<string, string> = {}

        await mapWithConcurrency(
          screenshotIds,
          4,
          async (screenshotId) => {
            try {
              const buffer =
                await window.api.recording.getSopScreenshotImage(
                  selectedSop.source_session_id,
                  screenshotId,
                  mediaUrls.get(screenshotId)
                )

              if (cancelled) return

              const url = URL.createObjectURL(
                new Blob([buffer], {
                  type: 'image/png'
                })
              )

              createdUrls.push(url)
              entries[screenshotId] = url
            } catch {
              // Skip screenshots that fail to load.
            }
          }
        )

        if (!cancelled) {
          setImageUrls(entries)
        }
      } catch {
        if (!cancelled) {
          setImageUrls({})
        }
      } finally {
        if (!cancelled) {
          setIsLoadingImages(false)
        }
      }
    }

    void loadImages()

    return () => {
      cancelled = true

      for (const url of createdUrls) {
        URL.revokeObjectURL(url)
      }
    }
  }, [selectedSop])

  const exportPdf = async () => {
    if (!selectedSop) return

    setIsExportingPdf(true)
    setError(null)

    try {
      await triggerSopPdfExport(selectedSop, imageUrls)
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'PDF export failed.'
      )
    } finally {
      setIsExportingPdf(false)
    }
  }

  return (
    <section className="flex h-[calc(100vh-4rem)] min-h-0 flex-col overflow-hidden bg-[#fafafb] px-5 py-8 text-slate-900 md:px-8">
      {/* Page header */}

      <div className="shrink-0">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-purple-500">
              Documentation
            </p>

            <h2 className="mt-3 text-4xl font-black tracking-[-0.045em] text-slate-900">
              SOP Library
            </h2>

            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-500">
              Review generated procedures across recorded workflows.
            </p>
          </div>

          <button
            type="button"
            onClick={() => void loadSops()}
            disabled={isLoading}
            className="rounded-xl bg-gradient-to-r from-[#a66ad8] to-[#d783b6] px-5 py-2.5 text-sm font-bold text-white shadow-[0_8px_20px_rgba(166,106,216,0.22)] transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_12px_26px_rgba(166,106,216,0.32)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-300 focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-50"
          >
            {isLoading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>

        {error && (
          <p className="mt-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
            {error}
          </p>
        )}
      </div>

      {/* Main two-column layout */}

      <div className="mt-8 grid min-h-0 flex-1 gap-5 lg:grid-cols-[360px_minmax(0,1fr)]">
        {/* Left SOP list */}

        <aside className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_16px_45px_rgba(95,60,150,0.08)]">
          <div className="h-1 shrink-0 bg-gradient-to-r from-[#a66ad8] via-[#c778d7] to-[#d783b6]" />

          <div className="shrink-0 border-b border-slate-200 p-4">
            <div className="relative">
              <svg
                className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"
                width="17"
                height="17"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.35-4.35" />
              </svg>

              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search SOPs..."
                className="w-full rounded-xl border border-slate-200 bg-white py-3 pl-11 pr-4 text-sm text-slate-800 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-purple-400 focus:ring-2 focus:ring-purple-100"
              />
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              {filterOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setFilter(option.value)}
                  className={[
                    'rounded-lg px-3 py-2 text-xs font-bold transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-300 focus-visible:ring-offset-2',
                    filter === option.value
                      ? 'bg-gradient-to-r from-[#a66ad8] to-[#d783b6] text-white shadow-[0_5px_14px_rgba(166,106,216,0.2)]'
                      : 'border border-slate-200 bg-white text-slate-600 hover:border-purple-200 hover:bg-purple-50 hover:text-purple-700'
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
                <span className="size-2.5 animate-pulse rounded-full bg-purple-400 shadow-[0_0_14px_rgba(168,85,247,0.4)]" />
              </div>
            ) : visibleSops.length === 0 ? (
              <p className="px-2 py-8 text-center text-sm text-slate-400">
                No SOPs found.
              </p>
            ) : (
              visibleSops.map((sop) => (
                <button
                  key={sop.id}
                  type="button"
                  onClick={() => setSelectedId(sop.id)}
                  className={[
                    'w-full rounded-xl border p-4 text-left transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-300 focus-visible:ring-offset-2',
                    selectedSop?.id === sop.id
                      ? 'border-purple-300 bg-purple-50 shadow-[0_8px_22px_rgba(166,106,216,0.1)]'
                      : 'border-slate-200 bg-white hover:-translate-y-0.5 hover:border-purple-200 hover:bg-purple-50/50 hover:shadow-sm'
                  ].join(' ')}
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="min-w-0 truncate text-sm font-black text-slate-800">
                      {sop.title}
                    </p>

                    <span
                      className={`shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-bold ${statusTone(
                        sop.status
                      )}`}
                    >
                      {formatStatus(sop.status)}
                    </span>
                  </div>

                  <p className="mt-2 text-[10px] font-medium text-slate-400">
                    v{sop.version} · {formatDate(sop.created_at)} ·{' '}
                    {sop.steps.length} steps
                  </p>
                </button>
              ))
            )}
          </div>
        </aside>

        {/* Right SOP detail */}

        <main className="relative min-h-0 overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-[0_16px_45px_rgba(95,60,150,0.08)]">
          <div className="sticky inset-x-0 top-0 z-10 h-1 bg-gradient-to-r from-[#a66ad8] via-[#c778d7] to-[#d783b6]" />

          {!selectedSop ? (
            <div className="grid h-full min-h-80 place-items-center p-6 text-center">
              <div>
                <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-purple-50 text-purple-500">
                  <svg
                    width="25"
                    height="25"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                    <line x1="9" y1="13" x2="15" y2="13" />
                    <line x1="9" y1="17" x2="15" y2="17" />
                  </svg>
                </div>

                <p className="mt-4 text-sm font-medium text-slate-500">
                  Select an SOP to review.
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-6 p-6">
              {/* SOP header */}

              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <span
                    className={`inline-flex rounded-full border px-3 py-1.5 text-xs font-bold ${statusTone(
                      selectedSop.status
                    )}`}
                  >
                    {formatStatus(selectedSop.status)}
                  </span>

                  <h3 className="mt-4 text-3xl font-black tracking-[-0.04em] text-slate-900">
                    {selectedSop.title}
                  </h3>

                  <p className="mt-2 text-xs font-medium text-slate-400">
                    v{selectedSop.version} ·{' '}
                    {formatDate(selectedSop.created_at)} ·{' '}
                    {selectedSop.steps.length} steps
                  </p>
                </div>

                <button
                  type="button"
                  disabled={isExportingPdf || isLoadingImages}
                  onClick={() => void exportPdf()}
                  className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#a66ad8] to-[#d783b6] px-5 py-2.5 text-sm font-bold text-white shadow-[0_8px_20px_rgba(166,106,216,0.22)] transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_12px_26px_rgba(166,106,216,0.32)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-300 focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-50"
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>

                  {isExportingPdf ? 'Exporting' : 'Export PDF'}
                </button>
              </div>

              {/* Overview */}

              {selectedSop.document && (
                <section className="relative overflow-hidden rounded-2xl border border-slate-200 bg-slate-50/60 p-5 pt-6">
                  <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[#a66ad8] via-[#c778d7] to-[#d783b6]" />

                  <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-purple-500">
                    Overview
                  </p>

                  <p className="mt-3 whitespace-pre-line text-sm leading-7 text-slate-600">
                    {selectedSop.document}
                  </p>
                </section>
              )}

              {/* SOP steps */}

              <div className="space-y-4">
                {selectedSop.steps.map((step) => {
                  const branches = step.decision_branches ?? []

                  return (
                    <article
                      key={step.id}
                      className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_8px_24px_rgba(80,50,120,0.05)] transition duration-200 hover:border-purple-200 hover:shadow-[0_12px_30px_rgba(112,66,150,0.09)]"
                    >
                      <div className="flex gap-4">
                        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-gradient-to-r from-[#a66ad8] to-[#d783b6] text-xs font-black text-white shadow-[0_5px_12px_rgba(166,106,216,0.22)]">
                          {step.position}
                        </span>

                        <div className="min-w-0 flex-1">
                          <h4 className="text-lg font-black tracking-[-0.02em] text-slate-900">
                            {step.title}
                          </h4>

                          <p className="mt-2 text-sm leading-7 text-slate-600">
                            {step.instruction}
                          </p>

                          {step.warning && (
                            <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
                              ⚠️ {step.warning}
                            </p>
                          )}

                          {step.screenshot_reference &&
                            imageUrls[step.screenshot_reference] && (
                              <img
                                src={
                                  imageUrls[
                                    step.screenshot_reference
                                  ]
                                }
                                alt={`${step.title} screenshot`}
                                className="mt-4 rounded-xl border border-slate-200 shadow-sm"
                              />
                            )}

                          {branches.length > 0 && (
                            <div className="mt-4 space-y-2">
                              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-sky-600">
                                Decision branches
                              </p>

                              {branches.map((branch, index) => (
                                <p
                                  key={`${branch.condition}-${index}`}
                                  className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm leading-6 text-slate-700"
                                >
                                  <span className="font-bold text-sky-700">
                                    If:
                                  </span>{' '}
                                  {branch.condition}{' '}
                                  <span className="font-bold text-sky-700">
                                    then:
                                  </span>{' '}
                                  {branch.action}
                                </p>
                              ))}
                            </div>
                          )}

                          {step.estimated_time_ms != null && (
                            <p className="mt-3 text-xs text-slate-400">
                              Estimated time:{' '}
                              {Math.round(
                                step.estimated_time_ms / 1000
                              )}
                              s
                            </p>
                          )}
                        </div>
                      </div>
                    </article>
                  )
                })}
              </div>
            </div>
          )}
        </main>
      </div>
    </section>
  )
}