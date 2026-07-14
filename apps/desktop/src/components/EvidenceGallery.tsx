import { useEffect, useState } from 'react'
import type { BackendAnnotation, BackendScreenshotEvidence } from '../../shared/recording'

interface EvidenceGalleryProps {
  remoteSessionId: string | null
}

interface LoadedScreenshot {
  evidence: BackendScreenshotEvidence
  url: string
}

const TYPE_STYLES: Record<
  BackendAnnotation['type'],
  { box: string; tag: string; label: string }
> = {
  click_rectangle: {
    box: 'border-red-500',
    tag: 'bg-red-500/25 text-red-200',
    label: 'Click'
  },
  scroll_focus: {
    box: 'border-sky-400',
    tag: 'bg-sky-400/25 text-sky-200',
    label: 'Scroll'
  },
  pointer_focus: {
    box: 'border-amber-400',
    tag: 'bg-amber-400/25 text-amber-200',
    label: 'Focus'
  }
}

/**
 * Phase 3 evidence view: renders each captured screenshot with its click/scroll
 * highlights drawn as live overlays. Bounds arrive in screenshot-pixel space
 * (Phase 3: from the coordinate pipeline; Phase 2: from accessibility element
 * bounds, flagged with an "AX" tag) and are positioned with percentages so they
 * track the rendered image size exactly. Nothing is baked into the PNGs.
 */
export function EvidenceGallery({ remoteSessionId }: EvidenceGalleryProps) {
  const [screenshots, setScreenshots] = useState<LoadedScreenshot[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!remoteSessionId) {
      setScreenshots([])
      return
    }

    let cancelled = false
    const objectUrls: string[] = []

    const load = async () => {
      setIsLoading(true)
      setError(null)
      try {
        const evidence = await window.api.recording.getSessionScreenshots(remoteSessionId)
        if (cancelled) return
        const loaded = await Promise.all(
          evidence.map(async (item) => {
            const buffer = await window.api.recording.getScreenshotImage(
              remoteSessionId,
              item.id
            )
            const blob = new Blob([buffer], { type: item.media_type || 'image/png' })
            const url = URL.createObjectURL(blob)
            objectUrls.push(url)
            return { evidence: item, url }
          })
        )
        if (!cancelled) setScreenshots(loaded)
      } catch (caught) {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : 'Could not load evidence.')
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    void load()
    return () => {
      cancelled = true
      for (const url of objectUrls) URL.revokeObjectURL(url)
    }
  }, [remoteSessionId])

  if (!remoteSessionId) {
    return (
      <p className="text-sm text-white/45">
        Evidence is unavailable until the session has been uploaded.
      </p>
    )
  }
  if (isLoading && screenshots.length === 0) {
    return <span className="inline-block size-2.5 animate-pulse rounded-full bg-white/45" />
  }
  if (error) {
    return <p className="text-sm text-white/50">{error}</p>
  }
  if (screenshots.length === 0) {
    return <p className="text-sm text-white/45">No screenshots captured for this session.</p>
  }

  return (
    <div className="space-y-4">
      {screenshots.map(({ evidence, url }) => (
        <figure
          key={evidence.id}
          className="overflow-hidden rounded-xl border border-white/10 bg-black/40"
        >
          <div className="relative">
            <img
              src={url}
              alt={`Screenshot ${evidence.sequence}`}
              className="block w-full"
            />
            {evidence.annotations.map((annotation) => {
              const style = TYPE_STYLES[annotation.type] ?? TYPE_STYLES.click_rectangle
              return (
                <div
                  key={annotation.event_id}
                  className={`absolute rounded-sm border-2 ${style.box}`}
                  style={{
                    left: `${(annotation.bounds.x / evidence.width) * 100}%`,
                    top: `${(annotation.bounds.y / evidence.height) * 100}%`,
                    width: `${(annotation.bounds.width / evidence.width) * 100}%`,
                    height: `${(annotation.bounds.height / evidence.height) * 100}%`
                  }}
                  title={`${style.label}${annotation.label ? ': ' + annotation.label : ''}`}
                >
                  <span
                    className={`absolute -top-5 left-0 whitespace-nowrap rounded px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wide ${style.tag}`}
                  >
                    {style.label}
                    {annotation.source === 'accessibility' ? ' · AX' : ''}
                  </span>
                </div>
              )
            })}
          </div>
          <figcaption className="flex items-center justify-between gap-3 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-white/45">
            <span>Frame {evidence.sequence}</span>
            <span>
              {evidence.annotations.length} highlight
              {evidence.annotations.length === 1 ? '' : 's'}
            </span>
          </figcaption>
        </figure>
      ))}
    </div>
  )
}
