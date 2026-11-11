import { expect, it, vi } from 'vitest'
import type { KeyStore } from './backend'
import { cursorResponse, signInToCursor } from './cursor'

const sdk = vi.hoisted(() => ({ create: vi.fn(), login: vi.fn(), list: vi.fn() }))
vi.mock('@cursor/sdk', () => ({ Agent: { create: sdk.create }, Cursor: { auth: { login: sdk.login }, models: { list: sdk.list } } }))

it('uses SDK browser authorization and saves the key only through the host key store', async () => {
  sdk.login.mockResolvedValue({ apiKey: 'test-key' })
  const set = vi.fn()
  const openBrowser = vi.fn()
  await expect(signInToCursor('cursor', { set } as unknown as KeyStore, openBrowser)).resolves.toBeUndefined()
  expect(sdk.login).toHaveBeenCalledWith(expect.objectContaining({ openBrowser, store: null, apiKeyName: 'Parallax' }))
  expect(set).toHaveBeenCalledWith('cursor', 'test-key', 'https://cursor-sdk.invalid')
})

it('exposes only the thinking levels declared by the Cursor catalog', async () => {
  const keyFor = vi.fn(() => 'test-key')
  sdk.list.mockResolvedValue([
    { id: 'grok-4.7', parameters: [{ id: 'reasoning_effort', values: [{ value: 'high', displayName: 'High' }] }] },
    { id: 'plain', parameters: [{ id: 'fast', values: [{ value: 'true' }] }] },
  ])
  const response = await cursorResponse({
    id: 'test', url: 'https://cursor-sdk.invalid/models', method: 'GET', headers: {},
  }, { keyFor } as unknown as KeyStore, new AbortController().signal)
  expect(await response?.json()).toEqual({ data: [
    { id: 'grok-4.7', reasoningEffort: { parameterId: 'reasoning_effort', options: [{ value: 'high', label: 'High' }] } },
    { id: 'plain' },
  ] })
})

it.each([undefined, { id: 'reasoning_effort', value: 'high' }])('uses an origin-bound key, disabled tools and effort %j', async (effort) => {
  sdk.create.mockClear()
  const keyFor = vi.fn(() => 'test-key')
  const send = vi.fn(async () => ({ wait: async () => ({ status: 'finished', result: 'hello' }) }))
  sdk.create.mockResolvedValue({ send, [Symbol.asyncDispose]: async () => undefined })
  const url = 'https://cursor-sdk.invalid/chat/completions'
  const response = await cursorResponse({
    id: 'test', url, method: 'POST', headers: {},
    auth: { providerId: 'cursor', header: 'authorization' },
    body: JSON.stringify({ model: 'grok-4.7', reasoningEffort: effort, messages: [{ role: 'system', content: 'Answer briefly.' }, { role: 'user', content: 'hi' }] }),
  }, { keyFor } as unknown as KeyStore, new AbortController().signal)
  expect(keyFor).toHaveBeenCalledWith('cursor', new URL(url))
  expect(sdk.create).toHaveBeenCalledWith(expect.objectContaining({
    apiKey: 'test-key', model: effort ? { id: 'grok-4.7', params: [effort] } : { id: 'grok-4.7' }, tools: [],
    local: { cwd: expect.any(String), settingSources: [] },
  }))
  expect(sdk.create.mock.calls[0][0]).not.toHaveProperty('systemPrompt')
  expect(send).toHaveBeenCalledWith(expect.stringContaining('{"role":"system","content":"Answer briefly."}'))
  expect(await response?.text()).toContain('"content":"hello"')
})
