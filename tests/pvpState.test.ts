import { describe, it, expect } from 'vitest'
import { normalizePvpState } from '../src/engine/pvpState.js'

describe('normalizePvpState', () => {
  it('normalizes legacy snake_case payloads into safe combatant shape', () => {
    const state = normalizePvpState({
      tick: '7',
      recent_events: { unexpected: true },
      combatants: {
        '12': {
          character_id: 12,
          current_hp: 9,
          max_hp: 10,
          special_attack_energy: 80,
          inventory: {
            a: { item_id: 'shark', quantity: '2' },
          },
        },
      },
    })

    expect(state?.tick).toBe(7)
    expect(state?.recentEvents).toEqual([])
    expect(state?.combatants?.['12']?.characterId).toBe(12)
    expect(state?.combatants?.['12']?.hp).toBe(9)
    expect(state?.combatants?.['12']?.maxHP).toBe(10)
    expect(state?.combatants?.['12']?.specialAttackEnergy).toBe(80)
    expect(state?.combatants?.['12']?.inventory?.[0]?.itemId).toBe('shark')
    expect(state?.combatants?.['12']?.inventory?.[0]?.quantity).toBe(2)
  })

  it('drops malformed combatants and returns null for non-objects', () => {
    expect(normalizePvpState(null)).toBeNull()
    expect(normalizePvpState(undefined)).toBeNull()

    const state = normalizePvpState({
      tick: 1,
      recentEvents: [{}],
      combatants: [{ not: 'a combatant' }, { characterId: 5, hp: 1, maxHP: 10 }],
    })

    expect(Object.keys(state?.combatants || {})).toEqual(['5'])
  })

  it('parses stringified state blobs from legacy match rows', () => {
    const state = normalizePvpState(JSON.stringify({
      tick: 2,
      recent_events: [],
      combatants: JSON.stringify([
        {
          character_id: 10,
          current_hp: 8,
          max_hp: 10,
          inventory: JSON.stringify([{ item_id: 'shark', quantity: 1 }]),
        },
      ]),
    }))

    expect(state?.tick).toBe(2)
    expect(state?.combatants?.['10']?.hp).toBe(8)
    expect(state?.combatants?.['10']?.inventory?.[0]?.itemId).toBe('shark')
  })

  it('defaults hp to maxHP when hp fields are absent', () => {
    const state = normalizePvpState({
      tick: 1,
      combatants: {
        '22': {
          character_id: 22,
          max_hp: 99,
        },
      },
    })
    expect(state?.combatants?.['22']?.maxHP).toBe(99)
    expect(state?.combatants?.['22']?.hp).toBe(99)
  })

  it('preserves hp 0 for a dead combatant on the terminal tick', () => {
    const state = normalizePvpState({
      tick: 5,
      combatants: {
        '7': {
          character_id: 7,
          hp: 0,
          currentHP: 0,
          max_hp: 99,
        },
      },
    })
    expect(state?.combatants?.['7']?.maxHP).toBe(99)
    expect(state?.combatants?.['7']?.hp).toBe(0)
  })

  it('normalizes rank/kills from snake_case and camelCase combatants', () => {
    const state = normalizePvpState({
      tick: 1,
      combatants: {
        '1': {
          character_id: 1,
          username: 'Winner',
          hp: 10,
          maxHP: 10,
          inventory: [],
          total_pvp_kills: 2,
          last_updated_total_pvp_kills: 1000,
          pvp_rank: 1,
        },
        '2': {
          characterId: 2,
          username: 'Unranked',
          hp: 10,
          maxHP: 10,
          inventory: [],
          totalPvpKills: 0,
          lastUpdatedTotalPvpKills: null,
          pvpRank: null,
        },
      },
    })

    expect(state?.combatants['1'].totalPvpKills).toBe(2)
    expect(state?.combatants['1'].pvpRank).toBe(1)
    expect(state?.combatants['2'].totalPvpKills).toBe(0)
    expect(state?.combatants['2'].pvpRank).toBeNull()
  })
})
