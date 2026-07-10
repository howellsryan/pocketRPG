// Phase 5: equipped-weapon → archetype/tint mapping. Pattern order is the
// dangerous part (crossbow vs bow, battleaxe vs axe, godsword vs sword) — pin
// one representative per trap.
import { describe, expect, it } from 'vitest'
import { gearFromEquipment, WEAPON_ARCHETYPES } from '../shared/appearance'

const withWeapon = (itemId: string) => ({ weapon: { itemId } })

describe('gearFromEquipment', () => {
  it('maps tiered melee weapons with their tier tint', () => {
    expect(gearFromEquipment(withWeapon('bronze_sword'))).toEqual({ weapon: { archetype: 'sword', tint: '#c07a3d' } })
    expect(gearFromEquipment(withWeapon('adamant_dagger'))).toEqual({ weapon: { archetype: 'dagger', tint: '#57a05c' } })
    expect(gearFromEquipment(withWeapon('dragon_mace'))).toEqual({ weapon: { archetype: 'blunt', tint: '#c94a3b' } })
  })

  it('scimitars share the curved-blade asset with dragon claws (developer decision)', () => {
    expect(gearFromEquipment(withWeapon('runeforged_scimitar'))).toEqual({ weapon: { archetype: 'dagger', tint: '#5aa7bd' } })
    expect(gearFromEquipment(withWeapon('bronze_scimitar'))).toEqual({ weapon: { archetype: 'dagger', tint: '#c07a3d' } })
    expect(gearFromEquipment(withWeapon('dragon_scimitar'))?.weapon?.archetype).toBe(gearFromEquipment(withWeapon('dragon_claws'))?.weapon?.archetype)
  })

  it('routes specific tokens before the generic ones they contain', () => {
    expect(gearFromEquipment(withWeapon('dragon_slayer_crossbow'))?.weapon?.archetype).toBe('crossbow')
    expect(gearFromEquipment(withWeapon('nightfang_bow'))?.weapon?.archetype).toBe('bow')
    expect(gearFromEquipment(withWeapon('dravok_s_greataxe'))?.weapon?.archetype).toBe('axe2h')
    expect(gearFromEquipment(withWeapon('bronze_pickaxe'))?.weapon?.archetype).toBe('axe')
    expect(gearFromEquipment(withWeapon('grondar_godsword'))?.weapon?.archetype).toBe('sword2h')
    expect(gearFromEquipment(withWeapon('runeforged_2h_sword'))?.weapon?.archetype).toBe('sword2h')
    expect(gearFromEquipment(withWeapon('boneclaw_rapier'))?.weapon?.archetype).toBe('sword')
  })

  it('upgrades two-handed swords/axes even without a 2h token', () => {
    // scythe_of_vythar is twoHanded and matches the scythe rule directly.
    expect(gearFromEquipment(withWeapon('scythe_of_vythar'))?.weapon?.archetype).toBe('axe2h')
  })

  it('maps exotics onto nearest silhouettes', () => {
    expect(gearFromEquipment(withWeapon('abyssal_tentacle'))?.weapon?.archetype).toBe('dagger')
    expect(gearFromEquipment(withWeapon('nether_demon_whip'))?.weapon?.archetype).toBe('dagger')
    expect(gearFromEquipment(withWeapon('venom_blowpipe'))?.weapon?.archetype).toBe('crossbow')
    expect(gearFromEquipment(withWeapon('krylth_spear'))?.weapon?.archetype).toBe('staff')
    expect(gearFromEquipment(withWeapon('verin_s_flail'))?.weapon?.archetype).toBe('blunt')
    expect(gearFromEquipment(withWeapon('staff_of_fire'))).toEqual({ weapon: { archetype: 'staff', tint: '#d05a3a' } })
    expect(gearFromEquipment(withWeapon('ancestral_wand'))?.weapon?.archetype).toBe('wand')
  })

  it('renders bare hands for tools, unknown items, and empty equipment', () => {
    expect(gearFromEquipment(withWeapon('fishing_rod'))).toEqual({})
    expect(gearFromEquipment(withWeapon('no_such_item'))).toEqual({})
    expect(gearFromEquipment({})).toEqual({})
    expect(gearFromEquipment(null)).toEqual({})
    expect(gearFromEquipment({ weapon: null })).toEqual({})
  })

  it('only ever emits known archetypes (a model exists for each)', () => {
    const items = ['bronze_sword', 'magic_shortbow', 'chaotic_maul', 'staff_of_air', '2nd_age_wand', 'colossal_ballista', 'dragon_claws', 'gold_axe', 'ancient_maul', 'harpoon']
    for (const id of items) {
      const arch = gearFromEquipment(withWeapon(id))?.weapon?.archetype
      if (arch) expect(WEAPON_ARCHETYPES).toContain(arch)
    }
  })
})
