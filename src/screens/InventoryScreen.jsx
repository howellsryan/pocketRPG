import { useState, useEffect } from 'preact/hooks'
import { useGame } from '../state/gameState.jsx'
import InventoryGrid from '../components/InventoryGrid.jsx'
import Modal from '../components/Modal.jsx'
import SharedItemModal from '../components/SharedItemModal.jsx'
import WeaponChargePanel, { getChargeRecipe } from '../components/WeaponChargePanel.jsx'
import CollapseChevron from '../components/CollapseChevron.jsx'
import TradingPostSellForm from '../components/TradingPostSellForm.jsx'
import SellConfirmModal from '../components/SellConfirmModal.jsx'
import { freeSlots, countItem, removeItem, addItem, getBreakdownYield, sumSlotCharges } from '../engine/inventory.js'
import { resolveInventoryEat } from '../engine/consumables.js'
import { chargeRecipeSpend } from '../engine/chargeRecipes.js'
import { recordItemLosses } from '../engine/lossLedger.js'
import GameIcon from '../components/GameIcon.jsx'
import { getSkillArt } from '../utils/skillArt.js'
import { isOrderBookItem } from '../engine/storeRules.js'
import { getIronmanShopValue } from '../utils/itemValue.js'
import { HIGH_VALUE_SELL_THRESHOLD } from '../utils/constants.js'
import { equipItem, checkEquipRequirements, placeUnequippedItems } from '../engine/equipment.js'
import { getLevelFromXP } from '../engine/experience.js'
import { api, getToken, getCharacterId } from '../cloud/api.js'
import { formatSpecialEnergyCostLabel } from '../engine/specialAttackEnergy.js'
import { pullSave, applyCloudSave, pushNow } from '../cloud/sync.js'

export default function InventoryScreen() {
  const { inventory, equipment, stats, bank, updateInventory, updateEquipment, updateBank, updateHP, currentHP, getMaxHP, addToast, itemsData, completedQuests, isIronman, loadGame, getSnapshot, autoBankExcludedItems, toggleAutoBankExclusion } = useGame()
  const [selected, setSelected] = useState(null) // { slotIndex, slot, item }
  const [showSpecInfo, setShowSpecInfo] = useState(false)
  const [bankQuantityMode, setBankQuantityMode] = useState(null) // 'stackable' | 'nonStackable' | null
  const [bankQuantityInput, setBankQuantityInput] = useState('')
  const [showChargeModal, setShowChargeModal] = useState(false)
  const [showDropConfirm, setShowDropConfirm] = useState(false)
  const [showBreakdownConfirm, setShowBreakdownConfirm] = useState(false)
  const [sellBusy, setSellBusy] = useState(false)
  const [pendingHighValueSell, setPendingHighValueSell] = useState(null) // { qty, overridePrice, itemName, totalValue }
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
      const placed = placeUnequippedItems(result.unequipped, newInv, itemsData)
      if (!placed.ok) {
        addToast('Inventory full', 'error')
        setSelected(null)
        return
      }
      updateEquipment(newEquip)
      updateInventory(placed.inventory)
    }
    setSelected(null)
  }

  // Every outcome here reports as 'success'/'error', never 'info' — info toasts
  // are off by default, which made a refused eat completely indistinguishable
  // from a broken button.
  const handleEat = () => {
    if (!selected) return
    const { slotIndex, item } = selected
    const result = resolveInventoryEat({
      inventory, slotIndex, item, currentHP, maxHP: getMaxHP(),
    })
    if (!result.ok) {
      if (result.reason === 'full_hp') addToast('Already at full health', 'error')
      else if (result.reason === 'no_heal') addToast(`${item.name} heals nothing`, 'error')
      setSelected(null)
      return
    }
    updateInventory(result.inventory)
    updateHP(result.hp)
    addToast(`Ate ${item.name}, healed ${result.healed} HP`, 'success')
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

  const handleBreakdown = () => {
    if (!selected || selected.slot.noted) return
    setShowBreakdownConfirm(true)
  }

  const confirmBreakdown = () => {
    if (!selected) { setShowBreakdownConfirm(false); return }
    const yieldResult = getBreakdownYield(selected.item)
    if (!yieldResult) { setShowBreakdownConfirm(false); return }
    const newInv = [...inventory]
    newInv[selected.slotIndex] = null
    addItem(newInv, yieldResult.itemId, yieldResult.qty, itemsData[yieldResult.itemId]?.stackable || false)
    updateInventory(newInv)
    addToast(`Broke down ${selected.item.name} into ${yieldResult.qty.toLocaleString()} ${itemsData[yieldResult.itemId]?.name || yieldResult.itemId}`, 'info')
    setShowBreakdownConfirm(false)
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

    const cost = Number(item.combineCost) || 0
    if (cost > 0 && countItem(inventory, 'coins') < cost) {
      addToast(`Need ${cost.toLocaleString()} coins in your inventory`, 'error')
      return
    }

    const newInv = [...inventory]
    newInv[slotIndex] = null
    newInv[targetIdx] = { itemId: resultId, quantity: 1 }
    if (cost > 0) removeItem(newInv, 'coins', cost)
    // Both ingredients leave holdings for good, and one of them is usually the
    // expensive half of the recipe — undeclared, forging a Slayer helmet reads
    // to the detector as a million gp evaporating (src/engine/lossLedger.js).
    // Built additively rather than as one literal: a recipe whose two halves are
    // the same item would collapse to a single key and under-declare.
    const combineSpend = { [slot.itemId]: 1 }
    combineSpend[targetId] = (combineSpend[targetId] || 0) + 1
    if (cost > 0) combineSpend.coins = (combineSpend.coins || 0) + cost
    recordItemLosses(combineSpend)
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

    const recipe = getChargeRecipe(item)
    const availableForId = (id) => inventory.reduce((sum, s) => sum + (s && s.itemId === id ? s.quantity : 0), 0)
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
        if (i === slotIndex) continue // never consume from the weapon's own slot
        if (newInv[i]?.itemId === r.itemId) {
          const take = Math.min(newInv[i].quantity, remaining)
          newInv[i] = { ...newInv[i], quantity: newInv[i].quantity - take }
          if (newInv[i].quantity <= 0) newInv[i] = null
          remaining -= take
        }
      }
    }

    const newSlot = { ...slot, charges: (slot.charges || 0) + actualQty }
    newInv[slotIndex] = newSlot

    recordItemLosses(chargeRecipeSpend(recipe, actualQty))
    updateInventory(newInv)
    setSelected({ ...selected, slot: newSlot })
    addToast(`Charged ${item.name} with ${actualQty} charge${actualQty === 1 ? '' : 's'}`, 'info')
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
    updateEquipment(newEquip)
    updateBank(newBank)

    const updatedSlot = { ...slot, charges: 0 }
    setSelected({ ...selected, slot: updatedSlot })
    const recoveredText = recovered.map(r => `${r.qty} ${itemsData[r.itemId]?.name || r.itemId}`).join(', ')
    addToast(`Uncharged ${item.name}, recovered ${recoveredText}`, 'info')
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
        // Every deposited copy carries its own charges, so the pool is summed
        // over the slots the loop above took, not read off the clicked one.
        const movedCharges = sumSlotCharges(inventory, slot.itemId, deposited)
        if (newBank[slot.itemId]) {
          newBank[slot.itemId] = { ...newBank[slot.itemId], quantity: newBank[slot.itemId].quantity + deposited }
          if (movedCharges > 0) {
            newBank[slot.itemId] = { ...newBank[slot.itemId], charges: (newBank[slot.itemId].charges || 0) + movedCharges }
          }
        } else {
          const bankEntry = { itemId: slot.itemId, quantity: deposited }
          if (movedCharges > 0) bankEntry.charges = movedCharges
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

    const currentSlot = inventory[selected.slotIndex]
    if (!currentSlot || currentSlot.itemId !== selected.slot.itemId) return

    const { item } = selected
    const defaultPrice = isIronman ? getIronmanShopValue(item) : Math.floor(Number(item.shopValue) || 0)
    const price = Math.floor(Number(overridePrice ?? defaultPrice) || 0)
    const isNoted = !!currentSlot.noted
    const ownedQty = (item.stackable || isNoted)
      ? currentSlot.quantity
      : inventory.reduce((n, s) => n + ((s && s.itemId === currentSlot.itemId && !!s.noted === isNoted) ? 1 : 0), 0)
    const sellQty = Math.max(1, Math.min(Number(qty) || 1, ownedQty))
    const totalValue = sellQty * price
    if (totalValue >= HIGH_VALUE_SELL_THRESHOLD) {
      setPendingHighValueSell({ qty, overridePrice, itemName: item.name, quantity: sellQty, totalValue })
      return
    }

    await executeSell(qty, overridePrice)
  }

  const executeSell = async (qty, overridePrice = null) => {
    if (!selected || sellBusy) return

    const currentSlot = inventory[selected.slotIndex]
    if (!currentSlot || currentSlot.itemId !== selected.slot.itemId) {
      addToast('Item no longer in inventory', 'error')
      setSelected(null)
      return
    }

    const { item } = selected
    const defaultPrice = isIronman ? getIronmanShopValue(item) : Math.floor(Number(item.shopValue) || 0)
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

  // Inventory is a positional 28-slot array persisted in the save blob, so
  // reordering is a plain swap of two slots — the new ordering rides the normal
  // /api/save path with no extra plumbing. (Drag mechanics live in InventoryGrid.)
  const moveItem = (fromIdx, toIdx) => {
    const newInv = [...inventory]
    const tmp = newInv[toIdx]
    newInv[toIdx] = newInv[fromIdx]
    newInv[fromIdx] = tmp
    updateInventory(newInv)
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
    <div class="forge-shell h-full overflow-y-auto p-4">
      <div class="flex justify-between items-center mb-3">
        <div class="flex items-center gap-2">
          <h2 class="font-[var(--font-display)] text-sm font-bold text-[var(--color-parchment)] opacity-60 uppercase tracking-wider">
            Inventory
          </h2>
        </div>
        <div class="flex items-center gap-2">
          <button
            onClick={handleDepositAll}
            class="fm-btn fm-btn--verdigris fm-btn--sm text-[10px] uppercase tracking-wider"
          >
            Deposit All
          </button>
          {/* Outside combat nothing else shows HP, so "should I eat?" was unanswerable. */}
          <span class={`inline-flex items-center gap-1 text-xs font-[var(--font-mono)] ${currentHP < getMaxHP()
            ? 'text-[var(--color-blood)] font-bold'
            : 'text-[var(--color-parchment)] opacity-40'}`}>
            <GameIcon iconKey={getSkillArt('hitpoints').icon} size={14} title="Hitpoints" />
            {currentHP}/{getMaxHP()}
          </span>
          <span class="text-xs font-[var(--font-mono)] text-[var(--color-parchment)] opacity-40">
            {free} free
          </span>
        </div>
      </div>

      <InventoryGrid
        inventory={inventory}
        onReorder={moveItem}
        onSlotClick={(s, item, i) => handleSlotClick(s, item, i)}
      />

      {/* Item action modal */}
      {selected && (
        <SharedItemModal item={selected.item} quantity={selected.slot.quantity} noted={selected.slot.noted} onClose={() => setSelected(null)}>
          <div class="space-y-2">
              {selected.item.scaleCharged && (
                <p class="mt-1">⚡ Charges: <span class="text-[var(--color-emerald)] font-bold">{selected.slot.charges || 0}</span></p>
              )}
            {/* Auto-bank exclusion toggle — excluded items stay in the inventory when a full inventory auto-banks during idle/offline play */}
            <button
              onClick={() => toggleAutoBankExclusion(selected.item.id)}
              class={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-semibold border ${autoBankExcludedItems.has(selected.item.id)
                ? 'bg-[var(--color-gold-dim)] text-white border-[var(--color-gold-dim)]'
                : 'bg-[var(--surface-sunken)] text-[var(--color-parchment)] opacity-70 border-[var(--hairline)]'}`}
            >
              <span>{autoBankExcludedItems.has(selected.item.id) ? '🔒 Excluded from auto-bank' : '🔓 Keep out of auto-bank'}</span>
              <span class="text-[10px] opacity-70">{autoBankExcludedItems.has(selected.item.id) ? 'ON' : 'OFF'}</span>
            </button>
            {/* Special attack info — shown for weapons with a spec */}
            {selected.item.specialAttack && (
              <div class="bg-[var(--surface-sunken)] rounded-lg border border-yellow-900 overflow-hidden">
                <button
                  onClick={() => setShowSpecInfo(v => !v)}
                  class="w-full flex items-center justify-between px-3 py-2 active:bg-[var(--surface-sunken)]"
                >
                  <span class="text-xs font-semibold text-yellow-400">⚡ Special Attack</span>
                  <span class="flex items-center gap-1 text-[10px] text-yellow-600">
                    <CollapseChevron expanded={showSpecInfo} />
                    {formatSpecialEnergyCostLabel(selected.item.specialAttack)}
                  </span>
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
                    class="fm-btn fm-btn--woad fm-btn--sm">
                    Equip
                  </button>
                )}
                {selected.item.type === 'food' && !selected.slot.noted && (
                  <button onClick={handleEat}
                    class="fm-btn fm-btn--verdigris fm-btn--sm">
                    Eat ({currentHP}/{getMaxHP()} HP)
                  </button>
                )}
                {selected.item.scaleCharged && !selected.slot.noted && (
                  <button onClick={() => setShowChargeModal(true)}
                    class="fm-btn fm-btn--verdigris fm-btn--sm">
                    Charge
                  </button>
                )}
                {selected.item.combineWith && !selected.slot.noted && (() => {
                  const targetData = itemsData[selected.item.combineWith]
                  const targetName = targetData?.name || selected.item.combineWith
                  const hasTarget = inventory.some(
                    (s, i) => s && i !== selected.slotIndex && s.itemId === selected.item.combineWith && !s.noted
                  )
                  const cost = Number(selected.item.combineCost) || 0
                  const canAfford = cost <= 0 || countItem(inventory, 'coins') >= cost
                  const enabled = hasTarget && canAfford
                  return (
                    <button
                      onClick={handleCombine}
                      disabled={!enabled}
                      class={`fm-btn fm-btn--sm ${enabled ? 'fm-btn--royal' : ''}`}
                    >
                      Use on {targetName}{cost > 0 ? ` (${cost.toLocaleString()} coins)` : ''}
                    </button>
                  )
                })()}
                {selected.item.breakdownResult && !selected.slot.noted && (
                  <button onClick={handleBreakdown}
                    class="fm-btn fm-btn--royal fm-btn--sm">
                    Break down
                  </button>
                )}
                <button onClick={handleDrop}
                  class="fm-btn fm-btn--blood fm-btn--sm">
                  Drop
                </button>
              </div>
              {selected.item.scaleCharged && !selected.slot.noted && (selected.slot.charges || 0) > 0 && (
                <button onClick={handleUnchargeWeapon}
                  class="fm-btn fm-btn--ghost fm-btn--sm w-full text-[var(--fm-blood)]">
                  Uncharge ({selected.slot.charges} charge{selected.slot.charges === 1 ? '' : 's'})
                </button>
              )}
            </div>

            {/* Bank deposit section */}
            <div class="border-t border-[var(--hairline)] pt-2 mt-1">
              <p class="text-[10px] text-[var(--color-parchment)] opacity-40 mb-1.5 uppercase tracking-wider font-bold">Bank</p>
              {(selected.item.stackable || selected.slot.noted) ? (
                <div>
                  <div class="grid grid-cols-3 gap-2 mb-2">
                    {[1, 5, 10].map(qty => (
                      <button key={qty} onClick={() => handleDeposit(qty)}
                        disabled={selected.slot.quantity < qty}
                        class="fm-btn fm-btn--verdigris fm-btn--sm">
                        Bank {qty}
                      </button>
                    ))}
                  </div>
                  <div class="grid grid-cols-2 gap-2">
                    <button onClick={() => handleDeposit()}
                      class="fm-btn fm-btn--verdigris fm-btn--sm">
                      Bank All
                    </button>
                    <button onClick={() => {
                      setBankQuantityMode('stackable')
                      setBankQuantityInput('')
                    }}
                      class="fm-btn fm-btn--verdigris fm-btn--sm">
                      Bank X
                    </button>
                  </div>
                </div>
              ) : (
                <div>
                  <div class="grid grid-cols-3 gap-2 mb-2">
                    <button onClick={() => handleDeposit(1)}
                      class="fm-btn fm-btn--verdigris fm-btn--sm">
                      Bank 1
                    </button>
                    {sameItemCount >= 3 && (
                      <button onClick={() => handleDeposit(5)}
                        class="fm-btn fm-btn--verdigris fm-btn--sm">
                        Bank 5
                      </button>
                    )}
                    {sameItemCount >= 10 && (
                      <button onClick={() => handleDeposit(10)}
                        class="fm-btn fm-btn--verdigris fm-btn--sm">
                        Bank 10
                      </button>
                    )}
                  </div>
                  {sameItemCount > 1 && (
                    <div class="grid grid-cols-2 gap-2">
                      <button onClick={() => handleDeposit(sameItemCount)}
                        class="fm-btn fm-btn--verdigris fm-btn--sm">
                        Bank All
                      </button>
                      <button onClick={() => {
                        setBankQuantityMode('nonStackable')
                        setBankQuantityInput('')
                      }}
                        class="fm-btn fm-btn--verdigris fm-btn--sm">
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
              // Ironmen vendor at the reduced Ironman value; everyone else at shopValue.
              const sellUnit = isIronman ? getIronmanShopValue(selected.item) : selected.item.shopValue
              return (
              <div class="border-t border-[var(--hairline)] pt-2 mt-1">
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
                        class="fm-btn fm-btn--brass fm-btn--sm">
                        Sell {qty} ({qty * sellUnit}gp)
                      </button>
                    ))}
                    <button onClick={() => handleSell(selected.slot.quantity)}
                      disabled={sellBusy}
                      class="fm-btn fm-btn--brass fm-btn--sm col-span-3">
                      Sell All ({selected.slot.quantity * sellUnit} gp)
                    </button>
                  </div>
                ) : useQuickSell ? (
                  <div class="grid grid-cols-3 gap-2">
                    <button onClick={() => handleSell(1)}
                      disabled={sellBusy}
                      class="fm-btn fm-btn--brass fm-btn--sm">
                      Sell 1 ({sellUnit}gp)
                    </button>
                    {sameItemCount >= 3 && (
                      <button onClick={() => handleSell(5)}
                        disabled={sellBusy}
                        class="fm-btn fm-btn--brass fm-btn--sm">
                        Sell 5
                      </button>
                    )}
                    {sameItemCount >= 10 && (
                      <button onClick={() => handleSell(10)}
                        disabled={sellBusy}
                        class="fm-btn fm-btn--brass fm-btn--sm">
                        Sell 10
                      </button>
                    )}
                    {sameItemCount > 1 && (
                      <button onClick={() => handleSell(sameItemCount)}
                        disabled={sellBusy}
                        class={`fm-btn fm-btn--brass fm-btn--sm ${sameItemCount >= 10 ? 'col-span-3' : sameItemCount >= 3 ? 'col-span-1' : 'col-span-2'}`}>
                        Sell All ({sameItemCount * sellUnit}gp)
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
                  class="w-full bg-[var(--surface-sunken)] border border-[var(--hairline)] rounded-lg px-3 py-2 text-sm text-[var(--color-parchment)] outline-none focus:border-[var(--color-gold)]"
                  autoFocus
                />
              </div>
              <button
                onClick={handleBankQuantitySubmit}
                disabled={!bankQuantityInput || isNaN(parseInt(bankQuantityInput, 10)) || parseInt(bankQuantityInput, 10) <= 0}
                class="fm-btn fm-btn--verdigris fm-btn--sm w-full"
              >
                Bank {bankQuantityInput || '0'}
              </button>
            </div>
          </Modal>
        )
      })()}

      {/* ── Charge weapon modal (shared panel — same UI as Equipment) ──── */}
      {showChargeModal && selected && (
        <Modal title={`Charge ${selected.item.name}`} onClose={() => setShowChargeModal(false)}>
          <WeaponChargePanel
            item={selected.item}
            currentCharges={selected.slot.charges || 0}
            inventory={inventory}
            itemsData={itemsData}
            onCharge={handleChargeWeapon}
            onUncharge={handleUnchargeWeapon}
          />
        </Modal>
      )}

      {pendingHighValueSell && (
        <SellConfirmModal
          itemName={pendingHighValueSell.itemName}
          quantity={pendingHighValueSell.quantity}
          totalValue={pendingHighValueSell.totalValue}
          busy={sellBusy}
          onCancel={() => setPendingHighValueSell(null)}
          onConfirm={async () => {
            const { qty, overridePrice } = pendingHighValueSell
            setPendingHighValueSell(null)
            await executeSell(qty, overridePrice)
          }}
        />
      )}

      {showBreakdownConfirm && selected && (() => {
        const y = getBreakdownYield(selected.item)
        return (
          <Modal title="Break down item?" onClose={() => setShowBreakdownConfirm(false)}>
            <div class="space-y-4">
              <p class="text-sm text-[var(--color-parchment)] opacity-80">
                Break down <span class="font-bold text-[var(--color-gold)]">{selected.item.name}</span> into <span class="font-bold text-[var(--color-gold)]">{(y?.qty || 0).toLocaleString()} {itemsData[y?.itemId]?.name || y?.itemId}</span>? The item is destroyed permanently.
              </p>
              <div class="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setShowBreakdownConfirm(false)}
                  class="fm-btn fm-btn--sm"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmBreakdown}
                  class="fm-btn fm-btn--royal fm-btn--sm"
                >
                  Break down
                </button>
              </div>
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
                class="fm-btn fm-btn--sm"
              >
                Cancel
              </button>
              <button
                onClick={confirmDrop}
                class="fm-btn fm-btn--blood fm-btn--sm"
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
