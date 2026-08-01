import {
  useCallback,
  useEffect,
  useMemo,
  useState
} from 'react'
import type { BackendWorkflow } from '../../shared/recording'
import { useRecording } from '../features/recording/useRecording'
import { useTheme } from '../features/theme/ThemeContext'

function formatElapsed(
  startedAt: string | undefined,
  accumulatedPausedMs: number,
  pausedAt?: string
) {
  if (!startedAt) {
    return '00:00'
  }

  const currentPausedMs = pausedAt
    ? Date.now() -
      new Date(pausedAt).getTime()
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

  const minutes = Math.floor(
    elapsedSeconds / 60
  )

  const seconds =
    elapsedSeconds % 60

  return `${minutes
    .toString()
    .padStart(2, '0')}:${seconds
    .toString()
    .padStart(2, '0')}`
}

const createWorkflowValue = '__create_workflow__'

function normalizeWorkflowName(value: string) {
  return value
    .trim()
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export function RecorderCard() {
  const {
    discard,
    error,
    save,
    start,
    state,
    stop
  } = useRecording()

  const { theme } = useTheme()
  const isDark = theme === 'dark'

  const [elapsed, setElapsed] =
    useState('00:00')

  const [
    audioEnabled,
    setAudioEnabled
  ] = useState<boolean>(
    () =>
      localStorage.getItem(
        'worktrace:mic-enabled'
      ) !== 'false'
  )

  const [
    manualMode,
    setManualMode
  ] = useState(false)

  const [
    saveName,
    setSaveName
  ] = useState('')

  const [reference, setReference] =
    useState('')

  const [workflows, setWorkflows] =
    useState<BackendWorkflow[]>([])

  const [selectedWorkflowId, setSelectedWorkflowId] =
    useState(createWorkflowValue)

  const [workflowSearch, setWorkflowSearch] =
    useState('')

  const [workflowPickerOpen, setWorkflowPickerOpen] =
    useState(false)

  const [workflowsLoading, setWorkflowsLoading] =
    useState(false)

  const [workflowsError, setWorkflowsError] =
    useState<string | null>(null)

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
        const flags =
          await window.api.settings.getFlags()

        if (active) {
          setManualMode(
            flags.manualMode
          )
        }
      } catch {
        // Capture still works with default flags if settings cannot be read.
      }
    }

    void loadFlags()

    const off =
      window.api.settings.onFlagsChanged(
        (flags) =>
          setManualMode(
            flags.manualMode
          )
      )

    return () => {
      active = false
      off()
    }
  }, [])

  const { status } = state

  const isRecording =
    status === 'recording'

  const isPaused =
    status === 'paused'

  const isAwaitingSave =
    status === 'awaiting-save'

  const isBusy =
    status ===
      'requesting-permissions' ||
    status === 'starting' ||
    status === 'stopping' ||
    status === 'uploading' ||
    status === 'processing'

  const permissionError =
    error
      ?.toLowerCase()
      .includes('permission')

  const permissionType = error
    ?.toLowerCase()
    .includes('screen recording')
    ? 'screen'
    : error
        ?.toLowerCase()
        .includes('microphone')
      ? 'microphone'
      : 'accessibility'

  const toggleRecording =
    useCallback(() => {
      if (isAwaitingSave) {
        return
      }

      if (
        isRecording ||
        isPaused
      ) {
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

  const saveRecording =
    useCallback(() => {
      const selectedWorkflow = workflows.find(
        (workflow) => workflow.id === selectedWorkflowId
      )
      const workflowName = selectedWorkflow?.name ?? saveName.trim()

      if (!workflowName) {
        return
      }

      void save({
        workflowId: selectedWorkflow?.id,
        workflowName,
        reference: reference.trim() || undefined
      })
    }, [reference, save, saveName, selectedWorkflowId, workflows])

  useEffect(() => {
    const handleShortcut = (
      event: KeyboardEvent
    ) => {
      if (
        (
          event.metaKey ||
          event.ctrlKey
        ) &&
        event.shiftKey &&
        event.key.toLowerCase() ===
          'r'
      ) {
        event.preventDefault()
        void toggleRecording()
      }
    }

    window.addEventListener(
      'keydown',
      handleShortcut
    )

    return () =>
      window.removeEventListener(
        'keydown',
        handleShortcut
      )
  }, [toggleRecording])

  useEffect(() => {
    if (
      !isRecording &&
      !isPaused
    ) {
      setElapsed('00:00')
      return
    }

    const updateElapsed = () =>
      setElapsed(
        formatElapsed(
          state.startedAt ??
            undefined,
          state.accumulatedPausedMs,
          state.pausedAt ??
            undefined
        )
      )

    updateElapsed()

    const timer =
      window.setInterval(
        updateElapsed,
        1000
      )

    return () =>
      window.clearInterval(timer)
  }, [
    isPaused,
    isRecording,
    state.accumulatedPausedMs,
    state.pausedAt,
    state.startedAt
  ])

  useEffect(() => {
    if (isAwaitingSave) {
      const suggestedName = state.sessionName?.trim() || ''
      setSaveName(
        suggestedName.toLowerCase() === 'untitled workflow'
          ? ''
          : suggestedName
      )
      setReference('')
      setSelectedWorkflowId(createWorkflowValue)
      setWorkflowSearch('')
      setWorkflowPickerOpen(false)
    }
  }, [
    isAwaitingSave,
    state.sessionName
  ])

  useEffect(() => {
    if (!isAwaitingSave) {
      return
    }

    let active = true
    setWorkflowsLoading(true)
    setWorkflowsError(null)

    void window.api.recording
      .listWorkflows()
      .then((items) => {
        if (active) {
          setWorkflows(items)
        }
      })
      .catch((caught) => {
        if (active) {
          setWorkflowsError(
            caught instanceof Error
              ? caught.message
              : 'Existing workflows could not be loaded.'
          )
        }
      })
      .finally(() => {
        if (active) {
          setWorkflowsLoading(false)
        }
      })

    return () => {
      active = false
    }
  }, [isAwaitingSave])

  const selectedWorkflow = useMemo(
    () => workflows.find((workflow) => workflow.id === selectedWorkflowId) ?? null,
    [selectedWorkflowId, workflows]
  )

  const visibleWorkflows = useMemo(() => {
    const query = workflowSearch.trim().toLocaleLowerCase()
    if (!query) {
      return workflows.slice(0, 8)
    }
    return workflows
      .filter((workflow) => workflow.name.toLocaleLowerCase().includes(query))
      .slice(0, 8)
  }, [workflowSearch, workflows])

  const similarWorkflow = useMemo(() => {
    if (selectedWorkflowId !== createWorkflowValue) {
      return null
    }
    const candidate = normalizeWorkflowName(saveName)
    if (candidate.length < 4) {
      return null
    }
    return workflows.find((workflow) => {
      const existing = normalizeWorkflowName(workflow.name)
      return (
        existing === candidate ||
        (candidate.length >= 7 &&
          (existing.startsWith(candidate) || candidate.startsWith(existing)))
      )
    }) ?? null
  }, [saveName, selectedWorkflowId, workflows])

  const canSaveRecording = Boolean(
    selectedWorkflow ||
      (selectedWorkflowId === createWorkflowValue && saveName.trim())
  )

  const statusText = isRecording
    ? 'Neural trace active'
    : isPaused
      ? 'Neural trace paused'
      : isAwaitingSave
        ? 'Ready to save'
        : isBusy
          ? 'Preparing capture'
          : 'Ready to capture'

  const title = isAwaitingSave
    ? 'Save This Recording'
    : isRecording || isPaused
      ? 'Recording Your Workflow'
      : 'Capture a Workflow'

  const description =
    isRecording || isPaused
      ? audioEnabled
        ? 'Your desktop activity and microphone narration are being captured. Complete the workflow naturally, then stop when you are finished.'
        : 'Your desktop activity is being captured without microphone narration. Complete the workflow naturally, then stop when you are finished.'
      : isAwaitingSave
        ? 'Add this recording to an existing workflow or create a new workflow for it.'
        : manualMode
          ? 'Click below to capture evidence. SOP generation will pause until you review the transcript and annotations.'
          : 'Click below to start recording your desktop activity. Audio narration can be enabled or disabled before capture starts.'

  const mainButtonText =
    status === 'starting'
      ? 'Starting...'
      : status === 'stopping'
        ? 'Saving...'
        : status === 'uploading'
          ? 'Uploading...'
          : status ===
              'processing'
            ? 'Processing...'
            : isAwaitingSave
              ? 'Review Recording'
              : isRecording ||
                  isPaused
                ? 'Stop Recording'
                : 'Start Recording'

  return (
    <section
      className={
        isDark
          ? 'mx-auto mt-16 mb-12 max-w-[840px] overflow-hidden rounded-xl border border-white/15 bg-[#0c0c0c] shadow-[0_20px_70px_rgba(0,0,0,0.65)]'
          : 'recorder-card'
      }
    >
      {!isDark && (
        <div className="recorder-card-topline" />
      )}

      <div
        className={
          isDark
            ? 'flex min-h-[520px] flex-col items-center justify-center px-6 py-14 text-center sm:px-12'
            : 'recorder-card-inner'
        }
      >
        <div
          className={
            isDark
              ? [
                  'size-3 rounded-full transition-colors',
                  isRecording
                    ? 'animate-pulse bg-red-500 shadow-[0_0_18px_rgba(239,68,68,0.7)]'
                    : isPaused
                      ? 'bg-amber-400 shadow-[0_0_16px_rgba(251,191,36,0.45)]'
                      : 'bg-red-600 shadow-[0_0_16px_rgba(220,38,38,0.45)]'
                ].join(' ')
              : [
                  'recorder-status-dot',
                  isRecording
                    ? 'recorder-status-dot-recording'
                    : isPaused
                      ? 'recorder-status-dot-paused'
                      : 'recorder-status-dot-ready'
                ].join(' ')
          }
        />

        <p
          className={
            isDark
              ? 'mt-5 font-mono text-xs font-bold uppercase tracking-[0.32em] text-white/70'
              : 'recorder-kicker'
          }
        >
          {statusText}
        </p>

        <h2
          className={
            isDark
              ? 'mt-8 text-4xl font-black tracking-[-0.045em] sm:text-5xl'
              : 'recorder-title'
          }
        >
          {title}
        </h2>

        <p
          className={
            isDark
              ? 'mt-8 max-w-xl text-base leading-7 text-white/65'
              : 'recorder-description'
          }
        >
          {description}
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
          className={
            isDark
              ? 'mt-8 flex items-center gap-3 rounded-full border border-white/15 bg-white/[0.04] px-4 py-2 text-xs font-bold text-white/70 transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-65'
              : 'audio-toggle'
          }
        >
          <span
            className={
              isDark
                ? [
                    'h-5 w-9 rounded-full border p-0.5 transition',
                    audioEnabled
                      ? 'border-emerald-400 bg-emerald-400/20'
                      : 'border-white/20 bg-white/5'
                  ].join(' ')
                : [
                    'audio-toggle-track',
                    audioEnabled
                      ? 'audio-toggle-track-on'
                      : ''
                  ].join(' ')
            }
          >
            <span
              className={
                isDark
                  ? [
                      'block size-3.5 rounded-full transition',
                      audioEnabled
                        ? 'translate-x-4 bg-emerald-300'
                        : 'bg-white/45'
                    ].join(' ')
                  : 'audio-toggle-thumb'
              }
            />
          </span>

          {audioEnabled
            ? 'Mic audio enabled'
            : 'Mic audio disabled'}
        </button>

        <button
          type="button"
          disabled={
            isBusy ||
            isAwaitingSave
          }
          onClick={() =>
            void toggleRecording()
          }
          className={
            isDark
              ? [
                  'mt-12 flex min-w-72 items-center justify-center gap-4 rounded-full px-10 py-5 text-base font-extrabold transition focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white disabled:cursor-wait disabled:opacity-60',
                  isRecording ||
                  isPaused
                    ? 'border border-red-500/50 bg-red-500 text-white hover:bg-red-400'
                    : 'bg-white text-black hover:bg-white/85'
                ].join(' ')
              : [
                  'record-main-button',
                  isRecording ||
                  isPaused
                    ? 'record-main-button-stop'
                    : ''
                ].join(' ')
          }
        >
          <span
            className={
              isDark
                ? [
                    'size-4',
                    isRecording ||
                    isPaused
                      ? 'rounded-sm bg-white'
                      : 'rounded-full bg-black'
                  ].join(' ')
                : isRecording ||
                    isPaused
                  ? 'record-stop-icon'
                  : 'record-start-icon'
            }
          />

          {mainButtonText}
        </button>

        {isAwaitingSave && (
          <div
            className={
              isDark
                ? 'mt-8 w-full max-w-xl rounded-2xl border border-white/12 bg-white/[0.035] p-5 text-left'
                : 'save-panel'
            }
          >
            <div className="relative">
              <span
                className={
                  isDark
                    ? 'font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-white/45'
                    : 'text-xs font-bold uppercase tracking-[0.12em] text-slate-500'
                }
              >
                Workflow
              </span>

              <button
                type="button"
                role="combobox"
                aria-expanded={workflowPickerOpen}
                aria-controls="workflow-picker-options"
                onClick={() => setWorkflowPickerOpen((open) => !open)}
                className={
                  isDark
                    ? 'mt-3 flex w-full items-center justify-between rounded-xl border border-white/15 bg-black/40 px-4 py-3 text-left text-sm font-bold text-white outline-none transition hover:border-white/30'
                    : 'mt-2 flex w-full items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 text-left text-sm font-bold text-slate-800 shadow-sm transition hover:border-purple-300'
                }
              >
                <span className="truncate">
                  {selectedWorkflow?.name ?? '+ Create new workflow'}
                </span>
                <svg
                  viewBox="0 0 20 20"
                  aria-hidden="true"
                  className={[
                    'size-4 shrink-0 transition',
                    workflowPickerOpen ? 'rotate-180' : ''
                  ].join(' ')}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                >
                  <path d="m5 7.5 5 5 5-5" />
                </svg>
              </button>

              {workflowPickerOpen && (
                <div
                  id="workflow-picker-options"
                  className={
                    isDark
                      ? 'absolute inset-x-0 top-full z-30 mt-2 overflow-hidden rounded-xl border border-white/15 bg-[#111] shadow-2xl'
                      : 'absolute inset-x-0 top-full z-30 mt-2 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl'
                  }
                >
                  <div className="p-2">
                    <input
                      value={workflowSearch}
                      onChange={(event) => setWorkflowSearch(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Escape') {
                          setWorkflowPickerOpen(false)
                        }
                      }}
                      placeholder="Search workflows..."
                      aria-label="Search workflows"
                      autoFocus
                      className={
                        isDark
                          ? 'w-full rounded-lg border border-white/10 bg-black/50 px-3 py-2 text-sm text-white outline-none placeholder:text-white/25 focus:border-white/30'
                          : 'w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 outline-none placeholder:text-slate-400 focus:border-purple-300'
                      }
                    />
                  </div>

                  <div className="max-h-52 overflow-y-auto p-1">
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedWorkflowId(createWorkflowValue)
                        setWorkflowPickerOpen(false)
                      }}
                      className={[
                        'flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm font-bold transition',
                        selectedWorkflowId === createWorkflowValue
                          ? isDark
                            ? 'bg-emerald-400/12 text-emerald-300'
                            : 'bg-purple-50 text-purple-700'
                          : isDark
                            ? 'text-white/75 hover:bg-white/[0.06]'
                            : 'text-slate-700 hover:bg-slate-50'
                      ].join(' ')}
                    >
                      <span>+ Create new workflow</span>
                      {selectedWorkflowId === createWorkflowValue && <span>✓</span>}
                    </button>

                    {workflowsLoading && (
                      <p className={isDark ? 'px-3 py-3 text-xs text-white/40' : 'px-3 py-3 text-xs text-slate-400'}>
                        Loading workflows...
                      </p>
                    )}

                    {!workflowsLoading && visibleWorkflows.map((workflow) => (
                      <button
                        type="button"
                        key={workflow.id}
                        onClick={() => {
                          setSelectedWorkflowId(workflow.id)
                          setSaveName(workflow.name)
                          setWorkflowPickerOpen(false)
                        }}
                        className={[
                          'flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left transition',
                          selectedWorkflowId === workflow.id
                            ? isDark
                              ? 'bg-emerald-400/12 text-emerald-300'
                              : 'bg-purple-50 text-purple-700'
                            : isDark
                              ? 'text-white/75 hover:bg-white/[0.06]'
                              : 'text-slate-700 hover:bg-slate-50'
                        ].join(' ')}
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-bold">{workflow.name}</span>
                          <span className={isDark ? 'mt-0.5 block text-[10px] text-white/35' : 'mt-0.5 block text-[10px] text-slate-400'}>
                            {workflow.recording_count} {workflow.recording_count === 1 ? 'recording' : 'recordings'}
                          </span>
                        </span>
                        {selectedWorkflowId === workflow.id && <span>✓</span>}
                      </button>
                    ))}

                    {!workflowsLoading && workflowSearch.trim() && visibleWorkflows.length === 0 && (
                      <p className={isDark ? 'px-3 py-3 text-xs text-white/40' : 'px-3 py-3 text-xs text-slate-400'}>
                        No matching workflows.
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>

            {selectedWorkflowId === createWorkflowValue && (
              <label className={isDark ? 'mt-4 block' : 'mt-4 block'}>
                <span
                  className={
                    isDark
                      ? 'font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-white/45'
                      : 'text-xs font-bold uppercase tracking-[0.12em] text-slate-500'
                  }
                >
                  Workflow name
                </span>
                <input
                  value={saveName}
                  onChange={(event) => setSaveName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && canSaveRecording) {
                      event.preventDefault()
                      saveRecording()
                    }
                  }}
                  className={
                    isDark
                      ? 'mt-3 w-full rounded-xl border border-white/15 bg-black/40 px-4 py-3 text-base font-bold text-white outline-none transition placeholder:text-white/25 focus:border-white/35'
                      : 'mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-base font-bold text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-purple-300'
                  }
                  placeholder="e.g. Vendor invoice approval"
                  autoFocus
                />
              </label>
            )}

            {similarWorkflow && (
              <button
                type="button"
                onClick={() => {
                  setSelectedWorkflowId(similarWorkflow.id)
                  setSaveName(similarWorkflow.name)
                }}
                className={
                  isDark
                    ? 'mt-3 w-full rounded-xl border border-amber-400/20 bg-amber-400/[0.07] px-3 py-2 text-left text-xs leading-5 text-amber-200 transition hover:bg-amber-400/10'
                    : 'mt-3 w-full rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-left text-xs leading-5 text-amber-700 transition hover:bg-amber-100'
                }
              >
                Similar workflow found: <strong>{similarWorkflow.name}</strong>. Use this workflow instead?
              </button>
            )}

            <label className="mt-4 block">
              <span
                className={
                  isDark
                    ? 'font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-white/45'
                    : 'text-xs font-bold uppercase tracking-[0.12em] text-slate-500'
                }
              >
                Reference <span className="normal-case tracking-normal opacity-60">(optional)</span>
              </span>
              <input
                value={reference}
                onChange={(event) => setReference(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && canSaveRecording) {
                    event.preventDefault()
                    saveRecording()
                  }
                }}
                maxLength={300}
                className={
                  isDark
                    ? 'mt-3 w-full rounded-xl border border-white/15 bg-black/40 px-4 py-3 text-sm text-white outline-none transition placeholder:text-white/25 focus:border-white/35'
                    : 'mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-purple-300'
                }
                placeholder="e.g. Project Alpha or Ticket #4821"
              />
              <span className={isDark ? 'mt-2 block text-[11px] leading-4 text-white/35' : 'mt-2 block text-[11px] leading-4 text-slate-400'}>
                Employee, project, ticket, department, or any label that helps identify this recording.
              </span>
            </label>

            {workflowsError && (
              <p className={isDark ? 'mt-3 text-xs text-amber-300' : 'mt-3 text-xs text-amber-700'}>
                Existing workflows are unavailable. You can still create a new one.
              </p>
            )}

            <div
              className={
                isDark
                  ? 'mt-4 flex flex-wrap justify-end gap-3'
                  : 'save-actions'
              }
            >
              <button
                type="button"
                onClick={() =>
                  void discard()
                }
                className={
                  isDark
                    ? 'rounded-full border border-white/15 bg-white/[0.04] px-5 py-3 text-sm font-black text-white/65 transition hover:bg-white/[0.08] hover:text-white'
                    : 'save-secondary-button'
                }
              >
                Cancel &amp; Discard
              </button>

              <button
                type="button"
                onClick={
                  saveRecording
                }
                disabled={
                  !canSaveRecording
                }
                className={
                  isDark
                    ? 'rounded-full bg-white px-6 py-3 text-sm font-black text-black transition hover:bg-white/85 disabled:cursor-not-allowed disabled:opacity-45'
                    : 'save-primary-button'
                }
              >
                Save Recording
              </button>
            </div>
          </div>
        )}

        {(isRecording ||
          isPaused) && (
          <p
            className={
              isDark
                ? 'mt-5 font-mono text-sm font-bold tracking-[0.18em] text-red-400'
                : 'record-elapsed'
            }
          >
            {elapsed}
          </p>
        )}

        {error && (
          <div
            className={
              isDark
                ? 'mt-5 flex flex-col items-center gap-3'
                : 'recorder-error'
            }
          >
            <p
              className={
                isDark
                  ? 'max-w-lg text-xs leading-5 text-red-400'
                  : ''
              }
            >
              {error}
            </p>

            {permissionError && (
              <button
                type="button"
                onClick={() =>
                  void window.api.recording.openPermissionSettings(
                    permissionType
                  )
                }
                className={
                  isDark
                    ? 'rounded-lg border border-white/15 bg-white/6 px-4 py-2 text-xs font-bold text-white transition hover:bg-white/12'
                    : ''
                }
              >
                Open Privacy Settings
              </button>
            )}
          </div>
        )}

        <div
          className={
            isDark
              ? 'mt-12 flex flex-wrap items-center justify-center gap-4 font-mono text-xs font-semibold tracking-[0.08em] text-white/65 sm:text-sm'
              : 'recorder-footer'
          }
        >
          <span>
            ⌘ Cmd + Shift + R
          </span>

          <span
            className={
              isDark
                ? 'hidden h-5 w-px bg-white/15 sm:block'
                : 'recorder-divider'
            }
          />

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

              <circle
                cx="12"
                cy="12"
                r="2.5"
              />
            </svg>

            Full Desktop Mode
          </span>

          <span
            className={
              isDark
                ? 'hidden h-5 w-px bg-white/15 sm:block'
                : 'recorder-divider'
            }
          />

          <span>
            {audioEnabled
              ? 'Mic Audio On'
              : 'Mic Audio Off'}
          </span>

          {manualMode && (
            <>
              <span
                className={
                  isDark
                    ? 'hidden h-5 w-px bg-white/15 sm:block'
                    : 'recorder-divider'
                }
              />

              <span>
                Generation Paused
              </span>
            </>
          )}
        </div>
      </div>
    </section>
  )
}
