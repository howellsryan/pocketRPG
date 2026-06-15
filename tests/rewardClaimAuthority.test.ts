import { describe, it, expect } from 'vitest'
import { applyRewardClaim, validateRewardClaimPayload } from '../functions/_lib/game/rewardClaim.js'

describe('reward claim authority helpers', () => {
  it('accepts protected source payload shape', () => {
    const parsed = validateRewardClaimPayload({ sourceType: 'monsters', sourceId: 'nether_demon', rewards: [{ itemId: 'nether_demon_whip', quantity: 1 }] })
    expect(parsed.sourceType).toBe('monsters')
  })

  it('rejects invalid source type', () => {
    expect(() => validateRewardClaimPayload({ sourceType: 'shop', sourceId: 'store', rewards: [{ itemId: 'coins', quantity: 1 }] })).toThrow(/Invalid source type/)
  })

  it('applies slayer points and dungeoneering tokens', () => {
    const save: any = { inventory: [] }
    const out = applyRewardClaim(save, {
      sourceType: 'monsters',
      sourceId: 'nether_demon',
      rewards: [{ itemId: 'nether_demon_whip', quantity: 1 }],
      slayerPoints: 15,
      dungeoneeringTokens: 25,
    })
    expect(out.granted.length).toBe(1)
    // Slayer points must land at the canonical settings.slayerPoints location
    // the client reads — not a stray top-level slayer.points that gets lost.
    expect(save.settings.slayerPoints).toBe(15)
    expect(save.dungeoneeringTokens).toBe(25)
  })

  it('accepts regular monster drop rewards not present in collection log', () => {
    const save: any = { inventory: [] }
    const out = applyRewardClaim(save, {
      sourceType: 'monsters',
      sourceId: 'field_chicken',
      rewards: [{ itemId: 'raw_chicken', quantity: 1 }],
    })
    expect(out.granted).toEqual([{ itemId: 'raw_chicken', quantity: 1 }])
  })

  it('accepts boss-tagged source type using monster drop table validation', () => {
    const save: any = { inventory: [] }
    const out = applyRewardClaim(save, {
      sourceType: 'boss',
      sourceId: 'king_black_dragon',
      rewards: [{ itemId: 'dragon_bones', quantity: 1 }],
    })
    expect(out.granted).toEqual([{ itemId: 'dragon_bones', quantity: 1 }])
  })
})
