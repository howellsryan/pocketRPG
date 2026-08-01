import { describe, it, expect } from 'vitest'
import {
  HARD_MODE_MULTIPLIERS,
  hardModeDeathLoss,
  hardModeDropChance,
  hardModeMonstersData,
  hardModeSkipCost,
  monstersTableFor,
  scaleMonsterForHardMode,
  supportsHardMode,
} from '../src/engine/hardMode.js'
import monstersData from '../src/data/monsters.json'
import raidsData from '../src/data/raids.json'
import { createCombatState, createRaidCombatState } from '../src/engine/combat.js'
import { monsterMaxHit } from '../src/engine/monsterMaxHit.js'

const anyMonsters = monstersData as Record<string, any>
const anyRaids = raidsData as Record<string, any>

describe('hard mode scaling', () => {
  it('scales health and offence, and leaves defence exactly where it was', () => {
    const base = {
      id: 'x', hitpoints: 255, maxHit: 40, attackStyle: 'crush',
      stats: { attack: 100, strength: 120, defence: 130, magic: 200, ranged: 1 },
      attackBonus: 130, strengthBonus: 40,
      defenceBonus: { stab: 10, slash: 20, crush: 30, magic: 90, ranged: 0 },
    }
    const hard = scaleMonsterForHardMode(base)
    expect(hard.hitpoints).toBe(255 * HARD_MODE_MULTIPLIERS.hitpoints)
    expect(hard.maxHit).toBe(40 * HARD_MODE_MULTIPLIERS.offence)
    expect(hard.attackBonus).toBe(130 * HARD_MODE_MULTIPLIERS.offence)
    expect(hard.strengthBonus).toBe(40 * HARD_MODE_MULTIPLIERS.offence)
    expect(hard.stats.attack).toBe(100 * HARD_MODE_MULTIPLIERS.offence)
    expect(hard.stats.strength).toBe(120 * HARD_MODE_MULTIPLIERS.offence)
    expect(hard.stats.ranged).toBe(1 * HARD_MODE_MULTIPLIERS.offence)
    // The whole point of the mode: it is deadlier, not tankier.
    expect(hard.stats.defence).toBe(130)
    expect(hard.defenceBonus).toEqual(base.defenceBonus)
  })

  it('treats a caster’s magic level as offence and a brawler’s as defence', () => {
    const stats = { attack: 10, strength: 10, defence: 10, magic: 200, ranged: 10 }
    // 70% of every monster's magic defence roll is its magic LEVEL, so scaling
    // it on a melee boss would be the defensive buff this mode withholds.
    const melee = scaleMonsterForHardMode({ id: 'a', attackStyle: 'crush', stats })
    expect(melee.stats.magic).toBe(200)

    const caster = scaleMonsterForHardMode({ id: 'b', attackStyle: 'magic', stats })
    expect(caster.stats.magic).toBe(200 * HARD_MODE_MULTIPLIERS.offence)

    const rotates = scaleMonsterForHardMode({
      id: 'c', attackStyle: 'crush', stats, multiForm: true,
      forms: { one: { attackStyle: 'crush' }, two: { attackStyle: 'magic' } },
    })
    expect(rotates.stats.magic).toBe(200 * HARD_MODE_MULTIPLIERS.offence)
  })

  it('reads every multiplier from one config, so the fight is retunable', () => {
    expect(Object.keys(HARD_MODE_MULTIPLIERS).sort())
      .toEqual(['defence', 'dropRate', 'hitpoints', 'offence', 'skipCost'])
    expect(HARD_MODE_MULTIPLIERS.defence).toBe(1)
  })

  it('leaves the drop table alone — doubling loot is the server’s call', () => {
    const base = { id: 'x', hitpoints: 10, drops: [{ itemId: 'coins', quantity: 5, chance: 0.25 }] }
    expect(scaleMonsterForHardMode(base).drops).toEqual(base.drops)
  })

  it('is idempotent, because the active task persists the scaled record', () => {
    const once = scaleMonsterForHardMode({ id: 'x', hitpoints: 100, stats: { strength: 50 } })
    const twice = scaleMonsterForHardMode(once)
    expect(twice.hitpoints).toBe(200)
    expect(twice.stats.strength).toBe(100)
    expect(twice).toBe(once)
  })

  it('scales every form, including a phased boss’s own health bar', () => {
    const base = {
      id: 'x', multiForm: true, hitpoints: 100, verzikPhased: true,
      forms: {
        one: { maxHit: 30, attackBonus: 50, strengthBonus: 50, phaseHP: 2000, defenceBonus: { magic: 200 } },
        two: { maxHit: 41, attackBonus: 60, strengthBonus: 60, phaseHP: 3250, defenceBonus: { magic: 300 } },
      },
    }
    const hard = scaleMonsterForHardMode(base)
    const { hitpoints: hp, offence, defence } = HARD_MODE_MULTIPLIERS
    expect(hard.forms.one).toMatchObject({
      maxHit: 30 * offence, attackBonus: 50 * offence, strengthBonus: 50 * offence, phaseHP: 2000 * hp,
    })
    expect(hard.forms.two.defenceBonus.magic).toBe(300 * defence)
  })

  it('leaves a malformed form entry alone rather than throwing', () => {
    const hard = scaleMonsterForHardMode({ id: 'x', hitpoints: 10, forms: { broken: null, also: 'nonsense' } } as any)
    expect(hard.forms.broken).toBeNull()
    expect(hard.forms.also).toBe('nonsense')
  })

  it('raises the max hit a fight actually reports', () => {
    const boss = anyMonsters.deepmaw_kraken
    const hard = scaleMonsterForHardMode(boss)
    expect(monsterMaxHit(hard)).toBeGreaterThan(monsterMaxHit(boss))
  })

  it('only opted-in content offers hard mode', () => {
    expect(supportsHardMode(anyMonsters.field_chicken)).toBe(false)
    expect(supportsHardMode({ hardMode: true })).toBe(true)
    const bosses = Object.values(anyMonsters).filter((m: any) => m.boss === true)
    expect(bosses.some((m: any) => m.hardMode === true)).toBe(true)
    // A raid's bosses are fought through the raid, which carries the flag.
    const raidBossIds = new Set(Object.values(anyRaids).flatMap((r: any) => r.bosses))
    for (const [id, m] of Object.entries(anyMonsters)) {
      if ((m as any).hardMode) expect(raidBossIds.has(id)).toBe(false)
    }
    expect(Object.values(anyRaids).every((r: any) => r.hardMode === true)).toBe(true)
  })
})

describe('hard mode drop chances (server-side only)', () => {
  it('doubles a chance and clamps a guaranteed drop at 1', () => {
    expect(hardModeDropChance(0.002, true)).toBeCloseTo(0.004)
    expect(hardModeDropChance(0.6, true)).toBe(1)
    expect(hardModeDropChance(1, true)).toBe(1)
  })

  it('is a no-op when hard mode is off', () => {
    expect(hardModeDropChance(0.25, false)).toBe(0.25)
    expect(hardModeDropChance(undefined as any, true)).toBe(0)
  })
})

describe('hard mode tables', () => {
  it('scales every entry and memoises the table', () => {
    const table = hardModeMonstersData(anyMonsters)
    expect(table.deepmaw_kraken.hitpoints).toBe(anyMonsters.deepmaw_kraken.hitpoints * HARD_MODE_MULTIPLIERS.hitpoints)
    expect(hardModeMonstersData(anyMonsters)).toBe(table)
    expect(monstersTableFor(anyMonsters, false)).toBe(anyMonsters)
  })

  it('a hard fight opens on doubled health without any engine change', () => {
    const normal = createCombatState(anyMonsters.deepmaw_kraken, 'melee', 'accurate', null, anyMonsters)
    const hard = createCombatState(
      scaleMonsterForHardMode(anyMonsters.deepmaw_kraken), 'melee', 'accurate', null, hardModeMonstersData(anyMonsters),
    )
    expect(hard.monster.currentHP).toBe(normal.monster.currentHP * HARD_MODE_MULTIPLIERS.hitpoints)
  })

  it('a hard raid scales every boss in the run, not just the first', () => {
    const raid = anyRaids.vaults_of_xyren
    const hardTable = hardModeMonstersData(anyMonsters)
    const state = createRaidCombatState(raid, hardTable, 'melee', 'accurate', null)!
    expect(state.monster.currentHP).toBe(anyMonsters[raid.bosses[0]].hitpoints * HARD_MODE_MULTIPLIERS.hitpoints)
    for (const bossId of raid.bosses) {
      expect(state.raid.monstersData[bossId].hitpoints).toBe(anyMonsters[bossId].hitpoints * HARD_MODE_MULTIPLIERS.hitpoints)
    }
  })
})

describe('hard mode skip cost', () => {
  it('doubles the credits a hard kill costs to buy, and floors at one', () => {
    expect(hardModeSkipCost(10, true)).toBe(20)
    expect(hardModeSkipCost(10, false)).toBe(10)
    expect(hardModeSkipCost(undefined, true)).toBe(2)
  })

  it('carries the doubled cost on the scaled record the prompt reads', () => {
    const scaled = scaleMonsterForHardMode({ id: 'x', hitpoints: 10, skipCost: 6 })
    expect(scaled.skipCost).toBe(12)
  })
})

describe('a hard-mode death', () => {
  const pack = [
    { itemId: 'shark', quantity: 12 },
    null,
    { itemId: 'twisted_longbow', quantity: 1 },
    { itemId: 'shark', quantity: 3 },
  ]
  const worn = {
    weapon: { itemId: 'dragon_scimitar', quantity: 1 },
    cape: { itemId: 'fire_cape', quantity: 1 },
    ring: null,
  }

  it('empties the pack and strips the gear, keeping the slot count', () => {
    const loss = hardModeDeathLoss(pack, worn)
    expect(loss.inventory).toEqual([null, null, null, null])
    expect(loss.equipment).toEqual({})
  })

  it('tallies what was lost, stacking repeats, for the death screen', () => {
    const loss = hardModeDeathLoss(pack, worn)
    expect(loss.lost).toEqual([
      { itemId: 'shark', quantity: 15 },
      { itemId: 'twisted_longbow', quantity: 1 },
      { itemId: 'dragon_scimitar', quantity: 1 },
      { itemId: 'fire_cape', quantity: 1 },
    ])
  })

  it('survives an empty or missing pack', () => {
    expect(hardModeDeathLoss([], {})).toEqual({ inventory: [], equipment: {}, lost: [] })
    expect(hardModeDeathLoss(undefined as any, undefined as any)).toEqual({ inventory: [], equipment: {}, lost: [] })
  })
})
