import { describe, expect, it } from 'vitest'
import { rollRaidRewardsById } from '../functions/_lib/game/raidRewards.js'

function seqRandom(values: number[]) {
  let i = 0
  return () => {
    const v = values[i]
    i += 1
    return v ?? 0
  }
}

describe('rollRaidRewardsById', () => {
  it('returns empty for unknown raid id', () => {
    expect(rollRaidRewardsById('not_a_raid', seqRandom([0.1]))).toEqual([])
  })

  it('rolls deterministic always drops with quantity ranges', () => {
    const rewards = rollRaidRewardsById(
      'barrows_brothers',
      // always[0] chance pass, qty pick low edge, later drops fail
      seqRandom([0, 0, 0.999, 0.999, 0.999, 0.999, 0.999, 0.999])
    )
    const coins = rewards.find(r => r.itemId === 'coins')
    expect(coins).toBeTruthy()
    expect(coins?.quantity).toBeGreaterThan(0)
  })

  it('rolls a unique reward when unique chance passes', () => {
    const rewards = rollRaidRewardsById(
      'chambers_of_xeric',
      // fail non-coin always drops, pass unique chance, pick first weighted unique
      seqRandom([0, 0.99, 0.99, 0.99, 0.99, 0.99, 0, 0])
    )
    expect(rewards.some(r => r.itemId === 'warped_buckler')).toBe(true)
  })
})
