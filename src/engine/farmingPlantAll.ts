import { plantCrop, type FarmingPatch, type FarmingPatchType, type FarmingState } from './farming'

export interface PlantAllOutcome {
  state: FarmingState
  planted: Record<string, number>
  consumed: Record<string, number>
  inventoryUsage: Record<string, number>
  bankUsage: Record<string, number>
  totalXp: number
}

export function applyPlantAll(
  state: FarmingState,
  allPatches: Array<{ patchId: string; patch: FarmingPatch | null; type: string }>,
  plantSelections: Partial<Record<FarmingPatchType, string | null | undefined>>,
  inventory: Array<{ itemId: string; quantity: number } | null> | null | undefined,
  bank: Record<string, { quantity?: number }> | null | undefined,
): PlantAllOutcome {
  let nextState = state
  let totalXp = 0
  const planted: Record<string, number> = {}
  const consumed: Record<string, number> = {}
  const inventoryUsage: Record<string, number> = {}
  const bankUsage: Record<string, number> = {}
  const inventoryPool: Record<string, number> = {}
  const bankPool: Record<string, number> = {}

  for (const slot of inventory || []) {
    if (!slot?.itemId) continue
    inventoryPool[slot.itemId] = (inventoryPool[slot.itemId] || 0) + (slot.quantity || 0)
  }
  for (const [itemId, entry] of Object.entries(bank || {})) {
    bankPool[itemId] = Math.max(0, entry?.quantity || 0)
  }

  for (const patchData of allPatches) {
    if (patchData.patch?.cropId) continue
    const patchType = patchData.type as FarmingPatchType
    const seedId = plantSelections[patchType]
    if (!seedId) continue
    const availableInv = inventoryPool[seedId] || 0
    const availableBank = bankPool[seedId] || 0
    if ((availableInv + availableBank) <= 0) continue
    const result = plantCrop(nextState, patchData.patchId, seedId, patchType)
    if (!result) continue
    nextState = result.state
    totalXp += result.plantXp
    planted[seedId] = (planted[seedId] || 0) + 1
    consumed[seedId] = (consumed[seedId] || 0) + 1

    if (availableInv > 0) {
      inventoryUsage[seedId] = (inventoryUsage[seedId] || 0) + 1
      inventoryPool[seedId] = availableInv - 1
    } else {
      bankUsage[seedId] = (bankUsage[seedId] || 0) + 1
      bankPool[seedId] = availableBank - 1
    }
  }

  return { state: nextState, planted, consumed, inventoryUsage, bankUsage, totalXp }
}
