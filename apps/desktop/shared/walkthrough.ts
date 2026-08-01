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

export interface WalkthroughApi {
  open: (payload: WalkthroughPayload) => Promise<WalkthroughWindowState>
  getState: () => Promise<WalkthroughWindowState>
  setDockSide: (dockSide: WalkthroughDockSide) => Promise<WalkthroughWindowState>
  setCollapsed: (collapsed: boolean) => Promise<WalkthroughWindowState>
  close: () => Promise<WalkthroughWindowState>
  onStateChanged: (listener: (state: WalkthroughWindowState) => void) => () => void
}

export const walkthroughIpc = {
  open: 'walkthrough:open',
  getState: 'walkthrough:get-state',
  setDockSide: 'walkthrough:set-dock-side',
  setCollapsed: 'walkthrough:set-collapsed',
  close: 'walkthrough:close',
  stateChanged: 'walkthrough:state-changed'
} as const
