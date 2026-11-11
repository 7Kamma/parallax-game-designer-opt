import { useState } from 'react'
import { Check } from 'lucide-react'
import type { WorkspaceRef } from '../../../shared/bridge'
import { sendPrompt } from '../lib/engine'
import { GAME_DESIGN_BRIEF } from '../lib/prompt'
import { mapReasoningEffort, reasoningEffortOptions, widestEffortScale } from '../lib/reasoningEffort'
import type { ModelRef } from '../lib/types'
import { MAX_PANES, useStore } from '../store'
import { useModelGroups } from './ModelPicker'
import { ReasoningEffortSelect } from './ReasoningEffortSelect'
import { WorkspaceSelect } from './WorkspaceSelect'
import { Button, Dialog, cn, inputClass } from './ui'

const key = (ref: ModelRef) => `${ref.providerId}::${ref.modelId}`

export function NewCompareDialog() {
  const open = useStore((s) => s.newCompareOpen)
  const setOpen = useStore((s) => s.setNewCompareOpen)
  const createSession = useStore((s) => s.createSession)
  const updateSession = useStore((s) => s.updateSession)
  const setPanes = useStore((s) => s.setPanes)
  const openSettings = useStore((s) => s.openSettings)
  const { ready } = useModelGroups()
  const [selected, setSelected] = useState<ModelRef[]>([])
  const [prompt, setPrompt] = useState('')
  const [brief, setBrief] = useState('')
  const [workspace, setWorkspace] = useState<WorkspaceRef>()
  const [effort, setEffort] = useState<{ value: string; scale: string[] }>()
  const effortOptions = widestEffortScale(selected.map((ref) => {
    const group = ready.find(({ provider }) => provider.id === ref.providerId)
    const model = group?.models.find((entry) => entry.id === ref.modelId)
    return group && model ? reasoningEffortOptions(group.provider.kind, model) : []
  }))
  const effortScale = effortOptions.map(({ value }) => value)
  const shownEffort = mapReasoningEffort(effort?.value, effort?.scale, effortScale) ?? ''

  const close = () => {
    setOpen(false)
    setSelected([])
    setPrompt('')
    setBrief('')
    setWorkspace(undefined)
    setEffort(undefined)
  }

  const toggle = (ref: ModelRef) => {
    setSelected((current) =>
      current.some((r) => key(r) === key(ref))
        ? current.filter((r) => key(r) !== key(ref))
        : current.length >= MAX_PANES
          ? current
          : [...current, ref],
    )
  }

  const start = () => {
    const ids = selected.map((ref) => createSession({ kind: 'chat', models: [ref], placement: 'none' }))
    const sharedBrief = brief.trim()
    if (workspace || sharedBrief || (effort && effortScale.length)) {
      for (const id of ids) updateSession(id, {
        systemPrompt: sharedBrief || undefined,
        workspace,
        reasoningEffort: effort && effortScale.length ? shownEffort : undefined,
        reasoningEffortScale: effort && effortScale.length ? effortScale : undefined,
      })
    }
    setPanes(ids)
    if (prompt.trim()) sendPrompt(prompt, ids)
    close()
  }

  return (
    <Dialog open={open} onClose={close} title="Compare models side by side" className="max-w-2xl">
      <div className="flex min-h-0 flex-col gap-4 overflow-y-auto p-5">
        <p className="text-sm text-muted">
          Each model gets its own chat in a separate pane. Whatever you type goes to all of them, and you can compare the replies
          afterwards. Pick up to {MAX_PANES}.
        </p>
        <div className="max-h-[45vh] shrink-0 space-y-3 overflow-y-auto rounded-xl border border-line p-2">
          {ready.length === 0 && (
            <div className="p-4 text-center text-sm text-muted">
              No models available.{' '}
              <button type="button" className="text-accent underline" onClick={() => (close(), openSettings('providers'))}>
                Add an API key
              </button>
            </div>
          )}
          {ready.map(({ provider, models }) => (
            <div key={provider.id}>
              <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-subtle">{provider.name}</div>
              <div className="grid grid-cols-2 gap-1">
                {models.map((model) => {
                  const ref = { providerId: provider.id, modelId: model.id }
                  const on = selected.some((r) => key(r) === key(ref))
                  return (
                    <button
                      key={model.id}
                      type="button"
                      onClick={() => toggle(ref)}
                      className={cn(
                        'flex items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-sm transition-colors',
                        on ? 'border-accent bg-accent-soft' : 'border-transparent hover:bg-hover',
                      )}
                    >
                      <span
                        className={cn(
                          'flex size-4 shrink-0 items-center justify-center rounded border',
                          on ? 'border-accent bg-accent text-accent-fg' : 'border-line',
                        )}
                      >
                        {on && <Check className="size-3" />}
                      </span>
                      <span className="truncate">{model.label ?? model.id}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
        <details className="shrink-0 space-y-2">
          <summary className="cursor-pointer text-xs font-medium text-muted">Shared design brief (optional)</summary>
          <textarea
            aria-label="Shared design brief"
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            placeholder={GAME_DESIGN_BRIEF}
            className={cn(inputClass, 'min-h-24 resize-y')}
          />
          {!brief.trim() && <Button size="sm" onClick={() => setBrief(GAME_DESIGN_BRIEF)}>Use brief template</Button>}
        </details>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-muted">First message (optional)</span>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Ask all of them the same question…"
            className={cn(inputClass, 'min-h-20 resize-y')}
          />
        </label>
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted">{selected.length} selected</span>
          <div className="flex gap-2">
            <WorkspaceSelect value={workspace} onChange={setWorkspace} />
            <ReasoningEffortSelect options={effortOptions} value={shownEffort} onChange={(value) => setEffort({ value, scale: effortScale })} />
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button variant="primary" disabled={selected.length < 2} onClick={start}>
              Open {selected.length || ''} chats
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  )
}
