import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type {
  AnnotationInput,
  BackendAnnotation,
  BackendScreenshotEvidence
} from '../../shared/recording'
import pointerUrl from '../assets/pointer.png'

interface EvidenceGalleryProps {
  remoteSessionId: string | null
  editable?: boolean
}

interface LoadedScreenshot {
  evidence: BackendScreenshotEvidence
  url: string
}

type AnnotationType = AnnotationInput['type']
type ToolMode = 'move' | 'box' | 'text' | 'erase'
type Bounds = { x: number; y: number; width: number; height: number }
type SelectedAnnotation = { screenshotId: string; index: number } | null
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
  },
  text_box: {
    rgb: '168, 85, 247',
    tag: 'bg-violet-500/25 text-violet-200',
    label: 'Text'
  }
}

const MIN_SIZE = 8
const MAX_HISTORY = 500
const POINTER_ORIGINAL_EDGE = 2048
const POINTER_CROPPED_MAX_EDGE = 1601
const POINTER_HOTSPOT_X = 926 / POINTER_ORIGINAL_EDGE
const POINTER_HOTSPOT_Y = 224 / POINTER_ORIGINAL_EDGE

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

function cloneEdits(edits: Record<string, AnnotationInput[]>): Record<string, AnnotationInput[]> {
  return Object.fromEntries(
    Object.entries(edits).map(([id, annotations]) => [
      id,
      annotations.map((annotation) => ({
        ...annotation,
        bounds: { ...annotation.bounds }
      }))
    ])
  )
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
    const croppedEdge = Math.max(48, Math.min(width, height) / 18)
    const originalEdge = croppedEdge * (POINTER_ORIGINAL_EDGE / POINTER_CROPPED_MAX_EDGE)
    return (
      <img
        src={pointerUrl}
        alt=""
        draggable={false}
        className="pointer-events-none absolute select-none"
        style={{
          left: pct(tx, width),
          top: pct(ty, height),
          width: pct(originalEdge, width),
          height: pct(originalEdge, height),
          transform: `translate(-${POINTER_HOTSPOT_X * 100}%, -${POINTER_HOTSPOT_Y * 100}%)`
        }}
      />
    )
  }

  if (anno.type === 'text_box') {
    return (
      <div
        className="pointer-events-none absolute rounded-xl border border-violet-300/70 bg-black/80 px-3 py-2 shadow-[0_0_24px_rgba(168,85,247,0.3)]"
        style={{
          left: pct(anno.bounds.x, width),
          top: pct(anno.bounds.y, height),
          width: pct(anno.bounds.width, width),
          minHeight: pct(anno.bounds.height, height)
        }}
      >
        <p className="text-[11px] font-bold leading-4 text-white/90">
          {anno.label || 'Note'}
        </p>
      </div>
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
  | { mode: 'draw'; index: number; start: Bounds; last: Bounds; annotationType: AnnotationType }
type PaletteDragState = {
  startX: number
  startY: number
  originX: number
  originY: number
}

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
  toolMode: ToolMode
  selectedIndex: number | null
  annotations: AnnotationInput[]
  onChange: (next: AnnotationInput[]) => void
  onSelect: (index: number | null) => void
  onClear: () => void
  onDelete: () => void
}

function ScreenshotFrame({
  evidence,
  url,
  editMode,
  toolMode,
  selectedIndex,
  annotations,
  onChange,
  onSelect,
  onClear,
  onDelete
}: FrameProps) {
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

  const removeAt = (index: number) => {
    onChange(annotationsRef.current.filter((_, i) => i !== index))
    onSelect(null)
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
      if (drag.annotationType === 'text_box') {
        replaceAt(
          drag.index,
          clampBounds(
            { x: drag.start.x, y: drag.start.y, width: 220, height: 72 },
            evidence.width,
            evidence.height
          )
        )
      } else {
        onChange(annotationsRef.current.filter((_, i) => i !== drag.index))
      }
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
    if (toolMode !== 'box' && toolMode !== 'text') return
    const { x, y } = toCoords(event.clientX, event.clientY)
    const start = { x, y, width: 0, height: 0 }
    const index = annotations.length
    const annotationType: AnnotationType = toolMode === 'text' ? 'text_box' : 'manual_box'
    onChange([
      ...annotations,
      {
        type: annotationType,
        bounds: start,
        label: annotationType === 'text_box' ? '' : null,
        source: 'manual'
      }
    ])
    onSelect(index)
    beginDrag(event, { mode: 'draw', index, start, last: start, annotationType })
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
          <AnnotationVisual key={`v-${i}`} anno={anno} width={evidence.width} height={evidence.height} />
        ))}
        {/* draw capture layer */}
        {editMode && (toolMode === 'box' || toolMode === 'text') && (
          <div
            className="absolute inset-0 cursor-crosshair"
            onPointerDown={beginDraw}
            title={toolMode === 'text' ? 'Drag to add a text callout' : 'Drag to draw a highlight box'}
          />
        )}
        {/* edit handles (move/resize) */}
        {editMode && toolMode !== 'box' && toolMode !== 'text' && (
          <>
            {annotations.map((item, index) => {
              const style = TYPE_STYLES[item.type] ?? TYPE_STYLES.click_rectangle
              const selected = selectedIndex === index
              const isText = item.type === 'text_box'
              return (
                <div
                  key={`e-${index}`}
                  className={[
                    'absolute border',
                    isText
                      ? 'border-transparent'
                      : selected
                        ? 'border-solid border-white/90'
                        : 'border-dashed border-white/70',
                    toolMode === 'erase' ? 'cursor-not-allowed hover:bg-red-500/20' : 'cursor-move'
                  ].join(' ')}
                  style={{
                    left: pct(item.bounds.x, evidence.width),
                    top: pct(item.bounds.y, evidence.height),
                    width: pct(item.bounds.width, evidence.width),
                    height: pct(item.bounds.height, evidence.height)
                  }}
                  onPointerDown={(event) => {
                    if (toolMode === 'erase') {
                      event.preventDefault()
                      event.stopPropagation()
                      removeAt(index)
                      return
                    }
                    onSelect(index)
                    beginDrag(event, {
                      mode: 'move',
                      index,
                      start: toCoords(event.clientX, event.clientY),
                      origin: { ...item.bounds }
                    })
                  }}
                >
                  {toolMode === 'move' && selected &&
                    (['nw', 'ne', 'sw', 'se'] as ResizeCorner[]).map((corner) => (
                      <span
                        key={corner}
                        className="absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white"
                        style={{
                          left: corner.includes('w') ? '0%' : '100%',
                          top: corner.includes('n') ? '0%' : '100%',
                          backgroundColor: `rgb(${style.rgb})`
                        }}
                        onPointerDown={(event) => {
                          onSelect(index)
                          beginDrag(event, { mode: 'resize', index, corner, origin: { ...item.bounds } })
                        }}
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
          {editMode && (
            <button
              type="button"
              className="rounded border border-red-500/20 px-2 py-0.5 text-red-300/75 transition hover:bg-red-500/10 hover:text-red-200"
              onClick={onDelete}
            >
              Delete frame
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
function ToolButton({
  active,
  children,
  onClick
}: {
  active?: boolean
  children: ReactNode
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className={[
        'rounded-xl px-3 py-2 text-left text-xs font-black uppercase tracking-[0.12em] transition',
        active
          ? 'bg-white text-black'
          : 'border border-white/10 bg-white/[0.04] text-white/62 hover:bg-white/[0.08] hover:text-white'
      ].join(' ')}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

export function EvidenceGallery({ remoteSessionId, editable = true }: EvidenceGalleryProps) {
  const [screenshots, setScreenshots] = useState<LoadedScreenshot[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [editMode, setEditMode] = useState(false)
  const [toolMode, setToolMode] = useState<ToolMode>('move')
  const [selectedAnnotation, setSelectedAnnotation] = useState<SelectedAnnotation>(null)
  const [edits, setEdits] = useState<Record<string, AnnotationInput[]>>({})
  const [dirty, setDirty] = useState<Set<string>>(new Set())
  const [history, setHistory] = useState<Record<string, AnnotationInput[]>[]>([])
  const [future, setFuture] = useState<Record<string, AnnotationInput[]>[]>([])
  const [saving, setSaving] = useState(false)
  const [offsetX, setOffsetX] = useState('')
  const [offsetY, setOffsetY] = useState('')
  const [palettePosition, setPalettePosition] = useState(() => ({
    x: typeof window === 'undefined' ? 24 : Math.max(24, window.innerWidth - 288),
    y: 96
  }))
  const paletteDragRef = useRef<PaletteDragState | null>(null)

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
    setHistory([])
    setFuture([])
    setToolMode('move')
    setSelectedAnnotation(null)
    setEditMode(true)
  }

  const cancelEdit = () => {
    setEditMode(false)
    setToolMode('move')
    setEdits({})
    setDirty(new Set())
    setHistory([])
    setFuture([])
    setSelectedAnnotation(null)
  }

  const markDirty = (id: string) => {
    setDirty((prev) => {
      if (prev.has(id)) return prev
      const next = new Set(prev)
      next.add(id)
      return next
    })
  }

  const selectedInput =
    selectedAnnotation ?
      edits[selectedAnnotation.screenshotId]?.[selectedAnnotation.index] ?? null
    : null

  const selectedFrame = selectedAnnotation
    ? screenshots.find((item) => item.evidence.id === selectedAnnotation.screenshotId)
    : null

  const updateSelectedAnnotation = (updater: (item: AnnotationInput) => AnnotationInput) => {
    if (!selectedAnnotation || !selectedFrame) return
    setEdits((prev) => {
      const list = prev[selectedAnnotation.screenshotId]
      const current = list?.[selectedAnnotation.index]
      if (!list || !current) return prev
      setHistory((historyItems) => [
        ...historyItems.slice(-(MAX_HISTORY - 1)),
        cloneEdits(prev)
      ])
      setFuture([])
      return {
        ...prev,
        [selectedAnnotation.screenshotId]: list.map((item, index) =>
          index === selectedAnnotation.index ? updater(item) : item
        )
      }
    })
    markDirty(selectedAnnotation.screenshotId)
  }

  const beginPaletteDrag = (event: React.PointerEvent) => {
    event.preventDefault()
    paletteDragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      originX: palettePosition.x,
      originY: palettePosition.y
    }

    const handleMove = (moveEvent: PointerEvent) => {
      const drag = paletteDragRef.current
      if (!drag) return
      const width = 240
      const height = 360
      setPalettePosition({
        x: clamp(drag.originX + moveEvent.clientX - drag.startX, 8, window.innerWidth - width - 8),
        y: clamp(drag.originY + moveEvent.clientY - drag.startY, 8, window.innerHeight - height)
      })
    }

    const endDrag = () => {
      paletteDragRef.current = null
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', endDrag)
    }

    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', endDrag)
  }

  const handleFrameChange = (id: string, next: AnnotationInput[]) => {
    setEdits((prev) => {
      setHistory((current) => [...current.slice(-(MAX_HISTORY - 1)), cloneEdits(prev)])
      setFuture([])
      return { ...prev, [id]: next }
    })
    markDirty(id)
  }

  const clearFrame = (id: string) => {
    setEdits((prev) => {
      setHistory((current) => [...current.slice(-(MAX_HISTORY - 1)), cloneEdits(prev)])
      setFuture([])
      return { ...prev, [id]: [] }
    })
    markDirty(id)
    setSelectedAnnotation((current) => (current?.screenshotId === id ? null : current))
  }

  const clearAll = () => {
    setEdits((prev) => {
      setHistory((current) => [...current.slice(-(MAX_HISTORY - 1)), cloneEdits(prev)])
      setFuture([])
      const next: Record<string, AnnotationInput[]> = {}
      for (const { evidence } of screenshots) next[evidence.id] = []
      return next
    })
    setDirty(new Set(screenshots.map(({ evidence }) => evidence.id)))
    setToolMode('box')
    setSelectedAnnotation(null)
  }

  const resetAll = () => {
    const initial: Record<string, AnnotationInput[]> = {}
    for (const { evidence } of screenshots) {
      initial[evidence.id] = evidence.annotations.map(toInput)
    }
    setEdits(initial)
    setDirty(new Set())
    setHistory([])
    setFuture([])
    setToolMode('move')
    setSelectedAnnotation(null)
  }

  const undo = () => {
    const previous = history.at(-1)
    if (!previous) return
    setFuture((nextFuture) => [cloneEdits(edits), ...nextFuture.slice(0, MAX_HISTORY - 1)])
    setHistory((current) => current.slice(0, -1))
    setEdits(cloneEdits(previous))
    setDirty(new Set(screenshots.map(({ evidence }) => evidence.id)))
  }

  const redo = () => {
    const next = future[0]
    if (!next) return
    setHistory((nextHistory) => [
      ...nextHistory.slice(-(MAX_HISTORY - 1)),
      cloneEdits(edits)
    ])
    setFuture((current) => current.slice(1))
    setEdits(cloneEdits(next))
    setDirty(new Set(screenshots.map(({ evidence }) => evidence.id)))
  }

  const applyGlobalOffset = () => {
    const dx = Number(offsetX) || 0
    const dy = Number(offsetY) || 0
    if (!dx && !dy) return
    setEdits((prev) => {
      setHistory((current) => [...current.slice(-(MAX_HISTORY - 1)), cloneEdits(prev)])
      setFuture([])
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
      setToolMode('move')
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
      setToolMode('move')
      setHistory([])
      setFuture([])
      setSelectedAnnotation(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save edits.')
    } finally {
      setSaving(false)
    }
  }

  const deleteFrame = async (screenshotId: string) => {
    if (!remoteSessionId) return
    const confirmed = window.confirm('Delete this screenshot from the session?')
    if (!confirmed) return
    setSaving(true)
    setError(null)
    try {
      await window.api.recording.deleteScreenshot(remoteSessionId, screenshotId)
      setScreenshots((prev) => {
        const removed = prev.find((item) => item.evidence.id === screenshotId)
        if (removed) URL.revokeObjectURL(removed.url)
        return prev.filter((item) => item.evidence.id !== screenshotId)
      })
      setEdits((prev) => {
        const next = { ...prev }
        delete next[screenshotId]
        return next
      })
      setDirty((prev) => {
        const next = new Set(prev)
        next.delete(screenshotId)
        return next
      })
      setSelectedAnnotation((current) =>
        current?.screenshotId === screenshotId ? null : current
      )
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not delete screenshot.')
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
      {editable && !editMode && (
        <button
          type="button"
          className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2 text-xs font-black uppercase tracking-[0.14em] text-white/80 transition hover:bg-white/10 hover:text-white"
          onClick={enterEdit}
        >
          Edit evidence
        </button>
      )}

      {editMode && (
        <aside
          className="fixed z-30 max-h-[calc(100vh-32px)] w-60 overflow-y-auto rounded-2xl border border-white/12 bg-[#090909]/95 p-4 shadow-[0_22px_80px_rgba(0,0,0,0.65)] backdrop-blur"
          style={{ left: palettePosition.x, top: palettePosition.y }}
        >
          <div
            className="flex cursor-move select-none items-center justify-between"
            onPointerDown={beginPaletteDrag}
            title="Drag editor panel"
          >
            <div>
              <p className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-300">
                Editor
              </p>
              <p className="mt-1 text-xs text-white/40">{dirty.size} unsaved frame{dirty.size === 1 ? '' : 's'}</p>
            </div>
            <span className="size-2 animate-pulse rounded-full bg-emerald-400" />
          </div>

          <div className="mt-4 grid gap-2">
            <ToolButton active={toolMode === 'move'} onClick={() => setToolMode('move')}>
              Move pointer
            </ToolButton>
            <ToolButton active={toolMode === 'box'} onClick={() => setToolMode('box')}>
              Draw box
            </ToolButton>
            <ToolButton active={toolMode === 'text'} onClick={() => setToolMode('text')}>
              Add text
            </ToolButton>
            <ToolButton active={toolMode === 'erase'} onClick={() => setToolMode('erase')}>
              Erase mark
            </ToolButton>
          </div>

          {selectedInput?.type === 'text_box' && (
            <div className="mt-4 rounded-xl border border-violet-300/15 bg-violet-400/[0.06] p-3">
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-violet-200/70">
                Selected text
              </p>
              <textarea
                value={selectedInput.label ?? ''}
                onChange={(event) =>
                  updateSelectedAnnotation((item) => ({ ...item, label: event.target.value }))
                }
                placeholder="Type the note shown on this screenshot"
                className="mt-2 min-h-24 w-full resize-y rounded-lg border border-white/10 bg-black/45 px-3 py-2 text-xs leading-5 text-white outline-none placeholder:text-white/25 focus:border-violet-300/45"
              />
            </div>
          )}

          {toolMode === 'text' && selectedInput?.type !== 'text_box' && (
            <p className="mt-3 rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs leading-5 text-white/42">
              Click or drag on a screenshot to place a note, then type here.
            </p>
          )}

          <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.03] p-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-white/38">
              Offset all
            </p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <input
                type="number"
                value={offsetX}
                onChange={(event) => setOffsetX(event.target.value)}
                placeholder="x"
                className="rounded-lg border border-white/10 bg-black/40 px-2 py-2 text-xs text-white outline-none focus:border-white/30"
              />
              <input
                type="number"
                value={offsetY}
                onChange={(event) => setOffsetY(event.target.value)}
                placeholder="y"
                className="rounded-lg border border-white/10 bg-black/40 px-2 py-2 text-xs text-white outline-none focus:border-white/30"
              />
            </div>
            <button
              type="button"
              className="mt-2 w-full rounded-lg border border-white/10 px-3 py-2 text-xs font-bold text-white/70 transition hover:bg-white/8 hover:text-white"
              onClick={applyGlobalOffset}
            >
              Apply offset
            </button>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2">
            <button
              type="button"
              className="rounded-lg border border-white/10 px-3 py-2 text-xs font-bold text-white/65 transition hover:bg-white/8 disabled:cursor-not-allowed disabled:opacity-35"
              onClick={undo}
              disabled={history.length === 0}
            >
              Undo
            </button>
            <button
              type="button"
              className="rounded-lg border border-white/10 px-3 py-2 text-xs font-bold text-white/65 transition hover:bg-white/8 disabled:cursor-not-allowed disabled:opacity-35"
              onClick={redo}
              disabled={future.length === 0}
            >
              Redo
            </button>
            <button
              type="button"
              className="rounded-lg border border-white/10 px-3 py-2 text-xs font-bold text-white/65 transition hover:bg-white/8"
              onClick={resetAll}
            >
              Reset
            </button>
            <button
              type="button"
              className="rounded-lg border border-red-500/20 px-3 py-2 text-xs font-bold text-red-300/80 transition hover:bg-red-500/10"
              onClick={clearAll}
            >
              Clear all
            </button>
          </div>

          <div className="mt-4 grid gap-2">
            <button
              type="button"
              className="rounded-xl bg-emerald-400 px-4 py-3 text-xs font-black uppercase tracking-[0.14em] text-black transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-45"
              onClick={saveAll}
              disabled={saving || dirty.size === 0}
            >
              {saving ? 'Saving…' : `Save${dirty.size > 0 ? ` (${dirty.size})` : ''}`}
            </button>
            <button
              type="button"
              className="rounded-xl border border-white/10 px-4 py-3 text-xs font-black uppercase tracking-[0.14em] text-white/55 transition hover:bg-white/8 hover:text-white"
              onClick={cancelEdit}
              disabled={saving}
            >
              Cancel
            </button>
          </div>
        </aside>
      )}

      {error && <p className="text-sm text-red-300/80">{error}</p>}

      {screenshots.map(({ evidence, url }) => {
        const annotations = editMode ? edits[evidence.id] ?? [] : evidence.annotations.map(toInput)
        return (
          <ScreenshotFrame
            key={evidence.id}
            evidence={evidence}
            url={url}
            editMode={editMode}
            toolMode={toolMode}
            selectedIndex={selectedAnnotation?.screenshotId === evidence.id ? selectedAnnotation.index : null}
            annotations={annotations}
            onChange={(next) => handleFrameChange(evidence.id, next)}
            onSelect={(index) =>
              setSelectedAnnotation(index === null ? null : { screenshotId: evidence.id, index })
            }
            onClear={() => clearFrame(evidence.id)}
            onDelete={() => void deleteFrame(evidence.id)}
          />
        )
      })}
    </div>
  )
}
