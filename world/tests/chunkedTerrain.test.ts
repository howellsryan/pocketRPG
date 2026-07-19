import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { activeChunks, chunkFollowRadius, chunkGridDims, chunkKey, chunkTileBounds, createChunkedTerrain, diffChunks } from '../client/src/chunkedTerrain'

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

describe('chunkFollowRadius', () => {
  it('exceeds the fog range so the player never sees the terrain edge', () => {
    // 110 fog / 32 tiles = 3.4 → 4 chunks (128 tiles) covers past the fog.
    expect(chunkFollowRadius(110, 32)).toBe(4)
    expect(chunkFollowRadius(110, 32) * 32).toBeGreaterThan(110)
  })
})

describe('createChunkedTerrain streaming (real chunk meshes)', () => {
  // A shared material skips the per-chunk canvas texture, so chunk meshes build
  // headlessly (THREE scene graph only, no WebGL/DOM).
  const W = 96
  const H = 64
  const collision = Array.from({ length: H }, () => '.'.repeat(W))
  const corners = new Float32Array((W + 1) * (H + 1)) // flat is fine for meshing

  function make() {
    const scene = new THREE.Scene()
    const mat = new THREE.MeshBasicMaterial()
    return createChunkedTerrain(scene, collision, W, H, undefined, corners, mat, 32)
  }

  it('builds only the chunks within the radius, not the whole map', () => {
    const ct = make()
    ct.setCentre(16, 16, 6) // radius spans the 3×2 grid → all 6
    expect(ct.pickTargets().length).toBe(6)
    ct.setCentre(16, 16, 0) // just the centre chunk
    expect(ct.pickTargets().length).toBe(1)
    ct.dispose()
  })

  it('disposes the chunks left behind as the centre moves (no unbounded growth)', () => {
    const ct = make()
    ct.setCentre(16, 16, 0) // chunk (0,0)
    expect(ct.pickTargets().length).toBe(1)
    ct.setCentre(80, 16, 0) // chunk (2,0) — (0,0) must be gone
    expect(ct.pickTargets().length).toBe(1)
    expect(ct.group.children.length).toBe(1) // group tracks the live set exactly
    ct.dispose()
    expect(ct.pickTargets().length).toBe(0)
  })
})
