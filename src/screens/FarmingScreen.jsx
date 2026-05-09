import { useState } from 'preact/hooks'
import { useGame } from '../state/gameState.jsx'
import { getLevelFromXP } from '../engine/experience.js'
import Modal from '../components/Modal.jsx'
import FarmLocationPicker from '../screens/FarmLocationPicker.jsx'
import FarmPatchView from '../screens/FarmPatchView.jsx'
import farmingData from '../data/farming.json'
import { getCropDef, getPatchesForLocation, getPlantableCropOptions, harvestCrop, plantCrop, getEffectiveStage } from '../engine/farming.ts'

export default function FarmingScreen({ onBack }) {
  const { stats, farming, inventory, bank, updateFarming, grantXP, addToBank, updateBankDirect, removeFromInventory, addToast } = useGame()
  const farmingLevel = getLevelFromXP(stats.farming?.xp || 0)

  const [selectedLocation, setSelectedLocation] = useState(null)
  const [resultModal, setResultModal] = useState(null)
  const [plantAllOpen, setPlantAllOpen] = useState(false)
  const [plantSelections, setPlantSelections] = useState(() => farming?.plantAllSelections || {})

  const allPatches = farmingData.locations.flatMap(location => getPatchesForLocation(farming, location.id))

  const handleHarvestAll = () => {
    let nextState = farming
    let totalXp = 0
    const items = {}
    let harvestedCount = 0
    for (const patchData of allPatches) {
      if (!patchData.patch?.cropId || getEffectiveStage(patchData.patch) < 4) continue
      const result = harvestCrop(nextState, patchData.patchId)
      if (!result) continue
      nextState = result.state
      totalXp += result.harvestXp
      items[result.cropId] = (items[result.cropId] || 0) + result.quantity
      harvestedCount++
    }
    if (harvestedCount <= 0) {
      addToast('No crops ready to harvest', 'error')
      return
    }
    updateFarming(nextState)
    if (totalXp > 0) grantXP('farming', totalXp)
    for (const [itemId, qty] of Object.entries(items)) addToBank(itemId, qty)
    setResultModal({ title: 'Harvest All Complete', xp: totalXp, items, action: 'Harvested' })
  }

  const cropGroups = {
    herb: getPlantableCropOptions('herb', farmingLevel, inventory, bank),
    tree: getPlantableCropOptions('tree', farmingLevel, inventory, bank),
    fruitTree: getPlantableCropOptions('fruitTree', farmingLevel, inventory, bank),
  }

  const openPlantAllModal = () => {
    setPlantSelections(farming?.plantAllSelections || {})
    setPlantAllOpen(true)
  }

  const confirmPlantAll = () => {
    const selectedTypes = Object.entries(plantSelections).filter(([, v]) => !!v).map(([k]) => k)
    if (selectedTypes.length === 0) return

    let nextState = farming
    let totalXp = 0
    const planted = {}
    const consumed = {}
    const inventoryUsage = {}
    const bankUsage = {}
    for (const patchData of allPatches) {
      if (patchData.patch?.cropId) continue
      const seedId = plantSelections[patchData.type]
      if (!seedId) continue
      const availableInv = (inventory.find(s => s && s.itemId === seedId)?.quantity || 0) - (inventoryUsage[seedId] || 0)
      const availableBank = (bank?.[seedId]?.quantity || 0) - (bankUsage[seedId] || 0)
      if ((availableInv + availableBank) <= 0) continue
      const result = plantCrop(nextState, patchData.patchId, seedId, patchData.type)
      if (!result) continue
      nextState = result.state
      totalXp += result.plantXp
      planted[seedId] = (planted[seedId] || 0) + 1
      consumed[seedId] = (consumed[seedId] || 0) + 1
      if (availableInv > 0) inventoryUsage[seedId] = (inventoryUsage[seedId] || 0) + 1
      else bankUsage[seedId] = (bankUsage[seedId] || 0) + 1
    }

    if (Object.keys(planted).length === 0) {
      addToast('No empty patches or not enough selected seeds', 'error')
      return
    }
    for (const [seedId, qty] of Object.entries(inventoryUsage)) {
      let remaining = qty
      for (let i = 0; i < inventory.length && remaining > 0; i++) {
        const slot = inventory[i]
        if (!slot || slot.itemId !== seedId) continue
        const removeQty = Math.min(slot.quantity || 0, remaining)
        if (removeQty > 0) {
          removeFromInventory(i, removeQty)
          remaining -= removeQty
        }
      }
    }
    for (const [seedId, qty] of Object.entries(bankUsage)) updateBankDirect({ [seedId]: -qty })
    updateFarming({ ...nextState, plantAllSelections })
    if (totalXp > 0) grantXP('farming', totalXp)
    setPlantAllOpen(false)
    addToast('Planted all selected crops', 'success')
    setResultModal({ title: 'Plant All Complete', xp: totalXp, items: consumed, action: 'Planted' })
  }

  if (selectedLocation) {
    return (
      <FarmPatchView
        locationId={selectedLocation}
        farmingLevel={farmingLevel}
        onBack={() => setSelectedLocation(null)}
      />
    )
  }

  return (
    <>
      <FarmLocationPicker
        farmingLevel={farmingLevel}
        farming={farming}
        onSelectLocation={setSelectedLocation}
        onBack={onBack}
        onHarvestAll={handleHarvestAll}
        onPlantAll={openPlantAllModal}
      />
      {plantAllOpen && (
      <Modal title="Plant All" onClose={() => setPlantAllOpen(false)}>
        <div class="space-y-3">
          {['herb', 'tree', 'fruitTree'].map(type => (
            <div class="bg-[#111] rounded-lg p-2" key={type}>
              <div class="text-xs font-semibold text-[var(--color-gold)] capitalize mb-2">{type === 'fruitTree' ? 'Fruit Trees' : `${type}s`}</div>
              <div class="space-y-1">
                {cropGroups[type].filter(x => x.ownedQuantity > 0).map(({ crop }) => {
                  const selected = plantSelections[type] === crop.id
                  return (
                    <button key={crop.id} onClick={() => setPlantSelections(prev => ({ ...prev, [type]: selected ? null : crop.id }))} class={`w-full p-2 rounded border text-left flex items-center justify-between ${selected ? 'border-[var(--color-gold)] bg-[#201a08]' : 'border-[#2a2a2a] bg-[#1a1a1a]'}`}>
                      <span class="text-xs text-[var(--color-parchment)]">{crop.icon} {crop.name}</span>
                      <span class={`text-sm ${selected ? 'text-[var(--color-gold)]' : 'text-[var(--color-parchment)] opacity-30'}`}>{selected ? '✓' : '○'}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
          <div class="flex gap-2">
            <button onClick={() => setPlantAllOpen(false)} class="flex-1 py-2 rounded-lg bg-[#2a2a2a] text-[var(--color-parchment)] text-sm">Cancel</button>
            <button disabled={!Object.values(plantSelections).some(Boolean)} onClick={confirmPlantAll} class="flex-1 py-2 rounded-lg bg-[var(--color-gold)] text-[#111] text-sm font-semibold disabled:opacity-50">Plant</button>
          </div>
        </div>
      </Modal>
      )}
      {resultModal && (
        <Modal title={resultModal.title} onClose={() => setResultModal(null)}>
          <div class="text-xs text-[var(--color-parchment)] space-y-2">
            <div>Farming XP gained: <span class="text-[var(--color-gold)] font-semibold">{Math.floor(resultModal.xp)}</span></div>
            {Object.entries(resultModal.items).map(([itemId, qty]) => {
              const item = getCropDef(itemId)
              return <div key={itemId}>{resultModal.action} {item?.icon || ''} {item?.name || itemId} ×{qty}</div>
            })}
          </div>
        </Modal>
      )}
    </>
  )
}
