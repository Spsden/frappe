export type RecordingStatus =
  | 'idle'
  | 'requesting-permissions'
  | 'starting'
  | 'recording'
  | 'paused'
  | 'stopping'
  | 'awaiting-save'
  | 'uploading'
  | 'processing'
  | 'completed'
  | 'error'

export type BackendRecordingStatus =
  | 'recording'
  | 'uploading'
  | 'validating'
  | 'transcribing_audio'
  | 'processing_screenshots'
  | 'aligning_evidence'
  | 'generating_sop'
  | 'ready_for_review'
  | 'completed'
  | 'failed'

export type CaptureMode = 'full-desktop' | 'display'
export type RecordingPlatform = 'darwin' | 'win32' | 'linux'
export type CaptureCoordinateSpace = 'global-screen' | 'display-dip' | 'display-pixels'

export type RecordingJsonValue =
  | string
  | number
  | boolean
  | null
  | RecordingJsonValue[]
  | { [key: string]: RecordingJsonValue }

export type RecordingEventData = Record<string, RecordingJsonValue>

export interface CaptureRectangle {
  x: number
  y: number
  width: number
  height: number
}

export interface CaptureDisplayMetadata {
  id: string
  scaleFactor: number
  bounds: CaptureRectangle
  workArea: CaptureRectangle
}

export interface PointerCaptureMetadata {
  coordinateSpace: CaptureCoordinateSpace
  x: number
  y: number
  displayId: string
  displayScaleFactor: number
  pointOnDisplay: {
    x: number
    y: number
  }
}

export interface ScreenshotCaptureMetadata {
  coordinateSpace: CaptureCoordinateSpace
  display: CaptureDisplayMetadata
  imageSize: {
    width: number
    height: number
  }
}

export interface RecordingOptions {
  name?: string
  captureMode: CaptureMode
  displayId?: string
  recordAudio: boolean
  audioTimesliceMs: number
  sampleIntervalMs: number
  settleDurationMs: number
  maxSettleDurationMs: number
  thumbnailWidth: number
  thumbnailHeight: number
  changeThreshold: number
  /** 4-C: EMA background-model learning rate (weight of the new frame, 0..1). */
  emaAlpha: number
  /** 4-D: multiplier applied to the change threshold during input-idle periods. */
  idleThresholdMultiplier: number
  /** 4-D: window after an input event during which the base (lower) threshold is used. */
  inputSensitivityWindowMs: number
  /** 4-A: idle baseline window used to auto-calibrate the threshold. */
  calibrationDurationMs: number
  /** 5-B: minimum interval between captures during sustained input-driven motion. */
  navigationSampleIntervalMs: number
}

export const defaultRecordingOptions: RecordingOptions = {
  captureMode: 'full-desktop',
  recordAudio: true,
  audioTimesliceMs: 2500,
  sampleIntervalMs: 250,
  settleDurationMs: 400,
  maxSettleDurationMs: 2500,
  thumbnailWidth: 160,
  thumbnailHeight: 90,
  changeThreshold: 0.018,
  emaAlpha: 0.2,
  idleThresholdMultiplier: 3,
  inputSensitivityWindowMs: 1500,
  calibrationDurationMs: 3000,
  navigationSampleIntervalMs: 1000
}

export interface RecordingState {
  status: RecordingStatus
  sessionId: string | null
  sessionName: string | null
  startedAt: string | null
  pausedAt: string | null
  accumulatedPausedMs: number
  eventCount: number
  screenshotCount: number
  audioChunkCount: number
  outputPath: string | null
  remoteRecordingId: string | null
  remoteSessionId: string | null
  error: string | null
}

export interface BackendRecording {
  id: string
  session_id: string | null
  workflow_name: string
  status: BackendRecordingStatus
  expected_chunk_count: number | null
  uploaded_chunk_count: number
  uploaded_bytes: number
  has_audio: boolean
  error_message: string | null
  created_at: string
  completed_at: string | null
}

export interface BackendRecordingStatusResponse {
  recording: BackendRecording
  stages: BackendRecordingStatus[]
}

export interface BackendTranscriptSegment {
  start_ms: number
  end_ms: number
  text: string
}

export interface BackendTranscript {
  status: string
  text: string | null
  segments: BackendTranscriptSegment[]
  audio_chunk_count: number
  audio_reference?: string | null
}

export interface BackendWorkflowSession {
  id: string
  workflow_name: string
  duration_ms: number
  status: string
  transcript: BackendTranscript | null
}

export interface BackendAnnotation {
  event_id: string
  event_type: string
  type: 'click_rectangle' | 'scroll_focus' | 'pointer_focus'
  coordinate_space: 'screenshot_pixels' | 'global_screen'
  bounds: { x: number; y: number; width: number; height: number }
  confidence: number
  source: 'event_pointer' | 'fallback_coordinate' | 'accessibility'
  label: string | null
  role: string | null
}

export interface BackendScreenshotEvidence {
  id: string
  sequence: number
  captured_at: string
  width: number
  height: number
  media_type: string
  annotations: BackendAnnotation[]
}

export interface BackendSOPStep {
  id: string
  position: number
  title: string
  instruction: string
  warning: string | null
  screenshot_reference: string | null
  estimated_time_ms: number | null
  decision_branch: string | null
}

export interface BackendSOP {
  id: string
  source_session_id: string
  version: number
  status: 'draft' | 'approved' | 'archived'
  title: string
  steps: BackendSOPStep[]
  created_at: string
}

export interface RecordedSessionSummary {
  id: string
  name: string
  platform: RecordingPlatform
  startedAt: string
  endedAt: string | null
  durationMs: number | null
  localStatus: RecordingStatus | RecordingSessionManifest['status']
  eventCount: number
  screenshotCount: number
  audioChunkCount: number
  outputPath: string
  remoteRecordingId: string | null
  remoteSessionId: string | null
  remoteStatus: string | null
  uploadedAt: string | null
  uploadError: string | null
  backend: BackendRecordingStatusResponse | null
  backendError: string | null
}

export interface RecordingSessionManifest {
  schemaVersion: 1
  id: string
  name: string
  platform: RecordingPlatform
  startedAt: string
  endedAt: string | null
  status: 'recording' | 'paused' | 'completed' | 'interrupted' | 'error'
  options: RecordingOptions
  eventCount: number
  screenshotCount: number
  audioChunkCount: number
  remoteRecordingId: string | null
  remoteSessionId: string | null
  remoteStatus: string | null
  uploadedAt: string | null
  uploadError: string | null
}

export interface RecordedEvent {
  id: string
  sequence: number
  timestamp: string
  type: 'click' | 'key' | 'scroll' | 'app-switch' | 'navigation'
  data: RecordingEventData
  beforeScreenshotId?: string
  afterScreenshotId?: string
}

export interface ScreenshotRecord {
  id: string
  sequence: number
  capturedAt: string
  eventIds: string[]
  filename: string
  width: number
  height: number
  changeScore: number
  contentHash: string
  capture: ScreenshotCaptureMetadata
}

export interface AudioChunkRecord {
  id: string
  sequence: number
  capturedAt: string
  filename: string
  mimeType: string
  source: 'microphone'
  durationMs: number | null
  payloadSize: number
  contentHash: string
}

export interface RecordingApi {
  start: (options?: Partial<RecordingOptions>) => Promise<RecordingState>
  pause: () => Promise<RecordingState>
  resume: () => Promise<RecordingState>
  stop: () => Promise<RecordingState>
  save: (name: string) => Promise<RecordingState>
  discard: () => Promise<RecordingState>
  getState: () => Promise<RecordingState>
  listSessions: () => Promise<RecordedSessionSummary[]>
  deleteSession: (sessionId: string) => Promise<void>
  retryUpload: (sessionId: string) => Promise<void>
  getSession: (backendSessionId: string) => Promise<BackendWorkflowSession>
  getSessionScreenshots: (backendSessionId: string) => Promise<BackendScreenshotEvidence[]>
  getScreenshotImage: (backendSessionId: string, screenshotId: string) => Promise<ArrayBuffer>
  getSessionSops: (backendSessionId: string) => Promise<BackendSOP[]>
  getSopScreenshotImage: (backendSessionId: string, screenshotId: string) => Promise<ArrayBuffer>
  openPermissionSettings: (permission: 'accessibility' | 'screen' | 'microphone') => Promise<void>
  onStateChanged: (listener: (state: RecordingState) => void) => () => void
}

export const recordingIpc = {
  start: 'recording:start',
  pause: 'recording:pause',
  resume: 'recording:resume',
  stop: 'recording:stop',
  save: 'recording:save',
  discard: 'recording:discard',
  getState: 'recording:get-state',
  listSessions: 'recording:list-sessions',
  deleteSession: 'recording:delete-session',
  retryUpload: 'recording:retry-upload',
  getSession: 'recording:get-session',
  getSessionScreenshots: 'recording:get-session-screenshots',
  getScreenshotImage: 'recording:get-screenshot-image',
  getSessionSops: 'recording:get-session-sops',
  getSopScreenshotImage: 'recording:get-sop-screenshot-image',
  openPermissionSettings: 'recording:open-permission-settings',
  stateChanged: 'recording:state-changed',
  frameSample: 'recording:frame-sample',
  captureReady: 'recording:capture-ready',
  captureError: 'recording:capture-error',
  audioReady: 'recording:audio-ready',
  audioStart: 'recording:audio-start',
  audioPause: 'recording:audio-pause',
  audioResume: 'recording:audio-resume',
  audioStop: 'recording:audio-stop',
  audioStopped: 'recording:audio-stopped',
  audioChunk: 'recording:audio-chunk',
  audioError: 'recording:audio-error'
} as const

export interface AudioRecorderApi {
  ready: () => void
  chunk: (chunk: {
    capturedAt: string
    mimeType: string
    data: ArrayBuffer
  }) => Promise<void>
  error: (message: string) => void
  stopped: () => void
  onStart: (listener: (options: { timesliceMs: number }) => void) => () => void
  onPause: (listener: () => void) => () => void
  onResume: (listener: () => void) => () => void
  onStop: (listener: () => void) => () => void
}
