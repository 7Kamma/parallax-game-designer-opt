import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import type { HttpRequest } from '../shared/bridge'
import type { KeyStore } from './backend'

const origin = 'https://cursor-sdk.invalid'
let signingIn = false

export async function signInToCursor(providerId: string, keys: KeyStore, openBrowser: (url: string) => Promise<void>): Promise<void> {
  if (typeof providerId !== 'string' || !providerId || providerId.length > 200) throw new Error('Invalid provider ID')
  if (signingIn) throw new Error('Cursor sign-in is already in progress.')
  signingIn = true
  try {
    const { Cursor } = await import('@cursor/sdk')
    const { apiKey } = await Cursor.auth.login({
      websiteUrl: 'https://cursor.com',
      apiKeyName: 'Parallax',
      store: null,
      signal: AbortSignal.timeout(5 * 60_000),
      openBrowser,
    })
    await keys.set(providerId, apiKey, origin)
  } finally {
    signingIn = false
  }
}

const chat = z.object({
  model: z.string().min(1),
  reasoningEffort: z.object({ id: z.string().min(1), value: z.string().min(1) }).optional(),
  messages: z.array(z.object({ role: z.enum(['system', 'user', 'assistant']), content: z.string() })).min(1),
})

export async function cursorResponse(request: HttpRequest, keys: KeyStore, signal: AbortSignal): Promise<Response | undefined> {
  const url = new URL(request.url)
  if (url.origin !== origin) return undefined
  const apiKey = keys.keyFor(request.auth?.providerId ?? '', url)
  const { Agent, Cursor } = await import('@cursor/sdk')
  signal.throwIfAborted()

  if (request.method === 'GET' && url.pathname === '/models') {
    const models = await Cursor.models.list({ apiKey })
    return Response.json({ data: models.map((model) => {
      const effort = model.parameters?.find(({ id, displayName }) => /reasoning|thinking|^effort$/i.test(id) || /reasoning|thinking/i.test(displayName ?? ''))
      return {
        id: model.id,
        name: model.displayName,
        reasoningEffort: effort && {
          parameterId: effort.id,
          options: effort.values.map(({ value, displayName }) => ({ value, label: displayName })),
        },
      }
    }) })
  }
  if (request.method !== 'POST' || url.pathname !== '/chat/completions') {
    return new Response('Unknown Cursor SDK operation', { status: 404 })
  }

  const { model, messages, reasoningEffort } = chat.parse(JSON.parse(request.body ?? 'null'))
  const cwd = await mkdtemp(join(tmpdir(), 'parallax-cursor-'))
  try {
    await using agent = await Agent.create({
      apiKey,
      model: reasoningEffort ? { id: model, params: [reasoningEffort] } : { id: model },
      tools: [],
      local: { cwd, settingSources: [] },
    })
    signal.throwIfAborted()
    const run = await agent.send(`Respond to the conversation below as the next assistant turn. The JSON contains the conversation instructions and history.\n\n${JSON.stringify(messages)}`)
    const cancel = () => { void run.cancel().catch(() => undefined) }
    signal.addEventListener('abort', cancel, { once: true })
    if (signal.aborted) cancel()
    try {
      const result = await run.wait()
      signal.throwIfAborted()
      if (result.status !== 'finished') throw new Error(result.error?.message ?? `Cursor SDK run ${result.status}`)
      const chunk = { choices: [{ delta: { content: result.result ?? '' }, finish_reason: 'stop' }] }
      return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, {
        headers: { 'content-type': 'text/event-stream' },
      })
    } finally {
      signal.removeEventListener('abort', cancel)
    }
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
}
