import { contextBridge, ipcRenderer } from 'electron'
import {
  recordingIpc,
  type RecordingOptions,
  type RecordingState
} from '../shared/recording'

// Expose a safe, minimal API to the renderer via contextBridge.
// The renderer can call window.api.getAppVersion() but cannot access
// Node/Electron APIs directly.
contextBridge.exposeInMainWorld('api', {
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  getSurajLol: async() => "kuch na",
  getSomeOtherThing: () => "kuch AUR bhi na",
  recording: {
    start: (options?: Partial<RecordingOptions>) => ipcRenderer.invoke(recordingIpc.start, options),
    pause: () => ipcRenderer.invoke(recordingIpc.pause),
    resume: () => ipcRenderer.invoke(recordingIpc.resume),
    stop: () => ipcRenderer.invoke(recordingIpc.stop),
    getState: () => ipcRenderer.invoke(recordingIpc.getState),
    onStateChanged: (listener: (state: RecordingState) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, state: RecordingState) => listener(state)
      ipcRenderer.on(recordingIpc.stateChanged, handler)
      return () => ipcRenderer.off(recordingIpc.stateChanged, handler)
    }
  }
})
