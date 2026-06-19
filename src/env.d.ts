import type { RecordingApi } from '../shared/recording'

export {}

interface Window {
  api: {
    getAppVersion: () => Promise<string>
    getSurajLol: () => Promise<string>
    getSomeOtherThing: () => string
    recording: RecordingApi
  }
}
