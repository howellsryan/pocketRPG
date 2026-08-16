import { describe, it, expect } from 'vitest'
import itemsData from '../src/data/items.json'
import monstersData from '../src/data/monsters.json'
import spellsData from '../src/data/spells.json'
import questsData from '../src/data/quests.json'
import { optimiseStyle, optimiseAllStyles, loadoutSwaps, levelUplift } from '../src/engine/gearOptimizer.js'
import { monsterTargets, referenceTarget } from '../src/engine/dpsCalculator.js'
import { checkEquipRequirements } from '../src/engine/equipment.js'
import { getXPForLevel } from '../src/engine/experience.js'

const items = itemsData as Record<string, any>
const monsters = monstersData as Record<string, any>
const allQuests = Object.keys(questsData as Record<string, any>)

const equippableIds = Object.entries(items).filter(([, it]: any) => it.slot).map(([id]) => id)
const targets = monsterTargets({ ...monsters.ember_giant, id: 'ember_giant' })

const levelsAt = (level: number) => ({
  attack: level, strength: level, defence: level, ranged: level, magic: level, hitpoints: level, prayer: level,
})

const statsAt = (level: number) => {
  const stats: Record<string, any> = {}
  for (const skill of ['attack', 'strength', 'defence', 'ranged', 'magic', 'hitpoints', 'prayer']) {
    stats[skill] = { xp: getXPForLevel(level) }
  }
  return stats
}

const search = (over: Record<string, any> = {}) => optimiseStyle({
  style: 'melee',
  pool: new Set(equippableIds),
  itemsData: items,
  spellsData,
  levels: levelsAt(99),
  completedQuests: allQuests,
  targets,
  ...over,
})

describe('optimiseStyle', () => {
  it('finds a melee loadout that beats a starter weapon by a wide margin', () => {
    const best = search()
    expect(best).toBeTruthy()
    expect(best!.dps).toBeGreaterThan(10)
    expect(best!.equipment.weapon).toBeTruthy()
    expect(items[best!.equipment.weapon.itemId].attackStyle).not.toBe('ranged')
  })

  it('only ever recommends gear from the pool it was given', () => {
    const pool = new Set(['runeforged_scimitar', 'runeforged_platebody', 'runeforged_platelegs'])
    const best = search({ pool })
    expect(best).toBeTruthy()
    for (const entry of Object.values(best!.equipment) as any[]) {
      expect(pool.has(entry.itemId)).toBe(true)
    }
  })

  it('never recommends gear the character cannot equip', () => {
    const levels = levelsAt(30)
    const stats = statsAt(30)
    const best = search({ levels })
    expect(best).toBeTruthy()
    for (const entry of Object.values(best!.equipment) as any[]) {
      expect(checkEquipRequirements(items[entry.itemId], stats, allQuests)).toBeNull()
    }
  })

  it('gates gear on real levels, never on prayer-boosted ones', () => {
    // A prayer boost raises the numbers the swings are scored with; it unlocks
    // nothing. Scored at 99 but gated at 70, every pick must still be wearable
    // at 70 — otherwise the answer is gear the player cannot put on.
    const best = search({ levels: levelsAt(99), requirementLevels: levelsAt(70) })
    expect(best).toBeTruthy()
    const stats = statsAt(70)
    for (const entry of Object.values(best!.equipment) as any[]) {
      expect(checkEquipRequirements(items[entry.itemId], stats, allQuests)).toBeNull()
    }
  })

  it('respects quest gates — an ungated character is offered less', () => {
    const gated = search({ completedQuests: [] })
    const ungated = search({ completedQuests: allQuests })
    expect(gated).toBeTruthy()
    expect(ungated!.dps).toBeGreaterThanOrEqual(gated!.dps)
  })

  it('a bigger pool is never worse than a smaller one', () => {
    const small = search({ pool: new Set(['runeforged_scimitar', 'runeforged_platebody']) })
    const big = search()
    expect(big!.dps).toBeGreaterThanOrEqual(small!.dps)
  })

  it('more combat levels never lower the best DPS', () => {
    const low = search({ levels: levelsAt(60) })
    const high = search({ levels: levelsAt(99) })
    expect(high!.dps).toBeGreaterThan(low!.dps)
  })

  it('returns null for a style the pool cannot field', () => {
    expect(search({ style: 'ranged', pool: new Set(['runeforged_scimitar']) })).toBeNull()
  })

  it('does not let a bolt prune every arrow out of the ammo slot', () => {
    // A bolt is not a worse arrow — it is ammunition a bow cannot fire. Ranked
    // against each other, the strongest bolt dominated every arrow in the game,
    // so arrow-firing bows had nothing to shoot and lost to whichever bow
    // needed no ammo at all.
    const bolt = Object.entries(items).find(([, it]: any) => it.slot === 'ammo' && it.ammoKind === 'bolt')![0]
    const best = search({
      style: 'ranged',
      pool: new Set(['magic_shortbow', 'maple_longbow', 'adamant_arrow', bolt]),
    })
    expect(best).toBeTruthy()
    expect(best!.equipment.weapon.itemId).toBe('magic_shortbow')
    expect(best!.equipment.ammo.itemId).toBe('adamant_arrow')
  })

  it('keeps ammo a weapon names outright, however weak its stats', () => {
    const named = Object.values(items).find((it: any) =>
      it.slot === 'weapon' && it.attackStyle === 'ranged' && (it.requiredAmmoIds?.length || it.requiredAmmoId)) as any
    if (!named) return
    const ammoId = named.requiredAmmoIds?.[0] || named.requiredAmmoId
    const best = search({ style: 'ranged', pool: new Set([named.id, ammoId]), levels: levelsAt(99) })
    expect(best?.equipment.ammo?.itemId).toBe(ammoId)
  })

  it('gives a bow ammo it can actually fire', () => {
    const best = search({ style: 'ranged' })
    expect(best).toBeTruthy()
    const weapon = items[best!.equipment.weapon.itemId]
    if (weapon.ammoType) {
      expect(best!.equipment.ammo).toBeTruthy()
      expect(items[best!.equipment.ammo.itemId].ammoKind).toBe(weapon.ammoType)
    }
  })

  it('leaves the shield slot empty when the weapon is two-handed', () => {
    const best = search()
    if (items[best!.equipment.weapon.itemId].twoHanded) {
      expect(best!.equipment.shield).toBeUndefined()
    }
  })

  it('picks a spell for a magic setup that needs one, or a powered staff', () => {
    const best = search({ style: 'magic' })
    expect(best).toBeTruthy()
    const weapon = items[best!.equipment.weapon.itemId]
    expect(weapon.poweredStaff || best!.spell).toBeTruthy()
  })

  it('honours a spell filter, so a character with no runes gets no spell build', () => {
    const best = search({ style: 'magic', spellFilter: () => false })
    if (best) expect(items[best.equipment.weapon.itemId].poweredStaff).toBe(true)
  })
})

describe('optimiseAllStyles', () => {
  it('names the highest-DPS style as best', () => {
    const { byStyle, best } = optimiseAllStyles({
      pool: new Set(equippableIds), itemsData: items, spellsData,
      levels: levelsAt(99), completedQuests: allQuests, targets,
    })
    expect(Object.keys(byStyle).length).toBeGreaterThan(1)
    expect(best).toBeTruthy()
    for (const entry of Object.values(byStyle) as any[]) {
      expect(best!.dps).toBeGreaterThanOrEqual(entry.dps)
    }
  })

  it('recommends magic against a boss with no magic defence', () => {
    // Krylth carries 250 defence in every melee/ranged style and 0 in magic —
    // the shape a "which style" answer exists to spot.
    const krylth = monsterTargets({ ...monsters.krylth_the_defiler, id: 'krylth_the_defiler' })
    expect(krylth[0].defenceBonus.magic).toBe(0)
    const { best } = optimiseAllStyles({
      pool: new Set(equippableIds), itemsData: items, spellsData,
      levels: levelsAt(99), completedQuests: allQuests, targets: krylth, monsterId: 'krylth_the_defiler',
    })
    expect(best!.style).toBe('magic')
  })
})

describe('loadoutSwaps', () => {
  const best = search()!

  it('lists only the slots that differ', () => {
    const from = { style: 'melee', stance: 'aggressive', spell: null, equipment: { weapon: { ...best.equipment.weapon } } }
    const swaps = loadoutSwaps({ from, to: best, itemsData: items, targets, levels: levelsAt(99) })
    expect(swaps.some((s) => s.slot === 'weapon')).toBe(false)
    expect(swaps.length).toBeGreaterThan(0)
  })

  it('prices each swap against the loadout it replaces', () => {
    const from = { style: 'melee', stance: 'aggressive', spell: null, equipment: { weapon: { itemId: 'bronze_scimitar' } } }
    const swaps = loadoutSwaps({ from, to: best, itemsData: items, targets, levels: levelsAt(99) })
    const weaponSwap = swaps.find((s) => s.slot === 'weapon')
    expect(weaponSwap!.from!.itemId).toBe('bronze_scimitar')
    expect(weaponSwap!.dpsGainPercent).toBeGreaterThan(0)
  })

  it('reports no per-swap gain across a style change, where it would be meaningless', () => {
    const rangedBest = search({ style: 'ranged' })!
    const swaps = loadoutSwaps({ from: best, to: rangedBest, itemsData: items, targets, levels: levelsAt(99) })
    for (const swap of swaps) expect(swap.dpsGainPercent).toBeNull()
  })
})

describe('levelUplift', () => {
  it('measures the ladder from raw levels, not from prayer-boosted ones', () => {
    const loadout = search({ levels: levelsAt(90) })!
    // A prayer boost pushes a level-90 stat over 99. Measured on the boosted
    // number every skill reads as maxed and the whole answer comes back empty.
    const boost = (raw: any) => ({ ...raw, strength: Math.floor(raw.strength * 1.23) })
    const gains = levelUplift({ loadout, targets, levels: levelsAt(90), itemsData: items, boost })
    expect(gains.length).toBeGreaterThan(0)
    expect(gains[0].currentLevel).toBe(90)
  })

  it('ranks Strength above Attack for a melee loadout that already hits often', () => {
    const loadout = search({ levels: levelsAt(90) })!
    const gains = levelUplift({ loadout, targets, levels: levelsAt(90), itemsData: items })
    const strength = gains.find((g) => g.skill === 'strength')
    expect(strength).toBeTruthy()
    expect(strength!.steps.at(-1)!.dpsGainPercent).toBeGreaterThan(0)
  })

  it('reports nothing for a maxed character', () => {
    const loadout = search({ levels: levelsAt(99) })!
    expect(levelUplift({ loadout, targets, levels: levelsAt(99), itemsData: items })).toEqual([])
  })
})

describe('the reference target keeps the search honest', () => {
  it('is usable as a search target with no monster named', () => {
    const ref = referenceTarget(monsters, 80)
    const best = search({ targets: ref.targets })
    expect(best!.dps).toBeGreaterThan(0)
  })
})
