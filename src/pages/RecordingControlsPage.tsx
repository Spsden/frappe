import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import type { RecordingState } from '../../shared/recording'

function formatElapsed(state: RecordingState, now: number): string {
  if (!state.startedAt) {
    return '00:00'
  }

  const currentPausedMs =
    state.status === 'paused' && state.pausedAt
      ? Math.max(0, now - new Date(state.pausedAt).getTime())
      : 0
  const elapsedMs = Math.max(
    0,
    now -
      new Date(state.startedAt).getTime() -
      state.accumulatedPausedMs -
      currentPausedMs
  )
  const elapsedSeconds = Math.floor(elapsedMs / 1000)
  const minutes = Math.floor(elapsedSeconds / 60)
  const seconds = elapsedSeconds % 60

  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
}

export function RecordingControlsPage() {
  const [state, setState] = useState<RecordingState | null>(null)
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    void window.api.recording.getState().then(setState)
    return window.api.recording.onStateChanged(setState)
  }, [])

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 500)
    return () => window.clearInterval(timer)
  }, [])

  const elapsed = useMemo(() => (state ? formatElapsed(state, now) : '00:00'), [now, state])
  const isPaused = state?.status === 'paused'
  const isBusy = state?.status === 'stopping' || state?.status === 'processing'

  return (
    <main className="flex h-screen items-center justify-center bg-transparent p-1.5">
      <section
        className="flex h-full w-full items-center gap-4 rounded-2xl border border-white/15 bg-[#111]/95 px-4 text-white shadow-[0_12px_45px_rgba(0,0,0,0.65)] backdrop-blur-xl"
        style={{ WebkitAppRegion: 'drag' } as CSSProperties}
      >
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span
            className={[
              'size-2.5 shrink-0 rounded-full',
              isPaused
                ? 'bg-amber-400'
                : 'animate-pulse bg-red-500 shadow-[0_0_12px_rgba(239,68,68,0.75)]'
            ].join(' ')}
          />
          <div className="min-w-0">
            <p className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-white/70">
              {isPaused ? 'Paused' : isBusy ? 'Saving trace' : 'Recording'}
            </p>
            <p className="mt-0.5 font-mono text-sm font-black tabular-nums">{elapsed}</p>
          </div>
        </div>

        <div
          className="flex items-center gap-2"
          style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}
        >
          <button
            type="button"
            disabled={isBusy}
            onClick={() =>
              void (isPaused ? window.api.recording.resume() : window.api.recording.pause())
            }
            className="flex h-10 items-center gap-2 rounded-xl border border-white/15 bg-white/7 px-3 text-xs font-bold transition hover:bg-white/12 disabled:cursor-wait disabled:opacity-50"
          >
            <span className="text-sm">{isPaused ? '▶' : 'Ⅱ'}</span>
            {isPaused ? 'Resume' : 'Pause'}
          </button>
          <button
            type="button"
            disabled={isBusy}
            onClick={() => void window.api.recording.stop()}
            className="flex h-10 items-center gap-2 rounded-xl bg-red-500 px-3 text-xs font-black transition hover:bg-red-400 disabled:cursor-wait disabled:opacity-60"
          >
            <span className="size-2.5 rounded-sm bg-white" />
            Stop
          </button>
        </div>
      </section>
    </main>
  )
}
