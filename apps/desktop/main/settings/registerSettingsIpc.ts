import { BrowserWindow, ipcMain } from 'electron'
import {
  settingsIpc,
  type ExperimentalFlag,
  type ExperimentalFlags
} from '../../shared/settings'
import { ExperimentalSettingsStore } from './ExperimentalSettingsStore'

export function registerSettingsIpc(store: ExperimentalSettingsStore): () => void {
  const broadcast = (flags: ExperimentalFlags) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(settingsIpc.flagsChanged, flags)
    }
    return flags
  }

  ipcMain.handle(settingsIpc.getFlags, () => store.getFlags())
  ipcMain.handle(
    settingsIpc.setFlag,
    (_event, flag: ExperimentalFlag, value: boolean) =>
      store.update({ [flag]: value } as Partial<ExperimentalFlags>).then(broadcast)
  )

  return () => {
    ipcMain.removeHandler(settingsIpc.getFlags)
    ipcMain.removeHandler(settingsIpc.setFlag)
  }
}
