import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type { BackendSOP, BackendSOPStep, RecordedSessionSummary } from '../../shared/recording'
import { useRecording } from '../features/recording/useRecording'
import {
  activeRecordingSummary,
  canRetrySop,
  isFailed,
  statusForSession
} from '../features/recording/sessionStatus'
import { StepProgress } from '../components/StepProgress'
import { mapWithConcurrency } from '../utils/async'

// ─── SOP Screenshot tile ──────────────────────────────────────────────────────
interface StepImageProps {
  imageUrl: string | null
  stepNumber: number
}

function StepImage({ imageUrl, stepNumber }: StepImageProps) {
  if (!imageUrl) {
    return (
      <div className="flex h-32 w-full items-center justify-center rounded-xl border border-white/10 bg-white/[0.02] text-xs text-white/30">
        Image unavailable
      </div>
    )
  }

  return (
    <div className="group relative overflow-hidden rounded-xl border border-white/10 bg-black/40 transition hover:border-white/25">
      <img
        src={imageUrl}
        alt={`Step ${stepNumber} screenshot`}
        className="block w-full transition-transform duration-300 group-hover:scale-[1.02]"
      />
      <div className="absolute left-0 top-0 m-2 rounded-md bg-black/60 px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-widest text-white/60 backdrop-blur-sm">
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
        sop.steps.map((step) => step.screenshot_reference ?? '').join(',')
      ].join(':')
    )
    .join('|')
}

// ─── Individual step card ─────────────────────────────────────────────────────
interface StepCardProps {
  step: BackendSOPStep
  isActive: boolean
  onClick: () => void
}

function StepCard({ step, isActive, onClick }: StepCardProps) {
  const hasBranches = step.decision_branches.length > 0
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-2xl border p-4 text-left transition-all duration-200 ${
        isActive
          ? 'border-emerald-500/40 bg-emerald-500/10 shadow-[0_0_20px_rgba(52,211,153,0.08)]'
          : 'border-white/10 bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.06]'
      }`}
    >
      <div className="flex items-start gap-3">
        <span
          className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 font-mono text-[10px] font-black tracking-widest ${
            isActive ? 'bg-emerald-400/25 text-emerald-300' : 'bg-white/10 text-white/40'
          }`}
        >
          {String(step.position).padStart(2, '0')}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-black uppercase tracking-[0.12em] text-white/50">
            {step.title}
          </p>
          <p className="mt-1 text-sm leading-5 text-white/75">{step.instruction}</p>
          {step.warning && (
            <p className="mt-2 text-[11px] text-amber-400/70">⚠️ {step.warning}</p>
          )}
          {hasBranches && (
            <p className="mt-2 font-mono text-[9px] uppercase tracking-[0.18em] text-sky-300/60">
              {step.decision_branches.length} branch
              {step.decision_branches.length === 1 ? '' : 'es'}
            </p>
          )}
        </div>
      </div>
    </button>
  )
}

// ─── PDF download helper ──────────────────────────────────────────────────────
// Constructs a self-contained HTML document and triggers a print/save dialog.
// This is the most robust cross-platform approach in Electron without needing
// any server-side library.
function triggerPdfDownload(sop: BackendSOP, imageUrls: Record<string, string>) {
  const escapeHtml = (value: string) =>
    value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')

  const stepsHtml = sop.steps
    .map((step) => {
      const branchesHtml = step.decision_branches.length
        ? step.decision_branches
            .map(
              (branch) =>
                `<li class="branch"><strong>If:</strong> ${escapeHtml(branch.condition)} <strong>then:</strong> ${escapeHtml(branch.action)}</li>`
            )
            .join('')
        : ''
      return `
    <div class="step">
      <div class="step-header">
        <span class="step-number">${step.position}</span>
        <div>
          <div class="step-title">${escapeHtml(step.title)}</div>
          <div class="step-instruction">${escapeHtml(step.instruction)}</div>
          ${step.warning ? `<div class="step-warning">⚠️ ${escapeHtml(step.warning)}</div>` : ''}
          ${step.estimated_time_ms ? `<div class="step-time">~ ${Math.round(step.estimated_time_ms / 1000)}s</div>` : ''}
        </div>
      </div>
      ${
        step.screenshot_reference && imageUrls[step.screenshot_reference]
          ? `<img src="${imageUrls[step.screenshot_reference]}" class="step-image" />`
          : ''
      }
      ${branchesHtml ? `<ul class="branches">${branchesHtml}</ul>` : ''}
    </div>
  `
    })
    .join('')

  const documentSection = sop.document
    ? `<div class="document"><h2>Overview</h2><p>${escapeHtml(sop.document)}</p></div>`
    : ''

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<title>SOP - ${escapeHtml(sop.title)}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #111; padding: 32px; max-width: 900px; margin: 0 auto; }
  h1 { font-size: 28px; font-weight: 900; border-bottom: 2px solid #eee; padding-bottom: 12px; }
  .meta { color: #666; font-size: 12px; margin-bottom: 32px; }
  .document { margin-bottom: 32px; background: #f9fafb; border-radius: 12px; padding: 20px 24px; }
  .document h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.08em; color: #6b7280; margin: 0 0 8px; }
  .document p { font-size: 14px; line-height: 1.6; margin: 0; }
  .step { margin-bottom: 32px; border: 1px solid #e5e7eb; border-radius: 12px; padding: 20px; break-inside: avoid; }
  .step-header { display: flex; gap: 16px; margin-bottom: 12px; }
  .step-number { background: #f3f4f6; border-radius: 50%; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; font-weight: 900; font-size: 14px; flex-shrink: 0; }
  .step-title { font-weight: 700; font-size: 13px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.08em; }
  .step-instruction { font-size: 15px; margin-top: 4px; color: #111; line-height: 1.6; }
  .step-warning { font-size: 12px; color: #d97706; margin-top: 8px; }
  .step-time { font-size: 11px; color: #9ca3af; margin-top: 6px; font-family: ui-monospace, monospace; }
  .step-image { width: 100%; border-radius: 8px; border: 1px solid #e5e7eb; margin-top: 12px; }
  .branches { margin-top: 12px; padding-left: 18px; }
  .branch { font-size: 13px; color: #374151; margin-bottom: 4px; }
  @media print { .step { break-inside: avoid; } }
</style>
</head>
<body>
<h1>${escapeHtml(sop.title)}</h1>
<div class="meta">Generated ${new Date(sop.created_at).toLocaleDateString()} · ${sop.steps.length} steps · WorkTrace AI</div>
${documentSection}
${stepsHtml}
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

function ProcessingBanner({ session, isRetryingSop, onRetry }: ProcessingBannerProps) {
  const backendStatus = session.backend?.recording.status
  const hasAudio = session.audioChunkCount > 0
  const failed = isFailed(session)
  const sopRetryable = canRetrySop(session)

  if (!backendStatus || backendStatus === 'completed' || backendStatus === 'ready_for_review') return null

  return (
    <div className={`rounded-2xl border p-4 ${
      failed ? 'border-red-500/25 bg-red-500/10' : 'border-amber-400/20 bg-amber-400/[0.06]'
    }`}>
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className={`font-mono text-[10px] font-bold uppercase tracking-[0.2em] ${
            failed ? 'text-red-300/80' : 'text-amber-400/70'
          }`}>
            {failed ? 'SOP Pipeline Failed' : 'SOP Pipeline Running'}
          </p>
          <p className={`mt-0.5 text-sm ${failed ? 'text-red-200/70' : 'text-amber-200/70'}`}>
            {failed
              ? session.backend?.recording.error_message ?? 'The SOP pipeline could not finish.'
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
            {isRetryingSop ? 'Retrying' : 'Retry SOP'}
          </button>
        ) : (
          <span className={`size-2.5 shrink-0 rounded-full ${
            failed ? 'bg-red-500' : 'animate-pulse bg-amber-400'
          }`} />
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
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────
export function SOPDetailPage() {
  const { id = '' } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { state: recordingState } = useRecording()

  const [session, setSession] = useState<RecordedSessionSummary | null>(null)
  const [sops, setSops] = useState<BackendSOP[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isRetryingSop, setIsRetryingSop] = useState(false)

  // Which SOP version to render when more than one exists (e.g. an approved
  // version plus a regenerated draft). There is no longer a fake "full
  // document" version to filter out.
  const [activeSopIndex, setActiveSopIndex] = useState(0)
  // Which step card in the left rail is highlighted
  const [activeStepIndex, setActiveStepIndex] = useState(0)
  // Preloaded blob URLs for all screenshot references
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({})
  const [imagesLoading, setImagesLoading] = useState(false)
  const sopsSignatureRef = useRef('')

  // ── Load session + SOPs ───────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    let timer: number | undefined

    const load = async () => {
      setError(null)
      try {
        const sessions = await window.api.recording.listSessions()
        if (cancelled) return
        const active = activeRecordingSummary(recordingState)
        const merged = active && !sessions.some((item) => item.id === active.id)
          ? [active, ...sessions]
          : sessions.map((item) => (item.id === active?.id ? active : item))
        const found = merged.find((item) => item.id === id) ?? null
        setSession(found)

        if (found?.remoteSessionId) {
          try {
            const fetched = await window.api.recording.getSessionSops(found.remoteSessionId)
            if (!cancelled) {
              // Sort ascending by version. Each SOP is one structured draft;
              // there is no separate markdown version anymore.
              const sorted = fetched.sort((a, b) => a.version - b.version)
              const nextSignature = sopsSignature(sorted)
              if (nextSignature !== sopsSignatureRef.current) {
                sopsSignatureRef.current = nextSignature
                setSops(sorted)
              }
            }
          } catch {
            // SOP not ready yet — keep empty (banner will show)
          }
        }
      } catch (caught) {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : 'Could not load session.')
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false)
          timer = window.setTimeout(() => void load(), 5000)
        }
      }
    }

    void load()
    return () => {
      cancelled = true
      if (timer) window.clearTimeout(timer)
    }
  }, [id, recordingState])

  const retryServerSop = async () => {
    setIsRetryingSop(true)
    setError(null)
    try {
      await window.api.recording.retry(id, 'sop')
      setSops([])
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'SOP retry failed.')
    } finally {
      setIsRetryingSop(false)
    }
  }

  // ── Derived state ─────────────────────────────────────────────────────────
  const sessionId = session?.remoteSessionId ?? null
  const displaySop = sops[activeSopIndex] ?? sops[0] ?? null
  const activeStep = displaySop?.steps[activeStepIndex] ?? null
  const hasScreenshot = Boolean(activeStep?.screenshot_reference)

  // ── Preload all annotated images for the active SOP ───────────────────────
  useEffect(() => {
    if (!sessionId || !displaySop) return

    const screenshotIds = [
      ...new Set(
        displaySop.steps
          .map((s) => s.screenshot_reference)
          .filter((ref): ref is string => Boolean(ref))
      )
    ]

    if (screenshotIds.length === 0) return

    let cancelled = false
    const createdUrls: string[] = []

    const loadImages = async () => {
      setImagesLoading(true)
      const entries: Record<string, string> = {}
      const evidence = await window.api.recording.getSessionScreenshots(sessionId)
      const mediaUrls = new Map(
        evidence.map((item) => [item.id, item.annotated_media_url ?? item.media_url])
      )
      await mapWithConcurrency(
        screenshotIds,
        4,
        async (screenshotId) => {
          try {
            const buffer = await window.api.recording.getSopScreenshotImage(
              sessionId,
              screenshotId,
              mediaUrls.get(screenshotId)
            )
            if (cancelled) return
            const blob = new Blob([buffer], { type: 'image/png' })
            const url = URL.createObjectURL(blob)
            createdUrls.push(url)
            entries[screenshotId] = url
          } catch {
            // skip failed images
          }
        }
      )
      if (!cancelled) {
        setImageUrls(entries)
        setImagesLoading(false)
      }
    }

    void loadImages()
    return () => {
      cancelled = true
      for (const url of createdUrls) URL.revokeObjectURL(url)
    }
  }, [sessionId, displaySop])

  // ── Render guards ─────────────────────────────────────────────────────────
  if (isLoading && !session) {
    return (
      <main className="grid h-[calc(100vh-4rem)] place-items-center">
        <span className="size-2.5 animate-pulse rounded-full bg-white/45" />
      </main>
    )
  }

  if (!session) {
    return (
      <main className="space-y-5 px-6 py-8 md:px-8">
        <button
          type="button"
          onClick={() => navigate('/sessions')}
          className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-white/45 hover:text-white/70"
        >
          ← Back to sessions
        </button>
        <p className="text-sm text-white/50">{error ?? 'Session not found.'}</p>
      </main>
    )
  }

  return (
    <main className="flex h-[calc(100vh-4rem)] flex-col overflow-hidden">
      {/* ── Top bar ───────────────────────────────────────────────────────── */}
      <div className="shrink-0 border-b border-white/10 px-6 py-4 md:px-8">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => navigate(`/sessions/${id}`)}
              className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-white/40 hover:text-white/70 transition"
            >
              ← Session
            </button>
            <span className="text-white/15">/</span>
            <h1 className="text-lg font-black tracking-[-0.02em]">
              {session.name}
              <span className="ml-2 text-sm font-normal text-white/40">— SOP</span>
            </h1>
          </div>
          <div className="flex items-center gap-2">
            {/* Version selector — only meaningful when multiple SOP versions exist. */}
            {sops.length > 1 && (
              <div className="flex items-center gap-1 rounded-xl border border-white/10 bg-white/[0.03] p-1">
                {sops.map((sop, idx) => (
                  <button
                    key={sop.id}
                    type="button"
                    onClick={() => { setActiveSopIndex(idx); setActiveStepIndex(0) }}
                    className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-black uppercase tracking-[0.1em] transition ${
                      activeSopIndex === idx
                        ? 'bg-white text-black'
                        : 'text-white/50 hover:text-white/80'
                    }`}
                  >
                    v{sop.version}
                    {sop.status === 'approved' && (
                      <span className="size-1.5 rounded-full bg-emerald-500" />
                    )}
                  </button>
                ))}
              </div>
            )}
            {/* PDF / Print export */}
            {displaySop && (
              <button
                type="button"
                title="Export as PDF"
                onClick={() => triggerPdfDownload(displaySop, imageUrls)}
                className="flex items-center gap-2 rounded-xl border border-white/15 bg-white/[0.04] px-4 py-2 text-xs font-black uppercase tracking-[0.1em] text-white/70 transition hover:border-white/30 hover:bg-white/10 hover:text-white"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                Export PDF
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Body ──────────────────────────────────────────────────────────── */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="space-y-5 px-6 py-6 md:px-8">

          {/* Processing banner (shown when pipeline is still running) */}
          {session && (
            <ProcessingBanner
              session={session}
              isRetryingSop={isRetryingSop}
              onRetry={() => void retryServerSop()}
            />
          )}

          {error && (
            <p className="rounded-xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-300">
              {error}
            </p>
          )}

          {/* No SOP yet */}
          {!displaySop && !error && (
            <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-10 text-center">
              <span className="mx-auto block size-2.5 animate-pulse rounded-full bg-amber-400/60" />
              <p className="mt-4 text-sm text-white/40">
                Waiting for SOP generation to complete…
              </p>
            </div>
          )}

          {displaySop && (
            <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
              {/* ── Left rail: step list ─────────────────────────────── */}
              <aside className="space-y-2">
                <p className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-white/35">
                  {displaySop.steps.length} Steps
                </p>
                <div className="space-y-2">
                  {displaySop.steps.map((step, idx) => (
                    <StepCard
                      key={step.id}
                      step={step}
                      isActive={activeStepIndex === idx}
                      onClick={() => setActiveStepIndex(idx)}
                    />
                  ))}
                </div>
              </aside>

              {/* ── Right panel: active step detail ─────────────────── */}
              <section className="space-y-5">
                {/* Supporting overview document (not a separate version) */}
                {displaySop.document && (
                  <div className="rounded-2xl border border-white/10 bg-[#090909] p-6">
                    <p className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-white/35">
                      Overview
                    </p>
                    <p className="mt-3 whitespace-pre-line text-sm leading-7 text-white/70">
                      {displaySop.document}
                    </p>
                  </div>
                )}

                {activeStep && (
                  <>
                    {/* Annotated screenshot */}
                    {hasScreenshot && sessionId && (
                      <div className="overflow-hidden rounded-2xl border border-white/10 bg-black/30">
                        {imagesLoading ? (
                          <div className="flex h-48 items-center justify-center">
                            <span className="size-2.5 animate-pulse rounded-full bg-white/30" />
                          </div>
                        ) : (
                          <StepImage
                            imageUrl={imageUrls[activeStep.screenshot_reference!] ?? null}
                            stepNumber={activeStep.position}
                          />
                        )}
                      </div>
                    )}

                    {/* Step detail card */}
                    <div className="rounded-2xl border border-white/10 bg-[#0c0c0c] p-6">
                      <p className="font-mono text-[10px] font-bold uppercase tracking-[0.24em] text-emerald-400/70">
                        Step {activeStep.position} of {displaySop.steps.length}
                      </p>
                      <h2 className="mt-2 text-2xl font-black tracking-[-0.03em]">
                        {activeStep.title}
                      </h2>
                      <p className="mt-3 text-base leading-7 text-white/75">
                        {activeStep.instruction}
                      </p>

                      {activeStep.warning && (
                        <div className="mt-4 rounded-xl border border-amber-400/20 bg-amber-400/[0.06] px-4 py-3">
                          <p className="text-sm text-amber-300/80">⚠️ {activeStep.warning}</p>
                        </div>
                      )}

                      {activeStep.decision_branches.length > 0 && (
                        <div className="mt-4 space-y-2">
                          <p className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-sky-300/70">
                            Decision branches
                          </p>
                          {activeStep.decision_branches.map((branch, idx) => (
                            <div
                              key={idx}
                              className="rounded-xl border border-sky-400/15 bg-sky-400/[0.05] px-4 py-3 text-sm"
                            >
                              <p className="text-white/80">
                                <span className="text-sky-300/80">If</span> {branch.condition}
                              </p>
                              <p className="mt-1 text-white/80">
                                <span className="text-sky-300/80">then</span> {branch.action}
                              </p>
                            </div>
                          ))}
                        </div>
                      )}

                      {activeStep.estimated_time_ms != null && (
                        <p className="mt-3 font-mono text-[10px] text-white/30">
                          Est. {Math.round(activeStep.estimated_time_ms / 1000)}s
                        </p>
                      )}
                    </div>

                    {/* Navigation */}
                    <div className="flex gap-3">
                      <button
                        type="button"
                        disabled={activeStepIndex === 0}
                        onClick={() => setActiveStepIndex((i) => i - 1)}
                        className="flex-1 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-xs font-black uppercase tracking-[0.12em] text-white/60 transition hover:border-white/20 hover:bg-white/[0.07] disabled:cursor-not-allowed disabled:opacity-30"
                      >
                        ← Previous
                      </button>
                      <button
                        type="button"
                        disabled={activeStepIndex === displaySop.steps.length - 1}
                        onClick={() => setActiveStepIndex((i) => i + 1)}
                        className="flex-1 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-xs font-black uppercase tracking-[0.12em] text-white/60 transition hover:border-white/20 hover:bg-white/[0.07] disabled:cursor-not-allowed disabled:opacity-30"
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
