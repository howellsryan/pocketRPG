import { useState } from 'preact/hooks'
import { useGame } from '../state/gameState.jsx'
import { countItem, removeItem, freeSlots } from '../engine/inventory.js'
import { api, getToken, getCharacterId } from '../cloud/api.js'
import { getStoreItemTypes, isStoreVisibleItem, getPurchaseRestriction } from '../engine/storeRules.js'
import Modal from '../components/Modal.jsx'
import Panel from '../components/Panel.jsx'
import Button from '../components/Button.jsx'
import questsData from '../data/quests.json'
import { requestCriticalPushSave } from '../cloud/sync.js'
import { CRITICAL_SAVE_REASONS } from '../cloud/criticalSavePolicy.js'

// ── COMPONENT ───────────────────────────────────────────────────────────────
export default function GeneralStoreScreen({ onBuyCredits }) {
  const { inventory, bank, updateInventory, updateBankDirect, addToast, itemsData, unlockedFeatures, completedQuests, isIronman, getSnapshot } = useGame()
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedItem, setSelectedItem] = useState(null) // item being purchased
  const [buyQty, setBuyQty] = useState(1)
  const [activeTab, setActiveTab] = useState('all') // 'all' | 'quest_items' | type-based filters

  const hasMoneyPurse = unlockedFeatures.has('money_purse')
  const coinsInInv = countItem(inventory, 'coins')
  const coinsInBank = bank['coins']?.quantity || 0
  const coins = hasMoneyPurse ? coinsInInv + coinsInBank : coinsInInv

  const getItemTypes = () => getStoreItemTypes(itemsData, { isIronman })

  const itemTypes = getItemTypes()

  // Quest ID to quest name mapping
  const questMap = questsData.reduce((acc, quest) => {
    acc[quest.id] = quest.name
    return acc
  }, {})

  const getAvailableItems = () => {
    if (activeTab === 'quest_items') {
      return Object.entries(itemsData)
        .filter(([_, item]) => item.questUnlock && isStoreVisibleItem(item, { isIronman, includeQuestItems: true }))
        .map(([id, item]) => {
          const isUnlocked = completedQuests.has(item.questUnlock)
          return { ...item, id, isUnlocked, unlockedBy: item.questUnlock }
        })
    }
    if (activeTab === 'all') {
      return Object.entries(itemsData)
        .filter(([_, item]) => {
          // Ironman: only show general store items
          if (isIronman) {
            return !item.questUnlock && isStoreVisibleItem(item, { isIronman, includeQuestItems: false })
          }
          // Non-ironman: show all non-quest items
          return !item.questUnlock && isStoreVisibleItem(item, { isIronman, includeQuestItems: false })
        })
        .map(([id, item]) => ({ ...item, id }))
    }
    // For type-based tabs, show only items of that type that aren't quest items or untradeable
    // For ironman, additionally filter to only isGeneralStore items
    return Object.entries(itemsData)
      .filter(([_, item]) => {
        if (item.type !== activeTab) return false
        return !item.questUnlock && isStoreVisibleItem(item, { isIronman, includeQuestItems: false })
      })
      .map(([id, item]) => ({ ...item, id }))
  }

  const getSearchResults = () => {
    const available = getAvailableItems()
    if (!searchTerm.trim()) return available
    const lower = searchTerm.toLowerCase()
    return available.filter(item => item.name.toLowerCase().includes(lower))
  }

  const modifiedPrice = (basePrice) => Math.floor(basePrice * 1.1)

  const handleBuy = async () => {
    if (!selectedItem) return

    const restriction = getPurchaseRestriction(selectedItem, { isIronman })
    if (!restriction.allowed) {
      addToast(restriction.message || 'This item cannot be purchased.', 'error')
      setSelectedItem(null)
      setBuyQty(1)
      return
    }

    // Prevent purchasing locked quest items
    if (selectedItem.questUnlock && !completedQuests.has(selectedItem.questUnlock)) {
      addToast(`You must complete ${questMap[selectedItem.questUnlock]} to unlock this item.`, 'error')
      return
    }

    const price = modifiedPrice(selectedItem.shopValue)
    const totalCost = price * buyQty

    if (coins < totalCost) {
      addToast('Insufficient funds, buy some more credits', 'error')
      if (onBuyCredits) onBuyCredits()
      return
    }

    // Validate purchase with backend (required for cloud accounts)
    if (getToken() && getCharacterId()) {
      try {
        await api.validatePurchase(selectedItem.id, buyQty)
      } catch (err) {
        if (err.body?.code === 'BOSS_UNIQUE_RESTRICTED') {
          addToast('Boss unique drops can only be obtained from bosses and raids.', 'error')
        } else if (err.status === 403) {
          addToast('⚠️ This item is not available to your character type.', 'error')
        } else {
          addToast(`Purchase validation failed: ${err.message}`, 'error')
        }
        return
      }
    }

    const newInv = [...inventory]

    if (buyQty > 1) {
      if (selectedItem.stackable) {
        const existing = newInv.findIndex(s => s && s.itemId === selectedItem.id && !s.noted)
        if (existing !== -1) {
          newInv[existing] = { ...newInv[existing], quantity: newInv[existing].quantity + buyQty }
        } else {
          const empty = newInv.indexOf(null)
          if (empty === -1) {
            addToast('Not enough inventory space.', 'error')
            return
          }
          newInv[empty] = { itemId: selectedItem.id, quantity: buyQty }
        }
      } else {
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
    requestCriticalPushSave(() => getSnapshot(), CRITICAL_SAVE_REASONS.PURCHASE)

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
            {activeTab === 'quest_items' ? 'Quest Items' : 'Store'}
            {isIronman && <span class="text-[12px] font-normal text-[var(--color-parchment)] opacity-60 ml-2">(Ironman)</span>}
          </h2>
          <span class="text-[11px] text-[var(--color-gold)] font-[var(--font-mono)]">
            🪙 {coins.toLocaleString()}
          </span>
        </div>

        {/* Ironman restrictions notice */}
        {isIronman && (
          <div class="mb-3 p-2 rounded-lg bg-[rgba(212,175,55,0.1)] border border-[var(--color-gold)] border-opacity-30">
            <div class="text-[10px] text-[var(--color-gold)] font-semibold">⚔️ Limited Shop Access</div>
            <div class="text-[9px] text-[var(--color-parchment)] opacity-70 mt-1">
              Only general store and quest items available.
            </div>
          </div>
        )}

        {/* ── TAB SWITCHER ── */}
        <div class="flex gap-2 mb-3 overflow-x-auto pb-2">
          <button
            onClick={() => { setActiveTab('all'); setSearchTerm('') }}
            class={`px-3 py-[5px] rounded-[20px] text-[11px] font-semibold border whitespace-nowrap flex-shrink-0 ${
              activeTab === 'all'
                ? 'border-[var(--color-gold)] bg-[rgba(212,175,55,0.15)] text-[var(--color-gold)]'
                : 'border-[#2a2a2a] bg-[var(--color-void-light)] text-[var(--color-parchment)] opacity-60'
            }`}
          >
            🪙 All
          </button>
          <button
            onClick={() => { setActiveTab('quest_items'); setSearchTerm('') }}
            class={`px-3 py-[5px] rounded-[20px] text-[11px] font-semibold border whitespace-nowrap flex-shrink-0 ${
              activeTab === 'quest_items'
                ? 'border-[var(--color-gold)] bg-[rgba(212,175,55,0.15)] text-[var(--color-gold)]'
                : 'border-[#2a2a2a] bg-[var(--color-void-light)] text-[var(--color-parchment)] opacity-60'
            }`}
          >
            📜 Quest Items
          </button>
          {itemTypes.map(type => (
            <button
              key={type}
              onClick={() => { setActiveTab(type); setSearchTerm('') }}
              class={`px-3 py-[5px] rounded-[20px] text-[11px] font-semibold border whitespace-nowrap flex-shrink-0 capitalize ${
                activeTab === type
                  ? 'border-[var(--color-gold)] bg-[rgba(212,175,55,0.15)] text-[var(--color-gold)]'
                  : 'border-[#2a2a2a] bg-[var(--color-void-light)] text-[var(--color-parchment)] opacity-60'
              }`}
            >
              {type}
            </button>
          ))}
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
              : activeTab === 'quest_items'
                ? 'Complete quests to unlock items here.'
                : activeTab === 'all'
                  ? 'No items to buy.'
                  : 'No items in this category.'}
          </div>
        ) : (
          <div class="flex flex-col gap-2 pt-3">
            {searchResults.map(item => {
              const isQuestItem = item.questUnlock !== undefined
              const isUnlocked = isQuestItem ? item.isUnlocked : true
              const price = isQuestItem && !isUnlocked ? 0 : modifiedPrice(item.shopValue || 0)
              const canAfford = coins >= price

              return (
                <button
                  key={item.id}
                  onClick={() => { setSelectedItem(item); setBuyQty(1) }}
                  disabled={isQuestItem && !isUnlocked}
                  class={`p-3 rounded-lg border text-left flex items-center gap-3 transition-colors ${
                    isQuestItem && !isUnlocked
                      ? 'bg-[#1a1a1a] border-[#1a1a1a] cursor-not-allowed opacity-50'
                      : 'bg-[var(--color-void-light)] border-[#2a2a2a] cursor-pointer hover:bg-[#222] hover:border-[#333]'
                  }`}
                >
                  <span class="text-2xl leading-none flex-shrink-0">{item.icon || '📦'}</span>
                  <div class="flex-1 min-w-0">
                    <div class="text-[13px] font-semibold text-[var(--color-parchment)]">{item.name}</div>
                    {isQuestItem && !isUnlocked && (
                      <div class="text-[10px] text-[#888] mt-1">🔒 {questMap[item.unlockedBy]}</div>
                    )}
                  </div>
                  <div class={`text-right flex-shrink-0 text-[12px] font-[var(--font-mono)] font-bold ${
                    isQuestItem && !isUnlocked ? 'text-[#666]' : (canAfford ? 'text-[var(--color-gold)]' : 'text-[#888]')
                  }`}>
                    {isQuestItem && !isUnlocked ? '—' : `${price.toLocaleString()} gp`}
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
          title={`${selectedItem.questUnlock && !selectedItem.isUnlocked ? 'Locked: ' : ''}${selectedItem.name}`}
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

            {/* Quest unlock info */}
            {selectedItem.questUnlock && (
              <Panel className={`text-[12px] ${selectedItem.isUnlocked ? 'border-l-4 border-[var(--color-gold)]' : 'border-l-4 border-[#666]'}`}>
                <div class="text-[11px] font-semibold mb-1 text-[#aaa]">Required Quest:</div>
                <div class={`text-[13px] font-semibold ${selectedItem.isUnlocked ? 'text-[var(--color-gold)]' : 'text-[#888]'}`}>
                  {questMap[selectedItem.questUnlock]}
                </div>
                <div class={`text-[10px] mt-2 ${selectedItem.isUnlocked ? 'text-[#7a7]' : 'text-[#a77]'}`}>
                  {selectedItem.isUnlocked ? '✓ Quest Complete' : '✗ Not Yet Completed'}
                </div>
              </Panel>
            )}

            {/* Price info - only show if unlocked */}
            {!selectedItem.questUnlock || selectedItem.isUnlocked ? (
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
            ) : null}

            {/* Quantity selector - only show if not locked */}
            {!selectedItem.questUnlock || selectedItem.isUnlocked ? (
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
                      const parsed = parseInt(e.target.value)
                      if (!isNaN(parsed)) {
                        setBuyQty(Math.max(1, Math.min(Number.MAX_SAFE_INTEGER, parsed)))
                      }
                    }}
                    class="flex-1 h-8 rounded-md bg-[#111] border border-[var(--color-void-border)] text-[var(--color-parchment)] text-[13px] font-[var(--font-mono)] text-center outline-none"
                  />
                  <Button variant="secondary" size="md" onClick={() => setBuyQty(Math.min(Number.MAX_SAFE_INTEGER, buyQty + 1))} className="w-8 h-8 p-0 flex items-center justify-center text-base">+</Button>
                </div>
                {buyQty > 1 && !selectedItem.stackable && (
                  <div class="text-[10px] text-[#888] mt-1">
                    💡 Buying {buyQty} items will be delivered as noted (stackable)
                  </div>
                )}
              </div>
            ) : null}

            {/* Buttons */}
            <div class="flex gap-2 mt-2">
              <Button variant="secondary" size="lg" onClick={() => { setSelectedItem(null); setBuyQty(1) }} className="flex-1">
                Cancel
              </Button>
              {selectedItem.questUnlock && !selectedItem.isUnlocked ? (
                <Button variant="secondary" size="lg" disabled className="flex-1 opacity-50">
                  Locked
                </Button>
              ) : (
                <Button variant="primary" size="lg" onClick={handleBuy} disabled={!canAffordSelected} className="flex-1">
                  Buy
                </Button>
              )}
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
