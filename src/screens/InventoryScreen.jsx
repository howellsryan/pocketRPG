import { useState, useEffect } from 'preact/hooks'
import { useGame } from '../state/gameState.jsx'
import ItemSlot from '../components/ItemSlot.jsx'
import Modal from '../components/Modal.jsx'
import SharedItemModal from '../components/SharedItemModal.jsx'
import TradingPostSellForm from '../components/TradingPostSellForm.jsx'
import { freeSlots, countItem } from '../engine/inventory.js'
import { isOrderBookItem } from '../engine/storeRules.js'
import { equipItem, checkEquipRequirements } from '../engine/equipment.js'
import { getLevelFromXP } from '../engine/experience.js'
import { api, getToken, getCharacterId } from '../cloud/api.js'
import { pullSave, applyCloudSave, pushNow } from '../cloud/sync.js'

export default function InventoryScreen() {
  const { inventory, equipment, stats, bank, updateInventory, updateEquipment, updateBank, updateHP, currentHP, getMaxHP, addToast, itemsData, completedQuests, isIronman, loadGame, getSnapshot } = useGame()
  const [selected, setSelected] = useState(null) // { slotIndex, slot, item }
  const [showSpecInfo, setShowSpecInfo] = useState(false)
  const [bankQuantityMode, setBankQuantityMode] = useState(null) // 'stackable' | 'nonStackable' | null
  const [bankQuantityInput, setBankQuantityInput] = useState('')
  const [chargeInput, setChargeInput] = useState('')
  const [showChargeModal, setShowChargeModal] = useState(false)
  const [showDropConfirm, setShowDropConfirm] = useState(false)
  const [sellBusy, setSellBusy] = useState(false)
  const [listQtyInput, setListQtyInput] = useState(1)
  const [listPriceInput, setListPriceInput] = useState(1)
  const hasCloudAccount = Boolean(getToken() && getCharacterId())

  useEffect(() => {
    if (!selected) return
    const liveSlot = inventory[selected.slotIndex]
    if (!liveSlot || liveSlot.itemId !== selected.slot?.itemId) {
      setSelected(null)
    }
  }, [inventory, selected])

  const getListingMaxQty = (slot, item) => {
    if (!slot || !item) return 1
    const isNoted = !!slot.noted
    if (item.stackable || isNoted) {
      return Math.max(1, Math.floor(Number(slot.quantity) || 1))
    }
    const count = inventory.reduce((n, s) => n + ((s && s.itemId === slot.itemId && !!s.noted === isNoted) ? 1 : 0), 0)
    return Math.max(1, count)
  }

  const handleSlotClick = (slot, item, index) => {
    if (!slot || !item) return
    if (!Number.isInteger(index) || index < 0 || index >= inventory.length) return
    const liveSlot = inventory[index]
    if (!liveSlot || liveSlot.itemId !== slot.itemId) return
    setSelected({ slotIndex: index, slot: liveSlot, item })
    setShowSpecInfo(false)
    setListQtyInput(1)
    setListPriceInput(Math.max(1, Math.floor(Number(item?.shopValue) || 1)))
  }

  const handleEquip = () => {
    if (!selected) return
    const { slotIndex, item } = selected

    const reqError = checkEquipRequirements(item, stats, completedQuests)
    if (reqError) {
      if (reqError.reason === 'quest') {
        addToast(`Complete quest to equip: ${reqError.questUnlock.replace(/_/g, ' ')}`, 'error')
      } else {
        addToast(`Need ${reqError.skill} level ${reqError.required} to equip`, 'error')
      }
      setSelected(null)
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
    }
    setSelected(null)
  }

  const handleEat = () => {
    if (!selected || selected.item.type !== 'food') return
    const { slotIndex, item } = selected
    const maxHP = getMaxHP()
    if (currentHP >= maxHP) {
      addToast('Already at full health', 'info')
      setSelected(null)
      return
    }

    const newInv = [...inventory]
    const slot = newInv[slotIndex]
    if (slot.quantity > 1) {
      newInv[slotIndex] = { ...slot, quantity: slot.quantity - 1 }
    } else {
      newInv[slotIndex] = null
    }
    updateInventory(newInv)
    updateHP(Math.min(currentHP + item.heals, maxHP))
    addToast(`Ate ${item.name}, healed ${item.heals} HP`, 'info')
    setSelected(null)
  }

  const handleDrop = () => {
    if (!selected) return
    setShowDropConfirm(true)
  }

  const confirmDrop = () => {
    if (!selected) { setShowDropConfirm(false); return }
    const newInv = [...inventory]
    newInv[selected.slotIndex] = null
    updateInventory(newInv)
    setShowDropConfirm(false)
    setSelected(null)
  }

  const handleCombine = () => {
    if (!selected) return
    const { slotIndex, slot, item } = selected
    if (slot.noted) {
      addToast('Cannot combine noted items', 'error')
      return
    }

    const targetId = item.combineWith
    const resultId = item.combineResult
    const targetData = itemsData[targetId]
    const resultData = itemsData[resultId]
    if (!targetData || !resultData) {
      addToast('Combine recipe is missing', 'error')
      return
    }

    const targetIdx = inventory.findIndex(
      (s, i) => s && i !== slotIndex && s.itemId === targetId && !s.noted
    )
    if (targetIdx === -1) {
      addToast(`No ${targetData.name} in inventory`, 'error')
      return
    }

    const newInv = [...inventory]
    newInv[slotIndex] = null
    newInv[targetIdx] = { itemId: resultId, quantity: 1 }
    updateInventory(newInv)
    addToast(`Created ${resultData.name}`, 'info')
    setSelected(null)
  }

  const handleChargeWeapon = (qty) => {
    if (!selected) return
    const { slotIndex, slot, item } = selected

    // Check if weapon is scale-charged
    if (!item.scaleCharged) {
      addToast('This weapon cannot be charged', 'error')
      return
    }

    const chargeItemId = item.chargeItemId || 'venomcoil_scales'
    const chargeItemName = itemsData[chargeItemId]?.name || chargeItemId
    const scalesIdx = inventory.findIndex(s => s && s.itemId === chargeItemId)
    if (scalesIdx === -1) {
      addToast(`No ${chargeItemName} in inventory`, 'error')
      return
    }

    const scales = inventory[scalesIdx]
    const chargeQty = Math.min(qty, scales.quantity)
    const newInv = [...inventory]
    const newSlot = { ...slot, charges: (slot.charges || 0) + chargeQty }
    newInv[slotIndex] = newSlot

    if (scales.quantity <= chargeQty) {
      newInv[scalesIdx] = null
    } else {
      newInv[scalesIdx] = { ...scales, quantity: scales.quantity - chargeQty }
    }

    updateInventory(newInv)
    setSelected({ ...selected, slot: newSlot })
    addToast(`Charged ${item.name} with ${chargeQty} ${chargeItemName} (${newSlot.charges} total)`, 'info')
    setShowChargeModal(false)
    setChargeInput('')
  }

  const handleUnchargeWeapon = () => {
    if (!selected) return
    const { slotIndex, slot, item } = selected

    // Check if weapon is scale-charged
    if (!item.scaleCharged) {
      addToast('This weapon cannot be uncharged', 'error')
      return
    }

    const charges = slot.charges || 0
    if (charges <= 0) {
      addToast('This weapon has no charges', 'error')
      return
    }

    // Collect total charges from ALL instances of this item in inventory, equipped, and bank
    let totalCharges = 0

    // Count charges in inventory
    const newInv = [...inventory]
    for (let i = 0; i < newInv.length; i++) {
      if (newInv[i] && newInv[i].itemId === item.id && newInv[i].charges > 0) {
        totalCharges += newInv[i].charges
      }
    }

    // Count charges in equipped slot
    const newEquip = { ...equipment }
    for (const slotName of Object.keys(newEquip)) {
      if (newEquip[slotName] && newEquip[slotName].itemId === item.id && newEquip[slotName].charges > 0) {
        totalCharges += newEquip[slotName].charges
      }
    }

    // Count charges in bank
    const newBank = { ...bank }
    if (newBank[item.id] && newBank[item.id].charges > 0) {
      totalCharges += newBank[item.id].charges
    }

    // Remove charges from all instances
    for (let i = 0; i < newInv.length; i++) {
      if (newInv[i] && newInv[i].itemId === item.id && newInv[i].charges > 0) {
        newInv[i] = { ...newInv[i], charges: 0 }
      }
    }

    for (const slotName of Object.keys(newEquip)) {
      if (newEquip[slotName] && newEquip[slotName].itemId === item.id && newEquip[slotName].charges > 0) {
        newEquip[slotName] = { ...newEquip[slotName], charges: 0 }
      }
    }

    if (newBank[item.id] && newBank[item.id].charges > 0) {
      newBank[item.id] = { ...newBank[item.id], charges: 0 }
    }

    const chargeItemId = item.chargeItemId || 'venomcoil_scales'
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
    updateEquipment(newEquip)
    updateBank(newBank)

    const updatedSlot = { ...slot, charges: 0 }
    setSelected({ ...selected, slot: updatedSlot })
    addToast(`Uncharged ${item.name}, recovered ${totalCharges} ${chargeItemName}`, 'info')
  }

  // Deposit to bank — stackable: deposit all; non-stackable: show qty picker
  const handleDeposit = (qty) => {
    if (!selected) return
    const { slotIndex, slot, item } = selected

    if (item.stackable || slot.noted) {
      // Stackable + noted items: deposit from the stack
      const actualQty = qty ? Math.min(qty, slot.quantity) : slot.quantity
      const newBank = { ...bank }
      if (newBank[slot.itemId]) {
        newBank[slot.itemId] = { ...newBank[slot.itemId], quantity: newBank[slot.itemId].quantity + actualQty }
        // Preserve charges if the item being deposited has them
        if (slot.charges && slot.charges > 0) {
          newBank[slot.itemId] = { ...newBank[slot.itemId], charges: (newBank[slot.itemId].charges || 0) + slot.charges }
        }
      } else {
        const bankEntry = { itemId: slot.itemId, quantity: actualQty }
        if (slot.charges && slot.charges > 0) bankEntry.charges = slot.charges
        newBank[slot.itemId] = bankEntry
      }
      const newInv = [...inventory]
      if (actualQty >= slot.quantity) {
        newInv[slotIndex] = null
      } else {
        newInv[slotIndex] = { ...slot, quantity: slot.quantity - actualQty }
      }
      updateInventory(newInv)
      updateBank(newBank)
      setSelected(null)
    } else {
      // Non-stackable: deposit qty of same itemId (non-noted only — the user
      // clicked a non-noted slot). Matching on itemId alone would also null
      // out any noted stack with the same id, wiping that stack's quantity.
      const depositQty = qty || 1
      const newBank = { ...bank }
      const newInv = [...inventory]
      let deposited = 0
      for (let i = 0; i < newInv.length && deposited < depositQty; i++) {
        if (newInv[i] && newInv[i].itemId === slot.itemId && !newInv[i].noted) {
          newInv[i] = null
          deposited++
        }
      }
      if (deposited > 0) {
        if (newBank[slot.itemId]) {
          newBank[slot.itemId] = { ...newBank[slot.itemId], quantity: newBank[slot.itemId].quantity + deposited }
          // Preserve charges if the item being deposited has them
          if (slot.charges && slot.charges > 0) {
            newBank[slot.itemId] = { ...newBank[slot.itemId], charges: (newBank[slot.itemId].charges || 0) + slot.charges }
          }
        } else {
          const bankEntry = { itemId: slot.itemId, quantity: deposited }
          if (slot.charges && slot.charges > 0) bankEntry.charges = slot.charges
          newBank[slot.itemId] = bankEntry
        }
        updateInventory(newInv)
        updateBank(newBank)
      }
      setSelected(null)
    }
  }

  const handleSell = async (qty, overridePrice = null) => {
    if (!selected || sellBusy) return

    // Re-verify the inventory slot still exists with the same item
    const currentSlot = inventory[selected.slotIndex]
    if (!currentSlot || currentSlot.itemId !== selected.slot.itemId) {
      addToast('Item no longer in inventory', 'error')
      setSelected(null)
      return
    }

    const { slot, item } = selected
    const defaultPrice = Math.floor(Number(item.shopValue) || 0)
    const price = Math.floor(Number(overridePrice ?? defaultPrice) || 0)
    if (price <= 0) {
      addToast('This item has no value', 'error')
      setSelected(null)
      return
    }
    if (!hasCloudAccount) {
      addToast('Selling requires a cloud-synced character', 'error')
      setSelected(null)
      return
    }

    const isNoted = !!currentSlot.noted
    const ownedQty = (item.stackable || isNoted)
      ? currentSlot.quantity
      : inventory.reduce((n, s) => n + ((s && s.itemId === currentSlot.itemId && !!s.noted === isNoted) ? 1 : 0), 0)
    const sellQty = Math.max(1, Math.min(Number(qty) || 1, ownedQty))

    setSellBusy(true)
    try {
      // Flush local inventory/bank/coins state to the server before mutating
      // through the API. Otherwise the 60s autosave debounce can leave the
      // server-side save out of date (e.g. items just banked locally), and
      // the trading post sees an inventory without the item the player just
      // tapped.
      try { await pushNow(getSnapshot()) } catch (_) { /* ignore push failure */ }

      if (isIronman || item.isUntradeable) {
        // Ironman accounts can't use the trading post, and untradeable items
        // never list there either; both take the NPC-instant-sell path that
        // deletes the item and pays out its shopValue in coins.
        await api.tradingPostSellImmediate(currentSlot.itemId, sellQty)
        const cloud = await pullSave()
        if (cloud?.payload) await applyCloudSave(cloud.payload, cloud.updatedAt)
        await loadGame()
        addToast(`Sold ${sellQty} × ${item.name} for ${(sellQty * price).toLocaleString()} gp`, 'info')
      } else {
        const res = await api.tradingPostList('sell', currentSlot.itemId, price, sellQty)
        const cloud = await pullSave()
        if (cloud?.payload) await applyCloudSave(cloud.payload, cloud.updatedAt)
        await loadGame()
        const sold = Number(res?.matched_quantity) || 0
        const remaining = Number(res?.remaining) || 0
        const earned = Number(res?.total_earned) || 0
        // Server returns offer_id = null when a non-order-book sell was
        // auto-filled at shopValue (no listing was created).
        const autoFilled = res?.offer_id == null
        if (autoFilled) {
          addToast(`Sold ${sold} × ${item.name} for ${earned.toLocaleString()} gp`, 'success')
        } else if (sold > 0 && remaining === 0) {
          addToast(`Matched ${sold} × ${item.name} — collect ${earned.toLocaleString()} gp from the trading post`, 'success')
        } else if (sold > 0 && remaining > 0) {
          addToast(`Matched ${sold} (collect ${earned.toLocaleString()} gp); ${remaining} still listed`, 'success')
        } else {
          addToast(`Listed ${sellQty} × ${item.name} at ${price.toLocaleString()} gp on the trading post`, 'info')
        }
      }
    } catch (err) {
      const code = err?.body?.code
      if (code === 'TRADING_POST_SLOTS_FULL') addToast(err.body.error, 'error')
      else if (code === 'IRONMAN_RESTRICTED') addToast(err.body.error, 'error')
      else if (code === 'INSUFFICIENT_SUPPLIES') addToast("You don't have that many to sell.", 'error')
      else if (code === 'NOT_LISTABLE') addToast('This item cannot be listed.', 'error')
      else if (code === 'IN_ACTIVE_MATCH') addToast('Cannot sell during a PvP match.', 'error')
      else addToast(`Sell failed: ${err?.message || 'unknown error'}`, 'error')
    } finally {
      setSellBusy(false)
      setSelected(null)
    }
  }

  const handleCustomListSubmit = async () => {
    if (!selected) return
    const qty = Math.floor(Number(listQtyInput) || 0)
    const price = Math.floor(Number(listPriceInput) || 0)
    const { slot, item } = selected
    const maxQty = getListingMaxQty(slot, item)
    if (qty < 1 || qty > maxQty) {
      addToast(`Quantity must be 1-${maxQty}`, 'error')
      return
    }
    if (price < 1) {
      addToast('Price must be at least 1 gp', 'error')
      return
    }
    await handleSell(qty, price)
  }

  const handleBankQuantitySubmit = () => {
    if (!bankQuantityInput || !selected) return
    const qty = parseInt(bankQuantityInput, 10)
    if (isNaN(qty) || qty <= 0) {
      addToast('Invalid quantity', 'error')
      return
    }

    // For stackable, check against slot quantity; for non-stackable, check against sameItemCount
    const maxQty = bankQuantityMode === 'stackable' ? selected.slot.quantity : sameItemCount
    if (qty > maxQty) {
      addToast(`Only ${maxQty} available`, 'error')
      return
    }

    handleDeposit(qty)
    setBankQuantityMode(null)
    setBankQuantityInput('')
  }

  const free = freeSlots(inventory)

  // Deposit all inventory items to bank
  const handleDepositAll = () => {
    const newInv = [...inventory]
    const newBank = { ...bank }
    let deposited = 0

    for (let i = 0; i < newInv.length; i++) {
      const slot = newInv[i]
      if (!slot) continue
      const { itemId, quantity, charges } = slot
      if (newBank[itemId]) {
        newBank[itemId] = { ...newBank[itemId], quantity: newBank[itemId].quantity + quantity }
        // Preserve charges if the item being deposited has them
        if (charges && charges > 0) {
          newBank[itemId] = { ...newBank[itemId], charges: (newBank[itemId].charges || 0) + charges }
        }
      } else {
        const bankEntry = { itemId, quantity }
        if (charges && charges > 0) bankEntry.charges = charges
        newBank[itemId] = bankEntry
      }
      newInv[i] = null
      deposited++
    }

    if (deposited === 0) {
      addToast('Nothing to deposit', 'info')
      return
    }

    updateInventory(newInv)
    updateBank(newBank)
    addToast(`Deposited all items to bank`, 'info')
  }

  // For non-stackable deposit/sell, count how many of the same item in inventory
  const sameItemCount = selected && !selected.item.stackable && !selected.slot.noted
    ? inventory.filter(s => s && s.itemId === selected.slot.itemId && !s.noted).length
    : 0
  const selectedListingMaxQty = selected ? getListingMaxQty(selected.slot, selected.item) : 1

  return (
    <div class="h-full overflow-y-auto p-4">
      <div class="flex justify-between items-center mb-3">
        <h2 class="font-[var(--font-display)] text-sm font-bold text-[var(--color-parchment)] opacity-60 uppercase tracking-wider">
          Inventory
        </h2>
        <div class="flex items-center gap-2">
          <button
            onClick={handleDepositAll}
            class="px-2.5 py-1 rounded-md bg-[var(--color-emerald-mid)] text-white font-semibold text-[10px] uppercase tracking-wider active:opacity-80"
          >
            Deposit All
          </button>
          <span class="text-xs font-[var(--font-mono)] text-[var(--color-parchment)] opacity-40">
            {free} free
          </span>
        </div>
      </div>

      <div class="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-7 xl:grid-cols-7 gap-2 md:gap-3 justify-items-center">
        {inventory.map((slot, i) => (
          <ItemSlot
            key={i}
            slot={slot}
            onClick={(s, item) => handleSlotClick(s, item, i)}
            size="inventory"
            showName
          />
        ))}
      </div>

      {/* Item action modal */}
      {selected && (
        <SharedItemModal item={selected.item} quantity={selected.slot.quantity} noted={selected.slot.noted} onClose={() => setSelected(null)}>
          <div class="space-y-2">
              {selected.item.scaleCharged && (
                <p class="mt-1">⚡ Charges: <span class="text-[var(--color-emerald)] font-bold">{selected.slot.charges || 0}</span></p>
              )}
            {/* Special attack info — shown for weapons with a spec */}
            {selected.item.specialAttack && (
              <div class="bg-[#111] rounded-lg border border-yellow-900 overflow-hidden">
                <button
                  onClick={() => setShowSpecInfo(v => !v)}
                  class="w-full flex items-center justify-between px-3 py-2 active:bg-[#1a1a1a]"
                >
                  <span class="text-xs font-semibold text-yellow-400">⚡ Special Attack</span>
                  <span class="text-[10px] text-yellow-600">{showSpecInfo ? '▲' : '▼'} {selected.item.specialAttack.energyCost}% energy</span>
                </button>
                {showSpecInfo && (
                  <div class="px-3 pb-3 space-y-1 border-t border-yellow-900">
                    <p class="text-[11px] text-[var(--color-parchment)] opacity-70 mt-2 leading-relaxed">
                      {selected.item.specialAttack.description}
                    </p>
                    <p class="text-[10px] text-yellow-600 mt-1">
                      Bar refills to 100% on each monster kill.
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Action buttons */}
            <div class="grid gap-2">
              <div class="grid grid-cols-2 gap-2">
                {(selected.item.slot) && !selected.slot.noted && (
                  <button onClick={handleEquip}
                    class="py-2.5 rounded-lg bg-[var(--color-mana)] text-white font-semibold text-sm active:opacity-80">
                    Equip
                  </button>
                )}
                {selected.item.type === 'food' && !selected.slot.noted && (
                  <button onClick={handleEat}
                    class="py-2.5 rounded-lg bg-[var(--color-emerald)] text-white font-semibold text-sm active:opacity-80">
                    Eat
                  </button>
                )}
                {selected.item.scaleCharged && !selected.slot.noted && (
                  <button onClick={() => setShowChargeModal(true)}
                    class="py-2.5 rounded-lg bg-[#1a3a3a] text-[var(--color-emerald)] font-semibold text-sm active:opacity-80 border border-[var(--color-emerald)]/30">
                    Charge ⚡
                  </button>
                )}
                {selected.item.combineWith && !selected.slot.noted && (() => {
                  const targetData = itemsData[selected.item.combineWith]
                  const targetName = targetData?.name || selected.item.combineWith
                  const hasTarget = inventory.some(
                    (s, i) => s && i !== selected.slotIndex && s.itemId === selected.item.combineWith && !s.noted
                  )
                  return (
                    <button
                      onClick={handleCombine}
                      disabled={!hasTarget}
                      class={`py-2.5 rounded-lg font-semibold text-sm border ${hasTarget
                        ? 'bg-[#2a1a3a] text-[#c084fc] border-[#c084fc]/30 active:opacity-80'
                        : 'bg-[#222] text-[var(--color-parchment)] opacity-40 border-transparent cursor-not-allowed'}`}
                    >
                      Use on {targetName}
                    </button>
                  )
                })()}
                <button onClick={handleDrop}
                  class="py-2.5 rounded-lg bg-[var(--color-blood-mid)] text-white font-semibold text-sm active:opacity-80">
                  Drop
                </button>
              </div>
              {selected.item.scaleCharged && !selected.slot.noted && (selected.slot.charges || 0) > 0 && (() => {
                const chargeItemId = selected.item.chargeItemId || 'venomcoil_scales'
                const chargeItemName = itemsData[chargeItemId]?.name || chargeItemId
                return (
                  <button onClick={handleUnchargeWeapon}
                    class="w-full py-2.5 rounded-lg bg-[#3a1a1a] text-[var(--color-blood)] font-semibold text-sm active:opacity-80 border border-[var(--color-blood)]/30">
                    Uncharge ({selected.slot.charges} {chargeItemName})
                  </button>
                )
              })()}
            </div>

            {/* Bank deposit section */}
            <div class="border-t border-[#333] pt-2 mt-1">
              <p class="text-[10px] text-[var(--color-parchment)] opacity-40 mb-1.5 uppercase tracking-wider font-bold">Bank</p>
              {(selected.item.stackable || selected.slot.noted) ? (
                <div>
                  <div class="grid grid-cols-3 gap-2 mb-2">
                    {[1, 5, 10].map(qty => (
                      <button key={qty} onClick={() => handleDeposit(qty)}
                        disabled={selected.slot.quantity < qty}
                        class={`py-2 rounded-lg text-white font-semibold text-sm ${selected.slot.quantity < qty ? 'bg-[#222] opacity-30' : 'bg-[var(--color-emerald-mid)] active:opacity-80'}`}>
                        Bank {qty}
                      </button>
                    ))}
                  </div>
                  <div class="grid grid-cols-2 gap-2">
                    <button onClick={() => handleDeposit()}
                      class="py-2 rounded-lg bg-[var(--color-emerald-mid)] text-white font-semibold text-sm active:opacity-80">
                      Bank All
                    </button>
                    <button onClick={() => {
                      setBankQuantityMode('stackable')
                      setBankQuantityInput('')
                    }}
                      class="py-2 rounded-lg bg-[var(--color-emerald)] text-white font-semibold text-sm active:opacity-80">
                      Bank X
                    </button>
                  </div>
                </div>
              ) : (
                <div>
                  <div class="grid grid-cols-3 gap-2 mb-2">
                    <button onClick={() => handleDeposit(1)}
                      class="py-2 rounded-lg bg-[var(--color-emerald-mid)] text-white font-semibold text-sm active:opacity-80">
                      Bank 1
                    </button>
                    {sameItemCount >= 3 && (
                      <button onClick={() => handleDeposit(5)}
                        class="py-2 rounded-lg bg-[var(--color-emerald-mid)] text-white font-semibold text-sm active:opacity-80">
                        Bank 5
                      </button>
                    )}
                    {sameItemCount >= 10 && (
                      <button onClick={() => handleDeposit(10)}
                        class="py-2 rounded-lg bg-[var(--color-emerald-mid)] text-white font-semibold text-sm active:opacity-80">
                        Bank 10
                      </button>
                    )}
                  </div>
                  {sameItemCount > 1 && (
                    <div class="grid grid-cols-2 gap-2">
                      <button onClick={() => handleDeposit(sameItemCount)}
                        class="py-2 rounded-lg bg-[var(--color-emerald-mid)] text-white font-semibold text-sm active:opacity-80">
                        Bank All
                      </button>
                      <button onClick={() => {
                        setBankQuantityMode('nonStackable')
                        setBankQuantityInput('')
                      }}
                        class="py-2 rounded-lg bg-[var(--color-emerald)] text-white font-semibold text-sm active:opacity-80">
                        Bank X
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Sell section */}
            {selected.item.shopValue > 0 && selected.item.type !== 'currency' && (() => {
              // Order-book items (boss/raid/clue uniques) go through the player-
              // to-player listing form. Everything else auto-sells at shopValue,
              // so we show the quick-sell buttons used by the legacy NPC path.
              // Untradeable items can't be listed at all, so they always sell
              // instantly to the NPC.
              const useQuickSell = isIronman || selected.item.isUntradeable || !isOrderBookItem(selected.item)
              return (
              <div class="border-t border-[#333] pt-2 mt-1">
                <p class="text-[10px] text-[var(--color-parchment)] opacity-40 mb-1.5 uppercase tracking-wider font-bold">
                  {useQuickSell ? 'Sell' : 'Trading Post Listing'}
                </p>
                {!useQuickSell && (
                  <p class="text-[10px] text-[var(--color-parchment)] opacity-50 mb-1.5">
                    Listing at {selected.item.shopValue.toLocaleString()} gp · paid only when sold.
                  </p>
                )}
                {useQuickSell && (selected.item.stackable || selected.slot.noted) ? (
                  <div class="grid grid-cols-3 gap-2">
                    {[1, 5, 10].map(qty => (
                      <button key={qty} onClick={() => handleSell(qty)}
                        disabled={selected.slot.quantity < qty || sellBusy}
                        class={`py-2 rounded-lg text-white font-semibold text-sm ${selected.slot.quantity < qty || sellBusy ? 'bg-[#222] opacity-30' : 'bg-[var(--color-gold-dim)] active:opacity-80'}`}>
                        Sell {qty} ({qty * selected.item.shopValue}gp)
                      </button>
                    ))}
                    <button onClick={() => handleSell(selected.slot.quantity)}
                      disabled={sellBusy}
                      class={`py-2 rounded-lg text-white font-semibold text-sm col-span-3 ${sellBusy ? 'bg-[#222] opacity-30' : 'bg-[var(--color-gold-dim)] active:opacity-80'}`}>
                      Sell All ({selected.slot.quantity * selected.item.shopValue} gp)
                    </button>
                  </div>
                ) : useQuickSell ? (
                  <div class="grid grid-cols-3 gap-2">
                    <button onClick={() => handleSell(1)}
                      disabled={sellBusy}
                      class={`py-2 rounded-lg text-white font-semibold text-sm ${sellBusy ? 'bg-[#222] opacity-30' : 'bg-[var(--color-gold-dim)] active:opacity-80'}`}>
                      Sell 1 ({selected.item.shopValue}gp)
                    </button>
                    {sameItemCount >= 3 && (
                      <button onClick={() => handleSell(5)}
                        disabled={sellBusy}
                        class={`py-2 rounded-lg text-white font-semibold text-sm ${sellBusy ? 'bg-[#222] opacity-30' : 'bg-[var(--color-gold-dim)] active:opacity-80'}`}>
                        Sell 5
                      </button>
                    )}
                    {sameItemCount >= 10 && (
                      <button onClick={() => handleSell(10)}
                        disabled={sellBusy}
                        class={`py-2 rounded-lg text-white font-semibold text-sm ${sellBusy ? 'bg-[#222] opacity-30' : 'bg-[var(--color-gold-dim)] active:opacity-80'}`}>
                        Sell 10
                      </button>
                    )}
                    {sameItemCount > 1 && (
                      <button onClick={() => handleSell(sameItemCount)}
                        disabled={sellBusy}
                        class={`py-2 rounded-lg text-white font-semibold text-sm ${sameItemCount >= 10 ? 'col-span-3' : sameItemCount >= 3 ? 'col-span-1' : 'col-span-2'} ${sellBusy ? 'bg-[#222] opacity-30' : 'bg-[var(--color-gold-dim)] active:opacity-80'}`}>
                        Sell All ({sameItemCount * selected.item.shopValue}gp)
                      </button>
                    )}
                  </div>
                ) : (
                  <TradingPostSellForm
                    qty={listQtyInput}
                    setQty={setListQtyInput}
                    price={listPriceInput}
                    setPrice={setListPriceInput}
                    maxQty={selectedListingMaxQty}
                    busy={sellBusy}
                    onCancel={() => setSelected(null)}
                    onSubmit={handleCustomListSubmit}
                  />
                )}
              </div>
              )
            })()}
          </div>
        </SharedItemModal>
      )}

      {/* ── Bank quantity input modal ──────────────────────────────────── */}
      {bankQuantityMode && selected && (() => {
        const maxQty = bankQuantityMode === 'stackable' ? selected.slot.quantity : sameItemCount
        const title = `Bank ${selected.item.name}`

        return (
          <Modal title={title} onClose={() => { setBankQuantityMode(null); setBankQuantityInput('') }}>
            <div class="space-y-3">
              <div>
                <p class="text-[10px] text-[var(--color-parchment)] opacity-40 mb-1 uppercase tracking-wider">Available: {maxQty}</p>
                <input
                  type="number"
                  value={bankQuantityInput}
                  onInput={(e) => setBankQuantityInput(e.target.value)}
                  min="1"
                  max={maxQty}
                  placeholder="Enter quantity"
                  class="w-full bg-[#1a1a1a] border border-[#333] rounded-lg px-3 py-2 text-sm text-[var(--color-parchment)] outline-none focus:border-[var(--color-gold)]"
                  autoFocus
                />
              </div>
              <button
                onClick={handleBankQuantitySubmit}
                disabled={!bankQuantityInput || isNaN(parseInt(bankQuantityInput, 10)) || parseInt(bankQuantityInput, 10) <= 0}
                class="w-full py-2.5 rounded-lg bg-[var(--color-emerald-mid)] text-white font-semibold text-sm active:opacity-80"
              >
                Bank {bankQuantityInput || '0'}
              </button>
            </div>
          </Modal>
        )
      })()}

      {/* ── Charge weapon modal ──────────────────────────────────────── */}
      {showChargeModal && selected && (() => {
        const chargeItemId = selected.item.chargeItemId || 'venomcoil_scales'
        const chargeItemName = itemsData[chargeItemId]?.name || chargeItemId
        const scalesInInv = inventory.find(s => s && s.itemId === chargeItemId)
        const availableScales = scalesInInv?.quantity || 0
        const currentCharges = selected.slot.charges || 0

        return (
          <Modal title={`Charge ${selected.item.name}`} onClose={() => { setShowChargeModal(false); setChargeInput('') }}>
            <div class="space-y-3">
              <div class="bg-[#111] rounded-lg p-3 text-sm text-[var(--color-parchment)] opacity-70">
                <p>Current charges: <span class="text-[var(--color-emerald)] font-bold">{currentCharges}</span></p>
                <p>{chargeItemName} available: <span class="text-[var(--color-gold)] font-bold">{availableScales}</span></p>
              </div>
              <div>
                <p class="text-[10px] text-[var(--color-parchment)] opacity-40 mb-1 uppercase tracking-wider">Add {chargeItemName}</p>
                <input
                  type="number"
                  value={chargeInput}
                  onInput={(e) => setChargeInput(e.target.value)}
                  min="1"
                  max={availableScales}
                  placeholder={`Enter ${chargeItemName} to add`}
                  class="w-full bg-[#1a1a1a] border border-[#333] rounded-lg px-3 py-2 text-sm text-[var(--color-parchment)] outline-none focus:border-[var(--color-emerald)]"
                  autoFocus
                />
              </div>
              {availableScales === 0 && (
                <p class="text-[10px] text-[var(--color-blood)] text-center">You need {chargeItemName} to charge this weapon</p>
              )}
              <button
                onClick={() => handleChargeWeapon(parseInt(chargeInput, 10))}
                disabled={availableScales === 0 || !chargeInput || isNaN(parseInt(chargeInput, 10)) || parseInt(chargeInput, 10) <= 0}
                class="w-full py-2.5 rounded-lg bg-[#1a3a3a] text-[var(--color-emerald)] font-semibold text-sm active:opacity-80 border border-[var(--color-emerald)]/30 disabled:opacity-40 disabled:cursor-default"
              >
                Add {chargeInput || '0'} {chargeItemName}
              </button>
            </div>
          </Modal>
        )
      })()}

      {showDropConfirm && selected && (
        <Modal title="Drop item?" onClose={() => setShowDropConfirm(false)}>
          <div class="space-y-4">
            <p class="text-sm text-[var(--color-parchment)] opacity-80">
              Drop <span class="font-bold text-[var(--color-gold)]">{selected.item.name}</span>? It will be lost permanently.
            </p>
            <div class="grid grid-cols-2 gap-2">
              <button
                onClick={() => setShowDropConfirm(false)}
                class="min-h-[44px] py-2.5 rounded-lg bg-[#222] text-[var(--color-parchment)] font-semibold text-sm active:opacity-80 border border-[#333]"
              >
                Cancel
              </button>
              <button
                onClick={confirmDrop}
                class="min-h-[44px] py-2.5 rounded-lg bg-[var(--color-blood-mid)] text-white font-semibold text-sm active:opacity-80"
              >
                Drop
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
