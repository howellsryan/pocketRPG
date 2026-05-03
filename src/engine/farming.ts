import farmingData from '../data/farming.json'
import { countItem } from './inventory.js'

export interface FarmingPatch {
  patchId: string
  cropId?: string
  type: 'herb' | 'tree' | 'fruitTree'
  stage: number // 1-4 for herb/tree, 1-4 for growth + fruit count for fruitTree
  plantedAt: number // timestamp in ms
  readyAt: number // when to transition to next stage
}

export interface FarmingState {
  patchesById: {
    [patchId: string]: FarmingPatch
  }
}

export interface CropDef {
  id: string
  cropId: string
  name: string
  level: number
  plantXp: number
  harvestXp: number
  growthTimeMs: number
  fruitRegrowMs?: number
  fruitLimit?: number
  icon: string
}
export type FarmingPatchType = 'herb' | 'tree' | 'fruitTree'

export function getCropType(seedId: string): FarmingPatchType | null {
  if (farmingData.herbs.some(c => c.id === seedId)) return 'herb'
  if (farmingData.trees.some(c => c.id === seedId)) return 'tree'
  if (farmingData.fruitTrees.some(c => c.id === seedId)) return 'fruitTree'
  return null
}

export function initFarmingState(): FarmingState {
  return { patchesById: {} }
}

export function generatePatchId(locationId: string, type: string, index: number): string {
  return `${locationId}_${type}_${index}`
}

export function getCropDef(seedId: string): CropDef | null {
  for (const category of ['herbs', 'trees', 'fruitTrees'] as const) {
    const crop = farmingData[category].find(c => c.id === seedId)
    if (crop) return crop as CropDef
  }
  return null
}

/**
 * Stage is derived from elapsed wall-clock time since planting — no ticks
 * required, so growth works offline and during idle. Each of 4 stages takes
 * growthTimeMs / 4 of real time; stage 4 = harvestable.
 */
export function getEffectiveStage(patch: FarmingPatch | null | undefined): number {
  if (!patch || !patch.cropId) return 1
  const crop = getCropDef(patch.cropId)
  if (!crop) return patch.stage || 1
  const elapsed = Date.now() - patch.plantedAt
  const perStage = crop.growthTimeMs / 4
  if (perStage <= 0) return 4
  return Math.max(1, Math.min(4, 1 + Math.floor(elapsed / perStage)))
}

export function plantCrop(
  state: FarmingState,
  patchId: string,
  seedId: string,
  patchType: FarmingPatchType
): { state: FarmingState; plantXp: number; cropName: string } | null {
  const crop = getCropDef(seedId)
  if (!crop) return null
  const cropType = getCropType(seedId)
  if (!cropType || cropType !== patchType) return null

  const now = Date.now()
  const patch: FarmingPatch = {
    patchId,
    cropId: seedId,
    type: cropType,
    stage: 1,
    plantedAt: now,
    readyAt: now + crop.growthTimeMs
  }

  return {
    state: { ...state, patchesById: { ...state.patchesById, [patchId]: patch } },
    plantXp: crop.plantXp,
    cropName: crop.name
  }
}

export function harvestCrop(
  state: FarmingState,
  patchId: string
): { state: FarmingState; harvestXp: number; cropId: string; quantity: number } | null {
  const patch = state.patchesById[patchId]
  if (!patch || !patch.cropId) return null
  if (getEffectiveStage(patch) < 4) return null

  const crop = getCropDef(patch.cropId)
  if (!crop) return null

  const newState = { ...state, patchesById: { ...state.patchesById } }
  delete newState.patchesById[patchId]

  return {
    state: newState,
    harvestXp: crop.harvestXp,
    cropId: crop.cropId,
    quantity: 1
  }
}

export function processFarmingTick(state: FarmingState): FarmingState {
  // Stage is derived from elapsed time — no state mutation needed here.
  return state
}

export function advanceFarmingState(state: FarmingState, elapsedMs: number): FarmingState {
  if (!state?.patchesById || elapsedMs <= 0) return state
  const nextPatchesById: FarmingState['patchesById'] = {}
  for (const [patchId, patch] of Object.entries(state.patchesById)) {
    if (!patch?.cropId) {
      nextPatchesById[patchId] = patch
      continue
    }
    nextPatchesById[patchId] = {
      ...patch,
      plantedAt: patch.plantedAt - elapsedMs,
      readyAt: patch.readyAt - elapsedMs,
    }
  }
  return { ...state, patchesById: nextPatchesById }
}

export function getPatchesForLocation(
  state: FarmingState,
  locationId: string
): { patchId: string; patch: FarmingPatch | null; type: string }[] {
  const location = farmingData.locations.find(l => l.id === locationId)
  if (!location) return []

  const results: { patchId: string; patch: FarmingPatch | null; type: string }[] = []
  let herbIndex = 0,
    treeIndex = 0,
    fruitIndex = 0

  for (const patchDef of location.patches) {
    for (let i = 0; i < patchDef.count; i++) {
      let patchId = ''
      if (patchDef.type === 'herb') {
        patchId = generatePatchId(locationId, 'herb', herbIndex++)
      } else if (patchDef.type === 'tree') {
        patchId = generatePatchId(locationId, 'tree', treeIndex++)
      } else if (patchDef.type === 'fruitTree') {
        patchId = generatePatchId(locationId, 'fruitTree', fruitIndex++)
      }
      results.push({
        patchId,
        patch: state.patchesById[patchId] || null,
        type: patchDef.type
      })
    }
  }

  return results
}

export function getAvailableCrops(type: 'herb' | 'tree' | 'fruitTree', currentLevel: number): CropDef[] {
  const cropList = type === 'herb' ? farmingData.herbs : type === 'tree' ? farmingData.trees : farmingData.fruitTrees
  return cropList.filter(c => currentLevel >= c.level)
}

export interface PlantableCropOption {
  crop: CropDef
  ownedQuantity: number
  canPlant: boolean
}

export function getPlantableCropOptions(
  type: FarmingPatchType,
  currentLevel: number,
  inventory: Array<{ itemId: string; quantity: number } | null> | null | undefined
): PlantableCropOption[] {
  const safeInventory = Array.isArray(inventory) ? inventory : []
  return getAvailableCrops(type, currentLevel).map(crop => {
    const ownedQuantity = countItem(safeInventory, crop.id)
    return {
      crop,
      ownedQuantity,
      canPlant: ownedQuantity > 0
    }
  })
}

export function getReadyPatchSummaryForLocation(state: FarmingState | null | undefined, locationId: string): Array<{ type: FarmingPatchType; count: number }> {
  if (!state?.patchesById || !locationId) return []

  const readyCounts = new Map<FarmingPatchType, number>()
  const patches = getPatchesForLocation(state, locationId)
  for (const { patch, type } of patches) {
    if (!patch?.cropId) continue
    if (getEffectiveStage(patch) < 4) continue
    const patchType = type as FarmingPatchType
    readyCounts.set(patchType, (readyCounts.get(patchType) || 0) + 1)
  }

  return (['herb', 'tree', 'fruitTree'] as const)
    .filter(type => readyCounts.has(type))
    .map(type => ({ type, count: readyCounts.get(type) || 0 }))
}

export function formatGrowthTime(ms: number): string {
  const minutes = Math.floor(ms / 60000)
  const hours = Math.floor(minutes / 60)
  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`
  }
  return `${minutes}m`
}

export function getGrowthProgress(patch: FarmingPatch | null): number {
  if (!patch || !patch.cropId) return 0
  const crop = getCropDef(patch.cropId)
  if (!crop) return 0

  const now = Date.now()
  const elapsed = now - patch.plantedAt
  const progress = Math.min((elapsed / crop.growthTimeMs) * 100, 100)
  return Math.round(progress)
}

export function getStageLabel(stage: number, maxStage: number = 4): string {
  return `Stage ${stage}/${maxStage}`
}
