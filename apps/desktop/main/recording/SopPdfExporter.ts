import { app, BrowserWindow, dialog } from 'electron'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function safeFileName(title: string): string {
  const cleaned = title
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '-')
    .replace(/\s+/g, ' ')
    .slice(0, 80)
  return `${cleaned || 'WorkTrace SOP'}.pdf`
}

function waitForLoad(window: BrowserWindow): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      window.webContents.off('did-finish-load', onLoad)
      window.webContents.off('did-fail-load', onFail)
    }
    const onLoad = () => {
      cleanup()
      resolve()
    }
    const onFail = (_event: Electron.Event, _code: number, description: string) => {
      cleanup()
      reject(new Error(description || 'Could not render PDF preview.'))
    }
    window.webContents.once('did-finish-load', onLoad)
    window.webContents.once('did-fail-load', onFail)
  })
}

export async function exportSopPdf(html: string, title: string): Promise<string | null> {
  const owner = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  const { canceled, filePath } = await dialog.showSaveDialog(owner, {
    title: 'Export SOP PDF',
    defaultPath: join(app.getPath('documents'), safeFileName(title)),
    filters: [{ name: 'PDF', extensions: ['pdf'] }]
  })
  if (canceled || !filePath) return null

  const tempDirectory = await mkdtemp(join(tmpdir(), 'worktrace-sop-pdf-'))
  const tempHtmlPath = join(tempDirectory, 'sop.html')

  const pdfWindow = new BrowserWindow({
    show: false,
    width: 900,
    height: 1200,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  try {
    await writeFile(tempHtmlPath, html, 'utf8')
    const loaded = waitForLoad(pdfWindow)
    await pdfWindow.loadFile(tempHtmlPath)
    await loaded
    await new Promise((resolve) => setTimeout(resolve, 250))
    const pdf = await pdfWindow.webContents.printToPDF({
      pageSize: 'A4',
      printBackground: true,
      margins: {
        marginType: 'default'
      }
    })
    await writeFile(filePath, pdf)
    return filePath
  } finally {
    if (!pdfWindow.isDestroyed()) pdfWindow.close()
    await rm(tempDirectory, { recursive: true, force: true })
  }
}
