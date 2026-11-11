// Turns a session's history into the message list one model should see.
import type { ChatTurn } from './providers/types'
import type { GroupSettings, Message, Participant, Session, Settings } from './types'

const usable = (m: Message) => m.content.trim().length > 0 && m.status !== 'error' && m.status !== 'refused'

/** The settings a system prompt depends on (the plugin passes just these). */
export type PromptSettings = Pick<Settings, 'defaultSystemPrompt'> & { group: Pick<GroupSettings, 'announceRoster'> }

export const GAME_DESIGN_BRIEF = [
  '目标玩家与游玩场景：',
  '希望玩家体验到什么：',
  '现有玩法与已确认的设计决定：',
  '平台、内容或制作成本约束：',
  '已有试玩证据与关键未知：',
].join('\n')

const GAME_DESIGN_FOCUSES = [
  {
    label: 'Player experience',
    guidance: 'Start from what the target player should feel. Walk through a concrete play moment: the cue they notice, their options, the decision and its feedback. Explain how your rule changes that experience.',
  },
  {
    label: 'Systems and balance',
    guidance: 'Trace the rule through incentives and repeated play. Look for a dominant strategy, a reward loop or an interaction with an existing system that could defeat the intended choice. Identify what can actually be tuned.',
  },
  {
    label: 'Scope and playtesting',
    guidance: 'Compare reuse of existing rules or assets with the work new content would require. Identify the riskiest prediction and the smallest playable or paper prototype that can disprove it. Say what behavior to watch for.',
  },
  {
    label: 'Learning and readability',
    guidance: 'Consider how first-time and experienced players would read the same situation. Look for a hidden rule, ambiguous cue or punishment a player cannot diagnose. Propose a way to teach it through play.',
  },
  {
    label: 'Content and pacing',
    guidance: 'Consider where the idea fits in the sequence of play. Look at setup, escalation, payoff and repetition. Show what one encounter, level or story beat would do differently.',
  },
]

export function gameDesignFocusFor(session: Session, participant: Participant) {
  if (session.kind !== 'group' || participant.systemPrompt?.trim()) return undefined
  const index = session.participants.findIndex((entry) => entry.id === participant.id)
  return index < 0 ? undefined : GAME_DESIGN_FOCUSES[index % GAME_DESIGN_FOCUSES.length]
}

const GAME_DESIGN_BY_MODE = {
  single: 'For game design consultation, answer the decision at hand. If the user is diagnosing a problem, separate the symptom, the likely rule or incentive causing it, and the evidence needed to distinguish causes. If proposing a change, trace rule to player behavior to experience and compare the most meaningful alternative. When a recommendation depends on a prediction, give the smallest test and the observation that would make you change it.',
  comparison: 'For side-by-side game design comparison, develop your answer independently. Unless the human requests a different format, make the options comparable using the same four points: rule change from baseline, predicted player behavior and experience, biggest cost or failure risk, and a small test with an observation that would change the recommendation. Clearly identify any assumption you had to supply.',
  opening: 'For an opening game design round, give an independent proposal. State the target experience and the concrete change from the current design or a simple baseline. Explain how the rule changes player behavior and why that behavior serves the target experience. Name a meaningful alternative and the trade-off when the decision warrants it.',
  discussion: 'For a game design discussion, compare concrete proposals against the same target experience, baseline and constraints. Surface any difference in the assumed player or play conditions before judging the trade-off. Identify the specific player behavior or implementation cost the proposals predict differently. When asked to converge, recommend an option, retain the strongest unresolved objection, and propose the smallest test with a shared baseline and an observation that would change the choice.',
} as const

const GAME_DESIGN_DIRECTIONS = [
  'Move the decision. Change what the player knows, when they must commit, or which action they must give up. Show a playable moment where the new decision leads to different behavior.',
  'Change the incentives. Start with what a player would repeat to win or save effort. Change one reward, cost or recovery rule so a different strategy becomes attractive, then check for a new dominant strategy.',
  'Transfer a decision from another genre or activity. Identify what makes the original decision interesting and rebuild it using the controls, fiction and constraints of this game.',
  'Subtract an assumed rule, resource or feature. See whether the remaining rules can create the intended tension through a more surprising interaction and a smaller prototype.',
]

export function systemPromptFor(
  session: Session,
  participant: Participant,
  settings: PromptSettings,
  mode?: keyof typeof GAME_DESIGN_BY_MODE,
  designAttempt?: number,
): string | undefined {
  const parts = [
    (session.systemPrompt ?? '').trim() || settings.defaultSystemPrompt.trim(),
    (participant.systemPrompt ?? '').trim(),
  ].filter(Boolean)
  if (session.kind === 'group') parts.push(groupInstructions(session, participant, settings.group.announceRoster))
  if (mode) {
    parts.push(
      'Use the following guidance when the human is working on game design. Follow their latest request, design brief and confirmed decisions. Treat suggestions as proposals, and distinguish observations, predictions and assumptions. Reply in the human’s language unless asked otherwise.',
      GAME_DESIGN_BY_MODE[mode],
      'For open-ended ideation, explore meaningfully different mechanisms before choosing what to present. A promising idea changes what the player can notice, choose or risk. Give enough of a play example to show the difference. Scale the breadth to what the human asked.',
      'Use the checks relevant to the question. For combat or a mechanic, examine cues, decision windows, counterplay and failure recovery. For progression or an economy, trace sources, sinks, time to rewards and repeatable incentives. For a level, examine what the player learns, where the challenge tests it and how variants change the decision. For narrative or UI, examine what players know at the decision point and how presentation changes their reading. Choose only the checks that affect the decision and keep the reply focused.',
    )
    const focus = gameDesignFocusFor(session, participant)
    if (focus) parts.push(`Your default game design focus is ${focus.label}. ${focus.guidance} Use it where it helps answer the question.`)
    if (designAttempt) {
      parts.push(
        'The human chose to explore a fresh direction. Earlier model answers are omitted. Reconstruct the design question from the human’s messages, respecting their latest corrections and confirmed constraints. If an essential reference is missing, state the assumption you need to make.',
        GAME_DESIGN_DIRECTIONS[(designAttempt - 1) % GAME_DESIGN_DIRECTIONS.length],
        'Offer a concrete alternative whose novelty comes from a different decision or interaction. Show one play moment, the trade-off introduced, and the quickest way to see whether it works.',
      )
    }
  }
  return parts.length ? parts.join('\n\n') : undefined
}

/** Keep prior discussion and the latest human prompt, excluding replies from its opening round. */
export function groupOpeningHistory(messages: Message[]): Message[] {
  const latestUser = messages.findLastIndex((message) => message.role === 'user')
  return latestUser >= 0 && latestUser < messages.length - 1 ? messages.slice(0, latestUser + 1) : messages
}

function groupInstructions(session: Session, me: Participant, announceRoster: boolean): string {
  const others = session.participants.filter((p) => p.id !== me.id && !p.muted).map((p) => p.name)
  const roster = announceRoster && others.length ? ` The other AI participants are: ${others.join(', ')}.` : ''
  return (
    `You are "${me.name}", one of several AI assistants in a group chat with a human user.${roster} ` +
    'Messages from everyone else start with the speaker\'s name in square brackets, for example "[User]: ...". ' +
    `Reply only as ${me.name}, without a name prefix, and never write lines for the other participants. ` +
    'Build on, question or disagree with what the others said. Keep replies focused and conversational.'
  )
}

/** A one-on-one chat: history maps directly onto user and assistant turns. */
export function chatTurns(messages: Message[]): ChatTurn[] {
  return normalize(
    messages.filter(usable).map((m) => ({ role: m.role, content: m.content })),
    { opening: '(The conversation starts here.)', nudge: 'Please continue.' },
  )
}

/**
 * A group chat from one participant's point of view: its own replies are
 * assistant turns, and everything said by the user or other models becomes
 * user turns labelled with the speaker's name.
 */
export function groupTurns(session: Session, me: Participant, messages: Message[]): ChatTurn[] {
  const names = new Map(session.participants.map((p) => [p.id, p.name]))
  const turns = messages.filter(usable).map((m): ChatTurn => {
    if (m.role === 'assistant' && m.participantId === me.id) return { role: 'assistant', content: m.content }
    const speaker = m.role === 'user' ? 'User' : (names.get(m.participantId ?? '') ?? m.model?.label ?? 'Assistant')
    return { role: 'user', content: `[${speaker}]: ${m.content}` }
  })
  return normalize(turns, { opening: '[System]: The conversation starts here.', nudge: '[System]: It is your turn again.' })
}

/** Merges consecutive same-role turns and makes the list start and end with a user turn. */
function normalize(turns: ChatTurn[], fillers: { opening: string; nudge: string }): ChatTurn[] {
  const out: ChatTurn[] = []
  for (const turn of turns) {
    const last = out[out.length - 1]
    if (last && last.role === turn.role) last.content += `\n\n${turn.content}`
    else out.push({ ...turn })
  }
  if (out.length && out[0].role === 'assistant') out.unshift({ role: 'user', content: fillers.opening })
  if (out.length && out[out.length - 1].role === 'assistant') out.push({ role: 'user', content: fillers.nudge })
  return out
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Removes a leading "[Name]:" or "**Name:**" that models sometimes copy from the transcript. */
export function stripSpeakerPrefix(text: string, name: string): string {
  const pattern = new RegExp(`^\\s*(?:\\*\\*)?\\[?${escapeRegExp(name)}\\]?(?:\\*\\*)?\\s*:(?:\\*\\*)?[ \\t]*`, 'i')
  return text.replace(pattern, '')
}

export function handleFor(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** Participants addressed with @handle in a message. A handle prefix of 3+ characters matches. */
export function parseMentions(text: string, participants: Participant[]): string[] {
  const ids = new Set<string>()
  for (const match of text.matchAll(/@([\w.-]+)/g)) {
    const wanted = handleFor(match[1])
    if (!wanted) continue
    for (const p of participants) {
      const handle = handleFor(p.name)
      if (handle === wanted || (wanted.length >= 3 && handle.startsWith(wanted))) ids.add(p.id)
    }
  }
  return [...ids]
}

export function autoTitle(text: string): string {
  const line = text.trim().split('\n')[0].replace(/\s+/g, ' ')
  return line.length > 52 ? `${line.slice(0, 51)}…` : line || 'New chat'
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}
