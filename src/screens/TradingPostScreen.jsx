import { useState, useEffect, useMemo, useRef } from 'preact/hooks'
import { useGame } from '../state/gameState.jsx'
import { countItem } from '../engine/inventory.js'
import { api, getToken, getCharacterId } from '../cloud/api.js'
import { isOrderBookItem, getPurchaseRestriction, isStoreVisibleItem } from '../engine/storeRules.js'
import Panel from '../components/Panel.jsx'
import SharedItemModal from '../components/SharedItemModal.jsx'
import ItemDetailPanel from '../components/ItemDetailPanel.jsx'
import TwoPaneLayout from '../components/TwoPaneLayout.jsx'
import Button from '../components/Button.jsx'
import { useIsDesktop } from '../hooks/useIsDesktop.js'
import { pullSave, applyCloudSave, pushNow } from '../cloud/sync.js'
import questsData from '../data/quests.json'
import minigamesData from '../data/minigames.json'

const MAX_SLOTS = 8
const GENERAL_BUY_MULTIPLIER = 1.1
const MINIGAME_UNLOCK_STORE_PRICE = 4_500_000
const INSTANT_SELL_FRACTION = 0.8

function generalStoreBuyPrice(item) {
  if (!item) return 0
  return Math.floor((Number(item.shopValue) || 0) * GENERAL_BUY_MULTIPLIER)
}

function generalStoreSellPrice(item) {
  if (!item) return 0
  return Math.floor(Number(item.shopValue) || 0)
}

// Mode is 'market' (search) or 'offers' (my 3 slots).
export default function TradingPostScreen({ onBuyCredits }) {
  const {
    inventory,
    bank,
    addToast,
    itemsData,
    isIronman,
    unlockedFeatures,
    unlockedMinigameItems,
    completedQuests,
    loadGame,
    getSnapshot,
  } = useGame()
  const isDesktop = useIsDesktop()

  const [mode, setMode] = useState('market')
  const [searchTerm, setSearchTerm] = useState('')
  const [selected, setSelected] = useState(null) // item entry from search
  const [pendingAction, setPendingAction] = useState(null) // 'buy' | 'sell'
  const [qty, setQty] = useState(1)
  const [bidPrice, setBidPrice] = useState(0)
  const [busy, setBusy] = useState(false)
  const [marketData, setMarketData] = useState({}) // item_id -> { bestSell, bestBuy, totalListedQuantity }
  const [myOffers, setMyOffers] = useState([])
  const [offersLoaded, setOffersLoaded] = useState(false)
  const searchAbortRef = useRef(0)

  const hasMoneyPurse = unlockedFeatures.has('money_purse')
  const coinsInInv = countItem(inventory, 'coins')
  const coinsInBank = bank['coins']?.quantity || 0
  const coins = hasMoneyPurse ? coinsInInv + coinsInBank : coinsInInv

  const questMap = useMemo(() => questsData.reduce((acc, q) => { acc[q.id] = q.name; return acc }, {}), [])

  const minigameProductIds = useMemo(() => new Set(
    (minigamesData.tasks || []).flatMap((t) => (Array.isArray(t.rewardItems) && t.rewardItems.length > 0 ? t.rewardItems : [t.product])).filter(Boolean),
  ), [])

  // Pre-index searchable items once -- 24K-line items.json justifies the cost.
  const searchablePool = useMemo(() => {
    const pool = []
    for (const [id, item] of Object.entries(itemsData)) {
      if (!item || (item.id && item.id !== id)) continue
      if (!isStoreVisibleItem(item, { isIronman: false, includeQuestItems: true })) continue
      pool.push({ id, item, lower: (item.name || '').toLowerCase() })
    }
    return pool
  }, [itemsData])

  const refreshMyOffers = async () => {
    try {
      const res = await api.tradingPostMyOffers()
      setMyOffers(res?.offers || [])
      setOffersLoaded(true)
      // Sweep may have delivered coins/items into the save -- pull authoritative state.
      const cloud = await pullSave()
      if (cloud?.payload) await applyCloudSave(cloud.payload, cloud.updatedAt)
      await loadGame()
    } catch (err) {
      addToast(`Failed to load offers: ${err.message}`, 'error')
    }
  }

  useEffect(() => {
    if (isIronman) return
    if (!getToken() || !getCharacterId()) return
    refreshMyOffers()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const searchResults = useMemo(() => {
    const term = searchTerm.trim().toLowerCase()
    if (!term) return []
    return searchablePool
      .filter((row) => row.lower.includes(term))
      .slice(0, 40)
      .map((row) => ({ ...row.item, id: row.id }))
  }, [searchTerm, searchablePool])

  // Fetch live market data for visible order-book items in the result set.
  useEffect(() => {
    if (isIronman) return
    if (!getToken() || !getCharacterId()) return
    const orderBookIds = searchResults.filter((r) => isOrderBookItem(r)).map((r) => r.id)
    if (orderBookIds.length === 0) return
    const token = ++searchAbortRef.current
    api.tradingPostSearch(orderBookIds).then((res) => {
      if (token !== searchAbortRef.current) return
      setMarketData((prev) => ({ ...prev, ...(res?.market || {}) }))
    }).catch(() => { /* non-fatal */ })
  }, [searchResults, isIronman])

  const openItem = (item, action) => {
    setSelected(item)
    setPendingAction(action)
    setQty(1)
    const orderBook = isOrderBookItem(item)
    if (orderBook) {
      // Seed with a sensible default: best opposing price if available, else
      // the static shopValue. Player can edit.
      const m = marketData[item.id] || {}
      const fallback = Math.max(1, Number(item.shopValue) || 1)
      if (action === 'buy') setBidPrice(m.bestSell?.price || fallback)
      else setBidPrice(m.bestBuy?.price || fallback)
    } else {
      setBidPrice(action === 'buy' ? generalStoreBuyPrice(item) : generalStoreSellPrice(item))
    }
  }

  const closeModal = () => {
    setSelected(null)
    setPendingAction(null)
    setQty(1)
    setBidPrice(0)
  }

  if (isIronman) {
    return (
      <div class="h-full flex flex-col items-center justify-center p-8 text-center">
        <div class="text-[var(--color-gold)] text-[15px] font-bold mb-2">⚔️ Trading Post Unavailable</div>
        <div class="text-[12px] text-[var(--color-parchment)] opacity-70 max-w-md">
          Ironman characters cannot use the trading post. All gear must be acquired through gameplay.
        </div>
      </div>
    )
  }

  if (!getToken() || !getCharacterId()) {
    return (
      <div class="h-full flex flex-col items-center justify-center p-8 text-center">
        <div class="text-[var(--color-gold)] text-[15px] font-bold mb-2">☁️ Cloud Account Required</div>
        <div class="text-[12px] text-[var(--color-parchment)] opacity-70 max-w-md">
          The trading post is a shared marketplace and requires a cloud-synced character. Sign in to access it.
        </div>
      </div>
    )
  }

  // ── BUY HANDLER ──────────────────────────────────────────────────────────
  const handleBuy = async () => {
    if (!selected || busy) return
    setBusy(true)
    try {
      // Flush local state (esp. coins) so the server-side escrow sees the
      // player's true balance rather than a stale ≤60s-old snapshot.
      try { await pushNow(getSnapshot()) } catch (_) { /* ignore push failure */ }
      if (isOrderBookItem(selected)) {
        const totalCoinsRequired = bidPrice * qty
        if (coins < totalCoinsRequired) {
          addToast('Insufficient coins for that offer.', 'error')
          setBusy(false)
          return
        }
        const res = await api.tradingPostList('buy', selected.id, bidPrice, qty)
        const cloud = await pullSave()
        if (cloud?.payload) await applyCloudSave(cloud.payload, cloud.updatedAt)
        await loadGame()
        const filled = res?.matched_quantity || 0
        const remaining = res?.remaining ?? 0
        if (filled > 0 && remaining === 0) {
          addToast(`Matched ${filled} × ${selected.name} — collect them from "My Offers".`, 'success')
        } else if (filled > 0 && remaining > 0) {
          addToast(`Matched ${filled} (ready to collect); ${remaining} still listed at ${bidPrice.toLocaleString()} gp.`, 'success')
        } else {
          addToast(`Buy offer listed for ${qty} × ${selected.name}.`, 'info')
        }
        await refreshMyOffers()
        closeModal()
      } else {
        // General-store path -- legacy /api/purchase endpoint.
        const r = getPurchaseRestriction(selected, { isIronman: false, allowMinigameUnlockPurchase: minigameProductIds.has(selected.id) && unlockedMinigameItems.has(selected.id) })
        if (!r.allowed) {
          addToast(r.message || 'This item cannot be purchased here.', 'error')
          setBusy(false)
          return
        }
        await api.purchaseItem(selected.id, qty, [...unlockedMinigameItems])
        const cloud = await pullSave()
        if (cloud?.payload) await applyCloudSave(cloud.payload, cloud.updatedAt)
        await loadGame()
        addToast(`Bought ${qty} × ${selected.name}.`, 'success')
        closeModal()
      }
    } catch (err) {
      if (err?.body?.code === 'TRADING_POST_SLOTS_FULL') addToast(err.body.error, 'error')
      else if (err?.body?.code === 'IRONMAN_RESTRICTED') addToast(err.body.error, 'error')
      else if (err?.body?.code === 'INSUFFICIENT_COINS') addToast('Insufficient coins.', 'error')
      else addToast(`Buy failed: ${err.message}`, 'error')
    } finally {
      setBusy(false)
    }
  }

  // ── SELL HANDLER ─────────────────────────────────────────────────────────
  const handleSell = async () => {
    if (!selected || busy) return
    setBusy(true)
    try {
      const ownedQty = countItem(inventory, selected.id)
      if (ownedQty < qty) {
        addToast(`You only have ${ownedQty} in your inventory.`, 'error')
        setBusy(false)
        return
      }
      // Flush local inventory state so the server-side escrow sees the right
      // slot contents (e.g. items moved out of bank recently).
      try { await pushNow(getSnapshot()) } catch (_) { /* ignore push failure */ }
      if (isOrderBookItem(selected)) {
        const res = await api.tradingPostList('sell', selected.id, bidPrice, qty)
        const cloud = await pullSave()
        if (cloud?.payload) await applyCloudSave(cloud.payload, cloud.updatedAt)
        await loadGame()
        const sold = res?.matched_quantity || 0
        const earned = Number(res?.total_earned) || 0
        const remaining = res?.remaining ?? 0
        if (sold > 0 && remaining === 0) {
          addToast(`Matched ${sold} × ${selected.name} — collect ${earned.toLocaleString()} gp from "My Offers".`, 'success')
        } else if (sold > 0 && remaining > 0) {
          addToast(`Matched ${sold} (collect ${earned.toLocaleString()} gp); ${remaining} still listed at ${bidPrice.toLocaleString()} gp.`, 'success')
        } else {
          addToast(`Sell offer listed for ${qty} × ${selected.name}.`, 'info')
        }
        await refreshMyOffers()
        closeModal()
      } else {
        if (!selected.shopValue || selected.shopValue <= 0) {
          addToast('This item cannot be sold.', 'error')
          setBusy(false)
          return
        }
        await api.tradingPostSellImmediate(selected.id, qty)
        const cloud = await pullSave()
        if (cloud?.payload) await applyCloudSave(cloud.payload, cloud.updatedAt)
        await loadGame()
        addToast(`Sold ${qty} × ${selected.name}.`, 'success')
        closeModal()
      }
    } catch (err) {
      if (err?.body?.code === 'TRADING_POST_SLOTS_FULL') addToast(err.body.error, 'error')
      else if (err?.body?.code === 'INSUFFICIENT_SUPPLIES') addToast('You don\'t have that many to sell.', 'error')
      else addToast(`Sell failed: ${err.message}`, 'error')
    } finally {
      setBusy(false)
    }
  }

  const handleCancel = async (offerId) => {
    if (busy) return
    setBusy(true)
    try {
      await api.tradingPostCancel(offerId)
      const cloud = await pullSave()
      if (cloud?.payload) await applyCloudSave(cloud.payload, cloud.updatedAt)
      await loadGame()
      await refreshMyOffers()
      addToast('Offer cancelled.', 'info')
    } catch (err) {
      addToast(`Cancel failed: ${err.message}`, 'error')
    } finally {
      setBusy(false)
    }
  }

  const handleInstantSell = async (offerId) => {
    if (busy) return
    setBusy(true)
    try {
      const res = await api.tradingPostInstantSell(offerId)
      const cloud = await pullSave()
      if (cloud?.payload) await applyCloudSave(cloud.payload, cloud.updatedAt)
      await loadGame()
      await refreshMyOffers()
      addToast(`Instant-sold for ${Number(res?.payout || 0).toLocaleString()} gp (-20%).`, 'success')
    } catch (err) {
      addToast(`Instant sell failed: ${err.message}`, 'error')
    } finally {
      setBusy(false)
    }
  }

  const handleCollect = async (offer) => {
    if (busy) return
    setBusy(true)
    try {
      const res = await api.tradingPostCollect(offer.id)
      const cloud = await pullSave()
      if (cloud?.payload) await applyCloudSave(cloud.payload, cloud.updatedAt)
      await loadGame()
      await refreshMyOffers()
      const coins = Number(res?.coins_collected) || 0
      const items = Number(res?.items_collected) || 0
      const item = itemsData[offer.item_id]
      const name = item?.name || offer.item_id
      if (coins > 0 && items > 0) {
        addToast(`Collected ${coins.toLocaleString()} gp + ${items} × ${name}.`, 'success')
      } else if (coins > 0) {
        addToast(`Collected ${coins.toLocaleString()} gp.`, 'success')
      } else if (items > 0) {
        addToast(`Collected ${items} × ${name}.`, 'success')
      } else {
        addToast('Nothing to collect.', 'info')
      }
    } catch (err) {
      addToast(`Collect failed: ${err.message}`, 'error')
    } finally {
      setBusy(false)
    }
  }

  // ── RENDERING ────────────────────────────────────────────────────────────
  const renderListRow = (item) => {
    const orderBook = isOrderBookItem(item)
    const restriction = getPurchaseRestriction(item, { isIronman: false })
    const buyDisabledReason = (() => {
      if (item.questUnlock && !completedQuests.has(item.questUnlock)) return `🔒 ${questMap[item.questUnlock] || 'Quest required'}`
      if (minigameProductIds.has(item.id) && !unlockedMinigameItems.has(item.id)) return '🔒 Earn from minigame first'
      if (!orderBook && !restriction.allowed && restriction.code !== 'BOSS_UNIQUE_RESTRICTED' && restriction.code !== 'CLUE_REWARD_RESTRICTED') return restriction.message
      return null
    })()
    const owned = countItem(inventory, item.id)
    const m = marketData[item.id]
    const priceLabel = orderBook
      ? (m?.bestSell ? `From ${m.bestSell.price.toLocaleString()} gp` : 'No sellers')
      : `${generalStoreBuyPrice(item).toLocaleString()} gp`
    return (
      <div key={item.id} class="p-3 rounded-lg bg-[var(--color-void-light)] border border-[#2a2a2a] flex items-center gap-3">
        <span class="text-2xl leading-none shrink-0">{item.icon || '📦'}</span>
        <div class="flex-1 min-w-0">
          <div class="text-[13px] font-semibold text-[var(--color-parchment)]">{item.name}</div>
          <div class="text-[10px] text-[#888] mt-1">
            {orderBook ? 'Order book' : 'General store'}
            {owned > 0 && <span class="ml-2">· You have {owned}</span>}
          </div>
          {buyDisabledReason && <div class="text-[10px] text-[#a77] mt-1">{buyDisabledReason}</div>}
        </div>
        <div class="text-right shrink-0">
          <div class="text-[11px] font-[var(--font-mono)] text-[var(--color-gold)]">{priceLabel}</div>
          <div class="flex gap-1 mt-1">
            <Button variant="primary" size="sm" onClick={() => openItem(item, 'buy')} disabled={!!buyDisabledReason}>Buy</Button>
            <Button variant="secondary" size="sm" onClick={() => openItem(item, 'sell')} disabled={owned <= 0}>Sell</Button>
          </div>
        </div>
      </div>
    )
  }

  const renderMyOffersList = () => {
    // Active offers (still on the book) hold a slot; ready-to-collect rows
    // float above the slot grid so the player can see what's waiting on them.
    const activeOffers = myOffers.filter((o) => o.status === 'active')
    const readyOffers = myOffers.filter((o) => o.status === 'ready_to_collect')
    const slotsUsed = activeOffers.length

    const renderOffer = (offer, key) => {
      const item = itemsData[offer.item_id]
      const filled = offer.quantity_total - offer.quantity_remaining
      const isReady = offer.status === 'ready_to_collect'
      const coinsPending = Number(offer.coins_pending) || 0
      const itemsPending = Number(offer.items_pending) || 0
      const hasPending = coinsPending > 0 || itemsPending > 0
      const pendingLabel = (() => {
        if (!hasPending) return null
        if (offer.offer_type === 'buy') {
          return itemsPending > 0
            ? `${itemsPending} × ${item?.name || offer.item_id} ready`
            : null
        }
        return coinsPending > 0
          ? `${coinsPending.toLocaleString()} gp ready`
          : null
      })()
      const accentBorder = isReady ? 'border-[var(--color-gold)]' : 'border-[#2a2a2a]'
      return (
        <Panel key={key} className={`text-[12px] border ${accentBorder}`}>
          <div class="flex items-center gap-3">
            <span class="text-2xl">{item?.icon || '📦'}</span>
            <div class="flex-1 min-w-0">
              <div class="text-[13px] font-semibold text-[var(--color-parchment)]">
                {offer.offer_type === 'buy' ? 'Buy' : 'Sell'} {item?.name || offer.item_id}
              </div>
              <div class="text-[10px] text-[#888]">
                {offer.price.toLocaleString()} gp · {filled}/{offer.quantity_total} filled
              </div>
              {isReady && (
                <div class="text-[10px] text-[var(--color-gold)] font-semibold mt-0.5">
                  ✓ Ready to collect{pendingLabel ? ` — ${pendingLabel}` : ''}
                </div>
              )}
              {!isReady && pendingLabel && (
                <div class="text-[10px] text-[var(--color-gold)] mt-0.5">{pendingLabel}</div>
              )}
            </div>
          </div>
          <div class="flex gap-2 mt-3">
            {hasPending && (
              <Button variant="primary" size="sm" onClick={() => handleCollect(offer)} disabled={busy}>
                Collect
              </Button>
            )}
            {!isReady && (
              <Button variant="secondary" size="sm" onClick={() => handleCancel(offer.id)} disabled={busy}>Cancel</Button>
            )}
            {!isReady && offer.offer_type === 'sell' && offer.quantity_remaining > 0 && (
              <Button variant="secondary" size="sm" onClick={() => handleInstantSell(offer.id)} disabled={busy}>
                Instant Sell (−20%)
              </Button>
            )}
          </div>
        </Panel>
      )
    }

    return (
      <div class="flex flex-col gap-2 px-4 pt-3 pb-20 md:pb-4">
        {readyOffers.length > 0 && (
          <>
            <div class="text-[11px] text-[var(--color-gold)] font-semibold mb-1">Ready to collect</div>
            {readyOffers.map((o) => renderOffer(o, `ready-${o.id}`))}
            <div class="h-2" />
          </>
        )}
        <div class="text-[11px] text-[#888] mb-1">Slots: {slotsUsed}/{MAX_SLOTS} active</div>
        {Array.from({ length: MAX_SLOTS }).map((_, idx) => {
          const offer = activeOffers[idx]
          if (!offer) {
            return (
              <Panel key={`empty-${idx}`} className="text-center text-[12px] text-[#666] py-4">
                Empty slot
              </Panel>
            )
          }
          return renderOffer(offer, `active-${offer.id}`)
        })}
      </div>
    )
  }

  const detailModal = selected ? (() => {
    const orderBook = isOrderBookItem(selected)
    const m = marketData[selected.id] || {}
    const ownedQty = countItem(inventory, selected.id)
    const isBuy = pendingAction === 'buy'
    const summary = orderBook
      ? (
        <div class="text-[11px] text-[#888] space-y-1">
          <div>Best sell: {m.bestSell ? `${m.bestSell.price.toLocaleString()} gp × ${m.bestSell.quantity}` : '—'}</div>
          <div>Best buy: {m.bestBuy ? `${m.bestBuy.price.toLocaleString()} gp × ${m.bestBuy.quantity}` : '—'}</div>
          <div>Total listed: {m.totalListedQuantity || 0}</div>
        </div>
      )
      : null
    const isQuestLocked = selected.questUnlock && !completedQuests.has(selected.questUnlock)
    const isMinigameLocked = minigameProductIds.has(selected.id) && !unlockedMinigameItems.has(selected.id)
    const buyLocked = isBuy && (isQuestLocked || isMinigameLocked)
    return (
      <div class="space-y-3">
        {summary && <Panel>{summary}</Panel>}
        {!isBuy && ownedQty < 1 && (
          <Panel className="text-[11px] text-[#a77]">You don't own any of this item to sell.</Panel>
        )}
        {buyLocked && (
          <Panel className="text-[11px] text-[#a77]">
            🔒 {isQuestLocked ? `Complete ${questMap[selected.questUnlock]} to unlock this item.` : 'Earn this from the minigame once before purchasing.'}
          </Panel>
        )}
        {orderBook && (
          <div class="flex flex-col gap-2">
            <div class="text-[12px] text-[#888]">Price per item (gp)</div>
            <input
              type="number"
              min="1"
              value={bidPrice}
              onInput={(e) => setBidPrice(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
              class="h-9 rounded-md bg-[#111] border border-[var(--color-void-border)] text-[var(--color-parchment)] text-[13px] font-[var(--font-mono)] text-center px-2 outline-none"
            />
          </div>
        )}
        <div class="flex flex-col gap-2">
          <div class="text-[12px] text-[#888]">Quantity</div>
          <div class="flex gap-2 items-center">
            <Button variant="secondary" size="md" onClick={() => setQty(Math.max(1, qty - 1))} className="w-8 h-8 p-0 flex items-center justify-center text-base">−</Button>
            <input
              type="number"
              min="1"
              value={qty}
              onInput={(e) => setQty(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
              class="flex-1 h-9 rounded-md bg-[#111] border border-[var(--color-void-border)] text-[var(--color-parchment)] text-[13px] font-[var(--font-mono)] text-center outline-none"
            />
            <Button variant="secondary" size="md" onClick={() => setQty(qty + 1)} className="w-8 h-8 p-0 flex items-center justify-center text-base">+</Button>
          </div>
          {!isBuy && (
            <button class="text-[10px] text-[#888] underline self-start" onClick={() => setQty(Math.max(1, ownedQty))}>Use max ({ownedQty})</button>
          )}
        </div>
        <Panel className="text-[12px] flex justify-between">
          <span class="text-[#888]">Total {isBuy ? 'cost' : 'payout'}</span>
          <span class="text-[var(--color-gold)] font-[var(--font-mono)] font-bold">
            {orderBook
              ? `≤ ${(bidPrice * qty).toLocaleString()} gp`
              : (isBuy
                  ? `${(generalStoreBuyPrice(selected) * qty).toLocaleString()} gp`
                  : `${(generalStoreSellPrice(selected) * qty).toLocaleString()} gp`)}
          </span>
        </Panel>
        <div class="flex gap-2">
          <Button variant="secondary" size="lg" onClick={closeModal} className="flex-1">Cancel</Button>
          <Button
            variant="primary"
            size="lg"
            onClick={isBuy ? handleBuy : handleSell}
            disabled={busy || buyLocked || (!isBuy && ownedQty < qty)}
            className="flex-1"
          >
            {busy ? '…' : (isBuy ? 'Place Buy' : 'Place Sell')}
          </Button>
        </div>
      </div>
    )
  })() : null

  return (
    <div class="h-full flex flex-col overflow-hidden">
      <div class="px-4 pt-3 pb-3 flex-shrink-0">
        <div class="flex justify-between items-baseline mb-3">
          <h2 class="font-[var(--font-display)] text-[15px] font-bold text-[var(--color-gold)] m-0">Trading Post</h2>
          <span class="text-[11px] text-[var(--color-gold)] font-[var(--font-mono)]">🪙 {coins.toLocaleString()}</span>
        </div>
        <div class="flex gap-2 mb-3">
          <button
            onClick={() => setMode('market')}
            class={`px-3 py-[5px] rounded-[20px] text-[11px] font-semibold border ${
              mode === 'market'
                ? 'border-[var(--color-gold)] bg-[rgba(212,175,55,0.15)] text-[var(--color-gold)]'
                : 'border-[#2a2a2a] bg-[var(--color-void-light)] text-[var(--color-parchment)] opacity-60'
            }`}
          >🔍 Market</button>
          <button
            onClick={() => { setMode('offers'); refreshMyOffers() }}
            class={`px-3 py-[5px] rounded-[20px] text-[11px] font-semibold border ${
              mode === 'offers'
                ? 'border-[var(--color-gold)] bg-[rgba(212,175,55,0.15)] text-[var(--color-gold)]'
                : 'border-[#2a2a2a] bg-[var(--color-void-light)] text-[var(--color-parchment)] opacity-60'
            }`}
          >📦 My Offers {offersLoaded ? `(${myOffers.filter((o) => o.status === 'active').length}/${MAX_SLOTS})` : ''}
            {offersLoaded && myOffers.some((o) => o.status === 'ready_to_collect') && (
              <span class="ml-1 inline-block min-w-[16px] h-[16px] leading-[16px] px-1 rounded-full text-[10px] font-bold bg-[var(--color-gold)] text-[var(--color-void)] align-middle">
                {myOffers.filter((o) => o.status === 'ready_to_collect').length}
              </span>
            )}
          </button>
        </div>
        {mode === 'market' && (
          <input
            type="text"
            placeholder="Search for an item to buy or sell…"
            value={searchTerm}
            onInput={(e) => setSearchTerm(e.target.value)}
            class="w-full px-3 py-2 rounded-lg border border-[#2a2a2a] bg-[#111] text-[var(--color-parchment)] text-[13px] outline-none"
          />
        )}
      </div>

      {mode === 'market' ? (
        <div class="h-full overflow-y-auto px-4 pb-20 md:pb-4">
          {!searchTerm.trim() ? (
            <div class="py-10 px-4 text-center text-[#888] text-[12px]">
              Search by item name to view market prices and listings.
            </div>
          ) : searchResults.length === 0 ? (
            <div class="py-10 px-4 text-center text-[#888] text-[12px]">No items match "{searchTerm}".</div>
          ) : (
            <div class="flex flex-col gap-2 pt-3">
              {searchResults.map(renderListRow)}
            </div>
          )}
        </div>
      ) : (
        <div class="h-full overflow-y-auto">
          {renderMyOffersList()}
        </div>
      )}

      {selected && (
        <SharedItemModal
          item={selected}
          title={`${pendingAction === 'buy' ? 'Buy' : 'Sell'}: ${selected.name}`}
          onClose={closeModal}
        >
          {detailModal}
        </SharedItemModal>
      )}
    </div>
  )
}
