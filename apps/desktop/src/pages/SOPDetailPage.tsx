import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type { BackendSOP, BackendSOPStep, RecordedSessionSummary } from '../../shared/recording'
import { useRecording } from '../features/recording/useRecording'
import { activeRecordingSummary } from '../features/recording/sessionStatus'
import { StepProgress } from '../components/StepProgress'
import { statusForSession, isFailed } from '../features/recording/sessionStatus'

// ─── Markdown renderer (simple, no external deps) ────────────────────────────
// Converts the LLM-generated Markdown document into safe HTML without any
// external library, keeping the bundle lean.
function renderMarkdown(md: string): string {
  return md
    // Headers
    .replace(/^### (.+)$/gm, '<h3 class="text-base font-black mt-5 mb-1 text-white">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 class="text-lg font-black mt-6 mb-2 text-white">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 class="text-xl font-black mt-2 mb-3 text-white">$1</h1>')
    // Bold
    .replace(/\*\*(.+?)\*\*/g, '<strong class="text-white font-bold">$1</strong>')
    // Blockquote warnings
    .replace(/^> (.+)$/gm, '<blockquote class="border-l-2 border-amber-400/60 pl-3 text-amber-200/80 text-sm my-1">$1</blockquote>')
    // Numbered list items
    .replace(/^\d+\. (.+)$/gm, '<li class="ml-4 list-decimal text-sm text-white/70 my-0.5">$1</li>')
    // Bullet list items
    .replace(/^- (.+)$/gm, '<li class="ml-4 list-disc text-sm text-white/70 my-0.5">$1</li>')
    // Horizontal rule
    .replace(/^---$/gm, '<hr class="border-white/10 my-4" />')
    // Paragraph (lines that are not blank and not already HTML)
    .replace(/^(?!<)(.+)$/gm, '<p class="text-sm text-white/65 leading-6">$1</p>')
    // Collapse multiple blank lines
    .replace(/\n{3,}/g, '\n\n')
}

// ─── SOP Screenshot tile ──────────────────────────────────────────────────────
interface StepImageProps {
  sessionId: string
  screenshotId: string
  stepNumber: number
}

function StepImage({ sessionId, screenshotId, stepNumber }: StepImageProps) {
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState(false)
  const urlRef = useRef<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const buffer = await window.api.recording.getSopScreenshotImage(sessionId, screenshotId)
        if (cancelled) return
        const blob = new Blob([buffer], { type: 'image/png' })
        const objectUrl = URL.createObjectURL(blob)
        urlRef.current = objectUrl
        setUrl(objectUrl)
      } catch {
        if (!cancelled) setError(true)
      }
    })()
    return () => {
      cancelled = true
      if (urlRef.current) URL.revokeObjectURL(urlRef.current)
    }
  }, [sessionId, screenshotId])

  if (error) {
    return (
      <div className="flex h-32 w-full items-center justify-center rounded-xl border border-white/10 bg-white/[0.02] text-xs text-white/30">
        Image unavailable
      </div>
    )
  }

  if (!url) {
    return (
      <div className="flex h-32 w-full items-center justify-center rounded-xl border border-white/10 bg-white/[0.02]">
        <span className="size-2 animate-pulse rounded-full bg-white/30" />
      </div>
    )
  }

  return (
    <div className="group relative overflow-hidden rounded-xl border border-white/10 bg-black/40 transition hover:border-white/25">
      <img
        src={url}
        alt={`Step ${stepNumber} screenshot`}
        className="block w-full transition-transform duration-300 group-hover:scale-[1.02]"
      />
      <div className="absolute left-0 top-0 m-2 rounded-md bg-black/60 px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-widest text-white/60 backdrop-blur-sm">
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

function StepCard({ step, sessionId, isActive, onClick }: StepCardProps) {
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
            isActive
              ? 'bg-emerald-400/25 text-emerald-300'
              : 'bg-white/10 text-white/40'
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
        </div>
      </div>
    </button>
  )
}

// ─── PDF download helper ──────────────────────────────────────────────────────
// Constructs a self-contained HTML document and triggers a print/save dialog.
// This is the most robust cross-platform approach in Electron without needing
// any server-side library.
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
          ${step.warning ? `<div class="step-warning">⚠️ ${step.warning}</div>` : ''}
        </div>
      </div>
      ${
        step.screenshot_reference && imageUrls[step.screenshot_reference]
          ? `<img src="${imageUrls[step.screenshot_reference]}" class="step-image" />`
          : ''
      }
    </div>
  `
    )
    .join('')

  const markdownSection = markdownSop?.steps[0]?.instruction
    ? `<div class="markdown-doc"><pre>${markdownSop.steps[0].instruction}</pre></div>`
    : ''

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<title>SOP - ${sop.title}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #111; padding: 32px; max-width: 900px; margin: 0 auto; }
  h1 { font-size: 28px; font-weight: 900; border-bottom: 2px solid #eee; padding-bottom: 12px; }
  .meta { color: #666; font-size: 12px; margin-bottom: 32px; }
  .step { margin-bottom: 32px; border: 1px solid #e5e7eb; border-radius: 12px; padding: 20px; break-inside: avoid; }
  .step-header { display: flex; gap: 16px; margin-bottom: 12px; }
  .step-number { background: #f3f4f6; border-radius: 50%; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; font-weight: 900; font-size: 14px; flex-shrink: 0; }
  .step-title { font-weight: 700; font-size: 13px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.08em; }
  .step-instruction { font-size: 15px; margin-top: 4px; color: #111; line-height: 1.6; }
  .step-warning { font-size: 12px; color: #d97706; margin-top: 8px; }
  .step-image { width: 100%; border-radius: 8px; border: 1px solid #e5e7eb; margin-top: 12px; }
  .markdown-doc { margin-top: 40px; border-top: 2px solid #eee; padding-top: 24px; }
  .markdown-doc pre { background: #f9fafb; padding: 20px; border-radius: 8px; font-size: 13px; white-space: pre-wrap; }
  @media print { .step { break-inside: avoid; } }
</style>
</head>
<body>
<h1>${sop.title}</h1>
<div class="meta">Generated ${new Date(sop.created_at).toLocaleDateString()} · ${sop.steps.length} steps · WorkTrace AI</div>
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
}

function ProcessingBanner({ session }: ProcessingBannerProps) {
  const backendStatus = session.backend?.recording.status
  const hasAudio = session.audioChunkCount > 0
  const failed = isFailed(session)

  if (!backendStatus || backendStatus === 'completed') return null

  return (
    <div className="rounded-2xl border border-amber-400/20 bg-amber-400/[0.06] p-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-amber-400/70">
            SOP Pipeline Running
          </p>
          <p className="mt-0.5 text-sm text-amber-200/70">
            Your recording is being processed. The SOP will appear below when ready.
          </p>
        </div>
        <span className="size-2.5 shrink-0 animate-pulse rounded-full bg-amber-400" />
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

  // Which structured SOP to render (version 2 = individual steps)
  const [activeSopIndex, setActiveSopIndex] = useState(0)
  // Which step card in the left rail is highlighted
  const [activeStepIndex, setActiveStepIndex] = useState(0)
  // Preloaded blob URLs for all screenshot references
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({})
  const [imagesLoading, setImagesLoading] = useState(false)

  // ── Load session + SOPs ───────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false

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
              // Sort ascending by version so v1=rule-based, v2=AI steps, v3=markdown
              setSops(fetched.sort((a, b) => a.version - b.version))
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
        if (!cancelled) setIsLoading(false)
      }
    }

    void load()
    const timer = window.setInterval(() => void load(), 5000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [id, recordingState])

  // ── Preload all annotated images for the active SOP ───────────────────────
  const sessionId = session?.remoteSessionId ?? null

  useEffect(() => {
    if (!sessionId || sops.length === 0) return

    // Pick version 2 (AI step-level SOP) for images; fall back to first
    const targetSop = sops.find((s) => s.version === 2) ?? sops[activeSopIndex]
    const screenshotIds = targetSop.steps
      .map((s) => s.screenshot_reference)
      .filter((id): id is string => Boolean(id))

    if (screenshotIds.length === 0) return

    let cancelled = false
    const createdUrls: string[] = []

    const loadImages = async () => {
      setImagesLoading(true)
      const entries: Record<string, string> = {}
      await Promise.all(
        screenshotIds.map(async (screenshotId) => {
          try {
            const buffer = await window.api.recording.getSopScreenshotImage(
              sessionId,
              screenshotId
            )
            if (cancelled) return
            const blob = new Blob([buffer], { type: 'image/png' })
            const url = URL.createObjectURL(blob)
            createdUrls.push(url)
            entries[screenshotId] = url
          } catch {
            // skip failed images
          }
        })
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
  }, [sessionId, sops, activeSopIndex])

  // ── Derived state ─────────────────────────────────────────────────────────
  // v2 = AI-generated structured steps; v3 = aggregated Markdown doc
  const aiStepSop = sops.find((s) => s.version === 2) ?? null
  const markdownSop = sops.find((s) => s.version === 3) ?? null
  const displaySop = aiStepSop ?? sops[activeSopIndex] ?? null
  const activeStep = displaySop?.steps[activeStepIndex] ?? null
  const hasScreenshot = Boolean(activeStep?.screenshot_reference)

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
            {/* Version selector (only shown when multiple SOPs exist) */}
            {sops.length > 1 && (
              <div className="flex items-center gap-1 rounded-xl border border-white/10 bg-white/[0.03] p-1">
                {sops.slice(0, 2).map((sop, idx) => (
                  <button
                    key={sop.id}
                    type="button"
                    onClick={() => { setActiveSopIndex(idx); setActiveStepIndex(0) }}
                    className={`rounded-lg px-3 py-1.5 text-xs font-black uppercase tracking-[0.1em] transition ${
                      activeSopIndex === idx
                        ? 'bg-white text-black'
                        : 'text-white/50 hover:text-white/80'
                    }`}
                  >
                    v{sop.version}
                  </button>
                ))}
              </div>
            )}
            {/* PDF / Print export */}
            {displaySop && (
              <button
                type="button"
                title="Export as PDF"
                onClick={() => triggerPdfDownload(displaySop, markdownSop, imageUrls)}
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
          {session && <ProcessingBanner session={session} />}

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
                      sessionId={sessionId ?? ''}
                      isActive={activeStepIndex === idx}
                      onClick={() => setActiveStepIndex(idx)}
                    />
                  ))}
                </div>
              </aside>

              {/* ── Right panel: active step detail ─────────────────── */}
              <section className="space-y-5">
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
                            sessionId={sessionId}
                            screenshotId={activeStep.screenshot_reference!}
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
                      {activeStep.estimated_time_ms && (
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

                {/* Full Markdown document panel */}
                {markdownSop?.steps[0]?.instruction && (
                  <div className="rounded-2xl border border-white/10 bg-[#090909] p-6">
                    <div className="mb-4 flex items-center justify-between">
                      <p className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-white/35">
                        Full SOP Document
                      </p>
                      <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-widest text-emerald-400/70">
                        AI Generated
                      </span>
                    </div>
                    <div
                      className="prose-sm space-y-1 text-white/65"
                      // Safe: renderMarkdown only produces known class-tagged HTML
                      dangerouslySetInnerHTML={{
                        __html: renderMarkdown(markdownSop.steps[0].instruction)
                      }}
                    />
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
