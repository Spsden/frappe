import { BrowserWindow, screen } from 'electron'
import { join } from 'node:path'
import type { RecordingState } from '../../shared/recording'

const WINDOW_WIDTH = 430
const WINDOW_HEIGHT = 76
const SCREEN_MARGIN = 24

export class RecordingControlsWindow {
  private window: BrowserWindow | null = null

  constructor(private readonly rendererUrl?: string) {}

  show(): void {
    if (!this.window || this.window.isDestroyed()) {
      this.window = this.createWindow()
    }

    this.positionAtBottomCenter()
    this.window.showInactive()
  }

  hide(): void {
    this.window?.hide()
  }

  handleState(state: RecordingState): void {
    if (
      state.status === 'recording' ||
      state.status === 'paused' ||
      state.status === 'stopping' ||
      state.status === 'processing'
    ) {
      this.show()
      return
    }

    this.hide()
  }

  destroy(): void {
    this.window?.destroy()
    this.window = null
  }

  private createWindow(): BrowserWindow {
    const window = new BrowserWindow({
      width: WINDOW_WIDTH,
      height: WINDOW_HEIGHT,
      show: false,
      frame: false,
      transparent: true,
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      hasShadow: true,
      alwaysOnTop: true,
      focusable: true,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        sandbox: false
      }
    })

    window.setAlwaysOnTop(true, 'floating')
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    window.setContentProtection(true)

    window.on('close', (event) => {
      event.preventDefault()
      window.hide()
    })

    if (this.rendererUrl) {
      window.loadURL(`${this.rendererUrl}#/recording-controls`)
    } else {
      window.loadFile(join(__dirname, '../renderer/index.html'), {
        hash: '/recording-controls'
      })
    }

    return window
  }

  private positionAtBottomCenter(): void {
    if (!this.window || this.window.isDestroyed()) {
      return
    }

    const cursorPoint = screen.getCursorScreenPoint()
    const display = screen.getDisplayNearestPoint(cursorPoint)
    const { x, y, width, height } = display.workArea

    this.window.setPosition(
      Math.round(x + (width - WINDOW_WIDTH) / 2),
      Math.round(y + height - WINDOW_HEIGHT - SCREEN_MARGIN),
      false
    )
  }
}
