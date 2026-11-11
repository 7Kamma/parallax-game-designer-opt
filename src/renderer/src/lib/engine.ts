// Runs conversations: sends prompts (to one session or broadcast to many),
// streams replies into the store, and drives group-chat rounds.
import { findModel, flushPersist, providerProblem, useStore } from '../store'
import { isAbortError } from './http'
import { bridge, newId } from './platform'
import { chatTurns, estimateTokens, groupOpeningHistory, groupTurns, parseMentions, stripSpeakerPrefix, systemPromptFor } from './prompt'
import { conversationEffortOptions, reasoningEffortOptions, sessionReasoningEffort } from './reasoningEffort'
import { adapterFor } from './providers'
import { DEMO_COMPARE_PROMPT, DEMO_GROUP_PROMPT } from './providers/demo'
import { DEMO_MODELS, DEMO_PROVIDER_ID } from './providers/presets'
import { ProviderError, type ChatRequest, type ChatResult } from './providers/types'
import type { Message, Participant } from './types'
import { citeWorkspace, retrieveWorkspace } from './workspace'

const controllers = new Map<string, AbortController>()
const store = () => useStore.getState()

export function isRunning(sessionId: string): boolean {
  return controllers.has(sessionId)
}

function begin(sessionId: string): AbortController {
  const controller = new AbortController()
  controllers.set(sessionId, controller)
  store().setRunning(sessionId, true)
  return controller
}

function end(sessionId: string, controller: AbortController) {
  if (controllers.get(sessionId) === controller) {
    controllers.delete(sessionId)
    store().setRunning(sessionId, false)
  }
  flushPersist()
}

export function stop(sessionId: string) {
  controllers.get(sessionId)?.abort()
}

export function stopAll() {
  for (const controller of controllers.values()) controller.abort()
}

/** Sends one prompt to every target session. More than one target makes it a broadcast. */
export function sendPrompt(text: string, sessionIds: string[], { newDesignDirection = false } = {}): void {
  const prompt = text.trim()
  if (!prompt && !newDesignDirection) return
  const state = store()
  const targets = sessionIds.filter((id) => {
    const session = state.sessions[id]
    return session && !controllers.has(id) && (prompt || session.messages.some((message) => message.role === 'user'))
  })
  if (targets.length === 0) return
  const broadcastId = targets.length > 1 ? newId() : undefined
  const designAttempt = newDesignDirection
    ? 1 + Math.max(...targets.map((id) => state.sessions[id].messages.findLast((message) => message.designAttempt)?.designAttempt ?? 0))
    : undefined
  for (const id of targets) {
    if (prompt) {
      state.addMessage(id, { id: newId(), role: 'user', content: prompt, createdAt: Date.now(), broadcastId })
      // Broadcast chats share a prompt, so lead their titles with the model to tell them apart.
      const session = state.sessions[id]
      const prefix = broadcastId ? (session.kind === 'group' ? 'Group' : session.participants[0]?.name) : undefined
      state.autoTitle(id, prompt, prefix)
    }
    void respond(id, { prompt, broadcastId, designAttempt })
  }
}

/** Group chats: one more round without a new user message. */
export function continueGroup(sessionId: string) {
  if (controllers.has(sessionId)) return
  void respond(sessionId, { rounds: 1 })
}

/** Throws away a reply (and everything after it) and asks for it again. */
export function regenerate(sessionId: string, messageId: string) {
  if (controllers.has(sessionId)) return
  const session = store().sessions[sessionId]
  const message = session?.messages.find((m) => m.id === messageId)
  if (!session || !message || message.role !== 'assistant') return
  store().truncateFrom(sessionId, messageId)
  if (session.kind === 'group' && message.participantId) {
    void respond(sessionId, { only: [message.participantId], rounds: 1, broadcastId: message.broadcastId, groupOpening: message.groupOpening, designAttempt: message.designAttempt })
  } else {
    void respond(sessionId, { broadcastId: message.broadcastId, designAttempt: message.designAttempt })
  }
}

/** Replaces a user message (dropping what came after it) and sends the new text. */
export function editAndResend(sessionId: string, messageId: string, text: string) {
  const prompt = text.trim()
  if (!prompt || controllers.has(sessionId)) return
  const session = store().sessions[sessionId]
  const message = session?.messages.find((m) => m.id === messageId)
  if (!session || !message || message.role !== 'user') return
  store().truncateFrom(sessionId, messageId)
  store().addMessage(sessionId, { id: newId(), role: 'user', content: prompt, createdAt: Date.now() })
  void respond(sessionId, { prompt })
}

interface RespondOptions {
  prompt?: string
  broadcastId?: string
  rounds?: number
  only?: string[]
  groupOpening?: boolean
  designAttempt?: number
}

async function respond(sessionId: string, options: RespondOptions) {
  const controller = begin(sessionId)
  try {
    const session = store().sessions[sessionId]
    if (!session) return
    const { broadcastId, designAttempt } = options
    const humanHistory = designAttempt ? session.messages.filter((message) => message.role === 'user') : undefined
    if (session.kind === 'chat') {
      const participant = session.participants[0]
      if (participant) await generate(sessionId, participant, controller.signal, { broadcastId, openingHistory: humanHistory, designAttempt })
      return
    }

    const settings = store().settings.group
    const mentioned = options.only ?? (options.prompt ? parseMentions(options.prompt, session.participants) : [])
    const rounds = designAttempt || (mentioned.length && !options.only) ? 1 : (options.rounds ?? session.rounds ?? settings.rounds)
    const openingHistory = humanHistory ?? (options.groupOpening || (options.prompt && !mentioned.length) ? groupOpeningHistory(session.messages) : undefined)
    for (let round = 0; round < rounds; round++) {
      const current = store().sessions[sessionId]
      if (!current) return
      let speakers = current.participants.filter((p) => !p.muted && (!mentioned.length || mentioned.includes(p.id)))
      if ((current.order ?? settings.order) === 'random') speakers = shuffle(speakers)
      for (const speaker of speakers) {
        if (controller.signal.aborted) return
        await generate(sessionId, speaker, controller.signal, { broadcastId, openingHistory: round === 0 ? openingHistory : undefined, designAttempt })
      }
    }
  } finally {
    end(sessionId, controller)
  }
}

function shuffle<T>(items: T[]): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/** Batches streamed text so the UI re-renders at most every 40 ms. */
class DeltaBuffer {
  private text = ''
  private reasoning = ''
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly sessionId: string,
    private readonly messageId: string,
    private readonly transform?: (content: string) => string,
  ) {}

  push(text: string, reasoning: string) {
    this.text += text
    this.reasoning += reasoning
    if (!this.timer) this.timer = setTimeout(() => this.flush(), 40)
  }

  flush() {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (!this.text && !this.reasoning) return
    store().appendToMessage(this.sessionId, this.messageId, this.text, this.reasoning, this.transform)
    this.text = ''
    this.reasoning = ''
  }
}

function refusalNotice(refusal: NonNullable<ChatResult['refusal']>): string {
  const category = refusal.category ? ` (${refusal.category.replace(/_/g, ' ')})` : ''
  return `The model declined to answer${category}.${refusal.explanation ? ` ${refusal.explanation}` : ''}`
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message || err.name
  return String(err)
}

interface GenerateContext {
  broadcastId?: string
  openingHistory?: Message[]
  designAttempt?: number
}

async function generate(sessionId: string, participant: Participant, signal: AbortSignal, { broadcastId, openingHistory, designAttempt }: GenerateContext) {
  const state = store()
  const session = state.sessions[sessionId]
  if (!session) return
  const provider = state.providers.find((p) => p.id === participant.providerId)
  const history = openingHistory ?? session.messages
  const messageId = newId()
  state.addMessage(sessionId, {
    id: messageId,
    role: 'assistant',
    content: '',
    createdAt: Date.now(),
    participantId: participant.id,
    groupOpening: session.kind === 'group' && openingHistory ? true : undefined,
    designAttempt,
    model: { providerId: participant.providerId, modelId: participant.modelId, label: participant.name },
    status: 'streaming',
    broadcastId,
  })

  const problem = providerProblem(state, provider)
  if (problem || !provider) {
    store().patchMessage(sessionId, messageId, { status: 'error', error: problem ?? 'Unknown provider.' })
    return
  }

  const group = session.kind === 'group'
  const mode = group ? (openingHistory ? 'opening' : 'discussion') : (broadcastId ? 'comparison' : 'single')
  const buffer = new DeltaBuffer(sessionId, messageId, group ? (s) => stripSpeakerPrefix(s, participant.name) : undefined)
  const started = performance.now()
  let firstTokenMs: number | undefined
  let evidence: Parameters<typeof citeWorkspace>[1] = []
  const markFirst = () => {
    if (firstTokenMs === undefined) firstTokenMs = performance.now() - started
  }

  try {
    const model = findModel(provider, participant.modelId)
    const legacyGroupScale = group && session.reasoningEffort && !session.reasoningEffortScale
      ? conversationEffortOptions(session, state.providers).map(({ value }) => value)
      : undefined
    const adapter = adapterFor(provider.kind)
    let request: ChatRequest = {
      provider,
      model,
      reasoningEffort: sessionReasoningEffort(session, reasoningEffortOptions(provider.kind, model).map(({ value }) => value), legacyGroupScale),
      system: systemPromptFor(session, participant, state.settings, mode, designAttempt),
      messages: group ? groupTurns(session, participant, history) : chatTurns(history),
      temperature: state.settings.temperature,
      maxOutputTokens: state.settings.maxOutputTokens,
      signal,
    }
    let workspaceNotice: string | undefined
    if (session.workspace && bridge?.workspace && provider.kind !== 'demo') {
      store().patchMessage(sessionId, messageId, { notice: 'Searching workspace…' })
      const research = await retrieveWorkspace(adapter, request, session.workspace, history.findLast((m) => m.role === 'user')?.content ?? '', session.systemPrompt)
      request = research.request
      evidence = research.evidence
      workspaceNotice = research.notice
      store().patchMessage(sessionId, messageId, { notice: undefined })
    }
    const result = await adapter.stream(
      request,
      {
        onText: (delta) => {
          markFirst()
          buffer.push(delta, '')
        },
        onReasoning: (delta) => {
          markFirst()
          buffer.push('', delta)
        },
      },
    )
    buffer.flush()
    const totalMs = performance.now() - started
    store().patchMessage(sessionId, messageId, (m) => ({
      ...citeWorkspace(m.content, result.refusal ? [] : evidence),
      status: result.refusal ? 'refused' : 'done',
      notice: [result.refusal ? refusalNotice(result.refusal) : result.notice ?? (designAttempt ? 'New direction' : undefined), workspaceNotice].filter(Boolean).join(' · ') || undefined,
      metrics: {
        firstTokenMs,
        totalMs,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens ?? estimateTokens(m.content),
        servedBy: result.servedBy,
      },
    }))
  } catch (err) {
    buffer.flush()
    const totalMs = performance.now() - started
    if (signal.aborted || isAbortError(err)) {
      store().patchMessage(sessionId, messageId, (m) => ({
        ...citeWorkspace(m.content, m.content ? evidence : []), status: 'stopped', notice: undefined, metrics: { firstTokenMs, totalMs },
      }))
    } else {
      console.error(err)
      store().patchMessage(sessionId, messageId, {
        status: 'error',
        notice: undefined,
        error: describeError(err),
        errorCode: err instanceof ProviderError ? err.code : undefined,
        metrics: { firstTokenMs, totalMs },
      })
    }
  }
}

/** Opens a ready-made demo that needs no API key. */
export function startDemo(kind: 'compare' | 'group') {
  const state = store()
  state.updateFeatures({ demoProvider: true, splitView: true, broadcast: true, compare: true, groupChat: true })
  const refs = DEMO_MODELS.map((m) => ({ providerId: DEMO_PROVIDER_ID, modelId: m.id }))
  if (kind === 'compare') {
    const ids = refs.map((ref) => store().createSession({ kind: 'chat', models: [ref], placement: 'none' }))
    store().setPanes(ids)
    sendPrompt(DEMO_COMPARE_PROMPT, ids)
  } else {
    const id = store().createSession({ kind: 'group', models: refs, placement: 'none' })
    store().updateSession(id, { rounds: 2 })
    store().setPanes([id])
    sendPrompt(DEMO_GROUP_PROMPT, [id])
  }
}
