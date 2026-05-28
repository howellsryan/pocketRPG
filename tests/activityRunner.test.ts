import { describe, expect, it } from 'vitest'
import {
  isRunnableBackgroundTask,
  getActionTicksForTask,
  runOneAction,
  resultActions,
} from '../src/engine/activityRunner.js'

const inv28 = () => Array(28).fill(null)

describe('isRunnableBackgroundTask', () => {
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
})

describe('runOneAction', () => {
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

  it('returns a stop signal when a gathering action cannot fit in a full inventory', () => {
    const fullInv = Array(28).fill({ itemId: 'junk', quantity: 1 })
    const task = { type: 'gather', gatherTask: { id: 'gather_bowstring', ticks: 1, product: 'bowstring', qty: 1 } }
    const result = runOneAction(task as any, {
      inventory: fullInv, bank: {}, stats: {}, itemsData: { bowstring: { stackable: false } },
    })
    expect(resultActions(result)).toBe(0)
    expect(result?.stoppedReason).toBe('inventory_full')
  })
})
