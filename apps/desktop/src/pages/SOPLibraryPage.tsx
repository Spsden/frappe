import { useEffect, useMemo, useState } from 'react'
import type { BackendSOP } from '../../shared/recording'
import { useTheme } from '../features/theme/ThemeContext'
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

function statusTone(
  status: BackendSOP['status'],
  isDark: boolean
) {
  if (isDark) {
    if (status === 'approved') {
      return 'border-emerald-400/20 bg-emerald-400/8 text-emerald-300'
    }

    if (status === 'archived') {
      return 'border-white/10 bg-white/[0.04] text-white/45'
    }

    return 'border-amber-400/20 bg-amber-400/8 text-amber-200'
  }

  if (status === 'approved') {
    return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  }

  if (status === 'archived') {
    return 'border-slate-200 bg-slate-100 text-slate-500'
  }

  return 'border-amber-200 bg-amber-50 text-amber-700'
}

function sopMatchesFilter(
  sop: BackendSOP,
  filter: SopFilter
) {
  if (
    filter !== 'all' &&
    sop.status !== filter
  ) {
    return false
  }

  return true
}

export function SOPLibraryPage() {
  const { theme } = useTheme()
  const isDark = theme === 'dark'

  const [sops, setSops] =
    useState<BackendSOP[]>([])

  const [selectedId, setSelectedId] =
    useState<string | null>(null)

  const [filter, setFilter] =
    useState<SopFilter>('all')

  const [imageUrls, setImageUrls] =
    useState<Record<string, string>>({})

  const [isLoading, setIsLoading] =
    useState(true)

  const [
    isLoadingImages,
    setIsLoadingImages
  ] = useState(false)

  const [
    isExportingPdf,
    setIsExportingPdf
  ] = useState(false)

  const [
    isStartingWalkthrough,
    setIsStartingWalkthrough
  ] = useState(false)

  const [
    isApprovingSop,
    setIsApprovingSop
  ] = useState(false)

  const [error, setError] =
    useState<string | null>(null)

  const visibleSops = useMemo(
    () =>
      sops.filter((sop) =>
        sopMatchesFilter(sop, filter)
      ),
    [filter, sops]
  )

  const selectedSop =
    visibleSops.find(
      (sop) => sop.id === selectedId
    ) ??
    visibleSops[0] ??
    null

  const loadSops = async () => {
    setIsLoading(true)
    setError(null)

    try {
      const fetched =
        await window.api.recording.listSops()

      setSops(fetched)

      setSelectedId(
        (current) =>
          current ??
          fetched[0]?.id ??
          null
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
          .map(
            (step) =>
              step.screenshot_reference
          )
          .filter(
            (id): id is string =>
              Boolean(id)
          )
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
            item.annotated_media_url ??
              item.media_url
          ])
        )

        const entries: Record<
          string,
          string
        > = {}

        await mapWithConcurrency(
          screenshotIds,
          4,
          async (screenshotId) => {
            try {
              const buffer =
                await window.api.recording.getSopScreenshotImage(
                  selectedSop.source_session_id,
                  screenshotId,
                  mediaUrls.get(
                    screenshotId
                  )
                )

              if (cancelled) return

              const url =
                URL.createObjectURL(
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
      await triggerSopPdfExport(
        selectedSop,
        imageUrls
      )
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

  const startWalkthrough = async () => {
    if (!selectedSop) return

    setIsStartingWalkthrough(true)
    setError(null)

    try {
      await window.api.walkthrough.open({
        sop: selectedSop,
        startedAt:
          new Date().toISOString()
      })
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Could not start walkthrough.'
      )
    } finally {
      setIsStartingWalkthrough(false)
    }
  }

  const setSopApproval = async (
    approved: boolean
  ) => {
    if (!selectedSop) return

    setIsApprovingSop(true)
    setError(null)

    try {
      const updated =
        await window.api.recording.approveSop(
          selectedSop.id,
          approved
        )

      setSops((current) =>
        current.map((sop) =>
          sop.id === updated.id
            ? updated
            : sop
        )
      )
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : approved
            ? 'Could not approve SOP.'
            : 'Could not move SOP back to draft.'
      )
    } finally {
      setIsApprovingSop(false)
    }
  }

  return (
    <section
      className={[
        'flex h-[calc(100vh-4rem)] min-h-0 flex-col overflow-hidden px-5 py-3 md:px-8',
        isDark
          ? 'text-white'
          : 'bg-[#fafafb] text-slate-900'
      ].join(' ')}
    >
      <div className="shrink-0">
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() =>
              void loadSops()
            }
            disabled={isLoading}
            title={isLoading ? 'Refreshing' : 'Refresh'}
            aria-label={isLoading ? 'Refreshing SOPs' : 'Refresh SOPs'}
            className={
              isDark
                ? 'grid size-9 place-items-center rounded-xl border border-white/15 bg-white/[0.04] text-white/65 transition hover:bg-white/10 hover:text-white disabled:cursor-wait disabled:opacity-50'
                : 'grid size-9 place-items-center rounded-xl bg-gradient-to-r from-[#a66ad8] to-[#d783b6] text-white shadow-[0_8px_20px_rgba(166,106,216,0.22)] transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_12px_26px_rgba(166,106,216,0.32)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-300 focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-50'
            }
          >
            <svg
              viewBox="0 0 24 24"
              aria-hidden="true"
              className={[
                'size-4',
                isLoading ? 'animate-spin' : ''
              ].join(' ')}
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 12a9 9 0 0 1-15.4 6.4L3 16" />
              <path d="M3 16v5h5" />
              <path d="M3 12A9 9 0 0 1 18.4 5.6L21 8" />
              <path d="M21 8V3h-5" />
            </svg>
          </button>
        </div>

        {error && (
          <p
            className={
              isDark
                ? 'mt-6 rounded-xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-300'
                : 'mt-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600'
            }
          >
            {error}
          </p>
        )}
      </div>

      {/* Main two-column layout */}

      <div className="mt-3 grid min-h-0 flex-1 gap-5 lg:grid-cols-[360px_minmax(0,1fr)]">
        {/* Left SOP list */}

        <aside
          className={[
            'flex min-h-0 flex-col overflow-hidden rounded-2xl border',
            isDark
              ? 'border-white/10 bg-[#090909]'
              : 'border-slate-200 bg-white shadow-[0_16px_45px_rgba(95,60,150,0.08)]'
          ].join(' ')}
        >
          {!isDark && (
            <div className="h-1 shrink-0 bg-gradient-to-r from-[#a66ad8] via-[#c778d7] to-[#d783b6]" />
          )}

          <div
            className={
              isDark
                ? 'shrink-0 border-b border-white/10 p-4'
                : 'shrink-0 border-b border-slate-200 p-4'
            }
          >
            <div className="flex flex-wrap gap-2">
              {filterOptions.map(
                (option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() =>
                      setFilter(
                        option.value
                      )
                    }
                    className={[
                      isDark
                        ? 'rounded-lg px-3 py-2 text-xs font-black uppercase tracking-[0.1em] transition'
                        : 'rounded-lg px-3 py-2 text-xs font-bold transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-300 focus-visible:ring-offset-2',
                      filter ===
                      option.value
                        ? isDark
                          ? 'bg-white text-black'
                          : 'bg-gradient-to-r from-[#a66ad8] to-[#d783b6] text-white shadow-[0_5px_14px_rgba(166,106,216,0.2)]'
                        : isDark
                          ? 'border border-white/10 bg-white/[0.03] text-white/50 hover:text-white'
                          : 'border border-slate-200 bg-white text-slate-600 hover:border-purple-200 hover:bg-purple-50 hover:text-purple-700'
                    ].join(' ')}
                  >
                    {option.label}
                  </button>
                )
              )}
            </div>
          </div>

          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
            {isLoading &&
            sops.length === 0 ? (
              <div className="grid h-40 place-items-center">
                <span
                  className={
                    isDark
                      ? 'size-2.5 animate-pulse rounded-full bg-white/40'
                      : 'size-2.5 animate-pulse rounded-full bg-purple-400 shadow-[0_0_14px_rgba(168,85,247,0.4)]'
                  }
                />
              </div>
            ) : visibleSops.length ===
              0 ? (
              <p
                className={
                  isDark
                    ? 'px-2 py-8 text-center text-sm text-white/40'
                    : 'px-2 py-8 text-center text-sm text-slate-400'
                }
              >
                No SOPs found.
              </p>
            ) : (
              visibleSops.map((sop) => (
                <button
                  key={sop.id}
                  type="button"
                  onClick={() =>
                    setSelectedId(sop.id)
                  }
                  className={[
                    isDark
                      ? 'w-full rounded-xl border p-4 text-left transition'
                      : 'w-full rounded-xl border p-4 text-left transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-300 focus-visible:ring-offset-2',
                    selectedSop?.id ===
                    sop.id
                      ? isDark
                        ? 'border-emerald-400/30 bg-emerald-400/[0.08]'
                        : 'border-purple-300 bg-purple-50 shadow-[0_8px_22px_rgba(166,106,216,0.1)]'
                      : isDark
                        ? 'border-white/10 bg-white/[0.025] hover:border-white/20 hover:bg-white/[0.05]'
                        : 'border-slate-200 bg-white hover:-translate-y-0.5 hover:border-purple-200 hover:bg-purple-50/50 hover:shadow-sm'
                  ].join(' ')}
                >
                  <div className="flex items-start justify-between gap-3">
                    <p
                      className={[
                        'min-w-0 truncate text-sm font-black',
                        isDark
                          ? 'text-white'
                          : 'text-slate-800'
                      ].join(' ')}
                    >
                      {sop.title}
                    </p>

                    <span
                      className={[
                        'shrink-0 rounded-full border',
                        isDark
                          ? 'px-2 py-1 font-mono text-[9px] font-bold uppercase tracking-[0.12em]'
                          : 'px-2.5 py-1 text-[10px] font-bold',
                        statusTone(
                          sop.status,
                          isDark
                        )
                      ].join(' ')}
                    >
                      {isDark
                        ? sop.status
                        : formatStatus(
                            sop.status
                          )}
                    </span>
                  </div>

                  <p
                    className={
                      isDark
                        ? 'mt-2 font-mono text-[10px] uppercase tracking-[0.16em] text-white/35'
                        : 'mt-2 text-[10px] font-medium text-slate-400'
                    }
                  >
                    v{sop.version} ·{' '}
                    {formatDate(
                      sop.created_at
                    )}{' '}
                    · {sop.steps.length}{' '}
                    steps
                  </p>
                </button>
              ))
            )}
          </div>
        </aside>

        {/* Right SOP detail */}

        <main
          className={[
            'min-h-0 overflow-y-auto rounded-2xl border',
            isDark
              ? 'border-white/10 bg-[#090909] p-6'
              : 'relative border-slate-200 bg-white shadow-[0_16px_45px_rgba(95,60,150,0.08)]'
          ].join(' ')}
        >
          {!isDark && (
            <div className="sticky inset-x-0 top-0 z-10 h-1 bg-gradient-to-r from-[#a66ad8] via-[#c778d7] to-[#d783b6]" />
          )}

          {!selectedSop ? (
            <div
              className={
                isDark
                  ? 'grid h-full min-h-80 place-items-center text-center'
                  : 'grid h-full min-h-80 place-items-center p-6 text-center'
              }
            >
              <div>
                {isDark ? (
                  <span className="mx-auto block size-2.5 rounded-full bg-white/25" />
                ) : (
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

                      <line
                        x1="9"
                        y1="13"
                        x2="15"
                        y2="13"
                      />

                      <line
                        x1="9"
                        y1="17"
                        x2="15"
                        y2="17"
                      />
                    </svg>
                  </div>
                )}

                <p
                  className={
                    isDark
                      ? 'mt-4 text-sm text-white/40'
                      : 'mt-4 text-sm font-medium text-slate-500'
                  }
                >
                  Select an SOP to review.
                </p>
              </div>
            </div>
          ) : (
            <div
              className={
                isDark
                  ? 'space-y-6'
                  : 'space-y-6 p-6'
              }
            >
              {/* SOP header */}

              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <span
                    className={[
                      'inline-flex rounded-full border',
                      isDark
                        ? 'px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.14em]'
                        : 'px-3 py-1.5 text-xs font-bold',
                      statusTone(
                        selectedSop.status,
                        isDark
                      )
                    ].join(' ')}
                  >
                    {isDark
                      ? selectedSop.status
                      : formatStatus(
                          selectedSop.status
                        )}
                  </span>

                  <h3
                    className={[
                      'mt-4 text-3xl font-black tracking-[-0.04em]',
                      isDark
                        ? 'text-white'
                        : 'text-slate-900'
                    ].join(' ')}
                  >
                    {selectedSop.title}
                  </h3>

                  <p
                    className={
                      isDark
                        ? 'mt-2 font-mono text-[10px] uppercase tracking-[0.18em] text-white/35'
                        : 'mt-2 text-xs font-medium text-slate-400'
                    }
                  >
                    v{selectedSop.version} ·{' '}
                    {formatDate(
                      selectedSop.created_at
                    )}{' '}
                    ·{' '}
                    {
                      selectedSop.steps
                        .length
                    }{' '}
                    steps
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  {selectedSop.status !==
                    'archived' && (
                    <button
                      type="button"
                      disabled={
                        isApprovingSop
                      }
                      onClick={() =>
                        void setSopApproval(
                          selectedSop.status !==
                            'approved'
                        )
                      }
                      className={
                        selectedSop.status ===
                        'approved'
                          ? isDark
                            ? 'flex items-center gap-2 rounded-xl border border-white/15 bg-white/[0.04] px-4 py-2.5 text-xs font-black uppercase tracking-[0.1em] text-white/60 transition hover:border-amber-300/30 hover:bg-amber-300/10 hover:text-amber-100 disabled:cursor-wait disabled:opacity-50'
                            : 'flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-5 py-2.5 text-sm font-bold text-amber-700 transition hover:bg-amber-100 disabled:cursor-wait disabled:opacity-50'
                          : isDark
                            ? 'flex items-center gap-2 rounded-xl border border-emerald-300/25 bg-emerald-300/10 px-4 py-2.5 text-xs font-black uppercase tracking-[0.1em] text-emerald-100 transition hover:bg-emerald-300/16 disabled:cursor-wait disabled:opacity-50'
                            : 'flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-2.5 text-sm font-bold text-emerald-700 shadow-[0_8px_20px_rgba(16,185,129,0.12)] transition duration-200 hover:-translate-y-0.5 hover:bg-emerald-100 disabled:cursor-wait disabled:opacity-50'
                      }
                    >
                      <span>
                        {selectedSop.status ===
                        'approved'
                          ? '↩'
                          : '✓'}
                      </span>

                      {isApprovingSop
                        ? 'Saving'
                        : selectedSop.status ===
                            'approved'
                          ? 'Move to draft'
                          : 'Approve SOP'}
                    </button>
                  )}

                  {selectedSop.status ===
                    'approved' &&
                    selectedSop.steps.length >
                      0 && (
                      <button
                        type="button"
                        disabled={
                          isStartingWalkthrough
                        }
                        onClick={() =>
                          void startWalkthrough()
                        }
                        className={
                          isDark
                            ? 'flex items-center gap-2 rounded-xl border border-emerald-300/25 bg-emerald-300/10 px-4 py-2.5 text-xs font-black uppercase tracking-[0.1em] text-emerald-100 transition hover:bg-emerald-300/16 disabled:cursor-wait disabled:opacity-50'
                            : 'flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-2.5 text-sm font-bold text-emerald-700 shadow-[0_8px_20px_rgba(16,185,129,0.12)] transition duration-200 hover:-translate-y-0.5 hover:bg-emerald-100 disabled:cursor-wait disabled:opacity-50'
                        }
                      >
                        <span className="grid size-5 place-items-center rounded-full bg-emerald-400 text-[10px] text-black">
                          ▶
                        </span>

                        {isStartingWalkthrough
                          ? 'Opening'
                          : 'Walkthrough'}
                      </button>
                    )}

                  <button
                    type="button"
                    disabled={
                      isExportingPdf ||
                      isLoadingImages
                    }
                    onClick={() =>
                      void exportPdf()
                    }
                    className={
                      isDark
                        ? 'rounded-xl border border-white/15 bg-white px-4 py-2.5 text-xs font-black uppercase tracking-[0.1em] text-black transition hover:bg-white/90 disabled:cursor-wait disabled:opacity-50'
                        : 'flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#a66ad8] to-[#d783b6] px-5 py-2.5 text-sm font-bold text-white shadow-[0_8px_20px_rgba(166,106,216,0.22)] transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_12px_26px_rgba(166,106,216,0.32)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-300 focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-50'
                    }
                  >
                    {!isDark && (
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

                        <line
                          x1="12"
                          y1="15"
                          x2="12"
                          y2="3"
                        />
                      </svg>
                    )}

                    {isExportingPdf
                      ? 'Exporting'
                      : 'Export PDF'}
                  </button>
                </div>
              </div>

              {/* Overview */}

              {selectedSop.document && (
                <section
                  className={
                    isDark
                      ? 'rounded-2xl border border-white/10 bg-black/25 p-5'
                      : 'relative overflow-hidden rounded-2xl border border-slate-200 bg-slate-50/60 p-5 pt-6'
                  }
                >
                  {!isDark && (
                    <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[#a66ad8] via-[#c778d7] to-[#d783b6]" />
                  )}

                  <p
                    className={
                      isDark
                        ? 'font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-white/35'
                        : 'text-[10px] font-bold uppercase tracking-[0.24em] text-purple-500'
                    }
                  >
                    Overview
                  </p>

                  <p
                    className={
                      isDark
                        ? 'mt-3 whitespace-pre-line text-sm leading-7 text-white/70'
                        : 'mt-3 whitespace-pre-line text-sm leading-7 text-slate-600'
                    }
                  >
                    {selectedSop.document}
                  </p>
                </section>
              )}

              {/* SOP steps */}

              <div className="space-y-4">
                {selectedSop.steps.map(
                  (step) => {
                    const branches =
                      step.decision_branches ??
                      []

                    return (
                      <article
                        key={step.id}
                        className={
                          isDark
                            ? 'rounded-2xl border border-white/10 bg-black/25 p-5'
                            : 'rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_8px_24px_rgba(80,50,120,0.05)] transition duration-200 hover:border-purple-200 hover:shadow-[0_12px_30px_rgba(112,66,150,0.09)]'
                        }
                      >
                        <div className="flex gap-4">
                          <span
                            className={
                              isDark
                                ? 'grid size-8 shrink-0 place-items-center rounded-full bg-white/10 font-mono text-xs font-black text-white/70'
                                : 'grid size-8 shrink-0 place-items-center rounded-full bg-gradient-to-r from-[#a66ad8] to-[#d783b6] text-xs font-black text-white shadow-[0_5px_12px_rgba(166,106,216,0.22)]'
                            }
                          >
                            {step.position}
                          </span>

                          <div className="min-w-0 flex-1">
                            <h4
                              className={[
                                'text-lg font-black tracking-[-0.02em]',
                                isDark
                                  ? 'text-white'
                                  : 'text-slate-900'
                              ].join(' ')}
                            >
                              {step.title}
                            </h4>

                            <p
                              className={
                                isDark
                                  ? 'mt-2 text-sm leading-7 text-white/70'
                                  : 'mt-2 text-sm leading-7 text-slate-600'
                              }
                            >
                              {
                                step.instruction
                              }
                            </p>

                            {step.warning && (
                              <p
                                className={
                                  isDark
                                    ? 'mt-3 rounded-xl border border-amber-400/20 bg-amber-400/[0.06] px-4 py-3 text-sm text-amber-200'
                                    : 'mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700'
                                }
                              >
                                {!isDark &&
                                  '⚠️ '}
                                {step.warning}
                              </p>
                            )}

                            {step.screenshot_reference &&
                              imageUrls[
                                step
                                  .screenshot_reference
                              ] && (
                                <img
                                  src={
                                    imageUrls[
                                      step
                                        .screenshot_reference
                                    ]
                                  }
                                  alt={`${step.title} screenshot`}
                                  className={
                                    isDark
                                      ? 'mt-4 rounded-xl border border-white/10'
                                      : 'mt-4 rounded-xl border border-slate-200 shadow-sm'
                                  }
                                />
                              )}

                            {branches.length >
                              0 && (
                              <div className="mt-4 space-y-2">
                                {!isDark && (
                                  <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-sky-600">
                                    Decision
                                    branches
                                  </p>
                                )}

                                {branches.map(
                                  (
                                    branch,
                                    index
                                  ) => (
                                    <p
                                      key={`${branch.condition}-${index}`}
                                      className={
                                        isDark
                                          ? 'rounded-xl border border-sky-300/15 bg-sky-300/[0.06] px-4 py-3 text-sm text-sky-100/75'
                                          : 'rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm leading-6 text-slate-700'
                                      }
                                    >
                                      <span
                                        className={
                                          isDark
                                            ? 'font-bold'
                                            : 'font-bold text-sky-700'
                                        }
                                      >
                                        If:
                                      </span>{' '}
                                      {
                                        branch.condition
                                      }{' '}
                                      <span
                                        className={
                                          isDark
                                            ? 'font-bold'
                                            : 'font-bold text-sky-700'
                                        }
                                      >
                                        then:
                                      </span>{' '}
                                      {
                                        branch.action
                                      }
                                    </p>
                                  )
                                )}
                              </div>
                            )}

                            {!isDark &&
                              step.estimated_time_ms !=
                                null && (
                                <p className="mt-3 text-xs text-slate-400">
                                  Estimated
                                  time:{' '}
                                  {Math.round(
                                    step.estimated_time_ms /
                                      1000
                                  )}
                                  s
                                </p>
                              )}
                          </div>
                        </div>
                      </article>
                    )
                  }
                )}
              </div>
            </div>
          )}
        </main>
      </div>
    </section>
  )
}
