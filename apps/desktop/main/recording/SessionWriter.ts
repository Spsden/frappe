import { appendFile, mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  AudioChunkRecord,
  RecordedEvent,
  RecordingOptions,
  RecordingPlatform,
  RecordingSessionManifest,
  ScreenshotRecord
} from '../../shared/recording'

export class SessionWriter {
  private manifest: RecordingSessionManifest | null = null
  private sessionPath: string | null = null
  private queue: Promise<void> = Promise.resolve()

  constructor(private readonly recordingsPath: string) {}

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue = this.queue.finally(async () => {
        try {
          resolve(await task())
        } catch (error) {
          reject(error)
        }
      })
    })
  }

  async createSession(
    id: string,
    name: string,
    platform: RecordingPlatform,
    options: RecordingOptions
  ): Promise<string> {
    return this.enqueue(async () => {
      this.sessionPath = join(this.recordingsPath, id)
      await mkdir(join(this.sessionPath, 'screenshots'), { recursive: true })
      await mkdir(join(this.sessionPath, 'audio'), { recursive: true })

      this.manifest = {
        schemaVersion: 1,
        id,
        name,
        platform,
        startedAt: new Date().toISOString(),
        endedAt: null,
        status: 'recording',
        options,
        eventCount: 0,
        screenshotCount: 0,
        audioChunkCount: 0,
        workflowId: null,
        reference: null,
        remoteRecordingId: null,
        remoteSessionId: null,
        remoteStatus: null,
        uploadedAt: null,
        uploadError: null
      }

      await this.writeManifest()
      await writeFile(join(this.sessionPath, 'events.jsonl'), '')
      await writeFile(join(this.sessionPath, 'screenshots.jsonl'), '')
      await writeFile(join(this.sessionPath, 'audio.jsonl'), '')
      return this.sessionPath
    })
  }

  async setStatus(status: RecordingSessionManifest['status']): Promise<void> {
    return this.enqueue(async () => {
      const { manifest } = this.requireSession()
      manifest.status = status

      if (status === 'completed' || status === 'interrupted' || status === 'error') {
        manifest.endedAt = new Date().toISOString()
      }

      await this.writeManifest()
    })
  }

  async appendEvent(event: RecordedEvent): Promise<void> {
    return this.enqueue(async () => {
      const { manifest, sessionPath } = this.requireSession()
      await appendFile(join(sessionPath, 'events.jsonl'), `${JSON.stringify(event)}\n`)
      manifest.eventCount += 1
      await this.writeManifest()
    })
  }

  async appendScreenshot(record: ScreenshotRecord, png: Uint8Array): Promise<void> {
    return this.enqueue(async () => {
      const { manifest, sessionPath } = this.requireSession()
      await writeFile(join(sessionPath, 'screenshots', record.filename), png)
      await appendFile(join(sessionPath, 'screenshots.jsonl'), `${JSON.stringify(record)}\n`)
      manifest.screenshotCount += 1
      await this.writeManifest()
    })
  }

  async appendAudioChunk(record: AudioChunkRecord, payload: Uint8Array): Promise<void> {
    return this.enqueue(async () => {
      const { manifest, sessionPath } = this.requireSession()
      await writeFile(join(sessionPath, 'audio', record.filename), payload)
      await appendFile(join(sessionPath, 'audio.jsonl'), `${JSON.stringify(record)}\n`)
      manifest.audioChunkCount += 1
      await this.writeManifest()
    })
  }

  async setRemoteRecording(upload: {
    recordingId: string
    sessionId: string | null
    status: string
  }): Promise<void> {
    return this.enqueue(async () => {
      const { manifest } = this.requireSession()
      manifest.remoteRecordingId = upload.recordingId
      manifest.remoteSessionId = upload.sessionId
      manifest.remoteStatus = upload.status
      manifest.uploadedAt = new Date().toISOString()
      manifest.uploadError = null
      await this.writeManifest()
    })
  }

  async setName(name: string): Promise<void> {
    return this.enqueue(async () => {
      const { manifest } = this.requireSession()
      manifest.name = name
      await this.writeManifest()
    })
  }

  async setWorkflowSelection(selection: {
    workflowId?: string
    workflowName: string
    reference?: string
  }): Promise<void> {
    return this.enqueue(async () => {
      const { manifest } = this.requireSession()
      manifest.name = selection.workflowName
      manifest.workflowId = selection.workflowId?.trim() || null
      manifest.reference = selection.reference?.trim() || null
      await this.writeManifest()
    })
  }

  async setUploadError(message: string): Promise<void> {
    return this.enqueue(async () => {
      const { manifest } = this.requireSession()
      manifest.uploadError = message
      await this.writeManifest()
    })
  }

  async discardSession(): Promise<void> {
    return this.enqueue(async () => {
      const sessionPath = this.sessionPath
      this.manifest = null
      this.sessionPath = null
      if (sessionPath) {
        await rm(sessionPath, { force: true, recursive: true })
      }
    })
  }

  getSessionPath(): string | null {
    return this.sessionPath
  }

  private async writeManifest(): Promise<void> {
    const { manifest, sessionPath } = this.requireSession()
    const temporaryPath = join(sessionPath, 'manifest.tmp.json')
    const manifestPath = join(sessionPath, 'manifest.json')
    const json = `${JSON.stringify(manifest, null, 2)}\n`

    await writeFile(temporaryPath, json)
    await rename(temporaryPath, manifestPath)
  }

  private requireSession(): {
    manifest: RecordingSessionManifest
    sessionPath: string
  } {
    if (!this.manifest || !this.sessionPath) {
      throw new Error('No recording session is active.')
    }

    return {
      manifest: this.manifest,
      sessionPath: this.sessionPath
    }
  }
}
