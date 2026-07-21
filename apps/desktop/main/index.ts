import { app, BrowserWindow, shell, ipcMain } from 'electron'
import { join } from 'path'
import {
  ConnectionSettingsStore,
  connectionSettingsPath
} from './api/ConnectionSettingsStore'
import { WorkTraceApiClient } from './api/WorkTraceApiClient'
import { registerConnectionIpc } from './api/registerConnectionIpc'
import {
  ExperimentalSettingsStore,
  experimentalSettingsPath
} from './settings/ExperimentalSettingsStore'
import { registerSettingsIpc } from './settings/registerSettingsIpc'
import { createAccessibilityInspector } from './accessibility'
import { RecordingManager } from './recording/RecordingManager'
import { RecordingControlsWindow } from './recording/RecordingControlsWindow'
import { InputEventService } from './recording/InputEventService'
import { ScreenCaptureService } from './recording/ScreenCaptureService'
import { SessionWriter } from './recording/SessionWriter'
import { RecordingUploader } from './recording/RecordingUploader'
import { AudioCaptureService } from './recording/AudioCaptureService'
import { RecordingLibraryService } from './recording/RecordingLibraryService'
import { registerRecordingIpc } from './recording/registerRecordingIpc'

let recordingManager: RecordingManager | null = null
let recordingControlsWindow: RecordingControlsWindow | null = null
let audioCapture: AudioCaptureService | null = null

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1180,
    minHeight: 720,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  // Open external links in the default browser
  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // Dev: load the vite dev server. Prod: load the built HTML.
  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  // Example IPC handler — renderer calls window.api.getAppVersion()
  ipcMain.handle('get-app-version', () => app.getVersion())
  const connectionSettings = new ConnectionSettingsStore(
    connectionSettingsPath(app.getPath('userData'))
  )
  await connectionSettings.initialize()
  const apiClient = new WorkTraceApiClient(connectionSettings)
  registerConnectionIpc(connectionSettings, apiClient)
  await apiClient.testConnection()

  const experimentalSettings = new ExperimentalSettingsStore(
    experimentalSettingsPath(app.getPath('userData'))
  )
  await experimentalSettings.initialize()
  registerSettingsIpc(experimentalSettings)

  const accessibilityBundle = {
    enabled: () => experimentalSettings.getFlags().accessibilityCapture,
    inspector: createAccessibilityInspector()
  }

  const recordingsPath = join(app.getPath('userData'), 'recordings')
  const sessionWriter = new SessionWriter(recordingsPath)
  const screenCapture = new ScreenCaptureService(sessionWriter)
  recordingControlsWindow = new RecordingControlsWindow(process.env['ELECTRON_RENDERER_URL'])
  const inputEvents = new InputEventService(sessionWriter, accessibilityBundle)
  audioCapture = new AudioCaptureService(sessionWriter, process.env['ELECTRON_RENDERER_URL'])
  const recordingUploader = new RecordingUploader(apiClient)
  recordingManager = new RecordingManager(
    sessionWriter,
    screenCapture,
    inputEvents,
    audioCapture,
    recordingUploader,
    (x, y) => recordingControlsWindow?.containsPoint(x, y) ?? false
  )
  const recordingLibrary = new RecordingLibraryService(recordingsPath, apiClient)
  registerRecordingIpc(recordingManager, recordingLibrary)
  recordingManager.on('state-changed', (state) => recordingControlsWindow?.handleState(state))

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  recordingControlsWindow?.destroy()
  audioCapture?.destroy()
})
