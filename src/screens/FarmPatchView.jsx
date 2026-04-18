import { useState, useEffect, useRef } from 'preact/hooks'
import { useGame } from '../state/gameState.jsx'
import { getPatchesForLocation, getAvailableCrops, getCropDef, formatGrowthTime, getGrowthProgress, getStageLabel, getEffectiveStage, plantCrop, harvestCrop } from '../engine/farming.ts'
import { onTick } from '../engine/tick.js'
import ProgressBar from '../components/ProgressBar.jsx'
import Modal from '../components/Modal.jsx'
import farmingData from '../data/farming.json'

const patchViewTypeLabels = {
  herb: 'Herb Patch',
  tree: 'Tree Patch',
  fruitTree: 'Fruit Tree Patch'
}

export default function FarmPatchView({ locationId, farmingLevel, onBack }) {
  const { inventory, farming, updateFarming, grantXP, removeFromInventory, addToBank, addToast } = useGame()

  const location = farmingData.locations.find(l => l.id === locationId)
  const [patchStates, setPatchStates] = useState([])
  const [selectedPatch, setSelectedPatch] = useState(null)
  const patchesRef = useRef(patchStates)

  useEffect(() => {
    if (farming) {
      setPatchStates(getPatchesForLocation(farming, locationId))
    }
  }, [farming, locationId])

  useEffect(() => {
    patchesRef.current = patchStates
  }, [patchStates])

  // Tick listener for growth
  useEffect(() => {
    const unsub = onTick(() => {
      setPatchStates(getPatchesForLocation(farming, locationId))
    })
    return unsub
  }, [farming, locationId])

  const handlePlantCrop = (seedId) => {
    const crop = getCropDef(seedId)
    if (!crop) return

    if (farmingLevel < crop.level) {
      addToast(`Need ${crop.level} Farming`, 'error')
      return
    }

    const seedSlot = inventory.findIndex(s => s && s.itemId === seedId)
    if (seedSlot < 0) {
      addToast(`Need ${crop.name} seed`, 'error')
      return
    }

    const result = plantCrop(farming, selectedPatch.patchId, seedId)
    if (!result) {
      addToast('Failed to plant', 'error')
      return
    }

    updateFarming(result.state)
    removeFromInventory(seedSlot, 1)
    grantXP('farming', result.plantXp)
    addToast(`Planted ${result.cropName}`, 'success')
    setSelectedPatch(null)
  }

  const handleHarvest = () => {
    const result = harvestCrop(farming, selectedPatch.patchId)
    if (!result) {
      addToast('Not ready to harvest', 'error')
      return
    }

    const crop = getCropDef(result.cropId)
    updateFarming(result.state)
    grantXP('farming', result.harvestXp)
    addToBank(result.cropId, result.quantity)
    addToast(`Harvested ${crop.name}`, 'success')
    setSelectedPatch(null)
  }

  const isEmpty = selectedPatch && !selectedPatch.patch?.cropId

  return (
    <div class="h-full overflow-y-auto p-4">
      <button onClick={onBack} class="text-xs text-[var(--color-gold-dim)] mb-3 flex items-center gap-1">
        ← Farms
      </button>

      <div class="flex items-center justify-between mb-1">
        <h2 class="font-[var(--font-display)] text-base font-bold text-[var(--color-gold)] capitalize">
          🌾 {location?.name}
        </h2>
        <span class="text-xs font-[var(--font-mono)] text-[var(--color-gold)]">Lv {farmingLevel}</span>
      </div>
      <p class="text-xs text-[var(--color-parchment)] opacity-40 mb-3">
        {location?.patches.map(p => `${p.count}× ${patchViewTypeLabels[p.type]}`).join(' · ')}
      </p>

      <div class="space-y-2">
        {patchStates.map(patchData => (
          <PatchCard
            key={patchData.patchId}
            patchData={patchData}
            onClick={() => setSelectedPatch(patchData)}
          />
        ))}
      </div>

      {selectedPatch && (
        <Modal
          title={patchViewTypeLabels[selectedPatch.type]}
          onClose={() => setSelectedPatch(null)}
        >
          {isEmpty ? (
            <>
              <div class="mb-3 bg-[#111] rounded-lg px-3 py-2 text-[11px] text-[var(--color-parchment)] opacity-60 flex items-center gap-2">
                <span>🌱</span>
                <span>Select a seed to plant in this patch</span>
              </div>
              <div class="space-y-2">
                {getAvailableCrops(selectedPatch.type, farmingLevel).map(crop => (
                  <button
                    key={crop.id}
                    onClick={() => handlePlantCrop(crop.id)}
                    class="w-full flex items-center justify-between p-3 rounded-xl border transition-colors text-left bg-[#1a1a1a] border-[#2a2a2a] active:bg-[#222]"
                  >
                    <div class="flex-1">
                      <div class="text-sm font-semibold text-[var(--color-parchment)]">
                        {crop.icon} {crop.name}
                      </div>
                      <div class="text-[10px] text-[var(--color-parchment)] opacity-40 mt-0.5">
                        Lv {crop.level} · {crop.plantXp} XP plant · {crop.harvestXp} XP harvest
                      </div>
                      <div class="text-[10px] text-[var(--color-parchment)] opacity-40">
                        Growth: {formatGrowthTime(crop.growthTimeMs)}
                      </div>
                    </div>
                  </button>
                ))}
                {getAvailableCrops(selectedPatch.type, farmingLevel).length === 0 && (
                  <div class="text-center py-4 text-xs text-[var(--color-parchment)] opacity-50">
                    No seeds available at your level
                  </div>
                )}
              </div>
            </>
          ) : (
            <PatchDetails
              patch={selectedPatch.patch}
              onHarvest={handleHarvest}
            />
          )}
        </Modal>
      )}
    </div>
  )
}

function PatchCard({ patchData, onClick }) {
  const { patch, type } = patchData
  const crop = patch?.cropId ? getCropDef(patch.cropId) : null

  let statusText = 'Empty'
  let statusColor = 'text-[var(--color-parchment)] opacity-40'
  let progressValue = 0

  if (patch && crop) {
    const stage = getEffectiveStage(patch)
    if (stage >= 4) {
      statusText = 'Ready to harvest'
      statusColor = 'text-[var(--color-gold)]'
      progressValue = 100
    } else {
      statusText = getStageLabel(stage, 4)
      statusColor = 'text-[var(--color-parchment)] opacity-60'
      progressValue = getGrowthProgress(patch)
    }
  }

  const typeLabel = patchViewTypeLabels[type]

  return (
    <button
      onClick={onClick}
      class="w-full p-3 rounded-xl border transition-colors text-left bg-[#1a1a1a] border-[#2a2a2a] active:bg-[#222]"
    >
      <div class="flex items-center justify-between">
        <div class="flex-1">
          <div class="text-sm font-semibold text-[var(--color-parchment)] capitalize">
            {crop ? `${crop.icon} ${crop.name}` : typeLabel}
          </div>
          <div class={`text-[10px] mt-0.5 ${statusColor}`}>{statusText}</div>
        </div>
      </div>
      {patch && crop && (
        <div class="mt-2">
          <ProgressBar value={progressValue} max={100} height="h-2" color="var(--color-gold)" />
        </div>
      )}
    </button>
  )
}

function PatchDetails({ patch, onHarvest }) {
  const crop = getCropDef(patch.cropId)
  if (!crop) return null

  const now = Date.now()
  const timeRemaining = Math.max(0, patch.readyAt - now)
  const minutes = Math.floor(timeRemaining / 60000)
  const seconds = Math.floor((timeRemaining % 60000) / 1000)
  const stage = getEffectiveStage(patch)
  const ready = stage >= 4

  return (
    <div class="space-y-3">
      <div class="bg-[#111] rounded-lg p-3 space-y-1.5">
        <div class="flex justify-between text-sm">
          <span class="text-[var(--color-parchment)] opacity-60">Crop</span>
          <span class="font-semibold text-[var(--color-gold)]">{crop.icon} {crop.name}</span>
        </div>
        <div class="flex justify-between text-sm">
          <span class="text-[var(--color-parchment)] opacity-60">Stage</span>
          <span class="font-[var(--font-mono)] text-[var(--color-gold)]">{stage}/4</span>
        </div>
        <div class="flex justify-between text-sm">
          <span class="text-[var(--color-parchment)] opacity-60">Plant XP</span>
          <span class="font-[var(--font-mono)] text-[var(--color-gold)]">{crop.plantXp}</span>
        </div>
        <div class="flex justify-between text-sm">
          <span class="text-[var(--color-parchment)] opacity-60">Harvest XP</span>
          <span class="font-[var(--font-mono)] text-[var(--color-gold)]">{crop.harvestXp}</span>
        </div>
      </div>

      {!ready ? (
        <div class="bg-[#111] rounded-lg p-3 space-y-2">
          <div class="flex justify-between text-sm">
            <span class="text-[var(--color-parchment)] opacity-60">Time remaining</span>
            <span class="font-[var(--font-mono)] text-[var(--color-gold)]">{minutes}m {seconds}s</span>
          </div>
          <ProgressBar value={getGrowthProgress(patch)} max={100} height="h-2" color="var(--color-gold)" />
        </div>
      ) : (
        <button
          onClick={onHarvest}
          class="w-full py-2.5 rounded-lg bg-[var(--color-gold)] text-[#111] font-semibold text-sm active:opacity-80"
        >
          🌾 Harvest
        </button>
      )}
    </div>
  )
}
