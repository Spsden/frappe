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
import { RecordingUploader } from './RecordingUploader'
import { AudioCaptureService } from './AudioCaptureService'

const idleState: RecordingState = {
  status: 'idle',
  sessionId: null,
  sessionName: null,
  startedAt: null,
  pausedAt: null,
  accumulatedPausedMs: 0,
  eventCount: 0,
  screenshotCount: 0,
  audioChunkCount: 0,
  outputPath: null,
  remoteRecordingId: null,
  remoteSessionId: null,
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
    private readonly audioCapture: AudioCaptureService,
    private readonly recordingUploader: RecordingUploader,
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
      await this.audioCapture.start(this.options, {
        onAudioChunkSaved: () => {
          this.updateState({ audioChunkCount: this.state.audioChunkCount + 1 })
        },
        onError: (error) => {
          this.updateState({
            status: 'error',
            error: error.message
          })
          void this.sessionWriter.setStatus('error')
          void this.inputEvents.stop().catch(() => {})
          void this.screenCapture.stop().catch(() => {})
          void this.audioCapture.stop().catch(() => {})
        }
      })
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
          void this.audioCapture.stop().catch(() => {})
        }
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Screen capture could not start.'
      this.updateState({ status: 'error', error: message })
      await this.sessionWriter.setStatus('error')
      await this.audioCapture.stop()
      throw error
    }

    try {
      this.inputEvents.start({
        getBeforeScreenshotId: () => this.screenCapture.getCurrentScreenshotId(),
        shouldIgnorePoint: this.shouldIgnoreInputPoint,
        onEventCaptured: (event) => {
          this.screenCapture.registerInput(event.id, event.type)
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
      await this.audioCapture.stop()
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
    this.audioCapture.pause()
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
    this.audioCapture.resume()
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
    await this.audioCapture.stop()
    await this.sessionWriter.setStatus('completed')
    this.updateState({ status: 'awaiting-save' })
    return this.getState()
  }

  async save(name: string): Promise<RecordingState> {
    this.assertStatus('awaiting-save', 'save')
    const trimmedName = name.trim()
    if (trimmedName.length === 0) {
      throw new Error('Recording name is required.')
    }

    const sessionPath = this.state.outputPath
    if (!sessionPath) {
      throw new Error('Recording was saved without an output path.')
    }

    await this.sessionWriter.setName(trimmedName)
    this.updateState({
      status: 'uploading',
      sessionName: trimmedName
    })

    try {
      const remoteRecording = await this.recordingUploader.uploadCompletedSession(sessionPath)
      await this.sessionWriter.setRemoteRecording(remoteRecording)
      this.updateState({
        status: 'processing',
        remoteRecordingId: remoteRecording.recordingId,
        remoteSessionId: remoteRecording.sessionId
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Recording upload failed.'
      await this.sessionWriter.setUploadError(message)
      this.updateState({
        status: 'error',
        error: `Recording is saved locally, but upload failed: ${message}`
      })
      throw error
    }

    this.updateState({ status: 'completed' })
    return this.getState()
  }

  async discard(): Promise<RecordingState> {
    if (this.state.status !== 'awaiting-save' && this.state.status !== 'error') {
      throw new Error(`Cannot discard a recording while status is ${this.state.status}`)
    }

    await this.sessionWriter.discardSession()
    this.options = { ...defaultRecordingOptions }
    this.updateState({ ...idleState })
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
