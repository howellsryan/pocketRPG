import { useState, useRef, useEffect } from 'preact/hooks'
import { useGame } from '../state/gameState.jsx'
import Modal from '../components/Modal.jsx'
import { formatQuantity } from '../utils/helpers'

const MAX_TABS = 8
const DEFAULT_NAMES = ['Combat', 'Skilling', 'Resources', 'Food', 'Gems', 'Runes', 'Misc', 'Extra']

export default function BankScreen() {
  const { bank, inventory, updateBank, updateInventory, addToast, itemsData, bankConfig, updateBankConfig } = useGame()
  const [selectedId, setSelectedId] = useState(null)
  const [activeTab, setActiveTab] = useState(0)
  const [tabMenu, setTabMenu] = useState(null)   // tabIndex of tab being edited
  const [renameValue, setRenameValue] = useState('')
  const [draggingId, setDraggingId] = useState(null)
  const [overItemId, setOverItemId] = useState(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [quantityModalMode, setQuantityModalMode] = useState(null) // 'take' | 'note' | null
  const [quantityInput, setQuantityInput] = useState('')

  const dragRef = useRef(null)
  const overRef = useRef(null)

  const tabs = bankConfig?.tabs ?? []
  const itemTabMap = bankConfig?.itemTabMap ?? {}
  const allTabName = bankConfig?.allTabName ?? 'All'

  // Derive selected entry fresh from bank state each render
  const selected = selectedId && bank[selectedId]?.quantity > 0 ? bank[selectedId] : null
  useEffect(() => { if (selectedId && !selected) setSelectedId(null) }, [selected, selectedId])

  const bankItems = Object.values(bank).filter(b => b && b.quantity > 0)

  const getDisplayItems = () => {
    let items
    if (activeTab === 0) {
      // Show unassigned items + items explicitly ordered in All (tabIndex: 0)
      items = bankItems
        .filter(e => !itemTabMap[e.itemId] || itemTabMap[e.itemId].tabIndex === 0)
        .sort((a, b) => {
          const pa = itemTabMap[a.itemId]?.tabIndex === 0 ? (itemTabMap[a.itemId].position ?? 9999) : 9999
          const pb = itemTabMap[b.itemId]?.tabIndex === 0 ? (itemTabMap[b.itemId].position ?? 9999) : 9999
          return pa - pb
        })
    } else {
      items = bankItems
        .filter(e => itemTabMap[e.itemId]?.tabIndex === activeTab)
        .sort((a, b) => (itemTabMap[a.itemId]?.position ?? 9999) - (itemTabMap[b.itemId]?.position ?? 9999))
    }

    // Apply search filter
    if (searchTerm.trim()) {
      const lower = searchTerm.toLowerCase()
      items = items.filter(e => itemsData[e.itemId]?.name.toLowerCase().includes(lower))
    }

    return items
  }

  // ── Withdrawal ──────────────────────────────────────────────────────────────
  const handleWithdraw = (itemId, qty = 1, asNote = false) => {
    const bankEntry = bank[itemId]
    if (!bankEntry || bankEntry.quantity < qty) return

    const item = itemsData[itemId]
    const newInv = [...inventory]
    let actualWithdrawn = 0

    if (item?.stackable || asNote) {
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
    setSelectedId(null)
  }

  const handleQuantityModalSubmit = () => {
    if (!quantityInput || !selectedId) return
    const qty = parseInt(quantityInput, 10)
    if (isNaN(qty) || qty <= 0) {
      addToast('Invalid quantity', 'error')
      return
    }
    const maxQty = bank[selectedId]?.quantity || 0
    if (qty > maxQty) {
      addToast(`Only ${maxQty} available`, 'error')
      return
    }
    handleWithdraw(selectedId, qty, quantityModalMode === 'note')
    setQuantityModalMode(null)
    setQuantityInput('')
  }

  // ── Tab management ───────────────────────────────────────────────────────────
  const addTab = () => {
    if (tabs.length >= MAX_TABS) return
    const name = DEFAULT_NAMES[tabs.length] ?? `Tab ${tabs.length + 1}`
    updateBankConfig({ tabs: [...tabs, name], itemTabMap, allTabName })
    setActiveTab(tabs.length + 1)
  }

  const confirmRename = () => {
    if (tabMenu === null) return
    const trimmed = renameValue.trim()
    if (tabMenu === 0) {
      updateBankConfig({ tabs, itemTabMap, allTabName: trimmed || allTabName })
    } else {
      const newTabs = [...tabs]
      newTabs[tabMenu - 1] = trimmed || tabs[tabMenu - 1]
      updateBankConfig({ tabs: newTabs, itemTabMap, allTabName })
    }
    setTabMenu(null)
  }

  const deleteTab = (tabIndex) => {
    const newTabs = tabs.filter((_, i) => i !== tabIndex - 1)
    const newMap = {}
    for (const [id, info] of Object.entries(itemTabMap)) {
      if (info.tabIndex === tabIndex) continue
      newMap[id] = info.tabIndex > tabIndex ? { ...info, tabIndex: info.tabIndex - 1 } : info
    }
    updateBankConfig({ tabs: newTabs, itemTabMap: newMap, allTabName })
    if (activeTab === tabIndex) setActiveTab(0)
    else if (activeTab > tabIndex) setActiveTab(activeTab - 1)
    setTabMenu(null)
  }

  // ── Item tab assignment ──────────────────────────────────────────────────────
  const assignToTab = (itemId, tabIndex) => {
    const newMap = { ...itemTabMap }
    if (tabIndex === 0) {
      delete newMap[itemId]
    } else {
      const pos = Object.values(newMap).filter(v => v.tabIndex === tabIndex).length
      newMap[itemId] = { tabIndex, position: pos }
    }
    updateBankConfig({ tabs, itemTabMap: newMap, allTabName })
    setSelectedId(null)
  }

  // ── Drag reorder ─────────────────────────────────────────────────────────────
  const reorderItems = (draggedId, targetId) => {
    if (draggedId === targetId) return
    const newMap = { ...itemTabMap }

    let ids
    if (activeTab === 0) {
      // All tab: unassigned items + tabIndex:0 items, in current display order
      ids = bankItems
        .filter(e => !newMap[e.itemId] || newMap[e.itemId].tabIndex === 0)
        .sort((a, b) => {
          const pa = newMap[a.itemId]?.tabIndex === 0 ? (newMap[a.itemId].position ?? 9999) : 9999
          const pb = newMap[b.itemId]?.tabIndex === 0 ? (newMap[b.itemId].position ?? 9999) : 9999
          return pa - pb
        })
        .map(e => e.itemId)
    } else {
      ids = Object.entries(newMap)
        .filter(([, info]) => info.tabIndex === activeTab)
        .sort(([, a], [, b]) => a.position - b.position)
        .map(([id]) => id)
    }

    const fromIdx = ids.indexOf(draggedId)
    if (fromIdx === -1) return
    ids.splice(fromIdx, 1)
    const toIdx = ids.indexOf(targetId)
    if (toIdx === -1) return
    ids.splice(toIdx, 0, draggedId)

    ids.forEach((id, pos) => {
      newMap[id] = { tabIndex: activeTab, position: pos }
    })
    updateBankConfig({ tabs, itemTabMap: newMap, allTabName })
  }

  // Drag handle pointer events — pointer capture ensures move/up fire on the handle
  // even after the pointer leaves it.
  const handleDragStart = (e, itemId) => {
    e.preventDefault()
    e.stopPropagation()

    // The handle's parent is the relative wrapper div
    const itemEl = e.currentTarget.parentElement
    const rect = itemEl.getBoundingClientRect()

    dragRef.current = {
      itemId,
      itemEl,
      startX: e.clientX,
      startY: e.clientY,
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
      isDragging: false,
      ghostEl: null,
    }

    e.currentTarget.setPointerCapture(e.pointerId)
    setDraggingId(itemId)
  }

  const handleDragMove = (e, itemId) => {
    const d = dragRef.current
    if (!d || d.itemId !== itemId) return

    const dx = e.clientX - d.startX
    const dy = e.clientY - d.startY

    if (!d.isDragging && Math.sqrt(dx * dx + dy * dy) > 6) {
      d.isDragging = true
      const ghost = d.itemEl.cloneNode(true)
      // Strip any inline styles set by a previous drag
      ghost.removeAttribute('style')
      ghost.style.cssText = [
        'position:fixed',
        `width:${d.itemEl.offsetWidth}px`,
        `height:${d.itemEl.offsetHeight}px`,
        'pointer-events:none',
        'z-index:9999',
        'opacity:0.85',
        'border:2px solid var(--color-gold)',
        'border-radius:8px',
        'transform:scale(1.06)',
        'box-shadow:0 8px 20px rgba(0,0,0,0.6)',
        'overflow:hidden',
      ].join(';')
      document.body.appendChild(ghost)
      d.ghostEl = ghost
    }

    if (d.isDragging && d.ghostEl) {
      d.ghostEl.style.left = (e.clientX - d.offsetX) + 'px'
      d.ghostEl.style.top  = (e.clientY - d.offsetY) + 'px'

      // Hit-test: hide ghost so it doesn't block elementFromPoint
      d.ghostEl.style.display = 'none'
      const topEl = document.elementFromPoint(e.clientX, e.clientY)
      d.ghostEl.style.display = ''

      // Walk up DOM to find the item wrapper (has data-bank-item-id)
      let target = topEl
      while (target && !target.dataset?.bankItemId) target = target.parentElement
      const newOver = (target?.dataset.bankItemId && target.dataset.bankItemId !== itemId)
        ? target.dataset.bankItemId : null

      overRef.current = newOver
      if (newOver !== overItemId) setOverItemId(newOver)
    }
  }

  const handleDragEnd = (e, itemId) => {
    const d = dragRef.current
    if (!d || d.itemId !== itemId) return

    if (d.ghostEl) d.ghostEl.remove()
    if (d.isDragging && overRef.current) reorderItems(itemId, overRef.current)

    setDraggingId(null)
    setOverItemId(null)
    overRef.current = null
    dragRef.current = null
  }

  const handleDragCancel = (e, itemId) => {
    const d = dragRef.current
    if (!d || d.itemId !== itemId) return
    if (d.ghostEl) d.ghostEl.remove()
    setDraggingId(null)
    setOverItemId(null)
    overRef.current = null
    dragRef.current = null
  }

  // Clean up ghost if component unmounts mid-drag
  useEffect(() => () => { if (dragRef.current?.ghostEl) dragRef.current.ghostEl.remove() }, [])

  const displayItems = getDisplayItems()

  return (
    <div class="h-full flex flex-col overflow-hidden">

      {/* ── Header + Tab bar ─────────────────────────────────────────────── */}
      <div class="px-4 pt-4 pb-0 flex-shrink-0">
        <div class="flex items-center gap-2 mb-2">
          <h2 class="font-[var(--font-display)] text-sm font-bold text-[var(--color-parchment)] opacity-60 uppercase tracking-wider flex-shrink-0">
            Bank ({bankItems.length})
          </h2>
          <div class="flex-1 flex justify-center">
            <div class="w-32 flex items-center bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg px-2.5 py-1.5">
              <input
                type="text"
                value={searchTerm}
                onInput={(e) => setSearchTerm(e.target.value)}
                placeholder="Search..."
                class="flex-1 bg-transparent text-xs text-[var(--color-parchment)] outline-none placeholder:opacity-30"
              />
              {searchTerm && (
                <button
                  onClick={() => setSearchTerm('')}
                  class="text-[var(--color-parchment)] opacity-40 hover:opacity-70 active:opacity-80 text-[12px] ml-1 flex-shrink-0"
                >
                  ✕
                </button>
              )}
            </div>
          </div>
          <button
            onClick={() => {
              setTabMenu(activeTab)
              setRenameValue(activeTab === 0 ? allTabName : (tabs[activeTab - 1] ?? ''))
            }}
            class="text-[10px] text-[var(--color-parchment)] opacity-40 px-2 py-1 rounded active:opacity-70 flex-shrink-0"
          >
            ✏️ Edit tab
          </button>
        </div>

        <div class="flex gap-1.5 overflow-x-auto pb-2" style="scrollbar-width:none;-webkit-overflow-scrolling:touch">
          {/* All tab */}
          <button
            onClick={() => setActiveTab(0)}
            class={`flex-shrink-0 px-3 py-1.5 rounded-md text-xs font-bold max-w-[80px] truncate ${
              activeTab === 0
                ? 'bg-[var(--color-gold-dim)] text-white'
                : 'bg-[#222] text-[var(--color-parchment)] opacity-50 active:opacity-80'
            }`}
          >
            {allTabName}
          </button>

          {tabs.map((name, i) => (
            <button
              key={i}
              onClick={() => setActiveTab(i + 1)}
              class={`flex-shrink-0 px-3 py-1.5 rounded-md text-xs font-bold max-w-[80px] truncate ${
                activeTab === i + 1
                  ? 'bg-[var(--color-mana)] text-white'
                  : 'bg-[#222] text-[var(--color-parchment)] opacity-50 active:opacity-80'
              }`}
            >
              {name}
            </button>
          ))}

          {tabs.length < MAX_TABS && (
            <button
              onClick={addTab}
              class="flex-shrink-0 px-2.5 py-1.5 rounded-md bg-[#222] text-[var(--color-parchment)] opacity-30 text-sm font-bold active:opacity-60"
            >
              +
            </button>
          )}
        </div>
      </div>

      {/* ── Item grid ────────────────────────────────────────────────────── */}
      <div class="flex-1 overflow-y-auto px-4 pb-4">
        {displayItems.length === 0 ? (
          <div class="text-center py-12 text-[var(--color-parchment)] opacity-30 text-sm">
            {activeTab === 0
              ? (bankItems.length > 0 ? 'All items are in tabs' : 'Your bank is empty')
              : 'No items — tap an item and use "Move to Tab"'}
          </div>
        ) : (
          <div class="grid grid-cols-4 gap-2">
            {displayItems.map(entry => {
              const item = itemsData[entry.itemId]
              if (!item) return null
              const emoji = item.icon || '📦'
              const isDragging = draggingId === entry.itemId
              const isOver = overItemId === entry.itemId
              const { text, isM } = formatQuantity(entry.quantity)

              return (
                <div
                  key={entry.itemId}
                  data-bank-item-id={entry.itemId}
                  class="relative"
                >
                  <button
                    onClick={() => setSelectedId(entry.itemId)}
                    class={`w-full flex flex-col items-center p-2 rounded-lg border select-none ${
                      isDragging
                        ? 'opacity-30 border-[#444] bg-[#1a1a1a]'
                        : isOver
                          ? 'bg-[#252520] border-[var(--color-gold)]'
                          : 'bg-[#1a1a1a] border-[#2a2a2a] active:bg-[#222]'
                    }`}
                  >
                    <span class="text-lg">{emoji}</span>
                    <span class="text-[8px] text-[var(--color-parchment)] opacity-60 truncate w-full text-center">{item.name}</span>
                    <span class={`text-[9px] font-[var(--font-mono)] font-bold ${isM ? 'text-[var(--color-emerald)]' : 'text-[var(--color-gold)]'}`}>×{text}</span>
                  </button>

                  {/* Drag handle — shown in all tabs */}
                  <span
                    class="absolute top-0.5 right-0.5 text-[10px] text-[var(--color-parchment)] opacity-20 leading-none select-none z-10 px-0.5 py-0.5 cursor-grab"
                    style={{ touchAction: 'none' }}
                    onPointerDown={(e) => handleDragStart(e, entry.itemId)}
                    onPointerMove={(e) => handleDragMove(e, entry.itemId)}
                    onPointerUp={(e) => handleDragEnd(e, entry.itemId)}
                    onPointerCancel={(e) => handleDragCancel(e, entry.itemId)}
                  >
                    ⠿
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ── Tab edit modal ───────────────────────────────────────────────── */}
      {tabMenu !== null && (
        <Modal
          title={`Edit "${tabMenu === 0 ? allTabName : (tabs[tabMenu - 1] ?? '')}" Tab`}
          onClose={() => setTabMenu(null)}
        >
          <div class="space-y-3">
            <div>
              <p class="text-[10px] text-[var(--color-parchment)] opacity-40 mb-1 uppercase tracking-wider">Tab Name</p>
              <input
                type="text"
                value={renameValue}
                onInput={(e) => setRenameValue(e.target.value)}
                maxLength={20}
                class="w-full bg-[#1a1a1a] border border-[#333] rounded-lg px-3 py-2 text-sm text-[var(--color-parchment)] outline-none focus:border-[var(--color-gold)]"
                placeholder="Enter tab name"
              />
            </div>
            <button
              onClick={confirmRename}
              class="w-full py-2.5 rounded-lg bg-[var(--color-mana)] text-white font-semibold text-sm active:opacity-80"
            >
              Rename
            </button>
            {tabMenu !== 0 && (
              <button
                onClick={() => deleteTab(tabMenu)}
                class="w-full py-2.5 rounded-lg bg-red-900 text-white font-semibold text-sm active:opacity-80"
              >
                Delete Tab
              </button>
            )}
          </div>
        </Modal>
      )}

      {/* ── Item withdraw / assign modal ─────────────────────────────────── */}
      {selected && (() => {
        const selItem = itemsData[selected.itemId]
        const isStackable = selItem?.stackable
        const currentAssignment = itemTabMap[selected.itemId]

        return (
          <Modal title={selItem?.name || selected.itemId} onClose={() => setSelectedId(null)}>
            <div class="space-y-3">

              {/* Quantity in bank */}
              <div class="text-center text-sm text-[var(--color-parchment)] opacity-60">
                In bank: {(() => {
                  const { text, isM } = formatQuantity(selected.quantity)
                  return <span class={`font-[var(--font-mono)] ${isM ? 'text-[var(--color-emerald)]' : 'text-[var(--color-gold)]'}`}>{text}</span>
                })()}
              </div>

              {/* Withdraw buttons */}
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
              </div>

              {/* Take All + Take X buttons (50/50) */}
              <div class="grid grid-cols-2 gap-2">
                <button
                  onClick={() => handleWithdraw(selected.itemId, selected.quantity)}
                  class="py-2.5 rounded-lg bg-[var(--color-gold-dim)] text-white font-semibold text-sm active:opacity-80"
                >
                  Take All
                </button>
                <button
                  onClick={() => {
                    setQuantityModalMode('take')
                    setQuantityInput('')
                  }}
                  class="py-2.5 rounded-lg bg-[var(--color-gold)] text-white font-semibold text-sm active:opacity-80"
                >
                  Take X
                </button>
              </div>

              {/* Withdraw as Note */}
              {!isStackable && (
                <div class="border-t border-[#333] pt-2">
                  <p class="text-[10px] text-[var(--color-parchment)] opacity-40 mb-1.5 uppercase tracking-wider font-bold">Withdraw as Note</p>
                  <div class="grid grid-cols-3 gap-2 mb-2">
                    {[1, 5, 10].map(qty => (
                      <button
                        key={qty}
                        onClick={() => handleWithdraw(selected.itemId, Math.min(qty, selected.quantity), true)}
                        class="py-2 rounded-lg bg-[var(--color-emerald-mid)] text-white font-semibold text-sm active:opacity-80"
                      >
                        Note {qty}
                      </button>
                    ))}
                  </div>

                  {/* Note All + Note X buttons (50/50) */}
                  <div class="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => handleWithdraw(selected.itemId, selected.quantity, true)}
                      class="py-2 rounded-lg bg-[var(--color-emerald)] text-white font-semibold text-sm active:opacity-80"
                    >
                      Note All
                    </button>
                    <button
                      onClick={() => {
                        setQuantityModalMode('note')
                        setQuantityInput('')
                      }}
                      class="py-2 rounded-lg bg-[var(--color-emerald-light)] text-white font-semibold text-sm active:opacity-80"
                    >
                      Note X
                    </button>
                  </div>
                </div>
              )}

              {/* Tab assignment — only shown when tabs exist */}
              {tabs.length > 0 && (
                <div class="border-t border-[#333] pt-2">
                  <p class="text-[10px] text-[var(--color-parchment)] opacity-40 mb-1 uppercase tracking-wider font-bold">Move to Tab</p>
                  <div class="flex flex-wrap gap-1.5">
                    {/* All tab as first option */}
                    {(() => {
                      const isInAll = !currentAssignment || currentAssignment.tabIndex === 0
                      return (
                        <button
                          onClick={() => !isInAll && assignToTab(selected.itemId, 0)}
                          class={`px-3 py-1.5 rounded-md text-xs font-semibold ${
                            isInAll
                              ? 'bg-[var(--color-gold-dim)] text-white cursor-default'
                              : 'bg-[#2a2a2a] text-[var(--color-parchment)] active:opacity-70'
                          }`}
                        >
                          {allTabName}
                        </button>
                      )
                    })()}
                    {tabs.map((name, i) => {
                      const tabIdx = i + 1
                      const isAssigned = currentAssignment?.tabIndex === tabIdx
                      return (
                        <button
                          key={i}
                          onClick={() => !isAssigned && assignToTab(selected.itemId, tabIdx)}
                          class={`px-3 py-1.5 rounded-md text-xs font-semibold ${
                            isAssigned
                              ? 'bg-[var(--color-mana)] text-white cursor-default'
                              : 'bg-[#2a2a2a] text-[var(--color-parchment)] active:opacity-70'
                          }`}
                        >
                          {name}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

            </div>
          </Modal>
        )
      })()}

      {/* ── Quantity input modal ─────────────────────────────────────────── */}
      {quantityModalMode && selected && (() => {
        const selItem = itemsData[selected.itemId]
        const maxQty = selected.quantity
        const title = quantityModalMode === 'note' ? `Note ${selItem?.name || selected.itemId}` : `Take ${selItem?.name || selected.itemId}`

        return (
          <Modal title={title} onClose={() => { setQuantityModalMode(null); setQuantityInput('') }}>
            <div class="space-y-3">
              <div>
                <p class="text-[10px] text-[var(--color-parchment)] opacity-40 mb-1 uppercase tracking-wider">Available: {maxQty}</p>
                <input
                  type="number"
                  value={quantityInput}
                  onInput={(e) => setQuantityInput(e.target.value)}
                  min="1"
                  max={maxQty}
                  placeholder="Enter quantity"
                  class="w-full bg-[#1a1a1a] border border-[#333] rounded-lg px-3 py-2 text-sm text-[var(--color-parchment)] outline-none focus:border-[var(--color-gold)]"
                  autoFocus
                />
              </div>
              <button
                onClick={handleQuantityModalSubmit}
                disabled={!quantityInput || isNaN(parseInt(quantityInput, 10)) || parseInt(quantityInput, 10) <= 0}
                class={`w-full py-2.5 rounded-lg font-semibold text-sm active:opacity-80 ${
                  quantityModalMode === 'note'
                    ? 'bg-[var(--color-emerald)] text-white'
                    : 'bg-[var(--color-gold-dim)] text-white'
                }`}
              >
                {quantityModalMode === 'note' ? 'Note' : 'Take'} {quantityInput || '0'}
              </button>
            </div>
          </Modal>
        )
      })()}
    </div>
  )
}
