import { BrowserWindow, ipcMain } from 'electron'
import {
  recordingIpc,
  type RecordingOptions,
  type RecordingState
} from '../../shared/recording'
import { RecordingManager } from './RecordingManager'

export function registerRecordingIpc(manager: RecordingManager): () => void {
  const broadcastState = (state: RecordingState) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(recordingIpc.stateChanged, state)
    }
  }

  manager.on('state-changed', broadcastState)

  ipcMain.handle(recordingIpc.start, (_event, options?: Partial<RecordingOptions>) =>
    manager.start(options)
  )
  ipcMain.handle(recordingIpc.pause, () => manager.pause())
  ipcMain.handle(recordingIpc.resume, () => manager.resume())
  ipcMain.handle(recordingIpc.stop, () => manager.stop())
  ipcMain.handle(recordingIpc.getState, () => manager.getState())

  return () => {
    manager.off('state-changed', broadcastState)
    ipcMain.removeHandler(recordingIpc.start)
    ipcMain.removeHandler(recordingIpc.pause)
    ipcMain.removeHandler(recordingIpc.resume)
    ipcMain.removeHandler(recordingIpc.stop)
    ipcMain.removeHandler(recordingIpc.getState)
  }
}
