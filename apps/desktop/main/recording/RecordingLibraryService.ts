import { readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  BackendScreenshotEvidence,
  BackendWorkflowSession,
  RecordedSessionSummary,
  RecordingSessionManifest
} from '../../shared/recording'
import { WorkTraceApiClient } from '../api/WorkTraceApiClient'
import { RecordingUploader } from './RecordingUploader'

export class RecordingLibraryService {
  private readonly uploader: RecordingUploader

  constructor(
    private readonly recordingsPath: string,
    private readonly apiClient: WorkTraceApiClient
  ) {
    this.uploader = new RecordingUploader(apiClient)
  }

  async listSessions(): Promise<RecordedSessionSummary[]> {
    const directories = await this.readSessionDirectories()
    const sessions = await Promise.all(directories.map((directory) => this.readSession(directory)))

    return sessions
      .filter((session): session is RecordedSessionSummary => Boolean(session))
      .sort((left, right) => new Date(right.startedAt).getTime() - new Date(left.startedAt).getTime())
  }

  async deleteSession(sessionId: string): Promise<void> {
    const sessionPath = join(this.recordingsPath, sessionId)
    const manifest = await this.readManifest(sessionPath)
    if (manifest?.remoteRecordingId) {
      try {
        await this.apiClient.deleteRecording(manifest.remoteRecordingId)
      } catch {
        // Keep deletion usable offline; local evidence is still removed.
      }
    }

    await rm(sessionPath, { force: true, recursive: true })
  }

  async getSession(backendSessionId: string): Promise<BackendWorkflowSession> {
    return this.apiClient.getSession(backendSessionId)
  }

  async getSessionScreenshots(backendSessionId: string): Promise<BackendScreenshotEvidence[]> {
    return this.apiClient.getSessionScreenshots(backendSessionId)
  }

  async getScreenshotImage(
    backendSessionId: string,
    screenshotId: string
  ): Promise<ArrayBuffer> {
    return this.apiClient.getScreenshotImage(backendSessionId, screenshotId)
  }

  async retryUpload(sessionId: string): Promise<void> {
    const sessionPath = join(this.recordingsPath, sessionId)
    const manifest = await this.readManifest(sessionPath)

    // Best-effort: remove a previously-failed remote recording so retries
    // don't leave orphaned recordings on the backend.
    if (manifest?.remoteRecordingId) {
      try {
        await this.apiClient.deleteRecording(manifest.remoteRecordingId)
      } catch {
        // Offline or already gone — proceed with a fresh upload.
      }
    }

    // Clear the prior error so the UI reflects the in-progress retry.
    await this.updateManifest(sessionPath, (current) => {
      current.uploadError = null
    })

    try {
      const uploaded = await this.uploader.uploadCompletedSession(sessionPath)
      await this.updateManifest(sessionPath, (current) => {
        current.remoteRecordingId = uploaded.recordingId
        current.remoteSessionId = uploaded.sessionId
        current.remoteStatus = uploaded.status
        current.uploadedAt = new Date().toISOString()
        current.uploadError = null
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Retry failed.'
      await this.updateManifest(sessionPath, (current) => {
        current.uploadError = message
      })
      throw error
    }
  }

  private async readSessionDirectories(): Promise<string[]> {
    try {
      const entries = await readdir(this.recordingsPath, { withFileTypes: true })
      return entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => join(this.recordingsPath, entry.name))
    } catch (error) {
      if (isMissingFileError(error)) {
        return []
      }
      throw error
    }
  }

  private async readSession(sessionPath: string): Promise<RecordedSessionSummary | null> {
    const manifestPath = join(sessionPath, 'manifest.json')
    try {
      const manifest = await this.readManifest(sessionPath)
      if (!manifest.id || !manifest.name || !manifest.startedAt || !manifest.platform) {
        return null
      }

      const remoteRecordingId = manifest.remoteRecordingId ?? null
      const remoteStatus = remoteRecordingId
        ? await this.readBackendStatus(remoteRecordingId)
        : { backend: null, error: null }
      const backend = remoteStatus.backend
      return {
        id: manifest.id,
        name: manifest.name,
        platform: manifest.platform,
        startedAt: manifest.startedAt,
        endedAt: manifest.endedAt ?? null,
        durationMs: calculateDurationMs(manifest.startedAt, manifest.endedAt ?? null),
        localStatus: manifest.status ?? 'error',
        eventCount: manifest.eventCount ?? 0,
        screenshotCount: manifest.screenshotCount ?? 0,
        audioChunkCount: manifest.audioChunkCount ?? 0,
        outputPath: sessionPath,
        remoteRecordingId,
        remoteSessionId: manifest.remoteSessionId ?? backend?.recording.session_id ?? null,
        remoteStatus: backend?.recording.status ?? manifest.remoteStatus ?? null,
        uploadedAt: manifest.uploadedAt ?? null,
        uploadError: manifest.uploadError ?? null,
        backend,
        backendError: remoteStatus.error
      }
    } catch (error) {
      if (isMissingFileError(error)) {
        return null
      }
      const fallback = await fallbackSessionSummary(sessionPath, error)
      return fallback
    }
  }

  private async readBackendStatus(recordingId: string) {
    try {
      return {
        backend: await this.apiClient.getRecordingStatus(recordingId),
        error: null
      }
    } catch (error) {
      return {
        backend: null,
        error: error instanceof Error ? error.message : 'Could not sync backend status.'
      }
    }
  }

  private async readManifest(sessionPath: string): Promise<Partial<RecordingSessionManifest>> {
    return JSON.parse(await readFile(join(sessionPath, 'manifest.json'), 'utf8')) as Partial<
      RecordingSessionManifest
    >
  }

  private async updateManifest(
    sessionPath: string,
    mutate: (manifest: RecordingSessionManifest) => void
  ): Promise<void> {
    const manifestPath = join(sessionPath, 'manifest.json')
    const temporaryPath = join(sessionPath, 'manifest.tmp.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as RecordingSessionManifest
    mutate(manifest)
    await writeFile(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`)
    await rename(temporaryPath, manifestPath)
  }
}

async function fallbackSessionSummary(
  sessionPath: string,
  error: unknown
): Promise<RecordedSessionSummary | null> {
  try {
    const info = await stat(sessionPath)
    return {
      id: sessionPath.split('/').pop() ?? sessionPath,
      name: 'Unreadable recording',
      platform: process.platform === 'win32' ? 'win32' : process.platform === 'darwin' ? 'darwin' : 'linux',
      startedAt: info.mtime.toISOString(),
      endedAt: null,
      durationMs: null,
      localStatus: 'error',
      eventCount: 0,
      screenshotCount: 0,
      audioChunkCount: 0,
      outputPath: sessionPath,
      remoteRecordingId: null,
      remoteSessionId: null,
      remoteStatus: null,
      uploadedAt: null,
      uploadError: null,
      backend: null,
      backendError: error instanceof Error ? error.message : 'Could not read recording.'
    }
  } catch {
    return null
  }
}

function calculateDurationMs(startedAt: string, endedAt: string | null): number | null {
  if (!endedAt) {
    return null
  }
  return Math.max(0, new Date(endedAt).getTime() - new Date(startedAt).getTime())
}

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}
