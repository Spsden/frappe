import { ipcMain } from 'electron'
import type {
  ImageViewerPayload,
  WalkthroughDockSide,
  WalkthroughPayload
} from '../../shared/walkthrough'
import { walkthroughIpc } from '../../shared/walkthrough'
import { ImageViewerWindow } from './ImageViewerWindow'
import { WalkthroughWindow } from './WalkthroughWindow'

export function registerWalkthroughIpc(
  walkthroughWindow: WalkthroughWindow,
  imageViewerWindow: ImageViewerWindow
): void {
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
  ipcMain.handle(walkthroughIpc.close, () => {
    imageViewerWindow.close()
    return walkthroughWindow.close()
  })
  ipcMain.handle(walkthroughIpc.openImageViewer, (_event, payload: ImageViewerPayload) =>
    imageViewerWindow.open(payload)
  )
  ipcMain.handle(walkthroughIpc.updateImageViewer, (_event, payload: ImageViewerPayload) =>
    imageViewerWindow.update(payload)
  )
  ipcMain.handle(walkthroughIpc.getImageViewerState, () => imageViewerWindow.getState())
  ipcMain.handle(walkthroughIpc.closeImageViewer, () => imageViewerWindow.close())
}
