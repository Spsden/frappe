import { randomUUID } from 'node:crypto'
import { screen, systemPreferences } from 'electron'
import {
  UiohookKey,
  WheelDirection,
  uIOhook,
  type UiohookKeyboardEvent,
  type UiohookMouseEvent,
  type UiohookWheelEvent
} from 'uiohook-napi'
import type { RecordedEvent } from '../../shared/recording'
import type { AccessibilityBundle, AccessibilityRect } from '../accessibility'
import { SessionWriter } from './SessionWriter'

interface InputEventCallbacks {
  getBeforeScreenshotId: () => string | undefined
  shouldIgnorePoint: (x: number, y: number) => boolean
  onEventCaptured: (event: RecordedEvent) => void
  onEventSaved: (event: RecordedEvent) => void
  onError: (error: Error) => void
}

interface PendingTypingBurst {
  startedAt: number
  lastAt: number
  keyCount: number
  modifiers: Set<string>
}

interface PendingScrollBurst {
  startedAt: number
  lastAt: number
  x: number
  y: number
  deltaX: number
  deltaY: number
}

const characterKeys = new Set<number>([
  UiohookKey.Space,
  UiohookKey.Semicolon,
  UiohookKey.Equal,
  UiohookKey.Comma,
  UiohookKey.Minus,
  UiohookKey.Period,
  UiohookKey.Slash,
  UiohookKey.Backquote,
  UiohookKey.BracketLeft,
  UiohookKey.Backslash,
  UiohookKey.BracketRight,
  UiohookKey.Quote,
  ...Array.from({ length: 10 }, (_, index) => UiohookKey[index as keyof typeof UiohookKey]),
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(
    (letter) => UiohookKey[letter as keyof typeof UiohookKey]
  ),
  ...Array.from({ length: 10 }, (_, index) => UiohookKey[`Numpad${index}` as keyof typeof UiohookKey])
].filter((key): key is number => typeof key === 'number'))

const modifierKeys = new Set<number>([
  UiohookKey.Ctrl,
  UiohookKey.CtrlRight,
  UiohookKey.Alt,
  UiohookKey.AltRight,
  UiohookKey.Shift,
  UiohookKey.ShiftRight,
  UiohookKey.Meta,
  UiohookKey.MetaRight
])

const namedKeys = new Map<number, string>([
  [UiohookKey.Backspace, 'Backspace'],
  [UiohookKey.Tab, 'Tab'],
  [UiohookKey.Enter, 'Enter'],
  [UiohookKey.Escape, 'Escape'],
  [UiohookKey.PageUp, 'PageUp'],
  [UiohookKey.PageDown, 'PageDown'],
  [UiohookKey.End, 'End'],
  [UiohookKey.Home, 'Home'],
  [UiohookKey.ArrowLeft, 'ArrowLeft'],
  [UiohookKey.ArrowUp, 'ArrowUp'],
  [UiohookKey.ArrowRight, 'ArrowRight'],
  [UiohookKey.ArrowDown, 'ArrowDown'],
  [UiohookKey.Insert, 'Insert'],
  [UiohookKey.Delete, 'Delete']
])

export class InputEventService {
  private active = false
  private paused = false
  private sequence = 0
  private callbacks: InputEventCallbacks | null = null
  private writeQueue: Promise<void> = Promise.resolve()
  private typingBurst: PendingTypingBurst | null = null
  private typingTimer: NodeJS.Timeout | null = null
  private scrollBurst: PendingScrollBurst | null = null
  private scrollTimer: NodeJS.Timeout | null = null

  constructor(
    private readonly sessionWriter: SessionWriter,
    private readonly accessibility: AccessibilityBundle | null = null
  ) {}

  requestPermission(): boolean {
    if (process.platform !== 'darwin') {
      return true
    }

    return systemPreferences.isTrustedAccessibilityClient(true)
  }

  start(callbacks: InputEventCallbacks): void {
    if (this.active) {
      throw new Error('Input event capture is already active.')
    }

    this.callbacks = callbacks
    this.sequence = 0
    this.active = true
    this.paused = false
    uIOhook.on('click', this.handleClick)
    uIOhook.on('mousemove', this.handleMouseMove)
    uIOhook.on('keydown', this.handleKeyDown)
    uIOhook.on('wheel', this.handleWheel)
    uIOhook.start()
  }

  async pause(): Promise<void> {
    this.paused = true
    this.flushTypingBurst()
    this.flushScrollBurst()
    await this.writeQueue
  }

  resume(): void {
    if (this.active) {
      this.paused = false
    }
  }

  async stop(): Promise<void> {
    if (!this.active) {
      return
    }

    this.active = false
    this.paused = false
    this.flushTypingBurst()
    this.flushScrollBurst()
    this.clearTimers()
    uIOhook.off('click', this.handleClick)
    uIOhook.off('mousemove', this.handleMouseMove)
    uIOhook.off('keydown', this.handleKeyDown)
    uIOhook.off('wheel', this.handleWheel)
    uIOhook.stop()
    await this.writeQueue
    this.callbacks = null
  }

  private handleClick = (event: UiohookMouseEvent): void => {
    console.log(`${event.x}, ${event.y}, clicked`)

    if (!this.shouldCapture() || this.callbacks?.shouldIgnorePoint(event.x, event.y)) {
      return
    }

    this.flushTypingBurst()
    this.flushScrollBurst()

    const beforeScreenshotId = this.callbacks?.getBeforeScreenshotId()
    const baseData: RecordedEvent['data'] = {
      x: event.x,
      y: event.y,
      button: normalizeMouseButton(event.button),
      clickCount: event.clicks,
      modifiers: getModifiers(event),
      pointer: getPointerMetadata(event.x, event.y)
    }

    if (this.accessibility?.enabled()) {
      void this.enrichClickWithAccessibility(event.x, event.y, baseData, beforeScreenshotId)
      return
    }

    this.saveEvent('click', baseData, beforeScreenshotId)
  }

  private handleMouseMove = (event: UiohookMouseEvent): void => {
    console.log(`${event.x}, ${event.y}`)
  }

  /**
   * Phase 2 (experimental): query the platform accessibility element under the
   * click and attach its role/label/bounds to the event. Bounds are converted
   * from the AX global-point frame to screenshot-pixel space (display-relative
   * points x scaleFactor = display physical pixels = screenshot pixels). Falls
   * back silently to a coordinate-only event on any failure.
   */
  private async enrichClickWithAccessibility(
    x: number,
    y: number,
    baseData: RecordedEvent['data'],
    beforeScreenshotId: string | undefined
  ): Promise<void> {
    let data = baseData
    try {
      const element = await this.accessibility!.inspector.getElementAtPoint(x, y)
      if (element) {
        const targetBounds = toScreenshotBounds(element.bounds, x, y)
        data = { ...baseData }
        if (element.role) {
          data.targetRole = element.role
        }
        if (element.label) {
          data.targetLabel = element.label
        }
        if (targetBounds) {
          data.targetBounds = targetBounds
        }
        if (!element.isSecure && element.text) {
          data.elementText = element.text
        }
        if (element.isSecure) {
          data.isSecureField = true
        }
      }
    } catch {
      // Best-effort: keep the coordinate-only event.
    }

    if (this.shouldCapture()) {
      this.saveEvent('click', data, beforeScreenshotId)
    }
  }

  private handleKeyDown = (event: UiohookKeyboardEvent): void => {
    if (!this.shouldCapture() || modifierKeys.has(event.keycode)) {
      return
    }

    if (characterKeys.has(event.keycode)) {
      const now = Date.now()
      if (!this.typingBurst) {
        this.typingBurst = {
          startedAt: now,
          lastAt: now,
          keyCount: 0,
          modifiers: new Set()
        }
      }

      this.typingBurst.lastAt = now
      this.typingBurst.keyCount += 1
      for (const modifier of getModifiers(event)) {
        this.typingBurst.modifiers.add(modifier)
      }
      this.resetTypingTimer()
      return
    }

    this.flushTypingBurst()
    this.saveEvent('key', {
      key: namedKeys.get(event.keycode) ?? `KeyCode:${event.keycode}`,
      category: getKeyCategory(event.keycode),
      modifiers: getModifiers(event)
    })
  }

  private handleWheel = (event: UiohookWheelEvent): void => {
    if (!this.shouldCapture() || this.callbacks?.shouldIgnorePoint(event.x, event.y)) {
      return
    }

    const now = Date.now()
    if (!this.scrollBurst) {
      this.scrollBurst = {
        startedAt: now,
        lastAt: now,
        x: event.x,
        y: event.y,
        deltaX: 0,
        deltaY: 0
      }
    }

    this.scrollBurst.lastAt = now
    this.scrollBurst.x = event.x
    this.scrollBurst.y = event.y
    const delta = event.rotation * Math.max(1, event.amount)
    if (event.direction === WheelDirection.HORIZONTAL) {
      this.scrollBurst.deltaX += delta
    } else {
      this.scrollBurst.deltaY += delta
    }
    this.resetScrollTimer()
  }

  private flushTypingBurst(): void {
    if (!this.typingBurst) {
      return
    }

    const burst = this.typingBurst
    this.typingBurst = null
    if (this.typingTimer) {
      clearTimeout(this.typingTimer)
      this.typingTimer = null
    }

    this.saveEvent('key', {
      category: 'typing-burst',
      keyCount: burst.keyCount,
      durationMs: burst.lastAt - burst.startedAt,
      modifiers: [...burst.modifiers],
      textCaptured: false
    })
  }

  private flushScrollBurst(): void {
    if (!this.scrollBurst) {
      return
    }

    const burst = this.scrollBurst
    this.scrollBurst = null
    if (this.scrollTimer) {
      clearTimeout(this.scrollTimer)
      this.scrollTimer = null
    }

    this.saveEvent('scroll', {
      x: burst.x,
      y: burst.y,
      deltaX: burst.deltaX,
      deltaY: burst.deltaY,
      durationMs: burst.lastAt - burst.startedAt,
      pointer: getPointerMetadata(burst.x, burst.y)
    })
  }

  private saveEvent(
    type: RecordedEvent['type'],
    data: RecordedEvent['data'],
    beforeScreenshotId?: string
  ): void {
    if (!this.callbacks) {
      return
    }

    const event: RecordedEvent = {
      id: randomUUID(),
      sequence: ++this.sequence,
      timestamp: new Date().toISOString(),
      type,
      data,
      beforeScreenshotId: beforeScreenshotId ?? this.callbacks.getBeforeScreenshotId()
    }

    this.callbacks.onEventCaptured(event)
    this.writeQueue = this.writeQueue
      .then(() => this.sessionWriter.appendEvent(event))
      .then(() => this.callbacks?.onEventSaved(event))
      .catch((error) => {
        this.callbacks?.onError(
          error instanceof Error ? error : new Error('Could not save an input event.')
        )
      })
  }

  private shouldCapture(): boolean {
    return this.active && !this.paused && Boolean(this.callbacks)
  }

  private resetTypingTimer(): void {
    if (this.typingTimer) {
      clearTimeout(this.typingTimer)
    }
    this.typingTimer = setTimeout(() => this.flushTypingBurst(), 800)
  }

  private resetScrollTimer(): void {
    if (this.scrollTimer) {
      clearTimeout(this.scrollTimer)
    }
    this.scrollTimer = setTimeout(() => this.flushScrollBurst(), 300)
  }

  private clearTimers(): void {
    if (this.typingTimer) {
      clearTimeout(this.typingTimer)
      this.typingTimer = null
    }
    if (this.scrollTimer) {
      clearTimeout(this.scrollTimer)
      this.scrollTimer = null
    }
  }
}

function getModifiers(event: {
  shiftKey: boolean
  ctrlKey: boolean
  altKey: boolean
  metaKey: boolean
}): string[] {
  return [
    event.shiftKey ? 'shift' : '',
    event.ctrlKey ? 'control' : '',
    event.altKey ? 'alt' : '',
    event.metaKey ? 'meta' : ''
  ].filter(Boolean)
}

function getKeyCategory(keycode: number): string {
  if (keycode >= UiohookKey.F1 && keycode <= UiohookKey.F12) {
    return 'function'
  }
  if (
    keycode === UiohookKey.ArrowLeft ||
    keycode === UiohookKey.ArrowUp ||
    keycode === UiohookKey.ArrowRight ||
    keycode === UiohookKey.ArrowDown ||
    keycode === UiohookKey.Home ||
    keycode === UiohookKey.End ||
    keycode === UiohookKey.PageUp ||
    keycode === UiohookKey.PageDown
  ) {
    return 'navigation'
  }
  return 'editing'
}

function normalizeMouseButton(button: unknown): string {
  if (button === 1) return 'left'
  if (button === 2) return 'right'
  if (button === 3) return 'middle'
  return 'other'
}

function getPointerMetadata(x: number, y: number) {
  const display = screen.getDisplayNearestPoint({ x, y })

  return {
    coordinateSpace: 'global-screen',
    x,
    y,
    displayId: display.id.toString(),
    displayScaleFactor: display.scaleFactor,
    pointOnDisplay: {
      x: x - display.bounds.x,
      y: y - display.bounds.y
    }
  }
}

/** Convert an AX element frame (global screen points) to screenshot-pixel
 * space. Screenshot pixels equal display physical pixels, which equal display
 * points x scaleFactor. */
function toScreenshotBounds(
  bounds: AccessibilityRect | null,
  x: number,
  y: number
): { x: number; y: number; width: number; height: number } | null {
  if (!bounds) {
    return null
  }
  const display = screen.getDisplayNearestPoint({ x, y })
  const scale = display.scaleFactor
  return {
    x: Math.round((bounds.x - display.bounds.x) * scale),
    y: Math.round((bounds.y - display.bounds.y) * scale),
    width: Math.max(1, Math.round(bounds.width * scale)),
    height: Math.max(1, Math.round(bounds.height * scale))
  }
}
