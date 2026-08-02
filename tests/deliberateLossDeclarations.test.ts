// The three deliberate removals that used to read as item-loss incidents:
// a hard-mode death, charging an item with its charge material, and combining
// two items into a third.
//
// Every case runs through the REAL detector against REAL items.json values, so
// the assertion is "this specific recipe stops flagging", not "declaring works
// in principle" — the whole reason these three flagged is the size of the
// numbers involved, and a synthetic item would not reproduce it.
import { describe, it, expect, beforeEach } from 'vitest'
import { classifyItemLoss } from '../functions/_lib/game/holdingsDelta.js'
import { chargeRecipeSpend } from '../src/engine/chargeRecipes.js'
import { hardModeDeathLoss } from '../src/engine/hardMode.js'
import { bankMemberItemsLost } from '../src/engine/coopBossEngine.js'
import {
  readItemLossLedger,
  recordItemLossEntries,
  recordItemLosses,
  resetItemLossLedger,
} from '../src/engine/lossLedger.js'
import itemsJson from '../src/data/items.json'

const items = itemsJson as Record<string, any>

/** The ledger the client would ship for this window, as the server sees it. */
function shipped() {
  return readItemLossLedger() as Record<string, number> | null
}

beforeEach(() => resetItemLossLedger())

describe('combining two items into a third', () => {
  // Imbued Crown (resource, 2,000,000) + Slayer Helmet (armor, 1,000,000).
  const CROWN = 'imbued_crown'
  const HELM = 'slayer_helmet'
  const RESULT = items[CROWN].combineResult

  const before = { inventory: [{ itemId: CROWN, quantity: 1 }, { itemId: HELM, quantity: 1 }], bank: {}, equipment: {} }
  const after = { inventory: [null, { itemId: RESULT, quantity: 1 }], bank: {}, equipment: {} }

  it('flags undeclared — this is the false positive being fixed', () => {
    const loss = classifyItemLoss(before, after)
    expect(loss.flagged).toBe(true)
    // The crown alone clears the million-gp resource floor.
    expect(loss.reasons).toContain('resource_value')
  })

  it('does not flag once both ingredients are declared', () => {
    const loss = classifyItemLoss(before, after, undefined, { [CROWN]: 1, [HELM]: 1 })
    expect(loss.flagged).toBe(false)
    expect(loss.declaredUnits).toBe(2)
  })

  it('still flags a third item that vanished alongside the recipe', () => {
    const alsoGone = {
      inventory: [null, { itemId: RESULT, quantity: 1 }],
      bank: {},
      equipment: {},
    }
    const withExtra = {
      ...before,
      bank: { twisted_bow: { itemId: 'twisted_bow', quantity: 1 }, scythe_of_vitur: { itemId: 'scythe_of_vitur', quantity: 1 } },
    }
    const loss = classifyItemLoss(withExtra, alsoGone, undefined, { [CROWN]: 1, [HELM]: 1 })
    expect(loss.flagged).toBe(true)
    // Reported under the canonical id — the detector rewrites both sides.
    expect(loss.items.map((i: any) => i.itemId)).toContain('twisted_longbow')
  })

  it('declares coins when the recipe charges them', () => {
    recordItemLosses({ [CROWN]: 1, [HELM]: 1, coins: 50_000 })
    expect(shipped()).toEqual({ [CROWN]: 1, [HELM]: 1, coins: 50_000 })
  })

  it('counts a recipe whose halves are the same item twice', () => {
    const spend: Record<string, number> = { [CROWN]: 1 }
    spend[CROWN] = (spend[CROWN] || 0) + 1
    expect(spend[CROWN]).toBe(2)
  })
})

describe('charging an item with its charge material', () => {
  const SHARDS = 'shardglass_shards'

  it('flags an undeclared bulk charge — the false positive being fixed', () => {
    const before = { inventory: [{ itemId: SHARDS, quantity: 4000 }], bank: {}, equipment: {} }
    const after = { inventory: [{ itemId: 'shardglass_axe', quantity: 1, charges: 4000 }], bank: {}, equipment: {} }
    const loss = classifyItemLoss(before, after)
    expect(loss.flagged).toBe(true)
    expect(loss.reasons).toContain('resource_value')
  })

  it('does not flag once the recipe spend is declared', () => {
    const before = { inventory: [{ itemId: SHARDS, quantity: 4000 }], bank: {}, equipment: {} }
    const after = { inventory: [{ itemId: 'shardglass_axe', quantity: 1, charges: 4000 }], bank: {}, equipment: {} }
    const spend = chargeRecipeSpend([{ itemId: SHARDS, qty: 1 }], 4000)
    const loss = classifyItemLoss(before, after, undefined, spend)
    expect(loss.flagged).toBe(false)
    expect(loss.declaredUnits).toBe(4000)
  })

  it('multiplies each recipe entry by the charges added, not by the requested amount', () => {
    expect(chargeRecipeSpend([{ itemId: 'chaos_rune', qty: 5 }, { itemId: 'soul_rune', qty: 2 }], 10))
      .toEqual({ chaos_rune: 50, soul_rune: 20 })
  })

  it('sums a material a recipe names twice instead of overwriting it', () => {
    expect(chargeRecipeSpend([{ itemId: SHARDS, qty: 2 }, { itemId: SHARDS, qty: 3 }], 4))
      .toEqual({ [SHARDS]: 20 })
  })

  it('spends nothing for a zero or malformed charge count', () => {
    expect(chargeRecipeSpend([{ itemId: SHARDS, qty: 1 }], 0)).toEqual({})
    expect(chargeRecipeSpend([{ itemId: SHARDS, qty: 1 }], NaN)).toEqual({})
    expect(chargeRecipeSpend(null as any, 5)).toEqual({})
  })
})

describe('a hard-mode death', () => {
  const inventory = [
    { itemId: 'twisted_bow', quantity: 1 },
    { itemId: 'shark', quantity: 20 },
    { itemId: 'infernal_cape', quantity: 1 },
  ]
  const equipment = { weapon: { itemId: 'scythe_of_vitur', quantity: 1 } }

  it('flags undeclared — the false positive being fixed', () => {
    const loss = hardModeDeathLoss(inventory, equipment, items)
    const before = { inventory, equipment, bank: {} }
    const after = { inventory: loss.inventory, equipment: loss.equipment, bank: {} }
    expect(classifyItemLoss(before, after).flagged).toBe(true)
  })

  it('does not flag once the tally the death screen shows is declared', () => {
    const loss = hardModeDeathLoss(inventory, equipment, items)
    const before = { inventory, equipment, bank: {} }
    const after = { inventory: loss.inventory, equipment: loss.equipment, bank: {} }

    recordItemLossEntries(loss.lost)
    const declared = shipped()

    expect(classifyItemLoss(before, after, undefined, declared).flagged).toBe(false)
  })

  it('declares nothing for the untradeables the death spares', () => {
    const loss = hardModeDeathLoss(inventory, equipment, items)
    recordItemLossEntries(loss.lost)
    // Infernal Cape survives (survivesHardModeDeath), so declaring it would
    // cover a loss that never happened — and mask a real one next window.
    expect(shipped()).not.toHaveProperty('infernal_cape')
    expect(shipped()).toHaveProperty('twisted_bow', 1)
  })

  it('carries the stack size, not one per slot', () => {
    recordItemLossEntries([{ itemId: 'shark', quantity: 20 }])
    expect(shipped()).toEqual({ shark: 20 })
  })

  it('treats a quantity-less entry as a single item', () => {
    recordItemLossEntries([{ itemId: 'twisted_bow' } as any])
    expect(shipped()).toEqual({ twisted_bow: 1 })
  })

  it('ignores malformed entries rather than throwing', () => {
    recordItemLossEntries([null, { quantity: 4 }, { itemId: '', quantity: 2 }] as any)
    expect(shipped()).toBeNull()
  })
})

describe('a hard-mode death in a co-op room', () => {
  // The room takes the pack inside the Durable Object, so the client ledger
  // never sees it — the declaration is banked on the member and spent by the
  // save write-back instead.
  it('banks the tally on the member', () => {
    const banked = bankMemberItemsLost({}, [{ itemId: 'twisted_bow', quantity: 1 }, { itemId: 'shark', quantity: 12 }])
    expect(banked).toEqual({ twisted_bow: 1, shark: 12 })
  })

  it('accumulates across deaths rather than replacing', () => {
    const first = bankMemberItemsLost({}, [{ itemId: 'shark', quantity: 5 }])
    const second = bankMemberItemsLost(first, [{ itemId: 'shark', quantity: 3 }, { itemId: 'dragon_dagger', quantity: 1 }])
    expect(second).toEqual({ shark: 8, dragon_dagger: 1 })
  })

  it('starts from nothing for a member record predating the field', () => {
    expect(bankMemberItemsLost(undefined as any, [{ itemId: 'shark', quantity: 2 }])).toEqual({ shark: 2 })
  })

  it('does not mutate the banked ledger it was handed', () => {
    const first = { shark: 5 }
    bankMemberItemsLost(first, [{ itemId: 'shark', quantity: 3 }])
    expect(first).toEqual({ shark: 5 })
  })

  it('covers the room death when handed to the detector', () => {
    const inventory = [{ itemId: 'twisted_bow', quantity: 1 }, { itemId: 'shark', quantity: 20 }]
    const equipment = { weapon: { itemId: 'scythe_of_vitur', quantity: 1 } }
    const loss = hardModeDeathLoss(inventory, equipment, items)
    const banked = bankMemberItemsLost({}, loss.lost)
    const before = { inventory, equipment, bank: {} }
    const after = { inventory: loss.inventory, equipment: loss.equipment, bank: {} }
    expect(classifyItemLoss(before, after).flagged).toBe(true)
    expect(classifyItemLoss(before, after, undefined, banked).flagged).toBe(false)
  })
})
