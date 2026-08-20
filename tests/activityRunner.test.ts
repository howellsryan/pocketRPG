import { describe, expect, it } from 'vitest'
import {
  isRunnableBackgroundTask,
  getActionTicksForTask,
  getCarriedPendingTicks,
  simulateTaskWindow,
  resultActions,
} from '../src/engine/activityRunner.js'

describe('getCarriedPendingTicks (resume the current action, not restart it)', () => {
  it('uses an explicit pendingTicks when the runner already owns the task', () => {
    expect(getCarriedPendingTicks({ pendingTicks: 3 }, 10)).toBe(3)
    expect(getCarriedPendingTicks({ pendingTicks: 0 }, 10)).toBe(0)
  })

  it('infers elapsed ticks from a screen-mirrored ticksRemaining', () => {
    // Screen left the action with 4 of 10 ticks remaining → 6 elapsed.
    expect(getCarriedPendingTicks({ ticksRemaining: 4 }, 10)).toBe(6)
    // Just started (full remaining) → 0 elapsed, no restart jump.
    expect(getCarriedPendingTicks({ ticksRemaining: 10 }, 10)).toBe(0)
  })

  it('clamps and defaults safely', () => {
    expect(getCarriedPendingTicks({ ticksRemaining: 99 }, 10)).toBe(0)
    expect(getCarriedPendingTicks({}, 10)).toBe(0)
  })
})

const inv28 = () => Array(28).fill(null)
// Construction XP comfortably past level 80 (the gather auto-bank unlock).
const AUTOBANK_STATS = { construction: { xp: 5_000_000 } }

// Replays the runner's per-action path: accumulate one action's worth of ticks,
// then simulate over that window.
function runOneAction(task: any, ctx: any) {
  const ticks = getActionTicksForTask(task, ctx)
  return simulateTaskWindow(task, ticks * 600, ctx)
}

describe('isRunnableBackgroundTask', () => {
  it('runs nothing while a co-op room owns the character', () => {
    // The server is resolving this character's swings and holds their save, so
    // background Herblore here spends herbs out of a pack the room is also
    // spending from — and the pull on the way out of the fight throws the
    // products away. A group fight is the only thing the player is doing.
    const task = { type: 'skill', skill: 'herblore', action: { ticks: 3, product: 'super_attack' } } as any
    expect(isRunnableBackgroundTask(task, { coopSessionActive: true })).toBe(false)
    expect(isRunnableBackgroundTask(task, { coopSessionActive: false })).toBe(true)
    // The default has to stay "run it": every other caller passes no options.
    expect(isRunnableBackgroundTask(task)).toBe(true)
  })

  it('accepts skill/gather/agility/thieving/hunter tasks', () => {
    expect(isRunnableBackgroundTask({ type: 'skill', skill: 'mining', action: { ticks: 3, product: 'iron_ore' } } as any)).toBe(true)
    expect(isRunnableBackgroundTask({ type: 'gather', gatherTask: { ticks: 3, product: 'bowstring' } } as any)).toBe(true)
    expect(isRunnableBackgroundTask({ type: 'agility', action: { ticks: 5 } } as any)).toBe(true)
    expect(isRunnableBackgroundTask({ type: 'thieving', npc: { xp: 8 } } as any)).toBe(true)
    expect(isRunnableBackgroundTask({ type: 'hunter', action: { ticks: 4 } } as any)).toBe(true)
  })

  it('rejects combat, quests, one-shots, clues, and long-form rewards', () => {
    expect(isRunnableBackgroundTask({ type: 'combat', monster: {} } as any)).toBe(false)
    expect(isRunnableBackgroundTask({ type: 'quest', quest: {} } as any)).toBe(false)
    expect(isRunnableBackgroundTask({ type: 'gather', gatherTask: { oneShot: true } } as any)).toBe(false)
    expect(isRunnableBackgroundTask({ type: 'gather', gatherTask: { isClue: true } } as any)).toBe(false)
    expect(isRunnableBackgroundTask({ type: 'skill', skill: 'dungeoneering', action: { category: 'reward' } } as any)).toBe(false)
    expect(isRunnableBackgroundTask(null as any)).toBe(false)
  })
})

describe('getActionTicksForTask', () => {
  it('uses fixed cadence for thieving and action ticks elsewhere', () => {
    expect(getActionTicksForTask({ type: 'thieving', npc: {} } as any)).toBe(4)
    expect(getActionTicksForTask({ type: 'agility', action: { ticks: 7 } } as any)).toBe(7)
    expect(getActionTicksForTask({ type: 'gather', gatherTask: { ticks: 3 } } as any)).toBe(3)
  })

  it('honours a per-NPC pickpocket cadence (Master Farmer is slower)', () => {
    expect(getActionTicksForTask({ type: 'thieving', npc: { pickpocketTicks: 8 } } as any)).toBe(8)
  })
})

describe('thieving cadence matches the simulation window (no false out-of-materials)', () => {
  it('completes a Master Farmer action over its 8-tick window', () => {
    const task = { type: 'thieving', npc: { name: 'Master Farmer', xp: 43, coins: 0, seedReward: true, pickpocketTicks: 8 } }
    const result = runOneAction(task as any, {})
    expect(result).not.toBeNull()
    expect(resultActions(result)).toBe(1)
    const seeds = Object.values(result?.itemsGained || {}).reduce((a: number, b: any) => a + b, 0)
    expect(seeds).toBe(1)
  })
})

describe('simulateTaskWindow (one action)', () => {
  it('completes exactly one mining action into the inventory', () => {
    const task = { type: 'skill', skill: 'mining', action: { id: 'iron', name: 'Iron', ticks: 3, xp: 35, product: 'iron_ore' } }
    const result = runOneAction(task as any, {
      inventory: inv28(), bank: {}, stats: {}, equipment: null, itemsData: { iron_ore: { stackable: false } },
    })
    expect(resultActions(result)).toBe(1)
    expect(result?.xpGained?.mining).toBe(35)
    expect(result?.itemsGained?.iron_ore).toBe(1)
  })

  it('completes one thieving action with xp and coins', () => {
    const task = { type: 'thieving', npc: { name: 'Man', xp: 8, coins: 5 } }
    const result = runOneAction(task as any, {})
    expect(resultActions(result)).toBe(1)
    expect(result?.xpGained?.thieving).toBe(8)
    expect(result?.coinsGained).toBe(5)
  })

  it('completes one agility lap with xp', () => {
    const task = { type: 'agility', action: { name: 'Course', ticks: 5, xp: 40 } }
    const result = runOneAction(task as any, {})
    expect(resultActions(result)).toBe(1)
    expect(result?.xpGained?.agility).toBe(40)
  })
})

describe('full inventory handling', () => {
  const fullInv = () => Array(28).fill({ itemId: 'junk', quantity: 1 })
  const gatherTask = { type: 'gather', gatherTask: { id: 'gather_bowstring', ticks: 3, product: 'bowstring', qty: 1 } }
  const itemsData = { bowstring: { stackable: false }, junk: { stackable: false } }

  it('stops with inventory_full when auto-bank is NOT unlocked', () => {
    const result = simulateTaskWindow(gatherTask as any, 3 * 600, {
      inventory: fullInv(), bank: {}, stats: {}, itemsData,
    })
    expect(resultActions(result)).toBe(0)
    expect(result?.stoppedReason).toBe('inventory_full')
  })

  it('banks and keeps gathering (no stop) when auto-bank IS unlocked, given enough time', () => {
    // Bank trip is agility-scaled; with agility 1 it needs ~5 minutes, so give a
    // generous window — the runner reaches this by accumulating pending ticks.
    const result = simulateTaskWindow(gatherTask as any, 600_000, {
      inventory: fullInv(), bank: {}, stats: AUTOBANK_STATS, itemsData,
    })
    expect(result).not.toBeNull()
    expect(result?.stoppedReason).toBeUndefined()
    expect(resultActions(result)).toBeGreaterThan(0)
    expect(Object.keys(result?.itemsBanked || {}).length).toBeGreaterThan(0)
  })

  it('does not complete an action (but does not stop) before the bank trip has had enough time', () => {
    // One action's worth of time is far less than the agility-1 bank delay.
    const result = simulateTaskWindow(gatherTask as any, 3 * 600, {
      inventory: fullInv(), bank: {}, stats: AUTOBANK_STATS, itemsData,
    })
    expect(result).not.toBeNull()
    expect(resultActions(result)).toBe(0)
    expect(result?.stoppedReason).toBeUndefined()
  })
})
