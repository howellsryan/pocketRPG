import { describe, expect, it } from 'vitest'
import { activeChunks, chunkGridDims, chunkKey, chunkTileBounds, diffChunks } from '../client/src/chunkedTerrain'

describe('chunkGridDims', () => {
  it('divides a whole-number-of-chunks map exactly', () => {
    expect(chunkGridDims(192, 64, 32)).toEqual({ cols: 6, rows: 2 })
  })

  it('rounds a partial last chunk up', () => {
    expect(chunkGridDims(100, 32, 32)).toEqual({ cols: 4, rows: 1 })
  })

  it('never yields a zero-dimension grid', () => {
    expect(chunkGridDims(10, 10, 32)).toEqual({ cols: 1, rows: 1 })
  })
})

describe('chunkTileBounds', () => {
  it('gives a full chunk in the map interior', () => {
    expect(chunkTileBounds(1, 0, 192, 64, 32)).toEqual({ x0: 32, z0: 0, cw: 32, ch: 32 })
  })

  it('clamps the last chunk to the map edge', () => {
    // width 100, chunk col 3 starts at x=96 → only 4 tiles remain.
    expect(chunkTileBounds(3, 0, 100, 32, 32)).toEqual({ x0: 96, z0: 0, cw: 4, ch: 32 })
  })
})

describe('activeChunks', () => {
  it('returns every chunk when the radius spans the grid (full-map render)', () => {
    const keys = activeChunks(96, 32, 192, 64, 6, 32)
    expect(keys.length).toBe(6 * 2)
    expect(new Set(keys)).toEqual(new Set(
      Array.from({ length: 2 }, (_, cz) => Array.from({ length: 6 }, (_, cx) => chunkKey(cx, cz))).flat(),
    ))
  })

  it('returns only the chunks within radius of the centre — far chunks stream out', () => {
    // Centre at tile (16,16) → chunk (0,0); radius 1 → chunks cx,cz in {0,1}.
    const keys = new Set(activeChunks(16, 16, 192, 64, 1, 32))
    expect(keys).toEqual(new Set([chunkKey(0, 0), chunkKey(1, 0), chunkKey(0, 1), chunkKey(1, 1)]))
    // A chunk five columns away is not built.
    expect(keys.has(chunkKey(5, 0))).toBe(false)
  })

  it('clamps the active window at the map edge (no negative or out-of-range chunks)', () => {
    const keys = activeChunks(0, 0, 192, 64, 1, 32)
    for (const k of keys) {
      const [cx, cz] = k.split(',').map(Number)
      expect(cx).toBeGreaterThanOrEqual(0)
      expect(cz).toBeGreaterThanOrEqual(0)
      expect(cx).toBeLessThan(6)
      expect(cz).toBeLessThan(2)
    }
  })
})

describe('diffChunks (the streaming enter/leave)', () => {
  it('reports chunks to build and chunks to dispose as the centre moves', () => {
    const before = new Set(activeChunks(16, 16, 192, 64, 1, 32)) // around chunk (0,0)
    const after = new Set(activeChunks(80, 16, 192, 64, 1, 32)) // centre moves east to chunk (2,0)
    const { add, remove } = diffChunks(before, after)
    // Column 0 chunks leave; column 3 chunks enter.
    expect(remove).toContain(chunkKey(0, 0))
    expect(remove).toContain(chunkKey(0, 1))
    expect(add).toContain(chunkKey(3, 0))
    expect(add).toContain(chunkKey(3, 1))
    // Overlap column (1) is neither added nor removed.
    expect(add).not.toContain(chunkKey(1, 0))
    expect(remove).not.toContain(chunkKey(1, 0))
  })

  it('is empty when the active set is unchanged (no rebuild churn)', () => {
    const set = new Set(activeChunks(96, 32, 192, 64, 6, 32))
    const { add, remove } = diffChunks(set, new Set(set))
    expect(add).toEqual([])
    expect(remove).toEqual([])
  })
})
