import { BrowserWindow, ipcMain, shell } from 'electron'
import {
  recordingIpc,
  type AnnotationInput,
  type RecordingOptions,
  type RecordingRetryTarget,
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
  ipcMain.handle(
    recordingIpc.retry,
    (_event, sessionId: string, target: RecordingRetryTarget) => library.retry(sessionId, target)
  )
  ipcMain.handle(recordingIpc.getSession, (_event, backendSessionId: string) =>
    library.getSession(backendSessionId)
  )
  ipcMain.handle(recordingIpc.getSessionScreenshots, (_event, backendSessionId: string) =>
    library.getSessionScreenshots(backendSessionId)
  )
  ipcMain.handle(
    recordingIpc.getScreenshotImage,
    (_event, backendSessionId: string, screenshotId: string, mediaUrl?: string | null) =>
      library.getScreenshotImage(backendSessionId, screenshotId, mediaUrl)
  )
  ipcMain.handle(recordingIpc.getSessionSops, (_event, backendSessionId: string) =>
    library.getSessionSops(backendSessionId)
  )
  ipcMain.handle(
    recordingIpc.getSopScreenshotImage,
    (_event, backendSessionId: string, screenshotId: string, mediaUrl?: string | null) =>
      library.getSopScreenshotImage(backendSessionId, screenshotId, mediaUrl)
  )
  ipcMain.handle(
    recordingIpc.saveScreenshotAnnotations,
    (
      _event,
      backendSessionId: string,
      screenshotId: string,
      annotations: AnnotationInput[],
      annotatedImage: ArrayBuffer
    ) => library.saveScreenshotAnnotations(
      backendSessionId,
      screenshotId,
      annotations,
      annotatedImage
    )
  )
  ipcMain.handle(
    recordingIpc.deleteScreenshot,
    (_event, backendSessionId: string, screenshotId: string) =>
      library.deleteScreenshot(backendSessionId, screenshotId)
  )
  ipcMain.handle(
    recordingIpc.saveManualReview,
    (
      _event,
      recordingId: string,
      transcriptText: string | null,
      customInstruction: string | null
    ) => library.saveManualReview(recordingId, transcriptText, customInstruction)
  )
  ipcMain.handle(
    recordingIpc.generateSop,
    (_event, recordingId: string, customInstruction: string | null) =>
      library.generateSop(recordingId, customInstruction)
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
    ipcMain.removeHandler(recordingIpc.retry)
    ipcMain.removeHandler(recordingIpc.getSession)
    ipcMain.removeHandler(recordingIpc.getSessionScreenshots)
    ipcMain.removeHandler(recordingIpc.getScreenshotImage)
    ipcMain.removeHandler(recordingIpc.getSessionSops)
    ipcMain.removeHandler(recordingIpc.getSopScreenshotImage)
    ipcMain.removeHandler(recordingIpc.saveScreenshotAnnotations)
    ipcMain.removeHandler(recordingIpc.deleteScreenshot)
    ipcMain.removeHandler(recordingIpc.saveManualReview)
    ipcMain.removeHandler(recordingIpc.generateSop)
    ipcMain.removeHandler(recordingIpc.openPermissionSettings)
  }
}
