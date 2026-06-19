import { app, BrowserWindow, shell, ipcMain } from 'electron'
import { join } from 'path'
import { RecordingManager } from './recording/RecordingManager'
import { RecordingControlsWindow } from './recording/RecordingControlsWindow'
import { registerRecordingIpc } from './recording/registerRecordingIpc'

const recordingManager = new RecordingManager()
let recordingControlsWindow: RecordingControlsWindow | null = null

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
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

app.whenReady().then(() => {
  // Example IPC handler — renderer calls window.api.getAppVersion()
  ipcMain.handle('get-app-version', () => app.getVersion())
  registerRecordingIpc(recordingManager)
  recordingControlsWindow = new RecordingControlsWindow(process.env['ELECTRON_RENDERER_URL'])
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
})
