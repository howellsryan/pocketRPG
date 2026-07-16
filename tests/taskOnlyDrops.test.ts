// Locks the "taskOnly" drop-table flag (used by Imbued Crown/Brain): a
// taskOnly entry must never roll unless the kill is on the player's currently
// assigned slayer task, across all three loot-roll paths (live PvE combat,
// idle simulation, server-authoritative monster completion).

import { describe, expect, it } from 'vitest'
import { createCombatState, processCombatTick } from '../src/engine/combat.js'
import { simulateIdleCombat } from '../src/engine/idleEngine.js'
import { rollMonsterRewardsById } from '../functions/_lib/game/monsterRewards.js'

const itemsData: any = {
  bronze_dagger: {
    id: 'bronze_dagger', slot: 'weapon', attackStyle: 'stab', attackSpeed: 4,
    attackBonus: { stab: 100, slash: 0, crush: 0, magic: 0, ranged: 0 },
    defenceBonus: { stab: 0, slash: 0, crush: 0, magic: 0, ranged: 0 },
    otherBonus: { meleeStrength: 100 },
  },
  rare_charm: { id: 'rare_charm', stackable: false },
}

function buildLowHpMonster(overrides: any = {}) {
  return {
    id: 'training_dummy',
    name: 'Training Dummy',
    hitpoints: 1,
    combatLevel: 1,
    attackSpeed: 99,
    attackStyle: 'crush',
    stats: { attack: 1, strength: 1, defence: 1, magic: 1, ranged: 1 },
    attackBonus: 0,
    strengthBonus: 0,
    defenceBonus: { stab: -50, slash: -50, crush: -50, magic: 0, ranged: 0 },
    slayerRequirement: 1,
    drops: [{ itemId: 'rare_charm', chance: 1.0, quantity: 1, taskOnly: true }],
    noSeedDrops: true,
    ...overrides,
  }
}

const maxedStats = {
  attack: 99, strength: 99, defence: 99, ranged: 99, magic: 99, currentHP: 99,
}
const equipment: any = { weapon: { itemId: 'bronze_dagger' } }

function tickUntilKill(state: any, slayerTask: any, maxTicks = 50) {
  let cur = state
  const allEvents: any[] = []
  for (let i = 0; i < maxTicks; i++) {
    const { combatState, events } = processCombatTick(cur, maxedStats, equipment, itemsData, {}, [], slayerTask)
    allEvents.push(...events)
    cur = combatState
    if (events.some(e => e.type === 'monsterDeath')) break
    if (!cur.active) break
  }
  return { finalState: cur, events: allEvents }
}

describe('live PvE combat — taskOnly drops', () => {
  it('a chance-1.0 taskOnly drop never rolls when the kill is off-task', () => {
    const monster = buildLowHpMonster()
    const state = createCombatState(monster, 'melee', 'accurate')
    const { events } = tickUntilKill(state, null)
    const death = events.find(e => e.type === 'monsterDeath')
    expect(death).toBeDefined()
    expect(death!.loot.some((l: any) => l.itemId === 'rare_charm')).toBe(false)
  })

  it('a chance-1.0 taskOnly drop always rolls when the kill is on-task', () => {
    const monster = buildLowHpMonster()
    const state = createCombatState(monster, 'melee', 'accurate')
    const { events } = tickUntilKill(state, { monsterId: 'training_dummy', monstersRemaining: 5 })
    const death = events.find(e => e.type === 'monsterDeath')
    expect(death).toBeDefined()
    expect(death!.loot.some((l: any) => l.itemId === 'rare_charm')).toBe(true)
  })
})

describe('idle simulation — taskOnly drops', () => {
  const WEAK_GOBLIN = {
    id: 'training_dummy',
    name: 'Training Dummy',
    hitpoints: 1,
    combatLevel: 1,
    attackSpeed: 4,
    attackStyle: 'crush',
    stats: { attack: 1, strength: 1, defence: 1, magic: 1, ranged: 1 },
    attackBonus: 0,
    strengthBonus: 0,
    defenceBonus: { stab: -50, slash: -50, crush: -50, magic: 0, ranged: 0 },
    slayerRequirement: 1,
    drops: [{ itemId: 'rare_charm', chance: 1.0, quantity: 1, taskOnly: true }],
    noSeedDrops: true,
  }
  const ATT_99_STATS = {
    attack: { xp: 13_034_431, level: 99 }, strength: { xp: 13_034_431, level: 99 },
    defence: { xp: 13_034_431, level: 99 }, hitpoints: { xp: 13_034_431, level: 99 },
    ranged: { xp: 13_034_431, level: 99 }, magic: { xp: 13_034_431, level: 99 },
  }

  it('never grants a taskOnly item off-task', () => {
    const task: any = { stance: 'accurate', monster: WEAK_GOBLIN }
    const inv = Array(28).fill(null)
    const sim = simulateIdleCombat(task, 5 * 60_000, ATT_99_STATS, {}, inv, itemsData, null, {}, { currentHP: 99 })
    expect(sim).toBeTruthy()
    expect(sim!.lootGained.rare_charm ?? 0).toBe(0)
  })

  it('grants a taskOnly item while on task', () => {
    const task: any = { stance: 'accurate', monster: WEAK_GOBLIN }
    const inv = Array(28).fill(null)
    const slayerTask = { monsterId: 'training_dummy', monstersRemaining: 999 }
    const sim = simulateIdleCombat(task, 5 * 60_000, ATT_99_STATS, {}, inv, itemsData, slayerTask, {}, { currentHP: 99 })
    expect(sim).toBeTruthy()
    expect(sim!.lootGained.rare_charm ?? 0).toBeGreaterThan(0)
  })
})

describe('server-authoritative rollMonsterRewardsById — taskOnly drops', () => {
  it('never rolls a taskOnly drop when isOnTask is false', () => {
    const loot = rollMonsterRewardsById('threefang_cerberus', () => 0, false)
    expect(loot.some((l: any) => l.itemId === 'imbued_crown' || l.itemId === 'imbued_brain')).toBe(false)
  })

  it('rolls taskOnly drops when isOnTask is true (deterministic random() = 0 always hits)', () => {
    const loot = rollMonsterRewardsById('threefang_cerberus', () => 0, true)
    expect(loot.some((l: any) => l.itemId === 'imbued_crown')).toBe(true)
    expect(loot.some((l: any) => l.itemId === 'imbued_brain')).toBe(true)
  })
})
