import { describe, it, expect } from 'vitest'
import { skillingActionBlockedByFullInventory } from '../src/engine/skilling.js'
import { simulateIdleSkilling, simulateIdleGather } from '../src/engine/idleEngine.js'
import { getXPForLevel } from '../src/engine/experience.js'

const itemsData: any = {
  bronze_bar: { name: 'Bronze Bar', stackable: false },
  copper_ore: { name: 'Copper Ore', stackable: false },
  coins: { name: 'Coins', stackable: true },
  logs: { name: 'Logs', stackable: false },
  junk: { name: 'Junk', stackable: false },
}

const full = (itemId = 'junk') => Array.from({ length: 28 }, () => ({ itemId, quantity: 1 }))
const withFree = () => [{ itemId: 'junk', quantity: 1 }, ...Array(27).fill(null)]

describe('skillingActionBlockedByFullInventory', () => {
  it('is not blocked when a free slot exists', () => {
    expect(skillingActionBlockedByFullInventory({ product: 'logs' }, withFree(), itemsData)).toBe(false)
  })

  it('blocks a full inventory for a gathering product', () => {
    expect(skillingActionBlockedByFullInventory({ product: 'logs' }, full(), itemsData)).toBe(true)
  })

  it('is not blocked when a consumed material sits in the inventory (using it frees a slot)', () => {
    const inv = full('copper_ore')
    expect(skillingActionBlockedByFullInventory({ product: 'bronze_bar', materials: { copper_ore: 1 } }, inv, itemsData)).toBe(false)
  })

  it('is blocked when materials come only from the bank (nothing frees a slot)', () => {
    expect(skillingActionBlockedByFullInventory({ product: 'bronze_bar', materials: { copper_ore: 1 } }, full('junk'), itemsData)).toBe(true)
  })

  it('is not blocked when the product stacks onto an existing slot', () => {
    const inv = full('coins')
    expect(skillingActionBlockedByFullInventory({ product: 'coins' }, inv, itemsData)).toBe(false)
  })

  it('handles dropTable-style output (hunter catches, Master Farmer seeds)', () => {
    // A random-item reward needs a free slot: blocked only when the bag is full.
    expect(skillingActionBlockedByFullInventory({ dropTable: true }, full(), itemsData)).toBe(true)
    expect(skillingActionBlockedByFullInventory({ dropTable: true }, withFree(), itemsData)).toBe(false)
  })

  it('never blocks actions with no inventory-bound output', () => {
    expect(skillingActionBlockedByFullInventory({ type: 'alchemy', product: 'coins' }, full(), itemsData)).toBe(false)
    expect(skillingActionBlockedByFullInventory({ materials: { copper_ore: 1 } }, full(), itemsData)).toBe(false)
    expect(skillingActionBlockedByFullInventory(null, full(), itemsData)).toBe(false)
  })
})

describe('idle sim autoBank:false (active real-time driving)', () => {
  const smithTask: any = {
    skill: 'smithing',
    action: { name: 'Bronze Bar', ticks: 2, xp: 10, product: 'bronze_bar', productQty: 1, materials: { copper_ore: 1 } },
    bankingEnabled: true,
  }
  const bank: any = { copper_ore: { quantity: 100 } }

  it('reports inventory_full instead of auto-banking a full inventory', () => {
    const sim = simulateIdleSkilling(smithTask, 60_000, bank, {}, {}, itemsData, full('junk'), { autoBank: false })
    expect(sim?.stoppedReason).toBe('inventory_full')
    expect(sim?.actions).toBe(0)
  })

  it('still auto-banks by default (offline catch-up path)', () => {
    const sim = simulateIdleSkilling(smithTask, 60_000, bank, {}, {}, itemsData, full('junk'))
    expect(sim?.stoppedReason).not.toBe('inventory_full')
    expect((sim?.actions ?? 0)).toBeGreaterThan(0)
  })

  it('gather: autoBank:false stops on a full inventory even with the Construction unlock', () => {
    const gatherTask: any = { gatherTask: { name: 'Gather', ticks: 2, product: 'logs', qty: 1 } }
    // Agility 99 → ~10s bank trip, so the default auto-bank fits inside the window.
    const stats: any = { construction: { xp: getXPForLevel(80) }, agility: { xp: getXPForLevel(99) } }
    const blocked = simulateIdleGather(gatherTask, 60_000, full('junk'), stats, itemsData, {}, { autoBank: false })
    expect(blocked?.stoppedReason).toBe('inventory_full')
    expect(blocked?.actions).toBe(0)

    const banked = simulateIdleGather(gatherTask, 60_000, full('junk'), stats, itemsData, {})
    expect((banked?.actions ?? 0)).toBeGreaterThan(0)
  })
})
