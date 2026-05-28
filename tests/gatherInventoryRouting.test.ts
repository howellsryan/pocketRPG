import { describe, expect, it } from 'vitest'
import { simulateIdleGather, simulateIdleSkilling } from '../src/engine/idleEngine.js'
import { getLevelFromXP } from '../src/engine/experience.js'

// XP comfortably above Construction level 80, which unlocks gather auto-banking.
const CONSTRUCTION_80_XP = 2_000_000

const invWithFreeSlots = (free: number) =>
  Array(28).fill(null).map((_, i) => (i < free ? null : { itemId: 'junk', quantity: 1 }))

describe('construction unlock threshold', () => {
  it('2,000,000 construction XP is at least level 80', () => {
    expect(getLevelFromXP(CONSTRUCTION_80_XP)).toBeGreaterThanOrEqual(80)
  })
})

describe('simulateIdleGather inventory routing', () => {
  it('fills the inventory and stops when full without the construction unlock', () => {
    const result = simulateIdleGather(
      { type: 'gather', gatherTask: { id: 'gather_bowstring', ticks: 1, product: 'bowstring', qty: 1 } } as any,
      60_000,
      invWithFreeSlots(3),
      {} as any,
      { bowstring: { stackable: false } } as any,
      {} as any,
    )
    expect(result?.actions).toBe(3)
    expect(result?.stoppedReason).toBe('inventory_full')
    expect(result?.itemsGained?.bowstring).toBe(3)
    expect(result?.itemsBanked).toEqual({})
  })

  it('auto-banks a full inventory once Construction 80 is unlocked', () => {
    const result = simulateIdleGather(
      { type: 'gather', gatherTask: { id: 'gather_bowstring', ticks: 1, product: 'bowstring', qty: 1 } } as any,
      600_000,
      invWithFreeSlots(1),
      { construction: { xp: CONSTRUCTION_80_XP }, agility: { xp: 13_034_431 } } as any,
      { bowstring: { stackable: false } } as any,
      {} as any,
    )
    expect(result?.stoppedReason).toBeUndefined()
    expect(result?.actions).toBeGreaterThan(1)
    expect(result?.itemsBanked?.bowstring).toBeGreaterThan(0)
  })

  it('reports out_of_materials for conversion gathers that exhaust their inputs', () => {
    const result = simulateIdleGather(
      { type: 'gather', gatherTask: { id: 'burn_seaweed', ticks: 1, product: 'soda_ash', qty: 1, materials: { giant_seaweed: 1 } } } as any,
      600_000,
      Array(28).fill(null),
      {} as any,
      { soda_ash: { stackable: false }, giant_seaweed: { stackable: false } } as any,
      { giant_seaweed: { quantity: 4 } } as any,
    )
    expect(result?.actions).toBe(4)
    expect(result?.stoppedReason).toBe('out_of_materials')
    expect(result?.itemsConsumed?.giant_seaweed).toBe(4)
  })
})

describe('simulateIdleSkilling gathering routing', () => {
  it('mining fills the inventory and stops when full without the construction unlock', () => {
    const sim = simulateIdleSkilling(
      { skill: 'mining', action: { id: 'iron', name: 'Iron', ticks: 1, xp: 35, product: 'iron_ore' } } as any,
      60_000,
      {} as any,
      null,
      {} as any,
      { iron_ore: { stackable: false } } as any,
      invWithFreeSlots(2),
    )
    expect(sim?.actions).toBe(2)
    expect(sim?.stoppedReason).toBe('inventory_full')
    expect(sim?.xpGained?.mining).toBe(70)
    expect(sim?.itemsGained?.iron_ore).toBe(2)
    expect(sim?.itemsBanked).toEqual({})
  })

  it('mining auto-banks a full inventory once Construction 80 is unlocked', () => {
    const sim = simulateIdleSkilling(
      { skill: 'mining', action: { id: 'iron', name: 'Iron', ticks: 1, xp: 35, product: 'iron_ore' } } as any,
      600_000,
      {} as any,
      null,
      { construction: { xp: CONSTRUCTION_80_XP }, agility: { xp: 13_034_431 } } as any,
      { iron_ore: { stackable: false } } as any,
      invWithFreeSlots(1),
    )
    expect(sim?.stoppedReason).toBeUndefined()
    expect(sim?.actions).toBeGreaterThan(1)
    expect(sim?.itemsBanked?.iron_ore).toBeGreaterThan(0)
  })

  it('reports out_of_materials when a production skill exhausts its inputs', () => {
    const sim = simulateIdleSkilling(
      { skill: 'smithing', bankingEnabled: true, action: { id: 'bronze_bar', name: 'Bronze bar', ticks: 1, xp: 6, product: 'bronze_bar', materials: { copper_ore: 1, tin_ore: 1 } } } as any,
      600_000,
      { copper_ore: { quantity: 3 }, tin_ore: { quantity: 3 } } as any,
      null,
      {} as any,
      { bronze_bar: { stackable: false } } as any,
      Array(28).fill(null),
    )
    expect(sim?.actions).toBe(3)
    expect(sim?.stoppedReason).toBe('out_of_materials')
    expect(sim?.xpGained?.smithing).toBe(18)
  })
})
