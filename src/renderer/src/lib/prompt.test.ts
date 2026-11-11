import { describe, expect, it } from 'vitest'
import { chatTurns, groupOpeningHistory, groupTurns, parseMentions, stripSpeakerPrefix, systemPromptFor } from './prompt'
import type { Message, Participant, Session, Settings } from './types'

const alice: Participant = { id: 'a', providerId: 'p', modelId: 'm1', name: 'Claude Opus 5.5', color: '#000' }
const bob: Participant = { id: 'b', providerId: 'p', modelId: 'm2', name: 'GPT', color: '#111' }

let n = 0
const msg = (role: Message['role'], content: string, participantId?: string, extra: Partial<Message> = {}): Message => ({
  id: String(n++),
  role,
  content,
  createdAt: n,
  participantId,
  status: 'done',
  ...extra,
})

const group = (messages: Message[]): Session => ({
  id: 's',
  title: 't',
  kind: 'group',
  participants: [alice, bob],
  messages,
  createdAt: 0,
  updatedAt: 0,
})

const settings = {
  defaultSystemPrompt: '',
  group: { rounds: 1, order: 'sequential', announceRoster: true },
} as unknown as Settings

describe('groupTurns', () => {
  it('keeps prior discussion for independent answers and excludes the latest round’s replies', () => {
    const earlier = [msg('user', 'Choose the core loop'), msg('assistant', 'Prior choice', 'a')]
    const topic = msg('user', 'Design the first decision in combat')
    const beforeAnswers = [...earlier, topic]
    const afterAnswers = [...beforeAnswers, msg('assistant', 'Current peer proposal', 'a')]
    const session = group(afterAnswers)
    expect(groupOpeningHistory(beforeAnswers)).toBe(beforeAnswers)
    expect(groupTurns(session, bob, groupOpeningHistory(afterAnswers))).toEqual([
      { role: 'user', content: '[User]: Choose the core loop\n\n[Claude Opus 5.5]: Prior choice\n\n[User]: Design the first decision in combat' },
    ])
    expect(groupTurns(session, bob, afterAnswers)[0].content).toContain('[Claude Opus 5.5]: Current peer proposal')
  })

  it("labels other speakers and keeps the model's own replies as assistant turns", () => {
    const history = [msg('user', 'Hi all'), msg('assistant', 'Hello from Claude', 'a'), msg('assistant', 'Hello from GPT', 'b')]
    expect(groupTurns(group(history), alice, history)).toEqual([
      { role: 'user', content: '[User]: Hi all' },
      { role: 'assistant', content: 'Hello from Claude' },
      { role: 'user', content: '[GPT]: Hello from GPT' },
    ])
  })

  it('merges consecutive user turns into one', () => {
    const history = [msg('user', 'Question'), msg('assistant', 'First answer', 'a')]
    expect(groupTurns(group(history), bob, history)).toEqual([
      { role: 'user', content: '[User]: Question\n\n[Claude Opus 5.5]: First answer' },
    ])
  })

  it('skips failed and empty replies and ends on a user turn', () => {
    const history = [
      msg('user', 'Go'),
      msg('assistant', 'Mine', 'a'),
      msg('assistant', '', 'b', { status: 'error', error: 'boom' }),
    ]
    const turns = groupTurns(group(history), alice, history)
    expect(turns.at(-1)).toEqual({ role: 'user', content: '[System]: It is your turn again.' })
    expect(turns.some((t) => t.content.includes('boom'))).toBe(false)
  })
})

describe('chatTurns', () => {
  it('maps roles directly and drops refused replies', () => {
    const history = [msg('user', 'q'), msg('assistant', 'partial', 'a', { status: 'refused' }), msg('user', 'q2')]
    expect(chatTurns(history)).toEqual([{ role: 'user', content: 'q\n\nq2' }])
  })
})

describe('systemPromptFor', () => {
  it('adds group instructions with the roster', () => {
    const prompt = systemPromptFor(group([]), alice, settings)!
    expect(prompt).toContain('You are "Claude Opus 5.5"')
    expect(prompt).toContain('The other AI participants are: GPT.')
  })

  it('uses the shared brief, task-specific checks and a different job for proposal and review', () => {
    const session = { ...group([]), systemPrompt: 'Keep encounters under 2 minutes.' }
    const model = { ...alice, systemPrompt: 'Consider accessibility.' }
    const opening = systemPromptFor(session, model, settings, 'opening')
    expect(opening).toContain('Keep encounters under 2 minutes.\n\nConsider accessibility.')
    expect(opening).toContain('give an independent proposal')
    expect(opening).toContain('sources, sinks, time to rewards')
    expect(opening).not.toContain('Your default game design focus')
    const discussion = systemPromptFor(session, model, settings, 'discussion')
    expect(discussion).toContain('same target experience, baseline and constraints')
    expect(discussion).toContain('an observation that would change the choice')
    expect(systemPromptFor({ ...session, kind: 'chat' }, model, settings)).toBe('Keep encounters under 2 minutes.\n\nConsider accessibility.')
  })

  it('assigns distinct default game design focuses by roster position', () => {
    const third = { ...bob, id: 'c', name: 'Grok' }
    const session = { ...group([]), participants: [alice, bob, third] }
    expect(systemPromptFor(session, third, settings, 'opening')).toContain('game design focus is Scope and playtesting')
    expect(systemPromptFor(session, alice, settings, 'opening')).toContain('game design focus is Player experience')
    expect(systemPromptFor(session, bob, settings, 'discussion')).toContain('game design focus is Systems and balance')
  })

  it('deepens single-model advice and gives all comparison panes the same design criteria', () => {
    const session: Session = { ...group([]), kind: 'chat', systemPrompt: 'Target short mobile sessions.' }
    const single = systemPromptFor(session, alice, settings, 'single')
    expect(single).toContain('separate the symptom, the likely rule or incentive causing it')
    expect(single).toContain('Target short mobile sessions.')
    const comparison = systemPromptFor(session, alice, settings, 'comparison')
    expect(comparison).toContain('the same four points')
    expect(comparison).toBe(systemPromptFor({ ...session, participants: [bob] }, bob, settings, 'comparison'))
  })

  it('rotates the approach to a fresh direction without changing the design brief', () => {
    const session: Session = { ...group([]), kind: 'chat', systemPrompt: 'Keep one-touch controls.' }
    const first = systemPromptFor(session, alice, settings, 'single', 1)
    expect(first).toContain('Keep one-touch controls.')
    expect(first).toContain('Earlier model answers are omitted.')
    expect(first).toContain('Move the decision.')
    expect(systemPromptFor(session, alice, settings, 'single', 2)).toContain('Change the incentives.')
    expect(systemPromptFor(session, alice, settings, 'single')).not.toContain('Earlier model answers are omitted.')
  })
})

describe('stripSpeakerPrefix', () => {
  it.each([
    ['[GPT]: Sure', 'Sure'],
    ['GPT: Sure', 'Sure'],
    ['**GPT:** Sure', 'Sure'],
    ['**GPT**: Sure', 'Sure'],
    ['GPTs are great', 'GPTs are great'],
  ])('%s', (input, expected) => {
    expect(stripSpeakerPrefix(input, 'GPT')).toBe(expected)
  })
})

describe('parseMentions', () => {
  it('matches full handles and prefixes of three or more characters', () => {
    expect(parseMentions('@claude-opus-5-5 what do you think?', [alice, bob])).toEqual(['a'])
    expect(parseMentions('@cla and @gpt', [alice, bob]).sort()).toEqual(['a', 'b'])
    expect(parseMentions('@cl hello', [alice, bob])).toEqual([])
  })
})
