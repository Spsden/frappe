import { Fragment, useEffect, useRef, useState } from 'react'
import type {
  AnnotationInput,
  BackendAnnotation,
  BackendScreenshotEvidence
} from '../../shared/recording'

interface EvidenceGalleryProps {
  remoteSessionId: string | null
}

interface LoadedScreenshot {
  evidence: BackendScreenshotEvidence
  url: string
}

type AnnotationType = AnnotationInput['type']
type Bounds = { x: number; y: number; width: number; height: number }
type VisualAnno = {
  type: AnnotationType
  bounds: Bounds
  label: string | null
  role: string | null
  source: string | null
}

const TYPE_STYLES: Record<AnnotationType, { rgb: string; tag: string; label: string }> = {
  click_rectangle: {
    rgb: '239, 68, 68',
    tag: 'bg-red-500/25 text-red-200',
    label: 'Click'
  },
  scroll_focus: {
    rgb: '56, 189, 248',
    tag: 'bg-sky-400/25 text-sky-200',
    label: 'Scroll'
  },
  pointer_focus: {
    rgb: '251, 191, 36',
    tag: 'bg-amber-400/25 text-amber-200',
    label: 'Focus'
  },
  manual_box: {
    rgb: '16, 185, 129',
    tag: 'bg-emerald-500/25 text-emerald-200',
    label: 'Box'
  }
}

const MIN_SIZE = 8

function toInput(annotation: BackendAnnotation): AnnotationInput {
  return {
    type: annotation.type,
    bounds: { ...annotation.bounds },
    label: annotation.label,
    role: annotation.role,
    source: annotation.source
  }
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value))
}

/** Keep a bounds box inside the screenshot with a minimum size. */
function clampBounds(bounds: Bounds, width: number, height: number): Bounds {
  const w = Math.max(MIN_SIZE, bounds.width)
  const h = Math.max(MIN_SIZE, bounds.height)
  return {
    x: clamp(bounds.x, 0, Math.max(0, width - w)),
    y: clamp(bounds.y, 0, Math.max(0, height - h)),
    width: w,
    height: h
  }
}

/**
 * Build a hand-drawn curved arrow that lands on the click target (tx, ty).
 * The shaft bows off-axis and the head's angle tracks the incoming tangent,
 * so the marker reads as an annotation rather than a rigid connector.
 * Origin sits to the lower-left of the target (flipped if it would collide)
 * and is clamped within the screenshot so the arrow never leaves the frame.
 */
function buildHandArrow(
  tx: number,
  ty: number,
  w: number,
  h: number
): { shaft: string; head: string } {
  const margin = 30

  let ox = tx - 150
  let oy = ty + 120
  ox = clamp(ox, margin, w - margin)
  oy = clamp(oy, margin, h - margin)
  if (Math.hypot(tx - ox, ty - oy) < 70) {
    ox = clamp(tx + 150, margin, w - margin)
    oy = clamp(ty - 120, margin, h - margin)
  }

  const dx = tx - ox
  const dy = ty - oy
  const len = Math.hypot(dx, dy) || 1
  const ux = dx / len
  const uy = dy / len
  const perpX = -uy
  const perpY = ux
  const bow = Math.min(len * 0.22, 70)

  const c1x = ox + ux * len * 0.35 + perpX * bow * 0.4
  const c1y = oy + uy * len * 0.35 + perpY * bow * 0.4
  const c2x = ox + ux * len * 0.7 + perpX * bow
  const c2y = oy + uy * len * 0.7 + perpY * bow
  const shaft = `M ${ox} ${oy} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${tx} ${ty}`

  const inLen = Math.hypot(tx - c2x, ty - c2y) || 1
  const iux = (tx - c2x) / inLen
  const iuy = (ty - c2y) / inLen
  const headLen = Math.min(34, Math.max(18, len * 0.16))
  const ang = (26 * Math.PI) / 180
  const cosA = Math.cos(ang)
  const sinA = Math.sin(ang)
  const h1x = tx + (-iux * cosA + iuy * sinA) * headLen
  const h1y = ty + (-iux * sinA - iuy * cosA) * headLen
  const h2x = tx + (-iux * cosA - iuy * sinA) * headLen
  const h2y = ty + (iux * sinA - iuy * cosA) * headLen
  const head = `M ${h1x} ${h1y} L ${tx} ${ty} L ${h2x} ${h2y}`

  return { shaft, head }
}

function pct(value: number, dim: number): string {
  return `${(value / dim) * 100}%`
}

/** Renders the highlight visual (arrow for clicks, glow box otherwise). */
function AnnotationVisual({ anno, width, height }: { anno: VisualAnno; width: number; height: number }) {
  const style = TYPE_STYLES[anno.type] ?? TYPE_STYLES.click_rectangle
  const labelText = anno.label ? `${style.label}: ${anno.label}` : style.label
  const isArrow = anno.type === 'click_rectangle'

  if (isArrow) {
    const tx = anno.bounds.x + anno.bounds.width / 2
    const ty = anno.bounds.y + anno.bounds.height / 2
    const arrow = buildHandArrow(tx, ty, width, height)
    return (
      <svg
        className="pointer-events-none absolute inset-0 h-full w-full"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        fill="none"
      >
        <path d={arrow.shaft} stroke={`rgba(${style.rgb}, 0.3)`} strokeWidth={12} strokeLinecap="round" />
        <path d={arrow.shaft} stroke={`rgb(${style.rgb})`} strokeWidth={4.5} strokeLinecap="round" />
        <path
          d={arrow.head}
          stroke={`rgb(${style.rgb})`}
          strokeWidth={4.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    )
  }

  return (
    <div
      className="pointer-events-none absolute rounded-sm"
      style={{
        left: pct(anno.bounds.x, width),
        top: pct(anno.bounds.y, height),
        width: pct(anno.bounds.width, width),
        height: pct(anno.bounds.height, height),
        backgroundColor: `rgba(${style.rgb}, 0.12)`,
        boxShadow: `inset 0 0 0 1px rgba(${style.rgb}, 0.5), 0 0 10px 1px rgba(${style.rgb}, 0.5), 0 0 28px 7px rgba(${style.rgb}, 0.32)`
      }}
    >
      <span
        className={`absolute -top-5 left-0 whitespace-nowrap rounded px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wide ${style.tag}`}
      >
        {labelText}
      </span>
    </div>
  )
}

type ResizeCorner = 'nw' | 'ne' | 'sw' | 'se'
type DragState =
  | { mode: 'move'; index: number; start: Bounds; origin: Bounds }
  | { mode: 'resize'; index: number; corner: ResizeCorner; origin: Bounds }
  | { mode: 'draw'; index: number; start: Bounds; last: Bounds }

function resizeBounds(origin: Bounds, corner: ResizeCorner, px: number, py: number, w: number, h: number): Bounds {
  let { x, y, width, height } = origin
  const right = x + width
  const bottom = y + height
  if (corner === 'nw' || corner === 'sw') {
    const nx = clamp(px, 0, right - MIN_SIZE)
    width = right - nx
    x = nx
  } else {
    width = clamp(px - x, MIN_SIZE, w - x)
  }
  if (corner === 'nw' || corner === 'ne') {
    const ny = clamp(py, 0, bottom - MIN_SIZE)
    height = bottom - ny
    y = ny
  } else {
    height = clamp(py - y, MIN_SIZE, h - y)
  }
  return clampBounds({ x, y, width, height }, w, h)
}

interface FrameProps {
  evidence: BackendScreenshotEvidence
  url: string
  editMode: boolean
  drawMode: boolean
  annotations: AnnotationInput[]
  onChange: (next: AnnotationInput[]) => void
  onClear: () => void
}

function ScreenshotFrame({ evidence, url, editMode, drawMode, annotations, onChange, onClear }: FrameProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragState | null>(null)
  // Mirror annotations into a ref so window-level pointer handlers (which
  // capture the closure of the render that registered them) always see the
  // latest array. Without this, draw mode silently no-ops: beginDraw adds an
  // item at index = annotations.length, but handleMove's captured closure
  // still sees the pre-add array and replaceAt(index, ...) maps over a list
  // that has no entry at that index.
  const annotationsRef = useRef(annotations)
  annotationsRef.current = annotations

  const toCoords = (clientX: number, clientY: number): Bounds => {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return { x: 0, y: 0, width: 0, height: 0 }
    return {
      x: ((clientX - rect.left) / rect.width) * evidence.width,
      y: ((clientY - rect.top) / rect.height) * evidence.height,
      width: 0,
      height: 0
    }
  }

  const replaceAt = (index: number, bounds: Bounds) => {
    onChange(annotationsRef.current.map((item, i) => (i === index ? { ...item, bounds } : item)))
  }

  const handleMove = (event: PointerEvent) => {
    const drag = dragRef.current
    if (!drag) return
    const { x, y } = toCoords(event.clientX, event.clientY)
    if (drag.mode === 'move') {
      const nb = clampBounds(
        {
          x: drag.origin.x + (x - drag.start.x),
          y: drag.origin.y + (y - drag.start.y),
          width: drag.origin.width,
          height: drag.origin.height
        },
        evidence.width,
        evidence.height
      )
      replaceAt(drag.index, nb)
    } else if (drag.mode === 'resize') {
      replaceAt(drag.index, resizeBounds(drag.origin, drag.corner, x, y, evidence.width, evidence.height))
    } else {
      const nb = clampBounds(
        {
          x: Math.min(drag.start.x, x),
          y: Math.min(drag.start.y, y),
          width: Math.abs(x - drag.start.x),
          height: Math.abs(y - drag.start.y)
        },
        evidence.width,
        evidence.height
      )
      drag.last = nb
      replaceAt(drag.index, nb)
    }
  }

  const endDrag = () => {
    const drag = dragRef.current
    window.removeEventListener('pointermove', handleMove)
    window.removeEventListener('pointerup', endDrag)
    dragRef.current = null
    if (drag?.mode === 'draw' && (drag.last.width < MIN_SIZE || drag.last.height < MIN_SIZE)) {
      onChange(annotationsRef.current.filter((_, i) => i !== drag.index))
    }
  }

  const beginDrag = (event: React.PointerEvent, drag: DragState) => {
    event.preventDefault()
    event.stopPropagation()
    dragRef.current = drag
    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', endDrag)
  }

  const beginDraw = (event: React.PointerEvent) => {
    if (!drawMode) return
    const { x, y } = toCoords(event.clientX, event.clientY)
    const start = { x, y, width: 0, height: 0 }
    const index = annotations.length
    onChange([...annotations, { type: 'manual_box', bounds: start, source: 'manual' }])
    beginDrag(event, { mode: 'draw', index, start, last: start })
  }

  const visuals: VisualAnno[] = annotations.map((item) => ({
    type: item.type,
    bounds: item.bounds,
    label: item.label ?? null,
    role: item.role ?? null,
    source: item.source ?? null
  }))

  return (
    <figure className="overflow-hidden rounded-xl border border-white/10 bg-black/40">
      <div ref={containerRef} className="relative">
        <img src={url} alt={`Screenshot ${evidence.sequence}`} className="block w-full" />
        {/* highlight visuals (read + edit) */}
        {visuals.map((anno, i) => (
          <Fragment key={`v-${i}`}>
            <AnnotationVisual anno={anno} width={evidence.width} height={evidence.height} />
          </Fragment>
        ))}
        {/* draw capture layer */}
        {editMode && drawMode && (
          <div
            className="absolute inset-0 cursor-crosshair"
            onPointerDown={beginDraw}
            title="Drag to draw a highlight box"
          />
        )}
        {/* edit handles (move/resize) */}
        {editMode && !drawMode && (
          <>
            {annotations.map((item, index) => {
              const style = TYPE_STYLES[item.type] ?? TYPE_STYLES.click_rectangle
              return (
                <div
                  key={`e-${index}`}
                  className="absolute cursor-move border border-dashed border-white/70"
                  style={{
                    left: pct(item.bounds.x, evidence.width),
                    top: pct(item.bounds.y, evidence.height),
                    width: pct(item.bounds.width, evidence.width),
                    height: pct(item.bounds.height, evidence.height)
                  }}
                  onPointerDown={(event) =>
                    beginDrag(event, {
                      mode: 'move',
                      index,
                      start: toCoords(event.clientX, event.clientY),
                      origin: { ...item.bounds }
                    })
                  }
                >
                  {(['nw', 'ne', 'sw', 'se'] as ResizeCorner[]).map((corner) => (
                    <span
                      key={corner}
                      className="absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white"
                      style={{
                        left: corner.includes('w') ? '0%' : '100%',
                        top: corner.includes('n') ? '0%' : '100%',
                        backgroundColor: `rgb(${style.rgb})`
                      }}
                      onPointerDown={(event) =>
                        beginDrag(event, { mode: 'resize', index, corner, origin: { ...item.bounds } })
                      }
                    />
                  ))}
                </div>
              )
            })}
          </>
        )}
      </div>
      <figcaption className="flex items-center justify-between gap-3 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-white/45">
        <span>Frame {evidence.sequence}</span>
        <div className="flex items-center gap-3">
          {editMode && (
            <button
              type="button"
              className="rounded border border-white/10 px-2 py-0.5 text-white/60 transition hover:bg-white/5 hover:text-white"
              onClick={onClear}
            >
              Clear
            </button>
          )}
          <span>
            {annotations.length} highlight{annotations.length === 1 ? '' : 's'}
          </span>
        </div>
      </figcaption>
    </figure>
  )
}

/**
 * Phase 3 evidence view: renders each captured screenshot with its click/scroll
 * highlights drawn as live overlays. Bounds arrive in screenshot-pixel space
 * and are positioned with percentages so they track the rendered image size
 * exactly. Nothing is baked into the PNGs read here.
 *
 * The editor (toggle via the toolbar) lets the user drag highlights to fix
 * imprecise placements, apply a global (x, y) offset across every frame, clear
 * highlights and draw manual boxes. Saving persists the edited sets and
 * re-bakes the backend's annotated PNGs.
 */
export function EvidenceGallery({ remoteSessionId }: EvidenceGalleryProps) {
  const [screenshots, setScreenshots] = useState<LoadedScreenshot[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [editMode, setEditMode] = useState(false)
  const [drawMode, setDrawMode] = useState(false)
  const [edits, setEdits] = useState<Record<string, AnnotationInput[]>>({})
  const [dirty, setDirty] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [offsetX, setOffsetX] = useState('')
  const [offsetY, setOffsetY] = useState('')

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

  const enterEdit = () => {
    const initial: Record<string, AnnotationInput[]> = {}
    for (const { evidence } of screenshots) {
      initial[evidence.id] = evidence.annotations.map(toInput)
    }
    setEdits(initial)
    setDirty(new Set())
    setDrawMode(false)
    setEditMode(true)
  }

  const cancelEdit = () => {
    setEditMode(false)
    setDrawMode(false)
    setEdits({})
    setDirty(new Set())
  }

  const markDirty = (id: string) => {
    setDirty((prev) => {
      if (prev.has(id)) return prev
      const next = new Set(prev)
      next.add(id)
      return next
    })
  }

  const handleFrameChange = (id: string, next: AnnotationInput[]) => {
    setEdits((prev) => ({ ...prev, [id]: next }))
    markDirty(id)
  }

  const clearFrame = (id: string) => {
    setEdits((prev) => ({ ...prev, [id]: [] }))
    markDirty(id)
  }

  const clearAll = () => {
    const next: Record<string, AnnotationInput[]> = {}
    const nextDirty = new Set(dirty)
    for (const { evidence } of screenshots) {
      next[evidence.id] = []
      nextDirty.add(evidence.id)
    }
    setEdits(next)
    setDirty(nextDirty)
    setDrawMode(true)
  }

  const applyGlobalOffset = () => {
    const dx = Number(offsetX) || 0
    const dy = Number(offsetY) || 0
    if (!dx && !dy) return
    setEdits((prev) => {
      const next: Record<string, AnnotationInput[]> = {}
      for (const { evidence } of screenshots) {
        const annos = prev[evidence.id] ?? []
        next[evidence.id] = annos.map((item) => ({
          ...item,
          bounds: clampBounds(
            { ...item.bounds, x: item.bounds.x + dx, y: item.bounds.y + dy },
            evidence.width,
            evidence.height
          )
        }))
      }
      return next
    })
    setDirty((prev) => {
      const next = new Set(prev)
      for (const { evidence } of screenshots) next.add(evidence.id)
      return next
    })
  }

  const saveAll = async () => {
    if (!remoteSessionId || dirty.size === 0) {
      setEditMode(false)
      setDrawMode(false)
      return
    }
    setSaving(true)
    setError(null)
    try {
      for (const id of dirty) {
        const annotations = edits[id] ?? []
        const saved = await window.api.recording.saveScreenshotAnnotations(
          remoteSessionId,
          id,
          annotations
        )
        setScreenshots((prev) =>
          prev.map((item) => (item.evidence.id === id ? { ...item, evidence: saved } : item))
        )
      }
      setEdits({})
      setDirty(new Set())
      setEditMode(false)
      setDrawMode(false)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save edits.')
    } finally {
      setSaving(false)
    }
  }

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
  if (error && screenshots.length === 0) {
    return <p className="text-sm text-white/50">{error}</p>
  }
  if (screenshots.length === 0) {
    return <p className="text-sm text-white/45">No screenshots captured for this session.</p>
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] p-2">
        {!editMode ? (
          <button
            type="button"
            className="rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-white/80 transition hover:bg-white/10 hover:text-white"
            onClick={enterEdit}
          >
            Edit annotations
          </button>
        ) : (
          <>
            <div className="flex items-center gap-1">
              <button
                type="button"
                className={`rounded-md px-3 py-1.5 text-xs font-semibold uppercase tracking-wide transition ${
                  !drawMode ? 'bg-white/15 text-white' : 'text-white/60 hover:bg-white/5'
                }`}
                onClick={() => setDrawMode(false)}
              >
                Move / Resize
              </button>
              <button
                type="button"
                className={`rounded-md px-3 py-1.5 text-xs font-semibold uppercase tracking-wide transition ${
                  drawMode ? 'bg-white/15 text-white' : 'text-white/60 hover:bg-white/5'
                }`}
                onClick={() => setDrawMode(true)}
              >
                Draw box
              </button>
            </div>

            <div className="mx-1 h-5 w-px bg-white/10" />

            <label className="flex items-center gap-1 text-[10px] font-mono uppercase tracking-wide text-white/45">
              offset
              <input
                type="number"
                value={offsetX}
                onChange={(event) => setOffsetX(event.target.value)}
                placeholder="x"
                className="w-12 rounded border border-white/10 bg-black/40 px-1.5 py-1 text-xs text-white outline-none focus:border-white/30"
              />
              <input
                type="number"
                value={offsetY}
                onChange={(event) => setOffsetY(event.target.value)}
                placeholder="y"
                className="w-12 rounded border border-white/10 bg-black/40 px-1.5 py-1 text-xs text-white outline-none focus:border-white/30"
              />
              <button
                type="button"
                className="rounded-md border border-white/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-white/70 transition hover:bg-white/5 hover:text-white"
                onClick={applyGlobalOffset}
              >
                Apply to all
              </button>
            </label>

            <div className="mx-1 h-5 w-px bg-white/10" />

            <button
              type="button"
              className="rounded-md border border-white/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-white/60 transition hover:bg-white/5 hover:text-white"
              onClick={clearAll}
            >
              Clear all
            </button>

            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                className="rounded-md border border-white/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-white/60 transition hover:bg-white/5 hover:text-white"
                onClick={cancelEdit}
                disabled={saving}
              >
                Cancel
              </button>
              <button
                type="button"
                className="rounded-md bg-emerald-500/90 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-black transition hover:bg-emerald-400 disabled:opacity-50"
                onClick={saveAll}
                disabled={saving || dirty.size === 0}
              >
                {saving ? 'Saving…' : `Save${dirty.size > 0 ? ` (${dirty.size})` : ''}`}
              </button>
            </div>
          </>
        )}
      </div>

      {error && <p className="text-sm text-red-300/80">{error}</p>}

      {screenshots.map(({ evidence, url }) => {
        const annotations = editMode ? edits[evidence.id] ?? [] : evidence.annotations.map(toInput)
        return (
          <ScreenshotFrame
            key={evidence.id}
            evidence={evidence}
            url={url}
            editMode={editMode}
            drawMode={drawMode}
            annotations={annotations}
            onChange={(next) => handleFrameChange(evidence.id, next)}
            onClear={() => clearFrame(evidence.id)}
          />
        )
      })}
    </div>
  )
}
