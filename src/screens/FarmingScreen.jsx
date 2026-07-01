import { useState } from 'preact/hooks'
import { useGame } from '../state/gameState.jsx'
import { getLevelFromXP } from '../engine/experience.js'
import Modal from '../components/Modal.jsx'
import GameIcon from '../components/GameIcon.jsx'
import LootResultModal from '../components/LootResultModal.jsx'
import FarmLocationPicker from '../screens/FarmLocationPicker.jsx'
import FarmPatchView from '../screens/FarmPatchView.jsx'
import farmingData from '../data/farming.json'
import { getItemUnitValue } from '../utils/itemValue.js'
import { applyPlantAll, getCropDef, getPatchesForLocation, getPlantableCropOptions, harvestCrop, getEffectiveStage, initFarmingState } from '../engine/farming.ts'

export default function FarmingScreen({ onBack }) {
  const { stats, farming, inventory, bank, updateFarming, grantXP, addToBank, updateBankDirect, removeFromInventory, addToast, itemsData } = useGame()
  const farmingLevel = getLevelFromXP(stats.farming?.xp || 0)

  const [selectedLocation, setSelectedLocation] = useState(null)
  const [resultModal, setResultModal] = useState(null)
  const [plantAllOpen, setPlantAllOpen] = useState(false)
  const [plantSelections, setPlantSelections] = useState(() => farming?.plantAllSelections || {})

  const safeFarming = farming?.patchesById ? farming : initFarmingState()
  const allPatches = farmingData.locations.flatMap(location => getPatchesForLocation(safeFarming, location.id))

  const handleHarvestAll = () => {
    let nextState = safeFarming
    let totalXp = 0
    const items = {}
    let harvestedCount = 0
    for (const patchData of allPatches) {
      if (!patchData.patch?.cropId || getEffectiveStage(patchData.patch) < 4) continue
      const result = harvestCrop(nextState, patchData.patchId, farmingLevel)
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

    const { state: nextState, totalXp, planted, consumed, inventoryUsage, bankUsage } = applyPlantAll(
      safeFarming,
      farmingData.locations.flatMap(location => getPatchesForLocation(safeFarming, location.id)),
      plantSelections,
      inventory,
      bank,
    )

    if (Object.keys(planted).length === 0) {
      addToast('No empty patches or not enough selected seeds', 'error')
      return
    }

    updateFarming({ ...safeFarming, ...nextState, plantAllSelections: plantSelections })
    const inventorySlots = Array.isArray(inventory) ? inventory : []
    for (const [seedId, qty] of Object.entries(inventoryUsage)) {
      let remaining = qty
      for (let i = 0; i < inventorySlots.length && remaining > 0; i++) {
        const slot = inventorySlots[i]
        if (!slot || slot.itemId !== seedId) continue
        const removeQty = Math.min(slot.quantity || 0, remaining)
        if (removeQty > 0) {
          removeFromInventory(i, removeQty)
          remaining -= removeQty
        }
      }
    }
    for (const [seedId, qty] of Object.entries(bankUsage)) updateBankDirect({ [seedId]: -qty })
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
        farmingXp={stats.farming?.xp || 0}
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
            <div class="bg-[var(--color-void)] rounded-lg p-2" key={type}>
              <div class="text-xs font-semibold text-[var(--color-gold)] capitalize mb-2">{type === 'fruitTree' ? 'Fruit Trees' : `${type}s`}</div>
              <div class="space-y-1">
                {cropGroups[type].filter(x => x.ownedQuantity > 0).map(({ crop }) => {
                  const selected = plantSelections[type] === crop.id
                  return (
                    <button key={crop.id} onClick={() => setPlantSelections(prev => ({ ...prev, [type]: selected ? null : crop.id }))} class={`w-full p-2 rounded border text-left flex items-center justify-between ${selected ? 'border-[var(--color-gold)] bg-[var(--fm-parch-hi)]' : 'border-[var(--color-void-border)] bg-[var(--color-void-light)]'}`}>
                      <span class="text-xs text-[var(--color-parchment)] flex items-center gap-2"><GameIcon item={itemsData[crop.id] || crop} size={20} /> {crop.name}</span>
                      <span class={`text-sm ${selected ? 'text-[var(--color-gold)]' : 'text-[var(--color-parchment)] opacity-30'}`}>{selected ? '✓' : '○'}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
          <div class="flex gap-2">
            <button onClick={() => setPlantAllOpen(false)} class="flex-1 py-2 rounded-lg bg-[var(--color-void-light)] text-[var(--color-parchment)] text-sm">Cancel</button>
            <button disabled={!Object.values(plantSelections).some(Boolean)} onClick={confirmPlantAll} class="flex-1 py-2 rounded-lg bg-[var(--color-gold)] text-[#111] text-sm font-semibold disabled:opacity-50">Plant</button>
          </div>
        </div>
      </Modal>
      )}
      {resultModal && (() => {
        const isHarvest = resultModal.action === 'Harvested'
        const lootRows = Object.entries(resultModal.items).map(([itemId, qty]) => {
          const item = itemsData[itemId] || getCropDef(itemId) || null
          const unitVal = getItemUnitValue(itemId, itemsData) || 0
          return { key: itemId, item, name: item?.name || itemId, quantity: qty, gp: unitVal * qty, unitGp: unitVal }
        })
        const lootTotal = lootRows.reduce((s, r) => s + (r.gp || 0), 0)
        const summaryRows = []
        if (resultModal.xp > 0) {
          summaryRows.push({ emoji: undefined, name: 'Farming', value: `+${Math.floor(resultModal.xp).toLocaleString()}`, xp: true })
        }
        return (
          <LootResultModal
            theme="gold"
            kind="progress"
            icon={isHarvest ? '🌾' : '🌱'}
            eyebrow={isHarvest ? 'Harvest Complete' : 'Planting Complete'}
            title={isHarvest ? 'Crops Gathered' : 'Seeds Planted'}
            loot={lootRows.length > 0 ? lootRows : null}
            lootTitle={isHarvest ? 'Harvested' : 'Planted'}
            lootTotal={isHarvest ? lootTotal : undefined}
            summaryRows={summaryRows.length > 0 ? summaryRows : null}
            primaryAction={{ label: 'Continue', onClick: () => setResultModal(null) }}
            onClose={() => setResultModal(null)}
          />
        )
      })()}
    </>
  )
}
