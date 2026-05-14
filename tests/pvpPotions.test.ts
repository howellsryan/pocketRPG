import { describe, expect, it } from 'vitest'
import { getPvpPotionBoosts, isPvpCombatPotion } from '../src/engine/pvpPotions.js'

describe('pvp potion helpers', () => {
  it('accepts only supported combat potions', () => {
    expect(isPvpCombatPotion('attack_potion')).toBe(true)
    expect(isPvpCombatPotion({ id: 'super_strength' })).toBe(true)
    expect(isPvpCombatPotion('prayer_potion')).toBe(false)
    expect(isPvpCombatPotion('magic_potion')).toBe(false)
  })

  it('supports dose-style variants by suffix', () => {
    expect(isPvpCombatPotion('super_attack_4')).toBe(true)
    expect(isPvpCombatPotion('super_strength(3)')).toBe(true)
  })

  it('computes max active boosts per stat', () => {
    const boosts = getPvpPotionBoosts(
      { attack_potion: 10, super_attack: 5, super_combat: 12 },
      { attack: 99, strength: 99, defence: 99, ranged: 99, magic: 99 },
    )
    expect(boosts.attack).toBeGreaterThan(0)
    expect(boosts.strength).toBeGreaterThan(0)
    expect(boosts.defence).toBeGreaterThan(0)
    expect(boosts.ranged).toBe(0)
  })
})
