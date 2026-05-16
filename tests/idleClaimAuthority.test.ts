import { describe, it, expect } from 'vitest'
import { validateIdleClaimWindow, applyIdleClaimRewards } from '../functions/_lib/game/idleClaim.js'
import { getCoinTotal } from '../functions/_lib/game/economy.js'

describe('idle claim authority helpers', () => {
  it('accepts valid idle claim window', () => {
    const elapsed = validateIdleClaimWindow({ lastActiveAt: 1_000, serverNow: 61_000, expectedLastActiveAt: 1_000 })
    expect(elapsed).toBe(60_000)
  })

  it('rejects stale/replayed claim window', () => {
    expect(() => validateIdleClaimWindow({ lastActiveAt: 1_000, serverNow: 10_000, expectedLastActiveAt: 2_000 })).toThrow(/stale/i)
  })

  it('rejects impossible elapsed idle time', () => {
    expect(() => validateIdleClaimWindow({ lastActiveAt: 0, serverNow: (24 * 60 * 60 * 1000) + (6 * 60 * 1000) })).toThrow(/exceeds allowed window/)
  })

  it('applies bounded rewards from elapsed time', () => {
    const save: any = { coins: 0, inventory: [] }
    const out = applyIdleClaimRewards(save, {
      coinsPerHour: 100,
      maxCoins: 50,
      items: [{ itemId: 'coins', perHour: 10, max: 4 }],
    }, 60 * 60 * 1000)

    expect(out.grantedCoins).toBe(50)
    expect(out.grantedItems).toEqual([{ itemId: 'coins', quantity: 4 }])
    expect(getCoinTotal(save)).toBe(54)
  })
})
