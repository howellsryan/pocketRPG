import { describe, expect, it } from 'vitest'
import { formatCompactCoins } from '../src/utils/formatters.js'

describe('formatCompactCoins', () => {
  it('formats plain amounts under 1k', () => {
    expect(formatCompactCoins(999)).toBe('999')
  })

  it('formats thousands, millions, and billions compactly', () => {
    expect(formatCompactCoins(1_000)).toBe('1k')
    expect(formatCompactCoins(100_000)).toBe('100k')
    expect(formatCompactCoins(1_000_000)).toBe('1M')
    expect(formatCompactCoins(10_000_000)).toBe('10M')
    expect(formatCompactCoins(1_000_000_000)).toBe('1b')
  })

  it('keeps a single decimal only when useful', () => {
    expect(formatCompactCoins(1_500_000)).toBe('1.5M')
    expect(formatCompactCoins(10_000_000)).toBe('10M')
  })
})
