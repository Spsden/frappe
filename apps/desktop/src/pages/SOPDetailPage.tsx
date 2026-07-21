import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type {
  BackendSOP,
  BackendSOPStep,
  RecordedSessionSummary
} from '../../shared/recording'
import { useRecording } from '../features/recording/useRecording'
import {
  activeRecordingSummary,
  canRetrySop,
  isFailed,
  statusForSession
} from '../features/recording/sessionStatus'
import { StepProgress } from '../components/StepProgress'
import { mapWithConcurrency } from '../utils/async'

// ─── Markdown renderer ────────────────────────────────────────────────────────

function renderMarkdown(md: string): string {
  return md
    .replace(
      /^### (.+)$/gm,
      '<h3 class="text-base font-black mt-5 mb-1 text-slate-800">$1</h3>'
    )
    .replace(
      /^## (.+)$/gm,
      '<h2 class="text-lg font-black mt-6 mb-2 text-slate-800">$1</h2>'
    )
    .replace(
      /^# (.+)$/gm,
      '<h1 class="text-xl font-black mt-2 mb-3 text-slate-900">$1</h1>'
    )
    .replace(
      /\*\*(.+?)\*\*/g,
      '<strong class="text-slate-900 font-bold">$1</strong>'
    )
    .replace(
      /^> (.+)$/gm,
      '<blockquote class="border-l-2 border-amber-300 pl-3 text-amber-700 text-sm my-1">$1</blockquote>'
    )
    .replace(
      /^\d+\. (.+)$/gm,
      '<li class="ml-4 list-decimal text-sm text-slate-600 my-0.5">$1</li>'
    )
    .replace(
      /^- (.+)$/gm,
      '<li class="ml-4 list-disc text-sm text-slate-600 my-0.5">$1</li>'
    )
    .replace(
      /^---$/gm,
      '<hr class="border-slate-200 my-4" />'
    )
    .replace(
      /^(?!<)(.+)$/gm,
      '<p class="text-sm text-slate-600 leading-6">$1</p>'
    )
    .replace(/\n{3,}/g, '\n\n')
}

// ─── SOP Screenshot tile ─────────────────────────────────────────────────────

interface StepImageProps {
  imageUrl: string | null
  stepNumber: number
}

function StepImage({
  imageUrl,
  stepNumber
}: StepImageProps) {
  if (!imageUrl) {
    return (
      <div className="flex h-32 w-full items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-xs text-slate-400">
        Image unavailable
      </div>
    )
  }

  return (
    <div className="group relative overflow-hidden rounded-xl border border-slate-200 bg-white transition hover:border-purple-200">
      <img
        src={imageUrl}
        alt={`Step ${stepNumber} screenshot`}
        className="block w-full transition-transform duration-300 group-hover:scale-[1.02]"
      />

      <div className="absolute left-0 top-0 m-2 rounded-md bg-white/90 px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-widest text-slate-600 shadow-sm backdrop-blur-sm">
        Step {stepNumber}
      </div>
    </div>
  )
}

// ─── Individual step card ─────────────────────────────────────────────────────

interface StepCardProps {
  step: BackendSOPStep
  sessionId: string
  isActive: boolean
  onClick: () => void
}

function StepCard({
  step,
  sessionId: _sessionId,
  isActive,
  onClick
}: StepCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-2xl border p-4 text-left transition-all duration-200 ${
        isActive
          ? 'border-purple-300 bg-purple-50 shadow-[0_10px_30px_rgba(166,106,216,0.12)]'
          : 'border-slate-200 bg-white hover:border-purple-200 hover:bg-purple-50/40'
      }`}
    >
      <div className="flex items-start gap-3">
        <span
          className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 font-mono text-[10px] font-black tracking-widest ${
            isActive
              ? 'bg-gradient-to-r from-[#a66ad8] to-[#d783b6] text-white'
              : 'bg-slate-100 text-slate-500'
          }`}
        >
          {String(step.position).padStart(2, '0')}
        </span>

        <div className="min-w-0 flex-1">
          <p className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">
            {step.title}
          </p>

          <p className="mt-1 text-sm leading-5 text-slate-700">
            {step.instruction}
          </p>

          {step.warning && (
            <p className="mt-2 text-[11px] text-amber-600">
              ⚠️ {step.warning}
            </p>
          )}
        </div>
      </div>
    </button>
  )
}

// ─── PDF download helper ──────────────────────────────────────────────────────

function triggerPdfDownload(
  sop: BackendSOP,
  markdownSop: BackendSOP | null,
  imageUrls: Record<string, string>
) {
  const stepsHtml = sop.steps
    .map(
      (step) => `
    <div class="step">
      <div class="step-header">
        <span class="step-number">${step.position}</span>
        <div>
          <div class="step-title">${step.title}</div>
          <div class="step-instruction">${step.instruction}</div>
          ${
            step.warning
              ? `<div class="step-warning">⚠️ ${step.warning}</div>`
              : ''
          }
        </div>
      </div>
      ${
        step.screenshot_reference &&
        imageUrls[step.screenshot_reference]
          ? `<img src="${
              imageUrls[step.screenshot_reference]
            }" class="step-image" />`
          : ''
      }
    </div>
  `
    )
    .join('')

  const markdownSection =
    markdownSop?.steps[0]?.instruction
      ? `<div class="markdown-doc"><pre>${markdownSop.steps[0].instruction}</pre></div>`
      : ''

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<title>SOP - ${sop.title}</title>
<style>
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    color: #111;
    padding: 32px;
    max-width: 900px;
    margin: 0 auto;
  }

  h1 {
    font-size: 28px;
    font-weight: 900;
    border-bottom: 2px solid #eee;
    padding-bottom: 12px;
  }

  .meta {
    color: #666;
    font-size: 12px;
    margin-bottom: 32px;
  }

  .step {
    margin-bottom: 32px;
    border: 1px solid #e5e7eb;
    border-radius: 12px;
    padding: 20px;
    break-inside: avoid;
  }

  .step-header {
    display: flex;
    gap: 16px;
    margin-bottom: 12px;
  }

  .step-number {
    background: #f3f4f6;
    border-radius: 50%;
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 900;
    font-size: 14px;
    flex-shrink: 0;
  }

  .step-title {
    font-weight: 700;
    font-size: 13px;
    color: #6b7280;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  .step-instruction {
    font-size: 15px;
    margin-top: 4px;
    color: #111;
    line-height: 1.6;
  }

  .step-warning {
    font-size: 12px;
    color: #d97706;
    margin-top: 8px;
  }

  .step-image {
    width: 100%;
    border-radius: 8px;
    border: 1px solid #e5e7eb;
    margin-top: 12px;
  }

  .markdown-doc {
    margin-top: 40px;
    border-top: 2px solid #eee;
    padding-top: 24px;
  }

  .markdown-doc pre {
    background: #f9fafb;
    padding: 20px;
    border-radius: 8px;
    font-size: 13px;
    white-space: pre-wrap;
  }

  @media print {
    .step {
      break-inside: avoid;
    }
  }
</style>
</head>

<body>
  <h1>${sop.title}</h1>

  <div class="meta">
    Generated ${new Date(
      sop.created_at
    ).toLocaleDateString()} · ${sop.steps.length} steps · WorkTrace AI
  </div>

  ${stepsHtml}
  ${markdownSection}
</body>
</html>`

  const win = window.open('', '_blank')

  if (!win) return

  win.document.write(html)
  win.document.close()
  win.focus()

  setTimeout(() => win.print(), 500)
}

// ─── Processing state banner ──────────────────────────────────────────────────

interface ProcessingBannerProps {
  session: RecordedSessionSummary
  isRetryingSop: boolean
  onRetry: () => void
}

function ProcessingBanner({
  session,
  isRetryingSop,
  onRetry
}: ProcessingBannerProps) {
  const backendStatus =
    session.backend?.recording.status

  const hasAudio =
    session.audioChunkCount > 0

  const failed =
    isFailed(session)

  const sopRetryable =
    canRetrySop(session)

  if (
    !backendStatus ||
    backendStatus === 'completed' ||
    backendStatus === 'ready_for_review'
  ) {
    return null
  }

  return (
    <div
      className={`overflow-hidden rounded-2xl border bg-white shadow-[0_16px_45px_rgba(95,60,150,0.08)] ${
        failed
          ? 'border-red-200'
          : 'border-purple-100'
      }`}
    >
      <div className="h-1 bg-gradient-to-r from-[#c8a5ff] via-[#d49bea] to-[#ef9dc9]" />

      <div className="p-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p
              className={`font-mono text-[10px] font-bold uppercase tracking-[0.2em] ${
                failed
                  ? 'text-red-500'
                  : 'text-purple-500'
              }`}
            >
              {failed
                ? 'SOP Pipeline Failed'
                : 'SOP Pipeline Running'}
            </p>

            <p
              className={`mt-1 text-sm ${
                failed
                  ? 'text-red-600'
                  : 'text-slate-500'
              }`}
            >
              {failed
                ? session.backend?.recording.error_message ??
                  'The SOP pipeline could not finish.'
                : 'Your recording is being processed. The SOP will appear below when ready.'}
            </p>
          </div>

          {sopRetryable ? (
            <button
              type="button"
              disabled={isRetryingSop}
              onClick={onRetry}
              className="rounded-xl border border-purple-200 bg-purple-50 px-4 py-2 text-xs font-black uppercase tracking-[0.12em] text-purple-700 transition hover:bg-purple-100 disabled:cursor-wait disabled:opacity-40"
            >
              {isRetryingSop
                ? 'Retrying'
                : 'Retry SOP'}
            </button>
          ) : (
            <span
              className={`size-2.5 shrink-0 rounded-full ${
                failed
                  ? 'bg-red-500'
                  : 'animate-pulse bg-purple-400'
              }`}
            />
          )}
        </div>

        <div className="mt-4">
          <StepProgress
            status={statusForSession(session)}
            failed={failed}
            hasAudio={hasAudio}
            barClassName="h-2"
          />
        </div>
      </div>
    </div>
  )
}

function isFullDocumentSop(
  sop: BackendSOP
) {
  return (
    sop.title.endsWith('— Full Document') ||
    sop.steps.some(
      (step) =>
        step.title === 'Full SOP Document'
    )
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function SOPDetailPage() {
  const { id = '' } =
    useParams<{ id: string }>()

  const navigate =
    useNavigate()

  const { state: recordingState } =
    useRecording()

  const [session, setSession] =
    useState<RecordedSessionSummary | null>(null)

  const [sops, setSops] =
    useState<BackendSOP[]>([])

  const [isLoading, setIsLoading] =
    useState(true)

  const [error, setError] =
    useState<string | null>(null)

  const [
    isRetryingSop,
    setIsRetryingSop
  ] = useState(false)

  const [
    activeSopIndex,
    setActiveSopIndex
  ] = useState(0)

  const [
    activeStepIndex,
    setActiveStepIndex
  ] = useState(0)

  const [imageUrls, setImageUrls] =
    useState<Record<string, string>>({})

  const [
    imagesLoading,
    setImagesLoading
  ] = useState(false)

  // ── Load session + SOPs ───────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false
    let timer: number | undefined

    const load = async () => {
      setError(null)

      try {
        const sessions =
          await window.api.recording.listSessions()

        if (cancelled) return

        const active =
          activeRecordingSummary(
            recordingState
          )

        const merged =
          active &&
          !sessions.some(
            (item) => item.id === active.id
          )
            ? [active, ...sessions]
            : sessions.map((item) =>
                item.id === active?.id
                  ? active
                  : item
              )

        const found =
          merged.find(
            (item) => item.id === id
          ) ?? null

        setSession(found)

        if (found?.remoteSessionId) {
          try {
            const fetched =
              await window.api.recording.getSessionSops(
                found.remoteSessionId
              )

            if (!cancelled) {
              setSops(
                fetched.sort(
                  (a, b) =>
                    a.version - b.version
                )
              )
            }
          } catch {
            // SOP not ready yet.
          }
        }
      } catch (caught) {
        if (!cancelled) {
          setError(
            caught instanceof Error
              ? caught.message
              : 'Could not load session.'
          )
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false)

          timer = window.setTimeout(
            () => void load(),
            5000
          )
        }
      }
    }

    void load()

    return () => {
      cancelled = true

      if (timer) {
        window.clearTimeout(timer)
      }
    }
  }, [id, recordingState])

  const retryServerSop =
    async () => {
      setIsRetryingSop(true)
      setError(null)

      try {
        await window.api.recording.retry(
          id,
          'sop'
        )

        setSops([])
      } catch (caught) {
        setError(
          caught instanceof Error
            ? caught.message
            : 'SOP retry failed.'
        )
      } finally {
        setIsRetryingSop(false)
      }
    }

  // ── Derived state ─────────────────────────────────────────────────────────

  const sessionId =
    session?.remoteSessionId ?? null

  const markdownSop =
    sops.find(isFullDocumentSop) ?? null

  const structuredSops =
    sops.filter(
      (sop) =>
        !isFullDocumentSop(sop)
    )

  const displaySop =
    structuredSops[activeSopIndex] ??
    structuredSops[0] ??
    null

  const activeStep =
    displaySop?.steps[
      activeStepIndex
    ] ?? null

  const hasScreenshot =
    Boolean(
      activeStep?.screenshot_reference
    )

  // ── Preload images ────────────────────────────────────────────────────────

  useEffect(() => {
    if (!sessionId || !displaySop) {
      return
    }

    const screenshotIds = [
      ...new Set(
        displaySop.steps
          .map(
            (step) =>
              step.screenshot_reference
          )
          .filter(
            (screenshotId): screenshotId is string =>
              Boolean(screenshotId)
          )
      )
    ]

    if (screenshotIds.length === 0) {
      return
    }

    let cancelled = false

    const createdUrls: string[] = []

    const loadImages = async () => {
      setImagesLoading(true)

      const entries: Record<
        string,
        string
      > = {}

      try {
        const evidence =
          await window.api.recording.getSessionScreenshots(
            sessionId
          )

        const mediaUrls = new Map(
          evidence.map((item) => [
            item.id,
            item.annotated_media_url ??
              item.media_url
          ])
        )

        await mapWithConcurrency(
          screenshotIds,
          4,
          async (screenshotId) => {
            try {
              const buffer =
                await window.api.recording.getSopScreenshotImage(
                  sessionId,
                  screenshotId,
                  mediaUrls.get(
                    screenshotId
                  )
                )

              if (cancelled) return

              const blob = new Blob(
                [buffer],
                {
                  type: 'image/png'
                }
              )

              const url =
                URL.createObjectURL(blob)

              createdUrls.push(url)

              entries[screenshotId] =
                url
            } catch {
              // Skip failed images.
            }
          }
        )

        if (!cancelled) {
          setImageUrls(entries)
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

      for (const url of createdUrls) {
        URL.revokeObjectURL(url)
      }
    }
  }, [sessionId, displaySop])

  // ── Loading / missing session ─────────────────────────────────────────────

  if (isLoading && !session) {
    return (
      <main className="grid min-h-[calc(100vh-3.5rem)] place-items-center bg-[#fafafb]">
        <span className="size-2.5 animate-pulse rounded-full bg-purple-400 shadow-[0_0_14px_rgba(168,85,247,0.45)]" />
      </main>
    )
  }

  if (!session) {
    return (
      <main className="dashboard-page">
        <div className="dashboard-container">
          <button
            type="button"
            onClick={() =>
              navigate('/sessions')
            }
            className="record-workflow-link"
          >
            ← Back to sessions
          </button>

          <p className="muted-text mt-4">
            {error ??
              'Session not found.'}
          </p>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-[calc(100vh-3.5rem)] bg-[#fafafb]">
      {/* Top navigation */}
      <div className="border-b border-slate-200 bg-[#fafafb] px-6 py-4 md:px-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() =>
                navigate(
                  `/sessions/${id}`
                )
              }
              className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 transition hover:text-slate-800"
            >
              ← Session
            </button>

            <span className="text-slate-300">
              /
            </span>

            <h1 className="text-lg font-black tracking-[-0.02em] text-slate-900">
              {session.name}

              <span className="ml-2 text-sm font-normal text-slate-400">
                — SOP
              </span>
            </h1>
          </div>

          <div className="flex items-center gap-2">
            {structuredSops.length >
              1 && (
              <div className="flex items-center gap-1 rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
                {structuredSops.map(
                  (sop, index) => (
                    <button
                      key={sop.id}
                      type="button"
                      onClick={() => {
                        setActiveSopIndex(
                          index
                        )
                        setActiveStepIndex(0)
                      }}
                      className={`rounded-lg px-3 py-1.5 text-xs font-black uppercase tracking-[0.1em] transition ${
                        activeSopIndex ===
                        index
                          ? 'bg-gradient-to-r from-[#a66ad8] to-[#d783b6] text-white'
                          : 'text-slate-500 hover:bg-purple-50 hover:text-purple-700'
                      }`}
                    >
                      v{sop.version}
                    </button>
                  )
                )}
              </div>
            )}

            {displaySop && (
              <button
                type="button"
                title="Export as PDF"
                onClick={() =>
                  triggerPdfDownload(
                    displaySop,
                    markdownSop,
                    imageUrls
                  )
                }
                className="flex items-center gap-2 rounded-xl border border-purple-200 bg-white px-4 py-2 text-xs font-black uppercase tracking-[0.1em] text-purple-700 shadow-sm transition hover:bg-purple-50"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
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

                Export PDF
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Page body */}
      <div className="dashboard-container py-6">
        <div className="space-y-5">
          <ProcessingBanner
            session={session}
            isRetryingSop={
              isRetryingSop
            }
            onRetry={() =>
              void retryServerSop()
            }
          />

          {error && (
            <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
              {error}
            </p>
          )}

          {/* Waiting state */}
          {!displaySop &&
            !error && (
              <div className="table-card recordings-card overflow-hidden">
                <div className="table-card-topline" />

                <div className="p-10 text-center">
                  <span className="mx-auto block size-2.5 animate-pulse rounded-full bg-purple-400 shadow-[0_0_14px_rgba(168,85,247,0.45)]" />

                  <p className="mt-4 text-sm text-slate-500">
                    Waiting for SOP generation
                    to complete…
                  </p>
                </div>
              </div>
            )}

          {/* SOP content */}
          {displaySop && (
            <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
              {/* Left step list */}
              <aside className="space-y-2">
                <p className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">
                  {
                    displaySop.steps
                      .length
                  }{' '}
                  Steps
                </p>

                <div className="space-y-2">
                  {displaySop.steps.map(
                    (step, index) => (
                      <StepCard
                        key={step.id}
                        step={step}
                        sessionId={
                          sessionId ?? ''
                        }
                        isActive={
                          activeStepIndex ===
                          index
                        }
                        onClick={() =>
                          setActiveStepIndex(
                            index
                          )
                        }
                      />
                    )
                  )}
                </div>
              </aside>

              {/* Right step detail */}
              <section className="space-y-5">
                {activeStep && (
                  <>
                    {hasScreenshot &&
                      sessionId && (
                        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_12px_35px_rgba(95,60,150,0.08)]">
                          {imagesLoading ? (
                            <div className="flex h-48 items-center justify-center">
                              <span className="size-2.5 animate-pulse rounded-full bg-purple-300" />
                            </div>
                          ) : (
                            <StepImage
                              imageUrl={
                                imageUrls[
                                  activeStep
                                    .screenshot_reference!
                                ] ?? null
                              }
                              stepNumber={
                                activeStep.position
                              }
                            />
                          )}
                        </div>
                      )}

                    {/* Step card */}
                    <div className="table-card recordings-card overflow-hidden">
                      <div className="table-card-topline" />

                      <div className="p-6">
                        <p className="font-mono text-[10px] font-bold uppercase tracking-[0.24em] text-purple-500">
                          Step{' '}
                          {
                            activeStep.position
                          }{' '}
                          of{' '}
                          {
                            displaySop.steps
                              .length
                          }
                        </p>

                        <h2 className="mt-2 text-2xl font-black tracking-[-0.03em] text-slate-900">
                          {
                            activeStep.title
                          }
                        </h2>

                        <p className="mt-3 text-base leading-7 text-slate-600">
                          {
                            activeStep.instruction
                          }
                        </p>

                        {activeStep.warning && (
                          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                            <p className="text-sm text-amber-700">
                              ⚠️{' '}
                              {
                                activeStep.warning
                              }
                            </p>
                          </div>
                        )}

                        {activeStep.estimated_time_ms && (
                          <p className="mt-3 font-mono text-[10px] text-slate-400">
                            Est.{' '}
                            {Math.round(
                              activeStep.estimated_time_ms /
                                1000
                            )}
                            s
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Previous / Next */}
                    <div className="flex gap-3">
                      <button
                        type="button"
                        disabled={
                          activeStepIndex ===
                          0
                        }
                        onClick={() =>
                          setActiveStepIndex(
                            (index) =>
                              index - 1
                          )
                        }
                        className="flex-1 rounded-xl border border-purple-200 bg-white px-4 py-3 text-xs font-black uppercase tracking-[0.12em] text-purple-700 shadow-sm transition hover:bg-purple-50 disabled:cursor-not-allowed disabled:opacity-30"
                      >
                        ← Previous
                      </button>

                      <button
                        type="button"
                        disabled={
                          activeStepIndex ===
                          displaySop.steps
                            .length -
                            1
                        }
                        onClick={() =>
                          setActiveStepIndex(
                            (index) =>
                              index + 1
                          )
                        }
                        className="flex-1 rounded-xl border border-purple-200 bg-white px-4 py-3 text-xs font-black uppercase tracking-[0.12em] text-purple-700 shadow-sm transition hover:bg-purple-50 disabled:cursor-not-allowed disabled:opacity-30"
                      >
                        Next →
                      </button>
                    </div>
                  </>
                )}

                {/* Full Markdown document */}
                {markdownSop?.steps[0]
                  ?.instruction && (
                  <div className="table-card recordings-card overflow-hidden">
                    <div className="table-card-topline" />

                    <div className="p-6">
                      <div className="mb-4 flex items-center justify-between">
                        <p className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">
                          Full SOP Document
                        </p>

                        <span className="rounded-full border border-purple-200 bg-purple-50 px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-widest text-purple-600">
                          AI Generated
                        </span>
                      </div>

                      <div
                        className="prose-sm space-y-1 text-slate-600"
                        dangerouslySetInnerHTML={{
                          __html:
                            renderMarkdown(
                              markdownSop
                                .steps[0]
                                .instruction
                            )
                        }}
                      />
                    </div>
                  </div>
                )}
              </section>
            </div>
          )}
        </div>
      </div>
    </main>
  )
}