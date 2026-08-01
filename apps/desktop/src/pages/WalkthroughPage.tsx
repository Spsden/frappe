import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties
} from 'react'
import type {
  BackendSOP,
  BackendSOPStep
} from '../../shared/recording'
import type { WalkthroughWindowState } from '../../shared/walkthrough'

const dragStyle = {
  WebkitAppRegion: 'drag'
} as CSSProperties

const noDragStyle = {
  WebkitAppRegion: 'no-drag'
} as CSSProperties

function clampStepIndex(index: number, sop: BackendSOP | null): number {
  if (!sop || sop.steps.length === 0) {
    return 0
  }

  return Math.min(
    Math.max(index, 0),
    sop.steps.length - 1
  )
}

function sopImageSignature(sop: BackendSOP | null): string {
  if (!sop) return ''

  return sop.steps
    .map(
      (step) =>
        step.screenshot_reference ?? ''
    )
    .join('|')
}

function StepProgressItem({
  step,
  index,
  active,
  complete,
  onSelect
}: {
  step: BackendSOPStep
  index: number
  active: boolean
  complete: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={[
        'group flex w-full items-start gap-3 rounded-2xl border p-3 text-left transition',
        active
          ? 'border-emerald-400/40 bg-emerald-400/10 shadow-[0_0_30px_rgba(16,185,129,0.08)]'
          : 'border-white/8 bg-white/[0.035] hover:border-white/15 hover:bg-white/[0.06]'
      ].join(' ')}
      style={noDragStyle}
    >
      <span
        className={[
          'grid size-7 shrink-0 place-items-center rounded-full border font-mono text-[10px] font-black',
          complete
            ? 'border-emerald-300/30 bg-emerald-300/20 text-emerald-200'
            : active
              ? 'border-white/20 bg-white text-black'
              : 'border-white/10 bg-black/30 text-white/45'
        ].join(' ')}
      >
        {complete ? '✓' : index + 1}
      </span>

      <span className="min-w-0">
        <span className="line-clamp-2 block text-xs font-black leading-4 text-white">
          {step.title}
        </span>
        <span className="mt-1 block font-mono text-[9px] font-bold uppercase tracking-[0.18em] text-white/35">
          {complete ? 'Done' : active ? 'Current' : 'Queued'}
        </span>
      </span>
    </button>
  )
}

function ScreenshotFrame({
  step,
  imageUrl,
  loading,
  onExpand
}: {
  step: BackendSOPStep
  imageUrl: string | null
  loading: boolean
  onExpand: () => void
}) {
  if (loading) {
    return (
      <div className="grid min-h-52 place-items-center rounded-[1.4rem] border border-white/10 bg-black/35">
        <div className="flex items-center gap-3 text-xs font-bold text-white/50">
          <span className="size-2.5 animate-pulse rounded-full bg-emerald-300" />
          Loading evidence
        </div>
      </div>
    )
  }

  if (!imageUrl) {
    return (
      <div className="grid min-h-52 place-items-center rounded-[1.4rem] border border-dashed border-white/12 bg-white/[0.025] p-6 text-center">
        <div>
          <p className="font-mono text-[10px] font-black uppercase tracking-[0.22em] text-white/35">
            No screenshot
          </p>
          <p className="mt-2 text-sm leading-6 text-white/55">
            This step only has written guidance.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-[1.4rem] border border-white/10 bg-black shadow-[0_18px_60px_rgba(0,0,0,0.45)]">
      <div className="flex items-center justify-between border-b border-white/10 bg-white/[0.035] px-4 py-2">
        <p className="font-mono text-[9px] font-black uppercase tracking-[0.22em] text-white/40">
          Annotated screen
        </p>
        <p className="font-mono text-[9px] font-bold uppercase tracking-[0.18em] text-white/30">
          Click to expand · Step {step.position}
        </p>
      </div>
      <button
        type="button"
        onClick={onExpand}
        className="group relative block w-full cursor-zoom-in overflow-hidden bg-black text-left"
        style={noDragStyle}
      >
        <img
          src={imageUrl}
          alt={`${step.title} screenshot`}
          className="block max-h-[310px] w-full object-contain transition duration-200 group-hover:opacity-90"
        />

        <span className="pointer-events-none absolute inset-0 grid place-items-center bg-black/0 opacity-0 transition group-hover:bg-black/20 group-hover:opacity-100">
          <span className="rounded-full border border-white/15 bg-black/75 px-4 py-2 font-mono text-[10px] font-black uppercase tracking-[0.18em] text-white shadow-[0_12px_35px_rgba(0,0,0,0.45)] backdrop-blur">
            View full size
          </span>
        </span>
      </button>
    </div>
  )
}

function CollapsedWalkthrough({
  sop,
  activeStep,
  activeStepIndex,
  totalSteps,
  onExpand,
  onPrevious,
  onNext,
  onClose
}: {
  sop: BackendSOP
  activeStep: BackendSOPStep | null
  activeStepIndex: number
  totalSteps: number
  onExpand: () => void
  onPrevious: () => void
  onNext: () => void
  onClose: () => void
}) {
  return (
    <main className="flex h-screen items-center justify-center bg-transparent p-1.5 text-white">
      <section
        className="flex h-full w-full items-center gap-3 rounded-3xl border border-white/15 bg-[#090909]/95 px-4 shadow-[0_16px_55px_rgba(0,0,0,0.7)] backdrop-blur-xl"
        style={dragStyle}
      >
        <button
          type="button"
          onClick={onExpand}
          className="grid size-10 shrink-0 place-items-center rounded-2xl bg-white text-black shadow-[0_8px_24px_rgba(255,255,255,0.16)]"
          style={noDragStyle}
        >
          ▶
        </button>

        <div className="min-w-0 flex-1">
          <p className="truncate font-mono text-[9px] font-black uppercase tracking-[0.22em] text-emerald-300/70">
            Walkthrough · {activeStepIndex + 1}/{totalSteps}
          </p>
          <p className="mt-0.5 truncate text-sm font-black">
            {activeStep?.title ?? sop.title}
          </p>
        </div>

        <div
          className="flex items-center gap-1"
          style={noDragStyle}
        >
          <button
            type="button"
            onClick={onPrevious}
            className="grid size-8 place-items-center rounded-xl border border-white/10 bg-white/[0.06] text-white/70 hover:bg-white/[0.1]"
          >
            ‹
          </button>
          <button
            type="button"
            onClick={onNext}
            className="grid size-8 place-items-center rounded-xl border border-white/10 bg-white/[0.06] text-white/70 hover:bg-white/[0.1]"
          >
            ›
          </button>
          <button
            type="button"
            onClick={onClose}
            className="grid size-8 place-items-center rounded-xl border border-white/10 bg-white/[0.06] text-white/45 hover:bg-red-500/20 hover:text-red-100"
          >
            ×
          </button>
        </div>
      </section>
    </main>
  )
}

export function WalkthroughPage() {
  const [state, setState] = useState<WalkthroughWindowState | null>(null)
  const [activeStepIndex, setActiveStepIndex] = useState(0)
  const [completedStepIds, setCompletedStepIds] = useState<Set<string>>(
    () => new Set()
  )
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({})
  const [imagesLoading, setImagesLoading] = useState(false)
  const [isImageExpanded, setIsImageExpanded] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void window.api.walkthrough
      .getState()
      .then(setState)
      .catch(() => setError('Could not load walkthrough.'))

    return window.api.walkthrough.onStateChanged((nextState) => {
      setState(nextState)
    })
  }, [])

  const sop = state?.payload?.sop ?? null
  const totalSteps = sop?.steps.length ?? 0
  const activeStep = sop?.steps[activeStepIndex] ?? null
  const imageSignature = useMemo(
    () => sopImageSignature(sop),
    [sop]
  )
  const progressPercent =
    totalSteps === 0
      ? 0
      : Math.round(
          (completedStepIds.size / totalSteps) *
            100
        )

  useEffect(() => {
    setActiveStepIndex((current) =>
      clampStepIndex(current, sop)
    )
  }, [sop])

  useEffect(() => {
    if (!sop) {
      setCompletedStepIds(new Set())
    }
  }, [sop?.id])

  useEffect(() => {
    setIsImageExpanded(false)
  }, [activeStep?.id])

  useEffect(() => {
    if (!sop || imageSignature.length === 0) {
      setImageUrls({})
      setImagesLoading(false)
      return
    }

    const screenshotIds = [
      ...new Set(
        sop.steps
          .map(
            (step) =>
              step.screenshot_reference
          )
          .filter(
            (
              reference
            ): reference is string =>
              Boolean(reference)
          )
      )
    ]

    if (screenshotIds.length === 0) {
      setImageUrls({})
      setImagesLoading(false)
      return
    }

    let cancelled = false
    const createdUrls: string[] = []

    const loadImages = async () => {
      setImagesLoading(true)

      try {
        const evidence =
          await window.api.recording.getSessionScreenshots(
            sop.source_session_id
          )

        const mediaUrls = new Map(
          evidence.map((item) => [
            item.id,
            item.annotated_media_url ??
              item.media_url
          ])
        )

        const entries: Record<string, string> = {}

        for (const screenshotId of screenshotIds) {
          try {
            const buffer =
              await window.api.recording.getSopScreenshotImage(
                sop.source_session_id,
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
            // Missing screenshots should not block the walkthrough.
          }
        }

        if (!cancelled) {
          setImageUrls(entries)
        }
      } catch {
        if (!cancelled) {
          setImageUrls({})
          setError('Could not load screenshots for this walkthrough.')
        }
      } finally {
        if (!cancelled) {
          setImagesLoading(false)
        }
      }
    }

    void loadImages()

    return () => {
      cancelled = true
      createdUrls.forEach((url) =>
        URL.revokeObjectURL(url)
      )
    }
  }, [imageSignature, sop])

  const markActiveDone = () => {
    if (!activeStep) return

    setCompletedStepIds((current) => {
      const next = new Set(current)
      next.add(activeStep.id)
      return next
    })
  }

  const goPrevious = () => {
    setActiveStepIndex((current) =>
      clampStepIndex(current - 1, sop)
    )
  }

  const goNext = () => {
    markActiveDone()
    setActiveStepIndex((current) =>
      clampStepIndex(current + 1, sop)
    )
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft') {
        goPrevious()
      }

      if (event.key === 'ArrowRight') {
        goNext()
      }

      if (event.key === 'Enter') {
        markActiveDone()
      }

      if (event.key === 'Escape') {
        if (isImageExpanded) {
          setIsImageExpanded(false)
          return
        }

        void window.api.walkthrough.setCollapsed(true)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  if (!state) {
    return (
      <main className="grid min-h-screen place-items-center bg-transparent p-3 text-white">
        <section className="rounded-3xl border border-white/10 bg-[#0b0b0b]/95 p-5 shadow-2xl">
          <span className="mx-auto block size-2.5 animate-pulse rounded-full bg-emerald-300" />
        </section>
      </main>
    )
  }

  if (!sop) {
    return (
      <main className="grid min-h-screen place-items-center bg-transparent p-3 text-white">
        <section
          className="w-full rounded-3xl border border-white/12 bg-[#0b0b0b]/95 p-5 text-center shadow-[0_18px_65px_rgba(0,0,0,0.65)] backdrop-blur-xl"
          style={dragStyle}
        >
          <p className="font-mono text-[10px] font-black uppercase tracking-[0.22em] text-white/35">
            Walkthrough
          </p>
          <h1 className="mt-2 text-xl font-black tracking-[-0.04em]">
            No active guide
          </h1>
          <button
            type="button"
            onClick={() =>
              void window.api.walkthrough.close()
            }
            className="mt-5 rounded-2xl bg-white px-5 py-2 text-sm font-black text-black"
            style={noDragStyle}
          >
            Close
          </button>
        </section>
      </main>
    )
  }

  if (state.collapsed) {
    return (
      <CollapsedWalkthrough
        sop={sop}
        activeStep={activeStep}
        activeStepIndex={activeStepIndex}
        totalSteps={totalSteps}
        onExpand={() =>
          void window.api.walkthrough.setCollapsed(false)
        }
        onPrevious={goPrevious}
        onNext={goNext}
        onClose={() =>
          void window.api.walkthrough.close()
        }
      />
    )
  }

  const activeImageUrl =
    activeStep?.screenshot_reference
      ? imageUrls[
          activeStep.screenshot_reference
        ] ?? null
      : null
  const branches =
    activeStep?.decision_branches ?? []

  return (
    <main className="h-screen bg-transparent p-2 text-white">
      <section className="relative flex h-full flex-col overflow-hidden rounded-[1.75rem] border border-white/12 bg-[#080808]/96 shadow-[0_20px_85px_rgba(0,0,0,0.72)] backdrop-blur-2xl">
        <header
          className="border-b border-white/10 bg-white/[0.035] px-4 py-3"
          style={dragStyle}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-mono text-[9px] font-black uppercase tracking-[0.24em] text-emerald-300/70">
                Walkthrough mode
              </p>
              <h1 className="mt-1 truncate text-lg font-black tracking-[-0.04em]">
                {sop.title}
              </h1>
            </div>

            <div
              className="flex shrink-0 items-center gap-1.5"
              style={noDragStyle}
            >
              <button
                type="button"
                onClick={() =>
                  void window.api.walkthrough.setDockSide(
                    'left'
                  )
                }
                className={[
                  'rounded-xl border px-2.5 py-1.5 font-mono text-[9px] font-black uppercase tracking-[0.16em]',
                  state.dockSide === 'left'
                    ? 'border-emerald-300/30 bg-emerald-300/15 text-emerald-200'
                    : 'border-white/10 bg-white/[0.04] text-white/45 hover:bg-white/[0.08]'
                ].join(' ')}
              >
                Left
              </button>
              <button
                type="button"
                onClick={() =>
                  void window.api.walkthrough.setDockSide(
                    'right'
                  )
                }
                className={[
                  'rounded-xl border px-2.5 py-1.5 font-mono text-[9px] font-black uppercase tracking-[0.16em]',
                  state.dockSide === 'right'
                    ? 'border-emerald-300/30 bg-emerald-300/15 text-emerald-200'
                    : 'border-white/10 bg-white/[0.04] text-white/45 hover:bg-white/[0.08]'
                ].join(' ')}
              >
                Right
              </button>
              <button
                type="button"
                onClick={() =>
                  void window.api.walkthrough.setCollapsed(
                    true
                  )
                }
                className="grid size-8 place-items-center rounded-xl border border-white/10 bg-white/[0.04] text-white/50 hover:bg-white/[0.08]"
              >
                –
              </button>
              <button
                type="button"
                onClick={() =>
                  void window.api.walkthrough.close()
                }
                className="grid size-8 place-items-center rounded-xl border border-white/10 bg-white/[0.04] text-white/50 hover:bg-red-500/20 hover:text-red-100"
              >
                ×
              </button>
            </div>
          </div>

          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-gradient-to-r from-emerald-300 to-sky-300 transition-all"
              style={{
                width: `${progressPercent}%`
              }}
            />
          </div>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-[138px_1fr] gap-0">
          <aside className="min-h-0 overflow-y-auto border-r border-white/10 bg-white/[0.018] p-3">
            <div className="space-y-2">
              {sop.steps.map(
                (step, index) => (
                  <StepProgressItem
                    key={step.id}
                    step={step}
                    index={index}
                    active={
                      activeStepIndex === index
                    }
                    complete={completedStepIds.has(
                      step.id
                    )}
                    onSelect={() =>
                      setActiveStepIndex(index)
                    }
                  />
                )
              )}
            </div>
          </aside>

          <section className="min-h-0 overflow-y-auto p-4">
            {activeStep ? (
              <div className="space-y-4">
                <ScreenshotFrame
                  step={activeStep}
                  imageUrl={activeImageUrl}
                  loading={imagesLoading}
                  onExpand={() =>
                    setIsImageExpanded(true)
                  }
                />

                <article className="rounded-[1.4rem] border border-white/10 bg-white/[0.035] p-5">
                  <p className="font-mono text-[10px] font-black uppercase tracking-[0.24em] text-emerald-300/70">
                    Step {activeStep.position} of{' '}
                    {totalSteps}
                  </p>
                  <h2 className="mt-2 text-2xl font-black leading-tight tracking-[-0.05em]">
                    {activeStep.title}
                  </h2>
                  <p className="mt-3 text-base leading-7 text-white/78">
                    {activeStep.instruction}
                  </p>

                  {activeStep.warning && (
                    <div className="mt-4 rounded-2xl border border-amber-300/20 bg-amber-300/[0.07] px-4 py-3">
                      <p className="font-mono text-[9px] font-black uppercase tracking-[0.2em] text-amber-200/70">
                        Warning
                      </p>
                      <p className="mt-1 text-sm leading-6 text-amber-100/85">
                        {activeStep.warning}
                      </p>
                    </div>
                  )}

                  {branches.length > 0 && (
                    <div className="mt-4 space-y-2">
                      <p className="font-mono text-[9px] font-black uppercase tracking-[0.2em] text-sky-200/70">
                        Decision branches
                      </p>
                      {branches.map(
                        (branch, index) => (
                          <div
                            key={`${branch.condition}-${index}`}
                            className="rounded-2xl border border-sky-300/15 bg-sky-300/[0.055] px-4 py-3"
                          >
                            <p className="text-xs font-black text-sky-100">
                              If {branch.condition}
                            </p>
                            <p className="mt-1 text-sm leading-6 text-white/68">
                              {branch.action}
                            </p>
                          </div>
                        )
                      )}
                    </div>
                  )}
                </article>
              </div>
            ) : (
              <div className="grid h-full place-items-center text-center">
                <div>
                  <p className="font-mono text-[10px] font-black uppercase tracking-[0.22em] text-white/35">
                    Empty SOP
                  </p>
                  <p className="mt-2 text-sm text-white/55">
                    This SOP has no steps to follow.
                  </p>
                </div>
              </div>
            )}
          </section>
        </div>

        <footer className="border-t border-white/10 bg-white/[0.035] p-3">
          {error && (
            <p className="mb-3 rounded-2xl border border-red-400/20 bg-red-400/[0.08] px-4 py-2 text-xs text-red-100/85">
              {error}
            </p>
          )}

          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={goPrevious}
              disabled={activeStepIndex === 0}
              className="rounded-2xl border border-white/10 bg-white/[0.045] px-4 py-2.5 text-xs font-black uppercase tracking-[0.12em] text-white/65 transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-35"
              style={noDragStyle}
            >
              Previous
            </button>

            <button
              type="button"
              onClick={markActiveDone}
              disabled={!activeStep}
              className="rounded-2xl border border-emerald-300/25 bg-emerald-300/12 px-4 py-2.5 text-xs font-black uppercase tracking-[0.12em] text-emerald-100 transition hover:bg-emerald-300/18 disabled:cursor-not-allowed disabled:opacity-35"
              style={noDragStyle}
            >
              Mark done
            </button>

            <button
              type="button"
              onClick={goNext}
              disabled={
                !activeStep ||
                activeStepIndex >= totalSteps - 1
              }
              className="rounded-2xl bg-white px-5 py-2.5 text-xs font-black uppercase tracking-[0.12em] text-black transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-35"
              style={noDragStyle}
            >
              Next
            </button>
          </div>
        </footer>

        {isImageExpanded &&
          activeStep &&
          activeImageUrl && (
            <div
              className="absolute inset-0 z-50 bg-black/90 p-3 backdrop-blur-xl"
              onClick={() =>
                setIsImageExpanded(false)
              }
              style={noDragStyle}
            >
              <div
                className="flex h-full flex-col overflow-hidden rounded-[1.55rem] border border-white/15 bg-[#050505] shadow-[0_24px_85px_rgba(0,0,0,0.75)]"
                onClick={(event) =>
                  event.stopPropagation()
                }
              >
                <div className="flex items-center justify-between gap-3 border-b border-white/10 bg-white/[0.04] px-4 py-3">
                  <div className="min-w-0">
                    <p className="font-mono text-[9px] font-black uppercase tracking-[0.24em] text-emerald-300/70">
                      Expanded evidence · Step{' '}
                      {activeStep.position}
                    </p>
                    <h2 className="mt-1 truncate text-sm font-black text-white">
                      {activeStep.title}
                    </h2>
                  </div>

                  <button
                    type="button"
                    onClick={() =>
                      setIsImageExpanded(false)
                    }
                    className="grid size-9 shrink-0 place-items-center rounded-xl border border-white/10 bg-white/[0.06] text-lg text-white/55 transition hover:bg-red-500/20 hover:text-red-100"
                  >
                    ×
                  </button>
                </div>

                <div className="min-h-0 flex-1 overflow-auto bg-black p-3">
                  <img
                    src={activeImageUrl}
                    alt={`${activeStep.title} expanded screenshot`}
                    className="block max-w-none"
                  />
                </div>

                <div className="border-t border-white/10 bg-white/[0.035] px-4 py-2">
                  <p className="text-center font-mono text-[9px] font-bold uppercase tracking-[0.18em] text-white/35">
                    Original size · scroll to inspect · Escape to close
                  </p>
                </div>
              </div>
            </div>
          )}
      </section>
    </main>
  )
}
