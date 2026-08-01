import { useCallback, useEffect, useState } from 'react'
import type {
  RecordingOptions,
  RecordingState,
  SaveRecordingPayload
} from '../../../shared/recording'

const initialState: RecordingState = {
  status: 'idle',
  sessionId: null,
  sessionName: null,
  startedAt: null,
  pausedAt: null,
  accumulatedPausedMs: 0,
  eventCount: 0,
  screenshotCount: 0,
  audioChunkCount: 0,
  outputPath: null,
  remoteRecordingId: null,
  remoteSessionId: null,
  error: null
}

export function useRecording() {
  const [state, setState] = useState<RecordingState>(initialState)
  const [commandError, setCommandError] = useState<string | null>(null)

  useEffect(() => {
    void window.api.recording.getState().then(setState)
    return window.api.recording.onStateChanged(setState)
  }, [])

  const runCommand = useCallback(async (command: () => Promise<RecordingState>) => {
    setCommandError(null)

    try {
      setState(await command())
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Recording command failed.'
      setCommandError(
        message
          .replace(/^Error invoking remote method '[^']+': Error:\s*/i, '')
          .replace(/^Error:\s*/i, '')
      )
    }
  }, [])

  const start = useCallback(
    (options?: Partial<RecordingOptions>) => runCommand(() => window.api.recording.start(options)),
    [runCommand]
  )
  const pause = useCallback(
    () => runCommand(() => window.api.recording.pause()),
    [runCommand]
  )
  const resume = useCallback(
    () => runCommand(() => window.api.recording.resume()),
    [runCommand]
  )
  const stop = useCallback(
    () => runCommand(() => window.api.recording.stop()),
    [runCommand]
  )
  const save = useCallback(
    (payload: SaveRecordingPayload) =>
      runCommand(() => window.api.recording.save(payload)),
    [runCommand]
  )
  const discard = useCallback(
    () => runCommand(() => window.api.recording.discard()),
    [runCommand]
  )

  return {
    state,
    error: commandError ?? state.error,
    start,
    pause,
    resume,
    stop,
    save,
    discard
  }
}
