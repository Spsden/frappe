import {
  useEffect,
  useState,
  type CSSProperties
} from 'react'
import type {
  ImageViewerPayload,
  ImageViewerWindowState
} from '../../shared/walkthrough'

const dragStyle = {
  WebkitAppRegion: 'drag'
} as CSSProperties

const noDragStyle = {
  WebkitAppRegion: 'no-drag'
} as CSSProperties

export function ImageViewerPage() {
  const [state, setState] =
    useState<ImageViewerWindowState | null>(null)
  const [imageUrl, setImageUrl] =
    useState<string | null>(null)
  const [dimensions, setDimensions] =
    useState<{
      width: number
      height: number
    } | null>(null)
  const [isLoading, setIsLoading] =
    useState(false)
  const [error, setError] =
    useState<string | null>(null)

  const payload: ImageViewerPayload | null =
    state?.payload ?? null

  useEffect(() => {
    void window.api.walkthrough
      .getImageViewerState()
      .then(setState)
      .catch(() =>
        setError('Could not load image viewer.')
      )

    return window.api.walkthrough.onImageViewerStateChanged(
      setState
    )
  }, [])

  useEffect(() => {
    if (!payload) {
      setImageUrl(null)
      setDimensions(null)
      setIsLoading(false)
      return
    }

    let cancelled = false
    let createdUrl: string | null = null

    const loadImage = async () => {
      setIsLoading(true)
      setError(null)
      setDimensions(null)

      try {
        const buffer =
          await window.api.recording.getSopScreenshotImage(
            payload.sessionId,
            payload.screenshotId,
            payload.mediaUrl
          )

        if (cancelled) return

        createdUrl = URL.createObjectURL(
          new Blob([buffer], {
            type: 'image/png'
          })
        )

        setImageUrl(createdUrl)
      } catch (caught) {
        if (!cancelled) {
          setError(
            caught instanceof Error
              ? caught.message
              : 'Could not load screenshot.'
          )
          setImageUrl(null)
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    }

    void loadImage()

    return () => {
      cancelled = true

      if (createdUrl) {
        URL.revokeObjectURL(createdUrl)
      }
    }
  }, [payload])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        void window.api.walkthrough.closeImageViewer()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <main className="flex h-screen flex-col overflow-hidden bg-[#050505] text-white">
      <header
        className="flex shrink-0 items-center justify-between gap-4 border-b border-white/10 bg-[#0b0b0b] px-5 py-4 pl-24"
        style={dragStyle}
      >
        <div className="min-w-0">
          <p className="font-mono text-[10px] font-black uppercase tracking-[0.24em] text-emerald-300/70">
            Image viewer · Step{' '}
            {payload?.stepPosition ?? '—'}
          </p>
          <h1 className="mt-1 truncate text-xl font-black tracking-[-0.04em]">
            {payload?.title ?? 'No screenshot selected'}
          </h1>
        </div>

        <div
          className="flex shrink-0 items-center gap-2"
          style={noDragStyle}
        >
          {dimensions && (
            <span className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 font-mono text-[10px] font-black uppercase tracking-[0.16em] text-white/45">
              {dimensions.width}×
              {dimensions.height}
            </span>
          )}

          <button
            type="button"
            onClick={() =>
              void window.api.walkthrough.closeImageViewer()
            }
            className="rounded-xl border border-white/12 bg-white/[0.06] px-4 py-2 text-xs font-black uppercase tracking-[0.12em] text-white/60 transition hover:bg-red-500/20 hover:text-red-100"
          >
            Close
          </button>
        </div>
      </header>

      <section className="min-h-0 flex-1 overflow-auto bg-black">
        {!payload && (
          <div className="grid h-full place-items-center p-8 text-center">
            <div>
              <p className="font-mono text-[10px] font-black uppercase tracking-[0.24em] text-white/35">
                Empty viewer
              </p>
              <p className="mt-2 text-sm text-white/55">
                Open a screenshot from walkthrough mode.
              </p>
            </div>
          </div>
        )}

        {isLoading && (
          <div className="grid h-full place-items-center">
            <div className="flex items-center gap-3 text-sm font-bold text-white/55">
              <span className="size-2.5 animate-pulse rounded-full bg-emerald-300" />
              Loading full-size screenshot
            </div>
          </div>
        )}

        {error && !isLoading && (
          <div className="grid h-full place-items-center p-8 text-center">
            <p className="rounded-2xl border border-red-400/20 bg-red-400/[0.08] px-5 py-4 text-sm text-red-100/85">
              {error}
            </p>
          </div>
        )}

        {imageUrl && !isLoading && !error && (
          <div className="inline-block min-h-full min-w-full p-6">
            <img
              src={imageUrl}
              alt={`${payload?.title ?? 'Screenshot'} full size`}
              className="block max-w-none select-none"
              draggable={false}
              onLoad={(event) => {
                const image = event.currentTarget
                setDimensions({
                  width: image.naturalWidth,
                  height: image.naturalHeight
                })
              }}
            />
          </div>
        )}
      </section>

      <footer className="shrink-0 border-t border-white/10 bg-[#0b0b0b] px-5 py-2 text-center">
        <p className="font-mono text-[10px] font-black uppercase tracking-[0.2em] text-white/35">
          Actual size · scroll to inspect · Escape to close
        </p>
      </footer>
    </main>
  )
}
