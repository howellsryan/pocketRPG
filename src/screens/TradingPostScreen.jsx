import { useState, useEffect, useMemo, useRef } from 'preact/hooks'
import { useGame } from '../state/gameState.jsx'
import { countItem, buyWithShards } from '../engine/inventory.js'
import { questRequirementMet } from '../engine/questGates.js'
import { api, getToken, getCharacterId } from '../cloud/api.js'
import { isOrderBookItem, getPurchaseRestriction } from '../engine/storeRules.js'
import { isSlayerStoreItem } from '../engine/slayerUnlocks.js'
import { getLevelFromXP } from '../engine/experience.js'
import { ALL_SKILLS, MAX_TOTAL_LEVEL } from '../utils/constants.js'
import Panel from '../components/Panel.jsx'
import GameIcon from '../components/GameIcon.jsx'
import SharedItemModal from '../components/SharedItemModal.jsx'
import ItemDetailPanel from '../components/ItemDetailPanel.jsx'
import TwoPaneLayout from '../components/TwoPaneLayout.jsx'
import BackLink from '../components/BackLink.jsx'
import Button from '../components/Button.jsx'
import SellConfirmModal from '../components/SellConfirmModal.jsx'
import { HIGH_VALUE_SELL_THRESHOLD } from '../utils/constants.js'
import { useIsDesktop } from '../hooks/useIsDesktop.js'
import { pullSave, applyCloudSave, pushNow, checkCloudNewer } from '../cloud/sync.js'
import { ensureSaveDurable } from '../cloud/saveDurability.js'
import questsData from '../data/quests.json'
import minigamesData from '../data/minigames.json'

const MAX_SLOTS = 8
const MINIGAME_UNLOCK_STORE_PRICE = 4_500_000
const INSTANT_SELL_FRACTION = 0.8

function isReadyToCollectOffer(offer) {
  const coinsPending = Number(offer?.coins_pending) || 0
  const itemsPending = Number(offer?.items_pending) || 0
  const remaining = Number(offer?.quantity_remaining) || 0
  return remaining <= 0 && (coinsPending > 0 || itemsPending > 0)
}

// General-store (non-order-book) items — runes, skill capes, the max cape,
// quest-unlock items, minigame unlocks — are bought at their plain shop value,
// matching what /api/purchase debits. No markup.
function generalStoreBuyPrice(item) {
  if (!item) return 0
  return Math.floor(Number(item.shopValue) || 0)
}

function generalStoreSellPrice(item) {
  if (!item) return 0
  return Math.floor(Number(item.shopValue) || 0)
}

// Mode is 'market' (search) or 'offers' (my 3 slots).
// `onBack` (from App): returns to the screen the player came from.
export default function TradingPostScreen({ onBuyCredits, onBack }) {
  const {
    inventory,
    bank,
    stats,
    addToast,
    itemsData,
    isIronman,
    isOneLife,
    isGrindman,
    unlockedFeatures,
    unlockedMinigameItems,
    slayerStoreUnlocks,
    completedQuests,
    loadGame,
    getSnapshot,
    updateInventory,
  } = useGame()
  const isDesktop = useIsDesktop()

  // Ironman accounts are barred from the order book (Market / Offers / Listings)
  // but keep the General Store, so they open straight to — and stay on — Store.
  const [mode, setMode] = useState(isIronman ? 'store' : 'market')
  const [activeStoreSection, setActiveStoreSection] = useState(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [selected, setSelected] = useState(null) // item entry from search
  const [pendingAction, setPendingAction] = useState(null) // 'buy' | 'sell'
  const [qty, setQty] = useState(1)
  const [bidPrice, setBidPrice] = useState(0)
  const [busy, setBusy] = useState(false)
  const [marketData, setMarketData] = useState({}) // item_id -> { bestSell, bestBuy, totalListedQuantity }
  const [myOffers, setMyOffers] = useState([])
  const [offersLoaded, setOffersLoaded] = useState(false)
  const [allListings, setAllListings] = useState([])
  const [listingsLoaded, setListingsLoaded] = useState(false)
  const [listingsPage, setListingsPage] = useState(0)
  const [pendingHighValueSell, setPendingHighValueSell] = useState(false)
  const [shardglassMode, setShardglassMode] = useState(false)
  const searchAbortRef = useRef(0)
  const LISTINGS_PAGE_SIZE = 20

  const hasMoneyPurse = unlockedFeatures.has('money_purse')
  const coinsInInv = countItem(inventory, 'coins')
  const coinsInBank = bank['coins']?.quantity || 0
  const coins = hasMoneyPurse ? coinsInInv + coinsInBank : coinsInInv

  const questMap = useMemo(() => questsData.reduce((acc, q) => { acc[q.id] = q.name; return acc }, {}), [])

  const minigameProductIds = useMemo(() => new Set(
    (minigamesData.tasks || []).flatMap((t) => (Array.isArray(t.rewardItems) && t.rewardItems.length > 0 ? t.rewardItems : [t.product])).filter(Boolean),
  ), [])

  // Pre-index searchable items once -- 24K-line items.json justifies the cost.
  // The market search carries order-book items only; General Store stock,
  // quest items and skill capes live in the General Store tab instead.
  const searchablePool = useMemo(() => {
    const pool = []
    for (const [id, item] of Object.entries(itemsData)) {
      if (!item || (item.id && item.id !== id)) continue
      if (!isOrderBookItem(item)) continue
      pool.push({ id, item, lower: (item.name || '').toLowerCase() })
    }
    return pool
  }, [itemsData])

  const STORE_SECTIONS = ['Weapons & Armour', 'Minigame & Quest Unlocks', 'Runes, Robes & Staves', 'Skilling Equipment', 'Slayer', 'Shardglass']

  // Slayer gear becomes coin-purchasable (at shop value) once unlocked with
  // slayer points — until then the row shows locked. Everyone sees the section.
  const slayerStoreUnlockSet = useMemo(() => new Set(slayerStoreUnlocks || []), [slayerStoreUnlocks])

  // Shardglass gear is bought with Shardglass Shards (an inventory resource),
  // not coins — a client-side exchange like crafting, distinct from the coin
  // order book / general store.
  const SHARDGLASS_SHARD_ID = 'shardglass_shards'
  const isShardglassShopItem = (item) => !!item?.shardglassShopCost
  const shardsOwned = countItem(inventory, SHARDGLASS_SHARD_ID)

  const SKILLING_WEAPON_IDS = new Set(['bronze_axe', 'bronze_pickaxe', 'fishing_net', 'fishing_rod', 'lobster_cage', 'harpoon', 'angler_net'])
  const WIZARD_IDS = new Set(['wizard_hat', 'black_wizard_hat', 'wizard_robe_top', 'wizard_robe_skirt'])

  function getStoreSection(id, item) {
    if (isSlayerStoreItem(id)) return 'Slayer'
    if (item.shardglassShopCost) return 'Shardglass'
    if (item.questUnlock || minigameProductIds.has(id) || item.isSkillCape || item.isMaxCape) return 'Minigame & Quest Unlocks'
    if (item.type === 'rune' || (item.type === 'resource' && id.endsWith('_rune')) || id.startsWith('staff_of_') || WIZARD_IDS.has(id)) return 'Runes, Robes & Staves'
    if (SKILLING_WEAPON_IDS.has(id) || item.type === 'resource' || item.type === 'seed') return 'Skilling Equipment'
    return 'Weapons & Armour'
  }

  // All store items grouped into sections — locked items included but shown disabled.
  const storeSections = useMemo(() => {
    const sections = {}
    for (const s of STORE_SECTIONS) sections[s] = []
    for (const [id, item] of Object.entries(itemsData)) {
      if (!item || (item.id && item.id !== id)) continue
      if (!item.isGeneralStore && !item.isSkillCape && !item.isMaxCape && !minigameProductIds.has(id) && !item.questUnlock && !item.shardglassShopCost && !isSlayerStoreItem(id)) continue
      // Account-identity helms only appear in the store for the exact matching
      // type: standard Ironman vs One Life Ironman never see each other's helm.
      if (item.requiresAccount === 'ironman' && !(isIronman && !isOneLife)) continue
      if (item.requiresAccount === 'ironman_onelife' && !(isIronman && isOneLife)) continue
      if (item.requiresAccount === 'grindman' && !isGrindman) continue
      const section = getStoreSection(id, item)
      sections[section].push({ id, item })
    }
    for (const s of STORE_SECTIONS) {
      sections[s].sort((a, b) => (a.item.name || '').localeCompare(b.item.name || ''))
    }
    return sections
  }, [itemsData, minigameProductIds, isIronman, isOneLife, isGrindman])

  const refreshMyOffers = async () => {
    try {
      const res = await api.tradingPostMyOffers()
      setMyOffers(res?.offers || [])
      setOffersLoaded(true)
      // Only adopt the cloud save when another session has actually advanced it.
      // A blind pull here would overwrite local-only changes that haven't been
      // pushed yet (e.g. coins just withdrawn from the bank), silently
      // reverting them.
      const cloudNewer = await checkCloudNewer()
      if (cloudNewer?.payload) {
        await applyCloudSave(cloudNewer.payload, cloudNewer.updatedAt)
        await loadGame()
      }
    } catch (err) {
      addToast(`Failed to load offers: ${err.message}`, 'error')
    }
  }

  const refreshListings = async () => {
    try {
      const res = await api.tradingPostListings()
      setAllListings(res?.listings || [])
      setListingsLoaded(true)
      setListingsPage(0)
    } catch (err) {
      addToast(`Failed to load listings: ${err.message}`, 'error')
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
    setPendingHighValueSell(false)
    setShardglassMode(false)
  }

  const openShardglassItem = (item) => {
    setSelected(item)
    setPendingAction('buy')
    setQty(1)
    setShardglassMode(true)
  }

  // Shardglass exchange: spend Shardglass Shards from the inventory and receive
  // the gear directly. Client-trusted like crafting — both the shards and the
  // gear ride the save blob, so no coin endpoint is involved.
  const handleShardglassBuy = () => {
    if (!selected || busy) return
    const res = buyWithShards(inventory, selected, qty, SHARDGLASS_SHARD_ID)
    if (!res.ok) {
      if (res.reason === 'insufficient_shards') addToast(`Need ${res.totalCost.toLocaleString()} Shardglass Shards — you have ${res.owned.toLocaleString()}.`, 'error')
      else if (res.reason === 'no_space') addToast(`Not enough inventory space for ${selected.name}.`, 'error')
      else addToast('This item is not sold for shards.', 'error')
      return
    }
    updateInventory(res.inventory)
    addToast(`Bought ${res.buyQty} × ${selected.name} for ${res.totalCost.toLocaleString()} Shardglass Shards.`, 'success')
    closeModal()
  }

  if (!getToken() || !getCharacterId()) {
    return (
      <div class="forge-shell h-full flex flex-col items-center justify-center p-8 text-center">
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
      // player's true balance rather than a stale ≤60s-old snapshot. This must
      // land durably: the buy then adopts the server's save copy, which would
      // otherwise overwrite unsynced client-trusted progress (a just-completed
      // quest, a fresh level). Abort instead of clobbering.
      if (!(await ensureSaveDurable(pushNow, getSnapshot()))) {
        addToast('Could not sync your progress — try again in a moment.', 'error')
        setBusy(false)
        return
      }
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
        const r = getPurchaseRestriction(selected, { isIronman, isOneLife, isGrindman, allowMinigameUnlockPurchase: minigameProductIds.has(selected.id) && unlockedMinigameItems.has(selected.id), allowSlayerStorePurchase: isSlayerStoreItem(selected.id) && slayerStoreUnlockSet.has(selected.id) })
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
      else if (err?.body?.code === 'LEVEL_REQUIREMENT_NOT_MET') addToast(err.body.error, 'error')
      else if (err?.body?.code === 'QUEST_REQUIREMENT_NOT_MET') addToast(err.body.error, 'error')
      else addToast(`Buy failed: ${err.message}`, 'error')
    } finally {
      setBusy(false)
    }
  }

  // ── SELL HANDLER ─────────────────────────────────────────────────────────
  const handleSellClick = () => {
    if (!selected) return
    const totalValue = isOrderBookItem(selected) ? bidPrice * qty : generalStoreSellPrice(selected) * qty
    if (totalValue >= HIGH_VALUE_SELL_THRESHOLD) {
      setPendingHighValueSell(true)
      return
    }
    handleSell()
  }

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
      // slot contents (e.g. items moved out of bank recently). Must land
      // durably: the sell adopts the server's save copy afterwards, so a stale
      // push would overwrite unsynced client-trusted progress. Abort instead.
      if (!(await ensureSaveDurable(pushNow, getSnapshot()))) {
        addToast('Could not sync your progress — try again in a moment.', 'error')
        setBusy(false)
        return
      }
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
  const getSkillCapeLevelBlock = (item) => {
    if (!item?.isSkillCape) return null
    const reqSkill = Object.keys(item.requirements || {})[0]
    if (!reqSkill) return null
    const playerLevel = getLevelFromXP(stats?.[reqSkill]?.xp || 0)
    if (playerLevel < 99) return `🔒 Requires level 99 ${reqSkill[0].toUpperCase()}${reqSkill.slice(1)}`
    return null
  }

  const getMaxCapeLevelBlock = (item) => {
    if (!item?.isMaxCape) return null
    const totalLevel = ALL_SKILLS.reduce((sum, skill) => sum + getLevelFromXP(stats?.[skill]?.xp || 0), 0)
    if (totalLevel < MAX_TOTAL_LEVEL) return `🔒 Requires ${MAX_TOTAL_LEVEL} total level`
    return null
  }

  const renderListRow = (item) => {
    const orderBook = isOrderBookItem(item)
    const isMinigameUnlocked = minigameProductIds.has(item.id) && unlockedMinigameItems.has(item.id)
    const slayerUnlocked = isSlayerStoreItem(item.id) && slayerStoreUnlockSet.has(item.id)
    const restriction = getPurchaseRestriction(item, { isIronman, isOneLife, isGrindman, allowMinigameUnlockPurchase: isMinigameUnlocked, allowSlayerStorePurchase: slayerUnlocked })
    const buyDisabledReason = (() => {
      if (!questRequirementMet(completedQuests, item.questUnlock)) return `🔒 ${questMap[item.questUnlock] || 'Quest required'}`
      if (isSlayerStoreItem(item.id) && !slayerUnlocked) return '🔒 Unlock with Slayer points first'
      if (minigameProductIds.has(item.id) && !isMinigameUnlocked) return '🔒 Earn from minigame first'
      const capeBlock = getSkillCapeLevelBlock(item)
      if (capeBlock) return capeBlock
      const maxCapeBlock = getMaxCapeLevelBlock(item)
      if (maxCapeBlock) return maxCapeBlock
      if (!orderBook && !restriction.allowed && restriction.code !== 'BOSS_UNIQUE_RESTRICTED' && restriction.code !== 'CLUE_REWARD_RESTRICTED') return restriction.message
      return null
    })()
    const owned = countItem(inventory, item.id)
    const m = marketData[item.id]
    const priceLabel = orderBook
      ? (m?.bestSell ? `From ${m.bestSell.price.toLocaleString()} gp` : 'No sellers')
      : `${generalStoreBuyPrice(item).toLocaleString()} gp`
    const buyLabel = orderBook
      ? (m?.bestBuy ? `Best buy ${m.bestBuy.price.toLocaleString()} gp` : 'No buyers')
      : null
    return (
      <div key={item.id} class="p-3 rounded-lg bg-[var(--color-void-light)] border border-[var(--color-void-border)] flex items-center gap-3">
        <GameIcon item={item} size={48} class="shrink-0" />
        <div class="flex-1 min-w-0">
          <div class="text-[13px] font-semibold text-[var(--color-parchment)]">{item.name}</div>
          <div class="text-[10px] text-[var(--text-faint)] mt-1">
            {orderBook ? 'Order book' : 'General store'}
            {owned > 0 && <span class="ml-2">· You have {owned}</span>}
          </div>
          {buyDisabledReason && <div class="text-[10px] text-[var(--fm-blood)] mt-1">{buyDisabledReason}</div>}
        </div>
        <div class="text-right shrink-0">
          <div class="text-[11px] font-[var(--font-mono)] text-[var(--color-gold)]">{priceLabel}</div>
          {buyLabel && <div class="text-[10px] text-[var(--fm-woad)]">{buyLabel}</div>}
          <div class="flex gap-1 mt-1">
            <Button variant="primary" size="sm" onClick={() => openItem(item, 'buy')} disabled={!!buyDisabledReason}>Buy</Button>
            <Button variant="secondary" size="sm" onClick={() => openItem(item, 'sell')} disabled={owned <= 0}>Sell</Button>
          </div>
        </div>
      </div>
    )
  }

  const renderShardglassRow = (item) => {
    const unitCost = Math.floor(Number(item.shardglassShopCost) || 0)
    const owned = countItem(inventory, item.id)
    const canAfford = shardsOwned >= unitCost
    return (
      <div key={item.id} class="p-3 rounded-lg bg-[var(--color-void-light)] border border-[var(--color-void-border)] flex items-center gap-3">
        <GameIcon item={item} size={48} class="shrink-0" />
        <div class="flex-1 min-w-0">
          <div class="text-[13px] font-semibold text-[var(--color-parchment)]">{item.name}</div>
          <div class="text-[10px] text-[var(--text-faint)] mt-1">
            Shardglass store
            {owned > 0 && <span class="ml-2">· You have {owned}</span>}
          </div>
          {!canAfford && <div class="text-[10px] text-[var(--fm-blood)] mt-1">Need {unitCost.toLocaleString()} shards</div>}
        </div>
        <div class="text-right shrink-0">
          <div class="text-[11px] font-[var(--font-mono)] text-[var(--color-gold)] inline-flex items-center gap-1">
            <GameIcon item={itemsData[SHARDGLASS_SHARD_ID]} size={13} /> {unitCost.toLocaleString()}
          </div>
          <div class="flex gap-1 mt-1 justify-end">
            <Button variant="primary" size="sm" onClick={() => openShardglassItem(item)}>Buy</Button>
          </div>
        </div>
      </div>
    )
  }

  const renderMyOffersList = () => {
    // Active offers (still on the book) hold a slot; ready-to-collect rows
    // float above the slot grid so the player can see what's waiting on them.
    const readyOffers = myOffers.filter((o) => isReadyToCollectOffer(o))
    const activeOffers = myOffers.filter((o) => !isReadyToCollectOffer(o))
    const slotsUsed = activeOffers.length

    const renderOffer = (offer, key) => {
      const item = itemsData[offer.item_id]
      const filled = offer.quantity_total - offer.quantity_remaining
      const isReady = isReadyToCollectOffer(offer)
      const buyPendingQty = Number(offer.items_pending) || 0
      const sellPendingQty = Math.max(0, Math.min(filled, Math.floor((Number(offer.coins_pending) || 0) / Math.max(1, Number(offer.price) || 1))))
      const executedUnitPrice = (() => {
        if (offer.offer_type === 'buy' && buyPendingQty > 0) return Math.floor((Number(offer.coins_pending) || 0) / buyPendingQty)
        if (offer.offer_type === 'sell' && sellPendingQty > 0) return Math.floor((Number(offer.coins_pending) || 0) / sellPendingQty)
        return Number(offer.price) || 0
      })()
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
      const accentBorder = isReady ? 'border-[var(--color-gold)]' : 'border-[var(--color-void-border)]'
      return (
        <Panel key={key} className={`text-[12px] border ${accentBorder}`}>
          <div class="flex items-center gap-3">
            <GameIcon item={item} size={48} class="shrink-0" />
            <div class="flex-1 min-w-0">
              <div class="text-[13px] font-semibold text-[var(--color-parchment)]">
                {offer.offer_type === 'buy' ? 'Buy' : 'Sell'} {item?.name || offer.item_id}
              </div>
              <div class="text-[10px] text-[var(--text-faint)]">
                {executedUnitPrice.toLocaleString()} gp · {filled}/{offer.quantity_total} filled
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
        <div class="text-[11px] text-[var(--text-faint)] mb-1">Slots: {slotsUsed}/{MAX_SLOTS} active</div>
        {Array.from({ length: MAX_SLOTS }).map((_, idx) => {
          const offer = activeOffers[idx]
          if (!offer) {
            return (
              <Panel key={`empty-${idx}`} className="text-center text-[12px] text-[var(--text-faint)] py-4">
                Empty slot
              </Panel>
            )
          }
          return renderOffer(offer, `active-${offer.id}`)
        })}
      </div>
    )
  }

  const renderStore = () => {
    // Detail view: one section takes the whole space with its own scroll area
    // and a back button to return to the section list.
    if (activeStoreSection) {
      const rows = storeSections[activeStoreSection] || []
      return (
        <div class="h-full flex flex-col overflow-hidden">
          <button
            onClick={() => setActiveStoreSection(null)}
            class="flex-shrink-0 flex items-center gap-2 px-4 py-3 border-b border-[var(--color-void-border)] bg-[var(--color-void-light)] text-left"
          >
            <span class="text-[var(--color-gold)] text-[14px]">‹</span>
            <span class="text-[13px] font-semibold text-[var(--color-parchment)]">{activeStoreSection}</span>
            <span class="ml-auto text-[11px] text-[var(--text-faint)]">{rows.length} item{rows.length !== 1 ? 's' : ''}</span>
          </button>
          <div class="flex-1 overflow-y-auto px-4 pt-3 pb-20 md:pb-4">
            {rows.length === 0 ? (
              <div class="py-10 px-4 text-center text-[var(--text-faint)] text-[12px]">No items in this section.</div>
            ) : (
              <div class="flex flex-col gap-2">
                {rows.map((row) => (activeStoreSection === 'Shardglass'
                  ? renderShardglassRow({ ...row.item, id: row.id })
                  : renderListRow({ ...row.item, id: row.id })))}
              </div>
            )}
          </div>
        </div>
      )
    }

    // List view: section names fill the space; tap to drill into one.
    return (
      <div class="h-full overflow-y-auto px-4 pt-3 pb-20 md:pb-4 flex flex-col gap-2">
        {STORE_SECTIONS.map((section) => {
          const rows = storeSections[section] || []
          return (
            <button
              key={section}
              onClick={() => setActiveStoreSection(section)}
              class="w-full flex items-center justify-between px-4 py-4 rounded-lg border border-[var(--color-void-border)] bg-[var(--color-void-light)] text-left"
            >
              <span class="text-[14px] font-semibold text-[var(--color-parchment)]">{section}</span>
              <span class="text-[11px] text-[var(--text-faint)] flex items-center gap-2">
                <span>{rows.length} item{rows.length !== 1 ? 's' : ''}</span>
                <span class="text-[var(--color-gold)] text-[14px]">›</span>
              </span>
            </button>
          )
        })}
      </div>
    )
  }

  const renderListings = () => {
    const renderListingRow = (listing) => {
      const item = itemsData[listing.item_id]
      const hasAnyOffer = listing.bestBuy !== null || listing.bestSell !== null
      if (!hasAnyOffer) return null
      return (
        <div key={listing.item_id} class="p-3 rounded-lg bg-[var(--color-void-light)] border border-[var(--color-void-border)] flex items-center gap-3">
          <GameIcon item={item} size={48} class="shrink-0" />
          <div class="flex-1 min-w-0">
            <div class="text-[13px] font-semibold text-[var(--color-parchment)]">{item?.name || listing.item_id}</div>
            <div class="text-[10px] text-[var(--text-faint)] mt-1">
              {listing.buyOfferCount > 0 && <span>Buyers: {listing.buyOfferCount}</span>}
              {listing.buyOfferCount > 0 && listing.sellOfferCount > 0 && <span class="mx-1">·</span>}
              {listing.sellOfferCount > 0 && <span>Sellers: {listing.sellOfferCount}</span>}
            </div>
          </div>
          <div class="text-right shrink-0">
            {listing.bestBuy !== null && (
              <div class="text-[11px] font-[var(--font-mono)] text-[var(--fm-woad)]">Buy: {listing.bestBuy.toLocaleString()} gp</div>
            )}
            {listing.bestSell !== null && (
              <div class="text-[11px] font-[var(--font-mono)] text-[var(--color-gold)]">Sell: {listing.bestSell.toLocaleString()} gp</div>
            )}
          </div>
        </div>
      )
    }

    const activeListings = allListings.filter((l) => l.bestBuy !== null || l.bestSell !== null)
    const totalPages = Math.ceil(activeListings.length / LISTINGS_PAGE_SIZE)
    const safePage = Math.min(listingsPage, Math.max(0, totalPages - 1))
    const pageSlice = activeListings.slice(safePage * LISTINGS_PAGE_SIZE, (safePage + 1) * LISTINGS_PAGE_SIZE)

    return (
      <div class="h-full overflow-y-auto px-4 pb-20 md:pb-4">
        {!listingsLoaded ? (
          <div class="py-10 px-4 text-center text-[var(--text-faint)] text-[12px]">Loading listings…</div>
        ) : activeListings.length === 0 ? (
          <div class="py-10 px-4 text-center text-[var(--text-faint)] text-[12px]">No active listings.</div>
        ) : (
          <>
            <div class="flex flex-col gap-2 pt-3">
              {pageSlice.map(renderListingRow)}
            </div>
            {totalPages > 1 && (
              <div class="flex items-center justify-center gap-3 pt-4 pb-2">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={safePage === 0}
                  onClick={() => setListingsPage((p) => Math.max(0, p - 1))}
                >
                  ‹ Prev
                </Button>
                <span class="text-[11px] text-[var(--text-faint)]">
                  {safePage + 1} / {totalPages}
                </span>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={safePage >= totalPages - 1}
                  onClick={() => setListingsPage((p) => Math.min(totalPages - 1, p + 1))}
                >
                  Next ›
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    )
  }

  const shardglassDetailModal = selected && shardglassMode ? (() => {
    const unitCost = Math.floor(Number(selected.shardglassShopCost) || 0)
    const totalCost = unitCost * qty
    const canAfford = shardsOwned >= totalCost
    const shardName = itemsData[SHARDGLASS_SHARD_ID]?.name || 'Shardglass Shards'
    return (
      <div class="space-y-3">
        <Panel className="text-[11px] text-[var(--text-faint)] space-y-1">
          <div class="flex justify-between"><span>Price</span><span class="text-[var(--color-gold)] font-[var(--font-mono)]">{unitCost.toLocaleString()} shards each</span></div>
          <div class="flex justify-between"><span>You own</span><span class="font-[var(--font-mono)]">{shardsOwned.toLocaleString()} shards</span></div>
        </Panel>
        <div class="flex flex-col gap-2">
          <div class="text-[12px] text-[var(--text-faint)]">Quantity</div>
          <div class="flex gap-2 items-center">
            <Button variant="secondary" size="md" onClick={() => setQty(Math.max(1, qty - 1))} className="w-8 h-8 p-0 flex items-center justify-center text-base">−</Button>
            <input
              type="number"
              min="1"
              value={qty}
              onInput={(e) => setQty(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
              class="flex-1 h-9 rounded-md bg-[var(--color-void)] border border-[var(--color-void-border)] text-[var(--color-parchment)] text-[13px] font-[var(--font-mono)] text-center outline-none"
            />
            <Button variant="secondary" size="md" onClick={() => setQty(qty + 1)} className="w-8 h-8 p-0 flex items-center justify-center text-base">+</Button>
          </div>
        </div>
        <Panel className="text-[12px] flex justify-between">
          <span class="text-[var(--text-faint)]">Total cost</span>
          <span class={`font-[var(--font-mono)] font-bold ${canAfford ? 'text-[var(--color-gold)]' : 'text-[var(--fm-blood)]'}`}>{totalCost.toLocaleString()} shards</span>
        </Panel>
        {!canAfford && (
          <Panel className="text-[11px] text-[var(--fm-blood)]">Not enough {shardName} for this purchase.</Panel>
        )}
        <div class="flex gap-2">
          <Button variant="secondary" size="lg" onClick={closeModal} className="flex-1">Cancel</Button>
          <Button variant="primary" size="lg" onClick={handleShardglassBuy} disabled={busy || !canAfford} className="flex-1">
            {busy ? '…' : 'Buy'}
          </Button>
        </div>
      </div>
    )
  })() : null

  const detailModal = selected ? (() => {
    const orderBook = isOrderBookItem(selected)
    const ownedQty = countItem(inventory, selected.id)
    const isBuy = pendingAction === 'buy'
    const isQuestLocked = !questRequirementMet(completedQuests, selected.questUnlock)
    const isMinigameLocked = minigameProductIds.has(selected.id) && !unlockedMinigameItems.has(selected.id)
    const isSlayerLocked = isSlayerStoreItem(selected.id) && !slayerStoreUnlockSet.has(selected.id)
    const capeBlock = getSkillCapeLevelBlock(selected)
    const buyLocked = isBuy && (isQuestLocked || isMinigameLocked || isSlayerLocked || !!capeBlock)
    return (
      <div class="space-y-3">
        {!isBuy && ownedQty < 1 && (
          <Panel className="text-[11px] text-[var(--fm-blood)]">You don't own any of this item to sell.</Panel>
        )}
        {buyLocked && (
          <Panel className="text-[11px] text-[var(--fm-blood)]">
            {isQuestLocked
              ? `🔒 Complete ${questMap[selected.questUnlock]} to unlock this item.`
              : isMinigameLocked
                ? '🔒 Earn this from the minigame once before purchasing.'
                : isSlayerLocked
                  ? '🔒 Buy this with Slayer points once before purchasing it for coins.'
                  : capeBlock}
          </Panel>
        )}
        {orderBook && (
          <div class="flex flex-col gap-2">
            <div class="text-[12px] text-[var(--text-faint)]">Price per item (gp)</div>
            <input
              type="number"
              min="1"
              value={bidPrice}
              onInput={(e) => setBidPrice(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
              class="h-9 rounded-md bg-[var(--color-void)] border border-[var(--color-void-border)] text-[var(--color-parchment)] text-[13px] font-[var(--font-mono)] text-center px-2 outline-none"
            />
          </div>
        )}
        <div class="flex flex-col gap-2">
          <div class="text-[12px] text-[var(--text-faint)]">Quantity</div>
          <div class="flex gap-2 items-center">
            <Button variant="secondary" size="md" onClick={() => setQty(Math.max(1, qty - 1))} className="w-8 h-8 p-0 flex items-center justify-center text-base">−</Button>
            <input
              type="number"
              min="1"
              value={qty}
              onInput={(e) => setQty(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
              class="flex-1 h-9 rounded-md bg-[var(--color-void)] border border-[var(--color-void-border)] text-[var(--color-parchment)] text-[13px] font-[var(--font-mono)] text-center outline-none"
            />
            <Button variant="secondary" size="md" onClick={() => setQty(qty + 1)} className="w-8 h-8 p-0 flex items-center justify-center text-base">+</Button>
          </div>
          {!isBuy && (
            <button class="text-[10px] text-[var(--text-faint)] underline self-start" onClick={() => setQty(Math.max(1, ownedQty))}>Use max ({ownedQty})</button>
          )}
        </div>
        <Panel className="text-[12px] flex justify-between">
          <span class="text-[var(--text-faint)]">Total {isBuy ? 'cost' : 'payout'}</span>
          <span class="text-[var(--color-gold)] font-[var(--font-mono)] font-bold">
            {orderBook
              ? `≤ ${(bidPrice * qty).toLocaleString()} gp`
              : (isBuy
                  ? `${(generalStoreBuyPrice(selected) * qty).toLocaleString()} gp`
                  : `${(generalStoreSellPrice(selected) * qty).toLocaleString()} gp`)}
          </span>
        </Panel>
        {!orderBook && isBuy && (
          <div class="text-[10px] text-[var(--text-faint)] -mt-1">
            This item is sold at its shop value.
          </div>
        )}
        <div class="flex gap-2">
          <Button variant="secondary" size="lg" onClick={closeModal} className="flex-1">Cancel</Button>
          <Button
            variant="primary"
            size="lg"
            onClick={isBuy ? handleBuy : handleSellClick}
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
    <div class="forge-shell h-full flex flex-col overflow-hidden">
      <div class="px-4 pt-3 pb-3 flex-shrink-0">
        <BackLink onClick={onBack} className="mb-3" />
        <div class="flex justify-between items-center mb-3">
          <h2 class="font-[var(--font-display)] text-[15px] font-bold text-[var(--color-gold)] m-0">{isIronman ? 'General Store' : 'Trading Post'}</h2>
          <span class="inline-flex items-center gap-1 text-[11px] text-[var(--color-gold)] font-[var(--font-mono)]">
            <GameIcon iconKey="coins" size={13} color="var(--color-gold)" /> {coins.toLocaleString()}
          </span>
        </div>
        {!isIronman && (
        <div class="flex gap-2 mb-3">
          <button
            onClick={() => setMode('market')}
            class={`px-3 py-[5px] rounded-[20px] text-[11px] font-semibold border ${
              mode === 'market'
                ? 'border-[var(--color-gold)] bg-[rgba(212,175,55,0.15)] text-[var(--color-gold)]'
                : 'border-[var(--color-void-border)] bg-[var(--color-void-light)] text-[var(--color-parchment)] opacity-60'
            } inline-flex items-center gap-1`}
          ><GameIcon iconKey="search" size={13} color="currentColor" /> Market</button>
          <button
            onClick={() => setMode('store')}
            class={`px-3 py-[5px] rounded-[20px] text-[11px] font-semibold border ${
              mode === 'store'
                ? 'border-[var(--color-gold)] bg-[rgba(212,175,55,0.15)] text-[var(--color-gold)]'
                : 'border-[var(--color-void-border)] bg-[var(--color-void-light)] text-[var(--color-parchment)] opacity-60'
            } inline-flex items-center gap-1`}
          ><GameIcon iconKey="coins" size={13} color="currentColor" /> Store</button>
          <button
            onClick={() => { setMode('offers'); refreshMyOffers() }}
            class={`px-3 py-[5px] rounded-[20px] text-[11px] font-semibold border ${
              mode === 'offers'
                ? 'border-[var(--color-gold)] bg-[rgba(212,175,55,0.15)] text-[var(--color-gold)]'
                : 'border-[var(--color-void-border)] bg-[var(--color-void-light)] text-[var(--color-parchment)] opacity-60'
            } inline-flex items-center gap-1`}
          ><GameIcon iconKey="offers" size={13} color="currentColor" /> Offers
            {offersLoaded && myOffers.some((o) => isReadyToCollectOffer(o)) && (
              <span class="ml-1 inline-block min-w-[16px] h-[16px] leading-[16px] px-1 rounded-full text-[10px] font-bold bg-[var(--color-gold)] text-[var(--color-void)] align-middle">
                {myOffers.filter((o) => isReadyToCollectOffer(o)).length}
              </span>
            )}
          </button>
          <button
            onClick={() => { setMode('listings'); refreshListings() }}
            class={`px-3 py-[5px] rounded-[20px] text-[11px] font-semibold border ${
              mode === 'listings'
                ? 'border-[var(--color-gold)] bg-[rgba(212,175,55,0.15)] text-[var(--color-gold)]'
                : 'border-[var(--color-void-border)] bg-[var(--color-void-light)] text-[var(--color-parchment)] opacity-60'
            } inline-flex items-center gap-1`}
          ><GameIcon iconKey="search" size={13} color="currentColor" /> Listings</button>
        </div>
        )}
        {mode === 'market' && (
          <input
            type="text"
            placeholder="Search for an item to buy or sell…"
            value={searchTerm}
            onInput={(e) => setSearchTerm(e.target.value)}
            class="w-full px-3 py-2 rounded-lg border border-[var(--color-void-border)] bg-[var(--color-void)] text-[var(--color-parchment)] text-[13px] outline-none"
          />
        )}
        {mode === 'listings' && (
          <div class="text-[11px] text-[var(--text-faint)]">Browse all active market listings</div>
        )}
      </div>

      {mode === 'market' ? (
        <div class="h-full overflow-y-auto px-4 pb-20 md:pb-4">
          {!searchTerm.trim() ? (
            <div class="py-10 px-4 text-center text-[var(--text-faint)] text-[12px]">
              Search by item name to view market prices and listings.
            </div>
          ) : searchResults.length === 0 ? (
            <div class="py-10 px-4 text-center text-[var(--text-faint)] text-[12px]">No items match "{searchTerm}".</div>
          ) : (
            <div class="flex flex-col gap-2 pt-3">
              {searchResults.map(renderListRow)}
            </div>
          )}
        </div>
      ) : mode === 'store' ? (
        renderStore()
      ) : mode === 'offers' ? (
        <div class="h-full overflow-y-auto">
          {renderMyOffersList()}
        </div>
      ) : (
        renderListings()
      )}

      {selected && (
        <SharedItemModal
          item={selected}
          title={`${shardglassMode ? 'Buy' : (pendingAction === 'buy' ? 'Buy' : 'Sell')}: ${selected.name}`}
          onClose={closeModal}
        >
          {shardglassMode ? shardglassDetailModal : detailModal}
        </SharedItemModal>
      )}

      {pendingHighValueSell && selected && (
        <SellConfirmModal
          itemName={selected.name}
          quantity={qty}
          totalValue={isOrderBookItem(selected) ? bidPrice * qty : generalStoreSellPrice(selected) * qty}
          busy={busy}
          onCancel={() => setPendingHighValueSell(false)}
          onConfirm={() => {
            setPendingHighValueSell(false)
            handleSell()
          }}
        />
      )}
    </div>
  )
}
