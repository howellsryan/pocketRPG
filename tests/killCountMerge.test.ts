// Kill-count merge — server KC is merged into the local cache with
// max(local, server) per id so a transient empty/partial server response can
// never zero out locally-known KC (the combat screen KC gate relies on this).

import { describe, it, expect } from 'vitest'
import { mergeKillCounts } from '../src/utils/killCountMerge.js'

describe('mergeKillCounts', () => {
  it('takes the max of local and server per id', () => {
    const merged = mergeKillCounts(
      { ember_tyrant: 10, frost_wyrm: 3 },
      { ember_tyrant: 7, frost_wyrm: 9 },
    )
    expect(merged).toEqual({ ember_tyrant: 10, frost_wyrm: 9 })
  })

  it('keeps local entries missing from the server response', () => {
    const merged = mergeKillCounts({ ember_tyrant: 10 }, {})
    expect(merged).toEqual({ ember_tyrant: 10 })
  })

  it('adds server entries missing locally', () => {
    const merged = mergeKillCounts({}, { ember_tyrant: 4 })
    expect(merged).toEqual({ ember_tyrant: 4 })
  })

  it('tolerates null/undefined inputs', () => {
    expect(mergeKillCounts(null, null)).toEqual({})
    expect(mergeKillCounts(undefined, { a: 2 })).toEqual({ a: 2 })
  })

  it('sanitises bogus server counts instead of corrupting local KC', () => {
    const merged = mergeKillCounts({ a: 5 }, { a: 'NaN', b: -3, c: 2.9 })
    expect(merged).toEqual({ a: 5, b: 0, c: 2 })
  })

  it('does not mutate its inputs', () => {
    const local = { a: 1 }
    const server = { a: 2 }
    mergeKillCounts(local, server)
    expect(local).toEqual({ a: 1 })
    expect(server).toEqual({ a: 2 })
  })
})
