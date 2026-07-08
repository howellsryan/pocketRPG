import { describe, it, expect } from 'vitest'
import { detectBankWipe } from '../functions/_lib/game/saveValidation.js'

function bankOf(n: number) {
  const bank: Record<string, { itemId: string; quantity: number }> = {}
  for (let i = 0; i < n; i++) bank[`item_${i}`] = { itemId: `item_${i}`, quantity: i + 1 }
  return bank
}

describe('detectBankWipe', () => {
  it('rejects a substantial bank collapsing to empty (something → nothing)', () => {
    const previous = { bank: bankOf(20) }
    const next = { bank: {}, inventory: new Array(28).fill(null), equipment: {} }
    const result = detectBankWipe(previous, next)
    expect(result.wiped).toBe(true)
    expect(result.previousCount).toBe(20)
    expect(result.nextBankCount).toBe(0)
  })

  it('rejects a near-total wipe (≥90% of items vanish from every container)', () => {
    const previous = { bank: bankOf(30) }
    // Only 1 of the 30 survives anywhere → 29/30 vanished.
    const next = { bank: { item_0: { itemId: 'item_0', quantity: 1 } } }
    expect(detectBankWipe(previous, next).wiped).toBe(true)
  })

  it('allows withdrawing the whole bank into the inventory (items still held)', () => {
    const previous = { bank: bankOf(20) }
    // Same 20 item ids, now in inventory instead of the bank — nothing vanished.
    const inventory = Array.from({ length: 28 }, (_, i) =>
      i < 20 ? { itemId: `item_${i}`, quantity: i + 1 } : null,
    )
    const next = { bank: {}, inventory, equipment: {} }
    expect(detectBankWipe(previous, next).wiped).toBe(false)
  })

  it('allows consuming a handful of stacks (idle combat / alching / shop spend)', () => {
    const previous = { bank: bankOf(20) }
    const next = { bank: bankOf(16) } // 4 distinct stacks gone → 20% vanished
    expect(detectBankWipe(previous, next).wiped).toBe(false)
  })

  it('does not guard a small bank (below the substantial-bank threshold)', () => {
    const previous = { bank: bankOf(10) }
    const next = { bank: {} }
    expect(detectBankWipe(previous, next).wiped).toBe(false)
  })

  it('allows the genuine first save (no previous bank)', () => {
    expect(detectBankWipe({}, { bank: bankOf(20) }).wiped).toBe(false)
    expect(detectBankWipe(null as any, { bank: bankOf(20) }).wiped).toBe(false)
  })

  it('keeps items held in equipment out of the vanished set', () => {
    const previous = { bank: bankOf(20) }
    // Bank emptied but the items are worn/held: 12 equipped + 8 in inventory.
    const equipment: Record<string, { itemId: string }> = {}
    for (let i = 0; i < 12; i++) equipment[`slot_${i}`] = { itemId: `item_${i}` }
    const inventory = Array.from({ length: 28 }, (_, i) =>
      i < 8 ? { itemId: `item_${i + 12}`, quantity: 1 } : null,
    )
    expect(detectBankWipe(previous, { bank: {}, inventory, equipment }).wiped).toBe(false)
  })
})
