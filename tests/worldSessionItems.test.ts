import { describe, it, expect } from 'vitest'
import {
  commitFlush,
  consumeUnits,
  depositUnits,
  drainForFlush,
  emptyPools,
  mintUnits,
  restoreFlush,
  withdrawUnits,
} from '../world/server/sessionItems'

describe('world session flush bookkeeping', () => {
  it('grants world-minted units on an ordinary timer flush, not only on disconnect', () => {
    const pools = emptyPools()
    mintUnits(pools, 'iron_ore', 3)

    const drained = drainForFlush(pools, 'timer')

    expect(drained.items).toEqual([{ itemId: 'iron_ore', quantity: 3 }])
  })

  it('empties the minted tally in place so TickPlayer.minted keeps its alias', () => {
    const pools = emptyPools()
    // The zone hands pools.minted straight to the player record; mining and loot
    // pickups write through that reference, so a drain that reassigns silently
    // stops counting everything gathered after the first flush.
    const aliased = pools.minted
    mintUnits(pools, 'iron_ore', 3)

    drainForFlush(pools, 'timer')

    expect(pools.minted).toBe(aliased)
    expect(aliased).toEqual({})
  })

  it('reclassifies committed minted units as save-backed so consuming one removes it from the save', () => {
    const pools = emptyPools()
    mintUnits(pools, 'shadow_of_tumaken', 1)

    commitFlush(pools, drainForFlush(pools, 'timer'))
    consumeUnits(pools, 'shadow_of_tumaken', 1)

    expect(pools.saveBacked).toEqual({})
    expect(pools.consumedSaveBacked).toEqual({ shadow_of_tumaken: 1 })
  })

  it('leaves gear taken off in the world backed by the save after the next flush', () => {
    // The production loss (character 63, 2026-07-26): equipping a pack item and
    // then swapping back to the original gear left both worn pieces in `minted`.
    // The equipment snapshot flushed on the 3s timer — removing them from the
    // save's equipment — while `minted` waited for a disconnect flush that never
    // came, so the save held them in neither place.
    const pools = emptyPools({ shadow_of_tumaken: 1 })

    // Equip the Shadow out of the pack; the worn cape comes off into the pack.
    consumeUnits(pools, 'shadow_of_tumaken', 1)
    mintUnits(pools, 'imbued_god_cape', 1)
    // Swap straight back: the Shadow comes off too, and the cape goes back on out
    // of the minted pool (consumeUnits drains minted first, so no save removal).
    mintUnits(pools, 'shadow_of_tumaken', 1)
    consumeUnits(pools, 'imbued_god_cape', 1)
    expect(pools.minted).toEqual({ shadow_of_tumaken: 1 })

    const drained = drainForFlush(pools, 'timer')
    expect(drained.items).toEqual([{ itemId: 'shadow_of_tumaken', quantity: 1 }])
    commitFlush(pools, drained)

    // Every unit the player still owns is backed by the save now, so losing the
    // Durable Object costs nothing.
    expect(pools.saveBacked).toEqual({ shadow_of_tumaken: 1 })
    expect(pools.minted).toEqual({})
  })

  it('holds withdrawn bank units back until the session ends, since the bank still has them', () => {
    const pools = emptyPools()
    withdrawUnits(pools, 'prayer_potion', 4)

    expect(drainForFlush(pools, 'timer').bankToInventory).toEqual([])
    expect(pools.bankSourced).toEqual({ prayer_potion: 4 })
    expect(drainForFlush(pools, 'disconnect').bankToInventory).toEqual([
      { itemId: 'prayer_potion', quantity: 4 },
    ])
  })

  it('restores every claimed mutation when the grant fails so the next flush retries it', () => {
    const pools = emptyPools({ lobster: 2 })
    mintUnits(pools, 'imbued_god_cape', 1)
    consumeUnits(pools, 'lobster', 1)
    withdrawUnits(pools, 'coins', 500)

    const drained = drainForFlush(pools, 'disconnect')
    restoreFlush(pools, drained)

    expect(pools.minted).toEqual({ imbued_god_cape: 1 })
    expect(pools.consumedSaveBacked).toEqual({ lobster: 1 })
    expect(pools.bankSourced).toEqual({ coins: 500 })
    // A failed grant must not pre-emptively mark the units save-backed.
    expect(pools.saveBacked).toEqual({ lobster: 1 })
  })

  it('banks a committed minted unit out of the save inventory rather than granting it twice', () => {
    const pools = emptyPools()
    mintUnits(pools, 'coins', 20843)
    commitFlush(pools, drainForFlush(pools, 'timer'))

    depositUnits(pools, 'coins', 20843)

    expect(pools.mintedToBank).toEqual({})
    expect(pools.depositedSaveBacked).toEqual({ coins: 20843 })
  })

  it('cancels a deposit of a unit withdrawn earlier in the same session', () => {
    const pools = emptyPools()
    withdrawUnits(pools, 'prayer_potion', 4)
    depositUnits(pools, 'prayer_potion', 4)

    expect(pools.bankSourced).toEqual({})
    expect(pools.mintedToBank).toEqual({})
    expect(pools.depositedSaveBacked).toEqual({})
  })
})
