// A prayer's `magicDamagePercent` raises a spell's max hit, the one number a
// level boost cannot reach: magicMaxHit() is a function of the spell's base
// damage and magic-damage percentage points, with no level term. Augury was
// therefore accuracy-only from the day it shipped. These lock the bonus into
// every path that computes magic damage.

import { describe, expect, it, vi, afterEach } from 'vitest'
import { createCombatState, processCombatTick } from '../src/engine/combat.js'
import { simulateIdleCombat } from '../src/engine/idleEngine.js'
import { getPrayerMagicDamageBonus } from '../src/engine/prayerCombatBonuses.js'
import { estimateDps } from '../src/engine/dpsCalculator.js'
import { magicMaxHit } from '../src/engine/formulas.js'
import realPrayers from '../src/data/prayers.json'

const prayersData: any = realPrayers

const spell = { id: 'test_blast', name: 'Test Blast', baseDamage: 40, baseXP: 20, runeReq: {} }

const itemsData: any = {
  plain_staff: {
    id: 'plain_staff', slot: 'weapon', attackStyle: 'magic', attackSpeed: 4,
    attackBonus: { stab: 0, slash: 0, crush: 0, magic: 60, ranged: 0 },
    defenceBonus: { stab: 0, slash: 0, crush: 0, magic: 0, ranged: 0 },
    // No worn magicDamage, so the only percentage points in play are the
    // prayer's — the test measures exactly one thing.
    otherBonus: { meleeStrength: 0, rangedStrength: 0, magicDamage: 0 },
  },
}

function buildMonster(hitpoints = 999999) {
  return {
    id: 'test_target', name: 'Test Target', hitpoints, combatLevel: 1, attackSpeed: 99, attackStyle: 'crush',
    stats: { attack: 1, strength: 1, defence: 1, magic: 1, ranged: 1 },
    attackBonus: 0, strengthBonus: 0,
    defenceBonus: { stab: -90, slash: -90, crush: -90, magic: -90, ranged: -90 },
    drops: [],
  }
}

const maxedStats = { attack: 99, strength: 99, defence: 99, ranged: 99, magic: 99, prayer: 99, currentHP: 99 }

afterEach(() => { vi.restoreAllMocks() })

// First Math.random() is rollDamage's hit-chance check (0 always hits); the
// second is randInt(1, maxHit)'s roll — just under 1 lands exactly maxHit.
function forceMaxDamageRoll() {
  vi.spyOn(Math, 'random').mockReturnValueOnce(0).mockReturnValueOnce(0.999999999)
}

function liveMaxHit(activeCombatPrayer: string | null) {
  const state: any = createCombatState(buildMonster(), 'magic', 'accurate', spell)
  state.activeCombatPrayer = activeCombatPrayer
  state.prayerPoints = 99
  state.maxPrayerPoints = 99
  forceMaxDamageRoll()
  const { events } = processCombatTick(
    state, maxedStats, { weapon: { itemId: 'plain_staff' } }, itemsData, prayersData, [], null,
  )
  const hit = events.find((e: any) => e.type === 'playerHit')
  expect(hit).toBeDefined()
  return hit!.damage as number
}

describe('the prayer magic-damage helper reads the data field', () => {
  it('reports Augury as granting magic damage', () => {
    expect(prayersData.augury.magicDamagePercent).toBe(5)
    expect(getPrayerMagicDamageBonus(['augury'], prayersData)).toBe(5)
  })

  it('reports nothing for a prayer without the field, or for no prayer', () => {
    expect(getPrayerMagicDamageBonus(['mystic_will'], prayersData)).toBe(0)
    expect(getPrayerMagicDamageBonus([null], prayersData)).toBe(0)
    expect(getPrayerMagicDamageBonus([], prayersData)).toBe(0)
  })

  it('sums across the slots it is handed', () => {
    expect(getPrayerMagicDamageBonus(['augury', 'augury'], prayersData)).toBe(10)
  })
})

describe('Augury raises magic max hit in live combat, not just accuracy', () => {
  it('adds 5 percentage points of magic damage to a spell cast', () => {
    const withoutPrayer = liveMaxHit(null)
    const withAugury = liveMaxHit('augury')

    expect(withoutPrayer).toBe(magicMaxHit(spell.baseDamage, 0))
    expect(withAugury).toBe(magicMaxHit(spell.baseDamage, 5))
    expect(withAugury).toBeGreaterThan(withoutPrayer)
  })

  it('leaves max hit alone for a magic prayer that only boosts the level', () => {
    expect(liveMaxHit('mystic_will')).toBe(liveMaxHit(null))
  })
})

describe('Augury raises magic damage during idle catch-up too', () => {
  const task: any = { stance: 'accurate', spell, monster: buildMonster(400) }
  const stats: any = {
    magic: { xp: 13_034_431 }, hitpoints: { xp: 13_034_431 }, prayer: { xp: 13_034_431 },
  }
  const equipment: any = { weapon: { itemId: 'plain_staff' } }

  function idleKills(idlePrayers: any) {
    const sim = simulateIdleCombat(
      task, 3_600_000, stats, equipment, Array(28).fill(null), itemsData, null, {},
      // Restores keep the prayer lit for the window, so the comparison measures
      // the damage bonus rather than how fast Augury drains the pool.
      { idlePrayers, prayersData, idlePotions: [{ itemId: 'super_restore', quantity: 5000 }] },
    )
    return sim!.monstersKilled
  }

  it('kills more per hour with Augury than with a level-only magic prayer', () => {
    const mysticWill = idleKills({ combatPrayerId: 'mystic_will' })
    const augury = idleKills({ combatPrayerId: 'augury' })
    expect(mysticWill).toBeGreaterThan(0)
    expect(augury).toBeGreaterThan(mysticWill)
  })
})

describe('the DPS calculator models the same bonus as the fight', () => {
  const target = {
    magicLevel: 1, defenceLevel: 1, hitpoints: 100,
    defenceBonus: { stab: -90, slash: -90, crush: -90, magic: -90, ranged: -90 },
  }
  const params: any = {
    style: 'magic', spell, levels: { ...maxedStats }, equipment: { weapon: { itemId: 'plain_staff' } },
    itemsData, target,
  }

  it('raises modelled max hit by the prayer bonus it is handed', () => {
    const plain = estimateDps({ ...params })
    const withAugury = estimateDps({ ...params, prayerMagicDamagePercent: 5 })

    expect(plain.maxHit).toBe(magicMaxHit(spell.baseDamage, 0))
    expect(withAugury.maxHit).toBe(magicMaxHit(spell.baseDamage, 5))
    expect(withAugury.dps).toBeGreaterThan(plain.dps)
  })

  it('matches the max hit live combat actually rolls under Augury', () => {
    expect(estimateDps({ ...params, prayerMagicDamagePercent: 5 }).maxHit).toBe(liveMaxHit('augury'))
  })
})
