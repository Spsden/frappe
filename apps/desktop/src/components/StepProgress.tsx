import type { BackendRecordingStatus } from '../../shared/recording'

const PIPELINE: BackendRecordingStatus[] = [
  'uploading',
  'validating',
  'transcribing_audio',
  'processing_screenshots',
  'aligning_evidence',
  'generating_sop',
  'sop_failed',
  'ready_for_review',
  'completed'
]

const STEP_LABELS: Record<BackendRecordingStatus, string> = {
  recording: 'Recording',
  uploading: 'Upload',
  validating: 'Validate',
  transcribing_audio: 'Transcribe',
  processing_screenshots: 'Annotate',
  aligning_evidence: 'Align',
  generating_sop: 'SOP',
  sop_failed: 'Retry SOP',
  ready_for_review: 'Review',
  completed: 'Done',
  failed: 'Failed'
}

const FINISHED: ReadonlySet<BackendRecordingStatus> = new Set([
  'ready_for_review',
  'completed'
])

export interface StepProgressProps {
  status: BackendRecordingStatus | 'local'
  failed: boolean
  hasAudio?: boolean
  /** Label to render beside the bar; defaults to the current step label. */
  labelClassName?: string
  barClassName?: string
}

export function StepProgress({
  status,
  failed,
  hasAudio = true,
  labelClassName,
  barClassName
}: StepProgressProps) {
  const steps = PIPELINE.filter((step) => step !== 'transcribing_audio' || hasAudio)
  const currentIndex = status === 'local' ? -1 : steps.indexOf(status)
  const finished = !failed && status !== 'local' && FINISHED.has(status)

  return (
    <div className="flex items-center gap-3">
      <div className={`flex flex-1 gap-1 ${barClassName ?? ''}`}>
        {steps.map((step, index) => {
          const reached = index <= currentIndex
          const isActive = !failed && !finished && index === currentIndex
          const isDone = finished || (!failed && index < currentIndex)
          const barClass = failed
            ? reached
              ? 'bg-red-500/80'
              : 'bg-white/10'
            : isActive
              ? 'animate-pulse bg-amber-400'
              : isDone
                ? 'bg-emerald-400/80'
                : 'bg-white/10'
          return (
            <span
              key={step}
              title={STEP_LABELS[step]}
              className={`h-1.5 flex-1 rounded-full transition-colors ${barClass}`}
            />
          )
        })}
      </div>
      <span className={`shrink-0 font-mono text-[10px] uppercase tracking-[0.14em] text-white/45 ${labelClassName ?? ''}`}>
        {failed ? 'Failed' : status === 'local' ? 'Local' : STEP_LABELS[status]}
      </span>
    </div>
  )
}
