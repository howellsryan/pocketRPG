import { describe, it, expect } from 'vitest'
import { appendChatLines, chatLinesFromCoopEvents, COOP_CHAT_LOG_MAX } from '../src/utils/coopChat.js'

describe('chatLinesFromCoopEvents', () => {
  it('turns a chat event into a line attributed to its speaker', () => {
    const { lines } = chatLinesFromCoopEvents([
      { type: 'chatMessage', characterId: 7, username: 'player7', text: 'pray melee' },
    ])
    expect(lines).toEqual([{ id: 'c0', kind: 'chat', username: 'player7', text: 'pray melee' }])
  })

  it('renders a purple drop as its own kind, so the log can style it apart', () => {
    const { lines } = chatLinesFromCoopEvents([
      { type: 'epicDrop', characterId: 8, username: 'player8', item: 'Onyx', monster: 'Warlord Grondar' },
    ])
    expect(lines[0].kind).toBe('drop')
    expect(lines[0].text).toContain('player8')
    expect(lines[0].text).toContain('Onyx')
    expect(lines[0].text).toContain('Warlord Grondar')
  })

  it('ignores combat events and empty messages', () => {
    const { lines } = chatLinesFromCoopEvents([
      { type: 'hit', characterId: 7, damage: 12 },
      { type: 'chatMessage', characterId: 7, username: 'player7', text: '' },
      { type: 'epicDrop', characterId: 7, username: 'player7' },
      null,
    ] as never)
    expect(lines).toEqual([])
  })

  it('gives two messages on the same tick distinct keys', () => {
    const first = chatLinesFromCoopEvents([
      { type: 'chatMessage', username: 'a', text: 'one' },
      { type: 'chatMessage', username: 'b', text: 'two' },
    ])
    expect(first.lines.map((l) => l.id)).toEqual(['c0', 'c1'])
    const second = chatLinesFromCoopEvents([{ type: 'chatMessage', username: 'a', text: 'three' }], first.nextId)
    expect(second.lines[0].id).toBe('c2')
  })
})

describe('appendChatLines', () => {
  it('keeps the newest lines once the log is full', () => {
    const seed = Array.from({ length: COOP_CHAT_LOG_MAX }, (_, i) => ({ id: `s${i}`, kind: 'chat', username: 'a', text: String(i) }))
    const next = appendChatLines(seed, [{ id: 'new', kind: 'chat', username: 'b', text: 'newest' }])
    expect(next).toHaveLength(COOP_CHAT_LOG_MAX)
    expect(next[next.length - 1].id).toBe('new')
    expect(next[0].id).toBe('s1')
  })

  it('returns the log untouched when there is nothing to add', () => {
    const log = [{ id: 'a', kind: 'chat', username: 'a', text: 'hi' }]
    expect(appendChatLines(log, [])).toBe(log)
  })
})
