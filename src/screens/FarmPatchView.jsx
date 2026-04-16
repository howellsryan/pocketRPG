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
      <div style={{ background: 'var(--color-emerald-mid)', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '12px' }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', color: 'var(--color-gold)', fontSize: '20px', cursor: 'pointer' }}>←</button>
        <h1 style={{ fontSize: '18px', fontWeight: 'bold', flex: 1, color: 'var(--color-gold)' }}>{location?.name}</h1>
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
          <div style={{ background: 'var(--color-void-lighter)', borderRadius: '8px', padding: '20px', gap: '16px', display: 'flex', flexDirection: 'column' }}>
            <h2 style={{ fontSize: '18px', fontWeight: 'bold', color: 'var(--color-gold-light)' }}>
              {selectedPatch.type.replace(/([A-Z])/g, ' $1').trim()} Patch
            </h2>

            {!selectedPatch.patch?.cropId ? (
              <>
                <p style={{ color: 'var(--color-parchment)', opacity: 0.8 }}>Select a crop to plant:</p>
                <div style={{ maxHeight: '256px', overflowY: 'auto', gap: '8px', display: 'flex', flexDirection: 'column' }}>
                  {getAvailableCrops(selectedPatch.type, farmingLevel).map(crop => (
                    <button
                      key={crop.id}
                      onClick={() => handlePlantCrop(crop.id)}
                      style={{
                        width: '100%',
                        background: 'var(--color-void)',
                        border: '1px solid var(--color-void-border)',
                        borderRadius: '6px',
                        padding: '10px',
                        textAlign: 'left',
                        cursor: 'pointer',
                        transition: 'all 0.2s',
                        color: 'var(--color-parchment)',
                      }}
                      onMouseEnter={e => {
                        e.currentTarget.style.borderColor = 'var(--color-emerald-light)';
                        e.currentTarget.style.background = 'var(--color-void-lighter)';
                      }}
                      onMouseLeave={e => {
                        e.currentTarget.style.borderColor = 'var(--color-void-border)';
                        e.currentTarget.style.background = 'var(--color-void)';
                      }}
                    >
                      <div style={{ fontWeight: '600', color: 'var(--color-gold-light)' }}>{crop.icon} {crop.name}</div>
                      <div style={{ fontSize: '12px', color: 'var(--color-parchment)', opacity: 0.7, marginTop: '4px' }}>
                        {crop.plantXp} xp to plant, {crop.harvestXp} xp to harvest
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--color-parchment)', opacity: 0.5, marginTop: '2px' }}>
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
              style={{
                width: '100%',
                background: 'var(--color-void)',
                border: '1px solid var(--color-void-border)',
                color: 'var(--color-parchment)',
                fontWeight: '600',
                padding: '10px',
                borderRadius: '6px',
                cursor: 'pointer',
                transition: 'all 0.2s',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.borderColor = 'var(--color-parchment)';
                e.currentTarget.style.opacity = '0.8';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.borderColor = 'var(--color-void-border)';
                e.currentTarget.style.opacity = '1';
              }}
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
      style={{
        width: '100%',
        background: 'var(--color-void-lighter)',
        border: '1px solid var(--color-void-border)',
        borderRadius: '8px',
        padding: '12px',
        textAlign: 'left',
        cursor: 'pointer',
        transition: 'all 0.2s',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.borderColor = 'var(--color-emerald-light)';
        e.currentTarget.style.background = 'var(--color-void-lighter)';
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor = 'var(--color-void-border)';
        e.currentTarget.style.background = 'var(--color-void-lighter)';
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontWeight: '600', color: 'var(--color-gold-light)' }}>
            {crop?.icon} {crop?.name || type.replace(/([A-Z])/g, ' $1').trim()}
          </div>
          <div style={{ fontSize: '13px', fontWeight: '600', color: statusColor === 'text-green-600' ? 'var(--color-emerald-light)' : statusColor === 'text-blue-600' ? 'var(--color-mana-light)' : 'var(--color-parchment)' }}>{statusText}</div>
        </div>
      </div>
      {patch && crop && (
        <div style={{ marginTop: '8px' }}>
          <ProgressBar value={progressValue} />
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

  return (
    <>
      <div style={{ background: 'var(--color-void)', border: '1px solid var(--color-mana)', borderRadius: '6px', padding: '12px', gap: '8px', display: 'flex', flexDirection: 'column' }}>
        <div style={{ fontWeight: '600', color: 'var(--color-mana-light)' }}>
          {crop.icon} {crop.name}
        </div>
        <div style={{ fontSize: '13px', color: 'var(--color-parchment)', opacity: 0.8 }}>
          <p>Planted XP: {crop.plantXp}</p>
          <p>Harvest XP: {crop.harvestXp}</p>
        </div>
        <div style={{ fontSize: '13px', fontWeight: '600', color: 'var(--color-mana-light)' }}>
          Stage: {patch.stage}/4
        </div>
      </div>

      {patch.stage < 4 ? (
        <div style={{ background: 'var(--color-void)', border: '1px solid var(--color-gold-dim)', borderRadius: '6px', padding: '10px', gap: '8px', display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: '13px', color: 'var(--color-gold-light)' }}>
            Time remaining: {minutes}m {seconds}s
          </div>
          <ProgressBar value={getGrowthProgress(patch)} />
        </div>
      ) : (
        <button
          onClick={onHarvest}
          style={{
            width: '100%',
            background: 'var(--color-emerald-mid)',
            border: '1px solid var(--color-emerald-light)',
            color: 'var(--color-gold-light)',
            fontWeight: '600',
            padding: '12px',
            borderRadius: '6px',
            cursor: 'pointer',
            transition: 'all 0.2s',
            fontSize: '14px',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.background = 'var(--color-emerald-light)';
            e.currentTarget.style.color = 'var(--color-void)';
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = 'var(--color-emerald-mid)';
            e.currentTarget.style.color = 'var(--color-gold-light)';
          }}
        >
          🌾 Harvest
        </button>
      )}
    </>
  )
}

// Import functions from engine — these will be called on successful action
import { plantCrop, harvestCrop } from '../engine/farming.ts'
