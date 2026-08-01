import { BrowserWindow, screen } from 'electron'
import { join } from 'node:path'
import type {
  ImageViewerPayload,
  ImageViewerWindowState
} from '../../shared/walkthrough'
import { walkthroughIpc } from '../../shared/walkthrough'

const MIN_WIDTH = 760
const MIN_HEIGHT = 520
const MAX_WINDOW_MARGIN = 96

export class ImageViewerWindow {
  private window: BrowserWindow | null = null
  private payload: ImageViewerPayload | null = null

  constructor(private readonly rendererUrl?: string) {}

  open(payload: ImageViewerPayload): ImageViewerWindowState {
    this.payload = payload

    if (!this.window || this.window.isDestroyed()) {
      this.window = this.createWindow()
    }

    this.window.setTitle(`${payload.title} · Step ${payload.stepPosition}`)
    this.sizeAndCenter()
    this.window.show()
    this.window.focus()
    this.emitState()

    return this.getState()
  }

  update(payload: ImageViewerPayload): ImageViewerWindowState {
    if (
      !this.payload ||
      !this.window ||
      this.window.isDestroyed() ||
      !this.window.isVisible()
    ) {
      return this.getState()
    }

    this.payload = payload
    this.window.setTitle(`${payload.title} · Step ${payload.stepPosition}`)
    this.emitState()

    return this.getState()
  }

  getState(): ImageViewerWindowState {
    return {
      payload: this.payload
    }
  }

  close(): ImageViewerWindowState {
    this.window?.hide()
    this.payload = null
    this.emitState()
    return this.getState()
  }

  destroy(): void {
    this.window?.destroy()
    this.window = null
  }

  private createWindow(): BrowserWindow {
    const window = new BrowserWindow({
      width: 1180,
      height: 780,
      minWidth: MIN_WIDTH,
      minHeight: MIN_HEIGHT,
      show: false,
      title: 'Image Viewer',
      titleBarStyle: 'hiddenInset',
      backgroundColor: '#050505',
      autoHideMenuBar: true,
      resizable: true,
      maximizable: true,
      minimizable: true,
      fullscreenable: true,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        sandbox: false
      }
    })

    window.on('close', (event) => {
      event.preventDefault()
      this.close()
    })

    if (this.rendererUrl) {
      window.loadURL(`${this.rendererUrl}#/image-viewer`)
    } else {
      window.loadFile(join(__dirname, '../renderer/index.html'), {
        hash: '/image-viewer'
      })
    }

    return window
  }

  private sizeAndCenter(): void {
    if (!this.window || this.window.isDestroyed()) {
      return
    }

    const cursorPoint = screen.getCursorScreenPoint()
    const display = screen.getDisplayNearestPoint(cursorPoint)
    const { x, y, width, height } = display.workArea
    const nextWidth = Math.max(
      MIN_WIDTH,
      Math.min(1400, width - MAX_WINDOW_MARGIN)
    )
    const nextHeight = Math.max(
      MIN_HEIGHT,
      Math.min(940, height - MAX_WINDOW_MARGIN)
    )

    this.window.setSize(nextWidth, nextHeight, false)
    this.window.setPosition(
      Math.round(x + (width - nextWidth) / 2),
      Math.round(y + (height - nextHeight) / 2),
      false
    )
  }

  private emitState(): void {
    const state = this.getState()
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send(walkthroughIpc.imageViewerStateChanged, state)
      }
    }
  }
}
