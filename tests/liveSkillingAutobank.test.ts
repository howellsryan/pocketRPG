import { describe, it, expect } from 'vitest'
import {
  createSkillingState,
  processSkillingTick,
  skillAutoBanksWhenFull,
  depositSkillingOutput,
} from '../src/engine/skilling.js'
import { getAgilityBankDelayTicks } from '../src/engine/agility.js'
import { createInventory, freeSlots } from '../src/engine/inventory.js'
import { getXPForLevel } from '../src/engine/experience.js'

const itemsData: any = {
  bronze_bar: { name: 'Bronze Bar', stackable: false },
  coins: { name: 'Coins', stackable: true },
  copper_ore: { name: 'Copper Ore', stackable: false },
}

// Fill an inventory with `count` distinct non-stackable slots.
function fullInventory(itemId = 'bronze_bar') {
  return Array.from({ length: 28 }, () => ({ itemId, quantity: 1 }))
}

describe('skillAutoBanksWhenFull', () => {
  it('always auto-banks production skills', () => {
    expect(skillAutoBanksWhenFull('smithing', {})).toBe(true)
    expect(skillAutoBanksWhenFull('cooking', {})).toBe(true)
  })

  it('always auto-banks mining/woodcutting/fishing regardless of Construction', () => {
    expect(skillAutoBanksWhenFull('mining', {})).toBe(true)
    expect(skillAutoBanksWhenFull('woodcutting', {})).toBe(true)
    expect(skillAutoBanksWhenFull('fishing', {})).toBe(true)
  })

  it('gates other gatherers (farming) on the Construction unlock', () => {
    expect(skillAutoBanksWhenFull('farming', {})).toBe(false)
    expect(skillAutoBanksWhenFull('farming', { construction: { xp: getXPForLevel(80) } })).toBe(true)
  })
})

describe('depositSkillingOutput', () => {
  it('deposits into a non-full inventory without a bank trip', () => {
    const inv = createInventory()
    const res = depositSkillingOutput(inv, { bronze_bar: 1 }, itemsData, true)
    expect(res.bankTrip).toBeUndefined()
    expect(res.stopped).toBeUndefined()
    expect(freeSlots(inv)).toBe(27)
  })

  it('banks the whole inventory then deposits when full (auto-bank on)', () => {
    const inv = fullInventory('bronze_bar')
    const res = depositSkillingOutput(inv, { bronze_bar: 1 }, itemsData, true)
    expect(res.bankTrip).toBe(true)
    expect(res.banked).toEqual({ bronze_bar: 28 })
    // Inventory cleared then the new bar added.
    expect(freeSlots(inv)).toBe(27)
    expect(inv.filter((s) => s?.itemId === 'bronze_bar').length).toBe(1)
  })

  it('stops (no deposit, no bank) when full and auto-bank is off', () => {
    const inv = fullInventory('copper_ore')
    const res = depositSkillingOutput(inv, { copper_ore: 1 }, itemsData, false)
    expect(res.stopped).toBe(true)
    expect(res.bankTrip).toBeUndefined()
    expect(freeSlots(inv)).toBe(0)
  })
})

describe('processSkillingTick banking pause', () => {
  const action = { id: 'smith_bronze', name: 'Bronze Bar', ticks: 2, xp: 10, product: 'bronze_bar' }

  it('holds the action for the agility-scaled delay, then resumes', () => {
    const stats = { agility: { xp: getXPForLevel(99) } } // 10s delay
    const delayTicks = getAgilityBankDelayTicks(stats)
    expect(delayTicks).toBeGreaterThan(0)

    // Simulate the screen entering a bank pause after a completed action.
    let state: any = { ...createSkillingState('smithing', action), bankDelayTicksRemaining: delayTicks, justCompleted: true }

    let completedEvent = null
    for (let i = 0; i < delayTicks; i++) {
      const { skillingState, events } = processSkillingTick(state)
      state = skillingState
      // No action progress occurs during the pause.
      expect(state.ticksRemaining).toBe(action.ticks)
      const done = events.find((e: any) => e.type === 'bankTripComplete')
      if (done) completedEvent = done
    }

    expect(state.bankDelayTicksRemaining).toBe(0)
    expect(completedEvent).toBeTruthy()

    // Next tick resumes: justCompleted resets ticksRemaining, no premature completion.
    const resumed = processSkillingTick(state)
    expect(resumed.skillingState.justCompleted).toBe(false)
    expect(resumed.events.find((e: any) => e.type === 'actionComplete')).toBeUndefined()
  })

  it('does not pause when no bank trip is pending', () => {
    let state: any = createSkillingState('smithing', action)
    expect(state.bankDelayTicksRemaining).toBe(0)
    // Two ticks complete one action normally.
    state = processSkillingTick(state).skillingState
    const { events } = processSkillingTick(state)
    expect(events.find((e: any) => e.type === 'actionComplete')).toBeTruthy()
  })
})
