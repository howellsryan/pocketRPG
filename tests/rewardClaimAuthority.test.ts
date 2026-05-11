import { describe, it, expect } from 'vitest'
import { applyRewardClaim, validateRewardClaimPayload } from '../functions/_lib/game/rewardClaim.js'

describe('reward claim authority helpers', () => {
  it('accepts protected source payload shape', () => {
    const parsed = validateRewardClaimPayload({ sourceType: 'monsters', sourceId: 'abyssal_demon', rewards: [{ itemId: 'abyssal_whip', quantity: 1 }] })
    expect(parsed.sourceType).toBe('monsters')
  })

  it('rejects invalid source type', () => {
    expect(() => validateRewardClaimPayload({ sourceType: 'shop', sourceId: 'store', rewards: [{ itemId: 'coins', quantity: 1 }] })).toThrow(/Invalid source type/)
  })

  it('applies slayer points and dungeoneering tokens', () => {
    const save: any = { inventory: [] }
    const out = applyRewardClaim(save, {
      sourceType: 'monsters',
      sourceId: 'abyssal_demon',
      rewards: [{ itemId: 'abyssal_whip', quantity: 1 }],
      slayerPoints: 15,
      dungeoneeringTokens: 25,
    })
    expect(out.granted.length).toBe(1)
    expect(save.slayer.points).toBe(15)
    expect(save.dungeoneeringTokens).toBe(25)
  })
})
