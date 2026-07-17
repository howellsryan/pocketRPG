import { useState, useMemo } from 'preact/hooks'
import { useGame } from '../state/gameState.jsx'
import Model3DViewer from '../components/Model3DViewer.jsx'
import { getCharacterAssetPath, getCharacterModel, getWeaponPlacement, getGearPlacements } from '../utils/equipModels.js'
import { canRender3D } from '../utils/three3d.js'
import { unequipSlot, getEquipmentBonuses, checkEquipRequirements, equipItem, placeUnequippedItems } from '../engine/equipment.js'
import { createPreset, applyPreset, renamePreset, MAX_EQUIPMENT_PRESETS } from '../engine/equipmentPresets.js'
import Modal from '../components/Modal.jsx'
import { hasFullVoidKingSet } from '../engine/combatSetBonuses.js'
import { EQUIPMENT_SLOTS } from '../utils/constants.js'
import SharedItemModal from '../components/SharedItemModal.jsx'
import Card from '../components/Card.jsx'
import Panel from '../components/Panel.jsx'
import Button from '../components/Button.jsx'
import SectionHeader from '../components/SectionHeader.jsx'
import EquipmentPaperdoll, { EQ_SLOT_NAMES } from '../components/EquipmentPaperdoll.jsx'
import InventoryGrid from '../components/InventoryGrid.jsx'
import WeaponChargePanel, { getChargeRecipe } from '../components/WeaponChargePanel.jsx'
import { OTHER_BONUS_LABELS, OTHER_BONUS_PERCENT_KEYS } from '../utils/bonusLabels.js'
import { formatSpecialEnergyCostLabel } from '../engine/specialAttackEnergy.js'

export default function EquipmentScreen() {
  const { equipment, inventory, bank, stats, updateEquipment, updateInventory, updateBank, addToast, itemsData, completedQuests, equipmentPresets, updateEquipmentPresets, combatStatus } = useGame()
  // Loadout presets reshuffle equipment/inventory/bank wholesale — disabled while
  // a fight ticks in the background so gear can't swap out from under it.
  const presetsLocked = !!combatStatus?.active
  const [selected, setSelected] = useState(null) // { slot, item }
  const [showSpecInfo, setShowSpecInfo] = useState(false)
  const [invSelected, setInvSelected] = useState(null) // { slotIndex, slot, item }
  const [createOpen, setCreateOpen] = useState(false)
  const [createName, setCreateName] = useState('')
  const [managePreset, setManagePreset] = useState(null) // preset being renamed/deleted
  const [manageName, setManageName] = useState('')

  const presets = Array.isArray(equipmentPresets) ? equipmentPresets : []
  const nameOf = (id) => itemsData[id]?.name || id

  // 3D hero preview (replaces the paper doll as the centerpiece when supported).
  // The slot grid is still rendered beneath it for equip/unequip; when WebGL is
  // unavailable we fall back to the paper doll alone — zero regression.
  const heroPath = getCharacterAssetPath()
  const [heroFailed, setHeroFailed] = useState(false)
  const show3D = useMemo(() => Boolean(heroPath) && !heroFailed && canRender3D(), [heroPath, heroFailed])
  const weaponSpec = useMemo(() => {
    const wid = equipment?.weapon?.itemId
    return wid ? getWeaponPlacement(wid) : null
  }, [equipment?.weapon?.itemId])
  const gearSpecs = useMemo(() => getGearPlacements(equipment), [equipment])

  const handleCreatePreset = () => {
    if (presetsLocked) { addToast('⚔️ Finish your fight to manage presets.', 'warning'); return }
    if (presets.length >= MAX_EQUIPMENT_PRESETS) {
      addToast(`Preset limit reached (${MAX_EQUIPMENT_PRESETS})`, 'error')
      return
    }
    const preset = createPreset(createName.trim() || `Preset ${presets.length + 1}`, equipment, inventory)
    updateEquipmentPresets([...presets, preset])
    setCreateOpen(false)
    setCreateName('')
    addToast(`Saved preset “${preset.name}”`, 'success')
  }

  // Load a preset: re-arrange owned items across equipment/inventory/bank, then
  // report anything the player lacks (missing / requirement-locked / partial
  // stacks) in a single toast so empty slots are explained.
  const handleLoadPreset = (preset) => {
    if (presetsLocked) { addToast('⚔️ Finish your fight to swap loadouts.', 'warning'); return }
    const result = applyPreset(preset, { equipment, inventory, bank }, itemsData, stats, completedQuests)
    updateEquipment(result.equipment)
    updateInventory(result.inventory)
    updateBank(result.bank)

    const problems = []
    if (result.reqFailed.length) {
      problems.push(`couldn’t equip ${result.reqFailed.map(r => nameOf(r.itemId)).join(', ')} (requirement not met)`)
    }
    if (result.missing.length) {
      problems.push(`missing ${result.missing.map(m => `${m.quantity > 1 ? `${m.quantity}× ` : ''}${nameOf(m.itemId)}`).join(', ')}`)
    }
    if (result.partial.length) {
      problems.push(`partial ${result.partial.map(p => `${nameOf(p.itemId)} (${p.got}/${p.wanted})`).join(', ')}`)
    }

    if (problems.length) addToast(`Loaded “${preset.name}” — ${problems.join('; ')}`, 'error')
    else addToast(`Loaded “${preset.name}”`, 'success')
  }

  const handleRenamePreset = () => {
    if (!managePreset) return
    updateEquipmentPresets(presets.map(p => (p.id === managePreset.id ? renamePreset(p, manageName) : p)))
    setManagePreset(null)
  }

  const handleDeletePreset = () => {
    if (!managePreset) return
    updateEquipmentPresets(presets.filter(p => p.id !== managePreset.id))
    setManagePreset(null)
  }

  const handleSelect = (slotName, item) => {
    setSelected({ slot: slotName, item })
    setShowSpecInfo(false)
  }

  const handleInvSlotClick = (slot, item, index) => {
    setInvSelected({ slotIndex: index, slot, item })
  }

  const handleEquipFromInv = () => {
    if (!invSelected) return
    const { slotIndex, item } = invSelected

    const reqError = checkEquipRequirements(item, stats, completedQuests)
    if (reqError) {
      if (reqError.reason === 'quest') {
        addToast(`Complete quest to equip: ${reqError.questUnlock.replace(/_/g, ' ')}`, 'error')
      } else {
        addToast(`Need ${reqError.skill} level ${reqError.required} to equip`, 'error')
      }
      setInvSelected(null)
      return
    }

    const newEquip = { ...equipment }
    const newInv = [...inventory]
    const sourceSlot = newInv[slotIndex]
    newInv[slotIndex] = null

    const result = equipItem(newEquip, item, itemsData, sourceSlot)
    if (result.equipped) {
      const placed = placeUnequippedItems(result.unequipped, newInv, itemsData)
      if (!placed.ok) {
        addToast('Inventory full', 'error')
        setInvSelected(null)
        return
      }
      updateEquipment(newEquip)
      updateInventory(placed.inventory)
      addToast(`Equipped ${item.name}`, 'info')
    }
    setInvSelected(null)
  }

  const handleUnequip = () => {
    if (!selected) return
    const newEq = { ...equipment }
    const removed = newEq[selected.slot]
    if (!removed) {
      setSelected(null)
      return
    }

    const newInv = [...inventory]
    const empty = newInv.indexOf(null)
    if (empty === -1) {
      addToast('Inventory full', 'error')
      setSelected(null)
      return
    }

    // Preserve charges on unequip so we can re-equip without losing them
    // For ammo, restore the original quantity that was stored when equipped
    const invEntry = { itemId: removed.itemId, quantity: removed.quantity || 1 }
    if (removed.charges && removed.charges > 0) invEntry.charges = removed.charges
    newEq[selected.slot] = null
    newInv[empty] = invEntry
    updateEquipment(newEq)
    updateInventory(newInv)
    setSelected(null)
  }

  const availableForId = (id) => inventory.reduce((sum, s) => sum + (s && s.itemId === id ? s.quantity : 0), 0)

  const handleChargeWeapon = (qty) => {
    if (!selected) return
    const equipSlotName = selected.slot
    const weaponEntry = equipment[equipSlotName]
    if (!weaponEntry) return
    const item = itemsData[weaponEntry.itemId]
    if (!item?.scaleCharged) return

    const recipe = getChargeRecipe(item)
    const affordable = recipe.reduce((min, r) => Math.min(min, Math.floor(availableForId(r.itemId) / r.qty)), Infinity)
    const actualQty = Math.min(qty, affordable)
    if (actualQty <= 0) {
      const need = recipe.map(r => `${r.qty} ${itemsData[r.itemId]?.name || r.itemId}`).join(' + ')
      addToast(`Need ${need} per charge`, 'error')
      return
    }

    const newInv = [...inventory]
    for (const r of recipe) {
      let remaining = actualQty * r.qty
      for (let i = 0; i < newInv.length && remaining > 0; i++) {
        if (newInv[i]?.itemId === r.itemId) {
          const take = Math.min(newInv[i].quantity, remaining)
          newInv[i] = { ...newInv[i], quantity: newInv[i].quantity - take }
          if (newInv[i].quantity <= 0) newInv[i] = null
          remaining -= take
        }
      }
    }

    const newEq = { ...equipment }
    const currentCharges = weaponEntry.charges || 0
    newEq[equipSlotName] = { ...weaponEntry, charges: currentCharges + actualQty }

    updateInventory(newInv)
    updateEquipment(newEq)
    addToast(`Charged ${item.name} with ${actualQty} charge${actualQty === 1 ? '' : 's'}`, 'info')
  }

  const handleUnchargeWeapon = () => {
    if (!selected) return
    const equipSlotName = selected.slot
    const weaponEntry = equipment[equipSlotName]
    if (!weaponEntry) return
    const item = itemsData[weaponEntry.itemId]
    if (!item?.scaleCharged) return

    const charges = weaponEntry.charges || 0
    if (charges <= 0) return

    // Collect total charges from ALL instances of this item in inventory, equipped, and bank
    let totalCharges = 0

    // Count charges in inventory
    const newInv = [...inventory]
    for (let i = 0; i < newInv.length; i++) {
      if (newInv[i] && newInv[i].itemId === weaponEntry.itemId && newInv[i].charges > 0) {
        totalCharges += newInv[i].charges
      }
    }

    // Count charges in equipped slots
    const newEq = { ...equipment }
    for (const slotName of Object.keys(newEq)) {
      if (newEq[slotName] && newEq[slotName].itemId === weaponEntry.itemId && newEq[slotName].charges > 0) {
        totalCharges += newEq[slotName].charges
      }
    }

    // Count charges in bank
    const newBank = { ...bank }
    if (newBank[weaponEntry.itemId] && newBank[weaponEntry.itemId].charges > 0) {
      totalCharges += newBank[weaponEntry.itemId].charges
    }

    // Remove charges from all instances in inventory
    for (let i = 0; i < newInv.length; i++) {
      if (newInv[i] && newInv[i].itemId === weaponEntry.itemId && newInv[i].charges > 0) {
        newInv[i] = { ...newInv[i], charges: 0 }
      }
    }

    // Remove charges from all equipped instances
    for (const slotName of Object.keys(newEq)) {
      if (newEq[slotName] && newEq[slotName].itemId === weaponEntry.itemId && newEq[slotName].charges > 0) {
        newEq[slotName] = { ...newEq[slotName], charges: 0 }
      }
    }

    // Remove charges from bank
    if (newBank[weaponEntry.itemId] && newBank[weaponEntry.itemId].charges > 0) {
      newBank[weaponEntry.itemId] = { ...newBank[weaponEntry.itemId], charges: 0 }
    }

    // Recover every recipe ingredient, scaled by the total charges removed.
    const recipe = getChargeRecipe(item)
    const recovered = recipe.map(r => ({ itemId: r.itemId, qty: r.qty * totalCharges }))
    for (const rec of recovered) {
      const existingIdx = newInv.findIndex(s => s && s.itemId === rec.itemId)
      if (existingIdx !== -1) {
        newInv[existingIdx] = { ...newInv[existingIdx], quantity: newInv[existingIdx].quantity + rec.qty }
      } else {
        const empty = newInv.indexOf(null)
        if (empty === -1) {
          addToast('Inventory full — cannot uncharge', 'error')
          return
        }
        newInv[empty] = { itemId: rec.itemId, quantity: rec.qty }
      }
    }

    updateInventory(newInv)
    updateEquipment(newEq)
    updateBank(newBank)
    const recoveredText = recovered.map(r => `${r.qty} ${itemsData[r.itemId]?.name || r.itemId}`).join(', ')
    addToast(`Uncharged ${item.name}, recovered ${recoveredText}`, 'info')
  }

  const bonuses = getEquipmentBonuses(equipment, itemsData)

  return (
    <div class="forge-shell h-full overflow-y-auto p-4">
      <div class="flex items-center gap-2 mb-3">
        <SectionHeader>Equipment</SectionHeader>
      </div>

      {/* Loadout presets — save/load the full equipment + inventory state, the
          gear analogue of bank tabs. Loading re-arranges items the character
          already owns; anything missing is reported and its slot left empty. */}
      <div class="mb-3 flex items-center gap-1.5 flex-wrap">
        <span class="text-[10px] uppercase tracking-wider text-[var(--color-gold-dim)] opacity-60 mr-1">Presets</span>
        {presets.map(p => (
          <div key={p.id} class={`flex items-stretch rounded-md overflow-hidden ${presetsLocked ? 'opacity-40' : ''}`}>
            <button
              onClick={() => handleLoadPreset(p)}
              disabled={presetsLocked}
              title={presetsLocked ? 'Locked while fighting' : undefined}
              class="px-3 py-1.5 bg-[var(--color-void-light)] text-[var(--color-parchment)] text-xs font-bold max-w-[110px] truncate active:opacity-80"
            >
              {p.name}
            </button>
            <button
              onClick={() => { setManagePreset(p); setManageName(p.name) }}
              disabled={presetsLocked}
              class="px-2 py-1.5 bg-[var(--color-void-light)] text-[var(--color-parchment)] opacity-40 text-xs active:opacity-70"
              aria-label={`Edit preset ${p.name}`}
            >
              ✏️
            </button>
          </div>
        ))}
        {presets.length < MAX_EQUIPMENT_PRESETS && (
          <button
            onClick={() => { setCreateOpen(true); setCreateName('') }}
            disabled={presetsLocked}
            title={presetsLocked ? 'Locked while fighting' : undefined}
            class={`px-2.5 py-1.5 rounded-md bg-[var(--color-void-light)] text-[var(--color-parchment)] text-sm font-bold active:opacity-80 ${presetsLocked ? 'opacity-25' : 'opacity-50'}`}
            aria-label="Save current loadout as a preset"
          >
            +
          </button>
        )}
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
      <div class="w-full flex flex-col gap-3">
        {show3D ? (
          <>
            <Card padding="p-2" className="w-full">
              <Model3DViewer
                characterPath={heroPath}
                weapon={weaponSpec}
                gear={gearSpecs}
                idleClip={(weaponSpec && getCharacterModel()?.combatIdleClip) || getCharacterModel()?.idleClip || null}
                height={360}
                fallback={null}
                onFail={() => setHeroFailed(true)}
              />
            </Card>
            <EquipmentPaperdoll
              equipment={equipment}
              itemsData={itemsData}
              onSelect={handleSelect}
              size="sm"
              className="w-full"
            />
          </>
        ) : (
          <EquipmentPaperdoll
            equipment={equipment}
            itemsData={itemsData}
            onSelect={handleSelect}
            size="md"
            className="w-full"
          />
        )}
      </div>

      {/* Bonuses summary */}
      <Card className="w-full h-full">
        <SectionHeader size="sm" className="mb-2 opacity-50">Bonuses</SectionHeader>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-2 md:gap-4 text-[11px] md:text-[13px]">
          {/* Attack bonuses */}
          <div>
            <SectionHeader size="sm" className="mb-1 opacity-40">Attack</SectionHeader>
            {Object.entries(bonuses.attackBonus).map(([k, v]) => (
              <div key={k} class="flex justify-between text-[var(--color-parchment)] opacity-70 py-[1px]">
                <span class="capitalize">{k}</span>
                <span class="font-[var(--font-mono)]" style={{ color: v > 0 ? '#27ae60' : v < 0 ? '#c0392b' : '#555' }}>
                  {v > 0 ? '+' : ''}{v}
                </span>
              </div>
            ))}
          </div>

          {/* Defence bonuses */}
          <div>
            <SectionHeader size="sm" className="mb-1 opacity-40">Defence</SectionHeader>
            {Object.entries(bonuses.defenceBonus).map(([k, v]) => (
              <div key={k} class="flex justify-between text-[var(--color-parchment)] opacity-70 py-[1px]">
                <span class="capitalize">{k}</span>
                <span class="font-[var(--font-mono)]" style={{ color: v > 0 ? '#27ae60' : v < 0 ? '#c0392b' : '#555' }}>
                  {v > 0 ? '+' : ''}{v}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Other bonuses */}
        <div class="border-t border-[var(--color-void-border)] mt-3 pt-3">
          <SectionHeader size="sm" className="mb-1 opacity-40">Other</SectionHeader>
          <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-1 md:gap-3 text-[11px] md:text-[13px]">
            {Object.entries(bonuses.otherBonus).map(([k, v]) => {
              const label = OTHER_BONUS_LABELS[k] || k
              return (
                <div key={k} class="flex justify-between text-[var(--color-parchment)] opacity-70">
                  <span>{label}</span>
                  <span class="font-[var(--font-mono)]" style={{ color: v > 0 ? '#27ae60' : '#555' }}>
                    {typeof v === 'boolean' ? (v ? 'Yes' : 'No') : `${v > 0 ? '+' : ''}${v}${OTHER_BONUS_PERCENT_KEYS.has(k) ? '%' : ''}`}
                  </span>
                </div>
              )
            })}
          </div>
        </div>

        {/* Set bonuses — render only when active */}
        {hasFullVoidKingSet(equipment) && (
          <div class="border-t border-[var(--color-void-border)] mt-3 pt-3">
            <SectionHeader size="sm" className="mb-1 opacity-40">Void King Set Bonus</SectionHeader>
            <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-1 md:gap-3 text-[11px] md:text-[13px]">
              {[
                ['Melee Accuracy', 12.5],
                ['Melee Damage', 12.5],
                ['Ranged Accuracy', 12.5],
                ['Ranged Damage', 12.5],
                ['Magic Accuracy', 45],
                ['Magic Damage', 10],
              ].map(([label, pct]) => (
                <div key={label} class="flex justify-between text-[var(--color-parchment)] opacity-70">
                  <span>{label}</span>
                  <span class="font-[var(--font-mono)]" style={{ color: '#27ae60' }}>+{pct}%</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Inventory display — desktop only */}
        <div class="hidden lg:block border-t border-[var(--color-void-border)] mt-3 pt-3">
          <SectionHeader size="sm" className="mb-2 opacity-50">Inventory</SectionHeader>
          <InventoryGrid
            inventory={inventory}
            size="small"
            gridClass="grid grid-cols-7 gap-1"
            showName={false}
            onReorder={(from, to) => {
              const newInv = [...inventory]
              const tmp = newInv[to]
              newInv[to] = newInv[from]
              newInv[from] = tmp
              updateInventory(newInv)
            }}
            onSlotClick={(s, item, i) => handleInvSlotClick(s, item, i)}
          />
        </div>
      </Card>

      </div>

      {/* Inventory item modal */}
      {invSelected && (
        <SharedItemModal item={invSelected.item} quantity={invSelected.slot.quantity} noted={invSelected.slot.noted} onClose={() => setInvSelected(null)}>
          <div class="flex flex-col gap-2">
            {invSelected.item.type === 'armour' || invSelected.item.type === 'weapon' ? (
              <Button variant="primary" size="lg" onClick={handleEquipFromInv} className="w-full">
                Equip
              </Button>
            ) : (
              <p class="text-[11px] text-[var(--color-parchment)] opacity-60">
                This item cannot be equipped
              </p>
            )}
          </div>
        </SharedItemModal>
      )}

      {/* Unequip modal */}
      {selected && (
        <SharedItemModal item={selected.item} onClose={() => setSelected(null)} hideSlot extraInfo={<p>Slot: {EQ_SLOT_NAMES[selected.slot]}</p>}>
          <div class="flex flex-col gap-2">

            {/* Scale charges panel */}
            {selected.item.scaleCharged && (
              <WeaponChargePanel
                item={selected.item}
                currentCharges={equipment[selected.slot]?.charges || 0}
                inventory={inventory}
                itemsData={itemsData}
                onCharge={handleChargeWeapon}
                onUncharge={handleUnchargeWeapon}
              />
            )}

            {/* Special attack info */}
            {selected.item.specialAttack && (
              <Panel padding="p-0" className="border-[#3a2a00] overflow-hidden">
                <button
                  onClick={() => setShowSpecInfo(v => !v)}
                  class="w-full flex items-center justify-between px-3 py-2 bg-transparent border-0 cursor-pointer"
                >
                  <span class="text-[12px] font-semibold text-[#eab308]">⚡ Special Attack</span>
                  <span class="text-[10px] text-[#78530a]">{showSpecInfo ? '▲' : '▼'} {formatSpecialEnergyCostLabel(selected.item.specialAttack)}</span>
                </button>
                {showSpecInfo && (
                  <div class="px-3 pb-3 border-t border-[#3a2a00]">
                    <p class="text-[11px] text-[var(--color-parchment)] opacity-70 mt-2 leading-relaxed">
                      {selected.item.specialAttack.description}
                    </p>
                    <p class="text-[10px] text-[#78530a] mt-1">
                      Bar refills to 100% on each monster kill.
                    </p>
                  </div>
                )}
              </Panel>
            )}

            <Button variant="danger" size="lg" onClick={handleUnequip} className="w-full">
              Unequip
            </Button>
          </div>
        </SharedItemModal>
      )}

      {/* Save-loadout modal */}
      {createOpen && (
        <Modal title="Save Loadout" onClose={() => setCreateOpen(false)}>
          <div class="space-y-3">
            <p class="text-[11px] text-[var(--color-parchment)] opacity-60">
              Saves your current equipment and inventory as a preset you can reload later.
            </p>
            <div>
              <p class="text-[10px] text-[var(--color-parchment)] opacity-40 mb-1 uppercase tracking-wider">Preset Name</p>
              <input
                type="text"
                value={createName}
                onInput={(e) => setCreateName(e.target.value)}
                maxLength={24}
                class="w-full bg-[var(--color-void-light)] border border-[var(--color-void-border)] rounded-lg px-3 py-2 text-sm text-[var(--color-parchment)] outline-none focus:border-[var(--color-gold)]"
                placeholder={`Preset ${presets.length + 1}`}
              />
            </div>
            <button
              onClick={handleCreatePreset}
              class="w-full py-2.5 rounded-lg bg-[var(--color-mana)] text-white font-semibold text-sm active:opacity-80"
            >
              Save Loadout
            </button>
          </div>
        </Modal>
      )}

      {/* Edit/delete preset modal */}
      {managePreset && (
        <Modal title="Edit Preset" onClose={() => setManagePreset(null)}>
          <div class="space-y-3">
            <div>
              <p class="text-[10px] text-[var(--color-parchment)] opacity-40 mb-1 uppercase tracking-wider">Preset Name</p>
              <input
                type="text"
                value={manageName}
                onInput={(e) => setManageName(e.target.value)}
                maxLength={24}
                class="w-full bg-[var(--color-void-light)] border border-[var(--color-void-border)] rounded-lg px-3 py-2 text-sm text-[var(--color-parchment)] outline-none focus:border-[var(--color-gold)]"
                placeholder="Enter preset name"
              />
            </div>
            <button
              onClick={handleRenamePreset}
              class="w-full py-2.5 rounded-lg bg-[var(--color-mana)] text-white font-semibold text-sm active:opacity-80"
            >
              Rename
            </button>
            <button
              onClick={handleDeletePreset}
              class="w-full py-2.5 rounded-lg bg-red-900 text-white font-semibold text-sm active:opacity-80"
            >
              Delete Preset
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
