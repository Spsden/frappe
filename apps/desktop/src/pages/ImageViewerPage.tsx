import {
  useEffect,
  useRef,
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

const MIN_ZOOM = 0.25
const MAX_ZOOM = 4
const ZOOM_STEP = 1.12

function clampZoom(value: number) {
  return Math.min(
    MAX_ZOOM,
    Math.max(MIN_ZOOM, value)
  )
}

export function ImageViewerPage() {
  const viewerRef =
    useRef<HTMLElement | null>(null)
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
  const [zoom, setZoom] = useState(1)

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
      setZoom(1)
      return
    }

    let cancelled = false
    let createdUrl: string | null = null

    const loadImage = async () => {
      setIsLoading(true)
      setError(null)
      setDimensions(null)
      setZoom(1)

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

      if (
        event.key === '0' &&
        (event.metaKey || event.ctrlKey)
      ) {
        setZoom(1)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const setZoomAroundPoint = (
    nextZoom: number,
    clientX?: number,
    clientY?: number
  ) => {
    const viewer = viewerRef.current
    const previousZoom = zoom
    const next = clampZoom(nextZoom)

    if (!viewer) {
      setZoom(next)
      return
    }

    const rect = viewer.getBoundingClientRect()
    const focalX =
      clientX == null
        ? viewer.clientWidth / 2
        : clientX - rect.left
    const focalY =
      clientY == null
        ? viewer.clientHeight / 2
        : clientY - rect.top
    const contentX =
      (viewer.scrollLeft + focalX) /
      previousZoom
    const contentY =
      (viewer.scrollTop + focalY) /
      previousZoom

    setZoom(next)

    window.requestAnimationFrame(() => {
      viewer.scrollLeft =
        contentX * next - focalX
      viewer.scrollTop =
        contentY * next - focalY
    })
  }

  const handleWheel = (
    event: React.WheelEvent<HTMLElement>
  ) => {
    if (!imageUrl || isLoading || error) {
      return
    }

    event.preventDefault()

    const direction =
      event.deltaY < 0 ? 1 : -1
    const factor =
      direction > 0
        ? ZOOM_STEP
        : 1 / ZOOM_STEP

    setZoomAroundPoint(
      zoom * factor,
      event.clientX,
      event.clientY
    )
  }

  const zoomPercent = Math.round(zoom * 100)

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

          <div className="flex items-center gap-1 rounded-xl border border-white/10 bg-white/[0.04] p-1">
            <button
              type="button"
              onClick={() =>
                setZoomAroundPoint(
                  zoom / ZOOM_STEP
                )
              }
              className="grid size-8 place-items-center rounded-lg text-sm font-black text-white/55 transition hover:bg-white/10 hover:text-white"
            >
              −
            </button>

            <button
              type="button"
              onClick={() => setZoom(1)}
              className="min-w-16 rounded-lg px-2 py-2 font-mono text-[10px] font-black uppercase tracking-[0.12em] text-white/55 transition hover:bg-white/10 hover:text-white"
            >
              {zoomPercent}%
            </button>

            <button
              type="button"
              onClick={() =>
                setZoomAroundPoint(
                  zoom * ZOOM_STEP
                )
              }
              className="grid size-8 place-items-center rounded-lg text-sm font-black text-white/55 transition hover:bg-white/10 hover:text-white"
            >
              +
            </button>
          </div>

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

      <section
        ref={viewerRef}
        onWheel={handleWheel}
        className="min-h-0 flex-1 overflow-auto bg-black"
      >
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
              style={
                dimensions
                  ? {
                      width:
                        dimensions.width *
                        zoom
                    }
                  : undefined
              }
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
          Mouse wheel to zoom · scrollbars to pan · Escape to close
        </p>
      </footer>
    </main>
  )
}
