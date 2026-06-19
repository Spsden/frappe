import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import {
  defaultRecordingOptions,
  type RecordingOptions,
  type RecordingState
} from '../../shared/recording'

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

export class RecordingManager extends EventEmitter {
  private state: RecordingState = { ...idleState }
  private options: RecordingOptions = { ...defaultRecordingOptions }

  getState(): RecordingState {
    return { ...this.state }
  }

  getOptions(): RecordingOptions {
    return { ...this.options }
  }

  async start(options: Partial<RecordingOptions> = {}): Promise<RecordingState> {
    if (this.state.status !== 'idle' && this.state.status !== 'completed') {
      throw new Error(`Cannot start a recording while status is ${this.state.status}`)
    }

    this.options = { ...defaultRecordingOptions, ...options }
    this.updateState({
      ...idleState,
      status: 'starting',
      sessionId: randomUUID(),
      sessionName: this.options.name?.trim() || 'Untitled workflow',
      startedAt: new Date().toISOString()
    })

    this.updateState({ status: 'recording' })
    return this.getState()
  }

  async pause(): Promise<RecordingState> {
    this.assertStatus('recording', 'pause')
    this.updateState({
      status: 'paused',
      pausedAt: new Date().toISOString()
    })
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

    this.updateState({ status: 'processing' })
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
