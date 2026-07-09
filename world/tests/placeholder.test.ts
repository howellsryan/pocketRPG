import { describe, expect, it } from 'vitest'
import { findPath } from '../server/pathfind'

describe('world scaffold', () => {
  it('pathfind placeholder returns the origin tile', () => {
    const from = { x: 0, z: 0 }
    expect(findPath([], from, { x: 1, z: 1 })).toEqual([from])
  })
})
