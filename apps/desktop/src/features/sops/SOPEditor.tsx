import { useEffect, useMemo, useState } from 'react'
import type { BackendSOP, BackendSOPStep } from '../../../shared/recording'
import { useSopEditorStore, type SopDraftContent } from './useSopEditorStore'

interface ScreenshotOption {
  id: string
  sequence: number
}

interface SOPEditorProps {
  sop: BackendSOP
  screenshots: ScreenshotOption[]
  dark: boolean
  onSaved: (sop: BackendSOP) => void
  onClose: () => void
}

function renumber(steps: BackendSOPStep[]) {
  return steps.map((step, index) => ({ ...step, position: index + 1 }))
}

export function SOPEditor({ sop, screenshots, dark, onSaved, onClose }: SOPEditorProps) {
  const draft = useSopEditorStore((state) => state.drafts[sop.id])
  const begin = useSopEditorStore((state) => state.begin)
  const change = useSopEditorStore((state) => state.change)
  const undo = useSopEditorStore((state) => state.undo)
  const redo = useSopEditorStore((state) => state.redo)
  const markSaved = useSopEditorStore((state) => state.markSaved)
  const discard = useSopEditorStore((state) => state.discard)
  const [activeStepId, setActiveStepId] = useState(sop.steps[0]?.id ?? '')
  const [changeSummary, setChangeSummary] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => begin(sop), [begin, sop])

  const activeIndex = useMemo(
    () => draft?.content.steps.findIndex((step) => step.id === activeStepId) ?? -1,
    [activeStepId, draft?.content.steps]
  )
  const activeStep = activeIndex >= 0 ? draft?.content.steps[activeIndex] : null

  const apply = (content: SopDraftContent, historyKey: string) => {
    change(sop.id, content, historyKey)
  }

  const updateStep = (patch: Partial<BackendSOPStep>, historyKey: string) => {
    if (!draft || activeIndex < 0) return
    const steps = draft.content.steps.map((step, index) =>
      index === activeIndex ? { ...step, ...patch } : step
    )
    apply({ ...draft.content, steps }, historyKey)
  }

  const addStep = () => {
    if (!draft) return
    const step: BackendSOPStep = {
      id: crypto.randomUUID(),
      position: draft.content.steps.length + 1,
      title: 'New step',
      instruction: 'Describe what the user should do.',
      warning: null,
      screenshot_reference: null,
      estimated_time_ms: null,
      observed_duration_ms: null,
      decision_branches: []
    }
    apply(
      { ...draft.content, steps: [...draft.content.steps, step] },
      `add-step:${step.id}`
    )
    setActiveStepId(step.id)
  }

  const removeStep = () => {
    if (!draft || activeIndex < 0 || draft.content.steps.length === 1) return
    const remaining = renumber(
      draft.content.steps.filter((step) => step.id !== activeStepId)
    )
    apply({ ...draft.content, steps: remaining }, `remove-step:${activeStepId}`)
    setActiveStepId(remaining[Math.min(activeIndex, remaining.length - 1)].id)
  }

  const moveStep = (direction: -1 | 1) => {
    if (!draft || activeIndex < 0) return
    const destination = activeIndex + direction
    if (destination < 0 || destination >= draft.content.steps.length) return
    const steps = [...draft.content.steps]
    ;[steps[activeIndex], steps[destination]] = [steps[destination], steps[activeIndex]]
    apply({ ...draft.content, steps: renumber(steps) }, `move-step:${activeStepId}`)
  }

  const save = async () => {
    if (!draft || !draft.dirty) return
    if (!draft.content.title.trim()) {
      setError('Give the SOP a title before saving.')
      return
    }
    if (draft.content.steps.some((step) => !step.title.trim() || !step.instruction.trim())) {
      setError('Every step needs a title and instruction.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const updated = await window.api.recording.updateSop(sop.id, {
        expected_revision: draft.baseRevision,
        title: draft.content.title.trim(),
        document: draft.content.document.trim() || null,
        steps: renumber(draft.content.steps),
        change_summary: changeSummary.trim() || null
      })
      markSaved(updated)
      setChangeSummary('')
      onSaved(updated)
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'The draft could not be saved. Reload it and try again.'
      )
    } finally {
      setSaving(false)
    }
  }

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return
      if (event.key.toLowerCase() === 's') {
        event.preventDefault()
        void save()
      } else if (event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (event.shiftKey) redo(sop.id)
        else undo(sop.id)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  })

  if (!draft || !activeStep) return null

  const inputClass = dark
    ? 'w-full rounded-xl border border-white/10 bg-black/35 px-3 py-2.5 text-sm text-white outline-none transition placeholder:text-white/20 focus:border-emerald-400/40'
    : 'w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-purple-300 focus:ring-2 focus:ring-purple-100'
  const labelClass = dark
    ? 'mb-1.5 block font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-white/35'
    : 'mb-1.5 block text-[10px] font-bold uppercase tracking-[0.1em] text-slate-400'

  return (
    <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[300px_minmax(0,1fr)]">
      <aside className={dark ? 'min-h-0 overflow-y-auto rounded-2xl border border-white/10 bg-[#090909] p-3' : 'min-h-0 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-3 shadow-sm'}>
        <div className="flex items-center justify-between gap-2 px-2 pb-3">
          <div>
            <p className={dark ? 'font-mono text-[9px] uppercase tracking-[0.18em] text-emerald-300' : 'text-[10px] font-bold uppercase tracking-[0.1em] text-purple-600'}>Editing draft</p>
            <p className={dark ? 'mt-1 text-xs text-white/35' : 'mt-1 text-xs text-slate-500'}>Revision {draft.baseRevision}</p>
          </div>
          <button type="button" onClick={addStep} className={dark ? 'rounded-lg border border-white/10 px-3 py-2 text-xs font-black text-white/65 hover:bg-white/5' : 'rounded-lg border border-purple-200 px-3 py-2 text-xs font-bold text-purple-700 hover:bg-purple-50'}>+ Step</button>
        </div>
        <div className="space-y-2">
          {draft.content.steps.map((step) => (
            <button
              type="button"
              key={step.id}
              onClick={() => setActiveStepId(step.id)}
              className={[
                'flex w-full items-start gap-3 rounded-xl border p-3 text-left transition',
                step.id === activeStep.id
                  ? dark
                    ? 'border-emerald-400/40 bg-emerald-400/10'
                    : 'border-purple-300 bg-purple-50'
                  : dark
                    ? 'border-white/8 bg-white/[0.02] hover:border-white/15'
                    : 'border-slate-200 hover:border-purple-200'
              ].join(' ')}
            >
              <span className={dark ? 'font-mono text-[10px] text-white/30' : 'text-[10px] font-bold text-slate-400'}>{String(step.position).padStart(2, '0')}</span>
              <span className={dark ? 'line-clamp-2 text-xs font-bold text-white/70' : 'line-clamp-2 text-xs font-bold text-slate-700'}>{step.title}</span>
            </button>
          ))}
        </div>
      </aside>

      <section className={dark ? 'min-h-0 overflow-y-auto rounded-2xl border border-white/10 bg-[#090909]' : 'min-h-0 overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-sm'}>
        <header className={dark ? 'sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b border-white/10 bg-[#090909]/95 px-5 py-3 backdrop-blur' : 'sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-white/95 px-5 py-3 backdrop-blur'}>
          <div className="flex items-center gap-2">
            <button type="button" disabled={!draft.past.length} onClick={() => undo(sop.id)} className={dark ? 'rounded-lg border border-white/10 px-3 py-2 text-xs text-white/55 disabled:opacity-25' : 'rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-600 disabled:opacity-25'}>↶ Undo</button>
            <button type="button" disabled={!draft.future.length} onClick={() => redo(sop.id)} className={dark ? 'rounded-lg border border-white/10 px-3 py-2 text-xs text-white/55 disabled:opacity-25' : 'rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-600 disabled:opacity-25'}>↷ Redo</button>
            {draft.dirty && <span className={dark ? 'font-mono text-[8px] uppercase tracking-[0.14em] text-amber-300/70' : 'text-[10px] font-bold uppercase text-amber-600'}>Unsaved</span>}
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} className={dark ? 'rounded-lg px-3 py-2 text-xs font-bold text-white/45 hover:text-white/75' : 'rounded-lg px-3 py-2 text-xs font-bold text-slate-500 hover:text-slate-800'}>Close</button>
            <button
              type="button"
              onClick={() => {
                discard(sop.id)
                begin(sop)
                setActiveStepId(sop.steps[0].id)
              }}
              disabled={!draft.dirty}
              className={dark ? 'rounded-lg border border-white/10 px-3 py-2 text-xs font-bold text-white/55 disabled:opacity-25' : 'rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600 disabled:opacity-25'}
            >
              Reset
            </button>
            <button type="button" disabled={!draft.dirty || saving} onClick={() => void save()} className={dark ? 'rounded-lg bg-white px-4 py-2 text-xs font-black text-black disabled:opacity-30' : 'rounded-lg bg-purple-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-30'}>{saving ? 'Saving…' : 'Save draft'}</button>
          </div>
        </header>

        <div className="space-y-6 p-5">
          {error && <p className={dark ? 'rounded-xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-xs text-red-300' : 'rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-600'}>{error}</p>}
          <div className="grid gap-4 lg:grid-cols-2">
            <label>
              <span className={labelClass}>SOP title</span>
              <input value={draft.content.title} onChange={(event) => apply({ ...draft.content, title: event.target.value }, 'sop-title')} className={inputClass} />
            </label>
            <label>
              <span className={labelClass}>Save note · optional</span>
              <input value={changeSummary} onChange={(event) => setChangeSummary(event.target.value)} placeholder="What changed?" className={inputClass} />
            </label>
          </div>
          <label>
            <span className={labelClass}>Overview</span>
            <textarea rows={3} value={draft.content.document} onChange={(event) => apply({ ...draft.content, document: event.target.value }, 'sop-document')} className={inputClass} />
          </label>

          <div className={dark ? 'border-t border-white/10 pt-5' : 'border-t border-slate-100 pt-5'}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className={dark ? 'font-mono text-[9px] font-bold uppercase tracking-[0.18em] text-emerald-300' : 'text-[10px] font-bold uppercase tracking-[0.1em] text-purple-600'}>Step {activeStep.position}</p>
                <p className={dark ? 'mt-1 text-xs text-white/35' : 'mt-1 text-xs text-slate-500'}>Edit the instruction and evidence used in the published SOP.</p>
              </div>
              <div className="flex gap-2">
                <button type="button" disabled={activeIndex === 0} onClick={() => moveStep(-1)} className={dark ? 'rounded-lg border border-white/10 px-3 py-2 text-xs text-white/55 disabled:opacity-25' : 'rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-600 disabled:opacity-25'}>↑</button>
                <button type="button" disabled={activeIndex === draft.content.steps.length - 1} onClick={() => moveStep(1)} className={dark ? 'rounded-lg border border-white/10 px-3 py-2 text-xs text-white/55 disabled:opacity-25' : 'rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-600 disabled:opacity-25'}>↓</button>
                <button type="button" disabled={draft.content.steps.length === 1} onClick={removeStep} className={dark ? 'rounded-lg border border-red-400/15 px-3 py-2 text-xs text-red-300/65 disabled:opacity-25' : 'rounded-lg border border-red-200 px-3 py-2 text-xs text-red-600 disabled:opacity-25'}>Delete</button>
              </div>
            </div>
            <div className="mt-5 grid gap-4 lg:grid-cols-2">
              <label>
                <span className={labelClass}>Step title</span>
                <input value={activeStep.title} onChange={(event) => updateStep({ title: event.target.value }, `step-title:${activeStep.id}`)} className={inputClass} />
              </label>
              <label>
                <span className={labelClass}>Screenshot</span>
                <select value={activeStep.screenshot_reference ?? ''} onChange={(event) => updateStep({ screenshot_reference: event.target.value || null }, `screenshot:${activeStep.id}`)} className={inputClass}>
                  <option value="">No screenshot</option>
                  {screenshots.map((item) => <option key={item.id} value={item.id}>Screenshot {item.sequence}</option>)}
                </select>
              </label>
            </div>
            <label className="mt-4 block">
              <span className={labelClass}>Instruction</span>
              <textarea rows={4} value={activeStep.instruction} onChange={(event) => updateStep({ instruction: event.target.value }, `instruction:${activeStep.id}`)} className={inputClass} />
            </label>
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <label>
                <span className={labelClass}>Warning · optional</span>
                <textarea rows={2} value={activeStep.warning ?? ''} onChange={(event) => updateStep({ warning: event.target.value || null }, `warning:${activeStep.id}`)} className={inputClass} />
              </label>
              <label>
                <span className={labelClass}>Estimated seconds · optional</span>
                <input type="number" min="0" value={activeStep.estimated_time_ms === null ? '' : activeStep.estimated_time_ms / 1000} onChange={(event) => updateStep({ estimated_time_ms: event.target.value ? Math.round(Number(event.target.value) * 1000) : null }, `timing:${activeStep.id}`)} className={inputClass} />
              </label>
            </div>

            <div className="mt-5">
              <div className="flex items-center justify-between gap-3">
                <span className={labelClass}>Decision branches</span>
                <button type="button" onClick={() => updateStep({ decision_branches: [...activeStep.decision_branches, { condition: 'If…', action: 'Then…' }] }, `add-branch:${activeStep.id}`)} className={dark ? 'rounded-lg border border-sky-300/15 px-3 py-2 text-xs font-bold text-sky-200/65' : 'rounded-lg border border-sky-200 px-3 py-2 text-xs font-bold text-sky-700'}>+ Branch</button>
              </div>
              <div className="space-y-3">
                {activeStep.decision_branches.map((branch, index) => (
                  <div key={`${activeStep.id}:${index}`} className={dark ? 'grid gap-2 rounded-xl border border-sky-300/10 bg-sky-300/[0.03] p-3 lg:grid-cols-[1fr_1fr_auto]' : 'grid gap-2 rounded-xl border border-sky-100 bg-sky-50/50 p-3 lg:grid-cols-[1fr_1fr_auto]'}>
                    <input value={branch.condition} aria-label={`Branch ${index + 1} condition`} onChange={(event) => updateStep({ decision_branches: activeStep.decision_branches.map((item, itemIndex) => itemIndex === index ? { ...item, condition: event.target.value } : item) }, `branch-condition:${activeStep.id}:${index}`)} className={inputClass} />
                    <input value={branch.action} aria-label={`Branch ${index + 1} action`} onChange={(event) => updateStep({ decision_branches: activeStep.decision_branches.map((item, itemIndex) => itemIndex === index ? { ...item, action: event.target.value } : item) }, `branch-action:${activeStep.id}:${index}`)} className={inputClass} />
                    <button type="button" aria-label={`Delete branch ${index + 1}`} onClick={() => updateStep({ decision_branches: activeStep.decision_branches.filter((_, itemIndex) => itemIndex !== index) }, `remove-branch:${activeStep.id}:${index}`)} className={dark ? 'rounded-lg px-3 text-red-300/55 hover:bg-red-400/10' : 'rounded-lg px-3 text-red-500 hover:bg-red-50'}>×</button>
                  </div>
                ))}
                {!activeStep.decision_branches.length && <p className={dark ? 'text-xs text-white/25' : 'text-xs text-slate-400'}>No conditional branch in this step.</p>}
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
