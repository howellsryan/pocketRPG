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
})
