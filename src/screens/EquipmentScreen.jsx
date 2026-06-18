import { useState } from 'preact/hooks'
import { useGame } from '../state/gameState.jsx'
import { unequipSlot, getEquipmentBonuses, checkEquipRequirements, equipItem } from '../engine/equipment.js'
import { hasFullVoidKingSet } from '../engine/combatSetBonuses.js'
import { EQUIPMENT_SLOTS } from '../utils/constants.js'
import SharedItemModal from '../components/SharedItemModal.jsx'
import Card from '../components/Card.jsx'
import Panel from '../components/Panel.jsx'
import Button from '../components/Button.jsx'
import SectionHeader from '../components/SectionHeader.jsx'
import EquipmentPaperdoll, { EQ_SLOT_NAMES } from '../components/EquipmentPaperdoll.jsx'
import ItemSlot from '../components/ItemSlot.jsx'
import { OTHER_BONUS_LABELS, OTHER_BONUS_PERCENT_KEYS } from '../utils/bonusLabels.js'

const DEFAULT_CHARGE_ITEM_ID = 'venomcoil_scales'

export default function EquipmentScreen() {
  const { equipment, inventory, bank, stats, updateEquipment, updateInventory, updateBank, addToast, itemsData, completedQuests } = useGame()
  const [selected, setSelected] = useState(null) // { slot, item }
  const [showSpecInfo, setShowSpecInfo] = useState(false)
  const [chargeInput, setChargeInput] = useState('')
  const [invSelected, setInvSelected] = useState(null) // { slotIndex, slot, item }

  const handleSelect = (slotName, item) => {
    setSelected({ slot: slotName, item })
    setShowSpecInfo(false)
    setChargeInput('')
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
      for (const unequipped of result.unequipped) {
        const empty = newInv.indexOf(null)
        if (empty !== -1 && unequipped) {
          const invEntry = { itemId: unequipped.itemId, quantity: unequipped.quantity || 1 }
          if (unequipped.charges && unequipped.charges > 0) invEntry.charges = unequipped.charges
          newInv[empty] = invEntry
        }
      }
      updateEquipment(newEquip)
      updateInventory(newInv)
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

  const selectedWeaponEntry = selected ? equipment[selected.slot] : null
  const selectedChargeItemId = selectedWeaponEntry && itemsData[selectedWeaponEntry.itemId]
    ? (itemsData[selectedWeaponEntry.itemId].chargeItemId || DEFAULT_CHARGE_ITEM_ID)
    : DEFAULT_CHARGE_ITEM_ID
  const selectedChargeItemName = itemsData[selectedChargeItemId]?.name || selectedChargeItemId

  const scaleCount = inventory.reduce((sum, s) => sum + (s && s.itemId === selectedChargeItemId ? s.quantity : 0), 0)

  const handleChargeWeapon = (qty) => {
    if (!selected) return
    const equipSlotName = selected.slot
    const weaponEntry = equipment[equipSlotName]
    if (!weaponEntry) return
    const item = itemsData[weaponEntry.itemId]
    if (!item?.scaleCharged) return

    const chargeItemId = item.chargeItemId || DEFAULT_CHARGE_ITEM_ID
    const chargeItemName = itemsData[chargeItemId]?.name || chargeItemId
    const availableQty = inventory.reduce((sum, s) => sum + (s && s.itemId === chargeItemId ? s.quantity : 0), 0)
    const actualQty = Math.min(qty, availableQty)
    if (actualQty <= 0) {
      addToast(`No ${chargeItemName} in inventory`, 'error')
      return
    }

    const newInv = [...inventory]
    let remaining = actualQty
    for (let i = 0; i < newInv.length && remaining > 0; i++) {
      if (newInv[i]?.itemId === chargeItemId) {
        const take = Math.min(newInv[i].quantity, remaining)
        newInv[i] = { ...newInv[i], quantity: newInv[i].quantity - take }
        if (newInv[i].quantity <= 0) newInv[i] = null
        remaining -= take
      }
    }

    const newEq = { ...equipment }
    const currentCharges = weaponEntry.charges || 0
    newEq[equipSlotName] = { ...weaponEntry, charges: currentCharges + actualQty }

    updateInventory(newInv)
    updateEquipment(newEq)
    addToast(`Charged ${item.name} with ${actualQty} ${chargeItemName}`, 'info')
    setChargeInput('')
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

    const chargeItemId = item.chargeItemId || DEFAULT_CHARGE_ITEM_ID
    const chargeItemName = itemsData[chargeItemId]?.name || chargeItemId
    const existingIdx = newInv.findIndex(s => s && s.itemId === chargeItemId)
    if (existingIdx !== -1) {
      newInv[existingIdx] = { ...newInv[existingIdx], quantity: newInv[existingIdx].quantity + totalCharges }
    } else {
      const empty = newInv.indexOf(null)
      if (empty === -1) {
        addToast('Inventory full — cannot uncharge', 'error')
        return
      }
      newInv[empty] = { itemId: chargeItemId, quantity: totalCharges }
    }

    updateInventory(newInv)
    updateEquipment(newEq)
    updateBank(newBank)
    addToast(`Uncharged ${item.name}, recovered ${totalCharges} ${chargeItemName}`, 'info')
  }

  const bonuses = getEquipmentBonuses(equipment, itemsData)

  return (
    <div class="h-full overflow-y-auto p-4">
      <SectionHeader className="mb-3">Equipment</SectionHeader>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
      <div class="w-full">
        <EquipmentPaperdoll
          equipment={equipment}
          itemsData={itemsData}
          onSelect={handleSelect}
          size="md"
          className="w-full"
        />
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
        <div class="border-t border-[#222] mt-3 pt-3">
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
          <div class="border-t border-[#222] mt-3 pt-3">
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
        <div class="hidden lg:block border-t border-[#222] mt-3 pt-3">
          <SectionHeader size="sm" className="mb-2 opacity-50">Inventory</SectionHeader>
          <div class="grid grid-cols-7 gap-1">
            {inventory.map((slot, i) => (
              <ItemSlot
                key={i}
                slot={slot}
                onClick={(s, item) => handleInvSlotClick(s, item, i)}
                size="small"
              />
            ))}
          </div>
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
            {selected.item.scaleCharged && (() => {
              const currentCharges = equipment[selected.slot]?.charges || 0
              const parsedInput = parseInt(chargeInput, 10)
              const customQty = Number.isFinite(parsedInput) && parsedInput > 0 ? parsedInput : 0
              const chargeItemId = selected.item.chargeItemId || DEFAULT_CHARGE_ITEM_ID
              const chargeItemName = itemsData[chargeItemId]?.name || chargeItemId
              const chargeIcon = chargeItemId === 'blood_rune' ? '🩸' : '🐍'
              return (
                <Panel className="border-[#1a3a2a]">
                  <div class="flex items-center justify-between mb-2">
                    <span class="text-[12px] font-semibold text-[#4ade80]">{chargeIcon} {chargeItemName} Charges</span>
                    <span class="font-[var(--font-mono)] text-[12px] text-[var(--color-parchment)]">
                      {currentCharges} / ∞
                    </span>
                  </div>
                  <div class="text-[10px] text-[var(--color-parchment)] opacity-50 mb-2">
                    {chargeItemName} in inventory: {scaleCount}
                  </div>
                  <div class="grid grid-cols-3 gap-1 mb-[6px]">
                    <Button variant="success" size="sm" disabled={scaleCount <= 0} onClick={() => handleChargeWeapon(10)}>+10</Button>
                    <Button variant="success" size="sm" disabled={scaleCount <= 0} onClick={() => handleChargeWeapon(100)}>+100</Button>
                    <Button variant="success" size="sm" disabled={scaleCount <= 0} onClick={() => handleChargeWeapon(scaleCount)}>+All</Button>
                  </div>
                  <div class="flex gap-1 mb-[6px]">
                    <input
                      type="number"
                      min="1"
                      value={chargeInput}
                      onInput={(e) => setChargeInput(e.currentTarget.value)}
                      placeholder="Custom amount"
                      class="flex-1 px-2 py-2 rounded-md bg-[#0a0a0a] border border-[#222] text-[var(--color-parchment)] text-[11px] font-[var(--font-mono)]"
                    />
                    <Button variant="success" size="md" disabled={customQty <= 0 || scaleCount <= 0} onClick={() => handleChargeWeapon(customQty)}>
                      Charge
                    </Button>
                  </div>
                  <Button
                    variant="danger"
                    size="md"
                    disabled={currentCharges <= 0}
                    onClick={handleUnchargeWeapon}
                    className="w-full"
                  >
                    Uncharge (recover {currentCharges} {chargeItemName})
                  </Button>
                </Panel>
              )
            })()}

            {/* Special attack info */}
            {selected.item.specialAttack && (
              <Panel padding="p-0" className="border-[#3a2a00] overflow-hidden">
                <button
                  onClick={() => setShowSpecInfo(v => !v)}
                  class="w-full flex items-center justify-between px-3 py-2 bg-transparent border-0 cursor-pointer"
                >
                  <span class="text-[12px] font-semibold text-[#eab308]">⚡ Special Attack</span>
                  <span class="text-[10px] text-[#78530a]">{showSpecInfo ? '▲' : '▼'} {selected.item.specialAttack.energyCost}% energy</span>
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
    </div>
  )
}
