import { describe, expect, it } from 'vitest'
import { isViewportTooNarrow, parseHandoffFromHash } from '../client/src/auth'

describe('parseHandoffFromHash', () => {
  it('extracts the token from a #handoff=<jwt> hash', () => {
    expect(parseHandoffFromHash('#handoff=abc.def.ghi')).toBe('abc.def.ghi')
  })

  it('decodes a URL-encoded token', () => {
    expect(parseHandoffFromHash('#handoff=abc%2Edef')).toBe('abc.def')
  })

  it('returns null for an empty hash', () => {
    expect(parseHandoffFromHash('')).toBeNull()
  })

  it('returns null for an unrelated hash', () => {
    expect(parseHandoffFromHash('#something-else')).toBeNull()
  })
})

describe('isViewportTooNarrow', () => {
  it('is true below the 768px threshold on either dimension', () => {
    expect(isViewportTooNarrow(767, 1200)).toBe(true)
    expect(isViewportTooNarrow(1200, 767)).toBe(true)
  })

  it('is false at or above the threshold on both dimensions', () => {
    expect(isViewportTooNarrow(768, 768)).toBe(false)
    expect(isViewportTooNarrow(1920, 1080)).toBe(false)
  })
})
