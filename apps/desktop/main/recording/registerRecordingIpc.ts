import { BrowserWindow, ipcMain, shell } from 'electron'
import {
  recordingIpc,
  type RecordingOptions,
  type RecordingState
} from '../../shared/recording'
import { RecordingManager } from './RecordingManager'
import { RecordingLibraryService } from './RecordingLibraryService'

export function registerRecordingIpc(
  manager: RecordingManager,
  library: RecordingLibraryService
): () => void {
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
  ipcMain.handle(recordingIpc.save, (_event, name: string) => manager.save(name))
  ipcMain.handle(recordingIpc.discard, () => manager.discard())
  ipcMain.handle(recordingIpc.getState, () => manager.getState())
  ipcMain.handle(recordingIpc.listSessions, () => library.listSessions())
  ipcMain.handle(recordingIpc.deleteSession, (_event, sessionId: string) =>
    library.deleteSession(sessionId)
  )
  ipcMain.handle(recordingIpc.retryUpload, (_event, sessionId: string) =>
    library.retryUpload(sessionId)
  )
  ipcMain.handle(recordingIpc.getSession, (_event, backendSessionId: string) =>
    library.getSession(backendSessionId)
  )
  ipcMain.handle(recordingIpc.getSessionScreenshots, (_event, backendSessionId: string) =>
    library.getSessionScreenshots(backendSessionId)
  )
  ipcMain.handle(
    recordingIpc.getScreenshotImage,
    (_event, backendSessionId: string, screenshotId: string) =>
      library.getScreenshotImage(backendSessionId, screenshotId)
  )
  ipcMain.handle(recordingIpc.getSessionSops, (_event, backendSessionId: string) =>
    library.getSessionSops(backendSessionId)
  )
  ipcMain.handle(
    recordingIpc.getSopScreenshotImage,
    (_event, backendSessionId: string, screenshotId: string) =>
      library.getSopScreenshotImage(backendSessionId, screenshotId)
  )
  ipcMain.handle(
    recordingIpc.openPermissionSettings,
    (_event, permission: 'accessibility' | 'screen' | 'microphone') => {
      if (process.platform !== 'darwin') {
        return
      }

      const pane =
        permission === 'accessibility'
          ? 'Privacy_Accessibility'
          : permission === 'microphone'
            ? 'Privacy_Microphone'
            : 'Privacy_ScreenCapture'
      return shell.openExternal(
        `x-apple.systempreferences:com.apple.preference.security?${pane}`
      )
    }
  )

  return () => {
    manager.off('state-changed', broadcastState)
    ipcMain.removeHandler(recordingIpc.start)
    ipcMain.removeHandler(recordingIpc.pause)
    ipcMain.removeHandler(recordingIpc.resume)
    ipcMain.removeHandler(recordingIpc.stop)
    ipcMain.removeHandler(recordingIpc.save)
    ipcMain.removeHandler(recordingIpc.discard)
    ipcMain.removeHandler(recordingIpc.getState)
    ipcMain.removeHandler(recordingIpc.listSessions)
    ipcMain.removeHandler(recordingIpc.deleteSession)
    ipcMain.removeHandler(recordingIpc.retryUpload)
    ipcMain.removeHandler(recordingIpc.getSession)
    ipcMain.removeHandler(recordingIpc.getSessionScreenshots)
    ipcMain.removeHandler(recordingIpc.getScreenshotImage)
    ipcMain.removeHandler(recordingIpc.getSessionSops)
    ipcMain.removeHandler(recordingIpc.getSopScreenshotImage)
    ipcMain.removeHandler(recordingIpc.openPermissionSettings)
  }
}
