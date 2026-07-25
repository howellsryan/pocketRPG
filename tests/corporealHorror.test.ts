import { describe, it, expect } from 'vitest'
import monsters from '../src/data/monsters.json'
import items from '../src/data/items.json'
import collectionLog from '../src/data/collectionLog.json'
import dailyTasks from '../src/data/dailyTasks.json'
import worldActivities from '../src/data/worldActivities.json'
import {
  monsterDamageMultiplier,
  applyMonsterResistance,
  getMonsterResistance,
} from '../src/engine/monsterDamageRules.js'
import {
  getDamageReductionPerk,
  applyDamageReduction,
  applySwingDamageReduction,
  expectedDamageMultiplier,
  getPrayerDrainMultiplier,
} from '../src/engine/damageReduction.js'
import { getEquipmentBonuses } from '../src/engine/equipment.js'
import { applyPrayerDrainTick } from '../src/engine/prayerDrain.js'
import prayers from '../src/data/prayers.json'

const monstersData = monsters as Record<string, any>
const itemsData = items as Record<string, any>
const boss = monstersData.corporeal_horror

const UNIQUES = [
  'wraithbone_shield',
  'sanctified_elixir',
  'runeward_sigil',
  'aegis_sigil',
  'vigil_sigil',
]
const CRAFTED = [
  'hallowed_wraithbone_shield',
  'runeward_wraithbone_shield',
  'aegis_wraithbone_shield',
  'vigil_wraithbone_shield',
]

describe('The Corporeal Horror — monster data', () => {
  it('is a quest-gated boss with 2000 hitpoints and a 5-credit skip', () => {
    expect(boss.boss).toBe(true)
    expect(boss.hitpoints).toBe(2000)
    expect(boss.skipCost).toBe(5)
    expect(boss.questRequirement).toBe('the_heart_of_shadows')
  })

  it('halves damage from anything that is not a spear', () => {
    expect(getMonsterResistance(boss)).toEqual({ multiplier: 0.5, exemptWeaponClass: 'spear' })
    expect(monsterDamageMultiplier(boss, itemsData.krylth_spear)).toBe(1)
    expect(monsterDamageMultiplier(boss, itemsData.abyssal_whip ?? { id: 'x' })).toBe(0.5)
    expect(monsterDamageMultiplier(boss, null)).toBe(0.5)
  })

  it('spawns the Dread Core as a second monster rather than switching into it', () => {
    // A form change swaps one monster's stats; the Core is a separate enemy that
    // fights alongside the boss, so the boss must NOT be multi-form.
    expect(boss.multiForm).toBeUndefined()
    expect(boss.forms).toBeUndefined()
    expect(boss.spawnsAdd.monsterId).toBe('dread_core')
    expect(boss.spawnsAdd.firstSpawnAfterAttacks).toEqual([4, 7])
    expect(boss.spawnsAdd.respawnAfterAttacks).toEqual([10, 16])
  })

  it('gives the Dread Core its own stat block as a drop-less, unpickable add', () => {
    const core = monsters.dread_core
    expect(core.isAdd).toBe(true)
    expect(core.summonedBy).toBe('corporeal_horror')
    expect(core.prayerDrainPerHit).toBe(8)
    // The Core is the punish, not the damage — and it must be killable quickly
    // enough to be worth switching to.
    expect(core.maxHit).toBeLessThan(boss.maxHit)
    expect(core.hitpoints).toBeLessThan(boss.hitpoints / 5)
    expect(core.drops).toEqual([])
  })

  it('drops every unique plus the OSRS-shaped secondaries', () => {
    const byId = Object.fromEntries(boss.drops.map((d: any) => [d.itemId, d]))
    for (const id of UNIQUES) expect(byId[id], `missing drop ${id}`).toBeDefined()
    expect(byId.wraithbone_shield.chance).toBeCloseTo(1 / 64, 6)
    expect(byId.sanctified_elixir.chance).toBeCloseTo(1 / 128, 6)
    for (const sigil of ['runeward_sigil', 'aegis_sigil', 'vigil_sigil']) {
      expect(byId[sigil].chance).toBeCloseTo(1 / 1365, 5)
    }
    for (const id of ['onyx_bolt_e', 'blue_charm', 'red_charm', 'green_charm', 'clue_scroll_elite']) {
      expect(byId[id], `missing drop ${id}`).toBeDefined()
    }
    // The boss requires a spear; dropping one would collapse its gear check.
    expect(boss.drops.some((d: any) => itemsData[d.itemId]?.weaponClass === 'spear')).toBe(false)
  })

  it('every drop resolves to a real item', () => {
    for (const drop of boss.drops) expect(itemsData[drop.itemId], `unknown ${drop.itemId}`).toBeDefined()
  })
})

describe('The Corporeal Horror — shield chain', () => {
  it('marks all uniques and crafted shields as boss uniques with a positive value', () => {
    for (const id of [...UNIQUES, ...CRAFTED]) {
      const item = itemsData[id]
      expect(item, `${id} missing`).toBeDefined()
      expect(item.isBossUnique, `${id} isBossUnique`).toBe(true)
      expect(Number.isFinite(item.shopValue) && item.shopValue > 0).toBe(true)
    }
  })

  it('chains elixir → hallowed → sigil → finished shield', () => {
    expect(itemsData.sanctified_elixir.combineWith).toBe('wraithbone_shield')
    expect(itemsData.sanctified_elixir.combineResult).toBe('hallowed_wraithbone_shield')
    for (const [sigil, result] of [
      ['runeward_sigil', 'runeward_wraithbone_shield'],
      ['aegis_sigil', 'aegis_wraithbone_shield'],
      ['vigil_sigil', 'vigil_wraithbone_shield'],
    ]) {
      expect(itemsData[sigil].combineWith).toBe('hallowed_wraithbone_shield')
      expect(itemsData[sigil].combineResult).toBe(result)
    }
  })

  it('gives Runeward +10 magic damage and the shields a shield slot', () => {
    expect(itemsData.runeward_wraithbone_shield.otherBonus.magicDamage).toBe(10)
    expect(itemsData.runeward_wraithbone_shield.attackBonus.magic).toBe(20)
    for (const id of ['wraithbone_shield', ...CRAFTED]) expect(itemsData[id].slot).toBe('shield')
  })

  it('scales defence upward through the chain', () => {
    const stab = (id: string) => itemsData[id].defenceBonus.stab
    expect(stab('wraithbone_shield')).toBeLessThan(stab('hallowed_wraithbone_shield'))
    expect(stab('hallowed_wraithbone_shield')).toBeLessThan(stab('aegis_wraithbone_shield'))
  })
})

describe('spear resistance', () => {
  it('never turns a landed hit into a miss', () => {
    expect(applyMonsterResistance(1, boss, null)).toBe(1)
    expect(applyMonsterResistance(0, boss, null)).toBe(0)
  })

  it('halves non-spear damage and leaves spear damage intact', () => {
    expect(applyMonsterResistance(40, boss, null)).toBe(20)
    expect(applyMonsterResistance(41, boss, null)).toBe(20)
    expect(applyMonsterResistance(40, boss, itemsData.krylth_spear)).toBe(40)
  })

  it('is a no-op for monsters with no resistance', () => {
    expect(applyMonsterResistance(40, monstersData.king_black_dragon, null)).toBe(40)
    expect(monsterDamageMultiplier(monstersData.king_black_dragon, null)).toBe(1)
  })

  it('ignores a malformed resistance block', () => {
    expect(getMonsterResistance({ resistance: { multiplier: 1 } })).toBeNull()
    expect(getMonsterResistance({ resistance: { multiplier: -1 } })).toBeNull()
    expect(getMonsterResistance({ resistance: { multiplier: 'half' } })).toBeNull()
  })
})

describe('Aegis damage reduction', () => {
  const equipment = { shield: { itemId: 'aegis_wraithbone_shield' } }
  const perk = getDamageReductionPerk(getEquipmentBonuses(equipment, itemsData))

  it('is read off the worn shield as a 70%/25% perk', () => {
    expect(perk).toEqual({ chance: 0.7, percent: 25 })
    expect(getDamageReductionPerk(getEquipmentBonuses({ shield: { itemId: 'dragon_kiteshield' } }, itemsData))).toBeNull()
  })

  it('cuts a quarter of a hit when it procs and nothing when it does not', () => {
    expect(applyDamageReduction(40, perk, () => 0)).toBe(30)
    expect(applyDamageReduction(40, perk, () => 0.99)).toBe(40)
    expect(applyDamageReduction(0, perk, () => 0)).toBe(0)
  })

  it('reduces every hit of a multi-hit swing so hits still sum to the total', () => {
    const out = applySwingDamageReduction(40, [20, 20], perk, () => 0)
    expect(out.reduced).toBe(true)
    expect(out.hits).toEqual([15, 15])
    expect(out.damage).toBe(30)
    expect(out.hits!.reduce((s, h) => s + h, 0)).toBe(out.damage)
  })

  it('passes a swing through untouched when the proc fails', () => {
    const out = applySwingDamageReduction(40, [20, 20], perk, () => 1)
    expect(out).toEqual({ damage: 40, hits: [20, 20], reduced: false })
  })

  it('models the proc as an expected multiplier for the idle sim', () => {
    expect(expectedDamageMultiplier(perk)).toBeCloseTo(0.825, 6)
    expect(expectedDamageMultiplier(null)).toBe(1)
  })
})

describe('Vigil prayer drain reduction', () => {
  it('authors perk values as 0-100 percentages so the equipment screen can render them', () => {
    expect(itemsData.aegis_wraithbone_shield.otherBonus.damageReductionChance).toBe(70)
    expect(itemsData.aegis_wraithbone_shield.otherBonus.damageReductionPercent).toBe(25)
    expect(itemsData.vigil_wraithbone_shield.otherBonus.prayerDrainReduction).toBe(50)
  })

  it('halves drain while the shield is worn', () => {
    const worn = getPrayerDrainMultiplier(getEquipmentBonuses({ shield: { itemId: 'vigil_wraithbone_shield' } }, itemsData))
    expect(worn).toBe(0.5)
    expect(getPrayerDrainMultiplier(getEquipmentBonuses({}, itemsData))).toBe(1)
  })

  it('makes the pool last twice as long in live combat', () => {
    const prayerId = Object.keys(prayers as Record<string, any>)
      .find((id) => Number((prayers as Record<string, any>)[id]?.drainPerMinute) > 0)!
    const ticksToEmpty = (multiplier: number) => {
      const state: any = { prayerPoints: 20, maxPrayerPoints: 20, prayerDrainAccumulator: 0, activeCombatPrayer: prayerId }
      let ticks = 0
      while (state.prayerPoints > 0 && ticks < 100000) {
        applyPrayerDrainTick(state, prayers as any, multiplier)
        ticks++
      }
      return ticks
    }
    const full = ticksToEmpty(1)
    const halved = ticksToEmpty(0.5)
    expect(halved).toBeGreaterThan(full * 1.8)
  })

  it('treats a missing or malformed multiplier as no reduction', () => {
    const drainOnce = (multiplier: any) => {
      const prayerId = Object.keys(prayers as Record<string, any>)
        .find((id) => Number((prayers as Record<string, any>)[id]?.drainPerMinute) > 0)!
      const state: any = { prayerPoints: 20, prayerDrainAccumulator: 0.99, activeCombatPrayer: prayerId }
      applyPrayerDrainTick(state, prayers as any, multiplier)
      return state.prayerPoints
    }
    expect(drainOnce(undefined)).toBe(drainOnce(1))
    expect(drainOnce(NaN)).toBe(drainOnce(1))
  })
})

describe('The Corporeal Horror — content wiring', () => {
  it('has a collection log section covering every unique and crafted shield', () => {
    const section = (collectionLog as any).categories
      .flatMap((c: any) => c.sections)
      .find((s: any) => s.id === 'corporeal_horror')
    expect(section, 'collection log section missing').toBeDefined()
    for (const id of [...UNIQUES, ...CRAFTED]) {
      expect(section.items, `${id} missing from collection log`).toContain(id)
    }
  })

  it('has a Grandmaster daily task', () => {
    const task = (dailyTasks as any[]).find((t) => t.id === 'slay_corporeal_horror')
    expect(task).toBeDefined()
    expect(task.tier).toBe('Grandmaster')
    expect(task.trigger).toEqual({ type: 'boss_kill', monsterId: 'corporeal_horror', target: 3 })
  })

  it('is startable at a world place', () => {
    const places = Object.entries(worldActivities as Record<string, any[]>)
      .filter(([, acts]) => acts.some((a) => a.kind === 'combat' && a.ref === 'corporeal_horror'))
      .map(([id]) => id)
    expect(places).toContain('edgevale')
  })
})
