import { describe, expect, it } from 'vitest'
import { buildCombatantFromSave } from '../functions/_lib/pvpMatch.js'

describe('buildCombatantFromSave', () => {
  it('starts PvP combatants with positive HP even when save currentHP is stale/zero', () => {
    const combatant = buildCombatantFromSave({
      characterId: 1,
      username: 'Tester',
      savePayload: {
        player: { currentHP: 0, maxHP: 0 },
        stats: {
          hitpoints: { level: 99 },
          attack: { level: 99 },
          strength: { level: 99 },
          defence: { level: 99 },
          ranged: { level: 99 },
          magic: { level: 99 },
          prayer: { level: 99 },
        },
        equipment: {},
        inventory: [],
      },
    })

    expect(combatant.maxHP).toBeGreaterThan(0)
    expect(combatant.currentHP).toBeGreaterThan(0)
  })
})


it('uses saved combat stance and normalizes invalid values', () => {
  const defensive = buildCombatantFromSave({
    characterId: 1,
    username: 'Tester',
    savePayload: { settings: { combatStance: 'defensive' }, stats: {}, equipment: {}, inventory: [] },
  })
  expect(defensive.stance).toBe('defensive')

  const fallback = buildCombatantFromSave({
    characterId: 1,
    username: 'Tester',
    savePayload: { settings: { combatStance: 'bad' }, stats: {}, equipment: {}, inventory: [] },
  })
  expect(fallback.stance).toBe('accurate')
})
