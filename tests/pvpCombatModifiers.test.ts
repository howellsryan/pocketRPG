import { describe, expect, it } from 'vitest'
import { getPvpCombatModifiers } from '../src/engine/pvpCombatModifiers.js'

describe('pvp combat modifiers', () => {
  it('returns neutral modifiers for missing/invalid inputs', () => {
    expect(getPvpCombatModifiers(undefined as any)).toEqual({
      prayer: { attack: 1, strength: 1, defence: 1, ranged: 1, rangedStrength: 1, magic: 1 },
      potions: { attack: 0, strength: 0, defence: 0, ranged: 0, magic: 0 },
      magicDamagePercent: 0,
    })

    expect(getPvpCombatModifiers({ activeCombatPrayer: 'not_a_prayer' } as any).prayer).toEqual({
      attack: 1, strength: 1, defence: 1, ranged: 1, rangedStrength: 1, magic: 1,
    })
  })

  it('maps stat prayers and multi-stat prayers correctly', () => {
    expect(getPvpCombatModifiers({ activeCombatPrayer: 'eagle_eye' } as any).prayer).toMatchObject({
      ranged: 1.15,
      rangedStrength: 1.15,
      attack: 1,
    })
    expect(getPvpCombatModifiers({ activeCombatPrayer: 'mystic_lore' } as any).prayer).toMatchObject({ magic: 1.1, attack: 1, strength: 1 })
    expect(getPvpCombatModifiers({ activeCombatPrayer: 'ultimate_strength' } as any).prayer).toMatchObject({ strength: 1.15, attack: 1, magic: 1 })

    expect(getPvpCombatModifiers({ activeCombatPrayer: 'piety' } as any).prayer).toMatchObject({ attack: 1.2, strength: 1.23, defence: 1.25 })
    expect(getPvpCombatModifiers({ activeCombatPrayer: 'rigour' } as any).prayer).toMatchObject({ ranged: 1.2, rangedStrength: 1.23, defence: 1.25 })
    expect(getPvpCombatModifiers({ activeCombatPrayer: 'augury' } as any).prayer).toMatchObject({ magic: 1.25, defence: 1.25 })
  })

  it('reports a prayer magic-damage bonus in percentage points, separate from the level multipliers', () => {
    // A spell's max hit has no level term, so Augury's damage cannot ride the
    // `prayer` multipliers above — it is added to worn magic damage instead.
    expect(getPvpCombatModifiers({ activeCombatPrayer: 'augury' } as any).magicDamagePercent).toBe(5)
    expect(getPvpCombatModifiers({ activeCombatPrayer: 'mystic_lore' } as any).magicDamagePercent).toBe(0)
  })

  it('keeps protection prayers neutral in pvp v1', () => {
    for (const prayerId of ['protection_from_magic', 'protection_from_missiles', 'protection_from_melee']) {
      expect(getPvpCombatModifiers({ activeCombatPrayer: prayerId } as any).prayer).toEqual({
        attack: 1,
        strength: 1,
        defence: 1,
        ranged: 1,
        rangedStrength: 1,
        magic: 1,
      })
    }
  })

  it('applies potion boosts only for active supported potion effects', () => {
    const base = { attack: 99, strength: 99, defence: 99, ranged: 99, magic: 99 }

    const active = getPvpCombatModifiers({
      activePotions: { super_combat: 10 },
      stats: base,
    } as any).potions
    expect(active.attack).toBeGreaterThan(0)
    expect(active.strength).toBeGreaterThan(0)
    expect(active.defence).toBeGreaterThan(0)

    const expired = getPvpCombatModifiers({ activePotions: { super_combat: 0 }, stats: base } as any).potions
    expect(expired).toEqual({ attack: 0, strength: 0, defence: 0, ranged: 0, magic: 0 })

    const unknown = getPvpCombatModifiers({ activePotions: { unknown_potion: 10 }, stats: base } as any).potions
    expect(unknown).toEqual({ attack: 0, strength: 0, defence: 0, ranged: 0, magic: 0 })

    const superAttackOnly = getPvpCombatModifiers({ activePotions: { super_attack: 5 }, stats: base } as any).potions
    const stacked = getPvpCombatModifiers({
      activePotions: { attack_potion: 5, super_attack: 5, super_combat: 5 },
      stats: base,
    } as any).potions
    // Boosts sum across active potions (PvE stacking), so the stacked total
    // exceeds any single potion's contribution.
    expect(stacked.attack).toBeGreaterThan(superAttackOnly.attack)
    expect(stacked.attack).toBeGreaterThan(active.attack)
  })
})
