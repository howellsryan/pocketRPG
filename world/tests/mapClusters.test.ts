import { describe, expect, it } from 'vitest'
import { clusterByType } from '../shared/mapClusters'

describe('clusterByType', () => {
  it('merges same-type points within the radius into one cluster', () => {
    const clusters = clusterByType([
      { id: 'r1', type: 'mining', x: 10, z: 10 },
      { id: 'r2', type: 'mining', x: 11, z: 10 },
      { id: 'r3', type: 'mining', x: 12, z: 11 },
    ], 3)
    expect(clusters).toHaveLength(1)
    expect(clusters[0].count).toBe(3)
    expect(clusters[0].ids).toEqual(['r1', 'r2', 'r3'])
  })

  it('keeps points of the same type separate when they are farther apart than the radius', () => {
    const clusters = clusterByType([
      { id: 'a', type: 'woodcutting', x: 0, z: 0 },
      { id: 'b', type: 'woodcutting', x: 50, z: 50 },
    ], 3)
    expect(clusters).toHaveLength(2)
    expect(clusters.map((c) => c.count)).toEqual([1, 1])
  })

  it('never merges across different types even at the same tile', () => {
    const clusters = clusterByType([
      { id: 'bank1', type: 'bank', x: 5, z: 5 },
      { id: 'furnace1', type: 'smithing', x: 5, z: 5 },
    ], 3)
    expect(clusters).toHaveLength(2)
  })

  it('centroid settles near the group middle regardless of visit order', () => {
    const forward = clusterByType([
      { id: 'a', type: 'woodcutting', x: 0, z: 0 },
      { id: 'b', type: 'woodcutting', x: 2, z: 0 },
    ], 3)
    const backward = clusterByType([
      { id: 'b', type: 'woodcutting', x: 2, z: 0 },
      { id: 'a', type: 'woodcutting', x: 0, z: 0 },
    ], 3)
    expect(forward[0].x).toBeCloseTo(1)
    expect(backward[0].x).toBeCloseTo(1)
  })

  it('returns an empty list for no inputs', () => {
    expect(clusterByType([], 3)).toEqual([])
  })
})
