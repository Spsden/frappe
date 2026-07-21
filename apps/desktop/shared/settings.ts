export interface ExperimentalFlags {
  /**
   * Phase 2 (experimental): when enabled, clicks also query the platform
   * accessibility API for the element under the cursor, producing element-level
   * highlight bounds + labels instead of a fixed box around the click point.
   * Off by default; Phase 3 coordinate-based capture is the baseline.
   */
  accessibilityCapture: boolean
  /**
   * Holds completed evidence after annotation/transcription so a human can
   * adjust screenshots/transcript before LLM SOP generation starts.
   */
  manualMode: boolean
}

export type ExperimentalFlag = keyof ExperimentalFlags

export interface SettingsApi {
  getFlags: () => Promise<ExperimentalFlags>
  setFlag: (flag: ExperimentalFlag, value: boolean) => Promise<ExperimentalFlags>
  onFlagsChanged: (listener: (flags: ExperimentalFlags) => void) => () => void
}

export const settingsIpc = {
  getFlags: 'settings:get-flags',
  setFlag: 'settings:set-flag',
  flagsChanged: 'settings:flags-changed'
} as const
