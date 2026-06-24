import { contextBridge, ipcRenderer } from 'electron'
import {
  connectionIpc,
  type ConnectionStatus,
  type LoginCredentials,
  type SignUpCredentials
} from '../shared/connection'
import {
  recordingIpc,
  type AudioRecorderApi,
  type RecordingOptions,
  type RecordedSessionSummary,
  type RecordingState
} from '../shared/recording'

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
    onStatusChanged: (listener: (status: ConnectionStatus) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, status: ConnectionStatus) =>
        listener(status)
      ipcRenderer.on(connectionIpc.statusChanged, handler)
      return () => ipcRenderer.off(connectionIpc.statusChanged, handler)
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
