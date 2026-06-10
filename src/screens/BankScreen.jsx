import { useState, useRef, useEffect } from 'preact/hooks'
import { useGame } from '../state/gameState.jsx'
import Modal from '../components/Modal.jsx'
import SharedItemModal from '../components/SharedItemModal.jsx'
import TradingPostSellForm from '../components/TradingPostSellForm.jsx'
import { formatQuantity } from '../utils/helpers'
import GameIcon from '../components/GameIcon.jsx'
import { isOrderBookItem } from '../engine/storeRules.js'
import { api, getToken, getCharacterId } from '../cloud/api.js'
import { pullSave, applyCloudSave, pushNow } from '../cloud/sync.js'

const MAX_TABS = 8
const DEFAULT_NAMES = ['Combat', 'Skilling', 'Resources', 'Food', 'Gems', 'Runes', 'Misc', 'Extra']

export default function BankScreen() {
  const { bank, inventory, updateBank, updateInventory, addToast, itemsData, bankConfig, updateBankConfig, isIronman, loadGame, getSnapshot } = useGame()
  const [selectedId, setSelectedId] = useState(null)
  const [activeTab, setActiveTab] = useState(0)
  const [tabMenu, setTabMenu] = useState(null)   // tabIndex of tab being edited
  const [renameValue, setRenameValue] = useState('')
  const [draggingId, setDraggingId] = useState(null)
  const [overItemId, setOverItemId] = useState(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [quantityModalMode, setQuantityModalMode] = useState(null) // 'take' | 'note' | null
  const [quantityInput, setQuantityInput] = useState('')
  const [sellBusy, setSellBusy] = useState(false)
  const [listQtyInput, setListQtyInput] = useState(1)
  const [listPriceInput, setListPriceInput] = useState(1)

  const hasCloudAccount = Boolean(getToken() && getCharacterId())

  const dragRef = useRef(null)
  const overRef = useRef(null)
  const scrollRef = useRef(null)
  const autoScrollRef = useRef(null)

  const tabs = bankConfig?.tabs ?? []
  const itemTabMap = bankConfig?.itemTabMap ?? {}
  const allTabName = bankConfig?.allTabName ?? 'All'
  const placeholders = bankConfig?.placeholders ?? {}

  // Derive selected entry fresh from bank state each render
  const selected = selectedId && bank[selectedId]?.quantity > 0 ? bank[selectedId] : null
  useEffect(() => { if (selectedId && !selected) setSelectedId(null) }, [selected, selectedId])

  // Set default price when item is selected
  useEffect(() => {
    if (selected) {
      const item = itemsData[selected.itemId]
      setListQtyInput(1)
      setListPriceInput(Math.max(1, Math.floor(Number(item?.shopValue) || 1)))
    }
  }, [selected, itemsData])

  const bankItems = Object.values(bank).filter(b => b && b.quantity > 0)
  const placeholderIds = Object.keys(placeholders).filter(itemId => !bank[itemId] || bank[itemId].quantity <= 0)

  const getDisplayItems = () => {
    let items
    if (activeTab === 0) {
      // Show unassigned items + items explicitly ordered in All (tabIndex: 0)
      const byId = new Map()
      bankItems
        .filter(e => !itemTabMap[e.itemId] || itemTabMap[e.itemId].tabIndex === 0)
        .forEach(e => byId.set(e.itemId, e))
      placeholderIds
        .filter(itemId => !itemTabMap[itemId] || itemTabMap[itemId].tabIndex === 0)
        .forEach(itemId => byId.set(itemId, { itemId, quantity: 0, inactivePlaceholder: true }))

      items = Array.from(byId.values()).sort((a, b) => {
        const pa = itemTabMap[a.itemId]?.tabIndex === 0 ? (itemTabMap[a.itemId].position ?? 9999) : 9999
        const pb = itemTabMap[b.itemId]?.tabIndex === 0 ? (itemTabMap[b.itemId].position ?? 9999) : 9999
        return pa - pb
      })
    } else {
      const byId = new Map()
      bankItems
        .filter(e => itemTabMap[e.itemId]?.tabIndex === activeTab)
        .forEach(e => byId.set(e.itemId, e))
      placeholderIds
        .filter(itemId => itemTabMap[itemId]?.tabIndex === activeTab)
        .forEach(itemId => byId.set(itemId, { itemId, quantity: 0, inactivePlaceholder: true }))

      items = Array.from(byId.values()).sort((a, b) => (itemTabMap[a.itemId]?.position ?? 9999) - (itemTabMap[b.itemId]?.position ?? 9999))
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
    // Charge pool semantics: deposits merge charges into the single bank
    // entry, so a withdrawal takes its proportional share of the pool (the
    // full pool when the entry empties) and the bank keeps the rest. The old
    // code copied the full pool onto the withdrawn item AND left it in the
    // bank, duplicating charges on partial withdrawals.
    const poolCharges = Math.max(0, Math.floor(bankEntry.charges || 0))
    const newSlotIndices = []

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
        newSlotIndices.push(empty)
        actualWithdrawn = qty
      }
    } else {
      for (let i = 0; i < qty; i++) {
        const empty = newInv.indexOf(null)
        if (empty === -1) break
        newInv[empty] = { itemId, quantity: 1 }
        newSlotIndices.push(empty)
        actualWithdrawn++
      }
      if (actualWithdrawn === 0) { addToast('Inventory full', 'error'); return }
    }

    // Distribute the withdrawn share of the charge pool over the new slots
    // (Math.floor split, remainder on the last slot so no charge is lost).
    const withdrawnPool = poolCharges > 0 && newSlotIndices.length > 0
      ? (actualWithdrawn >= bankEntry.quantity
          ? poolCharges
          : Math.floor(poolCharges * actualWithdrawn / bankEntry.quantity))
      : 0
    if (withdrawnPool > 0) {
      const per = Math.floor(withdrawnPool / newSlotIndices.length)
      newSlotIndices.forEach((slotIdx, i) => {
        const charges = i === newSlotIndices.length - 1
          ? withdrawnPool - per * (newSlotIndices.length - 1)
          : per
        if (charges > 0) newInv[slotIdx] = { ...newInv[slotIdx], charges }
      })
    }

    const newBank = { ...bank }
    const updatedEntry = { ...bankEntry, quantity: bankEntry.quantity - actualWithdrawn }
    if (withdrawnPool > 0) {
      const remainingCharges = poolCharges - withdrawnPool
      if (remainingCharges > 0) updatedEntry.charges = remainingCharges
      else delete updatedEntry.charges
    }
    if (updatedEntry.quantity <= 0) {
      delete newBank[itemId]
      updateBankConfig({
        tabs,
        itemTabMap,
        allTabName,
        placeholders: { ...placeholders, [itemId]: true },
      })
    } else {
      newBank[itemId] = updatedEntry
    }

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
    updateBankConfig({ tabs: [...tabs, name], itemTabMap, allTabName, placeholders })
    setActiveTab(tabs.length + 1)
  }

  const confirmRename = () => {
    if (tabMenu === null) return
    const trimmed = renameValue.trim()
    if (tabMenu === 0) {
      updateBankConfig({ tabs, itemTabMap, allTabName: trimmed || allTabName, placeholders })
    } else {
      const newTabs = [...tabs]
      newTabs[tabMenu - 1] = trimmed || tabs[tabMenu - 1]
      updateBankConfig({ tabs: newTabs, itemTabMap, allTabName, placeholders })
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
    updateBankConfig({ tabs: newTabs, itemTabMap: newMap, allTabName, placeholders })
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
    updateBankConfig({ tabs, itemTabMap: newMap, allTabName, placeholders })
    setSelectedId(null)
  }

  const handleSell = async (qty, overridePrice = null) => {
    if (!selected || sellBusy) return

    // Re-verify the item still exists in the bank with the correct quantity
    const bankEntry = bank[selected.itemId]
    if (!bankEntry || bankEntry.quantity <= 0) {
      addToast('Item no longer in bank', 'error')
      setSelectedId(null)
      return
    }

    const item = itemsData[selected.itemId]
    if (!item) return
    const defaultPrice = Math.floor(Number(item.shopValue) || 0)
    const price = Math.floor(Number(overridePrice ?? defaultPrice) || 0)
    if (price <= 0) {
      addToast('This item has no value', 'error')
      setSelectedId(null)
      return
    }
    if (!hasCloudAccount) {
      addToast('Selling requires a cloud-synced character', 'error')
      setSelectedId(null)
      return
    }

    // Use the current bank quantity, not the stale selected state
    const sellQty = Math.max(1, Math.min(Number(qty) || 1, bankEntry.quantity))

    setSellBusy(true)
    try {
      // Flush the current local save to the server first so the server-side
      // sell operates on an up-to-date bank (e.g. items just deposited locally
      // before the 60s autosave fires). Then the server removes the items from
      // the BANK directly via source: 'bank' — no local bank→inventory shuffle,
      // which is what previously caused the duplicate / stale-state bugs.
      await pushNow(getSnapshot())

      if (isIronman || item.isUntradeable) {
        await api.tradingPostSellImmediate(selected.itemId, sellQty, 'bank')
        const cloud = await pullSave()
        if (cloud?.payload) await applyCloudSave(cloud.payload, cloud.updatedAt)
        await loadGame()
        addToast(`Sold ${sellQty} × ${item.name} for ${(sellQty * price).toLocaleString()} gp`, 'info')
      } else {
        const res = await api.tradingPostList('sell', selected.itemId, price, sellQty, 'bank')
        const cloud = await pullSave()
        if (cloud?.payload) await applyCloudSave(cloud.payload, cloud.updatedAt)
        await loadGame()
        const sold = Number(res?.matched_quantity) || 0
        const remaining = Number(res?.remaining) || 0
        const earned = Number(res?.total_earned) || 0
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
      setSelectedId(null)
    }
  }

  const handleCustomListSubmit = async () => {
    if (!selected) return
    const qty = Math.floor(Number(listQtyInput) || 0)
    const price = Math.floor(Number(listPriceInput) || 0)
    await handleSell(qty, price)
  }

  const clearPlaceholder = (itemId) => {
    const newMap = { ...itemTabMap }
    const newPlaceholders = { ...placeholders }
    delete newMap[itemId]
    delete newPlaceholders[itemId]
    updateBankConfig({ tabs, itemTabMap: newMap, allTabName, placeholders: newPlaceholders })
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
    updateBankConfig({ tabs, itemTabMap: newMap, allTabName, placeholders })
  }

  // Auto-scroll the item grid while dragging near its top/bottom edge so items
  // can be dropped beyond the currently visible viewport.
  const EDGE_ZONE = 56   // px from each edge that triggers scrolling
  const MAX_SCROLL_SPEED = 14 // px per frame at the very edge

  const stopAutoScroll = () => {
    if (autoScrollRef.current != null) {
      cancelAnimationFrame(autoScrollRef.current)
      autoScrollRef.current = null
    }
  }

  const updateAutoScroll = (clientY) => {
    const el = scrollRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    let velocity = 0
    if (clientY < rect.top + EDGE_ZONE) {
      const intensity = (rect.top + EDGE_ZONE - clientY) / EDGE_ZONE
      velocity = -MAX_SCROLL_SPEED * Math.min(1, intensity)
    } else if (clientY > rect.bottom - EDGE_ZONE) {
      const intensity = (clientY - (rect.bottom - EDGE_ZONE)) / EDGE_ZONE
      velocity = MAX_SCROLL_SPEED * Math.min(1, intensity)
    }

    if (velocity === 0) {
      stopAutoScroll()
      return
    }

    if (autoScrollRef.current == null) {
      const step = () => {
        const d = dragRef.current
        const target = scrollRef.current
        if (!d || !d.isDragging || !target) {
          autoScrollRef.current = null
          return
        }
        target.scrollTop += d.scrollVelocity || 0
        autoScrollRef.current = requestAnimationFrame(step)
      }
      autoScrollRef.current = requestAnimationFrame(step)
    }
    if (dragRef.current) dragRef.current.scrollVelocity = velocity
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

      updateAutoScroll(e.clientY)
    }
  }

  const handleDragEnd = (e, itemId) => {
    const d = dragRef.current
    if (!d || d.itemId !== itemId) return

    stopAutoScroll()
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
    stopAutoScroll()
    if (d.ghostEl) d.ghostEl.remove()
    setDraggingId(null)
    setOverItemId(null)
    overRef.current = null
    dragRef.current = null
  }

  // Clean up ghost + auto-scroll loop if component unmounts mid-drag
  useEffect(() => () => {
    if (dragRef.current?.ghostEl) dragRef.current.ghostEl.remove()
    if (autoScrollRef.current != null) cancelAnimationFrame(autoScrollRef.current)
  }, [])

  const displayItems = getDisplayItems()

  return (
    <div class="h-full flex flex-col overflow-hidden">

      {/* ── Header + Tab bar ─────────────────────────────────────────────── */}
      <div class="px-4 pt-4 pb-0 flex-shrink-0">
        <div class="flex items-center gap-2 mb-2">
          <h2 class="font-[var(--font-display)] text-sm font-bold text-[var(--color-parchment)] opacity-60 uppercase tracking-wider flex-shrink-0">
            Bank ({bankItems.length})
          </h2>
          <div class="flex-1 min-w-0 flex justify-center">
            <div class="flex items-center bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg px-2.5 py-1.5 w-full max-w-[128px]">
              <input
                type="text"
                value={searchTerm}
                onInput={(e) => setSearchTerm(e.target.value)}
                placeholder="Search..."
                class="flex-1 min-w-0 bg-transparent text-xs text-[var(--color-parchment)] outline-none placeholder:opacity-30"
              />
              {searchTerm && (
                <button
                  onClick={() => setSearchTerm('')}
                  class="relative z-10 text-[var(--color-parchment)] opacity-40 hover:opacity-70 active:opacity-80 text-[12px] ml-1 flex-shrink-0"
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
            <span class="hidden sm:inline">✏️ Edit tab</span>
            <span class="sm:hidden">✏️</span>
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
      <div ref={scrollRef} class="flex-1 overflow-y-auto px-4 pb-4">
        {displayItems.length === 0 ? (
          <div class="text-center py-12 text-[var(--color-parchment)] opacity-30 text-sm">
            {activeTab === 0
              ? (bankItems.length > 0 ? 'All items are in tabs' : 'Your bank is empty')
              : 'No items — tap an item and use "Move to Tab"'}
          </div>
        ) : (
          <div class="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 xl:grid-cols-12 gap-2">
            {displayItems.map(entry => {
              const item = itemsData[entry.itemId]
              if (!item) return null
              const isDragging = draggingId === entry.itemId
              const isOver = overItemId === entry.itemId
              const isInactivePlaceholder = !!entry.inactivePlaceholder
              const { text, isM } = formatQuantity(entry.quantity)

              return (
                <div
                  key={entry.itemId}
                  data-bank-item-id={entry.itemId}
                  class="relative"
                >
                  <button
                    onClick={() => !isInactivePlaceholder && setSelectedId(entry.itemId)}
                    class={`w-full flex flex-col items-center p-2 rounded-lg border select-none ${
                      isDragging
                        ? 'opacity-30 border-[#444] bg-[#1a1a1a]'
                        : isOver
                          ? 'bg-[#252520] border-[var(--color-gold)]'
                          : isInactivePlaceholder
                            ? 'bg-[#141414] border-[#2a2a2a] opacity-45'
                            : 'bg-[#1a1a1a] border-[#2a2a2a] active:bg-[#222]'
                    }`}
                  >
                    <GameIcon item={item} size={22} />
                    <span class="text-[8px] text-[var(--color-parchment)] opacity-60 truncate w-full text-center">{item.name}</span>
                    <span class={`text-[9px] font-[var(--font-mono)] font-bold ${isInactivePlaceholder ? 'text-[#8a8a8a]' : (isM ? 'text-[var(--color-emerald)]' : 'text-[var(--color-gold)]')}`}>{isInactivePlaceholder ? '\u00A0' : `×${text}`}</span>
                  </button>

                  {/* Drag handle — shown in all tabs */}
                  {isInactivePlaceholder ? (
                    <button
                      onClick={() => clearPlaceholder(entry.itemId)}
                      class="absolute top-0.5 right-0.5 text-[11px] text-[#c8c8c8] opacity-80 leading-none select-none z-10 px-1 py-0.5 rounded bg-[#2a2a2a] hover:opacity-100 active:opacity-100"
                      aria-label={`Clear placeholder for ${item.name}`}
                    >
                      ✕
                    </button>
                  ) : (
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
                  )}
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
          <SharedItemModal item={selItem} quantity={selected.quantity} title={selItem?.name || selected.itemId} onClose={() => setSelectedId(null)}>
            <div class="space-y-3">

              {/* Quantity in bank */}
              <div class="text-center text-sm text-[var(--color-parchment)] opacity-60">
                In bank: {(() => {
                  const { text, isM } = formatQuantity(selected.quantity)
                  return <span class={`font-[var(--font-mono)] ${isM ? 'text-[var(--color-emerald)]' : 'text-[var(--color-gold)]'}`}>{text}</span>
                })()}
              </div>

              {/* Tab assignment — only shown when tabs exist — moved here */}
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

              {/* Sell section */}
              {selItem?.shopValue > 0 && selItem?.type !== 'currency' && (() => {
                const useQuickSell = isIronman || selItem?.isUntradeable || !isOrderBookItem(selItem)
                return (
                  <div class="border-t border-[#333] pt-2">
                    <p class="text-[10px] text-[var(--color-parchment)] opacity-40 mb-1.5 uppercase tracking-wider font-bold">
                      {useQuickSell ? 'Sell' : 'Trading Post Listing'}
                    </p>
                    {!useQuickSell && (
                      <p class="text-[10px] text-[var(--color-parchment)] opacity-50 mb-1.5">
                        Listing at {selItem?.shopValue.toLocaleString()} gp · paid only when sold.
                      </p>
                    )}
                    {useQuickSell && (
                      <div class="grid grid-cols-3 gap-2">
                        {[1, 5, 10].map(qty => (
                          <button key={qty} onClick={() => handleSell(qty)}
                            disabled={selected.quantity < qty || sellBusy}
                            class={`py-2 rounded-lg text-white font-semibold text-sm ${selected.quantity < qty || sellBusy ? 'bg-[#222] opacity-30' : 'bg-[var(--color-gold-dim)] active:opacity-80'}`}>
                            Sell {qty}
                          </button>
                        ))}
                        <button onClick={() => handleSell(selected.quantity)}
                          disabled={sellBusy}
                          class={`py-2 rounded-lg text-white font-semibold text-sm col-span-3 ${sellBusy ? 'bg-[#222] opacity-30' : 'bg-[var(--color-gold-dim)] active:opacity-80'}`}>
                          Sell All ({selected.quantity * selItem?.shopValue} gp)
                        </button>
                      </div>
                    )}
                    {!useQuickSell && (
                      <TradingPostSellForm
                        qty={listQtyInput}
                        setQty={setListQtyInput}
                        price={listPriceInput}
                        setPrice={setListPriceInput}
                        maxQty={selected.quantity}
                        busy={sellBusy}
                        onCancel={() => setSelectedId(null)}
                        onSubmit={handleCustomListSubmit}
                      />
                    )}
                  </div>
                )
              })()}

            </div>
          </SharedItemModal>
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
