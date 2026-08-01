import type { BackendSOP } from './recording'

export type WalkthroughDockSide = 'left' | 'right'

export interface WalkthroughPayload {
  sop: BackendSOP
  startedAt: string
}

export interface WalkthroughWindowState {
  payload: WalkthroughPayload | null
  dockSide: WalkthroughDockSide
  collapsed: boolean
}

export interface ImageViewerPayload {
  sessionId: string
  screenshotId: string
  title: string
  stepPosition: number
  mediaUrl?: string | null
  openedAt: string
}

export interface ImageViewerWindowState {
  payload: ImageViewerPayload | null
}

export interface WalkthroughApi {
  open: (payload: WalkthroughPayload) => Promise<WalkthroughWindowState>
  getState: () => Promise<WalkthroughWindowState>
  setDockSide: (dockSide: WalkthroughDockSide) => Promise<WalkthroughWindowState>
  setCollapsed: (collapsed: boolean) => Promise<WalkthroughWindowState>
  close: () => Promise<WalkthroughWindowState>
  onStateChanged: (listener: (state: WalkthroughWindowState) => void) => () => void
  openImageViewer: (payload: ImageViewerPayload) => Promise<ImageViewerWindowState>
  updateImageViewer: (payload: ImageViewerPayload) => Promise<ImageViewerWindowState>
  getImageViewerState: () => Promise<ImageViewerWindowState>
  closeImageViewer: () => Promise<ImageViewerWindowState>
  onImageViewerStateChanged: (
    listener: (state: ImageViewerWindowState) => void
  ) => () => void
}

export const walkthroughIpc = {
  open: 'walkthrough:open',
  getState: 'walkthrough:get-state',
  setDockSide: 'walkthrough:set-dock-side',
  setCollapsed: 'walkthrough:set-collapsed',
  close: 'walkthrough:close',
  stateChanged: 'walkthrough:state-changed',
  openImageViewer: 'walkthrough:image-viewer-open',
  updateImageViewer: 'walkthrough:image-viewer-update',
  getImageViewerState: 'walkthrough:image-viewer-get-state',
  closeImageViewer: 'walkthrough:image-viewer-close',
  imageViewerStateChanged: 'walkthrough:image-viewer-state-changed'
} as const
