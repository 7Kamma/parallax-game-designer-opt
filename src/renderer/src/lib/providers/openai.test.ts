import { expect, it, vi } from 'vitest'
import { openaiAdapter } from './openai'
import type { ProviderConfig } from '../types'

const fetch = vi.hoisted(() => vi.fn())
vi.mock('../http', () => ({ httpFetch: fetch, isAbortError: () => false }))
vi.mock('../platform', () => ({ runtime: 'desktop' }))

it('uses advertised DeepSeek effort and leaves the default to the server', async () => {
  const provider: ProviderConfig = {
    id: 'deepseek', name: 'DeepSeek', kind: 'openai', baseUrl: 'https://api.deepseek.com/v1',
    enabled: true, requiresKey: true, models: [],
  }
  fetch.mockResolvedValueOnce(Response.json({ data: [
    { id: 'deepseek-flash', effort: { supported_levels: ['low', 'high', 'max'], default_level: 'high' } },
    { id: 'plain' },
  ] }))
  const [model, plain] = await openaiAdapter.listModels(provider)
  expect(model.reasoningEffort?.options.map(({ value }) => value)).toEqual(['low', 'high', 'max'])
  expect(plain.reasoningEffort).toBeUndefined()
  for (const [selection, expected] of [[undefined, undefined], ['max', 'max'], ['xhigh', undefined]]) {
    fetch.mockResolvedValueOnce(new Response('data: [DONE]\n\n'))
    await openaiAdapter.stream({
      provider, model, reasoningEffort: selection, messages: [], temperature: null, maxOutputTokens: 128, signal: new AbortController().signal,
    }, { onText: vi.fn(), onReasoning: vi.fn() })
    expect(JSON.parse(fetch.mock.lastCall![1].body).reasoning_effort).toBe(expected)
  }
})
