import { contextBridge, ipcRenderer } from 'electron'
import {
  connectionIpc,
  type BackendHealth,
  type ConnectionStatus,
  type LLMProviderSettings,
  type LLMProviderSettingsUpdate,
  type LoginCredentials,
  type SignUpCredentials,
  type SopLimitsSettings,
  type SopLimitsSettingsUpdate
} from '../shared/connection'
import {
  recordingIpc,
  type AnnotationInput,
  type AudioRecorderApi,
  type BackendDashboardSummary,
  type BackendScreenshotEvidence,
  type BackendSearchResponse,
  type BackendSOP,
  type BackendWorkflow,
  type BackendWorkflowRecording,
  type RecordingOptions,
  type RecordingRetryTarget,
  type RecordedSessionSummary,
  type RecordingState,
  type SaveRecordingPayload,
  type BackendWorkflowSession
} from '../shared/recording'
import {
  settingsIpc,
  type ExperimentalFlag,
  type ExperimentalFlags
} from '../shared/settings'
import {
  walkthroughIpc,
  type ImageViewerPayload,
  type ImageViewerWindowState,
  type WalkthroughDockSide,
  type WalkthroughPayload,
  type WalkthroughWindowState
} from '../shared/walkthrough'

// Expose a safe, minimal API to the renderer via contextBridge.
// The renderer can call window.api.getAppVersion() but cannot access
// Node/Electron APIs directly.
contextBridge.exposeInMainWorld('api', {
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  getSurajLol: async() => "kuch na",
  getSomeOtherThing: () => "kuch AUR bhi na",
  connection: {
    getStatus: () => ipcRenderer.invoke(connectionIpc.getStatus),
    login: (credentials: LoginCredentials) =>
      ipcRenderer.invoke(connectionIpc.login, credentials),
    signup: (credentials: SignUpCredentials) =>
      ipcRenderer.invoke(connectionIpc.signup, credentials),
    logout: () => ipcRenderer.invoke(connectionIpc.logout),
    test: () => ipcRenderer.invoke(connectionIpc.test),
    getHealth: () => ipcRenderer.invoke(connectionIpc.getHealth) as Promise<BackendHealth>,
    getLLMProviderSettings: () =>
      ipcRenderer.invoke(connectionIpc.getLLMProviderSettings) as Promise<LLMProviderSettings>,
    saveLLMProviderSettings: (settings: LLMProviderSettingsUpdate) =>
      ipcRenderer.invoke(
        connectionIpc.saveLLMProviderSettings,
        settings
      ) as Promise<LLMProviderSettings>,
    getSopLimitsSettings: () =>
      ipcRenderer.invoke(connectionIpc.getSopLimitsSettings) as Promise<SopLimitsSettings>,
    saveSopLimitsSettings: (settings: SopLimitsSettingsUpdate) =>
      ipcRenderer.invoke(
        connectionIpc.saveSopLimitsSettings,
        settings
      ) as Promise<SopLimitsSettings>,
    onStatusChanged: (listener: (status: ConnectionStatus) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, status: ConnectionStatus) =>
        listener(status)
      ipcRenderer.on(connectionIpc.statusChanged, handler)
      return () => ipcRenderer.off(connectionIpc.statusChanged, handler)
    }
  },
  settings: {
    getFlags: () => ipcRenderer.invoke(settingsIpc.getFlags) as Promise<ExperimentalFlags>,
    setFlag: (flag: ExperimentalFlag, value: boolean) =>
      ipcRenderer.invoke(settingsIpc.setFlag, flag, value) as Promise<ExperimentalFlags>,
    onFlagsChanged: (listener: (flags: ExperimentalFlags) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, flags: ExperimentalFlags) =>
        listener(flags)
      ipcRenderer.on(settingsIpc.flagsChanged, handler)
      return () => ipcRenderer.off(settingsIpc.flagsChanged, handler)
    }
  },
  recording: {
    start: (options?: Partial<RecordingOptions>) => ipcRenderer.invoke(recordingIpc.start, options),
    pause: () => ipcRenderer.invoke(recordingIpc.pause),
    resume: () => ipcRenderer.invoke(recordingIpc.resume),
    stop: () => ipcRenderer.invoke(recordingIpc.stop),
    save: (payload: SaveRecordingPayload) => ipcRenderer.invoke(recordingIpc.save, payload),
    discard: () => ipcRenderer.invoke(recordingIpc.discard),
    getState: () => ipcRenderer.invoke(recordingIpc.getState),
    listSessions: () =>
      ipcRenderer.invoke(recordingIpc.listSessions) as Promise<RecordedSessionSummary[]>,
    getRecordingSummary: (recordingId: string) =>
      ipcRenderer.invoke(
        recordingIpc.getRecordingSummary,
        recordingId
      ) as Promise<RecordedSessionSummary>,
    listWorkflows: (query?: string) =>
      ipcRenderer.invoke(recordingIpc.listWorkflows, query) as Promise<BackendWorkflow[]>,
    getWorkflow: (workflowId: string) =>
      ipcRenderer.invoke(recordingIpc.getWorkflow, workflowId) as Promise<BackendWorkflow>,
    listWorkflowRecordings: (workflowId: string) =>
      ipcRenderer.invoke(
        recordingIpc.listWorkflowRecordings,
        workflowId
      ) as Promise<BackendWorkflowRecording[]>,
    deleteSession: (sessionId: string) => ipcRenderer.invoke(recordingIpc.deleteSession, sessionId),
    retry: (sessionId: string, target: RecordingRetryTarget) =>
      ipcRenderer.invoke(recordingIpc.retry, sessionId, target),
    getSession: (backendSessionId: string) =>
      ipcRenderer.invoke(recordingIpc.getSession, backendSessionId) as Promise<BackendWorkflowSession>,
    getSessionScreenshots: (backendSessionId: string) =>
      ipcRenderer.invoke(
        recordingIpc.getSessionScreenshots,
        backendSessionId
      ) as Promise<BackendScreenshotEvidence[]>,
    getScreenshotImage: (
      backendSessionId: string,
      screenshotId: string,
      mediaUrl?: string | null
    ) =>
      ipcRenderer.invoke(
        recordingIpc.getScreenshotImage,
        backendSessionId,
        screenshotId,
        mediaUrl
      ) as Promise<ArrayBuffer>,
    getSessionSops: (backendSessionId: string) =>
      ipcRenderer.invoke(
        recordingIpc.getSessionSops,
        backendSessionId
      ) as Promise<BackendSOP[]>,
    listSops: () => ipcRenderer.invoke(recordingIpc.listSops) as Promise<BackendSOP[]>,
    approveSop: (sopId: string, approved: boolean) =>
      ipcRenderer.invoke(recordingIpc.approveSop, sopId, approved) as Promise<BackendSOP>,
    getDashboardSummary: () =>
      ipcRenderer.invoke(recordingIpc.getDashboardSummary) as Promise<BackendDashboardSummary>,
    search: (query: string) =>
      ipcRenderer.invoke(recordingIpc.search, query) as Promise<BackendSearchResponse>,
    exportSopPdf: (html: string, title: string) =>
      ipcRenderer.invoke(recordingIpc.exportSopPdf, html, title) as Promise<string | null>,
    getSopScreenshotImage: (
      backendSessionId: string,
      screenshotId: string,
      mediaUrl?: string | null
    ) =>
      ipcRenderer.invoke(
        recordingIpc.getSopScreenshotImage,
        backendSessionId,
        screenshotId,
        mediaUrl
      ) as Promise<ArrayBuffer>,
    saveScreenshotAnnotations: (
      backendSessionId: string,
      screenshotId: string,
      annotations: AnnotationInput[],
      annotatedImage: ArrayBuffer
    ) =>
      ipcRenderer.invoke(
        recordingIpc.saveScreenshotAnnotations,
        backendSessionId,
        screenshotId,
        annotations,
        annotatedImage
      ) as Promise<BackendScreenshotEvidence>,
    deleteScreenshot: (backendSessionId: string, screenshotId: string) =>
      ipcRenderer.invoke(recordingIpc.deleteScreenshot, backendSessionId, screenshotId),
    saveManualReview: (
      recordingId: string,
      transcriptText: string | null,
      customInstruction: string | null
    ) =>
      ipcRenderer.invoke(
        recordingIpc.saveManualReview,
        recordingId,
        transcriptText,
        customInstruction
      ),
    generateSop: (recordingId: string, customInstruction?: string | null) =>
      ipcRenderer.invoke(recordingIpc.generateSop, recordingId, customInstruction ?? null),
    openPermissionSettings: (permission: 'accessibility' | 'screen' | 'microphone') =>
      ipcRenderer.invoke(recordingIpc.openPermissionSettings, permission),
    onStateChanged: (listener: (state: RecordingState) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, state: RecordingState) => listener(state)
      ipcRenderer.on(recordingIpc.stateChanged, handler)
      return () => ipcRenderer.off(recordingIpc.stateChanged, handler)
    }
  },
  walkthrough: {
    open: (payload: WalkthroughPayload) =>
      ipcRenderer.invoke(walkthroughIpc.open, payload) as Promise<WalkthroughWindowState>,
    getState: () =>
      ipcRenderer.invoke(walkthroughIpc.getState) as Promise<WalkthroughWindowState>,
    setDockSide: (dockSide: WalkthroughDockSide) =>
      ipcRenderer.invoke(
        walkthroughIpc.setDockSide,
        dockSide
      ) as Promise<WalkthroughWindowState>,
    setCollapsed: (collapsed: boolean) =>
      ipcRenderer.invoke(
        walkthroughIpc.setCollapsed,
        collapsed
      ) as Promise<WalkthroughWindowState>,
    close: () => ipcRenderer.invoke(walkthroughIpc.close) as Promise<WalkthroughWindowState>,
    onStateChanged: (listener: (state: WalkthroughWindowState) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, state: WalkthroughWindowState) =>
        listener(state)
      ipcRenderer.on(walkthroughIpc.stateChanged, handler)
      return () => ipcRenderer.off(walkthroughIpc.stateChanged, handler)
    },
    openImageViewer: (payload: ImageViewerPayload) =>
      ipcRenderer.invoke(
        walkthroughIpc.openImageViewer,
        payload
      ) as Promise<ImageViewerWindowState>,
    updateImageViewer: (payload: ImageViewerPayload) =>
      ipcRenderer.invoke(
        walkthroughIpc.updateImageViewer,
        payload
      ) as Promise<ImageViewerWindowState>,
    getImageViewerState: () =>
      ipcRenderer.invoke(
        walkthroughIpc.getImageViewerState
      ) as Promise<ImageViewerWindowState>,
    closeImageViewer: () =>
      ipcRenderer.invoke(
        walkthroughIpc.closeImageViewer
      ) as Promise<ImageViewerWindowState>,
    onImageViewerStateChanged: (listener: (state: ImageViewerWindowState) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, state: ImageViewerWindowState) =>
        listener(state)
      ipcRenderer.on(walkthroughIpc.imageViewerStateChanged, handler)
      return () => ipcRenderer.off(walkthroughIpc.imageViewerStateChanged, handler)
    }
  }
})

const audioRecorderApi = {
  ready: () => ipcRenderer.send(recordingIpc.audioReady),
  chunk: (chunk: {
    capturedAt: string
    mimeType: string
    data: ArrayBuffer
  }) => ipcRenderer.invoke(recordingIpc.audioChunk, chunk),
  error: (message: string) => ipcRenderer.send(recordingIpc.audioError, message),
  stopped: () => ipcRenderer.send(recordingIpc.audioStopped),
  onStart: (listener: (options: { timesliceMs: number }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, options: { timesliceMs: number }) =>
      listener(options)
    ipcRenderer.on(recordingIpc.audioStart, handler)
    return () => ipcRenderer.off(recordingIpc.audioStart, handler)
  },
  onPause: (listener: () => void) => {
    const handler = () => listener()
    ipcRenderer.on(recordingIpc.audioPause, handler)
    return () => ipcRenderer.off(recordingIpc.audioPause, handler)
  },
  onResume: (listener: () => void) => {
    const handler = () => listener()
    ipcRenderer.on(recordingIpc.audioResume, handler)
    return () => ipcRenderer.off(recordingIpc.audioResume, handler)
  },
  onStop: (listener: () => void) => {
    const handler = () => listener()
    ipcRenderer.on(recordingIpc.audioStop, handler)
    return () => ipcRenderer.off(recordingIpc.audioStop, handler)
  }
} satisfies AudioRecorderApi

contextBridge.exposeInMainWorld('audioRecorder', audioRecorderApi)
