import { describe, it, expect } from 'vitest'
import { GRIM_REAPER_GP_PER_CREDIT, grimReaperCost, grimReaperStashFromDeath } from '../src/engine/grimReaper.js'
import { hardModeDeathLoss } from '../src/engine/hardMode.js'
import itemsData from '../src/data/items.json'

describe('grimReaperCost', () => {
  it('costs nothing for an empty or missing stash', () => {
    expect(grimReaperCost([], itemsData)).toBe(0)
    expect(grimReaperCost(undefined as any, itemsData)).toBe(0)
  })

  it('costs exactly 1 credit at the 5m boundary', () => {
    // shark shopValue is well under 5m/unit; use coins (unit value 1) to hit an
    // exact boundary deterministically.
    expect(grimReaperCost([{ itemId: 'coins', quantity: GRIM_REAPER_GP_PER_CREDIT }], itemsData)).toBe(1)
  })

  it('rounds up 1 gp over the boundary into a second credit', () => {
    expect(grimReaperCost([{ itemId: 'coins', quantity: GRIM_REAPER_GP_PER_CREDIT + 1 }], itemsData)).toBe(2)
  })

  it('costs 10 credits for a 50m stash', () => {
    expect(grimReaperCost([{ itemId: 'coins', quantity: 50_000_000 }], itemsData)).toBe(10)
  })

  it('floors at 1 credit even for a worthless non-empty stash', () => {
    expect(grimReaperCost([{ itemId: 'not_an_item', quantity: 1 }], itemsData)).toBe(1)
  })
})

describe('grimReaperStashFromDeath', () => {
  it('returns null for a death that lost nothing', () => {
    expect(grimReaperStashFromDeath([], { id: 'zaryth', name: 'Zaryth' })).toBeNull()
    expect(grimReaperStashFromDeath(undefined as any, null)).toBeNull()
  })

  it('carries the loss list, source and charges through', () => {
    const stash = grimReaperStashFromDeath(
      [{ itemId: 'shark', quantity: 12 }, { itemId: 'venom_blowpipe', quantity: 1, charges: 150 }],
      { id: 'zaryth', name: 'Zaryth' },
      1_700_000_000_000,
    )
    expect(stash).toEqual({
      diedAt: 1_700_000_000_000,
      source: { id: 'zaryth', name: 'Zaryth' },
      items: [
        { itemId: 'shark', quantity: 12 },
        { itemId: 'venom_blowpipe', quantity: 1, charges: 150 },
      ],
    })
  })

  it('drops a zero-charge field rather than storing a bare zero', () => {
    const stash = grimReaperStashFromDeath([{ itemId: 'shark', quantity: 1, charges: 0 }], null)
    expect(stash?.items).toEqual([{ itemId: 'shark', quantity: 1 }])
  })

  it('has no source when the death carries none', () => {
    const stash = grimReaperStashFromDeath([{ itemId: 'shark', quantity: 1 }], null)
    expect(stash?.source).toBeNull()
  })

  it('feeds directly off hardModeDeathLoss — a real death produces a reclaimable, correctly priced stash', () => {
    const loss = hardModeDeathLoss(
      [{ itemId: 'shark', quantity: 12 }],
      { weapon: { itemId: 'venom_blowpipe', quantity: 1, charges: 150 } },
      itemsData,
    )
    const stash = grimReaperStashFromDeath(loss.lost, { id: 'zaryth', name: 'Zaryth' })
    expect(stash?.items).toEqual(loss.lost)
    expect(grimReaperCost(stash!.items, itemsData)).toBeGreaterThanOrEqual(1)
  })
})
