// The minimap's viewport window: covers the merged overworld (348x213 tiles)
// being unreadable when the whole zone was squeezed into a 132px square, and
// makes sure small zones (lumbright, 64x64) still behave sanely.
import { describe, expect, it } from 'vitest'
import { clusterStatics, inMinimapView, minimapView } from '../client/src/minimap'

describe('minimapView', () => {
  it('centres a full window on the player away from any edge', () => {
    const view = minimapView(174, 106, 348, 213, 41)
    expect(view.tilesShownX).toBe(41)
    expect(view.tilesShownZ).toBe(41)
    expect(view.x0).toBe(174 - 41 / 2)
    expect(view.z0).toBe(106 - 41 / 2)
  })

  it('clamps the window at the low edge (top-left corner)', () => {
    const view = minimapView(0, 0, 348, 213, 41)
    expect(view.x0).toBe(0)
    expect(view.z0).toBe(0)
    expect(view.tilesShownX).toBe(41)
    expect(view.tilesShownZ).toBe(41)
  })

  it('clamps the window at the high edge (bottom-right corner)', () => {
    const view = minimapView(347, 212, 348, 213, 41)
    expect(view.x0).toBe(348 - 41)
    expect(view.z0).toBe(213 - 41)
  })

  it('shows the whole zone on an axis smaller than the view size', () => {
    // lumbright is 64x64 — larger than 41 on both axes, so it still windows;
    // a zone genuinely smaller than the view (e.g. a 20-tile interior) must
    // show its full extent on that axis instead of clamping to a negative range.
    const view = minimapView(10, 10, 20, 20, 41)
    expect(view.tilesShownX).toBe(20)
    expect(view.tilesShownZ).toBe(20)
    expect(view.x0).toBe(0)
    expect(view.z0).toBe(0)
  })

  it('windows independently per axis when only one dimension exceeds the view size', () => {
    const view = minimapView(15, 100, 30, 213, 41)
    expect(view.tilesShownX).toBe(30) // whole width shown
    expect(view.tilesShownZ).toBe(41) // height windows
    expect(view.x0).toBe(0)
    expect(view.z0).toBe(100 - 41 / 2)
  })

  it('keeps the player tile inside the returned window everywhere on the map', () => {
    for (const [x, z] of [[0, 0], [1, 0], [347, 212], [174, 0], [0, 106], [200, 50]]) {
      const view = minimapView(x, z, 348, 213, 41)
      expect(x).toBeGreaterThanOrEqual(view.x0)
      expect(x).toBeLessThan(view.x0 + view.tilesShownX)
      expect(z).toBeGreaterThanOrEqual(view.z0)
      expect(z).toBeLessThan(view.z0 + view.tilesShownZ)
    }
  })
})

describe('inMinimapView', () => {
  const view = minimapView(174, 106, 348, 213, 41)

  it('is true for a point inside the window', () => {
    expect(inMinimapView(174, 106, view)).toBe(true)
  })

  it('is false for a point outside the window', () => {
    expect(inMinimapView(0, 0, view)).toBe(false)
  })

  it('excludes the far edge (half-open range, matching the window math)', () => {
    expect(inMinimapView(view.x0 + view.tilesShownX, view.z0, view)).toBe(false)
    expect(inMinimapView(view.x0, view.z0, view)).toBe(true)
  })
})

describe('clusterStatics', () => {
  it('clusters banks/skilling statics into map categories, dropping unmapped static types', () => {
    const clusters = clusterStatics([
      { id: 'r1', type: 'rock', x: 10, z: 10 },
      { id: 'r2', type: 'rock', x: 11, z: 10 },
      { id: 'bank1', type: 'bank_chest', x: 20, z: 20 },
      { id: 'other1', type: 'furnace_anvil_station_that_does_not_exist', x: 30, z: 30 },
    ], 3)
    expect(clusters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'mining', count: 2 }),
        expect.objectContaining({ type: 'bank', count: 1 }),
      ])
    )
    expect(clusters).toHaveLength(2)
  })
})
