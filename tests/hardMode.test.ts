import { describe, it, expect } from 'vitest'
import {
  HARD_MODE_SCALE,
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
  it('doubles hitpoints, combat stats and combat bonuses', () => {
    const base = {
      id: 'x', hitpoints: 255, maxHit: 40,
      stats: { attack: 100, strength: 120, defence: 130, magic: 200, ranged: 1 },
      attackBonus: 130, strengthBonus: 40,
      defenceBonus: { stab: 10, slash: 20, crush: 30, magic: 90, ranged: 0 },
    }
    const hard = scaleMonsterForHardMode(base)
    expect(hard.hitpoints).toBe(510)
    expect(hard.maxHit).toBe(80)
    expect(hard.stats).toEqual({ attack: 200, strength: 240, defence: 260, magic: 400, ranged: 2 })
    expect(hard.attackBonus).toBe(260)
    expect(hard.strengthBonus).toBe(80)
    expect(hard.defenceBonus).toEqual({ stab: 20, slash: 40, crush: 60, magic: 180, ranged: 0 })
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
    expect(hard.forms.one).toMatchObject({ maxHit: 60, attackBonus: 100, strengthBonus: 100, phaseHP: 4000 })
    expect(hard.forms.two.defenceBonus.magic).toBe(600)
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
    expect(table.deepmaw_kraken.hitpoints).toBe(anyMonsters.deepmaw_kraken.hitpoints * HARD_MODE_SCALE)
    expect(hardModeMonstersData(anyMonsters)).toBe(table)
    expect(monstersTableFor(anyMonsters, false)).toBe(anyMonsters)
  })

  it('a hard fight opens on doubled health without any engine change', () => {
    const normal = createCombatState(anyMonsters.deepmaw_kraken, 'melee', 'accurate', null, anyMonsters)
    const hard = createCombatState(
      scaleMonsterForHardMode(anyMonsters.deepmaw_kraken), 'melee', 'accurate', null, hardModeMonstersData(anyMonsters),
    )
    expect(hard.monster.currentHP).toBe(normal.monster.currentHP * HARD_MODE_SCALE)
  })

  it('a hard raid scales every boss in the run, not just the first', () => {
    const raid = anyRaids.vaults_of_xyren
    const hardTable = hardModeMonstersData(anyMonsters)
    const state = createRaidCombatState(raid, hardTable, 'melee', 'accurate', null)!
    expect(state.monster.currentHP).toBe(anyMonsters[raid.bosses[0]].hitpoints * HARD_MODE_SCALE)
    for (const bossId of raid.bosses) {
      expect(state.raid.monstersData[bossId].hitpoints).toBe(anyMonsters[bossId].hitpoints * HARD_MODE_SCALE)
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
