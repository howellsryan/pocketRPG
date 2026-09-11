import { describe, expect, it } from 'vitest'
import {
  clearSunspireRunState,
  chooseSunspireModifier,
  forfeitSunspireRunState,
  prepareSunspireClaim,
  rollSunspireWaveReward,
} from '../functions/_lib/game/sunspireRun.js'

const baseRun = (wave = 1): any => ({
  id: 'run-1',
  status: 'active',
  current_wave: wave,
  cleared_wave: wave - 1,
  chest: [],
  staged: [],
  modifierState: {},
  offers: [],
})

describe('server-owned Sunspire rewards', () => {
  it('does not roll uniques before wave four even with a zero RNG', () => {
    const rewards = rollSunspireWaveReward({ wave: 3, random: () => 0, obtainedIds: new Set(), stagedRewards: [] })
    expect(rewards.some((r: any) => r.itemId === 'resonance_crystal')).toBe(false)
    expect(rewards.some((r: any) => r.itemId === 'twinflare_chakrams')).toBe(false)
  })

  it('never grants Twinflare before wave seven and allows it from wave seven', () => {
    const zero = () => 0
    const high = (() => {
      const values = [0, 0.999999]
      return () => values.shift() ?? 0.999999
    })()
    expect(rollSunspireWaveReward({ wave: 6, random: zero, obtainedIds: new Set(), stagedRewards: [] })
      .some((r: any) => r.itemId === 'twinflare_chakrams')).toBe(false)
    expect(rollSunspireWaveReward({ wave: 7, random: high, obtainedIds: new Set(), stagedRewards: [] })
      .some((r: any) => r.itemId === 'twinflare_chakrams')).toBe(true)
  })

  it('finishes the Zealot set before armour duplicates', () => {
    const obtained = new Set(['sunbound_zealot_helm', 'sunbound_zealot_cuirass'])
    const staged: any[] = []
    const zero = () => 0
    const rewards = rollSunspireWaveReward({ wave: 7, random: zero, obtainedIds: obtained, stagedRewards: staged })
    const armour = rewards.find((r: any) => r.itemId.startsWith('sunbound_zealot_'))
    expect(armour?.itemId).toBe('sunbound_zealot_greaves')
  })

  it('guarantees the headline Quiver on first wave-twelve clear and substitutes a repeat reward later', () => {
    const first = rollSunspireWaveReward({ wave: 12, random: () => 0.99, obtainedIds: new Set(), stagedRewards: [] })
    expect(first.some((r: any) => r.itemId === 'sunweaver_quiver')).toBe(true)

    const repeat = rollSunspireWaveReward({
      wave: 12, random: () => 0.99, obtainedIds: new Set(['sunweaver_quiver']), stagedRewards: [],
    })
    expect(repeat.some((r: any) => r.itemId === 'sunweaver_quiver')).toBe(false)
    expect(repeat.find((r: any) => r.itemId === 'sunshards')?.quantity).toBeGreaterThanOrEqual(500)
  })

  it('ignores client-authored reward fields and stages only the server roll', () => {
    const run = baseRun(1)
    const next = clearSunspireRunState(run, {
      random: () => 0.5,
      obtainedIds: new Set(),
      // Deliberately hostile extra field: the transition API has no reward input.
      reward: { itemId: 'twinflare_chakrams', quantity: 999 },
    } as any)
    expect(next.chest.some((r: any) => r.itemId === 'twinflare_chakrams')).toBe(false)
    expect(next.status).toBe('decision')
    expect(next.cleared_wave).toBe(1)
  })
})

describe('Sunspire run transitions', () => {
  it('requires a modifier offered by the server and raises tiers persistently', () => {
    const run: any = { ...baseRun(2), status: 'decision', cleared_wave: 1, offers: ['profanation', 'withering', 'deathmark'] }
    const next = chooseSunspireModifier(run, 'profanation')
    expect(next.modifierState.profanation).toBe(1)
    expect(next.current_wave).toBe(2)
    expect(next.status).toBe('active')
    expect(() => chooseSunspireModifier(run, 'not_offered')).toThrow(/offer/i)
  })

  it('prepares one immutable settlement and reuses it on a retry', () => {
    const decision: any = { ...baseRun(4), status: 'decision', cleared_wave: 4, chest: [{ itemId: 'sunshards', quantity: 40 }] }
    const first = prepareSunspireClaim(decision, 'nonce-1')
    const replay = prepareSunspireClaim(first, 'nonce-2')
    expect(first.status).toBe('settling')
    expect(replay.settlement).toEqual(first.settlement)
    expect(replay.claim_nonce).toBe('nonce-1')
  })

  it('forfeits every unclaimed staged reward on death or abandon', () => {
    const active: any = {
      ...baseRun(5), chest: [{ itemId: 'resonance_crystal', quantity: 1 }],
      staged: [{ itemId: 'resonance_crystal', quantity: 1 }],
    }
    const failed = forfeitSunspireRunState(active)
    expect(failed.status).toBe('forfeited')
    expect(failed.chest).toEqual([])
    expect(failed.staged).toEqual([])
  })
})
