import { describe, it, expect } from 'vitest'
import itemsData from '../src/data/items.json'
import { validateIntentAction } from '../functions/api/pvp/match/[id]/intent.js'

function stateWithInventory(itemId: string) {
  return {
    combatants: {
      '1': {
        characterId: 1,
        stats: { prayer: 99 },
        inventory: [{ itemId, quantity: 1 }],
        equipment: {},
      },
    },
  }
}

describe('PvP intent validation food checks', () => {
  it('accepts eat intent for canonical heals food from items.json', () => {
    const shark = itemsData.shark
    expect(shark?.heals).toBeGreaterThan(0)
    const result = validateIntentAction(stateWithInventory('shark'), 1, { type: 'eat', inventorySlot: 0 })
    expect(result).toEqual({ ok: true })
  })

  it('rejects protection prayers with explicit error', () => {
    const state: any = stateWithInventory('shark')
    const result = validateIntentAction(state, 1, { type: 'toggle_prayer', prayerId: 'protection_from_melee' })
    expect(result).toEqual({ ok: false, error: 'protection_prayer_disabled' })
  })

  it('rejects prayers above player prayer level', () => {
    const state: any = stateWithInventory('shark')
    state.combatants['1'].stats.prayer = 1
    const result = validateIntentAction(state, 1, { type: 'toggle_prayer', prayerId: 'piety' })
    expect(result).toEqual({ ok: false, error: 'insufficient_prayer_level' })
  })

  it('accepts any potion for drink intents (parity with PvE)', () => {
    expect(validateIntentAction(stateWithInventory('attack_potion'), 1, { type: 'drink_potion', inventorySlot: 0 })).toEqual({ ok: true })
    // Previously-rejected potions now drink in PvP, matching PvE: prayer/super
    // restore are consumed for no live effect, magic boosts magic, lumira heals.
    expect(validateIntentAction(stateWithInventory('prayer_potion'), 1, { type: 'drink_potion', inventorySlot: 0 })).toEqual({ ok: true })
    expect(validateIntentAction(stateWithInventory('magic_potion'), 1, { type: 'drink_potion', inventorySlot: 0 })).toEqual({ ok: true })
    expect(validateIntentAction(stateWithInventory('lumira_brew'), 1, { type: 'drink_potion', inventorySlot: 0 })).toEqual({ ok: true })
    // A non-potion, non-food item is still rejected.
    expect(validateIntentAction(stateWithInventory('bronze_dagger'), 1, { type: 'drink_potion', inventorySlot: 0 })).toEqual({ ok: false, error: 'item_not_potion' })
  })

  it('accepts lumira brew for eat intents (it heals on eat)', () => {
    expect(validateIntentAction(stateWithInventory('lumira_brew'), 1, { type: 'eat', inventorySlot: 0 })).toEqual({ ok: true })
  })

  it('validates queue_special energy and weapon requirements', () => {
    const noSpec: any = { combatants: { '1': { characterId: 1, equipment: {}, inventory: [], specialAttackEnergy: 100 } } }
    expect(validateIntentAction(noSpec, 1, { type: 'queue_special' })).toEqual({ ok: false, error: 'no_special_attack' })

    const withSpec: any = { combatants: { '1': { characterId: 1, equipment: { weapon: { itemId: 'dragon_dagger' } }, inventory: [], specialAttackEnergy: 25 } } }
    expect(validateIntentAction(withSpec, 1, { type: 'queue_special' })).toEqual({ ok: true })
    withSpec.combatants['1'].specialAttackEnergy = 24
    expect(validateIntentAction(withSpec, 1, { type: 'queue_special' })).toEqual({ ok: false, error: 'insufficient_special_energy' })
  })
})
