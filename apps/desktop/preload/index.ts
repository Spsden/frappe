import { contextBridge, ipcRenderer } from 'electron'
import {
  connectionIpc,
  type BackendHealth,
  type ConnectionStatus,
  type LoginCredentials,
  type SignUpCredentials
} from '../shared/connection'
import {
  recordingIpc,
  type AnnotationInput,
  type AudioRecorderApi,
  type BackendScreenshotEvidence,
  type BackendSOP,
  type RecordingOptions,
  type RecordedSessionSummary,
  type RecordingState,
  type BackendWorkflowSession
} from '../shared/recording'
import {
  settingsIpc,
  type ExperimentalFlag,
  type ExperimentalFlags
} from '../shared/settings'

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
    save: (name: string) => ipcRenderer.invoke(recordingIpc.save, name),
    discard: () => ipcRenderer.invoke(recordingIpc.discard),
    getState: () => ipcRenderer.invoke(recordingIpc.getState),
    listSessions: () =>
      ipcRenderer.invoke(recordingIpc.listSessions) as Promise<RecordedSessionSummary[]>,
    deleteSession: (sessionId: string) => ipcRenderer.invoke(recordingIpc.deleteSession, sessionId),
    retryUpload: (sessionId: string) => ipcRenderer.invoke(recordingIpc.retryUpload, sessionId),
    getSession: (backendSessionId: string) =>
      ipcRenderer.invoke(recordingIpc.getSession, backendSessionId) as Promise<BackendWorkflowSession>,
    getSessionScreenshots: (backendSessionId: string) =>
      ipcRenderer.invoke(
        recordingIpc.getSessionScreenshots,
        backendSessionId
      ) as Promise<BackendScreenshotEvidence[]>,
    getScreenshotImage: (backendSessionId: string, screenshotId: string) =>
      ipcRenderer.invoke(
        recordingIpc.getScreenshotImage,
        backendSessionId,
        screenshotId
      ) as Promise<ArrayBuffer>,
    saveScreenshotAnnotations: (
      backendSessionId: string,
      screenshotId: string,
      annotations: AnnotationInput[]
    ) =>
      ipcRenderer.invoke(
        recordingIpc.saveScreenshotAnnotations,
        backendSessionId,
        screenshotId,
        annotations
      ) as Promise<BackendScreenshotEvidence>,
    openPermissionSettings: (permission: 'accessibility' | 'screen' | 'microphone') =>
      ipcRenderer.invoke(recordingIpc.openPermissionSettings, permission),
    onStateChanged: (listener: (state: RecordingState) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, state: RecordingState) => listener(state)
      ipcRenderer.on(recordingIpc.stateChanged, handler)
      return () => ipcRenderer.off(recordingIpc.stateChanged, handler)
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
