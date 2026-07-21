import { BrowserWindow, ipcMain } from 'electron'
import {
  connectionIpc,
  type ConnectionStatus,
  type LoginCredentials,
  type SignUpCredentials
} from '../../shared/connection'
import { ConnectionSettingsStore } from './ConnectionSettingsStore'
import { WorkTraceApiClient } from './WorkTraceApiClient'

export function registerConnectionIpc(
  settings: ConnectionSettingsStore,
  apiClient: WorkTraceApiClient
): void {
  const broadcast = (status: ConnectionStatus) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(connectionIpc.statusChanged, status)
    }
    return status
  }

  ipcMain.handle(connectionIpc.getStatus, () => settings.getStatus())
  ipcMain.handle(connectionIpc.signup, async (_event, payload: SignUpCredentials) =>
    broadcast(await apiClient.signup(payload))
  )
  ipcMain.handle(connectionIpc.login, async (_event, payload: LoginCredentials) =>
    broadcast(await apiClient.login(payload))
  )
  ipcMain.handle(connectionIpc.logout, async () => broadcast(await apiClient.logout()))
  ipcMain.handle(connectionIpc.test, async () => broadcast(await apiClient.testConnection()))
  ipcMain.handle(connectionIpc.getHealth, () => apiClient.getHealth())
}
