import { expect, it } from 'vitest'
import { CLAUDE_EFFORT_LEVELS, mapReasoningEffort, reasoningEffortOptions, widestEffortScale } from './reasoningEffort'

const five = [...CLAUDE_EFFORT_LEVELS]
const deepSeek = ['low', 'high', 'max']
const grok = ['low', 'medium', 'high', 'xhigh']
const options = (values: string[]) => values.map((value) => ({ value }))

it('uses the longest scale and maps five levels onto the DeepSeek and Grok wire values', () => {
  const gpt = reasoningEffortOptions('chatgpt', { id: 'gpt', reasoningEffort: { options: options([...five, 'ultra']) } })
  expect(widestEffortScale([options(deepSeek), gpt, options(grok)])).toEqual(options(five))
  expect(five.map((value) => mapReasoningEffort(value, five, deepSeek))).toEqual(['low', 'low', 'high', 'max', 'max'])
  expect(five.map((value) => mapReasoningEffort(value, five, grok))).toEqual(['low', 'medium', 'high', 'xhigh', 'xhigh'])
  expect(five.map((value) => mapReasoningEffort(value, five, five))).toEqual(five)
  expect(mapReasoningEffort('', five, deepSeek)).toBe('')
  expect(mapReasoningEffort('max', five, [])).toBeUndefined()
})

it('respects Claude capability metadata and preserves saved native choices', () => {
  expect(reasoningEffortOptions('anthropic', { id: 'claude-sonnet-4-6', effort: true }).map(({ value }) => value))
    .toEqual(['low', 'medium', 'high', 'max'])
  expect(reasoningEffortOptions('anthropic', { id: 'claude-opus-5-5', reasoningEffort: { options: options(grok) } })).toEqual(options(grok))
  expect(mapReasoningEffort('ultra', undefined, five)).toBe('max')
  expect(mapReasoningEffort('high', undefined, deepSeek)).toBe('high')
})
