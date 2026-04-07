import { useState } from 'preact/hooks'
import { useGame } from '../state/gameState.jsx'
import Modal from '../components/Modal.jsx'

export default function BankScreen() {
  const { bank, inventory, updateBank, updateInventory, addToast, itemsData } = useGame()
  const [selected, setSelected] = useState(null)

  const bankItems = Object.values(bank).filter(b => b && b.quantity > 0)

  const handleWithdraw = (itemId, qty = 1, asNote = false) => {
    const bankEntry = bank[itemId]
    if (!bankEntry || bankEntry.quantity < qty) return

    const item = itemsData[itemId]
    const newInv = [...inventory]
    let actualWithdrawn = 0

    if (item?.stackable || asNote) {
      // Stackable items and noted items stack in one slot
      const matchFn = asNote
        ? (s) => s && s.itemId === itemId && s.noted
        : (s) => s && s.itemId === itemId && !s.noted
      const existing = newInv.findIndex(matchFn)
      if (existing !== -1) {
        newInv[existing] = { ...newInv[existing], quantity: newInv[existing].quantity + qty }
        actualWithdrawn = qty
      } else {
        const empty = newInv.indexOf(null)
        if (empty === -1) { addToast('Inventory full', 'error'); return }
        const slot = { itemId, quantity: qty }
        if (asNote) slot.noted = true
        newInv[empty] = slot
        actualWithdrawn = qty
      }
    } else {
      for (let i = 0; i < qty; i++) {
        const empty = newInv.indexOf(null)
        if (empty === -1) break
        newInv[empty] = { itemId, quantity: 1 }
        actualWithdrawn++
      }
      if (actualWithdrawn === 0) { addToast('Inventory full', 'error'); return }
    }

    const newBank = { ...bank }
    newBank[itemId] = { ...bankEntry, quantity: bankEntry.quantity - actualWithdrawn }
    if (newBank[itemId].quantity <= 0) delete newBank[itemId]

    updateInventory(newInv)
    updateBank(newBank)
    setSelected(null)
  }

  return (
    <div class="h-full overflow-y-auto p-4">
      <h2 class="font-[var(--font-display)] text-sm font-bold text-[var(--color-parchment)] opacity-60 uppercase tracking-wider mb-3">
        Bank ({bankItems.length})
      </h2>

      {bankItems.length === 0 ? (
        <div class="text-center py-12 text-[var(--color-parchment)] opacity-30 text-sm">
          Your bank is empty
        </div>
      ) : (
        <div class="grid grid-cols-4 gap-2">
          {bankItems.map(entry => {
            const item = itemsData[entry.itemId]
            if (!item) return null
            const emoji = item.icon || '📦'
            return (
              <button
                key={entry.itemId}
                onClick={() => setSelected(entry)}
                class="flex flex-col items-center p-2 rounded-lg bg-[#1a1a1a] border border-[#2a2a2a] active:bg-[#222]"
              >
                <span class="text-lg">{emoji}</span>
                <span class="text-[8px] text-[var(--color-parchment)] opacity-60 truncate w-full text-center">{item.name}</span>
                <span class="text-[9px] font-[var(--font-mono)] font-bold text-[var(--color-gold)]">×{entry.quantity}</span>
              </button>
            )
          })}
        </div>
      )}

      {/* Withdraw modal */}
      {selected && (() => {
        const selItem = itemsData[selected.itemId]
        const isStackable = selItem?.stackable
        return (
        <Modal title={selItem?.name || selected.itemId} onClose={() => setSelected(null)}>
          <div class="space-y-3">
            <div class="text-center text-sm text-[var(--color-parchment)] opacity-60">
              In bank: <span class="font-[var(--font-mono)] text-[var(--color-gold)]">{selected.quantity}</span>
            </div>
            <div class="grid grid-cols-3 gap-2">
              {[1, 5, 10].map(qty => (
                <button
                  key={qty}
                  onClick={() => handleWithdraw(selected.itemId, Math.min(qty, selected.quantity))}
                  class="py-2.5 rounded-lg bg-[var(--color-mana)] text-white font-semibold text-sm active:opacity-80"
                >
                  Take {qty}
                </button>
              ))}
              <button
                onClick={() => handleWithdraw(selected.itemId, selected.quantity)}
                class="py-2.5 rounded-lg bg-[var(--color-gold-dim)] text-white font-semibold text-sm active:opacity-80 col-span-3"
              >
                Take All ({selected.quantity})
              </button>
            </div>

            {/* Withdraw as Note — only for non-stackable items */}
            {!isStackable && (
              <div class="border-t border-[#333] pt-2 mt-1">
                <p class="text-[10px] text-[var(--color-parchment)] opacity-40 mb-1.5 uppercase tracking-wider font-bold">Withdraw as Note</p>
                <div class="grid grid-cols-3 gap-2">
                  {[1, 5, 10].map(qty => (
                    <button
                      key={qty}
                      onClick={() => handleWithdraw(selected.itemId, Math.min(qty, selected.quantity), true)}
                      class="py-2 rounded-lg bg-[var(--color-emerald-mid)] text-white font-semibold text-sm active:opacity-80"
                    >
                      Note {qty}
                    </button>
                  ))}
                  <button
                    onClick={() => handleWithdraw(selected.itemId, selected.quantity, true)}
                    class="py-2 rounded-lg bg-[var(--color-emerald)] text-white font-semibold text-sm active:opacity-80 col-span-3"
                  >
                    Note All ({selected.quantity})
                  </button>
                </div>
              </div>
            )}
          </div>
        </Modal>
        )
      })()}
    </div>
  )
}
