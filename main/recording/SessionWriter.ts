import { appendFile, mkdir, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  RecordedEvent,
  RecordingOptions,
  RecordingPlatform,
  RecordingSessionManifest,
  ScreenshotRecord
} from '../../shared/recording'

export class SessionWriter {
  private manifest: RecordingSessionManifest | null = null
  private sessionPath: string | null = null

  constructor(private readonly recordingsPath: string) {}

  async createSession(
    id: string,
    name: string,
    platform: RecordingPlatform,
    options: RecordingOptions
  ): Promise<string> {
    this.sessionPath = join(this.recordingsPath, id)
    await mkdir(join(this.sessionPath, 'screenshots'), { recursive: true })

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
      screenshotCount: 0
    }

    await this.writeManifest()
    await writeFile(join(this.sessionPath, 'events.jsonl'), '')
    await writeFile(join(this.sessionPath, 'screenshots.jsonl'), '')
    return this.sessionPath
  }

  async setStatus(status: RecordingSessionManifest['status']): Promise<void> {
    const { manifest } = this.requireSession()
    manifest.status = status

    if (status === 'completed' || status === 'interrupted' || status === 'error') {
      manifest.endedAt = new Date().toISOString()
    }

    await this.writeManifest()
  }

  async appendEvent(event: RecordedEvent): Promise<void> {
    const { manifest, sessionPath } = this.requireSession()
    await appendFile(join(sessionPath, 'events.jsonl'), `${JSON.stringify(event)}\n`)
    manifest.eventCount += 1
    await this.writeManifest()
  }

  async appendScreenshot(record: ScreenshotRecord, png: Uint8Array): Promise<void> {
    const { manifest, sessionPath } = this.requireSession()
    await writeFile(join(sessionPath, 'screenshots', record.filename), png)
    await appendFile(join(sessionPath, 'screenshots.jsonl'), `${JSON.stringify(record)}\n`)
    manifest.screenshotCount += 1
    await this.writeManifest()
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
