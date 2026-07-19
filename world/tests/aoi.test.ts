import { describe, expect, it } from 'vitest'
import { chebyshev, computeAoi, type AoiEntity } from '../server/aoi'
import type { EntityDiff } from '../shared/protocol'

const diff = (id: string): EntityDiff => ({ id, kind: 'npc', x: 0, z: 0, anim: 'idle' })

describe('chebyshev', () => {
  it('is the max of the axis distances', () => {
    expect(chebyshev(0, 0, 3, 1)).toBe(3)
    expect(chebyshev(10, 10, 7, 6)).toBe(4)
  })
})

describe('computeAoi', () => {
  const entities: AoiEntity[] = [
    { id: 'self', x: 50, z: 50 },
    { id: 'near', x: 55, z: 52 }, // within radius 10
    { id: 'far', x: 90, z: 90 }, // outside radius 10
  ]
  const full = (id: string) => diff(id)

  it('sends this-tick diffs for in-range entities and drops out-of-range ones', () => {
    const changed = new Map<string, EntityDiff>([['near', diff('near')], ['far', diff('far')]])
    const r = computeAoi(50, 50, 'self', 10, entities, changed, full, new Set(['near', 'far']))
    expect(r.ents.map((e) => e.id).sort()).toEqual(['near'])
    expect(r.view.has('near')).toBe(true)
    expect(r.view.has('far')).toBe(false)
  })

  it('always keeps the viewer in view even with no diff for it', () => {
    const r = computeAoi(50, 50, 'self', 10, entities, new Map(), full, new Set())
    expect(r.view.has('self')).toBe(true)
    expect(r.removed).not.toContain('self')
  })

  it('sends a full diff for an entity that just entered range without a tick diff', () => {
    const r = computeAoi(50, 50, 'self', 10, entities, new Map(), full, new Set(['self']))
    // `near` newly visible (not in prevView, no changed diff) → full diff sent.
    expect(r.ents.map((e) => e.id)).toContain('near')
  })

  it('does not re-send an unchanged entity already in view', () => {
    const r = computeAoi(50, 50, 'self', 10, entities, new Map(), full, new Set(['self', 'near']))
    expect(r.ents.map((e) => e.id)).not.toContain('near')
    expect(r.view.has('near')).toBe(true)
  })

  it('removes an entity that left range since last tick', () => {
    const moved: AoiEntity[] = [
      { id: 'self', x: 50, z: 50 },
      { id: 'near', x: 90, z: 90 }, // was near, now far
    ]
    const r = computeAoi(50, 50, 'self', 10, moved, new Map(), full, new Set(['self', 'near']))
    expect(r.removed).toEqual(['near'])
    expect(r.view.has('near')).toBe(false)
  })
})
