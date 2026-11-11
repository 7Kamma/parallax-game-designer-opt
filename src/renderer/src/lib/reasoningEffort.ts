import type { ModelInfo, ProviderConfig, ProviderKind, Session } from './types'

type EffortOption = NonNullable<ModelInfo['reasoningEffort']>['options'][number]

export const CLAUDE_EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
export const CLAUDE_ADAPTIVE_FAMILIES = /^claude-(fable|mythos|opus-5|sonnet-5|opus-4-[678]|sonnet-4-6|haiku-5-5)/

export function reasoningEffortOptions(kind: ProviderKind, model: ModelInfo): EffortOption[] {
  if (kind === 'chatgpt') return model.reasoningEffort?.options.filter(({ value }) => value !== 'ultra') ?? []
  if (kind !== 'anthropic' || model.reasoningEffort) return model.reasoningEffort?.options ?? []
  const adaptive = model.adaptiveThinking ?? CLAUDE_ADAPTIVE_FAMILIES.test(model.id)
  if (!(model.effort ?? adaptive)) return []
  const levels = !adaptive ? CLAUDE_EFFORT_LEVELS.slice(0, 3) : CLAUDE_EFFORT_LEVELS.filter((value) => value !== 'xhigh' || !/-4-6/.test(model.id))
  return levels.map((value) => ({ value }))
}

export function widestEffortScale(scales: EffortOption[][]): EffortOption[] {
  return scales.reduce<EffortOption[]>((widest, scale) => scale.length > widest.length ? scale : widest, [])
}

export function conversationEffortOptions(session: Session, providers: ProviderConfig[]): EffortOption[] {
  return widestEffortScale(session.participants.filter((participant) => !participant.muted).map((participant) => {
    const provider = providers.find((entry) => entry.id === participant.providerId && entry.enabled)
    const model = provider?.models.find((entry) => entry.id === participant.modelId) ?? { id: participant.modelId }
    return provider ? reasoningEffortOptions(provider.kind, model) : []
  }))
}

export function mapReasoningEffort(value: string | undefined, from: string[] | undefined, to: string[]): string | undefined {
  if (!value) return value
  if (!from?.length) {
    // Earlier versions stored a provider's native value, including GPT's retired UI choice.
    if (to.includes(value)) return value
    return value === 'ultra' && to.includes('max') ? 'max' : undefined
  }
  const index = from.indexOf(value)
  if (index < 0 || !to.length) return undefined
  if (from.length >= 4 && to.length >= 4 && to.includes(value)) return value
  // Centered buckets make five levels map to three as 1, 1, 2, 3, 3.
  return to[Math.floor((index + 0.5) * to.length / from.length)]
}

export function sessionReasoningEffort(session: Session, to: string[], legacyScale?: string[]): string | undefined {
  const value = session.reasoningEffort ?? session.participants[0]?.reasoningEffort
  const from = session.reasoningEffortScale ?? (value && legacyScale?.includes(value) ? legacyScale : undefined)
  return mapReasoningEffort(value, from, to)
}
