import { BrowserWindow, ipcMain, shell } from 'electron'
import {
  recordingIpc,
  type AnnotationInput,
  type AnalyticsRetryTarget,
  type AnalyticsRunMode,
  type RecordingOptions,
  type RecordingRetryTarget,
  type SaveRecordingPayload,
  type RecordingState
} from '../../shared/recording'
import { RecordingManager } from './RecordingManager'
import { RecordingLibraryService } from './RecordingLibraryService'
import { exportSopPdf } from './SopPdfExporter'

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
  ipcMain.handle(recordingIpc.save, (_event, payload: SaveRecordingPayload) =>
    manager.save(payload)
  )
  ipcMain.handle(recordingIpc.discard, () => manager.discard())
  ipcMain.handle(recordingIpc.getState, () => manager.getState())
  ipcMain.handle(recordingIpc.listSessions, () => library.listSessions())
  ipcMain.handle(recordingIpc.getRecordingSummary, (_event, recordingId: string) =>
    library.getRecordingSummary(recordingId)
  )
  ipcMain.handle(recordingIpc.listWorkflows, (_event, query?: string) =>
    library.listWorkflows(query)
  )
  ipcMain.handle(recordingIpc.getWorkflow, (_event, workflowId: string) =>
    library.getWorkflow(workflowId)
  )
  ipcMain.handle(recordingIpc.listWorkflowRecordings, (_event, workflowId: string) =>
    library.listWorkflowRecordings(workflowId)
  )
  ipcMain.handle(
    recordingIpc.listAnalyticsEligibleRecordings,
    (_event, workflowId: string) => library.listAnalyticsEligibleRecordings(workflowId)
  )
  ipcMain.handle(recordingIpc.listAnalyticsRuns, (_event, workflowId: string) =>
    library.listAnalyticsRuns(workflowId)
  )
  ipcMain.handle(
    recordingIpc.createAnalyticsRun,
    (_event, workflowId: string, mode: AnalyticsRunMode, recordingIds: string[]) =>
      library.createAnalyticsRun(workflowId, mode, recordingIds)
  )
  ipcMain.handle(recordingIpc.getAnalyticsRun, (_event, runId: string) =>
    library.getAnalyticsRun(runId)
  )
  ipcMain.handle(
    recordingIpc.retryAnalyticsRun,
    (_event, runId: string, target: AnalyticsRetryTarget) =>
      library.retryAnalyticsRun(runId, target)
  )
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
  ipcMain.handle(recordingIpc.listSops, () => library.listSops())
  ipcMain.handle(recordingIpc.approveSop, (_event, sopId: string, approved: boolean) =>
    library.approveSop(sopId, approved)
  )
  ipcMain.handle(recordingIpc.getDashboardSummary, () => library.getDashboardSummary())
  ipcMain.handle(recordingIpc.search, (_event, query: string) => library.search(query))
  ipcMain.handle(recordingIpc.exportSopPdf, (_event, html: string, title: string) =>
    exportSopPdf(html, title)
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
  ipcMain.handle(recordingIpc.getRedaction, (_event, recordingId: string) =>
    library.getRedaction(recordingId)
  )
  ipcMain.handle(recordingIpc.startRedaction, (_event, recordingId: string) =>
    library.startRedaction(recordingId)
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
    ipcMain.removeHandler(recordingIpc.getRecordingSummary)
    ipcMain.removeHandler(recordingIpc.listWorkflows)
    ipcMain.removeHandler(recordingIpc.getWorkflow)
    ipcMain.removeHandler(recordingIpc.listWorkflowRecordings)
    ipcMain.removeHandler(recordingIpc.listAnalyticsEligibleRecordings)
    ipcMain.removeHandler(recordingIpc.listAnalyticsRuns)
    ipcMain.removeHandler(recordingIpc.createAnalyticsRun)
    ipcMain.removeHandler(recordingIpc.getAnalyticsRun)
    ipcMain.removeHandler(recordingIpc.retryAnalyticsRun)
    ipcMain.removeHandler(recordingIpc.deleteSession)
    ipcMain.removeHandler(recordingIpc.retry)
    ipcMain.removeHandler(recordingIpc.getSession)
    ipcMain.removeHandler(recordingIpc.getSessionScreenshots)
    ipcMain.removeHandler(recordingIpc.getScreenshotImage)
    ipcMain.removeHandler(recordingIpc.getSessionSops)
    ipcMain.removeHandler(recordingIpc.listSops)
    ipcMain.removeHandler(recordingIpc.approveSop)
    ipcMain.removeHandler(recordingIpc.getDashboardSummary)
    ipcMain.removeHandler(recordingIpc.search)
    ipcMain.removeHandler(recordingIpc.exportSopPdf)
    ipcMain.removeHandler(recordingIpc.getSopScreenshotImage)
    ipcMain.removeHandler(recordingIpc.saveScreenshotAnnotations)
    ipcMain.removeHandler(recordingIpc.deleteScreenshot)
    ipcMain.removeHandler(recordingIpc.saveManualReview)
    ipcMain.removeHandler(recordingIpc.generateSop)
    ipcMain.removeHandler(recordingIpc.getRedaction)
    ipcMain.removeHandler(recordingIpc.startRedaction)
    ipcMain.removeHandler(recordingIpc.openPermissionSettings)
  }
}
