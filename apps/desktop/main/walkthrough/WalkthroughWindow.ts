import { BrowserWindow, screen } from 'electron'
import { join } from 'node:path'
import type {
  WalkthroughDockSide,
  WalkthroughPayload,
  WalkthroughWindowState
} from '../../shared/walkthrough'
import { walkthroughIpc } from '../../shared/walkthrough'

const EXPANDED_WIDTH = 430
const EXPANDED_HEIGHT = 720
const COLLAPSED_WIDTH = 320
const COLLAPSED_HEIGHT = 88
const SCREEN_MARGIN = 20

export class WalkthroughWindow {
  private window: BrowserWindow | null = null
  private payload: WalkthroughPayload | null = null
  private dockSide: WalkthroughDockSide = 'right'
  private collapsed = false

  constructor(private readonly rendererUrl?: string) {}

  open(payload: WalkthroughPayload): WalkthroughWindowState {
    this.payload = payload

    if (!this.window || this.window.isDestroyed()) {
      this.window = this.createWindow()
    }

    this.applySize()
    this.positionDocked()
    this.window.showInactive()
    this.emitState()

    return this.getState()
  }

  getState(): WalkthroughWindowState {
    return {
      payload: this.payload,
      dockSide: this.dockSide,
      collapsed: this.collapsed
    }
  }

  setDockSide(dockSide: WalkthroughDockSide): WalkthroughWindowState {
    this.dockSide = dockSide
    this.positionDocked()
    this.emitState()
    return this.getState()
  }

  setCollapsed(collapsed: boolean): WalkthroughWindowState {
    this.collapsed = collapsed
    this.applySize()
    this.positionDocked()
    this.emitState()
    return this.getState()
  }

  close(): WalkthroughWindowState {
    this.window?.hide()
    this.payload = null
    this.collapsed = false
    this.emitState()
    return this.getState()
  }

  destroy(): void {
    this.window?.destroy()
    this.window = null
  }

  private createWindow(): BrowserWindow {
    const window = new BrowserWindow({
      width: EXPANDED_WIDTH,
      height: EXPANDED_HEIGHT,
      minWidth: 360,
      minHeight: 420,
      maxWidth: 560,
      show: false,
      frame: false,
      transparent: true,
      resizable: true,
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

    window.on('close', (event) => {
      event.preventDefault()
      this.close()
    })

    window.on('moved', () => {
      this.emitState()
    })

    if (this.rendererUrl) {
      window.loadURL(`${this.rendererUrl}#/walkthrough`)
    } else {
      window.loadFile(join(__dirname, '../renderer/index.html'), {
        hash: '/walkthrough'
      })
    }

    return window
  }

  private applySize(): void {
    if (!this.window || this.window.isDestroyed()) {
      return
    }

    const width = this.collapsed ? COLLAPSED_WIDTH : EXPANDED_WIDTH
    const height = this.collapsed ? COLLAPSED_HEIGHT : EXPANDED_HEIGHT
    this.window.setResizable(!this.collapsed)
    this.window.setSize(width, height, false)
  }

  private positionDocked(): void {
    if (!this.window || this.window.isDestroyed()) {
      return
    }

    const cursorPoint = screen.getCursorScreenPoint()
    const display = screen.getDisplayNearestPoint(cursorPoint)
    const { x, y, width, height } = display.workArea
    const bounds = this.window.getBounds()

    const nextX =
      this.dockSide === 'left'
        ? x + SCREEN_MARGIN
        : x + width - bounds.width - SCREEN_MARGIN
    const nextY = y + Math.max(SCREEN_MARGIN, Math.round((height - bounds.height) / 2))

    this.window.setPosition(Math.round(nextX), Math.round(nextY), false)
  }

  private emitState(): void {
    const state = this.getState()
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send(walkthroughIpc.stateChanged, state)
      }
    }
  }
}
