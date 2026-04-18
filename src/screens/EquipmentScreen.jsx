import { useState } from 'preact/hooks'
import { useGame } from '../state/gameState.jsx'
import { unequipSlot, getEquipmentBonuses } from '../engine/equipment.js'
import { EQUIPMENT_SLOTS } from '../utils/constants.js'
import Modal from '../components/Modal.jsx'
import Card from '../components/Card.jsx'
import Panel from '../components/Panel.jsx'
import Button from '../components/Button.jsx'
import SectionHeader from '../components/SectionHeader.jsx'

const DEFAULT_CHARGE_ITEM_ID = 'zulrah_scales'

const EQ_SLOT_LABELS = {
  head: '🪖', cape: '🧣', neck: '📿', ammo: '🏹',
  weapon: '🗡️', body: '👕', shield: '🛡️',
  legs: '👖', gloves: '🧤', boots: '👢', ring: '💍'
}

const EQ_SLOT_NAMES = {
  head: 'Head', cape: 'Cape', neck: 'Neck', ammo: 'Ammo',
  weapon: 'Weapon', body: 'Body', shield: 'Shield',
  legs: 'Legs', gloves: 'Gloves', boots: 'Boots', ring: 'Ring'
}

/**
 * Renders a single equipment slot in the paperdoll grid.
 */
function EquipSlot({ slotName, equipment, itemsData, onSelect }) {
  const entry = equipment[slotName]
  const item = entry ? itemsData[entry.itemId] : null
  const isEmpty = !item
  const charges = entry?.charges || 0

  const bgClass = isEmpty ? 'bg-[#111] border-[#222] opacity-40' : 'bg-[var(--color-void-light)] border-[#444]'
  const cursorClass = item ? 'cursor-pointer' : 'cursor-default'

  return (
    <button
      onClick={() => { if (item) onSelect(slotName, item) }}
      class={`w-14 h-14 rounded-[10px] border flex flex-col items-center justify-center relative ${bgClass} ${cursorClass}`}
    >
      <span style={{ fontSize: item ? '18px' : '14px' }}>
        {item ? (item.icon || '📦') : EQ_SLOT_LABELS[slotName]}
      </span>
      {charges > 0 && (
        <span class="absolute bottom-[2px] right-[2px] text-[8px] text-[#4ade80] font-bold">⚡</span>
      )}
      <span
        class={`text-[7px] text-center mt-[2px] max-w-[52px] overflow-hidden text-ellipsis whitespace-nowrap ${item ? 'text-[var(--color-parchment)] font-semibold' : 'text-[#555]'}`}
      >
        {item ? item.name : EQ_SLOT_NAMES[slotName]}
      </span>
    </button>
  )
}

export default function EquipmentScreen() {
  const { equipment, inventory, bank, updateEquipment, updateInventory, updateBank, addToast, itemsData } = useGame()
  const [selected, setSelected] = useState(null) // { slot, item }
  const [showSpecInfo, setShowSpecInfo] = useState(false)
  const [chargeInput, setChargeInput] = useState('')

  const handleSelect = (slotName, item) => {
    setSelected({ slot: slotName, item })
    setShowSpecInfo(false)
    setChargeInput('')
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

  // Paperdoll grid layout:
  //   Row 0:  [head]
  //   Row 1:  [cape] [neck] [ammo]
  //   Row 2:  [weapon] [body] [shield]
  //   Row 3:  [legs]
  //   Row 4:  [gloves] [boots] [ring]
  const slotProps = { equipment, itemsData, onSelect: handleSelect }

  return (
    <div class="h-full overflow-y-auto p-4">
      <SectionHeader className="mb-3">Equipment</SectionHeader>

      {/* Paperdoll */}
      <Card
        padding="p-4"
        className="mb-4 flex flex-col items-center gap-[6px]"
        style={{ background: 'linear-gradient(135deg, #141414, #0f0f0f)' }}
      >
        <div class="flex justify-center">
          <EquipSlot slotName="head" {...slotProps} />
        </div>
        <div class="flex gap-[6px] justify-center">
          <EquipSlot slotName="cape" {...slotProps} />
          <EquipSlot slotName="neck" {...slotProps} />
          <EquipSlot slotName="ammo" {...slotProps} />
        </div>
        <div class="flex gap-[6px] justify-center">
          <EquipSlot slotName="weapon" {...slotProps} />
          <EquipSlot slotName="body" {...slotProps} />
          <EquipSlot slotName="shield" {...slotProps} />
        </div>
        <div class="flex justify-center">
          <EquipSlot slotName="legs" {...slotProps} />
        </div>
        <div class="flex gap-[6px] justify-center">
          <EquipSlot slotName="gloves" {...slotProps} />
          <EquipSlot slotName="boots" {...slotProps} />
          <EquipSlot slotName="ring" {...slotProps} />
        </div>
      </Card>

      {/* Bonuses summary */}
      <Card>
        <SectionHeader size="sm" className="mb-2 opacity-50">Bonuses</SectionHeader>

        <div class="grid grid-cols-2 gap-2 text-[11px]">
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
        <div class="border-t border-[#222] mt-2 pt-2">
          <SectionHeader size="sm" className="mb-1 opacity-40">Other</SectionHeader>
          <div class="grid grid-cols-3 gap-1 text-[11px]">
            {Object.entries(bonuses.otherBonus).map(([k, v]) => {
              const label = k === 'meleeStrength' ? 'Str' : k === 'rangedStrength' ? 'Rng Str' : 'Mag %'
              return (
                <div key={k} class="flex justify-between text-[var(--color-parchment)] opacity-70">
                  <span>{label}</span>
                  <span class="font-[var(--font-mono)]" style={{ color: v > 0 ? '#27ae60' : '#555' }}>
                    {v > 0 ? '+' : ''}{v}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      </Card>

      {/* Unequip modal */}
      {selected && (
        <Modal title={selected.item.name} onClose={() => setSelected(null)}>
          <div class="flex flex-col gap-2">
            <Panel className="text-[12px] text-[var(--color-parchment)] opacity-70">
              <p>Slot: {EQ_SLOT_NAMES[selected.slot]}</p>
              {selected.item.attackSpeed && <p>Attack speed: {selected.item.attackSpeed} ticks</p>}
              {selected.item.attackStyle && <p>Style: {selected.item.attackStyle}</p>}
              {selected.item.otherBonus?.meleeStrength > 0 && <p>Strength bonus: +{selected.item.otherBonus.meleeStrength}</p>}
              {selected.item.requirements && Object.entries(selected.item.requirements).length > 0 && (
                <p>Requires: {Object.entries(selected.item.requirements).map(([s, l]) => `${s} ${l}`).join(', ')}</p>
              )}
            </Panel>

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
        </Modal>
      )}
    </div>
  )
}
