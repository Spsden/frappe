import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type {
  BackendSOP,
  BackendSOPStep,
  RecordedSessionSummary
} from '../../shared/recording'
import { StepProgress } from '../components/StepProgress'
import { useRecording } from '../features/recording/useRecording'
import {
  activeRecordingSummary,
  canRetrySop,
  isFailed,
  statusForSession
} from '../features/recording/sessionStatus'
import { useTheme } from '../features/theme/ThemeContext'
import { mapWithConcurrency } from '../utils/async'
import { triggerSopPdfExport } from '../utils/sopPdf'

// ─── SOP Screenshot tile ──────────────────────────────────────────────────────
interface StepImageProps {
  imageUrl: string | null
  stepNumber: number
  isDark: boolean
}

function StepImage({
  imageUrl,
  stepNumber,
  isDark
}: StepImageProps) {
  if (!imageUrl) {
    return (
      <div
        className={
          isDark
            ? 'flex h-32 w-full items-center justify-center rounded-xl border border-white/10 bg-white/[0.02] text-xs text-white/30'
            : 'flex h-32 w-full items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-xs text-slate-400'
        }
      >
        Image unavailable
      </div>
    )
  }

  return (
    <div
      className={
        isDark
          ? 'group relative overflow-hidden rounded-xl border border-white/10 bg-black/40 transition hover:border-white/25'
          : 'group relative overflow-hidden rounded-xl border border-slate-200 bg-white transition hover:border-purple-200'
      }
    >
      <img
        src={imageUrl}
        alt={`Step ${stepNumber} screenshot`}
        className="block w-full transition-transform duration-300 group-hover:scale-[1.02]"
      />

      <div
        className={
          isDark
            ? 'absolute left-0 top-0 m-2 rounded-md bg-black/60 px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-widest text-white/60 backdrop-blur-sm'
            : 'absolute left-0 top-0 m-2 rounded-md bg-white/90 px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-widest text-slate-600 shadow-sm backdrop-blur-sm'
        }
      >
        Step {stepNumber}
      </div>
    </div>
  )
}

function sopsSignature(sops: BackendSOP[]): string {
  return sops
    .map((sop) =>
      [
        sop.id,
        sop.source_session_id,
        sop.version,
        sop.status,
        sop.steps.length,
        sop.steps
          .map(
            (step) =>
              step.screenshot_reference ?? ''
          )
          .join(',')
      ].join(':')
    )
    .join('|')
}

function shouldKeepPollingSop(
  session: RecordedSessionSummary | null,
  sops: BackendSOP[]
): boolean {
  if (!session?.remoteSessionId) {
    return true
  }

  const status = statusForSession(session)

  if (
    status === 'ready_for_review' ||
    status === 'completed'
  ) {
    return sops.length === 0
  }

  return (
    status !== 'failed' &&
    status !== 'sop_failed'
  )
}

// ─── Individual step card ─────────────────────────────────────────────────────
interface StepCardProps {
  step: BackendSOPStep
  isActive: boolean
  onClick: () => void
  isDark: boolean
}

function StepCard({
  step,
  isActive,
  onClick,
  isDark
}: StepCardProps) {
  const branches =
    step.decision_branches ?? []

  const hasBranches =
    branches.length > 0

  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'w-full rounded-2xl border p-4 text-left transition-all duration-200',
        isDark
          ? isActive
            ? 'border-emerald-500/40 bg-emerald-500/10 shadow-[0_0_20px_rgba(52,211,153,0.08)]'
            : 'border-white/10 bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.06]'
          : isActive
            ? 'border-purple-300 bg-purple-50 shadow-[0_10px_30px_rgba(166,106,216,0.12)]'
            : 'border-slate-200 bg-white hover:border-purple-200 hover:bg-purple-50/40'
      ].join(' ')}
    >
      <div className="flex items-start gap-3">
        <span
          className={[
            'mt-0.5 shrink-0 rounded-full px-2 py-0.5 font-mono text-[10px] font-black tracking-widest',
            isDark
              ? isActive
                ? 'bg-emerald-400/25 text-emerald-300'
                : 'bg-white/10 text-white/40'
              : isActive
                ? 'bg-gradient-to-r from-[#a66ad8] to-[#d783b6] text-white'
                : 'bg-slate-100 text-slate-500'
          ].join(' ')}
        >
          {String(step.position).padStart(
            2,
            '0'
          )}
        </span>

        <div className="min-w-0 flex-1">
          <p
            className={
              isDark
                ? 'text-xs font-black uppercase tracking-[0.12em] text-white/50'
                : 'text-xs font-black uppercase tracking-[0.12em] text-slate-600'
            }
          >
            {step.title}
          </p>

          <p
            className={
              isDark
                ? 'mt-1 text-sm leading-5 text-white/75'
                : 'mt-1 text-sm leading-5 text-slate-700'
            }
          >
            {step.instruction}
          </p>

          {step.warning && (
            <p
              className={
                isDark
                  ? 'mt-2 text-[11px] text-amber-400/70'
                  : 'mt-2 text-[11px] text-amber-600'
              }
            >
              ⚠️ {step.warning}
            </p>
          )}

          {hasBranches && (
            <p
              className={
                isDark
                  ? 'mt-2 font-mono text-[9px] uppercase tracking-[0.18em] text-sky-300/60'
                  : 'mt-2 font-mono text-[9px] uppercase tracking-[0.18em] text-sky-600'
              }
            >
              {branches.length} branch
              {branches.length === 1
                ? ''
                : 'es'}
            </p>
          )}
        </div>
      </div>
    </button>
  )
}

// ─── PDF download helper ──────────────────────────────────────────────────────
// The actual export lives in `utils/sopPdf.ts` so the SOP Library page can
// reuse it. This file owns the per-step image-blob lifecycle that the
// export consumes.

// ─── Processing state banner ──────────────────────────────────────────────────
interface ProcessingBannerProps {
  session: RecordedSessionSummary
  isRetryingSop: boolean
  onRetry: () => void
  isDark: boolean
}

function ProcessingBanner({
  session,
  isRetryingSop,
  onRetry,
  isDark
}: ProcessingBannerProps) {
  const backendStatus =
    session.backend?.recording.status

  const hasAudio =
    session.audioChunkCount > 0

  const failed = isFailed(session)

  const sopRetryable =
    canRetrySop(session)

  if (
    !backendStatus ||
    backendStatus === 'completed' ||
    backendStatus === 'ready_for_review'
  ) {
    return null
  }

  if (isDark) {
    return (
      <div
        className={[
          'rounded-2xl border p-4',
          failed
            ? 'border-red-500/25 bg-red-500/10'
            : 'border-amber-400/20 bg-amber-400/[0.06]'
        ].join(' ')}
      >
        <div className="flex items-center justify-between gap-4">
          <div>
            <p
              className={[
                'font-mono text-[10px] font-bold uppercase tracking-[0.2em]',
                failed
                  ? 'text-red-300/80'
                  : 'text-amber-400/70'
              ].join(' ')}
            >
              {failed
                ? 'SOP Pipeline Failed'
                : 'SOP Pipeline Running'}
            </p>

            <p
              className={[
                'mt-0.5 text-sm',
                failed
                  ? 'text-red-200/70'
                  : 'text-amber-200/70'
              ].join(' ')}
            >
              {failed
                ? session.backend?.recording
                    .error_message ??
                  'The SOP pipeline could not finish.'
                : 'Your recording is being processed. The SOP will appear below when ready.'}
            </p>
          </div>

          {sopRetryable ? (
            <button
              type="button"
              disabled={isRetryingSop}
              onClick={onRetry}
              className="rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-2 text-xs font-black uppercase tracking-[0.12em] text-amber-200 transition hover:bg-amber-400/18 disabled:cursor-wait disabled:opacity-40"
            >
              {isRetryingSop
                ? 'Retrying'
                : 'Retry SOP'}
            </button>
          ) : (
            <span
              className={[
                'size-2.5 shrink-0 rounded-full',
                failed
                  ? 'bg-red-500'
                  : 'animate-pulse bg-amber-400'
              ].join(' ')}
            />
          )}
        </div>

        <div className="mt-4">
          <StepProgress
            status={statusForSession(
              session
            )}
            failed={failed}
            hasAudio={hasAudio}
            barClassName="h-2"
          />
        </div>
      </div>
    )
  }

  return (
    <div
      className={[
        'overflow-hidden rounded-2xl border bg-white shadow-[0_16px_45px_rgba(95,60,150,0.08)]',
        failed
          ? 'border-red-200'
          : 'border-purple-100'
      ].join(' ')}
    >
      <div
        className={[
          'h-1',
          failed
            ? 'bg-gradient-to-r from-red-300 to-red-500'
            : 'bg-gradient-to-r from-[#c8a5ff] via-[#d49bea] to-[#ef9dc9]'
        ].join(' ')}
      />

      <div className="p-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p
              className={[
                'font-mono text-[10px] font-bold uppercase tracking-[0.2em]',
                failed
                  ? 'text-red-500'
                  : 'text-purple-500'
              ].join(' ')}
            >
              {failed
                ? 'SOP Pipeline Failed'
                : 'SOP Pipeline Running'}
            </p>

            <p
              className={[
                'mt-1 text-sm',
                failed
                  ? 'text-red-600'
                  : 'text-slate-500'
              ].join(' ')}
            >
              {failed
                ? session.backend?.recording
                    .error_message ??
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
              className={[
                'size-2.5 shrink-0 rounded-full',
                failed
                  ? 'bg-red-500'
                  : 'animate-pulse bg-purple-400'
              ].join(' ')}
            />
          )}
        </div>

        <div className="mt-4">
          <StepProgress
            status={statusForSession(
              session
            )}
            failed={failed}
            hasAudio={hasAudio}
            barClassName="h-2"
          />
        </div>
      </div>
    </div>
  )
}

export function SOPDetailPage() {
  const { id = '' } =
    useParams<{ id: string }>()

  const navigate = useNavigate()

  const { state: recordingState } =
    useRecording()

  const { theme } = useTheme()
  const isDark = theme === 'dark'

  const [session, setSession] =
    useState<RecordedSessionSummary | null>(
      null
    )

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
    isExportingPdf,
    setIsExportingPdf
  ] = useState(false)

  const [
    isStartingWalkthrough,
    setIsStartingWalkthrough
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

  const sopsSignatureRef = useRef('')

  useEffect(() => {
    let cancelled = false
    let timer: number | undefined

    const load = async () => {
      let keepPolling = true
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
            (item) =>
              item.id === active.id
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

            const sorted = fetched.sort(
              (a, b) =>
                a.version - b.version
            )

            keepPolling =
              shouldKeepPollingSop(
                found,
                sorted
              )

            if (!cancelled) {
              const nextSignature =
                sopsSignature(sorted)

              if (
                nextSignature !==
                sopsSignatureRef.current
              ) {
                sopsSignatureRef.current =
                  nextSignature

                setSops(sorted)
              }
            }
          } catch {
            // SOP may not be ready yet.
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

          if (keepPolling) {
            timer = window.setTimeout(
              () => void load(),
              5000
            )
          }
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

  const retryServerSop = async () => {
    setIsRetryingSop(true)
    setError(null)

    try {
      await window.api.recording.retry(
        id,
        'sop'
      )

      setSops([])
      sopsSignatureRef.current = ''
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

  const exportPdf = async (
    sop: BackendSOP
  ) => {
    setIsExportingPdf(true)
    setError(null)

    try {
      await triggerSopPdfExport(
        sop,
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

  const startWalkthrough = async (
    sop: BackendSOP
  ) => {
    setIsStartingWalkthrough(true)
    setError(null)

    try {
      await window.api.walkthrough.open({
        sop,
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

  const sessionId =
    session?.remoteSessionId ?? null

  const displaySop =
    sops[activeSopIndex] ??
    sops[0] ??
    null

  const activeStep =
    displaySop?.steps[
      activeStepIndex
    ] ?? null

  const hasScreenshot = Boolean(
    activeStep?.screenshot_reference
  )

  const activeBranches =
    activeStep?.decision_branches ?? []

  useEffect(() => {
    if (sops.length === 0) {
      setActiveSopIndex(0)
      return
    }

    if (activeSopIndex >= sops.length) {
      setActiveSopIndex(0)
    }
  }, [activeSopIndex, sops.length])

  useEffect(() => {
    if (!displaySop || displaySop.steps.length === 0) {
      setActiveStepIndex(0)
      return
    }

    if (activeStepIndex >= displaySop.steps.length) {
      setActiveStepIndex(0)
    }
  }, [activeStepIndex, displaySop])

  useEffect(() => {
    if (!sessionId || !displaySop) {
      setImageUrls({})
      setImagesLoading(false)
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
            (
              reference
            ): reference is string =>
              Boolean(reference)
          )
      )
    ]

    if (
      screenshotIds.length === 0
    ) {
      setImageUrls({})
      setImagesLoading(false)
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
              entries[screenshotId] = url
            } catch {
              // Skip failed images.
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

  if (isLoading && !session) {
    return (
      <main
        className={
          isDark
            ? 'grid h-[calc(100vh-4rem)] place-items-center'
            : 'grid h-[calc(100vh-4rem)] place-items-center bg-[#fafafb]'
        }
      >
        <span
          className={
            isDark
              ? 'size-2.5 animate-pulse rounded-full bg-white/45'
              : 'size-2.5 animate-pulse rounded-full bg-purple-400 shadow-[0_0_14px_rgba(168,85,247,0.45)]'
          }
        />
      </main>
    )
  }

  if (!session) {
    return (
      <main
        className={
          isDark
            ? 'space-y-5 px-6 py-8 md:px-8'
            : 'space-y-5 bg-[#fafafb] px-6 py-8 text-slate-900 md:px-8'
        }
      >
        <button
          type="button"
          onClick={() =>
            navigate('/sessions')
          }
          className={
            isDark
              ? 'font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-white/45 transition hover:text-white/70'
              : 'text-sm font-bold text-slate-600 transition hover:text-purple-700'
          }
        >
          ← Back to sessions
        </button>

        <p
          className={
            isDark
              ? 'text-sm text-white/50'
              : 'text-sm text-slate-500'
          }
        >
          {error ?? 'Session not found.'}
        </p>
      </main>
    )
  }

  return (
    <main
      className={[
        'flex h-[calc(100vh-4rem)] flex-col overflow-hidden',
        isDark
          ? 'text-white'
          : 'bg-[#fafafb] text-slate-900'
      ].join(' ')}
    >
      <div
        className={
          isDark
            ? 'shrink-0 border-b border-white/10 px-6 py-4 md:px-8'
            : 'shrink-0 border-b border-slate-200 bg-white px-6 py-4 md:px-8'
        }
      >
        <div className="flex items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-4">
            <button
              type="button"
              onClick={() =>
                navigate(
                  `/sessions/${id}`
                )
              }
              className={
                isDark
                  ? 'shrink-0 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-white/40 transition hover:text-white/70'
                  : 'shrink-0 text-sm font-bold text-slate-600 transition hover:text-purple-700'
              }
            >
              ← Session
            </button>

            <span
              className={
                isDark
                  ? 'text-white/15'
                  : 'text-slate-300'
              }
            >
              /
            </span>

            <h1
              className={
                isDark
                  ? 'min-w-0 truncate text-lg font-black tracking-[-0.02em]'
                  : 'min-w-0 truncate text-lg font-black tracking-[-0.02em] text-slate-900'
              }
            >
              {session.name}

              <span
                className={
                  isDark
                    ? 'ml-2 text-sm font-normal text-white/40'
                    : 'ml-2 text-sm font-normal text-slate-400'
                }
              >
                — SOP
              </span>
            </h1>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {sops.length > 1 && (
              <div
                className={
                  isDark
                    ? 'flex items-center gap-1 rounded-xl border border-white/10 bg-white/[0.03] p-1'
                    : 'flex items-center gap-1 rounded-xl border border-slate-200 bg-white p-1 shadow-sm'
                }
              >
                {sops.map(
                  (sop, index) => (
                    <button
                      key={sop.id}
                      type="button"
                      onClick={() => {
                        setActiveSopIndex(
                          index
                        )

                        setActiveStepIndex(
                          0
                        )
                      }}
                      className={[
                        'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-black uppercase tracking-[0.1em] transition',
                        activeSopIndex ===
                        index
                          ? isDark
                            ? 'bg-white text-black'
                            : 'bg-gradient-to-r from-[#a66ad8] to-[#d783b6] text-white'
                          : isDark
                            ? 'text-white/50 hover:text-white/80'
                            : 'text-slate-500 hover:bg-purple-50 hover:text-purple-700'
                      ].join(' ')}
                    >
                      v{sop.version}

                      {sop.status ===
                        'approved' && (
                        <span className="size-1.5 rounded-full bg-emerald-500" />
                      )}
                    </button>
                  )
                )}
              </div>
            )}
            {displaySop?.status ===
              'approved' &&
              displaySop.steps.length > 0 && (
                <button
                  type="button"
                  title="Start walkthrough"
                  disabled={isStartingWalkthrough}
                  onClick={() =>
                    void startWalkthrough(
                      displaySop
                    )
                  }
                  className={
                    isDark
                      ? 'flex items-center gap-2 rounded-xl border border-emerald-300/25 bg-emerald-300/10 px-4 py-2 text-xs font-black uppercase tracking-[0.1em] text-emerald-100 transition hover:border-emerald-300/40 hover:bg-emerald-300/16 disabled:cursor-wait disabled:opacity-50'
                      : 'flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-2.5 text-sm font-bold text-emerald-700 shadow-[0_8px_20px_rgba(16,185,129,0.12)] transition hover:-translate-y-0.5 hover:bg-emerald-100 disabled:cursor-wait disabled:opacity-50'
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
            {/* PDF / Print export */}
            {displaySop && (
              <button
                type="button"
                title="Export as PDF"
                disabled={isExportingPdf}
                onClick={() =>
                  void exportPdf(
                    displaySop
                  )
                }
                className={
                  isDark
                    ? 'flex items-center gap-2 rounded-xl border border-white/15 bg-white/[0.04] px-4 py-2 text-xs font-black uppercase tracking-[0.1em] text-white/70 transition hover:border-white/30 hover:bg-white/10 hover:text-white disabled:cursor-wait disabled:opacity-50'
                    : 'flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#a66ad8] to-[#d783b6] px-5 py-2.5 text-sm font-bold text-white shadow-[0_8px_20px_rgba(166,106,216,0.24)] transition hover:-translate-y-0.5 hover:shadow-[0_12px_26px_rgba(166,106,216,0.32)] disabled:cursor-wait disabled:opacity-50'
                }
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

                {isExportingPdf
                  ? 'Exporting'
                  : 'Export PDF'}
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="space-y-5 px-6 py-6 md:px-8">
          <ProcessingBanner
            session={session}
            isRetryingSop={
              isRetryingSop
            }
            onRetry={() =>
              void retryServerSop()
            }
            isDark={isDark}
          />

          {error && (
            <p
              className={
                isDark
                  ? 'rounded-xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-300'
                  : 'rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600'
              }
            >
              {error}
            </p>
          )}

          {!displaySop && !error && (
            <div
              className={
                isDark
                  ? 'rounded-2xl border border-white/10 bg-white/[0.02] p-10 text-center'
                  : 'relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-10 text-center shadow-sm'
              }
            >
              {!isDark && (
                <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[#a66ad8] via-[#c778d7] to-[#d783b6]" />
              )}

              <span
                className={
                  isDark
                    ? 'mx-auto block size-2.5 animate-pulse rounded-full bg-amber-400/60'
                    : 'mx-auto block size-2.5 animate-pulse rounded-full bg-purple-400 shadow-[0_0_14px_rgba(168,85,247,0.45)]'
                }
              />

              <p
                className={
                  isDark
                    ? 'mt-4 text-sm text-white/40'
                    : 'mt-4 text-sm text-slate-500'
                }
              >
                Waiting for SOP generation
                to complete…
              </p>
            </div>
          )}

          {displaySop && (
            <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
              <aside className="space-y-2">
                <p
                  className={
                    isDark
                      ? 'font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-white/35'
                      : 'font-mono text-[10px] font-bold uppercase tracking-[0.24em] text-purple-500'
                  }
                >
                  {displaySop.steps.length}{' '}
                  Steps
                </p>

                <div className="space-y-2">
                  {displaySop.steps.map(
                    (step, index) => (
                      <StepCard
                        key={step.id}
                        step={step}
                        isActive={
                          activeStepIndex ===
                          index
                        }
                        onClick={() =>
                          setActiveStepIndex(
                            index
                          )
                        }
                        isDark={isDark}
                      />
                    )
                  )}
                </div>
              </aside>

              <section className="min-w-0 space-y-5">
                {displaySop.document && (
                  <div
                    className={
                      isDark
                        ? 'rounded-2xl border border-white/10 bg-[#090909] p-6'
                        : 'relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-6 pt-7 shadow-sm'
                    }
                  >
                    {!isDark && (
                      <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[#a66ad8] via-[#c778d7] to-[#d783b6]" />
                    )}

                    <p
                      className={
                        isDark
                          ? 'font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-white/35'
                          : 'font-mono text-[10px] font-bold uppercase tracking-[0.24em] text-purple-500'
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
                      {displaySop.document}
                    </p>
                  </div>
                )}

                {activeStep && (
                  <>
                    {hasScreenshot &&
                      sessionId && (
                        <div
                          className={
                            isDark
                              ? 'overflow-hidden rounded-2xl border border-white/10 bg-black/30'
                              : 'overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm'
                          }
                        >
                          {imagesLoading ? (
                            <div className="flex h-48 items-center justify-center">
                              <span
                                className={
                                  isDark
                                    ? 'size-2.5 animate-pulse rounded-full bg-white/30'
                                    : 'size-2.5 animate-pulse rounded-full bg-purple-300'
                                }
                              />
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
                              isDark={
                                isDark
                              }
                            />
                          )}
                        </div>
                      )}

                    <div
                      className={
                        isDark
                          ? 'rounded-2xl border border-white/10 bg-[#0c0c0c] p-6'
                          : 'rounded-2xl border border-slate-200 bg-white p-6 shadow-sm'
                      }
                    >
                      <p
                        className={
                          isDark
                            ? 'font-mono text-[10px] font-bold uppercase tracking-[0.24em] text-emerald-400/70'
                            : 'font-mono text-[10px] font-bold uppercase tracking-[0.24em] text-purple-500'
                        }
                      >
                        Step{' '}
                        {activeStep.position}{' '}
                        of{' '}
                        {
                          displaySop.steps
                            .length
                        }
                      </p>

                      <h2
                        className={
                          isDark
                            ? 'mt-2 text-2xl font-black tracking-[-0.03em]'
                            : 'mt-2 text-2xl font-black tracking-[-0.03em] text-slate-900'
                        }
                      >
                        {activeStep.title}
                      </h2>

                      <p
                        className={
                          isDark
                            ? 'mt-3 text-base leading-7 text-white/75'
                            : 'mt-3 text-base leading-7 text-slate-600'
                        }
                      >
                        {
                          activeStep.instruction
                        }
                      </p>

                      {activeStep.warning && (
                        <div
                          className={
                            isDark
                              ? 'mt-4 rounded-xl border border-amber-400/20 bg-amber-400/[0.06] px-4 py-3'
                              : 'mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3'
                          }
                        >
                          <p
                            className={
                              isDark
                                ? 'text-sm text-amber-300/80'
                                : 'text-sm text-amber-700'
                            }
                          >
                            ⚠️{' '}
                            {
                              activeStep.warning
                            }
                          </p>
                        </div>
                      )}

                      {activeBranches.length >
                        0 && (
                        <div className="mt-5 space-y-2">
                          <p
                            className={
                              isDark
                                ? 'font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-sky-300/70'
                                : 'font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-sky-600'
                            }
                          >
                            Decision branches
                          </p>

                          {activeBranches.map(
                            (
                              branch,
                              index
                            ) => (
                              <div
                                key={`${branch.condition}-${index}`}
                                className={
                                  isDark
                                    ? 'rounded-xl border border-sky-400/15 bg-sky-400/[0.05] px-4 py-3 text-sm'
                                    : 'rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm'
                                }
                              >
                                <p
                                  className={
                                    isDark
                                      ? 'text-white/80'
                                      : 'text-slate-700'
                                  }
                                >
                                  <span
                                    className={
                                      isDark
                                        ? 'text-sky-300/80'
                                        : 'font-bold text-sky-700'
                                    }
                                  >
                                    If
                                  </span>{' '}
                                  {
                                    branch.condition
                                  }
                                </p>

                                <p
                                  className={
                                    isDark
                                      ? 'mt-1 text-white/80'
                                      : 'mt-1 text-slate-700'
                                  }
                                >
                                  <span
                                    className={
                                      isDark
                                        ? 'text-sky-300/80'
                                        : 'font-bold text-sky-700'
                                    }
                                  >
                                    Then
                                  </span>{' '}
                                  {
                                    branch.action
                                  }
                                </p>
                              </div>
                            )
                          )}
                        </div>
                      )}

                      {activeStep.estimated_time_ms !=
                        null && (
                        <p
                          className={
                            isDark
                              ? 'mt-3 font-mono text-[10px] text-white/30'
                              : 'mt-3 font-mono text-[10px] text-slate-400'
                          }
                        >
                          Est.{' '}
                          {Math.round(
                            activeStep.estimated_time_ms /
                              1000
                          )}
                          s
                        </p>
                      )}
                    </div>

                    <div className="flex gap-3">
                      <button
                        type="button"
                        disabled={
                          activeStepIndex === 0
                        }
                        onClick={() =>
                          setActiveStepIndex(
                            (index) =>
                              index - 1
                          )
                        }
                        className={
                          isDark
                            ? 'flex-1 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-xs font-black uppercase tracking-[0.12em] text-white/60 transition hover:border-white/20 hover:bg-white/[0.07] disabled:cursor-not-allowed disabled:opacity-30'
                            : 'flex-1 rounded-xl border border-purple-200 bg-white px-4 py-3 text-sm font-bold text-purple-700 shadow-sm transition hover:border-purple-300 hover:bg-purple-50 disabled:cursor-not-allowed disabled:opacity-30'
                        }
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
                        className={
                          isDark
                            ? 'flex-1 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-xs font-black uppercase tracking-[0.12em] text-white/60 transition hover:border-white/20 hover:bg-white/[0.07] disabled:cursor-not-allowed disabled:opacity-30'
                            : 'flex-1 rounded-xl border border-purple-200 bg-white px-4 py-3 text-sm font-bold text-purple-700 shadow-sm transition hover:border-purple-300 hover:bg-purple-50 disabled:cursor-not-allowed disabled:opacity-30'
                        }
                      >
                        Next →
                      </button>
                    </div>
                  </>
                )}
              </section>
            </div>
          )}
        </div>
      </div>
    </main>
  )
}
