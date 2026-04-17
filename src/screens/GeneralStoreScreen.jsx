import { useState } from 'preact/hooks'
import { useGame } from '../state/gameState.jsx'
import { countItem, removeItem, freeSlots } from '../engine/inventory.js'
import Modal from '../components/Modal.jsx'

// ── COMPONENT ───────────────────────────────────────────────────────────────
export default function GeneralStoreScreen() {
  const { inventory, bank, updateInventory, updateBankDirect, addToast, itemsData, unlockedFeatures } = useGame()
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedItem, setSelectedItem] = useState(null) // item being purchased
  const [buyQty, setBuyQty] = useState(1)

  const hasMoneyPurse = unlockedFeatures.has('money_purse')
  const coinsInInv = countItem(inventory, 'coins')
  const coinsInBank = bank['coins']?.quantity || 0
  const coins = hasMoneyPurse ? coinsInInv + coinsInBank : coinsInInv

  // Get all purchasable items (all tradeable items)
  const getAvailableItems = () => {
    return Object.entries(itemsData)
      .filter(([_, item]) => !item.isUntradeable)
      .map(([id, item]) => ({ ...item, id }))
  }

  // Search items by name
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

    // Validate coins
    if (coins < totalCost) {
      addToast(`Need ${totalCost.toLocaleString()} coins — you have ${coins.toLocaleString()}.`, 'error')
      return
    }

    const newInv = [...inventory]

    // For quantity > 1, items are added as noted (stackable)
    if (buyQty > 1) {
      // Add as noted item
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
      // For qty 1, add normally
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

    // Remove coins: inventory first, then bank (if money purse unlocked)
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

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* ── HEADER ── */}
      <div style={{ padding: '12px 16px', flexShrink: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '12px' }}>
          <h2 style={{ fontFamily: 'Cinzel, serif', fontSize: '15px', fontWeight: '700', color: '#d4af37', margin: 0 }}>
            General Store
          </h2>
          <span style={{ fontSize: '11px', color: '#d4af37', fontFamily: 'monospace' }}>
            🪙 {coins.toLocaleString()}
          </span>
        </div>

        {/* ── SEARCH INPUT ── */}
        <input
          type="text"
          placeholder="Search items..."
          value={searchTerm}
          onInput={(e) => setSearchTerm(e.target.value)}
          style={{
            width: '100%',
            padding: '10px 12px',
            borderRadius: '8px',
            border: '1px solid #2a2a2a',
            background: '#111',
            color: '#e8d5b0',
            fontSize: '13px',
            outline: 'none',
            fontFamily: 'inherit',
          }}
        />
      </div>

      {/* ── SEARCH RESULTS ── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 16px 80px' }}>
        {searchResults.length === 0 ? (
          <div style={{ padding: '40px 16px', textAlign: 'center', color: '#888', fontSize: '12px' }}>
            {searchTerm ? 'No items found.' : 'Search for items to buy.'}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', paddingTop: '12px' }}>
            {searchResults.map(item => {
              const price = modifiedPrice(item.shopValue)
              const canAfford = coins >= price

              return (
                <button
                  key={item.id}
                  onClick={() => {
                    setSelectedItem(item)
                    setBuyQty(1)
                  }}
                  style={{
                    padding: '12px',
                    borderRadius: '8px',
                    background: '#1a1a1a',
                    border: '1px solid #2a2a2a',
                    color: 'inherit',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    transition: 'all 0.15s',
                    textAlign: 'left',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#333'; e.currentTarget.style.background = '#222' }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#2a2a2a'; e.currentTarget.style.background = '#1a1a1a' }}
                >
                  <span style={{ fontSize: '24px', lineHeight: 1, flexShrink: 0 }}>{item.icon || '📦'}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '13px', fontWeight: '600', color: '#e8d5b0' }}>{item.name}</div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0, fontSize: '12px', color: canAfford ? '#d4af37' : '#888', fontFamily: 'monospace', fontWeight: '700' }}>
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
          onClose={() => {
            setSelectedItem(null)
            setBuyQty(1)
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {/* Item preview */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px', background: '#111', borderRadius: '8px' }}>
              <span style={{ fontSize: '32px' }}>{selectedItem.icon || '📦'}</span>
              <div>
                <div style={{ fontSize: '13px', fontWeight: '600', color: '#e8d5b0' }}>{selectedItem.name}</div>
                <div style={{ fontSize: '11px', color: '#888', marginTop: '2px' }}>{selectedItem.type}</div>
              </div>
            </div>

            {/* Price info */}
            <div style={{ padding: '12px', background: '#111', borderRadius: '8px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: '12px' }}>
                <span style={{ color: '#888' }}>Price per item:</span>
                <span style={{ color: '#d4af37', fontFamily: 'monospace', fontWeight: '700' }}>{modifiedPrice(selectedItem.shopValue).toLocaleString()} gp</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                <span style={{ color: '#888' }}>Total:</span>
                <span style={{ color: '#d4af37', fontFamily: 'monospace', fontWeight: '700' }}>
                  {(modifiedPrice(selectedItem.shopValue) * buyQty).toLocaleString()} gp
                </span>
              </div>
            </div>

            {/* Quantity selector */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ fontSize: '12px', color: '#888' }}>Quantity</div>
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                <button
                  onClick={() => setBuyQty(Math.max(1, buyQty - 1))}
                  style={{
                    width: '32px',
                    height: '32px',
                    borderRadius: '6px',
                    background: '#222',
                    border: '1px solid #333',
                    color: '#e8d5b0',
                    fontSize: '16px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  −
                </button>
                <input
                  type="number"
                  min="1"
                  max={Number.MAX_SAFE_INTEGER}
                  value={buyQty}
                  onInput={(e) => {
                    const val = Math.max(1, Math.min(Number.MAX_SAFE_INTEGER, parseInt(e.target.value) || 1))
                    setBuyQty(val)
                  }}
                  style={{
                    flex: 1,
                    height: '32px',
                    borderRadius: '6px',
                    background: '#111',
                    border: '1px solid #333',
                    color: '#e8d5b0',
                    fontSize: '13px',
                    fontFamily: 'monospace',
                    textAlign: 'center',
                    outline: 'none',
                  }}
                />
                <button
                  onClick={() => setBuyQty(Math.min(Number.MAX_SAFE_INTEGER, buyQty + 1))}
                  style={{
                    width: '32px',
                    height: '32px',
                    borderRadius: '6px',
                    background: '#222',
                    border: '1px solid #333',
                    color: '#e8d5b0',
                    fontSize: '16px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  +
                </button>
              </div>
              {buyQty > 1 && (
                <div style={{ fontSize: '10px', color: '#888', marginTop: '4px' }}>
                  💡 Buying {buyQty} items will be delivered as noted (stackable)
                </div>
              )}
            </div>

            {/* Buttons */}
            <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
              <button
                onClick={() => {
                  setSelectedItem(null)
                  setBuyQty(1)
                }}
                style={{
                  flex: 1,
                  padding: '12px',
                  borderRadius: '8px',
                  border: '1px solid #333',
                  background: '#222',
                  color: '#e8d5b0',
                  fontSize: '13px',
                  fontWeight: '600',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleBuy}
                disabled={coins < modifiedPrice(selectedItem.shopValue) * buyQty}
                style={{
                  flex: 1,
                  padding: '12px',
                  borderRadius: '8px',
                  background: coins < modifiedPrice(selectedItem.shopValue) * buyQty
                    ? '#333'
                    : 'linear-gradient(135deg, #b8940e, #d4af37)',
                  border: 'none',
                  color: coins < modifiedPrice(selectedItem.shopValue) * buyQty ? '#888' : '#0f0f0f',
                  fontSize: '13px',
                  fontWeight: '700',
                  cursor: coins < modifiedPrice(selectedItem.shopValue) * buyQty ? 'not-allowed' : 'pointer',
                }}
              >
                Buy
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
