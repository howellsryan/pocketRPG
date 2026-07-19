import { describe, expect, it } from 'vitest'
import { regionsFromGrid, paintGroundRect, floodFillGround, applyGroundGrid, paintGroundLine } from '../client/src/editor/state'
import { groundKindGrid } from '../shared/groundKinds'
import type { ZoneDef } from '../shared/zone'

function base(width: number, height: number): ZoneDef {
  return {
    id: 'g', name: 'G', width, height, spawn: { x: 0, z: 0 },
    collision: Array.from({ length: height }, () => '.'.repeat(width)),
    objects: [], npcs: [],
  }
}

describe('regionsFromGrid', () => {
  it('packs a solid painted block into a single rectangle', () => {
    const grid = new Array(4 * 4).fill('')
    paintGroundRect(grid, 4, 4, 1, 1, 2, 3, 'plaza')
    const regions = regionsFromGrid(4, 4, grid)
    expect(regions).toEqual([{ kind: 'plaza', x: 1, z: 1, w: 2, h: 3 }])
  })

  it('round-trips an arbitrary painted grid through regions with no tile lost', () => {
    const grid = new Array(6 * 5).fill('')
    paintGroundRect(grid, 6, 5, 0, 2, 5, 2, 'path_dirt') // a horizontal road
    paintGroundRect(grid, 6, 5, 3, 0, 3, 4, 'path_cobble') // a vertical road crossing it
    const regions = regionsFromGrid(6, 5, grid)
    // Re-resolving the regions must reproduce the exact painted grid.
    expect(groundKindGrid(6, 5, regions)).toEqual(grid)
  })

  it('emits no region for an all-empty grid', () => {
    expect(regionsFromGrid(3, 3, new Array(9).fill(''))).toEqual([])
  })
})

describe('applyGroundGrid', () => {
  it('drops the ground field entirely when the grid is erased', () => {
    const def = base(3, 3)
    const grid = new Array(9).fill('')
    grid[0] = 'water'
    applyGroundGrid(def, grid)
    expect(def.ground).toBeTruthy()
    applyGroundGrid(def, new Array(9).fill(''))
    expect(def.ground).toBeUndefined()
  })
})

describe('paintGroundLine', () => {
  it('paints a continuous path of the chosen width between two points', () => {
    const grid = new Array(7 * 7).fill('')
    paintGroundLine(grid, 7, 7, 1, 3, 5, 3, 3, 'path_cobble') // horizontal, 3 wide
    // Every tile along the run, across the full width, is painted.
    for (let x = 1; x <= 5; x++) for (let z = 2; z <= 4; z++) expect(grid[z * 7 + x]).toBe('path_cobble')
    // Outside the band stays empty.
    expect(grid[1 * 7 + 3]).toBe('')
    expect(grid[5 * 7 + 3]).toBe('')
  })

  it('keeps a diagonal segment unbroken (no gaps between samples)', () => {
    const grid = new Array(6 * 6).fill('')
    paintGroundLine(grid, 6, 6, 0, 0, 5, 5, 1, 'path_dirt')
    for (let i = 0; i <= 5; i++) expect(grid[i * 6 + i]).toBe('path_dirt')
  })
})

describe('floodFillGround', () => {
  it('fills only the connected empty region and stops at painted edges', () => {
    const grid = new Array(4 * 1).fill('')
    grid[1] = 'path_dirt' // a wall at x=1 splits the row
    floodFillGround(grid, 4, 1, 0, 0, 'plaza')
    expect(grid).toEqual(['plaza', 'path_dirt', '', ''])
  })
})
