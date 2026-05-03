import { describe, it, expect, vi, afterEach } from 'vitest'
import { initFarmingState, getCropDef, getAvailableCrops, plantCrop, harvestCrop, getEffectiveStage, getGrowthProgress, advanceFarmingState } from '../src/engine/farming.ts'

afterEach(() => {
  vi.useRealTimers()
})

describe('farming engine', () => {
  it('initFarmingState returns empty patches', () => {
    expect(initFarmingState()).toEqual({ patchesById: {} })
  })

  it('getCropDef finds herb, tree, and fruit tree crops', () => {
    expect(getCropDef('guam_seed')?.id).toBe('guam_seed')
    expect(getCropDef('oak_sapling')?.id).toBe('oak_sapling')
    expect(getCropDef('apple_sapling')?.id).toBe('apple_sapling')
  })

  it('getAvailableCrops respects level requirements', () => {
    expect(getAvailableCrops('herb', 1).some(c => c.id === 'guam_seed')).toBe(true)
    expect(getAvailableCrops('herb', 1).some(c => c.id === 'ranarr_seed')).toBe(false)
  })

  it('plantCrop plants valid crops with expected fields', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    const state = initFarmingState()
    const result = plantCrop(state, 'falador_herb_0', 'guam_seed', 'herb')
    expect(result).toBeTruthy()
    const patch = result!.state.patchesById['falador_herb_0']
    expect(patch.patchId).toBe('falador_herb_0')
    expect(patch.cropId).toBe('guam_seed')
    expect(patch.type).toBe('herb')
    expect(patch.plantedAt).toBe(Date.now())
    expect(patch.readyAt).toBe(Date.now() + (getCropDef('guam_seed')?.growthTimeMs || 0))
  })

  it('plantCrop rejects invalid patch and crop combos', () => {
    const state = initFarmingState()
    expect(plantCrop(state, 'falador_tree_0', 'guam_seed', 'tree')).toBeNull()
    expect(plantCrop(state, 'falador_herb_0', 'oak_sapling', 'herb')).toBeNull()
  })

  it('effective stage starts at 1 and reaches 4 with elapsed time', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    const planted = plantCrop(initFarmingState(), 'falador_tree_0', 'oak_sapling', 'tree')!
    expect(getEffectiveStage(planted.state.patchesById['falador_tree_0'])).toBe(1)
    vi.setSystemTime(new Date(Date.now() + (getCropDef('oak_sapling')!.growthTimeMs)))
    expect(getEffectiveStage(planted.state.patchesById['falador_tree_0'])).toBe(4)
  })

  it('growth progress reaches 100 by ready time', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    const planted = plantCrop(initFarmingState(), 'falador_herb_0', 'guam_seed', 'herb')!
    const patch = planted.state.patchesById['falador_herb_0']
    expect(getGrowthProgress(patch)).toBe(0)
    vi.setSystemTime(new Date(Date.now() + getCropDef('guam_seed')!.growthTimeMs))
    expect(getGrowthProgress(patch)).toBe(100)
  })

  it('harvest blocks early and succeeds when ready, then clears patch', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    const planted = plantCrop(initFarmingState(), 'falador_fruitTree_0', 'apple_sapling', 'fruitTree')!
    expect(harvestCrop(planted.state, 'falador_fruitTree_0')).toBeNull()
    vi.setSystemTime(new Date(Date.now() + getCropDef('apple_sapling')!.growthTimeMs))
    const harvested = harvestCrop(planted.state, 'falador_fruitTree_0')
    expect(harvested).toBeTruthy()
    expect(harvested!.state.patchesById['falador_fruitTree_0']).toBeUndefined()
  })

  it('advanceFarmingState advances planted patches and keeps empty unchanged without mutation', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    const planted = plantCrop(initFarmingState(), 'falador_tree_0', 'oak_sapling', 'tree')!
    const original = {
      patchesById: {
        ...planted.state.patchesById,
        empty_patch: { patchId: 'empty_patch', type: 'herb', stage: 1, plantedAt: 0, readyAt: 0 },
      },
    }
    const before = original.patchesById['falador_tree_0']
    const next = advanceFarmingState(original as any, 3600000)
    expect(next).not.toBe(original)
    expect(next.patchesById['falador_tree_0'].plantedAt).toBe(before.plantedAt - 3600000)
    expect(next.patchesById['empty_patch']).toEqual(original.patchesById['empty_patch'])
    expect(original.patchesById['falador_tree_0'].plantedAt).toBe(before.plantedAt)
  })

  it('advanceFarmingState can make a tree ready after enough skip time', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    const planted = plantCrop(initFarmingState(), 'falador_tree_0', 'oak_sapling', 'tree')!
    const progressed = advanceFarmingState(planted.state, getCropDef('oak_sapling')!.growthTimeMs)
    expect(getEffectiveStage(progressed.patchesById['falador_tree_0'])).toBe(4)
  })
})
