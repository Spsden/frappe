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

  const currentPausedMs = pausedAt ? Date.now() - new Date(pausedAt).getTime() : 0
  const elapsedSeconds = Math.max(
    0,
    Math.floor(
      (Date.now() - new Date(startedAt).getTime() - accumulatedPausedMs - currentPausedMs) / 1000
    )
  )
  const minutes = Math.floor(elapsedSeconds / 60)
  const seconds = elapsedSeconds % 60

  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
}

export function RecorderCard() {
  const { discard, error, save, start, state, stop } = useRecording()
  const [elapsed, setElapsed] = useState('00:00')
  const [audioEnabled, setAudioEnabled] = useState<boolean>(
    () => localStorage.getItem('worktrace:mic-enabled') !== 'false'
  )
  const [saveName, setSaveName] = useState('Untitled workflow')

  useEffect(() => {
    localStorage.setItem('worktrace:mic-enabled', String(audioEnabled))
  }, [audioEnabled])
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
  const permissionError = error?.toLowerCase().includes('permission')
  const permissionType = error?.toLowerCase().includes('screen recording')
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

    void start({ recordAudio: audioEnabled })
  }, [audioEnabled, isAwaitingSave, isPaused, isRecording, start, stop])

  const saveRecording = useCallback(() => {
    void save(saveName)
  }, [save, saveName])

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'r') {
        event.preventDefault()
        void toggleRecording()
      }
    }

    window.addEventListener('keydown', handleShortcut)
    return () => window.removeEventListener('keydown', handleShortcut)
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
      setSaveName(state.sessionName?.trim() || 'Untitled workflow')
    }
  }, [isAwaitingSave, state.sessionName])

  return (
    <section className="mx-auto mt-16 mb-12 max-w-[840px] overflow-hidden rounded-xl border border-white/15 bg-[#0c0c0c] shadow-[0_20px_70px_rgba(0,0,0,0.65)]">
      <div className="flex min-h-[520px] flex-col items-center justify-center px-6 py-14 text-center sm:px-12">
        <div
          className={[
            'size-3 rounded-full transition-colors',
            isRecording
              ? 'animate-pulse bg-red-500 shadow-[0_0_18px_rgba(239,68,68,0.7)]'
              : isPaused
                ? 'bg-amber-400 shadow-[0_0_16px_rgba(251,191,36,0.45)]'
              : 'bg-red-600 shadow-[0_0_16px_rgba(220,38,38,0.45)]'
          ].join(' ')}
        />

        <p className="mt-5 font-mono text-xs font-bold uppercase tracking-[0.32em] text-white/70">
          {isRecording
            ? 'Neural trace active'
            : isPaused
              ? 'Neural trace paused'
              : isAwaitingSave
                ? 'Ready to save'
              : isBusy
                ? 'Preparing capture'
                : 'Ready to capture'}
        </p>

        <h2 className="mt-8 text-4xl font-black tracking-[-0.045em] sm:text-5xl">
          {isAwaitingSave
            ? 'Name This Workflow'
            : isRecording || isPaused
              ? 'Recording Your Workflow'
              : 'Capture a Workflow'}
        </h2>

        <p className="mt-8 max-w-xl text-base leading-7 text-white/65">
          {isRecording || isPaused
            ? audioEnabled
              ? 'Your desktop activity and microphone narration are being captured. Complete the workflow naturally, then stop when you are finished.'
              : 'Your desktop activity is being captured without microphone narration. Complete the workflow naturally, then stop when you are finished.'
            : isAwaitingSave
              ? 'Capture is stopped. Give this workflow a useful name, then save it for backend processing or discard the local evidence.'
            : 'Click below to start recording your desktop activity. Audio narration can be enabled or disabled before capture starts.'}
        </p>

        <button
          type="button"
          disabled={isRecording || isPaused || isBusy}
          onClick={() => setAudioEnabled((enabled) => !enabled)}
          className="mt-8 flex items-center gap-3 rounded-full border border-white/15 bg-white/[0.04] px-4 py-2 text-xs font-bold text-white/70 transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-65"
        >
          <span
            className={[
              'h-5 w-9 rounded-full border p-0.5 transition',
              audioEnabled ? 'border-emerald-400 bg-emerald-400/20' : 'border-white/20 bg-white/5'
            ].join(' ')}
          >
            <span
              className={[
                'block size-3.5 rounded-full transition',
                audioEnabled ? 'translate-x-4 bg-emerald-300' : 'bg-white/45'
              ].join(' ')}
            />
          </span>
          {audioEnabled ? 'Mic audio enabled' : 'Mic audio disabled'}
        </button>

        <button
          type="button"
          disabled={isBusy || isAwaitingSave}
          onClick={() => void toggleRecording()}
          className={[
            'mt-12 flex min-w-72 items-center justify-center gap-4 rounded-full px-10 py-5 text-base font-extrabold transition focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white disabled:cursor-wait disabled:opacity-60',
            isRecording || isPaused
              ? 'border border-red-500/50 bg-red-500 text-white hover:bg-red-400'
              : 'bg-white text-black hover:bg-white/85'
          ].join(' ')}
        >
          <span
            className={[
              'size-4',
              isRecording || isPaused ? 'rounded-sm bg-white' : 'rounded-full bg-black'
            ].join(' ')}
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
          <div className="mt-8 w-full max-w-xl rounded-2xl border border-white/12 bg-white/[0.035] p-5 text-left">
            <label className="block">
              <span className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-white/45">
                Workflow name
              </span>
              <input
                value={saveName}
                onChange={(event) => setSaveName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    saveRecording()
                  }
                }}
                className="mt-3 w-full rounded-xl border border-white/15 bg-black/40 px-4 py-3 text-base font-bold text-white outline-none transition placeholder:text-white/25 focus:border-white/35"
                placeholder="e.g. Vendor invoice approval"
                autoFocus
              />
            </label>

            <div className="mt-4 flex flex-wrap justify-end gap-3">
              <button
                type="button"
                onClick={() => void discard()}
                className="rounded-full border border-white/15 bg-white/[0.04] px-5 py-3 text-sm font-black text-white/65 transition hover:bg-white/[0.08] hover:text-white"
              >
                Cancel & Discard
              </button>
              <button
                type="button"
                onClick={saveRecording}
                disabled={!saveName.trim()}
                className="rounded-full bg-white px-6 py-3 text-sm font-black text-black transition hover:bg-white/85 disabled:cursor-not-allowed disabled:opacity-45"
              >
                Save Recording
              </button>
            </div>
          </div>
        )}

        {(isRecording || isPaused) && (
          <p className="mt-5 font-mono text-sm font-bold tracking-[0.18em] text-red-400">
            {elapsed}
          </p>
        )}

        {error && (
          <div className="mt-5 flex flex-col items-center gap-3">
            <p className="max-w-lg text-xs leading-5 text-red-400">{error}</p>
            {permissionError && (
              <button
                type="button"
                onClick={() => void window.api.recording.openPermissionSettings(permissionType)}
                className="rounded-lg border border-white/15 bg-white/6 px-4 py-2 text-xs font-bold text-white transition hover:bg-white/12"
              >
                Open Privacy Settings
              </button>
            )}
          </div>
        )}

        <div className="mt-12 flex flex-wrap items-center justify-center gap-4 font-mono text-xs font-semibold tracking-[0.08em] text-white/65 sm:text-sm">
          <span>⌘ Cmd + Shift + R</span>
          <span className="hidden h-5 w-px bg-white/15 sm:block" />
          <span className="flex items-center gap-2">
            <svg
              viewBox="0 0 24 24"
              aria-hidden="true"
              className="size-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
            >
              <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z" />
              <circle cx="12" cy="12" r="2.5" />
            </svg>
            Full Desktop Mode
          </span>
          <span className="hidden h-5 w-px bg-white/15 sm:block" />
          <span>{audioEnabled ? 'Mic Audio On' : 'Mic Audio Off'}</span>
        </div>
      </div>
    </section>
  )
}
