import { expect, it, vi } from 'vitest'
import { chatgptAdapter } from './chatgpt'
import type { ProviderConfig } from '../types'

const fetch = vi.hoisted(() => vi.fn())
vi.mock('../http', () => ({ httpFetch: fetch, isAbortError: () => false }))
vi.mock('../platform', () => ({ bridge: { chatgpt: { apiBase: async () => 'https://api.openai.com/v1' } } }))

it('uses the plan model catalog and sends only explicitly selected effort', async () => {
  const provider: ProviderConfig = {
    id: 'plan', name: 'ChatGPT plan', kind: 'chatgpt', baseUrl: '', enabled: true, requiresKey: false, models: [], thinking: false,
  }
  fetch.mockResolvedValueOnce(Response.json({ models: [
    { slug: 'reasoner', supported_reasoning_levels: [{ effort: 'high' }, { effort: 'ultra' }] },
    { slug: 'plain' },
  ] }))
  const [model, plain] = await chatgptAdapter.listModels(provider)
  expect(model.reasoningEffort?.options).toEqual([{ value: 'high' }, { value: 'ultra' }])
  expect(plain.reasoningEffort).toBeUndefined()
  for (const effort of [undefined, 'ultra']) {
    fetch.mockResolvedValueOnce(new Response('data: {"type":"response.completed"}\n\n'))
    await chatgptAdapter.stream({
      provider, model, reasoningEffort: effort, messages: [], temperature: null, maxOutputTokens: 128, signal: new AbortController().signal,
    }, { onText: vi.fn(), onReasoning: vi.fn() })
    expect(JSON.parse(fetch.mock.lastCall![1].body).reasoning).toEqual(effort ? { effort } : undefined)
  }
})
