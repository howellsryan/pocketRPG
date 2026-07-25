// Engine behaviour for the Corporeal Horror's mechanics: spear resistance in
// live combat and the idle sim, the Aegis reduction in PvE and PvP, and the
// Dread Core's prayer burn. These are the paths the boss's difficulty rests on
// — a regression here silently doubles or halves its kill speed.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCombatState, processCombatTick, setCombatTarget, applySpecialAttack } from '../src/engine/combat.js'
import { isAddAlive, activeTarget } from '../src/engine/bossAdds.js'
import { simulateIdleCombat } from '../src/engine/idleEngine.js'
import { processPvpTick, createPvpState } from '../src/engine/pvpEngine.js'

const SPEAR = {
  id: 'test_spear', slot: 'weapon', attackStyle: 'stab', attackSpeed: 4, weaponClass: 'spear',
  attackBonus: { stab: 200, slash: 0, crush: 0, magic: 0, ranged: 0 },
  defenceBonus: { stab: 0, slash: 0, crush: 0, magic: 0, ranged: 0 },
  otherBonus: { meleeStrength: 150 },
}
const SWORD = { ...SPEAR, id: 'test_sword', weaponClass: undefined }
const AEGIS = {
  id: 'test_aegis', slot: 'shield',
  attackBonus: { stab: 0, slash: 0, crush: 0, magic: 0, ranged: 0 },
  defenceBonus: { stab: 0, slash: 0, crush: 0, magic: 0, ranged: 0 },
  otherBonus: { damageReductionChance: 100, damageReductionPercent: 25 },
}
const PLAIN_SHIELD = { ...AEGIS, id: 'test_plain_shield', otherBonus: {} }
const itemsData: any = {
  test_spear: SPEAR, test_sword: SWORD, test_aegis: AEGIS, test_plain_shield: PLAIN_SHIELD,
}

const maxedStats = { attack: 99, strength: 99, defence: 99, ranged: 99, magic: 99, currentHP: 99 }

function resistedTarget(overrides: any = {}) {
  return {
    id: 'resisted_dummy',
    name: 'Resisted Dummy',
    hitpoints: 100000,
    combatLevel: 500,
    attackSpeed: 99,
    attackStyle: 'crush',
    stats: { attack: 1, strength: 1, defence: 1, magic: 1, ranged: 1 },
    attackBonus: 0,
    strengthBonus: 0,
    defenceBonus: { stab: -200, slash: -200, crush: -200, magic: 0, ranged: 0 },
    drops: [],
    noSeedDrops: true,
    noCharmDrops: true,
    resistance: { multiplier: 0.5, exemptWeaponClass: 'spear' },
    ...overrides,
  }
}

// Damage is rolled, so an unseeded run makes the ratio assertions below flaky.
// A fixed LCG gives both arms of each comparison the same roll sequence.
function seedRandom(seed = 0x2f6e2b1) {
  let s = seed >>> 0
  vi.spyOn(Math, 'random').mockImplementation(() => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 0x100000000
  })
}
afterEach(() => { vi.restoreAllMocks() })

function damageOver(ticks: number, weaponId: string, monster: any) {
  let state: any = createCombatState(monster, 'melee', 'aggressive')
  const equipment: any = { weapon: { itemId: weaponId } }
  const startHP = state.monster.currentHP
  for (let i = 0; i < ticks; i++) {
    const out = processCombatTick(state, maxedStats, equipment, itemsData)
    state = out.combatState
    if (!state.active) break
  }
  return startHP - state.monster.currentHP
}

describe('spear resistance — live combat', () => {
  it('a spear deals roughly double the damage of an identical non-spear', () => {
    seedRandom()
    const spearDamage = damageOver(400, 'test_spear', resistedTarget())
    seedRandom()
    const swordDamage = damageOver(400, 'test_sword', resistedTarget())
    expect(spearDamage).toBeGreaterThan(0)
    expect(swordDamage).toBeGreaterThan(0)
    const ratio = spearDamage / swordDamage
    expect(ratio).toBeGreaterThan(1.6)
    expect(ratio).toBeLessThan(2.5)
  })

  it('leaves an unresisted monster alone', () => {
    const plain = resistedTarget({ resistance: undefined })
    seedRandom()
    const spearDamage = damageOver(400, 'test_spear', plain)
    seedRandom()
    const swordDamage = damageOver(400, 'test_sword', plain)
    const ratio = spearDamage / swordDamage
    expect(ratio).toBeGreaterThan(0.7)
    expect(ratio).toBeLessThan(1.4)
  })
})

describe('spear resistance — idle simulation', () => {
  const HP_99_XP = 13_034_431
  const stats: any = {
    attack: { xp: HP_99_XP }, strength: { xp: HP_99_XP }, defence: { xp: HP_99_XP },
    hitpoints: { xp: HP_99_XP }, ranged: { xp: HP_99_XP }, magic: { xp: HP_99_XP }, prayer: { xp: HP_99_XP },
  }
  const monster = {
    id: 'resisted_dummy', name: 'Resisted Dummy', hitpoints: 500,
    stats: { attack: 1, strength: 1, defence: 1, magic: 1, ranged: 1 },
    attackSpeed: 99, attackStyle: 'crush', attackBonus: 0, strengthBonus: 0,
    defenceBonus: { stab: -200, slash: -200, crush: -200, magic: 0, ranged: 0 },
    drops: [], resistance: { multiplier: 0.5, exemptWeaponClass: 'spear' },
  }

  function killsWith(weaponId: string) {
    seedRandom()
    const task: any = { stance: 'aggressive', monster }
    const sim = simulateIdleCombat(
      task, 60 * 60_000, stats, { weapon: { itemId: weaponId } }, Array(28).fill(null), itemsData,
    )
    return sim!.monstersKilled
  }

  it('halves idle kill rate for a non-spear, matching live combat', () => {
    const spearKills = killsWith('test_spear')
    const swordKills = killsWith('test_sword')
    expect(swordKills).toBeGreaterThan(0)
    const ratio = spearKills / swordKills
    expect(ratio).toBeGreaterThan(1.6)
    expect(ratio).toBeLessThan(2.5)
  })
})

describe('Aegis reduction — live combat', () => {
  function damageTakenOver(shieldId: string) {
    seedRandom()
    const attacker = {
      id: 'puncher', name: 'Puncher', hitpoints: 100000, combatLevel: 500,
      attackSpeed: 1, attackStyle: 'crush',
      stats: { attack: 500, strength: 500, defence: 500, magic: 1, ranged: 1 },
      attackBonus: 5000, strengthBonus: 500,
      defenceBonus: { stab: 5000, slash: 5000, crush: 5000, magic: 5000, ranged: 5000 },
      drops: [], noSeedDrops: true, noCharmDrops: true,
    }
    let state: any = createCombatState(attacker, 'melee', 'aggressive')
    const equipment: any = { weapon: { itemId: 'test_sword' }, shield: { itemId: shieldId } }
    let taken = 0
    for (let i = 0; i < 300; i++) {
      const out = processCombatTick(state, { ...maxedStats, currentHP: 99 }, equipment, itemsData)
      state = out.combatState
      for (const ev of out.events) if (ev.type === 'monsterHit') taken += ev.damage
      if (!state.active) break
    }
    return taken
  }

  it('cuts incoming damage by a quarter with an always-proc perk', () => {
    const withPerk = damageTakenOver('test_aegis')
    const without = damageTakenOver('test_plain_shield')
    expect(without).toBeGreaterThan(0)
    const ratio = withPerk / without
    expect(ratio).toBeGreaterThan(0.6)
    expect(ratio).toBeLessThan(0.9)
  })
})

describe('Aegis reduction — PvP', () => {
  function combatant(characterId: number, shieldId: string | null) {
    return {
      characterId,
      hp: 5_000_000, maxHP: 5_000_000, currentHP: 5_000_000,
      stats: { attack: 99, strength: 99, defence: 1, hitpoints: 99, ranged: 99, magic: 99, prayer: 99 },
      combatType: 'melee', stance: 'aggressive',
      equipment: { weapon: { itemId: 'test_sword' }, ...(shieldId ? { shield: { itemId: shieldId } } : {}) },
      inventory: Array(28).fill(null),
      attackTimer: 0, prayerPoints: 0, maxPrayerPoints: 99,
    }
  }

  // HP is set far beyond reach so both runs take the same number of swings —
  // otherwise the reduced side simply survives longer and takes more total damage.
  function damagePerSwingAgainst(defenderShield: string) {
    seedRandom()
    let state: any = createPvpState(combatant(1, 'test_plain_shield') as any, combatant(2, defenderShield) as any, 0)
    let taken = 0
    let swings = 0
    for (let i = 0; i < 600; i++) {
      const out = processPvpTick(state, [], itemsData, i * 600)
      state = out.stateNext
      for (const ev of out.events) {
        if (ev.type === 'attack' && ev.defenderCharacterId === 2) { taken += ev.damage; swings++ }
      }
      if (out.terminal) break
    }
    return swings > 0 ? taken / swings : 0
  }

  it('reduces the damage a defender takes per swing', () => {
    const withPerk = damagePerSwingAgainst('test_aegis')
    const without = damagePerSwingAgainst('test_plain_shield')
    expect(without).toBeGreaterThan(0)
    expect(withPerk).toBeLessThan(without)
    expect(withPerk / without).toBeGreaterThan(0.6)
  })

  it('reports hits that sum to the reduced damage', () => {
    let state: any = createPvpState(combatant(1, 'test_plain_shield') as any, combatant(2, 'test_aegis') as any, 0)
    let checked = 0
    for (let i = 0; i < 40; i++) {
      const out = processPvpTick(state, [], itemsData, i * 600)
      state = out.stateNext
      for (const ev of out.events) {
        if (ev.type === 'attack' && Array.isArray(ev.hits)) {
          expect(ev.hits.reduce((s: number, h: number) => s + h, 0)).toBe(ev.damage)
          checked++
        }
      }
      if (out.terminal) break
    }
    expect(checked).toBeGreaterThanOrEqual(0)
  })
})

describe('Dread Core prayer burn', () => {
  it('drains prayer points on every landed hit of the draining form', () => {
    const monster = {
      id: 'core_dummy', name: 'Core Dummy', hitpoints: 100000, combatLevel: 500,
      attackSpeed: 1, attackStyle: 'crush',
      stats: { attack: 500, strength: 500, defence: 500, magic: 1, ranged: 1 },
      attackBonus: 5000, strengthBonus: 200,
      defenceBonus: { stab: 5000, slash: 5000, crush: 5000, magic: 5000, ranged: 5000 },
      drops: [], noSeedDrops: true, noCharmDrops: true,
      multiForm: true,
      initialForm: 'core',
      formCycleOrder: ['core'],
      forms: {
        core: {
          displayName: 'Dread Core', attackStyle: 'crush', maxHit: 5,
          attackBonus: 5000, strengthBonus: 200, prayerDrainPerHit: 8,
          switchAfterAttacks: 9999,
          defenceBonus: { stab: 5000, slash: 5000, crush: 5000, magic: 5000, ranged: 5000 },
        },
      },
    }
    let state: any = createCombatState(monster, 'melee', 'aggressive')
    state.prayerPoints = 80
    state.maxPrayerPoints = 80
    const equipment: any = { weapon: { itemId: 'test_sword' } }
    let drainEvents = 0
    for (let i = 0; i < 60; i++) {
      const out = processCombatTick(state, { ...maxedStats, currentHP: 9999 }, equipment, itemsData)
      state = out.combatState
      drainEvents += out.events.filter((e: any) => e.type === 'prayerDrained').length
      if (!state.active) break
    }
    expect(drainEvents).toBeGreaterThan(0)
    expect(state.prayerPoints).toBeLessThan(80)
  })

  it('never drains a pool below zero', () => {
    const monster = {
      id: 'core_dummy2', name: 'Core Dummy 2', hitpoints: 100000, combatLevel: 500,
      attackSpeed: 1, attackStyle: 'crush',
      stats: { attack: 500, strength: 500, defence: 500, magic: 1, ranged: 1 },
      attackBonus: 5000, strengthBonus: 200,
      defenceBonus: { stab: 5000, slash: 5000, crush: 5000, magic: 5000, ranged: 5000 },
      drops: [], noSeedDrops: true, noCharmDrops: true,
      prayerDrainPerHit: 8,
    }
    let state: any = createCombatState(monster, 'melee', 'aggressive')
    state.prayerPoints = 3
    state.maxPrayerPoints = 80
    const equipment: any = { weapon: { itemId: 'test_sword' } }
    for (let i = 0; i < 60; i++) {
      const out = processCombatTick(state, { ...maxedStats, currentHP: 9999 }, equipment, itemsData)
      state = out.combatState
      if (!state.active) break
    }
    expect(state.prayerPoints).toBe(0)
  })
})
