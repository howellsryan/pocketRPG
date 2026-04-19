import { useState } from 'preact/hooks'
import { useGame } from '../state/gameState.jsx'
import { countItem, removeItem, freeSlots } from '../engine/inventory.js'
import Modal from '../components/Modal.jsx'
import Panel from '../components/Panel.jsx'
import Button from '../components/Button.jsx'

// ── COMPONENT ───────────────────────────────────────────────────────────────
export default function GeneralStoreScreen() {
  const { inventory, bank, updateInventory, updateBankDirect, addToast, itemsData, unlockedFeatures, completedQuests } = useGame()
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedItem, setSelectedItem] = useState(null) // item being purchased
  const [buyQty, setBuyQty] = useState(1)
  const [activeTab, setActiveTab] = useState('general') // 'general' | 'quest'

  const hasMoneyPurse = unlockedFeatures.has('money_purse')
  const coinsInInv = countItem(inventory, 'coins')
  const coinsInBank = bank['coins']?.quantity || 0
  const coins = hasMoneyPurse ? coinsInInv + coinsInBank : coinsInInv

  const getAvailableItems = () => {
    if (activeTab === 'quest') {
      return Object.entries(itemsData)
        .filter(([_, item]) => item.isUntradeable && item.questUnlock && completedQuests.has(item.questUnlock))
        .map(([id, item]) => ({ ...item, id }))
    }
    return Object.entries(itemsData)
      .filter(([_, item]) => !item.isUntradeable)
      .map(([id, item]) => ({ ...item, id }))
  }

  const getSearchResults = () => {
    const available = getAvailableItems()
    if (!searchTerm.trim()) return available
    const lower = searchTerm.toLowerCase()
    return available.filter(item => item.name.toLowerCase().includes(lower))
  }

  const modifiedPrice = (basePrice) => Math.floor(basePrice * 1.1)

  const handleBuy = () => {
    if (!selectedItem) return

    const price = modifiedPrice(selectedItem.shopValue)
    const totalCost = price * buyQty

    if (coins < totalCost) {
      addToast(`Need ${totalCost.toLocaleString()} coins — you have ${coins.toLocaleString()}.`, 'error')
      return
    }

    const newInv = [...inventory]

    if (buyQty > 1) {
      const existing = newInv.findIndex(s => s && s.itemId === selectedItem.id && s.noted)
      if (existing !== -1) {
        newInv[existing] = { ...newInv[existing], quantity: newInv[existing].quantity + buyQty }
      } else {
        const empty = newInv.indexOf(null)
        if (empty === -1) {
          addToast('Not enough inventory space.', 'error')
          return
        }
        newInv[empty] = { itemId: selectedItem.id, quantity: buyQty, noted: true }
      }
    } else {
      if (selectedItem.stackable) {
        const existing = newInv.findIndex(s => s && s.itemId === selectedItem.id && !s.noted)
        if (existing !== -1) {
          newInv[existing] = { ...newInv[existing], quantity: newInv[existing].quantity + 1 }
        } else {
          const empty = newInv.indexOf(null)
          if (empty === -1) {
            addToast('Not enough inventory space.', 'error')
            return
          }
          newInv[empty] = { itemId: selectedItem.id, quantity: 1 }
        }
      } else {
        const empty = newInv.indexOf(null)
        if (empty === -1) {
          addToast('Not enough inventory space.', 'error')
          return
        }
        newInv[empty] = { itemId: selectedItem.id, quantity: 1 }
      }
    }

    const fromInv = Math.min(coinsInInv, totalCost)
    if (fromInv > 0) removeItem(newInv, 'coins', fromInv)
    const fromBank = totalCost - fromInv
    if (fromBank > 0 && hasMoneyPurse) updateBankDirect({ coins: -fromBank })
    updateInventory(newInv)

    addToast(`${selectedItem.icon || '📦'} ${selectedItem.name} ${buyQty > 1 ? `×${buyQty}` : ''} purchased!`, 'success')
    setSelectedItem(null)
    setBuyQty(1)
  }

  const searchResults = getSearchResults()
  const totalCost = selectedItem ? modifiedPrice(selectedItem.shopValue) * buyQty : 0
  const canAffordSelected = selectedItem ? coins >= totalCost : false

  return (
    <div class="h-full flex flex-col overflow-hidden">
      {/* ── HEADER ── */}
      <div class="px-4 pt-3 pb-3 flex-shrink-0">
        <div class="flex justify-between items-baseline mb-3">
          <h2 class="font-[var(--font-display)] text-[15px] font-bold text-[var(--color-gold)] m-0">
            {activeTab === 'quest' ? 'Quest Shop' : 'General Store'}
          </h2>
          <span class="text-[11px] text-[var(--color-gold)] font-[var(--font-mono)]">
            🪙 {coins.toLocaleString()}
          </span>
        </div>

        {/* ── TAB SWITCHER ── */}
        <div class="flex gap-2 mb-3">
          <button
            onClick={() => { setActiveTab('general'); setSearchTerm('') }}
            class={`px-3 py-[5px] rounded-[20px] text-[11px] font-semibold border ${
              activeTab === 'general'
                ? 'border-[var(--color-gold)] bg-[rgba(212,175,55,0.15)] text-[var(--color-gold)]'
                : 'border-[#2a2a2a] bg-[var(--color-void-light)] text-[var(--color-parchment)] opacity-60'
            }`}
          >
            🪙 General
          </button>
          <button
            onClick={() => { setActiveTab('quest'); setSearchTerm('') }}
            class={`px-3 py-[5px] rounded-[20px] text-[11px] font-semibold border ${
              activeTab === 'quest'
                ? 'border-[var(--color-gold)] bg-[rgba(212,175,55,0.15)] text-[var(--color-gold)]'
                : 'border-[#2a2a2a] bg-[var(--color-void-light)] text-[var(--color-parchment)] opacity-60'
            }`}
          >
            📜 Quest Shop
          </button>
        </div>

        {/* ── SEARCH INPUT ── */}
        <input
          type="text"
          placeholder="Search items..."
          value={searchTerm}
          onInput={(e) => setSearchTerm(e.target.value)}
          class="w-full px-3 py-2 rounded-lg border border-[#2a2a2a] bg-[#111] text-[var(--color-parchment)] text-[13px] outline-none"
        />
      </div>

      {/* ── SEARCH RESULTS ── */}
      <div class="flex-1 overflow-y-auto px-4 pb-20">
        {searchResults.length === 0 ? (
          <div class="py-10 px-4 text-center text-[#888] text-[12px]">
            {searchTerm
              ? 'No items found.'
              : activeTab === 'quest'
                ? 'Complete quests to unlock special items here.'
                : 'Search for items to buy.'}
          </div>
        ) : (
          <div class="flex flex-col gap-2 pt-3">
            {searchResults.map(item => {
              const price = modifiedPrice(item.shopValue)
              const canAfford = coins >= price

              return (
                <button
                  key={item.id}
                  onClick={() => { setSelectedItem(item); setBuyQty(1) }}
                  class="p-3 rounded-lg bg-[var(--color-void-light)] border border-[#2a2a2a] text-left flex items-center gap-3 cursor-pointer transition-colors hover:bg-[#222] hover:border-[#333]"
                >
                  <span class="text-2xl leading-none flex-shrink-0">{item.icon || '📦'}</span>
                  <div class="flex-1 min-w-0">
                    <div class="text-[13px] font-semibold text-[var(--color-parchment)]">{item.name}</div>
                  </div>
                  <div class={`text-right flex-shrink-0 text-[12px] font-[var(--font-mono)] font-bold ${canAfford ? 'text-[var(--color-gold)]' : 'text-[#888]'}`}>
                    {price.toLocaleString()} gp
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* ── PURCHASE MODAL ── */}
      {selectedItem && (
        <Modal
          title={`Buy ${selectedItem.name}`}
          onClose={() => { setSelectedItem(null); setBuyQty(1) }}
        >
          <div class="flex flex-col gap-4">
            {/* Item preview */}
            <Panel className="flex items-center gap-3">
              <span class="text-[32px]">{selectedItem.icon || '📦'}</span>
              <div>
                <div class="text-[13px] font-semibold text-[var(--color-parchment)]">{selectedItem.name}</div>
                <div class="text-[11px] text-[#888] mt-[2px]">{selectedItem.type}</div>
              </div>
            </Panel>

            {/* Price info */}
            <Panel>
              <div class="flex justify-between mb-[6px] text-[12px]">
                <span class="text-[#888]">Price per item:</span>
                <span class="text-[var(--color-gold)] font-[var(--font-mono)] font-bold">
                  {modifiedPrice(selectedItem.shopValue).toLocaleString()} gp
                </span>
              </div>
              <div class="flex justify-between text-[12px]">
                <span class="text-[#888]">Total:</span>
                <span class="text-[var(--color-gold)] font-[var(--font-mono)] font-bold">
                  {totalCost.toLocaleString()} gp
                </span>
              </div>
            </Panel>

            {/* Quantity selector */}
            <div class="flex flex-col gap-2">
              <div class="text-[12px] text-[#888]">Quantity</div>
              <div class="flex gap-[6px] items-center">
                <Button variant="secondary" size="md" onClick={() => setBuyQty(Math.max(1, buyQty - 1))} className="w-8 h-8 p-0 flex items-center justify-center text-base">−</Button>
                <input
                  type="number"
                  min="1"
                  max={Number.MAX_SAFE_INTEGER}
                  value={buyQty}
                  onInput={(e) => {
                    const val = Math.max(1, Math.min(Number.MAX_SAFE_INTEGER, parseInt(e.target.value) || 1))
                    setBuyQty(val)
                  }}
                  class="flex-1 h-8 rounded-md bg-[#111] border border-[var(--color-void-border)] text-[var(--color-parchment)] text-[13px] font-[var(--font-mono)] text-center outline-none"
                />
                <Button variant="secondary" size="md" onClick={() => setBuyQty(Math.min(Number.MAX_SAFE_INTEGER, buyQty + 1))} className="w-8 h-8 p-0 flex items-center justify-center text-base">+</Button>
              </div>
              {buyQty > 1 && (
                <div class="text-[10px] text-[#888] mt-1">
                  💡 Buying {buyQty} items will be delivered as noted (stackable)
                </div>
              )}
            </div>

            {/* Buttons */}
            <div class="flex gap-2 mt-2">
              <Button variant="secondary" size="lg" onClick={() => { setSelectedItem(null); setBuyQty(1) }} className="flex-1">
                Cancel
              </Button>
              <Button variant="primary" size="lg" onClick={handleBuy} disabled={!canAffordSelected} className="flex-1">
                Buy
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
