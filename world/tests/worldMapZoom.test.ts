// R2-8 (docs/open-world-changes-plan.md): the zoomAt helper shared by wheel,
// pinch and the zoom buttons — keeps the anchor's world point fixed on
// screen, clamps zoom to the given limits, and re-clamps pan afterward.
import { describe, expect, it } from 'vitest'
import { zoomAt, type MapTransform } from '../client/src/worldMap'

const LIMITS = { min: 1, max: 4 }
const BAKED_W = 200
const BAKED_H = 200
const VIEWPORT = 100

describe('zoomAt', () => {
  it('keeps the anchor point fixed on screen when zooming in', () => {
    const transform: MapTransform = { panX: -20, panY: -30, zoom: 1 }
    const anchorX = 40
    const anchorY = 50
    const worldXBefore = (anchorX - transform.panX) / transform.zoom
    const worldYBefore = (anchorY - transform.panY) / transform.zoom

    const next = zoomAt(transform, anchorX, anchorY, 2, LIMITS, BAKED_W, BAKED_H, VIEWPORT, VIEWPORT)

    const worldXAfter = (anchorX - next.panX) / next.zoom
    const worldYAfter = (anchorY - next.panY) / next.zoom
    expect(worldXAfter).toBeCloseTo(worldXBefore)
    expect(worldYAfter).toBeCloseTo(worldYBefore)
  })

  it('clamps zoom at the configured max', () => {
    const transform: MapTransform = { panX: 0, panY: 0, zoom: 3.9 }
    const next = zoomAt(transform, 50, 50, 10, LIMITS, BAKED_W, BAKED_H, VIEWPORT, VIEWPORT)
    expect(next.zoom).toBe(LIMITS.max)
  })

  it('clamps zoom at the configured min', () => {
    const transform: MapTransform = { panX: 0, panY: 0, zoom: 1.1 }
    const next = zoomAt(transform, 50, 50, 0.1, LIMITS, BAKED_W, BAKED_H, VIEWPORT, VIEWPORT)
    expect(next.zoom).toBe(LIMITS.min)
  })

  it('keeps pan clamped to the baked bounds after zooming out at a corner', () => {
    // Zoomed in and panned to the top-left corner of the baked canvas.
    const transform: MapTransform = { panX: 0, panY: 0, zoom: 4 }
    const next = zoomAt(transform, 0, 0, 1, LIMITS, BAKED_W, BAKED_H, VIEWPORT, VIEWPORT)
    // At zoom 1 the baked canvas (200x200) is bigger than the viewport
    // (100x100), so pan must stay within [viewport - scaled, 0].
    expect(next.panX).toBeLessThanOrEqual(0)
    expect(next.panX).toBeGreaterThanOrEqual(VIEWPORT - BAKED_W * next.zoom)
    expect(next.panY).toBeLessThanOrEqual(0)
    expect(next.panY).toBeGreaterThanOrEqual(VIEWPORT - BAKED_H * next.zoom)
  })
})
