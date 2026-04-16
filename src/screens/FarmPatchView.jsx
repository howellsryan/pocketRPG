import { useState, useEffect, useRef } from 'preact/hooks'
import { useGame } from '../state/gameState.jsx'
import { getPatchesForLocation, getAvailableCrops, getCropDef, formatGrowthTime, getGrowthProgress, getStageLabel } from '../engine/farming.ts'
import { onTick } from '../engine/tick.js'
import ProgressBar from '../components/ProgressBar.jsx'
import Modal from '../components/Modal.jsx'
import farmingData from '../data/farming.json'

export default function FarmPatchView({ locationId, farmingLevel, onBack }) {
  const { stats, inventory, farming, updateFarming, grantXP, removeFromInventory, addToBank, addToast } = useGame()

  const location = farmingData.locations.find(l => l.id === locationId)
  const [patchStates, setPatchStates] = useState([])
  const [selectedPatch, setSelectedPatch] = useState(null)
  const [showPlantModal, setShowPlantModal] = useState(false)
  const patchesRef = useRef(patchStates)

  useEffect(() => {
    if (farming) {
      const patches = getPatchesForLocation(farming, locationId)
      setPatchStates(patches)
    }
  }, [farming, locationId])

  useEffect(() => {
    patchesRef.current = patchStates
  }, [patchStates])

  // Tick listener for growth
  useEffect(() => {
    const unsub = onTick(() => {
      setPatchStates(current => {
        const patches = getPatchesForLocation(farming, locationId)
        return patches
      })
    })
    return unsub
  }, [farming, locationId])

  const handlePlantCrop = (seedId) => {
    const crop = getCropDef(seedId)
    if (!crop) return

    // Check level
    if (farmingLevel < crop.level) {
      addToast(`Need ${crop.level} Farming`, 'error')
      return
    }

    // Check inventory for seed
    const seedSlot = inventory.findIndex(s => s && s.itemId === seedId)
    if (seedSlot < 0) {
      addToast(`Need ${crop.name} seed`, 'error')
      return
    }

    // Plant
    const result = plantCrop(farming, selectedPatch.patchId, seedId)
    if (!result) {
      addToast('Failed to plant', 'error')
      return
    }

    updateFarming(result.state)
    removeFromInventory(seedSlot, 1)
    grantXP('farming', result.plantXp)
    addToast(`Planted ${result.cropName}`, 'success')
    setShowPlantModal(false)
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

  return (
    <div className="flex flex-col h-full">
      <div className="bg-gradient-to-r from-green-700 to-green-600 text-white p-4 flex items-center gap-2">
        <button onClick={onBack} className="text-xl">←</button>
        <h1 className="text-xl font-bold flex-1">{location?.name}</h1>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {patchStates.map((patchData, idx) => (
          <PatchCard
            key={patchData.patchId}
            patchData={patchData}
            onClick={() => {
              setSelectedPatch(patchData)
              if (!patchData.patch?.cropId) {
                setShowPlantModal(true)
              }
            }}
            farmingLevel={farmingLevel}
          />
        ))}
      </div>

      {selectedPatch && (
        <Modal onClose={() => setSelectedPatch(null)}>
          <div className="bg-white rounded-lg p-6 space-y-4">
            <h2 className="text-xl font-bold">
              {selectedPatch.type.replace(/([A-Z])/g, ' $1').trim()} Patch
            </h2>

            {!selectedPatch.patch?.cropId ? (
              <>
                <p className="text-gray-700">Select a crop to plant:</p>
                <div className="max-h-64 overflow-y-auto space-y-2">
                  {getAvailableCrops(selectedPatch.type, farmingLevel).map(crop => (
                    <button
                      key={crop.id}
                      onClick={() => handlePlantCrop(crop.id)}
                      className="w-full bg-green-50 hover:bg-green-100 border border-green-300 rounded p-3 text-left transition"
                    >
                      <div className="font-bold text-green-900">{crop.icon} {crop.name}</div>
                      <div className="text-sm text-green-700">
                        {crop.plantXp} xp to plant, {crop.harvestXp} xp to harvest
                      </div>
                      <div className="text-xs text-gray-500">
                        Growth: {formatGrowthTime(crop.growthTimeMs)}
                      </div>
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <PatchDetails
                patch={selectedPatch.patch}
                onHarvest={handleHarvest}
              />
            )}

            <button
              onClick={() => setSelectedPatch(null)}
              className="w-full bg-gray-300 hover:bg-gray-400 text-gray-900 font-bold py-2 rounded transition"
            >
              Close
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}

function PatchCard({ patchData, onClick, farmingLevel }) {
  const { patch, type } = patchData
  const crop = patch?.cropId ? getCropDef(patch.cropId) : null

  let statusText = 'Empty'
  let statusColor = 'text-gray-500'
  let progressValue = 0

  if (patch && crop) {
    if (patch.stage >= 4) {
      statusText = 'Ready to harvest'
      statusColor = 'text-green-600'
      progressValue = 100
    } else {
      statusText = getStageLabel(patch.stage, 4)
      statusColor = 'text-blue-600'
      progressValue = getGrowthProgress(patch)
    }
  }

  return (
    <button
      onClick={onClick}
      className="w-full bg-gray-50 hover:bg-gray-100 border border-gray-300 rounded p-3 text-left transition"
    >
      <div className="flex items-center justify-between">
        <div>
          <div className="font-bold text-gray-900">
            {crop?.icon} {crop?.name || type.replace(/([A-Z])/g, ' $1').trim()}
          </div>
          <div className={`text-sm font-bold ${statusColor}`}>{statusText}</div>
        </div>
      </div>
      {patch && crop && (
        <ProgressBar value={progressValue} className="mt-2" />
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

  return (
    <>
      <div className="bg-blue-50 border border-blue-200 rounded p-4 space-y-2">
        <div className="font-bold text-blue-900">
          {crop.icon} {crop.name}
        </div>
        <div className="text-sm text-blue-700">
          <p>Planted XP: {crop.plantXp}</p>
          <p>Harvest XP: {crop.harvestXp}</p>
        </div>
        <div className="text-sm font-bold text-blue-900">
          Stage: {patch.stage}/4
        </div>
      </div>

      {patch.stage < 4 ? (
        <div className="bg-yellow-50 border border-yellow-200 rounded p-3">
          <div className="text-sm text-yellow-900">
            Time remaining: {minutes}m {seconds}s
          </div>
          <ProgressBar value={getGrowthProgress(patch)} className="mt-2" />
        </div>
      ) : (
        <button
          onClick={onHarvest}
          className="w-full bg-green-500 hover:bg-green-600 text-white font-bold py-3 rounded transition"
        >
          🌾 Harvest
        </button>
      )}
    </>
  )
}

// Import functions from engine — these will be called on successful action
import { plantCrop, harvestCrop } from '../engine/farming.ts'
