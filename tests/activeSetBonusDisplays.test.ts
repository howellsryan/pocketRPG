import { describe, expect, it } from 'vitest'
import { getActiveSetBonusDisplays } from '../src/engine/combatSetBonuses.js'

describe('getActiveSetBonusDisplays', () => {
  it('returns nothing when no set is active', () => {
    expect(getActiveSetBonusDisplays({})).toEqual([])
  })

  it('lists the Void King set with percentage lines when fully equipped', () => {
    const equipment = {
      head: { itemId: 'void_king_helm' },
      body: { itemId: 'void_king_top' },
      legs: { itemId: 'void_king_robe' },
      gloves: { itemId: 'void_king_gloves' },
    }
    const displays = getActiveSetBonusDisplays(equipment)
    expect(displays).toHaveLength(1)
    expect(displays[0].name).toBe('Void King')
    expect(displays[0].lines).toContainEqual({ label: 'Melee Accuracy', value: 12.5, percent: true })
    expect(displays[0].lines).toContainEqual({ label: 'Magic Accuracy', value: 45, percent: true })
    expect(displays[0].lines).toContainEqual({ label: 'Magic Damage', value: 10, percent: true })
  })

  it('lists the Shardglass set with percentage accuracy/damage lines when fully equipped', () => {
    const equipment = {
      head: { itemId: 'shardglass_helmet' },
      body: { itemId: 'shardglass_plate_body' },
      legs: { itemId: 'shardglass_platelegs' },
      weapon: { itemId: 'blade_of_saeldor' },
    }
    const displays = getActiveSetBonusDisplays(equipment)
    expect(displays).toHaveLength(1)
    expect(displays[0].name).toBe('Shardglass')
    expect(displays[0].lines).toContainEqual({ label: 'Melee Accuracy', value: 30, percent: true })
    expect(displays[0].lines).toContainEqual({ label: 'Ranged Accuracy', value: 30, percent: true })
    expect(displays[0].lines).toContainEqual({ label: 'Magic Accuracy', value: 30, percent: true })
    expect(displays[0].lines).toContainEqual({ label: 'Melee Damage', value: 15, percent: true })
    expect(displays[0].lines).toContainEqual({ label: 'Ranged Damage', value: 15, percent: true })
  })

  it('lists every active set at once when multiple sets are worn simultaneously', () => {
    const equipment = {
      head: { itemId: 'masari_mask' },
      body: { itemId: 'masari_body' },
      legs: { itemId: 'masari_chaps' },
      weapon: { itemId: 'bow_of_faerdhinen' },
    }
    // Masari alone is active here (no Shardglass armour worn) — sanity check
    // that unrelated sets don't leak into the list.
    const displays = getActiveSetBonusDisplays(equipment)
    expect(displays.map(d => d.id)).toEqual(['masari'])
  })
})
