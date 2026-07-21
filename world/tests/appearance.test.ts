// Phase 5: equipped-weapon → archetype/tint mapping. Pattern order is the
// dangerous part (crossbow vs bow, battleaxe vs axe, godsword vs sword) — pin
// one representative per trap.
//
// Tint values below are pinned to src/data/equipmentModels.json's per-item
// `tint` (item 12, stage 2 — the arena registry is now the source of truth
// whenever an item is registered there; TIER_TINTS only covers the rest).
import { describe, expect, it } from 'vitest'
import { gearFromEquipment, WEAPON_ARCHETYPES } from '../shared/appearance'

const withWeapon = (itemId: string) => ({ weapon: { itemId } })

describe('gearFromEquipment', () => {
  it('maps tiered melee weapons with their arena-registry tint', () => {
    // Registry-covered weapons now also carry `equip.weapon` (the client renders
    // the per-item arena model); the archetype/tint stay as the fallback.
    expect(gearFromEquipment(withWeapon('bronze_sword'))).toEqual({ weapon: { archetype: 'sword', tint: '#b87333' }, equip: { weapon: 'bronze_sword' } })
    expect(gearFromEquipment(withWeapon('adamant_dagger'))).toEqual({ weapon: { archetype: 'dagger', tint: '#3f8a5a' }, equip: { weapon: 'adamant_dagger' } })
    expect(gearFromEquipment(withWeapon('dragon_mace'))).toEqual({ weapon: { archetype: 'blunt', tint: '#c0392b' }, equip: { weapon: 'dragon_mace' } })
  })

  it('scimitars share the curved-blade asset with dragon claws (developer decision)', () => {
    expect(gearFromEquipment(withWeapon('runeforged_scimitar'))).toEqual({ weapon: { archetype: 'dagger', tint: '#2fd0c0' }, equip: { weapon: 'runeforged_scimitar' } })
    expect(gearFromEquipment(withWeapon('bronze_scimitar'))).toEqual({ weapon: { archetype: 'dagger', tint: '#b87333' }, equip: { weapon: 'bronze_scimitar' } })
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

  it('falls back to the TIER_TINTS regex for a weapon the arena registry does not cover', () => {
    // dragon_claws has no src/data/equipmentModels.json weapons entry (it
    // shares the dagger archetype's asset via ARCHETYPE_RULES, but was never
    // given its own registry row) — the regex fallback must still tint it.
    expect(gearFromEquipment(withWeapon('dragon_claws'))).toEqual({ weapon: { archetype: 'dagger', tint: '#c94a3b' } })
  })

  it('maps exotics onto nearest silhouettes', () => {
    expect(gearFromEquipment(withWeapon('abyssal_tentacle'))?.weapon?.archetype).toBe('dagger')
    expect(gearFromEquipment(withWeapon('nether_demon_whip'))?.weapon?.archetype).toBe('dagger')
    expect(gearFromEquipment(withWeapon('venom_blowpipe'))?.weapon?.archetype).toBe('crossbow')
    expect(gearFromEquipment(withWeapon('krylth_spear'))?.weapon?.archetype).toBe('staff')
    expect(gearFromEquipment(withWeapon('verin_s_flail'))?.weapon?.archetype).toBe('blunt')
    // staff_of_fire IS registered in equipmentModels.json (weapons/staff.glb)
    // but with no tint — the arena renders it as a plain staff, so no more
    // does the world, even though "_of_fire$" still matches TIER_TINTS: a
    // registered-but-tintless item takes precedence over the regex fallback.
    expect(gearFromEquipment(withWeapon('staff_of_fire'))).toEqual({ weapon: { archetype: 'staff' }, equip: { weapon: 'staff_of_fire' } })
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

const withArmor = (body?: string, legs?: string) => ({
  ...(body ? { body: { itemId: body } } : {}),
  ...(legs ? { legs: { itemId: legs } } : {}),
})

describe('gearFromEquipment armor', () => {
  it('maps body and legs armor to their arena-registry tint', () => {
    expect(gearFromEquipment(withArmor('iron_platebody', 'iron_platelegs'))).toEqual({
      armor: { body: { tint: '#a8acb2' }, legs: { tint: '#a8acb2' } },
    })
    expect(gearFromEquipment(withArmor('bronze_platebody'))).toEqual({ armor: { body: { tint: '#d4ab85' } } })
  })

  it('keeps the slot but emits an empty tint object for an item outside the registry with no matching tier prefix', () => {
    // leather_body is a real body item, not in equipmentModels.json's gear
    // registry, and has no tier prefix in TIER_TINTS either.
    expect(gearFromEquipment(withArmor('leather_body'))).toEqual({ armor: { body: {} } })
  })

  it('omits an empty armor slot entirely', () => {
    expect(gearFromEquipment(withArmor(undefined, 'iron_platelegs'))).toEqual({ armor: { legs: { tint: '#a8acb2' } } })
    expect(gearFromEquipment({})).toEqual({})
  })

  it('ignores a non-armor item in a body/legs field', () => {
    expect(gearFromEquipment({ body: { itemId: 'bronze_sword' } })).toEqual({})
  })

  it('carries both weapon and armor when both are equipped', () => {
    expect(gearFromEquipment({ weapon: { itemId: 'bronze_sword' }, body: { itemId: 'iron_platebody' } })).toEqual({
      weapon: { archetype: 'sword', tint: '#b87333' },
      armor: { body: { tint: '#a8acb2' } },
      equip: { weapon: 'bronze_sword' },
    })
  })
})

describe('gearFromEquipment equip (per-item registry parity)', () => {
  it('carries the weapon itemId whenever the arena registry can render it per-item', () => {
    // The reported bug: a trident renders as a staff in the open world. The
    // archetype fallback is still 'staff', but equip.weapon lets the client load
    // weapons/trident.glb with the arena's exact placement instead.
    expect(gearFromEquipment(withWeapon('trident_of_venom'))).toEqual({
      weapon: { archetype: 'staff' },
      equip: { weapon: 'trident_of_venom' },
    })
  })

  it('omits equip for a weapon the registry does not cover (archetype-only fallback)', () => {
    // dragon_claws has no equipmentModels.json weapons row — no per-item model,
    // so no equip entry; the client keeps rendering the dagger silhouette.
    expect(gearFromEquipment(withWeapon('dragon_claws')).equip).toBeUndefined()
  })

  it('carries head/shield/cape/neck accessory itemIds but never body/legs', () => {
    const gear = gearFromEquipment({
      weapon: { itemId: 'dragon_scimitar' },
      head: { itemId: 'dragon_full_helm' },
      shield: { itemId: 'dragon_kiteshield' },
      cape: { itemId: 'fire_cape' },
      neck: { itemId: 'amulet_of_glory' },
      body: { itemId: 'iron_platebody' },
      legs: { itemId: 'iron_platelegs' },
    })
    expect(gear.equip).toEqual({
      weapon: 'dragon_scimitar',
      head: 'dragon_full_helm',
      shield: 'dragon_kiteshield',
      cape: 'fire_cape',
      neck: 'amulet_of_glory',
    })
    // body/legs still drive the tinted-outfit path, not equip.
    expect(gear.armor).toEqual({ body: { tint: '#a8acb2' }, legs: { tint: '#a8acb2' } })
  })

  it('carries an unregistered head item so the client renders the default helm on it', () => {
    // Regression: a helmet with no arena-registry model (e.g. slayer_helmet) was
    // dropped from equip, so no helm ever showed on the open-world hero. Head is
    // now always carried — the client renders the generic default helm for any
    // head item until per-item art exists.
    const gear = gearFromEquipment({ head: { itemId: 'slayer_helmet' } })
    expect(gear.equip).toEqual({ head: 'slayer_helmet' })
  })

  it('carries a boots item so the client renders the default L/R boots on it', () => {
    // Boots (like head) render generic default art client-side — the shared L/R
    // pair — so they're carried regardless of per-item registry coverage.
    const gear = gearFromEquipment({ boots: { itemId: 'leather_boots' } })
    expect(gear.equip).toEqual({ boots: 'leather_boots' })
  })

  it('omits equip entirely when nothing equipped resolves to a registry model', () => {
    expect(gearFromEquipment(withWeapon('dragon_claws')).equip).toBeUndefined()
    expect(gearFromEquipment(withArmor('leather_body')).equip).toBeUndefined()
    expect(gearFromEquipment({}).equip).toBeUndefined()
  })
})
