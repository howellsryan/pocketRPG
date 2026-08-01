import { describe, it, expect } from 'vitest'
import {
  DIRTY_STORES,
  createDirtyFlags,
  hasDirtyFlags,
  claimDirtyFlags,
  restoreDirtyFlags,
} from '../src/db/dirtyFlags.js'

describe('dirtyFlags', () => {
  it('starts every tracked store clean', () => {
    const flags = createDirtyFlags()
    expect(Object.keys(flags).sort()).toEqual([...DIRTY_STORES].sort())
    expect(hasDirtyFlags(flags)).toBe(false)
  })

  it('claims the dirty stores and clears them in place', () => {
    const flags = createDirtyFlags()
    flags.bank = true
    flags.inventory = true

    const claimed = claimDirtyFlags(flags)

    expect(claimed.bank).toBe(true)
    expect(claimed.inventory).toBe(true)
    expect(claimed.stats).toBe(false)
    expect(hasDirtyFlags(flags)).toBe(false)
  })

  // The whole point of claiming rather than clear-on-success: a mutation made
  // while the write is open must survive it and be picked up by the next pass.
  it('keeps a store dirtied again while its claim was in flight', () => {
    const flags = createDirtyFlags()
    flags.bank = true
    const claimed = claimDirtyFlags(flags)
    flags.bank = true // a deposit landed mid-write

    expect(claimed.bank).toBe(true)
    expect(hasDirtyFlags(flags)).toBe(true)
  })

  it('restores only what a failed write had claimed', () => {
    const flags = createDirtyFlags()
    flags.bank = true
    const claimed = claimDirtyFlags(flags)
    flags.stats = true // unrelated change during the failed write

    restoreDirtyFlags(flags, claimed)

    expect(flags.bank).toBe(true)
    expect(flags.stats).toBe(true)
    expect(flags.equipment).toBe(false)
  })

  it('claiming nothing reports nothing to save', () => {
    expect(hasDirtyFlags(claimDirtyFlags(createDirtyFlags()))).toBe(false)
  })

  it('tolerates a missing flag object rather than throwing mid-flush', () => {
    expect(hasDirtyFlags(undefined)).toBe(false)
    expect(hasDirtyFlags(claimDirtyFlags(undefined))).toBe(false)
    expect(restoreDirtyFlags(undefined, createDirtyFlags())).toBe(undefined)
  })

  it('ignores keys outside the tracked stores', () => {
    const flags: any = createDirtyFlags()
    flags.somethingElse = true
    expect(hasDirtyFlags(flags)).toBe(false)
    expect(claimDirtyFlags(flags).somethingElse).toBeUndefined()
    expect(flags.somethingElse).toBe(true)
  })
})
