import { useState } from 'preact/hooks'
import { useGame } from '../state/gameState.jsx'
import ItemSlot from '../components/ItemSlot.jsx'
import Modal from '../components/Modal.jsx'
import { freeSlots, countItem } from '../engine/inventory.js'
import { equipItem } from '../engine/equipment.js'
import { getLevelFromXP } from '../engine/experience.js'

export default function InventoryScreen() {
  const { inventory, equipment, stats, bank, updateInventory, updateEquipment, updateBank, updateHP, currentHP, getMaxHP, addToast, itemsData } = useGame()
  const [selected, setSelected] = useState(null) // { slotIndex, slot, item }
  const [showSpecInfo, setShowSpecInfo] = useState(false)
  const [bankQuantityMode, setBankQuantityMode] = useState(null) // 'stackable' | 'nonStackable' | null
  const [bankQuantityInput, setBankQuantityInput] = useState('')
  const [chargeInput, setChargeInput] = useState('')
  const [showChargeModal, setShowChargeModal] = useState(false)

  const handleSlotClick = (slot, item, index) => {
    const idx = inventory.indexOf(slot)
    setSelected({ slotIndex: idx >= 0 ? idx : index, slot, item })
    setShowSpecInfo(false)
  }

  const handleEquip = () => {
    if (!selected) return
    const { slotIndex, item } = selected

    if (item.requirements) {
      for (const [skill, level] of Object.entries(item.requirements)) {
        const playerLevel = stats[skill] ? getLevelFromXP(stats[skill].xp) : 1
        if (playerLevel < level) {
          addToast(`Need ${skill} level ${level} to equip`, 'error')
          setSelected(null)
          return
        }
      }
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
          const invEntry = { itemId: unequipped.itemId, quantity: 1 }
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
    const newInv = [...inventory]
    newInv[selected.slotIndex] = null
    updateInventory(newInv)
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

    // Find Zulrah scales in inventory
    const scalesIdx = inventory.findIndex(s => s && s.itemId === 'zulrah_scales')
    if (scalesIdx === -1) {
      addToast('No Zulrah scales in inventory', 'error')
      return
    }

    const scales = inventory[scalesIdx]
    const chargeQty = Math.min(qty, scales.quantity)
    const newInv = [...inventory]
    const newSlot = { ...slot, charges: (slot.charges || 0) + chargeQty }
    newInv[slotIndex] = newSlot

    // Remove scales from inventory
    if (scales.quantity <= chargeQty) {
      newInv[scalesIdx] = null
    } else {
      newInv[scalesIdx] = { ...scales, quantity: scales.quantity - chargeQty }
    }

    updateInventory(newInv)
    setSelected({ ...selected, slot: newSlot })
    addToast(`Charged ${item.name} with ${chargeQty} scales (${newSlot.charges} total)`, 'info')
    setShowChargeModal(false)
    setChargeInput('')
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
      } else {
        newBank[slot.itemId] = { itemId: slot.itemId, quantity: actualQty }
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
      // Non-stackable: deposit qty of same itemId across inventory
      const depositQty = qty || 1
      const newBank = { ...bank }
      const newInv = [...inventory]
      let deposited = 0
      for (let i = 0; i < newInv.length && deposited < depositQty; i++) {
        if (newInv[i] && newInv[i].itemId === slot.itemId) {
          newInv[i] = null
          deposited++
        }
      }
      if (deposited > 0) {
        if (newBank[slot.itemId]) {
          newBank[slot.itemId] = { ...newBank[slot.itemId], quantity: newBank[slot.itemId].quantity + deposited }
        } else {
          newBank[slot.itemId] = { itemId: slot.itemId, quantity: deposited }
        }
        updateInventory(newInv)
        updateBank(newBank)
      }
      setSelected(null)
    }
  }

  const handleSell = (qty) => {
    if (!selected) return
    const { slot, item } = selected
    const price = item.shopValue || 0
    if (price <= 0) {
      addToast('This item has no value', 'error')
      setSelected(null)
      return
    }

    const newInv = [...inventory]

    if (item.stackable || slot.noted) {
      const actualQty = Math.min(qty, slot.quantity)
      const idx = newInv.findIndex(s => s && s.itemId === slot.itemId)
      if (idx === -1) return
      if (newInv[idx].quantity <= actualQty) {
        newInv[idx] = null
      } else {
        newInv[idx] = { ...newInv[idx], quantity: newInv[idx].quantity - actualQty }
      }
      // Add coins
      const totalGold = price * actualQty
      const coinIdx = newInv.findIndex(s => s && s.itemId === 'coins')
      if (coinIdx !== -1) {
        newInv[coinIdx] = { ...newInv[coinIdx], quantity: newInv[coinIdx].quantity + totalGold }
      } else {
        const empty = newInv.indexOf(null)
        if (empty !== -1) newInv[empty] = { itemId: 'coins', quantity: totalGold }
      }
      updateInventory(newInv)
      addToast(`Sold ${actualQty} × ${item.name} for ${totalGold} gp`, 'info')
    } else {
      // Non-stackable: sell qty across inventory
      const sellQty = qty || 1
      let sold = 0
      for (let i = 0; i < newInv.length && sold < sellQty; i++) {
        if (newInv[i] && newInv[i].itemId === slot.itemId) {
          newInv[i] = null
          sold++
        }
      }
      if (sold > 0) {
        const totalGold = price * sold
        const coinIdx = newInv.findIndex(s => s && s.itemId === 'coins')
        if (coinIdx !== -1) {
          newInv[coinIdx] = { ...newInv[coinIdx], quantity: newInv[coinIdx].quantity + totalGold }
        } else {
          const empty = newInv.indexOf(null)
          if (empty !== -1) newInv[empty] = { itemId: 'coins', quantity: totalGold }
        }
        updateInventory(newInv)
        addToast(`Sold ${sold} × ${item.name} for ${totalGold} gp`, 'info')
      }
    }
    setSelected(null)
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
      const { itemId, quantity } = slot
      if (newBank[itemId]) {
        newBank[itemId] = { ...newBank[itemId], quantity: newBank[itemId].quantity + quantity }
      } else {
        newBank[itemId] = { itemId, quantity }
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

      <div class="grid grid-cols-4 gap-2 justify-items-center">
        {inventory.map((slot, i) => (
          <ItemSlot
            key={i}
            slot={slot}
            onClick={(s, item) => handleSlotClick(s, item, i)}
            showName
          />
        ))}
      </div>

      {/* Item action modal */}
      {selected && (
        <Modal title={selected.item.name} onClose={() => setSelected(null)}>
          <div class="space-y-2">
            {/* Item info */}
            <div class="bg-[#111] rounded-lg p-3 text-sm text-[var(--color-parchment)] opacity-70">
              {selected.slot.noted && (
                <p style={{ color: '#d4a017', fontWeight: '600', marginBottom: '4px' }}>📜 Noted — cannot be used</p>
              )}
              {selected.item.type === 'food' && <p>Heals {selected.item.heals} HP</p>}
              {selected.item.type === 'weapon' && (
                <div class="space-y-1">
                  <p>Attack speed: {selected.item.attackSpeed} ticks</p>
                  <p>Style: {selected.item.attackStyle}</p>
                  {selected.item.otherBonus?.meleeStrength > 0 && <p>Strength bonus: +{selected.item.otherBonus.meleeStrength}</p>}
                  {selected.item.scaleCharged && (
                    <p class="mt-1">⚡ Charges: <span class="text-[var(--color-emerald)] font-bold">{selected.slot.charges || 0}</span></p>
                  )}
                </div>
              )}
              {selected.item.requirements && Object.entries(selected.item.requirements).length > 0 && (
                <p class="mt-1">Requires: {Object.entries(selected.item.requirements).map(([s, l]) => `${s} ${l}`).join(', ')}</p>
              )}
              {selected.slot.quantity > 1 && <p>Quantity: {selected.slot.quantity}</p>}
              {selected.item.shopValue > 0 && (
                <p class="mt-1">Value: <span class="text-[var(--color-gold)]">{selected.item.shopValue} gp</span></p>
              )}
            </div>

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
              <button onClick={handleDrop}
                class="py-2.5 rounded-lg bg-[var(--color-blood-mid)] text-white font-semibold text-sm active:opacity-80">
                Drop
              </button>
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
                    {sameItemCount >= 5 && (
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
            {selected.item.shopValue > 0 && selected.item.type !== 'currency' && (
              <div class="border-t border-[#333] pt-2 mt-1">
                <p class="text-[10px] text-[var(--color-parchment)] opacity-40 mb-1.5 uppercase tracking-wider font-bold">Sell</p>
                {(selected.item.stackable || selected.slot.noted) ? (
                  <div class="grid grid-cols-3 gap-2">
                    {[1, 5, 10].map(qty => (
                      <button key={qty} onClick={() => handleSell(qty)}
                        disabled={selected.slot.quantity < qty}
                        class={`py-2 rounded-lg text-white font-semibold text-sm ${selected.slot.quantity < qty ? 'bg-[#222] opacity-30' : 'bg-[var(--color-gold-dim)] active:opacity-80'}`}>
                        Sell {qty} ({qty * selected.item.shopValue}gp)
                      </button>
                    ))}
                    <button onClick={() => handleSell(selected.slot.quantity)}
                      class="py-2 rounded-lg bg-[var(--color-gold-dim)] text-white font-semibold text-sm active:opacity-80 col-span-3">
                      Sell All ({selected.slot.quantity * selected.item.shopValue} gp)
                    </button>
                  </div>
                ) : (
                  <div class="grid grid-cols-3 gap-2">
                    <button onClick={() => handleSell(1)}
                      class="py-2 rounded-lg bg-[var(--color-gold-dim)] text-white font-semibold text-sm active:opacity-80">
                      Sell 1 ({selected.item.shopValue}gp)
                    </button>
                    {sameItemCount >= 5 && (
                      <button onClick={() => handleSell(5)}
                        class="py-2 rounded-lg bg-[var(--color-gold-dim)] text-white font-semibold text-sm active:opacity-80">
                        Sell 5
                      </button>
                    )}
                    {sameItemCount >= 10 && (
                      <button onClick={() => handleSell(10)}
                        class="py-2 rounded-lg bg-[var(--color-gold-dim)] text-white font-semibold text-sm active:opacity-80">
                        Sell 10
                      </button>
                    )}
                    {sameItemCount > 1 && (
                      <button onClick={() => handleSell(sameItemCount)}
                        class={`py-2 rounded-lg bg-[var(--color-gold-dim)] text-white font-semibold text-sm active:opacity-80 ${sameItemCount >= 10 ? 'col-span-3' : sameItemCount >= 5 ? 'col-span-1' : 'col-span-2'}`}>
                        Sell All ({sameItemCount * selected.item.shopValue}gp)
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </Modal>
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
        const scalesInInv = inventory.find(s => s && s.itemId === 'zulrah_scales')
        const availableScales = scalesInInv?.quantity || 0
        const currentCharges = selected.slot.charges || 0

        return (
          <Modal title={`Charge ${selected.item.name}`} onClose={() => { setShowChargeModal(false); setChargeInput('') }}>
            <div class="space-y-3">
              <div class="bg-[#111] rounded-lg p-3 text-sm text-[var(--color-parchment)] opacity-70">
                <p>Current charges: <span class="text-[var(--color-emerald)] font-bold">{currentCharges}</span></p>
                <p>Scales available: <span class="text-[var(--color-gold)] font-bold">{availableScales}</span></p>
              </div>
              <div>
                <p class="text-[10px] text-[var(--color-parchment)] opacity-40 mb-1 uppercase tracking-wider">Add scales</p>
                <input
                  type="number"
                  value={chargeInput}
                  onInput={(e) => setChargeInput(e.target.value)}
                  min="1"
                  max={availableScales}
                  placeholder="Enter scales to add"
                  class="w-full bg-[#1a1a1a] border border-[#333] rounded-lg px-3 py-2 text-sm text-[var(--color-parchment)] outline-none focus:border-[var(--color-emerald)]"
                  autoFocus
                />
              </div>
              {availableScales === 0 && (
                <p class="text-[10px] text-[var(--color-blood)] text-center">You need Zulrah scales to charge this weapon</p>
              )}
              <button
                onClick={() => handleChargeWeapon(parseInt(chargeInput, 10))}
                disabled={availableScales === 0 || !chargeInput || isNaN(parseInt(chargeInput, 10)) || parseInt(chargeInput, 10) <= 0}
                class="w-full py-2.5 rounded-lg bg-[#1a3a3a] text-[var(--color-emerald)] font-semibold text-sm active:opacity-80 border border-[var(--color-emerald)]/30 disabled:opacity-40 disabled:cursor-default"
              >
                Add {chargeInput || '0'} Scales
              </button>
            </div>
          </Modal>
        )
      })()}
    </div>
  )
}
