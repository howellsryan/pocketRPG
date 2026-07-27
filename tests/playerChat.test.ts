import { describe, it, expect } from 'vitest'
import { CHAT_MAX_CHARS, chatRateVerdict, sanitizeChat } from '../src/engine/playerChat.js'

describe('sanitizeChat', () => {
  it('trims and keeps ordinary text', () => {
    expect(sanitizeChat('  hello there  ')).toBe('hello there')
  })

  it('strips control characters, which is what keeps escape sequences out of the render path', () => {
    expect(sanitizeChat('a\u0000b\u001bc\u007f')).toBe('abc')
  })

  it('returns null for text with nothing displayable left', () => {
    expect(sanitizeChat('   ')).toBeNull()
    expect(sanitizeChat('')).toBeNull()
    expect(sanitizeChat('\u0000\u0007')).toBeNull()
  })

  it('returns null rather than throwing on a non-string', () => {
    expect(sanitizeChat(undefined as never)).toBeNull()
    expect(sanitizeChat(42 as never)).toBeNull()
    expect(sanitizeChat({ text: 'hi' } as never)).toBeNull()
  })

  it('caps the packet at CHAT_MAX_CHARS', () => {
    expect(sanitizeChat('x'.repeat(CHAT_MAX_CHARS + 500))?.length).toBe(CHAT_MAX_CHARS)
  })
})

describe('chatRateVerdict', () => {
  it('allows sends up to the cap inside one window', () => {
    let times: number[] = []
    for (let i = 0; i < 3; i++) {
      const v = chatRateVerdict(times, 1000 + i, 10_000, 3)
      expect(v.allowed).toBe(true)
      times = v.times
    }
    expect(chatRateVerdict(times, 1100, 10_000, 3).allowed).toBe(false)
  })

  it('prunes expired entries even when it refuses, so a speaker is never wedged', () => {
    const refused = chatRateVerdict([0, 1, 2], 5, 10, 3)
    expect(refused.allowed).toBe(false)
    expect(refused.times).toEqual([0, 1, 2])

    const later = chatRateVerdict(refused.times, 100, 10, 3)
    expect(later.allowed).toBe(true)
    expect(later.times).toEqual([100])
  })

  it('treats a missing history as empty', () => {
    expect(chatRateVerdict(undefined as never, 5, 10, 1).allowed).toBe(true)
  })
})
