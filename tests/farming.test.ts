import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  initFarmingState,
  getCropDef,
  getAvailableCrops,
  plantCrop,
  harvestCrop,
  getEffectiveStage,
  getGrowthProgress,
  advanceFarmingState,
} from '../src/engine/farming.ts'
import { GATHERING_SKILLS, STUB_SKILLS } from '../src/utils/constants.js'

describe('farming engine', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('initFarmingState returns empty patch state', () => {
    expect(initFarmingState()).toEqual({ patchesById: {} })
  })

  it('getCropDef finds herb/tree/fruit tree definitions', () => {
    expect(getCropDef('guam_seed')?.name).toBe('Guam')
    expect(getCropDef('oak_sapling')?.name).toBe('Oak')
    expect(getCropDef('apple_sapling')?.name).toBe('Apple')
  })

  it('getAvailableCrops respects farming level', () => {
    expect(getAvailableCrops('herb', 1).some(c => c.id === 'guam_seed')).toBe(true)
    expect(getAvailableCrops('tree', 1).some(c => c.id === 'oak_sapling')).toBe(false)
    expect(getAvailableCrops('fruitTree', 30).some(c => c.id === 'banana_sapling')).toBe(false)
    expect(getAvailableCrops('fruitTree', 33).some(c => c.id === 'banana_sapling')).toBe(true)
  })

  it('plantCrop plants valid crop with expected fields', () => {
    const result = plantCrop(initFarmingState(), 'falador_herb_0', 'guam_seed', 'herb')
    expect(result).toBeTruthy()
    const patch = result!.state.patchesById.falador_herb_0
    expect(patch.patchId).toBe('falador_herb_0')
    expect(patch.cropId).toBe('guam_seed')
    expect(patch.type).toBe('herb')
    expect(patch.plantedAt).toBe(Date.now())
    expect(patch.readyAt).toBeGreaterThan(patch.plantedAt)
  })

  it('plantCrop rejects invalid crop/patch type combinations', () => {
    expect(plantCrop(initFarmingState(), 'falador_tree_0', 'guam_seed', 'tree')).toBeNull()
    expect(plantCrop(initFarmingState(), 'falador_herb_0', 'oak_sapling', 'herb')).toBeNull()
    expect(plantCrop(initFarmingState(), 'catherby_fruitTree_0', 'apple_sapling', 'tree')).toBeNull()
  })

  it('getEffectiveStage returns stage 1 immediately after planting', () => {
    const planted = plantCrop(initFarmingState(), 'falador_herb_0', 'guam_seed', 'herb')!
    expect(getEffectiveStage(planted.state.patchesById.falador_herb_0)).toBe(1)
  })

  it('getEffectiveStage reaches stage 4 after elapsed growth time', () => {
    const planted = plantCrop(initFarmingState(), 'falador_tree_0', 'oak_sapling', 'tree')!
    vi.advanceTimersByTime(getCropDef('oak_sapling')!.growthTimeMs + 1)
    expect(getEffectiveStage(planted.state.patchesById.falador_tree_0)).toBe(4)
  })

  it('getGrowthProgress reaches 100 once enough time has passed', () => {
    const planted = plantCrop(initFarmingState(), 'falador_herb_0', 'guam_seed', 'herb')!
    vi.advanceTimersByTime(getCropDef('guam_seed')!.growthTimeMs + 1)
    expect(getGrowthProgress(planted.state.patchesById.falador_herb_0)).toBe(100)
  })

  it('harvestCrop rejects harvesting before ready', () => {
    const planted = plantCrop(initFarmingState(), 'falador_herb_0', 'guam_seed', 'herb')!
    expect(harvestCrop(planted.state, 'falador_herb_0')).toBeNull()
  })

  it('harvestCrop succeeds when ready and clears patch', () => {
    const planted = plantCrop(initFarmingState(), 'falador_herb_0', 'guam_seed', 'herb')!
    vi.advanceTimersByTime(getCropDef('guam_seed')!.growthTimeMs + 1)
    const harvested = harvestCrop(planted.state, 'falador_herb_0')
    expect(harvested).toBeTruthy()
    expect(harvested!.cropId).toBe('guam_leaf')
    expect(harvested!.state.patchesById.falador_herb_0).toBeUndefined()
  })

  it('advanceFarmingState advances planted patches by elapsed ms', () => {
    const planted = plantCrop(initFarmingState(), 'falador_tree_0', 'oak_sapling', 'tree')!
    const patchBefore = planted.state.patchesById.falador_tree_0
    const advanced = advanceFarmingState(planted.state, 60 * 60 * 1000)
    const patchAfter = advanced.patchesById.falador_tree_0
    expect(patchAfter.plantedAt).toBe(patchBefore.plantedAt - 60 * 60 * 1000)
    expect(patchAfter.readyAt).toBe(patchBefore.readyAt - 60 * 60 * 1000)
  })

  it('advanceFarmingState does not mutate original state', () => {
    const planted = plantCrop(initFarmingState(), 'falador_tree_0', 'oak_sapling', 'tree')!
    const original = planted.state
    const originalPlantedAt = original.patchesById.falador_tree_0.plantedAt
    const advanced = advanceFarmingState(original, 1000)
    expect(original.patchesById.falador_tree_0.plantedAt).toBe(originalPlantedAt)
    expect(advanced.patchesById.falador_tree_0.plantedAt).toBe(originalPlantedAt - 1000)
  })

  it('advanceFarmingState leaves empty patches unchanged', () => {
    const state = { patchesById: { falador_herb_0: { patchId: 'falador_herb_0', type: 'herb', stage: 1, plantedAt: 1, readyAt: 1 } } } as any
    const advanced = advanceFarmingState(state, 1000)
    expect(advanced.patchesById.falador_herb_0).toEqual(state.patchesById.falador_herb_0)
  })

  it('advanceFarmingState can make a tree ready after enough skipped time', () => {
    const planted = plantCrop(initFarmingState(), 'falador_tree_0', 'oak_sapling', 'tree')!
    const growthMs = getCropDef('oak_sapling')!.growthTimeMs
    const advanced = advanceFarmingState(planted.state, growthMs + 1)
    expect(getEffectiveStage(advanced.patchesById.falador_tree_0)).toBe(4)
  })
})

describe('farming regression constants', () => {
  it('keeps farming trainable in skill grouping', () => {
    expect(GATHERING_SKILLS).toContain('farming')
    expect(STUB_SKILLS.has('farming')).toBe(false)
  })
})
