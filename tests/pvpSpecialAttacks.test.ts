import { describe, expect, it } from 'vitest'
import {
  buildPvpSpecialAttackMeta,
  clampPvpSpecialEnergy,
  getEquippedPvpSpecialAttack,
  getPvpSpecialAttackLabel,
  hasEnoughPvpSpecialEnergy,
  PVP_SPECIAL_ATTACK_LABELS,
  SUPPORTED_PVP_SPECIAL_ATTACK_TYPES,
} from '../src/engine/pvpSpecialAttacks.js'


describe('pvpSpecialAttacks helpers', () => {
  it('keeps label map and supported type set aligned', () => {
    for (const key of Object.keys(PVP_SPECIAL_ATTACK_LABELS)) {
      expect(SUPPORTED_PVP_SPECIAL_ATTACK_TYPES.has(key)).toBe(true)
    }
    expect(getPvpSpecialAttackLabel('double_hit')).toBe('⚔️⚔️ Puncture')
    expect(getPvpSpecialAttackLabel('triple_hit')).toBe('🪨🪨🪨 Quake')
    expect(getPvpSpecialAttackLabel('descent_of_darkness')).toBe('🏹🏹 Descent of Darkness')
    expect(getPvpSpecialAttackLabel('missing_type')).toBe('⚡ Special Attack')
  })

  it('clamps and floors special energy with fallback handling', () => {
    expect(clampPvpSpecialEnergy(12.9)).toBe(12)
    expect(clampPvpSpecialEnergy(-1)).toBe(0)
    expect(clampPvpSpecialEnergy(999)).toBe(100)
    expect(clampPvpSpecialEnergy('x')).toBe(100)
    expect(clampPvpSpecialEnergy(undefined, 23)).toBe(23)
  })

  it('resolves equipped special attack metadata and defaults', () => {
    const itemsData = {
      weapon_a: { id: 'weapon_a', name: 'Test Blade', specialAttack: { type: 'double_hit', energyCost: 25 } },
      weapon_b: { id: 'weapon_b', specialAttack: { energyCost: -10 } },
    }

    expect(getEquippedPvpSpecialAttack({} as any, itemsData as any)).toBeNull()
    expect(getEquippedPvpSpecialAttack({ equipment: { weapon: { itemId: 'missing' } } } as any, itemsData as any)).toBeNull()
    expect(getEquippedPvpSpecialAttack({ equipment: { weapon: { itemId: 'weapon_a' } } } as any, itemsData as any)).toMatchObject({
      weaponId: 'weapon_a',
      weaponName: 'Test Blade',
      type: 'double_hit',
      energyCost: 25,
    })
    expect(getEquippedPvpSpecialAttack({ equipment: { weapon: { itemId: 'weapon_b' } } } as any, itemsData as any)).toMatchObject({
      weaponId: 'weapon_b',
      weaponName: 'weapon_b',
      type: 'special',
      energyCost: 0,
    })
  })

  it('checks enough special energy boundaries', () => {
    const itemsData = { weapon_a: { id: 'weapon_a', specialAttack: { energyCost: 40 } } }
    expect(hasEnoughPvpSpecialEnergy({ specialAttackEnergy: 100 } as any, itemsData as any)).toBe(false)
    expect(hasEnoughPvpSpecialEnergy({ equipment: { weapon: { itemId: 'weapon_a' } }, specialAttackEnergy: 39 } as any, itemsData as any)).toBe(false)
    expect(hasEnoughPvpSpecialEnergy({ equipment: { weapon: { itemId: 'weapon_a' } }, specialAttackEnergy: 40 } as any, itemsData as any)).toBe(true)
    expect(hasEnoughPvpSpecialEnergy({ equipment: { weapon: { itemId: 'weapon_a' } }, specialAttackEnergy: '40.8' } as any, itemsData as any)).toBe(true)
  })

  it('builds sanitized combat log metadata for specials', () => {
    const meta = buildPvpSpecialAttackMeta({
      attacker: { equipment: { weapon: { itemId: 'fallback_sword' } } },
      weapon: null,
      spec: { type: 'double_hit', energyCost: -4 },
      energyBefore: 80.9,
      energyAfter: -7,
      hits: [10.2, -4, '8'],
      totalDamage: '-3',
      extra: { outcome: 'hit' },
    } as any)

    expect(meta).toMatchObject({
      type: 'double_hit',
      label: '⚔️⚔️ Puncture',
      weaponId: 'fallback_sword',
      weaponName: 'fallback_sword',
      energyCost: 0,
      energyBefore: 80,
      energyAfter: 0,
      hits: [10, 0, 8],
      totalDamage: 0,
      outcome: 'hit',
    })
  })
})
