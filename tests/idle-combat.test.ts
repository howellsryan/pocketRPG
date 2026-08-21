import { describe, expect, it } from 'vitest'
import { simulateIdleCombat } from '../src/engine/idleEngine.js'

describe('simulateIdleCombat', () => {
  it('awards magic XP (not melee XP) for powered staffs without a selected spell', () => {
    const task: any = {
      stance: 'accurate',
      monster: {
        id: 'test_monster',
        name: 'Test Monster',
        hitpoints: 20,
        stats: { defence: 1, magic: 1 },
        defenceBonus: { magic: 0 },
        drops: []
      }
    }

    const stats: any = {
      attack: { xp: 0 },
      strength: { xp: 0 },
      defence: { xp: 0 },
      ranged: { xp: 0 },
      magic: { xp: 13034431 } // 99 magic
    }

    const equipment: any = {
      weapon: { itemId: 'trident_of_venom', charges: 100 }
    }

    const itemsData: any = {
      trident_of_venom: {
        id: 'trident_of_venom',
        slot: 'weapon',
        attackStyle: 'magic',
        poweredStaff: true,
        scaleCharged: true,
        attackSpeed: 3,
        attackBonus: { magic: 25 },
        defenceBonus: { magic: 0 },
        otherBonus: { magicDamage: 0 }
      }
    }

    const sim = simulateIdleCombat(task, 60_000, stats, equipment, Array(28).fill(null), itemsData)
    expect(sim).toBeTruthy()
    expect(sim!.monstersKilled).toBeGreaterThan(0)
    expect(sim!.xpGained.magic).toBeGreaterThan(0)
    expect(sim!.xpGained.hitpoints).toBeGreaterThan(0)
    expect(sim!.xpGained.attack).toBeUndefined()
    expect(sim!.xpGained.strength).toBeUndefined()
  })

  it('fights with melee (not 0 damage) when a magic weapon has no spell selected', () => {
    const task: any = {
      stance: 'accurate',
      monster: {
        id: 'test_monster',
        name: 'Test Monster',
        hitpoints: 20,
        stats: { defence: 1, magic: 1 },
        defenceBonus: { crush: 0, magic: 0 },
        drops: []
      }
      // No `spell` on the task — the weapon is a staff with nothing selected.
    }

    const stats: any = {
      attack: { xp: 13034431 }, // 99 attack
      strength: { xp: 13034431 }, // 99 strength
      defence: { xp: 0 },
      ranged: { xp: 0 },
      magic: { xp: 0 },
    }

    const equipment: any = { weapon: { itemId: 'staff' } }
    const itemsData: any = {
      staff: {
        id: 'staff', slot: 'weapon', attackStyle: 'magic', attackSpeed: 5,
        attackBonus: { stab: 2, slash: -1, crush: 50, magic: 10, ranged: 0 },
        defenceBonus: { stab: 2, slash: 3, crush: 1, magic: 10, ranged: 0 },
        otherBonus: { meleeStrength: 50, rangedStrength: 0, magicDamage: 0 },
      }
    }

    const sim = simulateIdleCombat(task, 60_000, stats, equipment, Array(28).fill(null), itemsData)
    expect(sim).toBeTruthy()
    expect(sim!.monstersKilled).toBeGreaterThan(0)
    expect(sim!.xpGained.attack).toBeGreaterThan(0)
    expect(sim!.xpGained.magic).toBeUndefined()
  })

  it('returns completed slayerTaskUpdate with capped task kills and points on idle overkill', () => {
    const task: any = {
      stance: 'accurate',
      monster: { id: 'cave_goblin', name: 'Goblin', hitpoints: 1, stats: { defence: 1 }, defenceBonus: {}, drops: [] }
    }
    const stats: any = { attack: { xp: 13_034_431 }, strength: { xp: 13_034_431 }, defence: { xp: 0 } }
    const sim = simulateIdleCombat(task, 60_000, stats, {}, Array(28).fill(null), {}, {
      monsterId: 'cave_goblin',
      monstersRemaining: 2,
      pointsOnComplete: 4
    })

    expect(sim).toBeTruthy()
    expect(sim!.monstersKilled).toBeGreaterThan(2)
    expect(sim!.monstersKilledOnTask).toBe(2)
    expect(sim!.slayerTaskUpdate?.completed).toBe(true)
    expect(sim!.slayerTaskUpdate?.pointsOnComplete).toBe(4)
  })

  it('does not idle kill with ranged weapons that require ammo when ammo is missing', () => {
    const task: any = {
      stance: 'accurate',
      monster: { id: 'cave_goblin', name: 'Goblin', hitpoints: 5, stats: { defence: 1, magic: 1 }, defenceBonus: { ranged: 0 }, drops: [] }
    }
    const stats: any = { ranged: { xp: 13_034_431 }, hitpoints: { xp: 13_034_431 } }
    const equipment: any = { weapon: { itemId: 'runeforged_crossbow' } }
    const itemsData: any = {
      runeforged_crossbow: { id: 'runeforged_crossbow', attackStyle: 'ranged', ammoType: 'bolt', attackSpeed: 5, attackBonus: { ranged: 90 }, defenceBonus: {}, otherBonus: { rangedStrength: 0 } }
    }

    const sim = simulateIdleCombat(task, 60_000, stats, equipment, Array(28).fill(null), itemsData)
    expect(sim).toBeTruthy()
    expect(sim!.monstersKilled).toBe(0)
  })

  it('does not idle consume/proc bolts for non-bolt ranged weapons with bolts equipped', () => {
    const task: any = {
      stance: 'accurate',
      monster: { id: 'cave_goblin', name: 'Goblin', hitpoints: 1, stats: { defence: 1, magic: 1 }, defenceBonus: { ranged: 0 }, drops: [] }
    }
    const stats: any = { ranged: { xp: 13_034_431 }, hitpoints: { xp: 13_034_431 } }
    const equipment: any = { weapon: { itemId: 'magic_shortbow' }, ammo: { itemId: 'onyx_bolt_e', quantity: 100 } }
    const itemsData: any = {
      magic_shortbow: { id: 'magic_shortbow', attackStyle: 'ranged', attackSpeed: 4, attackBonus: { ranged: 69 }, defenceBonus: {}, otherBonus: { rangedStrength: 0 } },
      onyx_bolt_e: { id: 'onyx_bolt_e', ammoKind: 'bolt', boltProc: { type: 'life_leech', chance: 1 } }
    }
    const inventory = [{ itemId: 'onyx_bolt_e', quantity: 100 }, ...Array(27).fill(null)]

    const sim = simulateIdleCombat(task, 60_000, stats, equipment, inventory, itemsData)
    expect(sim).toBeTruthy()
    expect(sim!.monstersKilled).toBeGreaterThan(0)
    expect(sim!.finalInventory[0].quantity).toBe(100)
  })

  it('caps ranged idle kills by equipped ammo and reports ammo consumption', () => {
    const task: any = {
      stance: 'accurate',
      monster: { id: 'cave_goblin', name: 'Goblin', hitpoints: 5, stats: { defence: 1, magic: 1 }, defenceBonus: { ranged: 0 }, drops: [] }
    }
    const stats: any = { ranged: { xp: 13_034_431 }, hitpoints: { xp: 13_034_431 } }
    const equipment: any = { weapon: { itemId: 'runeforged_crossbow' }, ammo: { itemId: 'bronze_bolt', quantity: 3 } }
    const itemsData: any = {
      runeforged_crossbow: { id: 'runeforged_crossbow', attackStyle: 'ranged', ammoType: 'bolt', attackSpeed: 5, attackBonus: { ranged: 90 }, defenceBonus: {}, otherBonus: { rangedStrength: 0 } },
      bronze_bolt: { id: 'bronze_bolt', ammoKind: 'bolt' }
    }

    const sim = simulateIdleCombat(task, 60_000, stats, equipment, Array(28).fill(null), itemsData)
    expect(sim).toBeTruthy()
    expect(sim!.monstersKilled).toBe(3)
    expect(sim!.ammoConsumed).toEqual({ itemId: 'bronze_bolt', quantity: 3 })
    expect(sim!.resourceLimited).toBe(true)
  })

  it('caps powered staff idle kills by weapon charges', () => {
    const task: any = {
      stance: 'accurate',
      monster: { id: 'cave_goblin', name: 'Goblin', hitpoints: 5, stats: { defence: 1, magic: 1 }, defenceBonus: { magic: 0 }, drops: [] }
    }
    const stats: any = { magic: { xp: 13_034_431 }, hitpoints: { xp: 13_034_431 } }
    const equipment: any = { weapon: { itemId: 'trident', charges: 2 } }
    const itemsData: any = {
      trident: { id: 'trident', attackStyle: 'magic', poweredStaff: true, scaleCharged: true, attackSpeed: 4, attackBonus: { magic: 25 }, defenceBonus: {}, otherBonus: { magicDamage: 0 } }
    }
    const sim = simulateIdleCombat(task, 60_000, stats, equipment, Array(28).fill(null), itemsData)
    expect(sim!.monstersKilled).toBe(2)
    expect(sim!.chargesConsumed).toBe(2)
  })

  it('sizes the ammo cap off the boosted (not unboosted-baseline) attacks-per-kill', () => {
    // A tanky target needs multiple hits per kill unboosted. A configured idle
    // ranging potion + Eagle Eye prayer cuts hits-per-kill, so the same ammo
    // stock should last for MORE kills than a static unboosted estimate would
    // predict — sizing the cap off the baseline (the bug) caps both runs at
    // the same, lower kill count regardless of the boost.
    const task: any = {
      stance: 'accurate',
      monster: { id: 'tough_target', name: 'Tough Target', hitpoints: 60, stats: { defence: 50, magic: 1 }, defenceBonus: { ranged: 40 }, drops: [] }
    }
    const stats: any = { ranged: { xp: 13_034_431 }, hitpoints: { xp: 13_034_431 }, prayer: { xp: 13_034_431 } }
    const equipment: any = { weapon: { itemId: 'runeforged_crossbow' }, ammo: { itemId: 'bronze_bolt', quantity: 30 } }
    const itemsData: any = {
      runeforged_crossbow: { id: 'runeforged_crossbow', attackStyle: 'ranged', ammoType: 'bolt', attackSpeed: 5, attackBonus: { ranged: 90 }, defenceBonus: {}, otherBonus: { rangedStrength: 0 } },
      bronze_bolt: { id: 'bronze_bolt', ammoKind: 'bolt' },
      ranging_potion: { id: 'ranging_potion', type: 'potion', effect: 'ranged', boost: 20, duration: 300 },
    }
    const prayersData: any = {
      eagle_eye: { id: 'eagle_eye', name: 'Eagle Eye', bonusType: 'stat', stat: 'ranged', boostPercent: 15, level: 44, drainPerMinute: 12 },
    }

    const baseline = simulateIdleCombat(task, 600_000, stats, equipment, Array(28).fill(null), itemsData)
    expect(baseline!.monstersKilled).toBe(2)
    expect(baseline!.resourceLimited).toBe(true)

    const boosted = simulateIdleCombat(task, 600_000, stats, equipment, Array(28).fill(null), itemsData, null, { ranging_potion: { quantity: 5 } }, {
      idlePotions: [{ itemId: 'ranging_potion', quantity: 5 }],
      idlePrayers: { combatPrayerId: 'eagle_eye', protectionPrayerId: null },
      prayersData,
    })
    expect(boosted!.resourceLimited).toBe(true)
    expect(boosted!.monstersKilled).toBeGreaterThan(baseline!.monstersKilled)
    expect(boosted!.monstersKilled).toBe(3)
  })

  it('sizes the rune cap off the boosted attacks-per-kill, and folds boosted cast counts into spell XP', () => {
    const task: any = {
      stance: 'accurate',
      spell: { id: 'fireball', baseDamage: 20, baseXP: 8, runeReq: { fire_rune: 3, chaos_rune: 1 } },
      monster: { id: 'tough_target', name: 'Tough Target', hitpoints: 100, stats: { defence: 60, magic: 60 }, defenceBonus: { magic: 40 }, drops: [] }
    }
    const stats: any = { magic: { xp: 13_034_431 }, hitpoints: { xp: 13_034_431 }, prayer: { xp: 13_034_431 } }
    const equipment: any = { weapon: { itemId: 'staff' } }
    const itemsData: any = {
      staff: { id: 'staff', slot: 'weapon', attackStyle: 'magic', attackSpeed: 5, attackBonus: { magic: 40 }, defenceBonus: {}, otherBonus: { magicDamage: 0 } },
      magic_potion: { id: 'magic_potion', type: 'potion', effect: 'magic', boost: 60, duration: 300 },
      fire_rune: { id: 'fire_rune' },
      chaos_rune: { id: 'chaos_rune' },
    }
    const prayersData: any = {
      mystic_will: { id: 'mystic_will', name: 'Mystic Will', bonusType: 'stat', stat: 'magic', boostPercent: 20, level: 9, drainPerMinute: 3 },
    }
    const inventory = Array(28).fill(null)
    const bank = { fire_rune: { quantity: 269 }, chaos_rune: { quantity: 300 } }

    const baseline = simulateIdleCombat(task, 600_000, stats, equipment, inventory, itemsData, null, bank)
    expect(baseline!.monstersKilled).toBe(5)
    expect(baseline!.resourceLimited).toBe(true)
    expect(baseline!.runesConsumed).toEqual({ fire_rune: 225, chaos_rune: 75 })

    const boosted = simulateIdleCombat(task, 600_000, stats, equipment, inventory, itemsData, null, bank, {
      idlePotions: [{ itemId: 'magic_potion', quantity: 5 }],
      idlePrayers: { combatPrayerId: 'mystic_will', protectionPrayerId: null },
      prayersData,
    })
    expect(boosted!.resourceLimited).toBe(true)
    // Same rune stock, but the boosted run needs fewer casts per kill — it
    // should clear MORE kills than the static-baseline cap would allow.
    expect(boosted!.monstersKilled).toBeGreaterThan(baseline!.monstersKilled)
    expect(boosted!.monstersKilled).toBe(6)
    // Spell-cast XP must reflect the actual (boosted) cast count, not the
    // unboosted baseline — it rides the same attacksUsed total the rune cap
    // now uses. Damage XP is 100 hp * MAGIC_XP_PER_DAMAGE (2) per kill, plus
    // baseXP (8) per actual cast.
    expect(boosted!.xpGained.magic).toBe(boosted!.monstersKilled * 200 + boosted!.attacksUsed * 8)
  })

})
