import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import {
  defaultRecordingOptions,
  type RecordingOptions,
  type RecordingPlatform,
  type RecordingState
} from '../../shared/recording'
import { SessionWriter } from './SessionWriter'
import { ScreenCaptureService } from './ScreenCaptureService'
import { InputEventService } from './InputEventService'

const idleState: RecordingState = {
  status: 'idle',
  sessionId: null,
  sessionName: null,
  startedAt: null,
  pausedAt: null,
  accumulatedPausedMs: 0,
  eventCount: 0,
  screenshotCount: 0,
  outputPath: null,
  error: null
}

function getRecordingPlatform(): RecordingPlatform {
  if (process.platform === 'darwin' || process.platform === 'win32') {
    return process.platform
  }

  return 'linux'
}

export class RecordingManager extends EventEmitter {
  private state: RecordingState = { ...idleState }
  private options: RecordingOptions = { ...defaultRecordingOptions }

  constructor(
    private readonly sessionWriter: SessionWriter,
    private readonly screenCapture: ScreenCaptureService,
    private readonly inputEvents: InputEventService,
    private readonly shouldIgnoreInputPoint: (x: number, y: number) => boolean
  ) {
    super()
  }

  getState(): RecordingState {
    return { ...this.state }
  }

  getOptions(): RecordingOptions {
    return { ...this.options }
  }

  async start(options: Partial<RecordingOptions> = {}): Promise<RecordingState> {
    if (
      this.state.status !== 'idle' &&
      this.state.status !== 'completed' &&
      this.state.status !== 'error'
    ) {
      throw new Error(`Cannot start a recording while status is ${this.state.status}`)
    }

    this.updateState({ ...idleState, status: 'requesting-permissions' })
    if (!this.inputEvents.requestPermission()) {
      const message =
        'Accessibility permission is required. Enable WorkTrace in System Settings > Privacy & Security > Accessibility, then try again.'
      this.updateState({ status: 'error', error: message })
      throw new Error(message)
    }

    this.options = { ...defaultRecordingOptions, ...options }
    this.updateState({
      ...idleState,
      status: 'starting',
      sessionId: randomUUID(),
      sessionName: this.options.name?.trim() || 'Untitled workflow',
      startedAt: new Date().toISOString()
    })

    try {
      const outputPath = await this.sessionWriter.createSession(
        this.state.sessionId!,
        this.state.sessionName!,
        getRecordingPlatform(),
        this.options
      )
      this.updateState({ outputPath })
    } catch (error) {
      this.updateState({
        status: 'error',
        error: error instanceof Error ? error.message : 'Could not create the recording session.'
      })
      throw error
    }

    try {
      await this.screenCapture.start(this.options, {
        onScreenshotSaved: () => {
          this.updateState({ screenshotCount: this.state.screenshotCount + 1 })
        },
        onError: (error) => {
          this.updateState({
            status: 'error',
            error: error.message
          })
          void this.sessionWriter.setStatus('error')
          void this.inputEvents.stop().catch(() => {})
          void this.screenCapture.stop().catch(() => {})
        }
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Screen capture could not start.'
      this.updateState({ status: 'error', error: message })
      await this.sessionWriter.setStatus('error')
      throw error
    }

    try {
      this.inputEvents.start({
        getBeforeScreenshotId: () => this.screenCapture.getCurrentScreenshotId(),
        shouldIgnorePoint: this.shouldIgnoreInputPoint,
        onEventCaptured: (event) => {
          this.screenCapture.registerEvent(event.id)
        },
        onEventSaved: () => {
          this.updateState({ eventCount: this.state.eventCount + 1 })
        },
        onError: (error) => {
          this.updateState({ status: 'error', error: error.message })
          void this.sessionWriter.setStatus('error')
          void this.inputEvents.stop().catch(() => {})
          void this.screenCapture.stop().catch(() => {})
        }
      })
    } catch (error) {
      await this.screenCapture.stop()
      const message = error instanceof Error ? error.message : 'Input capture could not start.'
      this.updateState({ status: 'error', error: message })
      await this.sessionWriter.setStatus('error')
      throw error
    }

    this.updateState({ status: 'recording' })
    return this.getState()
  }

  async pause(): Promise<RecordingState> {
    this.assertStatus('recording', 'pause')
    this.updateState({
      status: 'paused',
      pausedAt: new Date().toISOString()
    })
    await this.inputEvents.pause()
    this.screenCapture.pause()
    await this.sessionWriter.setStatus('paused')
    return this.getState()
  }

  async resume(): Promise<RecordingState> {
    this.assertStatus('paused', 'resume')

    const pausedDuration = this.state.pausedAt
      ? Date.now() - new Date(this.state.pausedAt).getTime()
      : 0

    this.updateState({
      status: 'recording',
      pausedAt: null,
      accumulatedPausedMs: this.state.accumulatedPausedMs + pausedDuration
    })
    this.inputEvents.resume()
    this.screenCapture.resume()
    await this.sessionWriter.setStatus('recording')
    return this.getState()
  }

  async stop(): Promise<RecordingState> {
    if (this.state.status !== 'recording' && this.state.status !== 'paused') {
      throw new Error(`Cannot stop a recording while status is ${this.state.status}`)
    }

    let accumulatedPausedMs = this.state.accumulatedPausedMs
    if (this.state.status === 'paused' && this.state.pausedAt) {
      accumulatedPausedMs += Date.now() - new Date(this.state.pausedAt).getTime()
    }

    this.updateState({
      status: 'stopping',
      pausedAt: null,
      accumulatedPausedMs
    })

    await this.inputEvents.stop()
    await this.screenCapture.stop()
    this.updateState({ status: 'processing' })
    await this.sessionWriter.setStatus('completed')
    this.updateState({ status: 'completed' })
    return this.getState()
  }

  reset(): RecordingState {
    this.options = { ...defaultRecordingOptions }
    this.updateState({ ...idleState })
    return this.getState()
  }

  private assertStatus(expected: RecordingState['status'], action: string): void {
    if (this.state.status !== expected) {
      throw new Error(`Cannot ${action} a recording while status is ${this.state.status}`)
    }
  }

  private updateState(update: Partial<RecordingState>): void {
    this.state = { ...this.state, ...update }
    this.emit('state-changed', this.getState())
  }
}
