import type { ConnectionApi } from '../shared/connection'
import type { AudioRecorderApi, RecordingApi } from '../shared/recording'
import type { SettingsApi } from '../shared/settings'
import type { WalkthroughApi } from '../shared/walkthrough'

export {}

declare module '*.png' {
  const src: string
  export default src
}

declare module '*.svg?raw' {
  const src: string
  export default src
}

declare global {
  interface Window {
    api: {
      getAppVersion: () => Promise<string>
      getSurajLol: () => Promise<string>
      getKanakVersion: () => Promise<string>
      getSomeOtherThing: () => string
      connection: ConnectionApi
      recording: RecordingApi
      settings: SettingsApi
      walkthrough: WalkthroughApi
    }
    audioRecorder: AudioRecorderApi
  }
}
