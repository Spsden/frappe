import { ipcMain } from 'electron'
import type { WalkthroughDockSide, WalkthroughPayload } from '../../shared/walkthrough'
import { walkthroughIpc } from '../../shared/walkthrough'
import { WalkthroughWindow } from './WalkthroughWindow'

export function registerWalkthroughIpc(walkthroughWindow: WalkthroughWindow): void {
  ipcMain.handle(walkthroughIpc.open, (_event, payload: WalkthroughPayload) =>
    walkthroughWindow.open(payload)
  )
  ipcMain.handle(walkthroughIpc.getState, () => walkthroughWindow.getState())
  ipcMain.handle(walkthroughIpc.setDockSide, (_event, dockSide: WalkthroughDockSide) =>
    walkthroughWindow.setDockSide(dockSide)
  )
  ipcMain.handle(walkthroughIpc.setCollapsed, (_event, collapsed: boolean) =>
    walkthroughWindow.setCollapsed(collapsed)
  )
  ipcMain.handle(walkthroughIpc.close, () => walkthroughWindow.close())
}
