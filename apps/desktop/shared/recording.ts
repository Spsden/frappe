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
  | 'awaiting_manual_review'
  | 'generating_sop'
  | 'sop_failed'
  | 'ready_for_review'
  | 'completed'
  | 'failed'

export type RecordingRetryTarget = 'upload' | 'sop'

export type RedactionRunStatus =
  | 'not_run'
  | 'queued'
  | 'processing'
  | 'completed'
  | 'partial_failed'
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
  manualMode: boolean
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
  manualMode: false,
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
  workflow_id: string | null
  workflow_name: string
  reference: string | null
  recorded_by: string | null
  status: BackendRecordingStatus
  expected_chunk_count: number | null
  uploaded_chunk_count: number
  uploaded_bytes: number
  has_audio: boolean
  manual_mode: boolean
  custom_sop_instruction: string | null
  error_message: string | null
  created_at: string
  completed_at: string | null
}

export interface BackendWorkflow {
  id: string
  tenant_id: string
  name: string
  description: string | null
  created_by: string | null
  created_by_email: string | null
  recording_count: number
  user_count: number
  last_recording_at: string | null
  processing_count: number
  ready_count: number
  created_at: string
  updated_at: string
}

export interface BackendWorkflowRecording {
  id: string
  tenant_id: string
  workflow_id: string | null
  workflow_name: string
  reference: string | null
  recorded_by: string | null
  recorded_by_email: string | null
  session_id: string | null
  status: BackendRecordingStatus
  duration_ms: number | null
  created_at: string
  completed_at: string | null
}

export type AnalyticsRunStatus =
  | 'queued'
  | 'embedding'
  | 'aligning'
  | 'calculating'
  | 'summarizing'
  | 'completed'
  | 'summary_failed'
  | 'failed'

export type AnalyticsRetryTarget = 'summary' | 'full_run'

export interface BackendAnalyticsEligibleRecording {
  recording_id: string
  session_id: string
  reference: string | null
  recorded_by: string | null
  recorded_by_email: string | null
  duration_ms: number
  sop_id: string
  sop_version: number
  sop_title: string
  step_count: number
  approved_sop_created_at: string
}

export interface BackendAnalyticsRunInput {
  position: number
  recording_id: string
  session_id: string
  sop_id: string
  sop_version: number
  sop_content_hash: string
  recording_reference: string | null
  recorded_by: string | null
  recorded_by_email: string | null
  duration_ms: number
}

export interface BackendAnalyticsRecordingMetric {
  recording_id: string
  label: string
  rank: number
  total_duration_ms: number
  step_count: number
  path_signature: string
}

export interface BackendAnalyticsTimelineStep {
  group_id: string
  sop_step_id: string
  label: string
  start_ms: number
  duration_ms: number
  classification: 'shared' | 'optional' | 'path_specific'
  timing_source: 'observed' | 'estimated' | 'unavailable'
}

export interface BackendAnalyticsPathTimeline {
  recording_id: string
  label: string
  total_duration_ms: number
  unallocated_duration_ms: number
  steps: BackendAnalyticsTimelineStep[]
}

export interface BackendAnalyticsStepComparison {
  group_id: string
  label: string
  sample_count: number
  fastest_duration_ms: number | null
  average_duration_ms: number
  fastest_path_has_step: boolean
}

export interface BackendAnalyticsResult {
  overview: {
    recording_count: number
    distinct_path_count: number
    fastest_recording_id: string
    fastest_duration_ms: number
    average_duration_ms: number
    potential_time_saved_ms: number
    shared_step_count: number
    optional_step_count: number
    path_specific_step_count: number
    timing_coverage: number
  }
  completion_ranking: BackendAnalyticsRecordingMetric[]
  path_timelines: BackendAnalyticsPathTimeline[]
  fastest_vs_average: BackendAnalyticsStepComparison[]
  alignment_notes: string[]
}

export interface BackendAnalyticsRun {
  tenant_id: string
  id: string
  workflow_id: string
  workflow_name: string
  version: number
  mode: 'recording_comparison'
  status: AnalyticsRunStatus
  input_count: number
  embedding_model: string
  algorithm_version: string
  inputs: BackendAnalyticsRunInput[]
  result: BackendAnalyticsResult | null
  executive_summary: string[] | null
  failure_stage: string | null
  error_message: string | null
  created_by: string | null
  supersedes_run_id: string | null
  created_at: string
  started_at: string | null
  completed_at: string | null
  updated_at: string
}

/** Save destination chosen after capture. ``workflowName`` is also kept as the
 * local display label when ``workflowId`` points at an existing workflow. */
export interface SaveRecordingPayload {
  workflowId?: string
  workflowName: string
  reference?: string
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
  event_id: string | null
  event_type: string | null
  type: 'click_rectangle' | 'scroll_focus' | 'pointer_focus' | 'manual_box' | 'text_box' | 'redact'
  coordinate_space: 'screenshot_pixels' | 'global_screen'
  bounds: { x: number; y: number; width: number; height: number }
  confidence: number
  source: 'event_pointer' | 'fallback_coordinate' | 'accessibility' | 'manual'
  label: string | null
  role: string | null
}

/** Author-supplied annotation payload for the evidence editor save flow. */
export interface AnnotationInput {
  type: 'click_rectangle' | 'scroll_focus' | 'pointer_focus' | 'manual_box' | 'text_box' | 'redact'
  bounds: { x: number; y: number; width: number; height: number }
  label?: string | null
  role?: string | null
  source?: 'event_pointer' | 'fallback_coordinate' | 'accessibility' | 'manual'
}

export interface BackendScreenshotEvidence {
  id: string
  sequence: number
  captured_at: string
  width: number
  height: number
  media_type: string
  media_url: string | null
  annotated_media_url: string | null
  annotations: BackendAnnotation[]
  privacy_redaction_status: 'not_run' | 'queued' | 'processing' | 'clear' | 'redacted' | 'failed'
  privacy_redaction_count: number
  privacy_redaction_version: number
}

export interface BackendRedactionRun {
  id: string | null
  recording_id: string
  version: number
  status: RedactionRunStatus
  total_screenshots: number
  processed_screenshots: number
  redacted_screenshots: number
  redaction_count: number
  failed_screenshots: number
  detector_mode: 'model_and_rules' | 'rules_only' | null
  warning_message: string | null
  error_message: string | null
  started_at: string | null
  completed_at: string | null
  created_at: string | null
}

export interface SopDecisionBranch {
  condition: string
  action: string
}

export interface BackendSOPStep {
  id: string
  position: number
  title: string
  instruction: string
  warning: string | null
  screenshot_reference: string | null
  estimated_time_ms: number | null
  observed_duration_ms: number | null
  decision_branches: SopDecisionBranch[]
}

export interface BackendSOP {
  id: string
  source_session_id: string
  version: number
  status: 'draft' | 'approved' | 'archived'
  title: string
  /** Optional supporting narrative (purpose / overview) — never a separate version. */
  document: string | null
  steps: BackendSOPStep[]
  created_at: string
}

export interface BackendSOPLibraryItem extends BackendSOP {
  workflow_id: string | null
  workflow_name: string
  recording_id: string | null
  recording_reference: string | null
  recorded_by: string | null
  recorded_by_email: string | null
  recording_created_at: string | null
  session_duration_ms: number
}

export interface BackendDashboardSummary {
  tenant_id: string
  workflows_recorded: number
  workflows_recorded_this_month: number
  workflows_recorded_change_percent: number | null
  sops_generated: number
  approved_sops: number
  active_workflows: number
  average_completion_ms: number | null
  average_completion_delta_ms: number | null
}

export type BackendSearchResultKind = 'sop' | 'session'
export type BackendSearchMatchedField = 'title' | 'document' | 'step' | 'workflow_name'

export interface BackendSearchResult {
  kind: BackendSearchResultKind
  id: string
  title: string
  subtitle: string | null
  matched_field: BackendSearchMatchedField
  status: string | null
  /** For SOP hits, the session the SOP was generated from — lets the client
   * route to the SOP detail page (which is keyed by session). */
  source_session_id: string | null
  created_at: string
}

export interface BackendSearchResponse {
  query: string
  results: BackendSearchResult[]
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
  workflowId: string | null
  reference: string | null
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
  save: (payload: SaveRecordingPayload) => Promise<RecordingState>
  discard: () => Promise<RecordingState>
  getState: () => Promise<RecordingState>
  listSessions: () => Promise<RecordedSessionSummary[]>
  getRecordingSummary: (recordingId: string) => Promise<RecordedSessionSummary>
  listWorkflows: (query?: string) => Promise<BackendWorkflow[]>
  getWorkflow: (workflowId: string) => Promise<BackendWorkflow>
  listWorkflowRecordings: (workflowId: string) => Promise<BackendWorkflowRecording[]>
  listAnalyticsEligibleRecordings: (
    workflowId: string
  ) => Promise<BackendAnalyticsEligibleRecording[]>
  listAnalyticsRuns: (workflowId: string) => Promise<BackendAnalyticsRun[]>
  createAnalyticsRun: (
    workflowId: string,
    recordingIds: string[]
  ) => Promise<BackendAnalyticsRun>
  getAnalyticsRun: (runId: string) => Promise<BackendAnalyticsRun>
  retryAnalyticsRun: (
    runId: string,
    target: AnalyticsRetryTarget
  ) => Promise<BackendAnalyticsRun>
  deleteSession: (sessionId: string) => Promise<void>
  retry: (sessionId: string, target: RecordingRetryTarget) => Promise<void>
  getSession: (backendSessionId: string) => Promise<BackendWorkflowSession>
  getSessionScreenshots: (backendSessionId: string) => Promise<BackendScreenshotEvidence[]>
  getScreenshotImage: (
    backendSessionId: string,
    screenshotId: string,
    mediaUrl?: string | null
  ) => Promise<ArrayBuffer>
  getSessionSops: (backendSessionId: string) => Promise<BackendSOP[]>
  listSops: () => Promise<BackendSOPLibraryItem[]>
  approveSop: (sopId: string, approved: boolean) => Promise<BackendSOP>
  getDashboardSummary: () => Promise<BackendDashboardSummary>
  search: (query: string) => Promise<BackendSearchResponse>
  exportSopPdf: (html: string, title: string) => Promise<string | null>
  getSopScreenshotImage: (
    backendSessionId: string,
    screenshotId: string,
    mediaUrl?: string | null
  ) => Promise<ArrayBuffer>
  saveScreenshotAnnotations: (
    backendSessionId: string,
    screenshotId: string,
    annotations: AnnotationInput[],
    annotatedImage: ArrayBuffer
  ) => Promise<BackendScreenshotEvidence>
  deleteScreenshot: (backendSessionId: string, screenshotId: string) => Promise<void>
  saveManualReview: (
    recordingId: string,
    transcriptText: string | null,
    customInstruction: string | null
  ) => Promise<BackendRecording>
  generateSop: (
    recordingId: string,
    customInstruction?: string | null
  ) => Promise<BackendRecording>
  getRedaction: (recordingId: string) => Promise<BackendRedactionRun>
  startRedaction: (recordingId: string) => Promise<BackendRedactionRun>
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
  getRecordingSummary: 'recording:get-summary',
  listWorkflows: 'recording:list-workflows',
  getWorkflow: 'recording:get-workflow',
  listWorkflowRecordings: 'recording:list-workflow-recordings',
  listAnalyticsEligibleRecordings: 'recording:list-analytics-eligible-recordings',
  listAnalyticsRuns: 'recording:list-analytics-runs',
  createAnalyticsRun: 'recording:create-analytics-run',
  getAnalyticsRun: 'recording:get-analytics-run',
  retryAnalyticsRun: 'recording:retry-analytics-run',
  deleteSession: 'recording:delete-session',
  retry: 'recording:retry',
  getSession: 'recording:get-session',
  getSessionScreenshots: 'recording:get-session-screenshots',
  getSessionSops: 'recording:get-session-sops',
  listSops: 'recording:list-sops',
  approveSop: 'recording:approve-sop',
  getDashboardSummary: 'recording:get-dashboard-summary',
  search: 'recording:search',
  exportSopPdf: 'recording:export-sop-pdf',
  getScreenshotImage: 'recording:get-screenshot-image',
  getSopScreenshotImage: 'recording:get-sop-screenshot-image',
  saveScreenshotAnnotations: 'recording:save-screenshot-annotations',
  deleteScreenshot: 'recording:delete-screenshot',
  saveManualReview: 'recording:save-manual-review',
  generateSop: 'recording:generate-sop',
  getRedaction: 'recording:get-redaction',
  startRedaction: 'recording:start-redaction',
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
