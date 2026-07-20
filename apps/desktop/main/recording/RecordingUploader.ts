import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  AudioChunkRecord,
  RecordedEvent,
  RecordingSessionManifest,
  ScreenshotRecord
} from '../../shared/recording'
import { WorkTraceApiClient } from '../api/WorkTraceApiClient'

export interface UploadedRecording {
  recordingId: string
  sessionId: string | null
  status: string
}

export class RecordingUploader {
  constructor(private readonly apiClient: WorkTraceApiClient) {}

  async uploadCompletedSession(sessionPath: string): Promise<UploadedRecording> {
    const manifest = await readJson<RecordingSessionManifest>(
      join(sessionPath, 'manifest.json')
    )
    const screenshots = await readJsonLines<ScreenshotRecord>(
      join(sessionPath, 'screenshots.jsonl')
    )
    const audioChunks = await readOptionalJsonLines<AudioChunkRecord>(
      join(sessionPath, 'audio.jsonl')
    )
    const eventsPath = join(sessionPath, 'events.jsonl')
    const eventsPayload = await readFile(eventsPath)
    const events = decodeEventLines(eventsPayload)
    const durationMs = calculateDurationMs(manifest, events, screenshots)
    const remoteRecording = await this.apiClient.createRecording({
      id: manifest.id,
      workflowName: manifest.name,
      hasAudio: audioChunks.length > 0
    })

    let chunkIndex = 0
    await this.apiClient.uploadRecordingChunk(remoteRecording.id, chunkIndex, {
      contentType: 'events',
      mediaType: 'application/x-ndjson',
      timestampStartMs: 0,
      timestampEndMs: durationMs,
      checksumSha256: sha256(eventsPayload),
      idempotencyKey: `${manifest.id}:events`,
      payload: eventsPayload,
      filename: 'events.jsonl',
      metadata: {
        localSessionId: manifest.id,
        schemaVersion: manifest.schemaVersion,
        eventCount: manifest.eventCount
      }
    })

    const startedAt = new Date(manifest.startedAt).getTime()
    const sortedScreenshots = screenshots.sort((left, right) => left.sequence - right.sequence)
    for (const screenshot of sortedScreenshots) {
      chunkIndex += 1
      const payload = await readFile(join(sessionPath, 'screenshots', screenshot.filename))
      const checksum = sha256(payload)
      const capturedAtMs = Math.max(0, new Date(screenshot.capturedAt).getTime() - startedAt)

      await this.apiClient.uploadRecordingChunk(remoteRecording.id, chunkIndex, {
        contentType: 'screenshots',
        mediaType: 'image/png',
        timestampStartMs: capturedAtMs,
        timestampEndMs: capturedAtMs,
        checksumSha256: checksum,
        idempotencyKey: `${manifest.id}:screenshot:${screenshot.id}`,
        payload,
        filename: screenshot.filename,
        metadata: {
          ...screenshot,
          localSessionId: manifest.id,
          contentHash: checksum
        }
      })
    }

    const sortedAudioChunks = audioChunks.sort((left, right) => left.sequence - right.sequence)
    for (const audioChunk of sortedAudioChunks) {
      chunkIndex += 1
      const payload = await readFile(join(sessionPath, 'audio', audioChunk.filename))
      const checksum = sha256(payload)
      const capturedAtMs = Math.max(0, new Date(audioChunk.capturedAt).getTime() - startedAt)
      const durationMs = audioChunk.durationMs ?? 0

      await this.apiClient.uploadRecordingChunk(remoteRecording.id, chunkIndex, {
        contentType: 'audio',
        mediaType: audioChunk.mimeType,
        timestampStartMs: capturedAtMs,
        timestampEndMs: capturedAtMs + durationMs,
        checksumSha256: checksum,
        idempotencyKey: `${manifest.id}:audio:${audioChunk.id}`,
        payload,
        filename: audioChunk.filename,
        metadata: {
          ...audioChunk,
          localSessionId: manifest.id,
          contentHash: checksum
        }
      })
    }

    const completed = await this.apiClient.completeRecording(
      remoteRecording.id,
      chunkIndex + 1
    )

    return {
      recordingId: completed.id,
      sessionId: completed.session_id,
      status: completed.status
    }
  }
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T
}

async function readJsonLines<T>(path: string): Promise<T[]> {
  const payload = await readFile(path, 'utf8')
  return payload
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as T)
}

async function readOptionalJsonLines<T>(path: string): Promise<T[]> {
  try {
    return await readJsonLines(path)
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return []
    }
    throw error
  }
}

function decodeEventLines(payload: Buffer): RecordedEvent[] {
  return payload
    .toString('utf8')
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as RecordedEvent)
}

function calculateDurationMs(
  manifest: RecordingSessionManifest,
  events: RecordedEvent[],
  screenshots: ScreenshotRecord[]
): number {
  const startedAt = new Date(manifest.startedAt).getTime()
  const explicitEnd = manifest.endedAt ? new Date(manifest.endedAt).getTime() : 0
  const eventEnd = Math.max(
    0,
    ...events.map((event) => new Date(event.timestamp).getTime())
  )
  const screenshotEnd = Math.max(
    0,
    ...screenshots.map((screenshot) => new Date(screenshot.capturedAt).getTime())
  )

  return Math.max(0, Math.max(0, explicitEnd, eventEnd, screenshotEnd) - startedAt)
}

function sha256(payload: Uint8Array): string {
  return createHash('sha256').update(payload).digest('hex')
}
