import type {
  Account,
  BackendHealth,
  ConnectionStatus,
  LLMProviderSettings,
  LLMProviderSettingsUpdate,
  LoginCredentials,
  SignUpCredentials
} from '../../shared/connection'
import type {
  AnnotationInput,
  BackendRecording,
  BackendRecordingStatusResponse,
  BackendScreenshotEvidence,
  BackendSOP,
  BackendWorkflowSession,
  RecordingRetryTarget
} from '../../shared/recording'
import { ConnectionSettingsStore } from './ConnectionSettingsStore'

interface ApiAccount {
  user_id: string
  tenant_id: string
  company_name: string
  email: string
  role: Account['role']
}

interface ApiAuthSession {
  access_token: string
  account: ApiAccount
}

interface RecordingChunkUpload {
  contentType: 'events' | 'screenshots' | 'audio'
  mediaType: string
  timestampStartMs: number
  timestampEndMs: number
  checksumSha256: string
  idempotencyKey: string
  payload: Uint8Array
  filename: string
  metadata: Record<string, unknown>
}

export class WorkTraceApiClient {
  constructor(private readonly settings: ConnectionSettingsStore) {}

  async signup(credentials: SignUpCredentials): Promise<ConnectionStatus> {
    this.settings.assertSecureStorage()
    const apiUrl = this.settings.normalizeApiUrl(credentials.apiUrl)
    const session = await this.publicRequest<ApiAuthSession>(apiUrl, '/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        company_name: credentials.companyName,
        email: credentials.email,
        password: credentials.password
      })
    })
    return this.settings.saveSession(
      apiUrl,
      session.access_token,
      mapAccount(session.account)
    )
  }

  async login(credentials: LoginCredentials): Promise<ConnectionStatus> {
    this.settings.assertSecureStorage()
    const apiUrl = this.settings.normalizeApiUrl(credentials.apiUrl)
    const session = await this.publicRequest<ApiAuthSession>(apiUrl, '/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: credentials.email,
        password: credentials.password
      })
    })
    return this.settings.saveSession(
      apiUrl,
      session.access_token,
      mapAccount(session.account)
    )
  }

  async logout(): Promise<ConnectionStatus> {
    try {
      await this.request('/auth/logout', { method: 'POST' })
    } finally {
      return this.settings.clearSession()
    }
  }

  async testConnection(): Promise<ConnectionStatus> {
    if (!this.settings.getStatus().hasSession) {
      return this.settings.getStatus()
    }
    this.settings.setChecking()
    try {
      const response = await this.request('/auth/me')
      const account = mapAccount((await response.json()) as ApiAccount)
      return await this.settings.setConnected(account)
    } catch (error) {
      return this.settings.setError(error)
    }
  }

  async getHealth(): Promise<BackendHealth> {
    // No auth required (/health is public) and works pre-login, so resolve the
    // URL from the stored status rather than requiring a session token.
    const apiUrl = this.settings.normalizeApiUrl(this.settings.getStatus().apiUrl)
    const response = await fetch(`${apiUrl}/health`, { signal: AbortSignal.timeout(3_000) })
    await requireSuccess(response)
    return (await response.json()) as BackendHealth
  }

  async getLLMProviderSettings(): Promise<LLMProviderSettings> {
    const response = await this.request('/settings/llm-provider')
    return (await response.json()) as LLMProviderSettings
  }

  async saveLLMProviderSettings(
    payload: LLMProviderSettingsUpdate
  ): Promise<LLMProviderSettings> {
    const response = await this.request('/settings/llm-provider', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
    return (await response.json()) as LLMProviderSettings
  }

  async createRecording(payload: {
    id?: string
    workflowName: string
    hasAudio: boolean
    manualMode: boolean
  }): Promise<BackendRecording> {
    const response = await this.request('/recordings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: payload.id,
        workflow_name: payload.workflowName,
        source_type: 'desktop',
        has_audio: payload.hasAudio,
        manual_mode: payload.manualMode
      })
    })
    return (await response.json()) as BackendRecording
  }

  async uploadRecordingChunk(
    recordingId: string,
    chunkIndex: number,
    chunk: RecordingChunkUpload
  ): Promise<void> {
    const filePayload: Uint8Array<ArrayBuffer> = new Uint8Array(chunk.payload.byteLength)
    filePayload.set(chunk.payload)
    const form = new FormData()
    form.set('content_type', chunk.contentType)
    form.set('timestamp_start_ms', String(chunk.timestampStartMs))
    form.set('timestamp_end_ms', String(chunk.timestampEndMs))
    form.set('checksum_sha256', chunk.checksumSha256)
    form.set('idempotency_key', chunk.idempotencyKey)
    form.set('payload_size', String(chunk.payload.byteLength))
    form.set('metadata_json', JSON.stringify(chunk.metadata))
    form.set(
      'file',
      new Blob([filePayload], { type: chunk.mediaType }),
      chunk.filename
    )

    await this.request(`/recordings/${recordingId}/chunks/${chunkIndex}`, {
      method: 'PUT',
      body: form
    })
  }

  async completeRecording(
    recordingId: string,
    expectedChunkCount: number
  ): Promise<BackendRecording> {
    const response = await this.request(`/recordings/${recordingId}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expected_chunk_count: expectedChunkCount })
    })
    return (await response.json()) as BackendRecording
  }

  async getRecordingStatus(recordingId: string): Promise<BackendRecordingStatusResponse> {
    const response = await this.request(`/recordings/${recordingId}/status`)
    return (await response.json()) as BackendRecordingStatusResponse
  }

  async getRecordingStatuses(
    recordingIds: string[]
  ): Promise<BackendRecordingStatusResponse[]> {
    if (recordingIds.length === 0) return []
    const response = await this.request('/recordings/statuses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recording_ids: recordingIds })
    })
    return (await response.json()) as BackendRecordingStatusResponse[]
  }

  async deleteRecording(recordingId: string): Promise<void> {
    await this.request(`/recordings/${recordingId}`, { method: 'DELETE' })
  }

  async retryRecording(
    recordingId: string,
    target: Exclude<RecordingRetryTarget, 'upload'>
  ): Promise<BackendRecording> {
    const response = await this.request(`/recordings/${recordingId}/retry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target })
    })
    return (await response.json()) as BackendRecording
  }

  async getSession(sessionId: string): Promise<BackendWorkflowSession> {
    const response = await this.request(`/sessions/${sessionId}`)
    return (await response.json()) as BackendWorkflowSession
  }

  async getSessionScreenshots(sessionId: string): Promise<BackendScreenshotEvidence[]> {
    const response = await this.request(`/sessions/${sessionId}/screenshots`)
    return (await response.json()) as BackendScreenshotEvidence[]
  }

  async getScreenshotImage(
    sessionId: string,
    screenshotId: string,
    mediaUrl?: string | null
  ): Promise<ArrayBuffer> {
    if (mediaUrl) {
      const mediaResponse = await fetch(mediaUrl)
      await requireSuccess(mediaResponse)
      return mediaResponse.arrayBuffer()
    }
    const response = await this.request(`/sessions/${sessionId}/screenshots/${screenshotId}`)
    return response.arrayBuffer()
  }

  async getSessionSops(sessionId: string): Promise<BackendSOP[]> {
    // Uses the export bundle endpoint which returns all SOPs for a session.
    const response = await this.request(`/exports/${sessionId}`)
    const bundle = (await response.json()) as { sops: BackendSOP[] }
    return bundle.sops
  }

  async getSopScreenshotImage(
    sessionId: string,
    screenshotId: string,
    mediaUrl?: string | null
  ): Promise<ArrayBuffer> {
    if (mediaUrl) {
      const mediaResponse = await fetch(mediaUrl)
      await requireSuccess(mediaResponse)
      return mediaResponse.arrayBuffer()
    }
    const response = await this.request(`/sessions/${sessionId}/screenshots/${screenshotId}?type=annotated`)
    return response.arrayBuffer()
  }

  async saveScreenshotAnnotations(
    sessionId: string,
    screenshotId: string,
    annotations: AnnotationInput[],
    annotatedImage: ArrayBuffer
  ): Promise<BackendScreenshotEvidence> {
    const filePayload: Uint8Array<ArrayBuffer> = new Uint8Array(annotatedImage.byteLength)
    filePayload.set(new Uint8Array(annotatedImage))
    const form = new FormData()
    form.set('annotations', JSON.stringify(annotations))
    form.set(
      'annotated_image',
      new Blob([filePayload], { type: 'image/png' }),
      `${screenshotId}-annotated.png`
    )

    const response = await this.request(
      `/sessions/${sessionId}/screenshots/${screenshotId}/annotations`,
      {
        method: 'PUT',
        body: form
      }
    )
    return (await response.json()) as BackendScreenshotEvidence
  }

  async deleteScreenshot(sessionId: string, screenshotId: string): Promise<void> {
    await this.request(`/sessions/${sessionId}/screenshots/${screenshotId}`, {
      method: 'DELETE'
    })
  }

  async saveManualReview(
    recordingId: string,
    transcriptText: string | null,
    customInstruction: string | null
  ): Promise<BackendRecording> {
    const response = await this.request(`/recordings/${recordingId}/manual-review`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transcript_text: transcriptText,
        custom_instruction: customInstruction
      })
    })
    return (await response.json()) as BackendRecording
  }

  async generateSop(
    recordingId: string,
    customInstruction: string | null = null
  ): Promise<BackendRecording> {
    const response = await this.request(`/recordings/${recordingId}/generate-sop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ custom_instruction: customInstruction })
    })
    return (await response.json()) as BackendRecording
  }

  async request(path: string, init: RequestInit = {}): Promise<Response> {
    const connection = await this.settings.resolve()
    const headers = new Headers(init.headers)
    headers.set('Authorization', `Bearer ${connection.apiToken}`)
    if (connection.tenantId) {
      headers.set('X-Tenant-ID', connection.tenantId)
    }
    const response = await fetch(`${connection.apiUrl}${path}`, {
      ...init,
      headers,
      signal: AbortSignal.timeout(15_000)
    })
    await requireSuccess(response)
    return response
  }

  private async publicRequest<T>(
    apiUrl: string,
    path: string,
    init: RequestInit
  ): Promise<T> {
    const response = await fetch(`${apiUrl}${path}`, {
      ...init,
      signal: AbortSignal.timeout(15_000)
    })
    await requireSuccess(response)
    return (await response.json()) as T
  }
}

async function requireSuccess(response: Response): Promise<void> {
  if (response.ok) {
    return
  }
  let detail = `WorkTrace API returned ${response.status}.`
  try {
    const payload = (await response.json()) as { detail?: string | Array<{ msg?: string }> }
    if (typeof payload.detail === 'string') {
      detail = payload.detail
    } else if (Array.isArray(payload.detail)) {
      detail = payload.detail.map((item) => item.msg).filter(Boolean).join(', ') || detail
    }
  } catch {
    // Keep the status-based message for non-JSON responses.
  }
  throw new Error(detail)
}

function mapAccount(account: ApiAccount): Account {
  return {
    userId: account.user_id,
    tenantId: account.tenant_id,
    companyName: account.company_name,
    email: account.email,
    role: account.role
  }
}
