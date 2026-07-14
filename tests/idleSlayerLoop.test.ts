import { describe, expect, it } from 'vitest'
import monstersData from '../src/data/monsters.json'
import { SLAYER_MASTERS } from '../src/engine/slayerMasters.js'
import { simulateIdleCombat } from '../src/engine/idleEngine.js'
import { simulateIdleCombatChain } from '../src/engine/idleSlayerLoop.js'
import { resolveSlayerLoopRewards } from '../src/engine/slayerRewards.js'

// A one-shot melee setup so kills are cheap and the whole window is spent on
// tasks rather than a single slow grind.
const MAXED: any = {
  attack: { xp: 13034431 },
  strength: { xp: 13034431 },
  defence: { xp: 13034431 },
  ranged: { xp: 0 },
  magic: { xp: 0 },
  hitpoints: { xp: 13034431 },
  slayer: { xp: 13034431 },
}

const WEAPON_ITEMS: any = {
  chained_cudgel: {
    id: 'chained_cudgel', slot: 'weapon', attackStyle: 'crush', attackSpeed: 1,
    attackBonus: { stab: 0, slash: 0, crush: 400, magic: 0, ranged: 0 },
    defenceBonus: { stab: 0, slash: 0, crush: 0, magic: 0, ranged: 0 },
    otherBonus: { meleeStrength: 400, rangedStrength: 0, magicDamage: 0 },
  },
}
const EQUIPMENT: any = { weapon: { itemId: 'chained_cudgel' } }

const TURAEL = SLAYER_MASTERS.find(m => m.id === 'turael')!
const TURAEL_POOL = new Set(TURAEL.monsterPool.filter(e => typeof e === 'string') as string[])

function combatTask(monsterId: string): any {
  return { stance: 'accurate', monster: monstersData[monsterId] }
}

function slayerTaskFor(monsterId: string, remaining: number): any {
  return {
    monsterId,
    monsterName: monstersData[monsterId]?.name || monsterId,
    monstersRemaining: remaining,
    totalCount: remaining,
    masterId: 'turael',
    pointsOnComplete: 25,
    isBoss: false,
  }
}

describe('simulateIdleCombatChain', () => {
  it('auto-assigns the next task from the same master and completes several across the window', () => {
    const sim = simulateIdleCombatChain(
      combatTask('field_chicken'), 3_600_000, MAXED, EQUIPMENT, Array(28).fill(null),
      WEAPON_ITEMS, slayerTaskFor('field_chicken', 3), {},
      { autoSlayer: true, rng: () => 0, slayerHistory: new Map() },
    )

    expect(sim).toBeTruthy()
    expect(sim!.autoSlayerChained).toBe(true)
    // Multiple tasks cleared (first 3-kill task then full-size reassignments).
    expect(sim!.slayerCompletions.length).toBeGreaterThanOrEqual(2)
    expect(sim!.slayerTasksCompletedCount).toBe(sim!.slayerCompletions.length)
    // Every monster fought belongs to the assigning master's pool.
    expect(sim!.perMonster.length).toBeGreaterThanOrEqual(2)
    for (const pm of sim!.perMonster) expect(TURAEL_POOL.has(pm.monsterId)).toBe(true)
    // Slayer XP accrued and the final task is a fresh in-progress assignment.
    expect(sim!.slayerXpGained).toBeGreaterThan(0)
    expect(sim!.slayerTaskUpdate).toBeTruthy()
    expect(sim!.slayerTaskUpdate.completed).toBeUndefined()
    expect(sim!.slayerTaskUpdate.masterId).toBe('turael')
    // finalTaskMonster is idleable (non-boss) so live play can continue on-task.
    expect(sim!.finalTaskMonster).toBeTruthy()
    expect(sim!.finalTaskMonster.boss).not.toBe(true)
  })

  it('earns more total slayer XP than a single non-chained task over the same window', () => {
    const opts: any = { idleFood: [], idlePotions: [], idlePrayers: {} }
    const single = simulateIdleCombat(
      combatTask('field_chicken'), 3_600_000, MAXED, EQUIPMENT, Array(28).fill(null),
      WEAPON_ITEMS, slayerTaskFor('field_chicken', 3), {}, opts,
    )
    const chained = simulateIdleCombatChain(
      combatTask('field_chicken'), 3_600_000, MAXED, EQUIPMENT, Array(28).fill(null),
      WEAPON_ITEMS, slayerTaskFor('field_chicken', 3), {},
      { ...opts, autoSlayer: true, rng: () => 0, slayerHistory: new Map() },
    )
    // The single task caps slayer XP at 3 kills; the chain keeps earning it.
    expect(chained!.slayerXpGained).toBeGreaterThan(single!.slayerXpGained)
  })

  it('does not chain when the unlock is off (single-task completion semantics)', () => {
    const sim = simulateIdleCombatChain(
      combatTask('field_chicken'), 3_600_000, MAXED, EQUIPMENT, Array(28).fill(null),
      WEAPON_ITEMS, slayerTaskFor('field_chicken', 3), {},
      { autoSlayer: false, rng: () => 0, slayerHistory: new Map() },
    )
    expect(sim!.slayerCompletions).toBeUndefined()
    expect(sim!.autoSlayerChained).toBeUndefined()
    expect(sim!.slayerTaskUpdate.completed).toBe(true)
  })

  it('does not chain when the active fight is not the assigned slayer monster', () => {
    // Fighting cave_goblin while assigned field_chicken — off-task, no hijack.
    const sim = simulateIdleCombatChain(
      combatTask('cave_goblin'), 600_000, MAXED, EQUIPMENT, Array(28).fill(null),
      WEAPON_ITEMS, slayerTaskFor('field_chicken', 3), {},
      { autoSlayer: true, rng: () => 0, slayerHistory: new Map() },
    )
    expect(sim!.autoSlayerChained).toBeUndefined()
    expect(sim!.slayerCompletions).toBeUndefined()
  })
})

describe('simulateIdleCombat stopOnSlayerComplete', () => {
  it('stops the moment the task is cleared instead of farming the rest of the window', () => {
    const opts: any = { stopOnSlayerComplete: true }
    const sim = simulateIdleCombat(
      combatTask('field_chicken'), 3_600_000, MAXED, EQUIPMENT, Array(28).fill(null),
      WEAPON_ITEMS, slayerTaskFor('field_chicken', 3), {}, opts,
    )
    expect(sim!.slayerTaskUpdate.completed).toBe(true)
    // Only the 3 task kills happened; the sim used a sliver of the hour.
    expect(sim!.monstersKilled).toBe(3)
    expect(sim!.effectiveElapsedMs).toBeLessThan(3_600_000)
  })
})

describe('resolveSlayerLoopRewards', () => {
  it('advances the streak across completions so milestone bonuses land', () => {
    // Starting at 3 completed, four more tasks pushes the counter through 5
    // (×10 milestone) at the 5th task.
    const completions = [{ pointsOnComplete: 10 }, { pointsOnComplete: 10 }, { pointsOnComplete: 10 }, { pointsOnComplete: 10 }]
    const res = resolveSlayerLoopRewards(completions, 3)
    expect(res.totalTasks).toBe(7)
    // tasks 4,6,7 → ×1 (10 each = 30); task 5 → ×10 (100). Total 130.
    expect(res.pointsEarned).toBe(130)
    expect(res.rewards).toHaveLength(4)
  })

  it('is a no-op for an empty completion list', () => {
    const res = resolveSlayerLoopRewards([], 8)
    expect(res.totalTasks).toBe(8)
    expect(res.pointsEarned).toBe(0)
  })
})
