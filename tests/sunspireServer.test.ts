import { describe, expect, it } from 'vitest'
import { rollSunspireWaveReward } from '../src/engine/sunspireRewards.js'
import { resolveRaidCompletionRewards } from '../functions/api/actions/raid/complete.js'

describe('server-owned Sunspire reward rolls', () => {
  it('allows retained endgame uniques from the new wave one', () => {
    const high = (() => {
      const values = [0, 0.999999]
      return () => values.shift() ?? 0.999999
    })()
    expect(rollSunspireWaveReward({ wave: 1, random: high, obtainedIds: new Set(), stagedRewards: [] })
      .some((r: any) => r.itemId === 'twinflare_chakrams')).toBe(true)
  })

  it('finishes the Zealot set before armour duplicates', () => {
    const obtained = new Set(['sunbound_zealot_helm', 'sunbound_zealot_cuirass'])
    const rewards = rollSunspireWaveReward({
      wave: 1,
      random: () => 0,
      obtainedIds: obtained,
      stagedRewards: [],
    })
    const armour = rewards.find((r: any) => r.itemId.startsWith('sunbound_zealot_'))
    expect(armour?.itemId).toBe('sunbound_zealot_greaves')
  })

  it('guarantees the headline Quiver on first wave-six clear and substitutes a repeat reward later', () => {
    const first = rollSunspireWaveReward({ wave: 6, random: () => 0.99, obtainedIds: new Set(), stagedRewards: [] })
    expect(first.some((r: any) => r.itemId === 'sunweaver_quiver')).toBe(true)

    const repeat = rollSunspireWaveReward({
      wave: 6,
      random: () => 0.99,
      obtainedIds: new Set(['sunweaver_quiver']),
      stagedRewards: [],
    })
    expect(repeat.some((r: any) => r.itemId === 'sunweaver_quiver')).toBe(false)
    expect(repeat.find((r: any) => r.itemId === 'sunshards')?.quantity).toBeGreaterThanOrEqual(500)
  })

  it('ignores client-authored reward-shaped fields completely', () => {
    const base = {
      wave: 1,
      random: () => 0.5,
      obtainedIds: new Set<string>(),
      stagedRewards: [],
    }
    const clean = rollSunspireWaveReward(base)
    const hostile = rollSunspireWaveReward({
      ...base,
      reward: { itemId: 'twinflare_chakrams', quantity: 999 },
    } as any)
    expect(hostile).toEqual(clean)
    expect(hostile.some((r: any) => r.itemId === 'twinflare_chakrams')).toBe(false)
  })

  it('settles a valid solo cash-out through the normal raid resolver without trusting client reward fields', async () => {
    const rewards = await resolveRaidCompletionRewards({
      sourceId: 'sunspire_colosseum',
      body: { wave: 1, rewards: [{ itemId: 'twinflare_chakrams', quantity: 999 }] },
      env: {},
      characterId: 7,
      isGrindman: false,
    } as any)
    expect(rewards.some((r: any) => r.itemId === 'sunshards')).toBe(true)
    expect(rewards.some((r: any) => r.itemId === 'coins')).toBe(true)
    expect(rewards.some((r: any) => r.itemId === 'twinflare_chakrams')).toBe(false)
  })

  it('rejects a Sunspire cash-out when no valid cleared-wave depth is supplied', async () => {
    await expect(resolveRaidCompletionRewards({
      sourceId: 'sunspire_colosseum',
      body: {},
      env: {},
      characterId: 7,
      isGrindman: false,
    } as any)).rejects.toMatchObject({ code: 'INVALID_SUNSPIRE_WAVE', status: 400 })

    await expect(resolveRaidCompletionRewards({
      sourceId: 'sunspire_colosseum',
      body: { wave: 7 },
      env: {},
      characterId: 7,
      isGrindman: false,
    } as any)).rejects.toMatchObject({ code: 'INVALID_SUNSPIRE_WAVE', status: 400 })
  })
})
