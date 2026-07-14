import { createHash, randomUUID } from 'node:crypto'
import {
  desktopCapturer,
  screen,
  systemPreferences,
  type DesktopCapturerSource,
  type Display
} from 'electron'
import type {
  CaptureDisplayMetadata,
  RecordedEvent,
  RecordingOptions,
  ScreenshotRecord
} from '../../shared/recording'
import { SessionWriter } from './SessionWriter'

interface ScreenCaptureCallbacks {
  onScreenshotSaved: (record: ScreenshotRecord) => void
  onError: (error: Error) => void
}

export class ScreenCaptureService {
  private active = false
  private paused = false
  private captureInProgress = false
  private timer: NodeJS.Timeout | null = null
  private background: Buffer | null = null
  private pendingChange = false
  private changeStartedAt = 0
  private lastChangedAt = 0
  private highestChangeScore = 0
  private lastInputAt = 0
  private lastCaptureAt = 0
  private startedAt = 0
  private calibrated = false
  private adaptiveThreshold = 0
  private calibrationSamples: number[] = []
  private screenshotSequence = 0
  private options: RecordingOptions | null = null
  private callbacks: ScreenCaptureCallbacks | null = null
  private currentScreenshotId: string | undefined
  private pendingEventIds: string[] = []

  constructor(private readonly sessionWriter: SessionWriter) {}

  async start(options: RecordingOptions, callbacks: ScreenCaptureCallbacks): Promise<void> {
    if (this.active) {
      throw new Error('Screen capture is already active.')
    }

    if (process.platform === 'darwin') {
      const permission = systemPreferences.getMediaAccessStatus('screen')
      if (permission === 'denied' || permission === 'restricted') {
        throw new Error(
          'Screen Recording permission is required. Enable it in System Settings > Privacy & Security > Screen Recording.'
        )
      }
    }

    this.options = options
    this.callbacks = callbacks
    this.active = true
    this.paused = false
    this.background = null
    this.pendingChange = false
    this.screenshotSequence = 0
    this.currentScreenshotId = undefined
    this.pendingEventIds = []
    this.lastInputAt = 0
    this.lastCaptureAt = Date.now()
    this.startedAt = Date.now()
    this.calibrated = false
    this.calibrationSamples = []
    this.adaptiveThreshold = options.changeThreshold

    try {
      await this.captureAndSave(1)
      await this.sample()
    } catch (error) {
      this.resetRuntimeState()
      throw error
    }
  }

  pause(): void {
    this.paused = true
    this.clearTimer()
  }

  resume(): void {
    if (!this.active) {
      return
    }

    this.paused = false
    this.scheduleNextSample(0)
  }

  async stop(): Promise<void> {
    this.active = false
    this.paused = false
    this.clearTimer()

    while (this.captureInProgress) {
      await new Promise<void>((resolve) => setTimeout(resolve, 25))
    }

    if (this.pendingChange) {
      await this.captureAndSave(this.highestChangeScore)
    }

    this.resetRuntimeState()
  }

  getCurrentScreenshotId(): string | undefined {
    return this.currentScreenshotId
  }

  /**
   * Called by the input layer for every captured event. Two roles:
   *  (1) attribution — the event id is stamped onto the next saved screenshot,
   *      used downstream to pair annotations with frames; and
   *  (2) scheduling  — input marks "recent activity", which lowers the change
   *      threshold (4-D) and classifies sustained motion as intentional
   *      navigation vs ambient animation (5-B). Significant events (click,
   *      app-switch, navigation) also trigger an immediate sample so we capture
   *      a tight at/near-event frame, improving before/after pairing for
   *      highlight annotation.
   */
  registerInput(eventId: string, eventType: RecordedEvent['type']): void {
    this.lastInputAt = Date.now()
    if (!this.pendingEventIds.includes(eventId)) {
      this.pendingEventIds.push(eventId)
    }

    const significant =
      eventType === 'click' || eventType === 'app-switch' || eventType === 'navigation'
    if (significant && !this.captureInProgress) {
      this.scheduleNextSample(0)
    }
  }

  private async sample(): Promise<void> {
    if (!this.active || this.paused || !this.options || this.captureInProgress) {
      return
    }

    this.captureInProgress = true

    try {
      const source = await this.getDisplaySource({
        width: this.options.thumbnailWidth,
        height: this.options.thumbnailHeight
      })
      const thumbnail = source.thumbnail
        .resize({
          width: this.options.thumbnailWidth,
          height: this.options.thumbnailHeight,
          quality: 'good'
        })
        .toBitmap()

      // Seed the background model from the very first frame.
      if (!this.background) {
        this.background = Buffer.from(thumbnail)
        return
      }

      const now = Date.now()
      const changeScore = calculateChangeScore(
        this.background,
        thumbnail,
        this.options.thumbnailWidth,
        this.options.thumbnailHeight
      )

      this.runCalibration(now, changeScore)

      // 4-D: input-gated sensitivity. Recent input means the user just acted —
      // expect a visual consequence, so use the base threshold. During idle,
      // raise the threshold so ambient churn (cursor blink, ads, clocks)
      // cannot trigger captures.
      const recentInput = now - this.lastInputAt <= this.options.inputSensitivityWindowMs
      const threshold =
        this.adaptiveThreshold * (recentInput ? 1 : this.options.idleThresholdMultiplier)
      const isChange = changeScore >= threshold

      if (isChange) {
        if (!this.pendingChange) {
          this.pendingChange = true
          this.changeStartedAt = now
        }
        this.lastChangedAt = now
        this.highestChangeScore = Math.max(this.highestChangeScore, changeScore)
      } else {
        // 4-C: stable frame — fold it into the EMA background. Transient motion
        // is excluded (we only blend when NOT changing), so the model tracks
        // the real steady state and periodic noise averages out.
        this.background = blendBackground(this.background, thumbnail, this.options.emaAlpha)
      }

      if (this.pendingChange) {
        await this.maybeFlushPendingChange(now, recentInput)
      }
    } catch (error) {
      const captureError =
        error instanceof Error ? error : new Error('Screen capture failed unexpectedly.')
      this.callbacks?.onError(captureError)
      this.resetRuntimeState()
    } finally {
      this.captureInProgress = false
      this.scheduleNextSample()
    }
  }

  /**
   * Decide whether the pending-change window should be flushed into a full-res
   * capture. Implements 5-B (input-correlated sampling) and 5-C (navigation
   * endpoint vs ambient suppression):
   *  - Navigation (sustained change WITH recent input, e.g. scrolling/dragging):
   *    wait for input to stop, then capture the settled "destination" frame;
   *    a periodic floor prevents long navigations from starving.
   *  - Ambient (sustained change WITHOUT input, e.g. video/animation): suppress;
   *    only the hard cap forces a frame so we never block forever.
   *  - Normal short change: capture once it has settled.
   */
  private async maybeFlushPendingChange(now: number, recentInput: boolean): Promise<void> {
    if (!this.options) {
      return
    }

    const settled = now - this.lastChangedAt >= this.options.settleDurationMs
    let capture = false

    if (recentInput) {
      // 5-C: capture the endpoint — the frame after the user stopped acting.
      const inputStopped = now - this.lastInputAt >= this.options.settleDurationMs
      capture = settled && inputStopped
      // 5-B: periodic floor so a long scroll/drag still yields frames.
      if (!capture && now - this.lastCaptureAt >= this.options.navigationSampleIntervalMs) {
        capture = true
      }
    } else {
      capture = settled
      // 5-C backstop: ambient sustained change is capped (not starved).
      if (!capture && now - this.changeStartedAt >= this.options.maxSettleDurationMs) {
        capture = true
      }
    }

    if (capture) {
      await this.captureAndSave(this.highestChangeScore)
      this.lastCaptureAt = now
      this.resetPendingChange()
    }
  }

  /**
   * 4-A: measure the ambient change-score baseline during the first
   * `calibrationDurationMs` of idle recording and raise the threshold above
   * the measured noise floor. Aborts (falling back to the base threshold) the
   * moment the user starts acting, so calibration never fights real input.
   */
  private runCalibration(now: number, changeScore: number): void {
    if (this.calibrated || !this.options) {
      return
    }

    const recentInput = now - this.lastInputAt <= this.options.inputSensitivityWindowMs
    if (recentInput || now - this.startedAt >= this.options.calibrationDurationMs) {
      if (!recentInput && this.calibrationSamples.length > 0) {
        const sorted = [...this.calibrationSamples].sort((a, b) => a - b)
        const median = sorted[Math.floor(sorted.length / 2)]
        this.adaptiveThreshold = Math.max(this.options.changeThreshold, median * 2.5 + 0.004)
      } else {
        this.adaptiveThreshold = this.options.changeThreshold
      }
      this.calibrated = true
      return
    }

    this.calibrationSamples.push(changeScore)
  }

  private async captureAndSave(changeScore: number): Promise<void> {
    if (!this.options) {
      return
    }

    const display = this.getTargetDisplay()
    const width = Math.round(display.size.width * display.scaleFactor)
    const height = Math.round(display.size.height * display.scaleFactor)
    const source = await this.getDisplaySource({ width, height })
    const png = source.thumbnail.toPNG()
    const imageSize = source.thumbnail.getSize()
    const sequence = ++this.screenshotSequence
    const id = randomUUID()
    const record: ScreenshotRecord = {
      id,
      sequence,
      capturedAt: new Date().toISOString(),
      eventIds: [...this.pendingEventIds],
      filename: `${sequence.toString().padStart(5, '0')}-${id}.png`,
      width: imageSize.width,
      height: imageSize.height,
      changeScore,
      contentHash: createHash('sha256').update(png).digest('hex'),
      capture: {
        coordinateSpace: 'display-pixels',
        display: serializeDisplay(display),
        imageSize
      }
    }

    await this.sessionWriter.appendScreenshot(record, png)
    this.currentScreenshotId = record.id
    this.pendingEventIds = []
    this.callbacks?.onScreenshotSaved(record)
  }

  private async getDisplaySource(thumbnailSize: {
    width: number
    height: number
  }): Promise<DesktopCapturerSource> {
    const display = this.getTargetDisplay()
    const sources = await this.getScreenSources(thumbnailSize)
    const displayId = display.id.toString()
    const source =
      sources.find((candidate) => candidate.display_id === displayId) ??
      sources.find((candidate) => candidate.name === `Screen ${displayId}`) ??
      sources[0]

    if (!source) {
      throw new Error(getUnavailableDisplayMessage('macOS returned no display sources.'))
    }

    if (source.thumbnail.isEmpty()) {
      const fallbackSources = await this.getScreenSources({
        width: Math.min(thumbnailSize.width, 1920),
        height: Math.min(thumbnailSize.height, 1080)
      })
      const fallback =
        fallbackSources.find((candidate) => candidate.display_id === displayId) ??
        fallbackSources[0]

      if (!fallback || fallback.thumbnail.isEmpty()) {
        throw new Error(
          getUnavailableDisplayMessage('macOS returned an empty display image.')
        )
      }

      return fallback
    }

    return source
  }

  private getScreenSources(thumbnailSize: {
    width: number
    height: number
  }): Promise<DesktopCapturerSource[]> {
    return desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize,
      fetchWindowIcons: false
    })
  }

  private getTargetDisplay() {
    if (this.options?.displayId) {
      const matchingDisplay = screen
        .getAllDisplays()
        .find((display) => display.id.toString() === this.options?.displayId)
      if (matchingDisplay) {
        return matchingDisplay
      }
    }

    return screen.getPrimaryDisplay()
  }

  private scheduleNextSample(delay = this.options?.sampleIntervalMs ?? 250): void {
    this.clearTimer()

    if (!this.active || this.paused) {
      return
    }

    this.timer = setTimeout(() => void this.sample(), delay)
  }

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  private resetPendingChange(): void {
    this.pendingChange = false
    this.changeStartedAt = 0
    this.lastChangedAt = 0
    this.highestChangeScore = 0
  }

  private resetRuntimeState(): void {
    this.active = false
    this.paused = false
    this.captureInProgress = false
    this.clearTimer()
    this.background = null
    this.currentScreenshotId = undefined
    this.pendingEventIds = []
    this.lastInputAt = 0
    this.lastCaptureAt = 0
    this.startedAt = 0
    this.calibrated = false
    this.calibrationSamples = []
    this.adaptiveThreshold = 0
    this.options = null
    this.callbacks = null
    this.resetPendingChange()
  }
}

function serializeDisplay(display: Display): CaptureDisplayMetadata {
  return {
    id: display.id.toString(),
    scaleFactor: display.scaleFactor,
    bounds: {
      x: display.bounds.x,
      y: display.bounds.y,
      width: display.bounds.width,
      height: display.bounds.height
    },
    workArea: {
      x: display.workArea.x,
      y: display.workArea.y,
      width: display.workArea.width,
      height: display.workArea.height
    }
  }
}

function blendBackground(background: Buffer, frame: Buffer, alpha: number): Buffer {
  const weight = Math.min(1, Math.max(0, alpha))
  const blended = Buffer.allocUnsafe(background.length)
  for (let index = 0; index < background.length; index += 1) {
    blended[index] = Math.round(background[index] * (1 - weight) + frame[index] * weight)
  }
  return blended
}

function getUnavailableDisplayMessage(detail: string): string {
  if (process.platform === 'darwin') {
    return `Screen capture could not start. ${detail} Fully quit and reopen WorkTrace after enabling Screen & System Audio Recording.`
  }

  return `Screen capture could not start. ${detail}`
}

function calculateChangeScore(
  previous: Buffer,
  current: Buffer,
  width: number,
  requestedHeight: number
): number {
  const pixelCount = Math.floor(Math.min(previous.length, current.length) / 4)
  if (pixelCount === 0) {
    return 0
  }

  let changedPixels = 0
  const brightnessThreshold = 18
  const blockColumns = 8
  const blockRows = 6
  const blockChanged = new Uint32Array(blockColumns * blockRows)
  const blockTotals = new Uint32Array(blockColumns * blockRows)
  const height = Math.min(requestedHeight, Math.max(1, Math.floor(pixelCount / width)))

  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
    const index = pixelIndex * 4
    const previousLuma =
      previous[index + 2] * 0.299 + previous[index + 1] * 0.587 + previous[index] * 0.114
    const currentLuma =
      current[index + 2] * 0.299 + current[index + 1] * 0.587 + current[index] * 0.114
    const x = pixelIndex % width
    const y = Math.floor(pixelIndex / width)
    const blockX = Math.min(blockColumns - 1, Math.floor((x / width) * blockColumns))
    const blockY = Math.min(blockRows - 1, Math.floor((y / height) * blockRows))
    const blockIndex = blockY * blockColumns + blockX

    blockTotals[blockIndex] += 1
    if (Math.abs(previousLuma - currentLuma) >= brightnessThreshold) {
      changedPixels += 1
      blockChanged[blockIndex] += 1
    }
  }

  let highestBlockScore = 0
  for (let index = 0; index < blockChanged.length; index += 1) {
    if (blockTotals[index] > 0) {
      highestBlockScore = Math.max(highestBlockScore, blockChanged[index] / blockTotals[index])
    }
  }

  const globalScore = changedPixels / pixelCount
  return Math.max(globalScore, highestBlockScore * 0.12)
}
