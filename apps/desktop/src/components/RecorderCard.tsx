import { useCallback, useEffect, useState } from 'react'
import { useRecording } from '../features/recording/useRecording'

function formatElapsed(
  startedAt: string | undefined,
  accumulatedPausedMs: number,
  pausedAt?: string
) {
  if (!startedAt) {
    return '00:00'
  }

  const currentPausedMs = pausedAt
    ? Date.now() - new Date(pausedAt).getTime()
    : 0

  const elapsedSeconds = Math.max(
    0,
    Math.floor(
      (
        Date.now() -
        new Date(startedAt).getTime() -
        accumulatedPausedMs -
        currentPausedMs
      ) / 1000
    )
  )

  const minutes = Math.floor(elapsedSeconds / 60)
  const seconds = elapsedSeconds % 60

  return `${minutes.toString().padStart(2, '0')}:${seconds
    .toString()
    .padStart(2, '0')}`
}

export function RecorderCard() {
  const { discard, error, save, start, state, stop } = useRecording()

  const [elapsed, setElapsed] = useState('00:00')

  const [audioEnabled, setAudioEnabled] = useState<boolean>(
    () => localStorage.getItem('worktrace:mic-enabled') !== 'false'
  )

  const [manualMode, setManualMode] = useState(false)
  const [saveName, setSaveName] = useState('Untitled workflow')

  useEffect(() => {
    localStorage.setItem(
      'worktrace:mic-enabled',
      String(audioEnabled)
    )
  }, [audioEnabled])

  useEffect(() => {
    let active = true

    const loadFlags = async () => {
      try {
        const flags = await window.api.settings.getFlags()

        if (active) {
          setManualMode(flags.manualMode)
        }
      } catch {
        // Capture still works with default flags if settings cannot be read.
      }
    }

    void loadFlags()

    const off = window.api.settings.onFlagsChanged((flags) =>
      setManualMode(flags.manualMode)
    )

    return () => {
      active = false
      off()
    }
  }, [])

  const { status } = state

  const isRecording = status === 'recording'
  const isPaused = status === 'paused'
  const isAwaitingSave = status === 'awaiting-save'

  const isBusy =
    status === 'requesting-permissions' ||
    status === 'starting' ||
    status === 'stopping' ||
    status === 'uploading' ||
    status === 'processing'

  const permissionError =
    error?.toLowerCase().includes('permission')

  const permissionType =
    error?.toLowerCase().includes('screen recording')
      ? 'screen'
      : error?.toLowerCase().includes('microphone')
        ? 'microphone'
        : 'accessibility'

  const toggleRecording = useCallback(() => {
    if (isAwaitingSave) {
      return
    }

    if (isRecording || isPaused) {
      void stop()
      return
    }

    void start({
      recordAudio: audioEnabled,
      manualMode
    })
  }, [
    audioEnabled,
    isAwaitingSave,
    isPaused,
    isRecording,
    manualMode,
    start,
    stop
  ])

  const saveRecording = useCallback(() => {
    void save(saveName)
  }, [save, saveName])

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        event.shiftKey &&
        event.key.toLowerCase() === 'r'
      ) {
        event.preventDefault()
        void toggleRecording()
      }
    }

    window.addEventListener('keydown', handleShortcut)

    return () =>
      window.removeEventListener(
        'keydown',
        handleShortcut
      )
  }, [toggleRecording])

  useEffect(() => {
    if (!isRecording && !isPaused) {
      setElapsed('00:00')
      return
    }

    const updateElapsed = () =>
      setElapsed(
        formatElapsed(
          state.startedAt ?? undefined,
          state.accumulatedPausedMs,
          state.pausedAt ?? undefined
        )
      )

    updateElapsed()

    const timer = window.setInterval(() => {
      updateElapsed()
    }, 1000)

    return () => window.clearInterval(timer)
  }, [
    isPaused,
    isRecording,
    state.accumulatedPausedMs,
    state.pausedAt,
    state.startedAt
  ])

  useEffect(() => {
    if (isAwaitingSave) {
      setSaveName(
        state.sessionName?.trim() ||
          'Untitled workflow'
      )
    }
  }, [isAwaitingSave, state.sessionName])

  return (
    <section className="recorder-card">
      <div className="recorder-card-topline" />

      <div className="recorder-card-inner">
        <div
          className={[
            'recorder-status-dot',
            isRecording
              ? 'recorder-status-dot-recording'
              : isPaused
                ? 'recorder-status-dot-paused'
                : 'recorder-status-dot-ready'
          ].join(' ')}
        />

        <p className="recorder-kicker">
          {isRecording
            ? 'Recording active'
            : isPaused
              ? 'Recording paused'
              : isAwaitingSave
                ? 'Ready to save'
                : isBusy
                  ? 'Preparing capture'
                  : 'Ready to record'}
        </p>

        <h2 className="recorder-title">
          {isAwaitingSave
            ? 'Name this workflow'
            : isRecording || isPaused
              ? 'Recording Your Workflow'
              : 'Capture a Workflow'}
        </h2>

        <p className="recorder-description">
          {isRecording || isPaused
            ? audioEnabled
              ? 'Your desktop activity and microphone narration are being captured. Complete the workflow naturally, then stop when you are finished.'
              : 'Your desktop activity is being captured without microphone narration. Complete the workflow naturally, then stop when you are finished.'
            : isAwaitingSave
              ? 'Capture is stopped. Give this workflow a useful name, then save it for backend processing or discard the local evidence.'
              : manualMode
                ? 'Click below to capture evidence for manual review. SOP generation will wait until you approve the transcript and annotations.'
                : 'Click below to start recording your desktop activity. Audio narration can be enabled or disabled before capture starts.'}
        </p>

        <button
          type="button"
          disabled={
            isRecording ||
            isPaused ||
            isBusy
          }
          onClick={() =>
            setAudioEnabled(
              (enabled) => !enabled
            )
          }
          className="audio-toggle"
        >
          <span
            className={[
              'audio-toggle-track',
              audioEnabled
                ? 'audio-toggle-track-on'
                : ''
            ].join(' ')}
          >
            <span className="audio-toggle-thumb" />
          </span>

          {audioEnabled
            ? 'Mic audio enabled'
            : 'Mic audio disabled'}
        </button>

        <button
          type="button"
          disabled={
            isBusy || isAwaitingSave
          }
          onClick={() =>
            void toggleRecording()
          }
          className={[
            'record-main-button',
            isRecording || isPaused
              ? 'record-main-button-stop'
              : ''
          ].join(' ')}
        >
          <span
            className={
              isRecording || isPaused
                ? 'record-stop-icon'
                : 'record-start-icon'
            }
          />

          {status === 'starting'
            ? 'Starting...'
            : status === 'stopping'
              ? 'Saving...'
              : status === 'uploading'
                ? 'Uploading...'
                : status === 'processing'
                  ? 'Processing...'
                  : isAwaitingSave
                    ? 'Review Recording'
                    : isRecording || isPaused
                      ? 'Stop Recording'
                      : 'Start Recording'}
        </button>

        {isAwaitingSave && (
          <div className="save-panel">
            <label className="save-field">
              <span>Workflow name</span>

              <input
                value={saveName}
                onChange={(event) =>
                  setSaveName(
                    event.target.value
                  )
                }
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    saveRecording()
                  }
                }}
                className="save-input"
                placeholder="e.g. Vendor invoice approval"
                autoFocus
              />
            </label>

            <div className="save-actions">
              <button
                type="button"
                onClick={() =>
                  void discard()
                }
                className="save-secondary-button"
              >
                Cancel & Discard
              </button>

              <button
                type="button"
                onClick={saveRecording}
                disabled={!saveName.trim()}
                className="save-primary-button"
              >
                Save Recording
              </button>
            </div>
          </div>
        )}

        {(isRecording || isPaused) && (
          <p className="record-elapsed">
            {elapsed}
          </p>
        )}

        {error && (
          <div className="recorder-error">
            <p>{error}</p>

            {permissionError && (
              <button
                type="button"
                onClick={() =>
                  void window.api.recording.openPermissionSettings(
                    permissionType
                  )
                }
              >
                Open Privacy Settings
              </button>
            )}
          </div>
        )}

        <div className="recorder-footer">
          <span>⌘ Cmd + Shift + R</span>

          <span className="recorder-divider" />

          <span>Full Desktop Mode</span>

          <span className="recorder-divider" />

          <span>
            {audioEnabled
              ? 'Mic Audio On'
              : 'Mic Audio Off'}
          </span>

          {manualMode && (
            <>
              <span className="hidden h-5 w-px bg-white/15 sm:block" />
              <span>Manual Review On</span>
            </>
          )}
        </div>
      </div>
    </section>
  )
}